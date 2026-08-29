const DEFAULT_REQUEST_TIMEOUT_MS = 15_000;
const DEFAULT_TURN_TIMEOUT_MS = 120_000;
const MAX_RESPONSE_BYTES = 2_000_000;
const TERMINAL_TURN_STATES = new Set(["done", "cancelled", "error"]);

function normalizeBaseUrl(value) {
  if (!value) return null;
  const url = new URL(value);
  const isLoopback = ["localhost", "127.0.0.1", "::1"].includes(url.hostname);
  if (url.username || url.password) throw new Error("TrueForge credentials must not be embedded in TRUEFORGE_BASE_URL");
  if (process.env.NODE_ENV === "production" && url.protocol !== "https:" && !isLoopback) {
    throw new Error("Production TrueForge base URL must use HTTPS unless it is loopback-local");
  }
  url.search = "";
  url.hash = "";
  url.pathname = url.pathname.replace(/\/+$/, "") || "/";
  return url;
}

function resolveApiUrl(baseUrl, path) {
  const url = new URL(baseUrl.toString());
  const basePath = url.pathname === "/" ? "" : url.pathname.replace(/\/+$/, "");
  url.pathname = `${basePath}/${String(path).replace(/^\/+/, "")}`;
  return url;
}

async function readJsonResponse(response) {
  const declaredLength = Number(response.headers.get("content-length") || 0);
  if (declaredLength > MAX_RESPONSE_BYTES) throw new Error("TrueForge response is too large");
  const raw = await response.text();
  if (Buffer.byteLength(raw) > MAX_RESPONSE_BYTES) throw new Error("TrueForge response is too large");
  let payload = {};
  if (raw) {
    try { payload = JSON.parse(raw); } catch { throw new Error("TrueForge returned invalid JSON"); }
  }
  if (!response.ok) {
    const message = payload?.error?.message || payload?.message || payload?.error || `TrueForge returned ${response.status}`;
    throw Object.assign(new Error(String(message)), { status: response.status });
  }
  return payload;
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

export class TrueForgeClient {
  constructor({ baseUrl, token, agentName, requestTimeoutMs = DEFAULT_REQUEST_TIMEOUT_MS } = {}) {
    this.baseUrl = normalizeBaseUrl(baseUrl ?? process.env.TRUEFORGE_BASE_URL);
    this.token = token ?? process.env.TRUEFORGE_TOKEN ?? "";
    this.agentName = agentName ?? process.env.TRUEFORGE_AGENT_NAME ?? "vendor-scout";
    this.requestTimeoutMs = requestTimeoutMs;
  }

  get configured() {
    return Boolean(this.baseUrl && this.agentName);
  }

  get safeEndpoint() {
    if (!this.baseUrl) return null;
    const path = this.baseUrl.pathname === "/" ? "" : this.baseUrl.pathname;
    return `${this.baseUrl.origin}${path}`;
  }

  async request(path, { method = "GET", body, timeoutMs = this.requestTimeoutMs } = {}) {
    if (!this.baseUrl) throw new Error("TRUEFORGE_BASE_URL is not configured");
    const url = resolveApiUrl(this.baseUrl, path);
    const response = await fetch(url, {
      method,
      headers: {
        Accept: "application/json",
        ...(body !== undefined ? { "Content-Type": "application/json" } : {}),
        ...(this.token ? { Authorization: `Bearer ${this.token}` } : {})
      },
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
      signal: AbortSignal.timeout(timeoutMs)
    });
    return readJsonResponse(response);
  }

  async createSession() {
    if (!this.agentName) throw new Error("TRUEFORGE_AGENT_NAME is not configured");
    const payload = await this.request("api/v1/sessions/", {
      method: "POST",
      body: { agent: { name: this.agentName } }
    });
    if (!payload?.data?.id) throw new Error("TrueForge session response is missing data.id");
    return payload.data;
  }

  async getSession(sessionId) {
    const payload = await this.request(`api/v1/sessions/${encodeURIComponent(sessionId)}`);
    if (!payload?.data?.id) throw new Error("TrueForge session response is missing data.id");
    return payload.data;
  }

  async createTurn(sessionId, content) {
    const payload = await this.request(`api/v1/sessions/${encodeURIComponent(sessionId)}/turns`, {
      method: "POST",
      body: {
        stream: false,
        input: [{ type: "user.message", content }]
      }
    });
    if (!payload?.data?.id) throw new Error("TrueForge turn response is missing data.id");
    return payload.data;
  }

  async getTurn(sessionId, turnId) {
    const payload = await this.request(`api/v1/sessions/${encodeURIComponent(sessionId)}/turns/${encodeURIComponent(turnId)}`);
    if (!payload?.data?.id) throw new Error("TrueForge turn response is missing data.id");
    return payload.data;
  }

  async waitForTurn(sessionId, turnId, { timeoutMs = DEFAULT_TURN_TIMEOUT_MS, pollMs = 500 } = {}) {
    const started = Date.now();
    while (Date.now() - started < timeoutMs) {
      const turn = await this.getTurn(sessionId, turnId);
      if (TERMINAL_TURN_STATES.has(turn.state?.status)) return turn;
      await sleep(pollMs);
    }
    throw new Error(`TrueForge turn ${turnId} did not finish within ${timeoutMs}ms`);
  }
}

export function missionTurnPrompt(mission, { suppliers = [], activity = [] } = {}) {
  const supplierSummary = suppliers.map(candidate => ({
    id: candidate.id,
    name: candidate.name,
    region: candidate.region,
    type: candidate.type,
    status: candidate.status,
    confidence: candidate.confidence,
    specMatch: candidate.specMatch,
    preliminaryUnitPrice: candidate.preliminaryUnitPrice,
    moq: candidate.moq,
    leadTimeDays: candidate.leadTimeDays,
    provenance: candidate.source
  }));

  return [
    "You are the persistent procurement orchestrator for Vendor Scout.",
    "Continue the sourcing mission using the tools configured in this TrueForge agent.",
    "Preserve evidence and provenance for factual supplier claims. Do not invent supplier facts.",
    "Do not spend money, accept commercial terms, place orders, or make another consequential commitment without explicit human approval.",
    "If a consequential action is ready, stop and surface the decision instead of executing it.",
    "",
    "Current mission state:",
    JSON.stringify({
      id: mission.id,
      status: mission.status,
      objective: mission.objective,
      specification: mission.specification,
      quantity: mission.quantity,
      currentSupplier: mission.currentSupplier,
      constraints: mission.constraints,
      suppliers: supplierSummary,
      recentActivity: activity.slice(-8)
    }, null, 2),
    "",
    "Work on the next useful procurement step that your configured tools can actually perform. Return a concise summary of work performed, evidence gathered, unresolved risks, and the next action."
  ].join("\n");
}

export function summarizeTurn(turn) {
  const state = turn?.state || {};
  const output = state.output;
  const content = typeof output?.content === "string"
    ? output.content
    : typeof output === "string"
      ? output
      : null;
  const requiredActions = Array.isArray(state.requiredActions)
    ? state.requiredActions
    : Array.isArray(state.required_actions)
      ? state.required_actions
      : [];
  return {
    id: turn?.id || null,
    status: state.status || "unknown",
    content: content ? content.slice(0, 20_000) : null,
    requiredActions: requiredActions.slice(0, 20)
  };
}
