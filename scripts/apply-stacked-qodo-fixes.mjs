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

console.log("Applied stacked Qodo remediation.");
