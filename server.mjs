import http from "node:http";
import { timingSafeEqual } from "node:crypto";
import { readFile } from "node:fs/promises";
import { extname, join, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { createSeed } from "./lib/seed.mjs";
import { discoverSuppliers } from "./lib/discovery.mjs";
import { qualifySupplier, transitionMission, validateMission } from "./lib/domain.mjs";
import { migrateState } from "./lib/migrations.mjs";
import { createDemoStore } from "./lib/store.mjs";

const root = fileURLToPath(new URL(".", import.meta.url));
const publicRoot = join(root, "public");
const port = Number(process.env.PORT || 3000);
const isProduction = process.env.NODE_ENV === "production";
const configuredAgentToken = process.env.VENDOR_SCOUT_AGENT_TOKEN || "";
const allowFixtureFallback = !isProduction || process.env.VENDOR_SCOUT_ALLOW_FIXTURE_FALLBACK === "1";
const devResetEnabled = !isProduction || process.env.VENDOR_SCOUT_ENABLE_DEV_RESET === "1";

const store = await createDemoStore(createSeed());
let state = await store.snapshot();
const migration = migrateState(state);
if (migration.migrated) {
  state = migration.state;
  await store.write(state);
}

const mutationHits = new Map();
let mutationQueue = Promise.resolve();

const securityHeaders = Object.freeze({
  "Content-Security-Policy": "default-src 'self'; img-src 'self' data:; script-src 'self'; style-src 'self' 'unsafe-inline'; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'",
  "Cross-Origin-Opener-Policy": "same-origin",
  "Cross-Origin-Resource-Policy": "same-origin",
  "Permissions-Policy": "camera=(), microphone=(), geolocation=()",
  "Referrer-Policy": "no-referrer",
  "X-Content-Type-Options": "nosniff",
  "X-Frame-Options": "DENY"
});

const types = { ".html": "text/html; charset=utf-8", ".css": "text/css; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".svg": "image/svg+xml", ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".webp": "image/webp", ".ico": "image/x-icon" };
const json = (res, status, value) => { res.writeHead(status, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" }); res.end(JSON.stringify(value)); };
const httpError = (status, message) => Object.assign(new Error(message), { status });

const isSameOriginRequest = req => {
  const fetchSite = req.headers["sec-fetch-site"];
  if (fetchSite && !["same-origin", "same-site", "none"].includes(fetchSite)) return false;
  if (!req.headers.origin) return true;
  try { return new URL(req.headers.origin).host === req.headers.host; } catch { return false; }
};

const allowMutation = req => {
  const key = req.socket.remoteAddress || "unknown";
  const cutoff = Date.now() - 60_000;
  const recent = (mutationHits.get(key) || []).filter(timestamp => timestamp > cutoff);
  if (recent.length >= 60) return false;
  recent.push(Date.now());
  mutationHits.set(key, recent);
  return true;
};

function safeTokenEquals(received, expected) {
  const receivedBuffer = Buffer.from(received || "");
  const expectedBuffer = Buffer.from(expected || "");
  if (receivedBuffer.length !== expectedBuffer.length || expectedBuffer.length === 0) return false;
  return timingSafeEqual(receivedBuffer, expectedBuffer);
}

function isAgentAuthorized(req) {
  if (!isProduction && !configuredAgentToken) return true;
  if (!configuredAgentToken) return false;
  const header = req.headers.authorization || "";
  const received = header.startsWith("Bearer ") ? header.slice(7) : "";
  return safeTokenEquals(received, configuredAgentToken);
}

async function readJsonBody(req, limit = 64 * 1024) {
  const declared = Number(req.headers["content-length"] || 0);
  if (declared > limit) throw httpError(413, "Request body is too large");
  let raw = "";
  for await (const chunk of req) {
    raw += chunk;
    if (Buffer.byteLength(raw) > limit) throw httpError(413, "Request body is too large");
  }
  if (!raw) return {};
  try { return JSON.parse(raw); } catch { throw httpError(400, "Request body must be valid JSON"); }
}

function capabilities() {
  return {
    agentMutationsEnabled: !isProduction || Boolean(configuredAgentToken),
    browserMutationsEnabled: !isProduction && !configuredAgentToken,
    discoveryProvider: process.env.VENDOR_SCOUT_DISCOVERY_URL ? "remote" : allowFixtureFallback ? "controlled-fixture" : "unconfigured",
    fixtureFallbackEnabled: allowFixtureFallback,
    devResetEnabled
  };
}

function dashboard() {
  const activeMissions = state.missions.filter(mission => !["completed", "rejected"].includes(mission.status));
  const qualified = state.supplierCandidates.filter(candidate => candidate.status === "qualified");
  const negotiationsActive = state.conversations.filter(conversation => conversation.status === "negotiating").length;
  const approvalsWaiting = state.approvals.filter(approval => approval.status === "pending").length;
  const projectedSavings = Math.max(0, ...qualified.map(candidate => candidate.projectedSavings || 0));

  return {
    ...state,
    meta: { ...state.meta, persistence: store.kind },
    capabilities: capabilities(),
    summary: {
      activeMissions: activeMissions.length,
      suppliersDiscovered: state.supplierCandidates.length,
      suppliersQualified: qualified.length,
      suppliersContacted: new Set(state.conversations.map(conversation => conversation.supplierId)).size,
      negotiationsActive,
      quotesReceived: state.quotes.length,
      approvalsWaiting,
      projectedSavings
    }
  };
}

function missionSnapshot(id) {
  const mission = state.missions.find(item => item.id === id);
  if (!mission) return null;
  const forMission = items => items.filter(item => item.missionId === id);
  return {
    mission,
    component: state.components.find(item => item.id === mission.componentId) || null,
    suppliers: forMission(state.supplierCandidates),
    conversations: forMission(state.conversations),
    quotes: forMission(state.quotes),
    recommendations: forMission(state.recommendations),
    approvals: forMission(state.approvals),
    activity: forMission(state.activity)
  };
}

function addActivity(missionId, stage, title, detail) {
  state.activity.push({
    id: `activity-${Date.now()}-${state.activity.length + 1}`,
    missionId,
    at: new Date().toISOString(),
    stage,
    title,
    detail
  });
}

async function persist() {
  await store.write(state);
  return dashboard();
}

async function serializeMutation(work) {
  const next = mutationQueue.then(work, work);
  mutationQueue = next.then(() => undefined, () => undefined);
  return next;
}

function requireStatus(mission, expected, action) {
  if (mission.status !== expected) {
    throw httpError(409, `Cannot ${action} while mission status is ${mission.status}; expected ${expected}`);
  }
}

async function executeMissionAction(id, action) {
  const mission = state.missions.find(item => item.id === id);
  if (!mission) throw httpError(404, "Sourcing mission not found");
  const missionErrors = validateMission(mission);
  if (missionErrors.length) throw httpError(422, `Mission is invalid: ${missionErrors.join("; ")}`);

  if (action === "start") {
    requireStatus(mission, "draft", "start discovery");
    mission.status = transitionMission(mission.status, "start");
    mission.updatedAt = new Date().toISOString();
    addActivity(id, "mission", "Mission started", "Vendor Scout began supplier discovery using the mission constraints.");
  } else if (action === "discover") {
    requireStatus(mission, "discovering", "run discovery");
    const result = await discoverSuppliers(mission, { allowFixtureFallback });
    state.supplierCandidates = [
      ...state.supplierCandidates.filter(candidate => candidate.missionId !== id),
      ...result.candidates
    ];
    mission.status = transitionMission(mission.status, "discovery_complete");
    mission.updatedAt = new Date().toISOString();
    mission.execution = {
      ...(mission.execution || {}),
      discoveryProvider: result.provider,
      fallbackUsed: result.fallbackUsed,
      providerError: result.providerError || null,
      lastRunAt: mission.updatedAt
    };
    addActivity(
      id,
      "discover",
      `${result.candidates.length} supplier candidates discovered`,
      result.fallbackUsed
        ? "Discovery completed with the controlled fallback; each candidate retains explicit fixture provenance."
        : "Discovery completed through the configured external provider with source provenance preserved."
    );
  } else if (action === "qualify") {
    requireStatus(mission, "qualifying", "run qualification");
    const candidates = state.supplierCandidates.filter(candidate => candidate.missionId === id);
    if (!candidates.length) throw httpError(409, "Cannot qualify a mission with no discovered suppliers");
    const evaluatedAt = new Date().toISOString();
    state.supplierCandidates = state.supplierCandidates.map(candidate => (
      candidate.missionId === id ? qualifySupplier(mission, candidate, evaluatedAt) : candidate
    ));
    mission.status = transitionMission(mission.status, "qualification_complete");
    mission.updatedAt = evaluatedAt;
    mission.execution = {
      ...(mission.execution || {}),
      qualificationMode: "deterministic-rules",
      lastRunAt: evaluatedAt
    };
    const evaluated = state.supplierCandidates.filter(candidate => candidate.missionId === id);
    const qualified = evaluated.filter(candidate => candidate.status === "qualified").length;
    const rejected = evaluated.filter(candidate => candidate.status === "rejected").length;
    const review = evaluated.filter(candidate => candidate.status === "needs_review").length;
    addActivity(id, "qualify", "Qualification completed", `${qualified} qualified · ${review} need review · ${rejected} rejected. Qualified suppliers are ready for outreach.`);
  } else {
    throw httpError(400, `Unsupported mission action: ${action || "missing"}`);
  }

  const currentDashboard = await persist();
  return { mission: missionSnapshot(id), dashboard: currentDashboard };
}

export async function handleRequest(req, res) {
  try {
    for (const [name, value] of Object.entries(securityHeaders)) res.setHeader(name, value);
    const url = new URL(req.url, "http://localhost");
    const isApiMutation = url.pathname.startsWith("/api/") && !["GET", "HEAD", "OPTIONS"].includes(req.method);
    if (isApiMutation && !isSameOriginRequest(req)) return json(res, 403, { error: "Cross-origin mutation denied" });
    if (isApiMutation && !allowMutation(req)) { res.setHeader("Retry-After", "60"); return json(res, 429, { error: "Too many mutation requests" }); }
    if (req.method === "OPTIONS" && url.pathname.startsWith("/api/")) { res.writeHead(204, { Allow: "GET,HEAD,POST,OPTIONS" }); return res.end(); }

    if (url.pathname === "/health") return json(res, 200, { status: "ok", service: "vendor-scout", mode: state.meta.mode, persistence: store.kind, contractVersion: state.meta.contractVersion, now: new Date().toISOString() });
    if (url.pathname === "/api/dashboard" && req.method === "GET") return json(res, 200, dashboard());
    if (url.pathname === "/api/capabilities" && req.method === "GET") return json(res, 200, capabilities());

    const actionMatch = url.pathname.match(/^\/api\/missions\/([^/]+)\/actions$/);
    if (actionMatch && req.method === "POST") {
      if (!isAgentAuthorized(req)) return json(res, configuredAgentToken ? 401 : 503, { error: configuredAgentToken ? "Agent authorization required" : "Agent mutation API is disabled until VENDOR_SCOUT_AGENT_TOKEN is configured" });
      const id = decodeURIComponent(actionMatch[1]);
      const body = await readJsonBody(req);
      const result = await serializeMutation(() => executeMissionAction(id, body.action));
      return json(res, 200, result);
    }

    const missionMatch = url.pathname.match(/^\/api\/missions\/([^/]+)$/);
    if (missionMatch && req.method === "GET") {
      const id = decodeURIComponent(missionMatch[1]);
      const snapshot = missionSnapshot(id);
      if (!snapshot) return json(res, 404, { error: "Sourcing mission not found" });
      return json(res, 200, snapshot);
    }

    if (url.pathname === "/api/dev/reset" && req.method === "POST") {
      if (!devResetEnabled) return json(res, 404, { error: "Not found" });
      if (!isAgentAuthorized(req)) return json(res, configuredAgentToken ? 401 : 503, { error: configuredAgentToken ? "Agent authorization required" : "Development reset is disabled" });
      const body = await readJsonBody(req);
      const stage = body.stage || "draft";
      const resetDashboard = await serializeMutation(async () => {
        state = createSeed({ missionStage: stage });
        return persist();
      });
      return json(res, 200, resetDashboard);
    }

    if (req.method !== "GET" && req.method !== "HEAD") return json(res, 404, { error: "Not found" });
    const relative = url.pathname === "/" ? "index.html" : decodeURIComponent(url.pathname.slice(1));
    const file = resolve(publicRoot, relative);
    if (!file.startsWith(`${publicRoot}${sep}`)) return json(res, 403, { error: "Forbidden" });
    const extension = extname(file).toLowerCase();
    const content = await readFile(file);
    res.writeHead(200, { "Content-Type": types[extension] || "application/octet-stream", "Cache-Control": extension === ".html" ? "no-store" : "public, max-age=3600" });
    if (req.method === "HEAD") return res.end();
    res.end(content);
  } catch (error) {
    if (error.code === "ENOENT") return json(res, 404, { error: "Not found" });
    if (error.status) return json(res, error.status, { error: error.message });
    console.error(error);
    json(res, 500, { error: "Internal server error" });
  }
}

const server = http.createServer(handleRequest);
server.listen(port, () => console.log(`Vendor Scout listening on http://localhost:${port}`));
