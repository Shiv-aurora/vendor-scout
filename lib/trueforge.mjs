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
    contact: candidate.contact || null,
    provenance: candidate.source
  }));

  return [
    "You are the persistent procurement orchestrator for Vendor Scout.",
    "Use the configured Vendor Scout MCP connector as the durable mission state and action boundary.",
    "Begin by reading the mission with vendor_scout_get_mission so you reconcile this prompt with current persisted state, conversations, supplier replies, and negotiation state.",
    "When live web/search/supplier tools are available, research real supplier candidates and persist only evidence-backed results with vendor_scout_record_supplier_candidates. Every factual candidate must include its source reference. A supplier contact email may be recorded only when its provenance is available. Unknown price, MOQ, or lead time must remain null; never invent missing commercial facts.",
    "If no live research tool is available, vendor_scout_discover_suppliers may use Vendor Scout's configured discovery provider or explicitly labeled controlled fallback.",
    "After candidates exist, call vendor_scout_qualify_suppliers so qualification is computed from mission constraints and persisted evidence rather than improvised in prose.",
    "When the mission reaches contacting, use vendor_scout_prepare_rfqs to create durable non-binding RFQ drafts. Use vendor_scout_send_rfqs only through Vendor Scout's configured outreach provider. Controlled previews are not real outreach and will not advance the mission.",
    "When a real supplier reply arrives through an email/MCP transport, persist the exact reply and source reference with vendor_scout_record_supplier_reply before interpreting the terms.",
    "For negotiation, read the recorded reply and call vendor_scout_record_offer_terms with only terms the supplier explicitly stated. Anchor the extraction to that reply's sourceReference. Keep uncertain or absent fields null; do not infer a favorable price, MOQ, lead time, shipping term, sample term, certification, or technical confirmation.",
    "After structured offer terms are persisted, call vendor_scout_prepare_counter for that supplier. Vendor Scout will compare the latest offer with mission constraints and same-currency persisted competitor offers, generate a non-binding counter only for explicit gaps/missing information, or mark the offer ready for comparison. Competitor identities are never disclosed in counters.",
    "If a counter draft exists, call vendor_scout_send_counter. Delivery is idempotent and uses the same outreach transport. When the supplier replies again, persist the new reply, record the revised explicit terms, and repeat the prepare/send cycle.",
    "If the latest offer is marked ready_for_comparison, stop countering that supplier; this does not accept the offer. If Vendor Scout marks human_review/reject_recommended because of an explicit critical technical conflict, stop autonomous negotiation and surface the issue.",
    "When one or more offers are ready for comparison, use the TrueForge sandbox to independently recompute the core quote math from persisted terms (quantity tiers, MOQ, shipping, FX when supplied, and baseline savings) so arithmetic is inspectable. Then call vendor_scout_analyze_quotes to persist the deterministic normalized comparison. Do not fabricate FX or shipping inputs.",
    "vendor_scout_analyze_quotes creates the pending decision packet and moves a successful comparison to awaiting_approval. When the mission is awaiting_approval, stop and surface the decision; do not try to bypass the human business decision.",
    "If a later turn sees the mission status approved, call vendor_scout_execute_sample_order only for the approved action. That tool is destructive and must be listed in TrueForge require_approval_for_tools, so the harness pauses again immediately before execution. Never work around or disable that gate.",
    "Preserve evidence and provenance for factual supplier claims and communications. Do not invent supplier facts, messages, replies, offers, competing offers, quotes, or delivery state.",
    "Do not spend money, accept commercial terms, place orders, or make another consequential commitment without explicit human approval. The current tools intentionally expose no acceptance or purchasing action.",
    "If a consequential action is ready, stop and surface the decision instead of executing it.",
    "",
    "Current mission snapshot supplied by Vendor Scout:",
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
