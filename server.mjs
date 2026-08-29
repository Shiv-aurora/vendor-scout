import http from "node:http";
import { timingSafeEqual } from "node:crypto";
import { readFile } from "node:fs/promises";
import { extname, join, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { createSeed } from "./lib/seed.mjs";
import { discoverSuppliers, normalizeDiscoveredCandidates } from "./lib/discovery.mjs";
import { qualifySupplier, transitionMission, validateMission } from "./lib/domain.mjs";
import { handleMcpMessage, PROCUREMENT_MCP_TOOLS } from "./lib/mcp.mjs";
import { migrateState } from "./lib/migrations.mjs";
import {
  createRfqConversation,
  deliverRfq,
  isExternallyAccepted,
  outboundRfqMessage,
  recordSupplierReply
} from "./lib/outreach.mjs";
import { createDemoStore } from "./lib/store.mjs";
import { missionTurnPrompt, summarizeTurn, TrueForgeClient } from "./lib/trueforge.mjs";

const root = fileURLToPath(new URL(".", import.meta.url));
const publicRoot = join(root, "public");
const port = Number(process.env.PORT || 3000);
const isProduction = process.env.NODE_ENV === "production";
const configuredAgentToken = process.env.VENDOR_SCOUT_AGENT_TOKEN || "";
const configuredMcpToken = process.env.VENDOR_SCOUT_MCP_TOKEN || configuredAgentToken;
const allowFixtureFallback = !isProduction || process.env.VENDOR_SCOUT_ALLOW_FIXTURE_FALLBACK === "1";
const allowOutreachPreview = !isProduction || process.env.VENDOR_SCOUT_ALLOW_OUTREACH_PREVIEW === "1";
const devResetEnabled = !isProduction || process.env.VENDOR_SCOUT_ENABLE_DEV_RESET === "1";
const trueForge = new TrueForgeClient();

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

function requestBearerToken(req) {
  const header = req.headers.authorization || "";
  return header.startsWith("Bearer ") ? header.slice(7) : "";
}

function isAuthorized(req, expectedToken) {
  if (!isProduction && !expectedToken) return true;
  if (!expectedToken) return false;
  return safeTokenEquals(requestBearerToken(req), expectedToken);
}

function isAgentAuthorized(req) {
  return isAuthorized(req, configuredAgentToken);
}

function isMcpAuthorized(req) {
  return isAuthorized(req, configuredMcpToken);
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

function conversationHasExternalContact(conversation) {
  return conversation.messages.some(message => message.direction === "inbound" || isExternallyAccepted(message));
}

function capabilities() {
  return {
    agentMutationsEnabled: !isProduction || Boolean(configuredAgentToken),
    browserMutationsEnabled: !isProduction && !configuredAgentToken,
    discoveryProvider: process.env.VENDOR_SCOUT_DISCOVERY_URL ? "remote" : allowFixtureFallback ? "controlled-fixture" : "unconfigured",
    fixtureFallbackEnabled: allowFixtureFallback,
    outreach: {
      provider: process.env.VENDOR_SCOUT_OUTREACH_URL ? "remote" : allowOutreachPreview ? "controlled-preview" : "unconfigured",
      previewEnabled: allowOutreachPreview
    },
    devResetEnabled,
    mcp: {
      enabled: !isProduction || Boolean(configuredMcpToken),
      endpoint: "/mcp",
      toolCount: PROCUREMENT_MCP_TOOLS.length
    },
    trueForge: {
      configured: trueForge.configured,
      endpoint: trueForge.safeEndpoint,
      agentName: trueForge.configured ? trueForge.agentName : null
    }
  };
}

function dashboard() {
  const activeMissions = state.missions.filter(mission => !["completed", "rejected"].includes(mission.status));
  const qualified = state.supplierCandidates.filter(candidate => candidate.status === "qualified");
  const negotiationsActive = state.conversations.filter(conversation => ["supplier_replied", "negotiating"].includes(conversation.status)).length;
  const approvalsWaiting = state.approvals.filter(approval => approval.status === "pending").length;
  const projectedSavings = Math.max(0, ...qualified.map(candidate => candidate.projectedSavings || 0));
  const contacted = new Set(state.conversations.filter(conversationHasExternalContact).map(conversation => conversation.supplierId));

  return {
    ...state,
    meta: { ...state.meta, persistence: store.kind },
    capabilities: capabilities(),
    summary: {
      activeMissions: activeMissions.length,
      suppliersDiscovered: state.supplierCandidates.length,
      suppliersQualified: qualified.length,
      suppliersContacted: contacted.size,
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

function requireTrueForgeConfigured() {
  if (!trueForge.configured) throw httpError(503, "TrueForge is not configured; set TRUEFORGE_BASE_URL and TRUEFORGE_AGENT_NAME");
}

function prepareRfqConversations(mission) {
  const qualified = state.supplierCandidates.filter(candidate => candidate.missionId === mission.id && candidate.status === "qualified");
  if (!qualified.length) throw httpError(409, "No qualified suppliers are available for outreach");
  const existing = new Map(state.conversations.filter(conversation => conversation.missionId === mission.id).map(conversation => [conversation.supplierId, conversation]));
  let created = 0;
  for (const candidate of qualified) {
    if (existing.has(candidate.id)) continue;
    const conversation = createRfqConversation(mission, candidate);
    state.conversations.push(conversation);
    existing.set(candidate.id, conversation);
    created += 1;
  }
  return { qualified, conversations: [...existing.values()].filter(conversation => qualified.some(candidate => candidate.id === conversation.supplierId)), created };
}

async function sendPreparedOutreach(mission) {
  const { qualified, conversations, created } = prepareRfqConversations(mission);
  if (created) {
    addActivity(mission.id, "contact", `${created} RFQ draft${created === 1 ? "" : "s"} prepared`, "Drafts request pricing tiers, MOQ, availability, lead time, shipping, sample terms, certifications, and technical confirmation without making a purchase commitment.");
    await persist();
  }

  const candidateById = new Map(qualified.map(candidate => [candidate.id, candidate]));
  let externallyAccepted = 0;
  let previewed = 0;
  let failed = 0;
  let missingContact = 0;

  for (const conversation of conversations) {
    const candidate = candidateById.get(conversation.supplierId);
    const message = outboundRfqMessage(conversation);
    if (!candidate || !message) continue;
    if (isExternallyAccepted(message)) {
      externallyAccepted += 1;
      continue;
    }
    if (!message.to) {
      conversation.status = "missing_contact";
      missingContact += 1;
      continue;
    }

    message.delivery.status = "sending";
    message.delivery.attemptedAt = new Date().toISOString();
    message.delivery.error = null;
    conversation.status = "sending";
    conversation.updatedAt = message.delivery.attemptedAt;
    await persist();

    try {
      const delivery = await deliverRfq({ mission, candidate, conversation, message }, { allowControlledPreview: allowOutreachPreview });
      message.delivery = {
        ...message.delivery,
        status: delivery.status,
        provider: delivery.provider,
        externalMessageId: delivery.externalMessageId,
        deliveredAt: delivery.deliveredAt,
        error: null
      };
      conversation.status = delivery.simulated ? "previewed" : "rfq_sent";
      conversation.updatedAt = new Date().toISOString();
      if (delivery.simulated) previewed += 1;
      else externallyAccepted += 1;
    } catch (error) {
      message.delivery.status = "failed";
      message.delivery.error = String(error.message || error).slice(0, 2000);
      conversation.status = "delivery_failed";
      conversation.updatedAt = new Date().toISOString();
      failed += 1;
    }
    await persist();
  }

  const allQualifiedExternallyContacted = conversations.length > 0 && conversations.every(conversation => isExternallyAccepted(outboundRfqMessage(conversation)));
  if (allQualifiedExternallyContacted && mission.status === "contacting") {
    mission.status = transitionMission(mission.status, "outreach_complete");
    mission.updatedAt = new Date().toISOString();
    addActivity(mission.id, "contact", "Supplier outreach completed", `${externallyAccepted} qualified supplier${externallyAccepted === 1 ? "" : "s"} accepted an RFQ through the configured external transport. The mission can now continue with supplier replies and negotiation.`);
  } else {
    addActivity(mission.id, "contact", "Supplier outreach checkpoint", `${externallyAccepted} externally accepted · ${previewed} controlled preview · ${missingContact} missing contact · ${failed} failed. Controlled previews do not advance the mission to negotiation.`);
  }
  await persist();
  return missionSnapshot(mission.id);
}

async function recordMissionSupplierReply(missionId, supplierId, payload) {
  const mission = state.missions.find(item => item.id === missionId);
  if (!mission) throw httpError(404, "Sourcing mission not found");
  const conversation = state.conversations.find(item => item.missionId === missionId && item.supplierId === supplierId);
  if (!conversation) throw httpError(404, "Supplier conversation not found");
  recordSupplierReply(conversation, payload);
  if (mission.status === "contacting" && conversationHasExternalContact(conversation)) {
    mission.status = transitionMission(mission.status, "outreach_complete");
    mission.updatedAt = new Date().toISOString();
  }
  addActivity(missionId, "conversation", `Supplier reply recorded from ${conversation.supplierName}`, "The reply was persisted with source provenance for later term extraction and negotiation.");
  await persist();
  return missionSnapshot(missionId);
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
  } else if (action === "prepare_outreach") {
    requireStatus(mission, "contacting", "prepare outreach");
    const result = prepareRfqConversations(mission);
    if (result.created) addActivity(id, "contact", `${result.created} RFQ draft${result.created === 1 ? "" : "s"} prepared`, "RFQs are non-binding and request the complete commercial and technical quote packet.");
  } else if (action === "send_outreach") {
    requireStatus(mission, "contacting", "send outreach");
    return { mission: await sendPreparedOutreach(mission), dashboard: dashboard() };
  } else if (action === "connect_trueforge") {
    requireTrueForgeConfigured();
    if (!mission.trueForge?.sessionId) {
      const session = await trueForge.createSession();
      mission.trueForge = {
        sessionId: session.id,
        agentName: trueForge.agentName,
        endpoint: trueForge.safeEndpoint,
        connectedAt: new Date().toISOString(),
        lastTurn: null
      };
      mission.updatedAt = mission.trueForge.connectedAt;
      addActivity(id, "agent", "TrueForge session connected", `Persistent session ${session.id} is bound to the ${trueForge.agentName} agent.`);
    } else {
      await trueForge.getSession(mission.trueForge.sessionId);
      mission.trueForge.lastVerifiedAt = new Date().toISOString();
      addActivity(id, "agent", "TrueForge session verified", `Persistent session ${mission.trueForge.sessionId} is still available.`);
    }
  } else if (action === "start_trueforge_turn") {
    requireTrueForgeConfigured();
    if (!mission.trueForge?.sessionId) throw httpError(409, "Connect a TrueForge session before starting a turn");
    if (mission.trueForge.lastTurn?.status === "running") throw httpError(409, "A TrueForge turn is already running for this mission");
    const suppliers = state.supplierCandidates.filter(candidate => candidate.missionId === id);
    const activity = state.activity.filter(item => item.missionId === id);
    const turn = await trueForge.createTurn(mission.trueForge.sessionId, missionTurnPrompt(mission, { suppliers, activity }));
    const summary = summarizeTurn(turn);
    mission.trueForge.lastTurn = { ...summary, startedAt: new Date().toISOString(), syncedAt: new Date().toISOString() };
    mission.updatedAt = mission.trueForge.lastTurn.startedAt;
    addActivity(id, "agent", "TrueForge turn started", `Turn ${summary.id} started in persistent session ${mission.trueForge.sessionId}.`);
  } else if (action === "sync_trueforge_turn") {
    requireTrueForgeConfigured();
    const lastTurn = mission.trueForge?.lastTurn;
    if (!mission.trueForge?.sessionId || !lastTurn?.id) throw httpError(409, "No TrueForge turn exists for this mission");
    const turn = await trueForge.getTurn(mission.trueForge.sessionId, lastTurn.id);
    const summary = summarizeTurn(turn);
    const previousStatus = lastTurn.status;
    mission.trueForge.lastTurn = {
      ...lastTurn,
      ...summary,
      syncedAt: new Date().toISOString()
    };
    mission.updatedAt = mission.trueForge.lastTurn.syncedAt;
    if (summary.status !== previousStatus) {
      const required = summary.requiredActions.length ? ` · ${summary.requiredActions.length} action${summary.requiredActions.length === 1 ? "" : "s"} require attention` : "";
      addActivity(id, "agent", `TrueForge turn ${summary.status}`, `Turn ${summary.id} changed from ${previousStatus} to ${summary.status}${required}.`);
    }
  } else {
    throw httpError(400, `Unsupported mission action: ${action || "missing"}`);
  }

  const currentDashboard = await persist();
  return { mission: missionSnapshot(id), dashboard: currentDashboard };
}

async function mcpDiscoverMission(id) {
  return serializeMutation(async () => {
    let mission = state.missions.find(item => item.id === id);
    if (!mission) throw httpError(404, "Sourcing mission not found");
    if (mission.status === "draft") await executeMissionAction(id, "start");
    mission = state.missions.find(item => item.id === id);
    if (mission.status === "discovering") return (await executeMissionAction(id, "discover")).mission;
    if (["qualifying", "contacting", "negotiating", "comparing", "awaiting_approval", "approved", "completed"].includes(mission.status)) return missionSnapshot(id);
    throw httpError(409, `Supplier discovery is not available while mission status is ${mission.status}`);
  });
}

async function mcpRecordSuppliers(id, candidates) {
  return serializeMutation(async () => {
    let mission = state.missions.find(item => item.id === id);
    if (!mission) throw httpError(404, "Sourcing mission not found");
    const missionErrors = validateMission(mission);
    if (missionErrors.length) throw httpError(422, `Mission is invalid: ${missionErrors.join("; ")}`);
    if (mission.status === "draft") {
      await executeMissionAction(id, "start");
      mission = state.missions.find(item => item.id === id);
    }
    if (!new Set(["discovering", "qualifying"]).has(mission.status)) {
      throw httpError(409, `Live supplier research can only be recorded during discovery or qualification; mission status is ${mission.status}`);
    }

    const normalized = normalizeDiscoveredCandidates(mission, candidates, "trueforge-research");
    const existing = state.supplierCandidates.filter(candidate => candidate.missionId === id);
    const merged = new Map(existing.map(candidate => [candidate.id, candidate]));
    for (const candidate of normalized) merged.set(candidate.id, candidate);
    state.supplierCandidates = [
      ...state.supplierCandidates.filter(candidate => candidate.missionId !== id),
      ...merged.values()
    ];

    if (mission.status === "discovering") mission.status = transitionMission(mission.status, "discovery_complete");
    mission.updatedAt = new Date().toISOString();
    mission.execution = {
      ...(mission.execution || {}),
      discoveryProvider: "trueforge-tools",
      fallbackUsed: false,
      providerError: null,
      lastRunAt: mission.updatedAt
    };
    addActivity(id, "discover", `${normalized.length} researched supplier candidate${normalized.length === 1 ? "" : "s"} recorded`, "TrueForge research was persisted with explicit source provenance. Missing commercial fields remain unverified rather than inferred.");
    await persist();
    return missionSnapshot(id);
  });
}

async function mcpQualifyMission(id) {
  return serializeMutation(async () => {
    const mission = state.missions.find(item => item.id === id);
    if (!mission) throw httpError(404, "Sourcing mission not found");
    if (mission.status === "qualifying") return (await executeMissionAction(id, "qualify")).mission;
    if (["contacting", "negotiating", "comparing", "awaiting_approval", "approved", "completed"].includes(mission.status)) return missionSnapshot(id);
    throw httpError(409, `Supplier qualification requires completed discovery; mission status is ${mission.status}`);
  });
}

async function mcpPrepareOutreach(id) {
  return serializeMutation(async () => {
    const mission = state.missions.find(item => item.id === id);
    if (!mission) throw httpError(404, "Sourcing mission not found");
    if (mission.status !== "contacting") {
      if (["negotiating", "comparing", "awaiting_approval", "approved", "completed"].includes(mission.status)) return missionSnapshot(id);
      throw httpError(409, `RFQ preparation requires qualified suppliers; mission status is ${mission.status}`);
    }
    const result = prepareRfqConversations(mission);
    if (result.created) addActivity(id, "contact", `${result.created} RFQ draft${result.created === 1 ? "" : "s"} prepared`, "RFQ drafts are non-binding and remain attached to the sourcing mission.");
    await persist();
    return missionSnapshot(id);
  });
}

async function mcpSendOutreach(id) {
  return serializeMutation(async () => {
    const mission = state.missions.find(item => item.id === id);
    if (!mission) throw httpError(404, "Sourcing mission not found");
    if (mission.status === "contacting") return sendPreparedOutreach(mission);
    if (["negotiating", "comparing", "awaiting_approval", "approved", "completed"].includes(mission.status)) return missionSnapshot(id);
    throw httpError(409, `Supplier outreach requires the contacting stage; mission status is ${mission.status}`);
  });
}

async function mcpRecordReply(id, supplierId, payload) {
  return serializeMutation(() => recordMissionSupplierReply(id, supplierId, payload));
}

const mcpContext = {
  getMission: async id => missionSnapshot(id),
  discoverSuppliers: mcpDiscoverMission,
  recordSuppliers: mcpRecordSuppliers,
  qualifySuppliers: mcpQualifyMission,
  prepareOutreach: mcpPrepareOutreach,
  sendOutreach: mcpSendOutreach,
  recordReply: mcpRecordReply
};

export async function handleRequest(req, res) {
  try {
    for (const [name, value] of Object.entries(securityHeaders)) res.setHeader(name, value);
    const url = new URL(req.url, "http://localhost");

    if (url.pathname === "/mcp") {
      if (req.method === "GET") {
        res.writeHead(405, { Allow: "POST, OPTIONS" });
        return res.end();
      }
      if (req.method === "OPTIONS") {
        res.writeHead(204, { Allow: "POST, OPTIONS" });
        return res.end();
      }
      if (req.method !== "POST") return json(res, 405, { error: "Method not allowed" });
      if (!isMcpAuthorized(req)) return json(res, configuredMcpToken ? 401 : 503, { error: configuredMcpToken ? "MCP authorization required" : "MCP is disabled until VENDOR_SCOUT_MCP_TOKEN or VENDOR_SCOUT_AGENT_TOKEN is configured" });
      if (!allowMutation(req)) { res.setHeader("Retry-After", "60"); return json(res, 429, { error: "Too many MCP requests" }); }
      const message = await readJsonBody(req, 256 * 1024);
      const response = await handleMcpMessage(message, mcpContext);
      if (response === null) {
        res.writeHead(202, { "Cache-Control": "no-store" });
        return res.end();
      }
      return json(res, 200, response);
    }

    const isApiMutation = url.pathname.startsWith("/api/") && !["GET", "HEAD", "OPTIONS"].includes(req.method);
    if (isApiMutation && !isSameOriginRequest(req)) return json(res, 403, { error: "Cross-origin mutation denied" });
    if (isApiMutation && !allowMutation(req)) { res.setHeader("Retry-After", "60"); return json(res, 429, { error: "Too many mutation requests" }); }
    if (req.method === "OPTIONS" && url.pathname.startsWith("/api/")) { res.writeHead(204, { Allow: "GET,HEAD,POST,OPTIONS" }); return res.end(); }

    if (url.pathname === "/health") return json(res, 200, { status: "ok", service: "vendor-scout", mode: state.meta.mode, persistence: store.kind, contractVersion: state.meta.contractVersion, trueForgeConfigured: trueForge.configured, mcpEnabled: capabilities().mcp.enabled, now: new Date().toISOString() });
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

    const replyMatch = url.pathname.match(/^\/api\/missions\/([^/]+)\/suppliers\/([^/]+)\/reply$/);
    if (replyMatch && req.method === "POST") {
      if (!isAgentAuthorized(req)) return json(res, configuredAgentToken ? 401 : 503, { error: configuredAgentToken ? "Agent authorization required" : "Agent mutation API is disabled until VENDOR_SCOUT_AGENT_TOKEN is configured" });
      const missionId = decodeURIComponent(replyMatch[1]);
      const supplierId = decodeURIComponent(replyMatch[2]);
      const body = await readJsonBody(req, 128 * 1024);
      const snapshot = await serializeMutation(() => recordMissionSupplierReply(missionId, supplierId, body));
      return json(res, 200, snapshot);
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
