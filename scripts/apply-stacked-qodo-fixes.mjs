import { readFile, writeFile } from "node:fs/promises";

async function edit(path, transform) {
  const before = await readFile(path, "utf8");
  const after = transform(before);
  if (after === before) throw new Error(`No change produced for ${path}`);
  await writeFile(path, after);
}

function replaceOnce(source, from, to, label) {
  const first = source.indexOf(from);
  if (first < 0) throw new Error(`Missing patch anchor: ${label}`);
  if (source.indexOf(from, first + from.length) >= 0) throw new Error(`Patch anchor is not unique: ${label}`);
  return source.slice(0, first) + to + source.slice(first + from.length);
}

await edit("lib/mcp.mjs", source => {
  source = replaceOnce(
    source,
    'const DEFAULT_PROTOCOL_VERSION = "2025-06-18";\n',
    'const DEFAULT_PROTOCOL_VERSION = "2025-06-18";\nconst SUPPORTED_PROTOCOL_VERSIONS = new Set([DEFAULT_PROTOCOL_VERSION]);\n',
    "supported MCP versions"
  );
  source = replaceOnce(
    source,
    'function supplierIdFrom(args) { if (typeof args.supplierId !== "string" || !args.supplierId.trim()) throw new Error("supplierId is required"); return args.supplierId.trim(); }\n',
    `function supplierIdFrom(args) { if (typeof args.supplierId !== "string" || !args.supplierId.trim()) throw new Error("supplierId is required"); return args.supplierId.trim(); }\nconst CANDIDATE_ARGUMENT_KEYS = new Set(Object.keys(candidateSchema.properties));\nfunction validateCandidateBatch(value) {\n  if (!Array.isArray(value) || value.length === 0) throw new Error("candidates array is required");\n  if (value.length > 50) throw new Error("candidates may contain no more than 50 entries");\n  return value.map((candidate, index) => {\n    if (!candidate || typeof candidate !== "object" || Array.isArray(candidate)) throw new Error(\`candidates[\${index}] must be an object\`);\n    for (const key of Object.keys(candidate)) {\n      if (!CANDIDATE_ARGUMENT_KEYS.has(key)) throw new Error(\`candidates[\${index}] contains unsupported property \${key}\`);\n    }\n    for (const key of candidateSchema.required) {\n      if (!Object.hasOwn(candidate, key)) throw new Error(\`candidates[\${index}] is missing required property \${key}\`);\n    }\n    return candidate;\n  });\n}\n`,
    "candidate argument validation"
  );
  source = replaceOnce(
    source,
    `export async function handleMcpMessage(message, context) {\n  if (!message || message.jsonrpc !== "2.0" || typeof message.method !== "string") return rpcError(message?.id, -32600, "Invalid Request");\n  if (message.method === "notifications/initialized") return null;\n  if (message.method === "initialize") {\n    const requestedVersion = message.params?.protocolVersion;\n    return rpcResult(message.id, {\n      protocolVersion: typeof requestedVersion === "string" && requestedVersion ? requestedVersion : DEFAULT_PROTOCOL_VERSION,`,
    `export async function handleMcpMessage(message, context) {\n  if (!message || message.jsonrpc !== "2.0" || typeof message.method !== "string") return rpcError(message?.id, -32600, "Invalid Request");\n  const isNotification = !Object.hasOwn(message, "id");\n  if (isNotification) return null;\n  if (message.method === "initialize") {\n    const requestedVersion = message.params?.protocolVersion;\n    return rpcResult(message.id, {\n      protocolVersion: SUPPORTED_PROTOCOL_VERSIONS.has(requestedVersion) ? requestedVersion : DEFAULT_PROTOCOL_VERSION,`,
    "MCP notification/version handling"
  );
  source = replaceOnce(
    source,
    `    if (name === "vendor_scout_record_supplier_candidates") {\n      if (!Array.isArray(args.candidates)) throw new Error("candidates array is required");\n      return rpcResult(message.id, toolResult(await context.recordSuppliers(missionId, args.candidates), "Recorded supplier research:"));\n    }`,
    `    if (name === "vendor_scout_record_supplier_candidates") {\n      const candidates = validateCandidateBatch(args.candidates);\n      return rpcResult(message.id, toolResult(await context.recordSuppliers(missionId, candidates), "Recorded supplier research:"));\n    }`,
    "candidate runtime schema enforcement"
  );
  return source;
});

await edit("lib/discovery.mjs", source => {
  source = replaceOnce(
    source,
    `const EMAIL_PATTERN = /^[^\\s@]+@[^\\s@]+\\.[^\\s@]+$/;\n`,
    `const EMAIL_PATTERN = /^[^\\s@]+@[^\\s@]+\\.[^\\s@]+$/;\n\nasync function readBoundedDiscoveryJson(response) {\n  const declaredHeader = response.headers.get("content-length");\n  const declared = declaredHeader == null ? null : Number(declaredHeader);\n  if (Number.isFinite(declared) && declared > MAX_REMOTE_RESPONSE_BYTES) {\n    await response.body?.cancel().catch(() => {});\n    throw new Error("Discovery provider response is too large");\n  }\n  const chunks = [];\n  let totalBytes = 0;\n  if (response.body) {\n    const reader = response.body.getReader();\n    try {\n      while (true) {\n        const { done, value } = await reader.read();\n        if (done) break;\n        totalBytes += value.byteLength;\n        if (totalBytes > MAX_REMOTE_RESPONSE_BYTES) {\n          await reader.cancel("Discovery provider response exceeded size limit").catch(() => {});\n          throw new Error("Discovery provider response is too large");\n        }\n        chunks.push(Buffer.from(value));\n      }\n    } finally {\n      try { reader.releaseLock(); } catch {}\n    }\n  }\n  const raw = Buffer.concat(chunks, totalBytes).toString("utf8");\n  try { return JSON.parse(raw); } catch { throw new Error("Discovery provider returned invalid JSON"); }\n}\n`,
    "bounded discovery response reader"
  );
  source = replaceOnce(
    source,
    `  if (typeof email !== "string" || !EMAIL_PATTERN.test(email.trim())) throw new Error(\`Discovery result \${index + 1} has invalid contact email\`);\n  const sourceReference = candidate.contact?.sourceReference || candidate.contactSourceReference || reference;\n  if (typeof sourceReference !== "string" || !sourceReference.trim()) throw new Error(\`Discovery result \${index + 1} contact requires source provenance\`);\n  return { email: email.trim().toLowerCase(), sourceReference: sourceReference.trim() };`,
    `  if (typeof email !== "string" || !EMAIL_PATTERN.test(email.trim())) throw new Error(\`Discovery result \${index + 1} has invalid contact email\`);\n  const normalizedEmail = email.trim().toLowerCase();\n  const domain = normalizedEmail.slice(normalizedEmail.lastIndexOf("@") + 1);\n  if (domain.endsWith(".")) throw new Error(\`Discovery result \${index + 1} has invalid contact email\`);\n  const sourceReference = candidate.contact?.sourceReference || candidate.contactSourceReference || reference;\n  if (typeof sourceReference !== "string" || !sourceReference.trim()) throw new Error(\`Discovery result \${index + 1} contact requires source provenance\`);\n  return { email: normalizedEmail, sourceReference: sourceReference.trim() };`,
    "trailing-dot email validation"
  );
  source = replaceOnce(
    source,
    `  return {\n    id: candidate.id || stableCandidateId(mission.id, candidate.name.trim(), reference.trim()),`,
    `  const preserveFixtureIdentity = sourceKind === "controlled-fixture" && typeof candidate.id === "string" && candidate.id.trim();\n  return {\n    id: preserveFixtureIdentity ? candidate.id.trim() : stableCandidateId(mission.id, candidate.name.trim(), reference.trim()),`,
    "server-derived candidate identity"
  );
  source = replaceOnce(
    source,
    `    source: {\n      kind: candidate.source?.kind || sourceKind,\n      reference: reference.trim()\n    }`,
    `    source: {\n      kind: sourceKind,\n      reference: reference.trim()\n    }`,
    "trusted source kind"
  );
  source = replaceOnce(
    source,
    `  if (!response.ok) throw new Error(\`Discovery provider returned \${response.status}\`);\n  const declaredLength = Number(response.headers.get("content-length") || 0);\n  if (declaredLength > MAX_REMOTE_RESPONSE_BYTES) throw new Error("Discovery provider response is too large");\n  const raw = await response.text();\n  if (Buffer.byteLength(raw) > MAX_REMOTE_RESPONSE_BYTES) throw new Error("Discovery provider response is too large");\n  let payload;\n  try { payload = JSON.parse(raw); } catch { throw new Error("Discovery provider returned invalid JSON"); }`,
    `  if (!response.ok) throw new Error(\`Discovery provider returned \${response.status}\`);\n  const payload = await readBoundedDiscoveryJson(response);`,
    "stream discovery response"
  );
  return source;
});

await edit("lib/trueforge.mjs", source => {
  source = replaceOnce(
    source,
    `async function readJsonResponse(response) {\n  const declaredLength = Number(response.headers.get("content-length") || 0);\n  if (declaredLength > MAX_RESPONSE_BYTES) throw new Error("TrueForge response is too large");\n  const raw = await response.text();\n  if (Buffer.byteLength(raw) > MAX_RESPONSE_BYTES) throw new Error("TrueForge response is too large");\n  let payload = {};\n  if (raw) {\n    try { payload = JSON.parse(raw); } catch { throw new Error("TrueForge returned invalid JSON"); }\n  }`,
    `async function readJsonResponse(response) {\n  const declaredHeader = response.headers.get("content-length");\n  const declared = declaredHeader == null ? null : Number(declaredHeader);\n  if (Number.isFinite(declared) && declared > MAX_RESPONSE_BYTES) {\n    await response.body?.cancel().catch(() => {});\n    throw new Error("TrueForge response is too large");\n  }\n  const chunks = [];\n  let totalBytes = 0;\n  if (response.body) {\n    const reader = response.body.getReader();\n    try {\n      while (true) {\n        const { done, value } = await reader.read();\n        if (done) break;\n        totalBytes += value.byteLength;\n        if (totalBytes > MAX_RESPONSE_BYTES) {\n          await reader.cancel("TrueForge response exceeded size limit").catch(() => {});\n          throw new Error("TrueForge response is too large");\n        }\n        chunks.push(Buffer.from(value));\n      }\n    } finally {\n      try { reader.releaseLock(); } catch {}\n    }\n  }\n  const raw = Buffer.concat(chunks, totalBytes).toString("utf8");\n  let payload = {};\n  if (raw) {\n    try { payload = JSON.parse(raw); } catch { throw new Error("TrueForge returned invalid JSON"); }\n  }`,
    "bounded TrueForge response"
  );
  return source;
});

await edit("lib/outreach.mjs", source => {
  source = replaceOnce(
    source,
    `const RESERVED_DEMO_EMAIL = /@[^@]+\\.example$/i;\n`,
    `function isReservedDemoEmail(value) {\n  if (typeof value !== "string") return false;\n  const at = value.lastIndexOf("@");\n  if (at < 0) return false;\n  const domain = value.slice(at + 1).trim().toLowerCase().replace(/\\.+$/, "");\n  return domain === "example" || domain.endsWith(".example");\n}\n\nfunction normalizeIsoTimestamp(value, field = "timestamp") {\n  if (value == null) return new Date().toISOString();\n  if (typeof value !== "string" || !value.trim()) throw new Error(\`${field} must be a valid ISO timestamp or null\`);\n  const parsed = new Date(value);\n  if (Number.isNaN(parsed.getTime())) throw new Error(\`${field} must be a valid ISO timestamp or null\`);\n  return parsed.toISOString();\n}\n`,
    "reserved email/timestamp helpers"
  );
  source = replaceOnce(
    source,
    `export function recordSupplierReply(conversation, { content, sourceReference, providerMessageId, receivedAt = new Date().toISOString() }) {\n  if (typeof content !== "string" || !content.trim()) throw new Error("Supplier reply content is required");\n  if (typeof sourceReference !== "string" || !sourceReference.trim()) throw new Error("Supplier reply sourceReference is required");\n  const normalizedContent = content.trim().slice(0, 100_000);`,
    `export function recordSupplierReply(conversation, { content, sourceReference, providerMessageId, receivedAt = null }) {\n  if (typeof content !== "string" || !content.trim()) throw new Error("Supplier reply content is required");\n  if (typeof sourceReference !== "string" || !sourceReference.trim()) throw new Error("Supplier reply sourceReference is required");\n  const timestamp = normalizeIsoTimestamp(receivedAt, "receivedAt");\n  const normalizedContent = content.trim().slice(0, 100_000);`,
    "supplier reply timestamp validation"
  );
  source = replaceOnce(source, `    createdAt: receivedAt\n  });\n  conversation.status = "supplier_replied";\n  conversation.updatedAt = receivedAt;`, `    createdAt: timestamp\n  });\n  conversation.status = "supplier_replied";\n  conversation.updatedAt = timestamp;`, "normalized reply timestamp persistence");
  source = replaceOnce(
    source,
    `async function readProviderJson(response) {\n  const declared = Number(response.headers.get("content-length") || 0);\n  if (declared > MAX_PROVIDER_RESPONSE_BYTES) throw new Error("Outreach provider response is too large");\n  const raw = await response.text();\n  if (Buffer.byteLength(raw) > MAX_PROVIDER_RESPONSE_BYTES) throw new Error("Outreach provider response is too large");\n  let payload = {};\n  if (raw) {\n    try { payload = JSON.parse(raw); } catch { throw new Error("Outreach provider returned invalid JSON"); }\n  }`,
    `async function readProviderJson(response) {\n  const declaredHeader = response.headers.get("content-length");\n  const declared = declaredHeader == null ? null : Number(declaredHeader);\n  if (Number.isFinite(declared) && declared > MAX_PROVIDER_RESPONSE_BYTES) {\n    await response.body?.cancel().catch(() => {});\n    throw new Error("Outreach provider response is too large");\n  }\n  const chunks = [];\n  let totalBytes = 0;\n  if (response.body) {\n    const reader = response.body.getReader();\n    try {\n      while (true) {\n        const { done, value } = await reader.read();\n        if (done) break;\n        totalBytes += value.byteLength;\n        if (totalBytes > MAX_PROVIDER_RESPONSE_BYTES) {\n          await reader.cancel("Outreach provider response exceeded size limit").catch(() => {});\n          throw new Error("Outreach provider response is too large");\n        }\n        chunks.push(Buffer.from(value));\n      }\n    } finally {\n      try { reader.releaseLock(); } catch {}\n    }\n  }\n  const raw = Buffer.concat(chunks, totalBytes).toString("utf8");\n  let payload = {};\n  if (raw) {\n    try { payload = JSON.parse(raw); } catch { throw new Error("Outreach provider returned invalid JSON"); }\n  }`,
    "bounded outreach provider response"
  );
  source = replaceOnce(source, `  if (RESERVED_DEMO_EMAIL.test(message.to)) throw new Error("Controlled .example supplier contacts cannot be sent through an external outreach provider");`, `  if (isReservedDemoEmail(message.to)) throw new Error("Controlled .example supplier contacts cannot be sent through an external outreach provider");`, "reserved demo email check");
  source = replaceOnce(
    source,
    `  const payload = await readProviderJson(response);\n  const status = String(payload.status || "accepted").toLowerCase();\n  if (!PROVIDER_SUCCESS_STATUSES.has(status)) throw new Error(\`Outreach provider returned unsupported delivery status: \${status}\`);`,
    `  const payload = await readProviderJson(response);\n  if (typeof payload.status !== "string" || !payload.status.trim()) throw new Error("Outreach provider response is missing delivery status");\n  const status = payload.status.trim().toLowerCase();\n  if (!PROVIDER_SUCCESS_STATUSES.has(status)) throw new Error(\`Outreach provider returned unsupported delivery status: \${status}\`);`,
    "explicit provider delivery status"
  );
  return source;
});

await edit("lib/negotiation.mjs", source => {
  source = replaceOnce(
    source,
    `export function latestOffer(conversation) {\n  const offers = conversation?.negotiation?.offers || [];\n  return offers.length ? offers[offers.length - 1] : null;\n}\n\nfunction sameCurrencyCompetitorBenchmark(offer, competitorOffers) {\n  if (!offer?.currency) return null;\n  const prices = competitorOffers\n    .filter(candidate => candidate?.currency === offer.currency && Number.isFinite(candidate.unitPrice))\n    .map(candidate => candidate.unitPrice);\n  return prices.length ? Math.min(...prices) : null;\n}`,
    `export function latestOffer(conversation) {\n  const offers = conversation?.negotiation?.offers || [];\n  return offers.length ? offers[offers.length - 1] : null;\n}\n\nfunction effectiveOfferPrice(offer, quantity) {\n  const applicable = (offer?.quantityTiers || []).filter(tier => tier.minQuantity <= quantity).sort((a, b) => b.minQuantity - a.minQuantity)[0] || null;\n  if (applicable) return { value: applicable.unitPrice, basis: \`quantity-tier-\${applicable.minQuantity}\`, tier: applicable };\n  if (Number.isFinite(offer?.unitPrice)) return { value: offer.unitPrice, basis: "stated-unit-price", tier: null };\n  return { value: null, basis: "missing", tier: null };\n}\n\nfunction sameCurrencyCompetitorBenchmark(offer, competitorOffers, quantity) {\n  if (!offer?.currency) return null;\n  const prices = competitorOffers\n    .filter(candidate => candidate?.currency === offer.currency)\n    .map(candidate => effectiveOfferPrice(candidate, quantity).value)\n    .filter(Number.isFinite);\n  return prices.length ? Math.min(...prices) : null;\n}\n\nfunction evaluationSignature(evaluation) {\n  return createHash("sha256").update(JSON.stringify({\n    offerId: evaluation.offerId, supplierId: evaluation.supplierId, targetCurrency: evaluation.targetCurrency, competitorBenchmark: evaluation.competitorBenchmark,\n    effectiveUnitPrice: evaluation.effectiveUnitPrice, priceBasis: evaluation.priceBasis, priceTier: evaluation.priceTier, gaps: evaluation.gaps, missingFields: evaluation.missingFields\n  })).digest("hex").slice(0, 18);\n}`,
    "effective negotiation pricing"
  );
  source = replaceOnce(
    source,
    `  const targetCurrency = mission.currentSupplier?.currency || "USD";\n  const benchmark = sameCurrencyCompetitorBenchmark(offer, competitorOffers);\n\n  if (!Number.isFinite(offer.unitPrice)) missingFields.push("unitPrice");\n  else if (offer.currency === targetCurrency) {\n    const desired = benchmark == null ? mission.constraints.targetUnitPrice : Math.min(mission.constraints.targetUnitPrice, benchmark);\n    if (offer.unitPrice > desired) {\n      gaps.push({\n        field: "unitPrice",\n        priority: "high",\n        offered: offer.unitPrice,`,
    `  const targetCurrency = mission.currentSupplier?.currency || "USD";\n  const price = effectiveOfferPrice(offer, mission.quantity);\n  const benchmark = sameCurrencyCompetitorBenchmark(offer, competitorOffers, mission.quantity);\n\n  if (!offer.currency) missingFields.push("currency");\n  else if (offer.currency !== targetCurrency) gaps.push({ field: "currency", priority: "high", offered: offer.currency, target: targetCurrency, reason: \`pricing currency is not comparable to mission target currency \${targetCurrency}\` });\n  if (!Number.isFinite(price.value)) missingFields.push("unitPrice");\n  else if (offer.currency === targetCurrency) {\n    const desired = benchmark == null ? mission.constraints.targetUnitPrice : Math.min(mission.constraints.targetUnitPrice, benchmark);\n    if (price.value > desired) {\n      gaps.push({\n        field: "unitPrice",\n        priority: "high",\n        offered: price.value,`,
    "currency/tier price evaluation"
  );
  source = replaceOnce(
    source,
    `    competitorBenchmark: benchmark,\n    gaps,\n    missingFields`,
    `    competitorBenchmark: benchmark,\n    effectiveUnitPrice: price.value,\n    priceBasis: price.basis,\n    priceTier: price.tier,\n    gaps,\n    missingFields`,
    "evaluation price provenance"
  );
  source = replaceOnce(
    source,
    `    if (gap.field === "unitPrice") asks.push(\`Improve unit pricing to \${money(gap.target, gap.currency)} or better for \${mission.quantity} units.\`);\n    if (gap.field === "moq")`,
    `    if (gap.field === "unitPrice") asks.push(\`Improve unit pricing to \${money(gap.target, gap.currency)} or better for \${mission.quantity} units.\`);\n    if (gap.field === "currency") asks.push(\`Quote pricing in \${gap.target} so the offer can be compared against the mission target.\`);\n    if (gap.field === "moq")`,
    "currency counter ask"
  );
  source = replaceOnce(
    source,
    `  if (missing.has("unitPrice")) asks.push(\`Confirm unit pricing for \${mission.quantity} units and any relevant quantity tiers.\`);\n  if (missing.has("moq"))`,
    `  if (missing.has("currency")) asks.push(\`Confirm the pricing currency and provide pricing in \${targetCurrencyFor(mission)}.\`);\n  if (missing.has("unitPrice")) asks.push(\`Confirm unit pricing for \${mission.quantity} units and any relevant quantity tiers.\`);\n  if (missing.has("moq"))`,
    "missing currency counter ask"
  );
  source = replaceOnce(
    source,
    `  const id = stableId("msg", conversation.id, "counter", offer.id, String(round));\n  return {`,
    `  const signature = evaluationSignature(evaluation);\n  const id = stableId("msg", conversation.id, "counter", offer.id, String(round), signature);\n  return {`,
    "counter versioned identity"
  );
  source = replaceOnce(
    source,
    `    basedOnOfferId: offer.id,\n    negotiationRound: round,`,
    `    basedOnOfferId: offer.id,\n    evaluationSignature: signature,\n    negotiationRound: round,`,
    "persist counter evidence signature"
  );
  source = replaceOnce(
    source,
    `      idempotencyKey: stableId("counter", mission.id, candidate.id, offer.id, String(round)),`,
    `      idempotencyKey: stableId("counter", mission.id, candidate.id, offer.id, String(round), signature),`,
    "counter idempotency version"
  );
  source = replaceOnce(
    source,
    `  const existing = conversation.messages.find(message => message.type === "counter" && message.basedOnOfferId === offer.id);\n  if (existing) return { evaluation, message: existing };\n  const message = buildCounterMessage(mission, candidate, conversation, evaluation);`,
    `  const signature = evaluationSignature(evaluation);\n  const existing = conversation.messages.find(message => message.type === "counter" && message.basedOnOfferId === offer.id && message.evaluationSignature === signature);\n  if (existing) return { evaluation, message: existing };\n  for (const message of conversation.messages) {\n    if (message.type === "counter" && message.basedOnOfferId === offer.id && message.delivery?.status === "draft") {\n      message.delivery.status = "superseded";\n      message.supersededAt = new Date().toISOString();\n    }\n  }\n  const message = buildCounterMessage(mission, candidate, conversation, evaluation);`,
    "stale counter invalidation"
  );
  return source;
});

await edit("server.mjs", source => {
  source = replaceOnce(
    source,
    `  recordSupplierReply(conversation, payload);\n  if (mission.status === "contacting" && conversationHasExternalContact(conversation)) {\n    mission.status = transitionMission(mission.status, "outreach_complete");\n    mission.updatedAt = new Date().toISOString();\n  }\n  addActivity(missionId, "conversation", \`Supplier reply recorded from \${conversation.supplierName}\`, "The reply was persisted with source provenance for later term extraction and negotiation.");\n  await persist();`,
    `  const beforeCount = conversation.messages.length;\n  recordSupplierReply(conversation, payload);\n  const inserted = conversation.messages.length > beforeCount;\n  if (inserted && mission.status === "contacting" && conversationHasExternalContact(conversation)) {\n    mission.status = transitionMission(mission.status, "outreach_complete");\n    mission.updatedAt = new Date().toISOString();\n  }\n  if (inserted) addActivity(missionId, "conversation", \`Supplier reply recorded from \${conversation.supplierName}\`, "The reply was persisted with source provenance for later term extraction and negotiation.");\n  await persist();`,
    "idempotent reply activity"
  );
  source = replaceOnce(
    source,
    `  const message = prepared.message;\n  if (!message) {\n    await persist();\n    return missionSnapshot(missionId);\n  }`,
    `  const message = prepared.message;\n  if (!message) {\n    mission.execution = {\n      ...(mission.execution || {}),\n      negotiationReady: state.conversations.some(item => item.missionId === missionId && item.status === "offer_ready") || prepared.evaluation.status === "ready_for_comparison",\n      lastNegotiationAt: new Date().toISOString()\n    };\n    if (prepared.evaluation.status === "ready_for_comparison") {\n      addActivity(missionId, "negotiation", \`\${conversation.supplierName} offer is ready for comparison\`, "No counter was generated because the persisted offer has no unresolved negotiation gap. Vendor Scout has not accepted the terms.");\n    } else if (prepared.evaluation.status === "reject_recommended") {\n      addActivity(missionId, "negotiation", \`\${conversation.supplierName} requires human judgment\`, "The supplier explicitly failed a critical technical confirmation, so autonomous countering stopped.");\n    }\n    await persist();\n    return missionSnapshot(missionId);\n  }`,
    "direct-send readiness effects"
  );
  source = replaceOnce(
    source,
    `    if (mission.status === "draft") {\n      await executeMissionAction(id, "start");\n      mission = state.missions.find(item => item.id === id);\n    }\n    if (!new Set(["discovering", "qualifying"]).has(mission.status)) {\n      throw httpError(409, \`Live supplier research can only be recorded during discovery or qualification; mission status is \${mission.status}\`);\n    }\n\n    const normalized = normalizeDiscoveredCandidates(mission, candidates, "trueforge-research");`,
    `    const normalized = normalizeDiscoveredCandidates(mission, candidates, "trueforge-research");\n    if (mission.status === "draft") {\n      await executeMissionAction(id, "start");\n      mission = state.missions.find(item => item.id === id);\n    }\n    if (!new Set(["discovering", "qualifying"]).has(mission.status)) {\n      throw httpError(409, \`Live supplier research can only be recorded during discovery or qualification; mission status is \${mission.status}\`);\n    }`,
    "atomic researched supplier validation"
  );
  return source;
});

const regressionTest = String.raw`import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { spawn } from "node:child_process";
import { mkdtemp } from "node:fs/promises";
import net from "node:net";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { handleMcpMessage } from "../lib/mcp.mjs";
import { TrueForgeClient } from "../lib/trueforge.mjs";
import { createSeed } from "../lib/seed.mjs";
import { createRfqConversation, deliverRfq, outboundRfqMessage, recordSupplierReply } from "../lib/outreach.mjs";
import { evaluateOffer, prepareCounter, recordOfferTerms } from "../lib/negotiation.mjs";

const root = fileURLToPath(new URL("..", import.meta.url));
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

async function freePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const { port } = server.address();
      server.close(error => error ? reject(error) : resolve(port));
    });
  });
}

async function startRuntime(t) {
  const directory = await mkdtemp(join(tmpdir(), "vendor-scout-qodo-stack-"));
  const port = await freePort();
  const child = spawn(process.execPath, ["server.mjs"], { cwd: root, env: { ...process.env, PORT: String(port), NODE_ENV: "development", VENDOR_SCOUT_DATA_PATH: join(directory, "runtime.json"), VENDOR_SCOUT_AGENT_TOKEN: "", VENDOR_SCOUT_MCP_TOKEN: "", TRUEFORGE_BASE_URL: "" }, stdio: ["ignore", "pipe", "pipe"] });
  let diagnostics = "";
  child.stdout.on("data", chunk => { diagnostics += chunk; });
  child.stderr.on("data", chunk => { diagnostics += chunk; });
  const baseUrl = `http://127.0.0.1:${port}`;
  for (let attempt = 0; attempt < 60; attempt += 1) {
    if (child.exitCode != null) throw new Error(`Server exited: ${diagnostics}`);
    try { if ((await fetch(`${baseUrl}/health`)).ok) break; } catch {}
    await sleep(50);
  }
  t.after(() => { if (child.exitCode == null) child.kill("SIGTERM"); });
  return { baseUrl };
}

async function postJson(url, body) {
  const response = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json", Accept: "application/json" }, body: JSON.stringify(body) });
  const payload = response.status === 202 ? null : await response.json();
  return { response, payload };
}

function liveFixture() {
  const state = createSeed({ missionStage: "contacting" });
  const mission = state.missions[0];
  const candidate = structuredClone(state.supplierCandidates.find(item => item.status === "qualified"));
  candidate.contact = { email: "rfq@supplier.test", sourceReference: "https://supplier.test/contact" };
  const conversation = createRfqConversation(mission, candidate, "2026-08-29T12:00:00.000Z");
  recordSupplierReply(conversation, { content: "Offer", sourceReference: "gmail/message/offer", providerMessageId: "offer", receivedAt: "2026-08-29T13:00:00Z" });
  return { mission, candidate, conversation };
}

test("MCP rejects unsupported protocol versions and never executes id-less tool calls", async () => {
  let mutations = 0;
  const context = { recordSuppliers: async () => { mutations += 1; return {}; } };
  const initialized = await handleMcpMessage({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2099-01-01" } }, context);
  assert.equal(initialized.result.protocolVersion, "2025-06-18");
  const notification = await handleMcpMessage({ jsonrpc: "2.0", method: "tools/call", params: { name: "vendor_scout_record_supplier_candidates", arguments: { missionId: "m", candidates: [] } } }, context);
  assert.equal(notification, null);
  assert.equal(mutations, 0);
});

test("MCP candidate schema rejects caller-controlled identity and provenance metadata", async () => {
  let called = false;
  const result = await handleMcpMessage({ jsonrpc: "2.0", id: 2, method: "tools/call", params: { name: "vendor_scout_record_supplier_candidates", arguments: { missionId: "m", candidates: [{ id: "spoof", name: "A", country: "US", region: "North America", type: "Manufacturer", confidence: .9, specMatch: .9, sourceReference: "ref" }] } } }, { recordSuppliers: async () => { called = true; } });
  assert.equal(result.result.isError, true);
  assert.match(result.result.content[0].text, /unsupported property id/);
  assert.equal(called, false);
});

test("failed researched-supplier ingestion leaves a draft mission unchanged", async t => {
  const runtime = await startRuntime(t);
  await postJson(`${runtime.baseUrl}/api/dev/reset`, { stage: "draft" });
  const call = await postJson(`${runtime.baseUrl}/mcp`, { jsonrpc: "2.0", id: 3, method: "tools/call", params: { name: "vendor_scout_record_supplier_candidates", arguments: { missionId: "mission-lidar-500", candidates: [{ name: "Bad", country: "US", region: "North America", type: "Manufacturer", confidence: 2, specMatch: .9, sourceReference: "ref" }] } } });
  assert.equal(call.payload.result.isError, true);
  const mission = await fetch(`${runtime.baseUrl}/api/missions/mission-lidar-500`).then(r => r.json());
  assert.equal(mission.mission.status, "draft");
  assert.equal(mission.activity.some(item => item.title === "Mission started"), false);
});

test("TrueForge rejects oversized chunked responses before full buffering", async t => {
  const server = http.createServer((req, res) => {
    res.writeHead(200, { "Content-Type": "application/json", "Transfer-Encoding": "chunked" });
    res.write('{"data":{"id":"');
    for (let i = 0; i < 40; i += 1) res.write("x".repeat(65536));
    res.end('"}}');
  });
  await new Promise((resolve, reject) => { server.once("error", reject); server.listen(0, "127.0.0.1", resolve); });
  t.after(() => new Promise(resolve => server.close(resolve)));
  const { port } = server.address();
  const client = new TrueForgeClient({ baseUrl: `http://127.0.0.1:${port}`, agentName: "vendor-scout" });
  await assert.rejects(client.createSession(), /response is too large/);
});

test("outreach requires explicit success status and bounds chunked responses", async t => {
  const { mission, candidate, conversation } = liveFixture();
  const message = outboundRfqMessage(conversation);
  let mode = "missing";
  const server = http.createServer((req, res) => {
    res.writeHead(200, { "Content-Type": "application/json", "Transfer-Encoding": "chunked" });
    if (mode === "missing") return res.end("{}");
    res.write('{"status":"accepted","pad":"');
    for (let i = 0; i < 8; i += 1) res.write("x".repeat(65536));
    res.end('"}');
  });
  await new Promise((resolve, reject) => { server.once("error", reject); server.listen(0, "127.0.0.1", resolve); });
  t.after(() => new Promise(resolve => server.close(resolve)));
  const { port } = server.address();
  await assert.rejects(deliverRfq({ mission, candidate, conversation, message }, { url: `http://127.0.0.1:${port}`, allowControlledPreview: false }), /missing delivery status/);
  mode = "large";
  await assert.rejects(deliverRfq({ mission, candidate, conversation, message }, { url: `http://127.0.0.1:${port}`, allowControlledPreview: false }), /response is too large/);
});

test("trailing-dot .example contacts never reach a live outreach provider", async t => {
  let requests = 0;
  const server = http.createServer((req, res) => { requests += 1; res.writeHead(200, { "Content-Type": "application/json" }); res.end('{"status":"accepted"}'); });
  await new Promise((resolve, reject) => { server.once("error", reject); server.listen(0, "127.0.0.1", resolve); });
  t.after(() => new Promise(resolve => server.close(resolve)));
  const { port } = server.address();
  const { mission, candidate } = liveFixture();
  candidate.contact.email = "sales@supplier.example.";
  const conversation = createRfqConversation(mission, candidate);
  await assert.rejects(deliverRfq({ mission, candidate, conversation, message: outboundRfqMessage(conversation) }, { url: `http://127.0.0.1:${port}`, allowControlledPreview: false }), /\.example supplier contacts/);
  assert.equal(requests, 0);
});

test("supplier reply timestamps are validated and normalized", () => {
  const { conversation } = liveFixture();
  assert.throws(() => recordSupplierReply(conversation, { content: "x", sourceReference: "ref-2", receivedAt: { bad: true } }), /receivedAt must be a valid ISO timestamp/);
  recordSupplierReply(conversation, { content: "x", sourceReference: "ref-2", providerMessageId: "two", receivedAt: "2026-08-29T15:00:00Z" });
  assert.equal(conversation.messages.at(-1).createdAt, "2026-08-29T15:00:00.000Z");
});

test("replayed supplier replies do not duplicate activity", async t => {
  const runtime = await startRuntime(t);
  await postJson(`${runtime.baseUrl}/api/dev/reset`, { stage: "contacting" });
  await postJson(`${runtime.baseUrl}/mcp`, { jsonrpc: "2.0", id: 4, method: "tools/call", params: { name: "vendor_scout_prepare_rfqs", arguments: { missionId: "mission-lidar-500" } } });
  const reply = { jsonrpc: "2.0", method: "tools/call", params: { name: "vendor_scout_record_supplier_reply", arguments: { missionId: "mission-lidar-500", supplierId: "supplier-heliomotion", content: "same", sourceReference: "gmail/same", providerMessageId: "same", receivedAt: "2026-08-29T16:00:00Z" } };
  await postJson(`${runtime.baseUrl}/mcp`, { ...reply, id: 5 });
  await postJson(`${runtime.baseUrl}/mcp`, { ...reply, id: 6 });
  const mission = await fetch(`${runtime.baseUrl}/api/missions/mission-lidar-500`).then(r => r.json());
  assert.equal(mission.activity.filter(item => item.title.includes("Supplier reply recorded from HelioMotion Optics")).length, 1);
});

test("negotiation requires comparable currency and accepts applicable tier pricing", () => {
  const { mission, candidate, conversation } = liveFixture();
  let offer = recordOfferTerms(conversation, { sourceReference: "gmail/message/offer", unitPrice: 380, currency: "EUR", moq: 100, leadTimeDays: 18, shippingTerms: "DDP", sampleAvailable: true, samplePrice: 100, technicalConfirmed: true });
  let evaluation = evaluateOffer(mission, candidate, offer);
  assert.equal(evaluation.status, "counter_required");
  assert.equal(evaluation.gaps.some(gap => gap.field === "currency"), true);
  const counter = prepareCounter(mission, candidate, conversation);
  assert.match(counter.message.content, /Quote pricing in USD/);

  offer = recordOfferTerms(conversation, { sourceReference: "gmail/message/offer", unitPrice: null, currency: "USD", quantityTiers: [{ minQuantity: 100, unitPrice: 410 }, { minQuantity: 500, unitPrice: 385 }], moq: 100, leadTimeDays: 18, shippingTerms: "DDP", sampleAvailable: true, samplePrice: 100, technicalConfirmed: true });
  evaluation = evaluateOffer(mission, candidate, offer);
  assert.equal(evaluation.effectiveUnitPrice, 385);
  assert.equal(evaluation.priceBasis, "quantity-tier-500");
  assert.equal(evaluation.missingFields.includes("unitPrice"), false);
  assert.equal(evaluation.status, "ready_for_comparison");
});

test("changed extraction supersedes a stale unsent counter", () => {
  const { mission, candidate, conversation } = liveFixture();
  recordOfferTerms(conversation, { sourceReference: "gmail/message/offer", unitPrice: 410, currency: "USD", moq: 100, leadTimeDays: 18, shippingTerms: "DDP", sampleAvailable: true, samplePrice: 100, technicalConfirmed: true });
  const first = prepareCounter(mission, candidate, conversation).message;
  recordOfferTerms(conversation, { sourceReference: "gmail/message/offer", unitPrice: 405, currency: "USD", moq: 100, leadTimeDays: 18, shippingTerms: "DDP", sampleAvailable: true, samplePrice: 100, technicalConfirmed: true });
  const second = prepareCounter(mission, candidate, conversation).message;
  assert.notEqual(second.id, first.id);
  assert.notEqual(second.delivery.idempotencyKey, first.delivery.idempotencyKey);
  assert.equal(first.delivery.status, "superseded");
});

test("direct counter send persists negotiation readiness when no counter is needed", async t => {
  const runtime = await startRuntime(t);
  await postJson(`${runtime.baseUrl}/api/dev/reset`, { stage: "negotiating" });
  const reply = { content: "ready offer", sourceReference: "gmail/ready", providerMessageId: "ready", receivedAt: "2026-08-29T17:00:00Z" };
  await postJson(`${runtime.baseUrl}/api/missions/mission-lidar-500/suppliers/supplier-heliomotion/reply`, reply);
  await postJson(`${runtime.baseUrl}/api/missions/mission-lidar-500/suppliers/supplier-heliomotion/offer`, { sourceReference: "gmail/ready", unitPrice: 385, currency: "USD", moq: 100, leadTimeDays: 18, shippingTerms: "DDP", shippingCost: 700, sampleAvailable: true, samplePrice: 180, technicalConfirmed: true });
  const result = await postJson(`${runtime.baseUrl}/api/missions/mission-lidar-500/suppliers/supplier-heliomotion/counter`, { action: "send" });
  assert.equal(result.response.status, 200);
  assert.equal(result.payload.mission.execution.negotiationReady, true);
  assert.equal(result.payload.conversations.find(item => item.supplierId === "supplier-heliomotion").status, "offer_ready");
});
`;
await writeFile("test/qodo-stack-regressions.test.mjs", regressionTest);
console.log("Applied stacked Qodo remediation and regression coverage.");
