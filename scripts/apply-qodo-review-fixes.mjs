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

await edit("lib/quotes.mjs", source => {
  source = replaceOnce(
    source,
    `  const effective = effectiveUnitPrice(offer, mission.quantity);\n  const orderQuantity = Math.max(mission.quantity, Number.isFinite(offer.moq) ? offer.moq : mission.quantity);`,
    `  const orderQuantity = Math.max(mission.quantity, Number.isFinite(offer.moq) ? offer.moq : mission.quantity);\n  const effective = effectiveUnitPrice(offer, orderQuantity);`,
    "MOQ-aware tier selection"
  );
  source = replaceOnce(
    source,
    `  const savingsBeforeShippingBase = Number.isFinite(effectiveUnitPriceBase)\n    ? round(baselineTotalBase - effectiveUnitPriceBase * mission.quantity)\n    : null;`,
    `  const savingsBeforeShippingBase = Number.isFinite(itemSubtotalBase)\n    ? round(baselineTotalBase - itemSubtotalBase)\n    : null;`,
    "MOQ-aware pre-shipping savings"
  );
  return source;
});

await edit("lib/approval.mjs", source => {
  source = replaceOnce(
    source,
    `export function buildApprovalPacket(mission, recommendation, quote, supplier, competingQuotes = [], now = new Date().toISOString()) {`,
    `export function buildApprovalPacket(mission, recommendation, quote, supplier, competingQuotes = [], now = new Date().toISOString(), cycle = 1) {`,
    "approval cycle argument"
  );
  source = replaceOnce(
    source,
    `        budgetBase: mission.constraints.sampleBudget,\n        withinBudget: true\n      }`,
    `        budgetBase: mission.constraints.sampleBudget,\n        withinBudget: true,\n        executable: true\n      }`,
    "executable sample action"
  );
  source = replaceOnce(
    source,
    `        budgetBase: mission.constraints.sampleBudget,\n        withinBudget: false\n      };`,
    `        budgetBase: mission.constraints.sampleBudget,\n        withinBudget: false,\n        executable: false\n      };`,
    "non-executable supplier progression"
  );
  source = replaceOnce(
    source,
    `    id: stableId("approval", mission.id, recommendation.id, quote.id),\n    missionId: mission.id,`,
    `    id: stableId("approval", mission.id, recommendation.id, quote.id, String(cycle)),\n    cycle,\n    missionId: mission.id,`,
    "cycle-specific approval id"
  );
  source = replaceOnce(
    source,
    `  if (!["approve", "negotiate_more", "reject"].includes(decision)) throw new Error("Approval decision must be approve, negotiate_more, or reject");\n  approval.status = decision === "approve" ? "approved" : decision === "reject" ? "rejected" : "returned_to_negotiation";`,
    `  if (!["approve", "negotiate_more", "reject"].includes(decision)) throw new Error("Approval decision must be approve, negotiate_more, or reject");\n  if (decision === "approve" && (approval.action?.kind !== "order_sample" || approval.action?.withinBudget !== true)) {\n    throw new Error("Approval action is not executable");\n  }\n  approval.status = decision === "approve" ? "approved" : decision === "reject" ? "rejected" : "returned_to_negotiation";`,
    "prevent approving non-executable action"
  );
  return source;
});

await edit("lib/orders.mjs", source => {
  source = replaceOnce(
    source,
    `async function readBoundedJson(response) {\n  const declared = Number(response.headers.get("content-length") || 0);\n  if (declared > MAX_RESPONSE_BYTES) throw new Error("Sample-order provider response is too large");\n  const raw = await response.text();\n  if (Buffer.byteLength(raw) > MAX_RESPONSE_BYTES) throw new Error("Sample-order provider response is too large");\n  let payload = {};\n  if (raw) {\n    try { payload = JSON.parse(raw); } catch { throw new Error("Sample-order provider returned invalid JSON"); }\n  }\n  if (!response.ok) throw new Error(String(payload?.error || payload?.message || \`Sample-order provider returned \${response.status}\`));\n  return payload;\n}`,
    `async function readBoundedJson(response) {\n  const declaredHeader = response.headers.get("content-length");\n  const declared = declaredHeader == null ? null : Number(declaredHeader);\n  if (Number.isFinite(declared) && declared > MAX_RESPONSE_BYTES) {\n    await response.body?.cancel().catch(() => {});\n    throw new Error("Sample-order provider response is too large");\n  }\n\n  const chunks = [];\n  let totalBytes = 0;\n  if (response.body) {\n    const reader = response.body.getReader();\n    try {\n      while (true) {\n        const { done, value } = await reader.read();\n        if (done) break;\n        totalBytes += value.byteLength;\n        if (totalBytes > MAX_RESPONSE_BYTES) {\n          await reader.cancel("Sample-order provider response exceeded size limit").catch(() => {});\n          throw new Error("Sample-order provider response is too large");\n        }\n        chunks.push(Buffer.from(value));\n      }\n    } finally {\n      try { reader.releaseLock(); } catch {}\n    }\n  }\n\n  const raw = Buffer.concat(chunks, totalBytes).toString("utf8");\n  let payload = {};\n  if (raw) {\n    try { payload = JSON.parse(raw); } catch { throw new Error("Sample-order provider returned invalid JSON"); }\n  }\n  if (!response.ok) throw new Error(String(payload?.error || payload?.message || \`Sample-order provider returned \${response.status}\`));\n  return payload;\n}`,
    "incremental bounded provider response"
  );
  source = replaceOnce(
    source,
    `  const samplePrice = quote.sample?.basePrice;\n  if (quote.sample?.available !== true || !Number.isFinite(samplePrice)) throw new Error("Recommended quote does not contain an orderable sample price");\n  if (samplePrice > mission.constraints.sampleBudget) throw new Error("Sample price exceeds the mission sample budget");\n\n  return {`,
    `  const samplePrice = quote.sample?.basePrice;\n  const approvedSamplePrice = approval.action?.estimatedSpendBase;\n  if (quote.sample?.available !== true || !Number.isFinite(samplePrice)) throw new Error("Recommended quote does not contain an orderable sample price");\n  if (!Number.isFinite(approvedSamplePrice) || approval.action?.withinBudget !== true) throw new Error("Human approval does not contain an executable sample spend");\n  if (quote.baseCurrency !== approval.action.currency) throw new Error("Sample currency no longer matches the human-approved action; fresh approval required");\n  if (Math.abs(samplePrice - approvedSamplePrice) > 1e-9) throw new Error("Sample price no longer matches the human-approved spend; fresh approval required");\n  if (approvedSamplePrice > mission.constraints.sampleBudget) throw new Error("Sample price exceeds the mission sample budget");\n\n  return {`,
    "approval snapshot enforcement"
  );
  source = replaceOnce(
    source,
    `    quantity: approval.action.quantity || 1,\n    unitPriceBase: samplePrice,\n    totalBase: samplePrice * (approval.action.quantity || 1),`,
    `    quantity: approval.action.quantity || 1,\n    unitPriceBase: approvedSamplePrice,\n    totalBase: approvedSamplePrice * (approval.action.quantity || 1),`,
    "order uses approved spend"
  );
  return source;
});

await edit("server.mjs", source => {
  source = replaceOnce(
    source,
    `      id: quote.id,\n      sourceOfferId: quote.sourceOfferId,\n      fx: quote.fx,\n      knownTotal: quote.knownTotal,\n      landedCost: quote.landedCost,\n      score: quote.score,\n      rank: quote.rank`,
    `      id: quote.id,\n      sourceOfferId: quote.sourceOfferId,\n      sourceMessageId: quote.sourceMessageId,\n      sourceReference: quote.sourceReference,\n      fx: quote.fx,\n      quantity: quote.quantity,\n      orderQuantity: quote.orderQuantity,\n      overbuyUnits: quote.overbuyUnits,\n      unitPrice: quote.unitPrice,\n      itemSubtotal: quote.itemSubtotal,\n      shipping: quote.shipping,\n      knownTotal: quote.knownTotal,\n      landedCost: quote.landedCost,\n      leadTimeDays: quote.leadTimeDays,\n      moq: quote.moq,\n      sample: quote.sample,\n      certifications: quote.certifications,\n      technicalConfirmed: quote.technicalConfirmed,\n      supplierRiskScore: quote.supplierRiskScore,\n      evidence: quote.evidence,\n      completeness: quote.completeness,\n      economics: quote.economics,\n      score: quote.score,\n      rank: quote.rank,\n      comparison: quote.comparison`,
    "material quote evidence signature"
  );
  source = replaceOnce(
    source,
    `  const packet = buildApprovalPacket(mission, analysis.recommendation, quote, supplier, analysis.quotes);\n  const existing = state.approvals.find(item => item.id === packet.id);\n  if (existing) return existing;\n  state.approvals = [...state.approvals.filter(item => item.missionId !== mission.id || item.status !== "pending"), packet];`,
    `  const matchingApprovals = state.approvals.filter(item => (\n    item.missionId === mission.id &&\n    item.recommendationId === analysis.recommendation.id &&\n    item.quoteId === quote.id\n  ));\n  const existingPending = matchingApprovals.find(item => item.status === "pending");\n  if (existingPending) {\n    if (mission.status === "comparing") mission.status = transitionMission(mission.status, "analysis_complete");\n    return existingPending;\n  }\n  const cycle = matchingApprovals.length + 1;\n  const packet = buildApprovalPacket(mission, analysis.recommendation, quote, supplier, analysis.quotes, new Date().toISOString(), cycle);\n  state.approvals = [...state.approvals.filter(item => item.missionId !== mission.id || item.status !== "pending"), packet];`,
    "reuse only pending approval and create new cycle"
  );
  source = replaceOnce(
    source,
    `  const approval = state.approvals.find(item => item.missionId === missionId && item.status === "pending");\n  if (!approval) throw httpError(409, "No pending approval exists for this mission");\n  applyApprovalDecision(approval, decision);`,
    `  const approval = state.approvals.find(item => item.missionId === missionId && item.status === "pending");\n  if (!approval) throw httpError(409, "No pending approval exists for this mission");\n  if (decision === "approve" && (approval.action?.kind !== "order_sample" || approval.action?.withinBudget !== true)) {\n    throw httpError(409, "The recommended action does not contain an orderable in-budget sample; choose Keep negotiating or Reject");\n  }\n  applyApprovalDecision(approval, decision);`,
    "server-side non-executable approval guard"
  );
  return source;
});

await edit("public/app.js", source => {
  source = replaceOnce(
    source,
    `function decisionButtonMarkup(localActions, status, approval) {\n  if (!localActions || status !== "awaiting_approval" || approval?.status !== "pending") return "";\n  return \`<div class="decision-actions"><button class="primary-button" data-approval-decision="approve">Approve sample</button><button class="button light" data-approval-decision="negotiate_more">Keep negotiating</button><button class="button danger-button" data-approval-decision="reject">Reject</button></div>\`;\n}`,
    `function decisionButtonMarkup(localActions, status, approval) {\n  if (!localActions || status !== "awaiting_approval" || approval?.status !== "pending") return "";\n  const canApproveSample = approval.action?.kind === "order_sample" && approval.action?.withinBudget === true;\n  const approve = canApproveSample ? '<button class="primary-button" data-approval-decision="approve">Approve sample</button>' : "";\n  const warning = canApproveSample ? "" : '<div class="evidence-warning">No orderable sample is currently available within budget. Keep negotiating or reject this recommendation.</div>';\n  return \`<div class="decision-actions">\${approve}<button class="button light" data-approval-decision="negotiate_more">Keep negotiating</button><button class="button danger-button" data-approval-decision="reject">Reject</button></div>\${warning}\`;\n}`,
    "approval button availability"
  );
  source = replaceOnce(
    source,
    `  } else if (approval?.status === "pending") {\n    decisionState = \`<article class="panel decision-state pending-decision"><span class="provider-pill live">Human decision required</span><h2>Approve one controlled next step.</h2><p>The agent has finished the research, negotiation, and comparison work. No terms have been accepted and no money has been spent.</p>\${decisionButtons}</article>\`;`,
    `  } else if (approval?.status === "pending") {\n    const canApproveSample = approval.action?.kind === "order_sample" && approval.action?.withinBudget === true;\n    decisionState = \`<article class="panel decision-state pending-decision"><span class="provider-pill live">Human decision required</span><h2>\${canApproveSample ? "Approve one controlled next step." : "Sample action is not currently orderable."}</h2><p>\${canApproveSample ? "The agent has finished the research, negotiation, and comparison work. No terms have been accepted and no money has been spent." : "The recommendation remains visible, but Vendor Scout will not allow an approval that has no executable in-budget sample action."}</p>\${decisionButtons}</article>\`;`,
    "pending approval copy"
  );
  return source;
});

await edit("test/quotes.test.mjs", source => {
  const anchor = `test("missing shipping remains visibly incomplete instead of being treated as zero landed cost", () => {`;
  const addition = `test("MOQ-constrained order quantity selects the tier actually purchased", () => {\n  const { mission, candidates } = fixture();\n  const candidate = candidates[0];\n  const conversation = readyConversation({\n    mission,\n    candidate,\n    source: "overbuy-tier",\n    unitPrice: 320,\n    moq: 700,\n    quantityTiers: [\n      { minQuantity: 500, unitPrice: 300 },\n      { minQuantity: 700, unitPrice: 280 }\n    ],\n    requireReady: false\n  });\n  conversation.status = "offer_ready";\n  conversation.negotiation.latestEvaluation.status = "ready_for_comparison";\n  const quote = normalizeQuote(mission, candidate, conversation);\n  assert.equal(quote.orderQuantity, 700);\n  assert.equal(quote.unitPrice.original, 280);\n  assert.equal(quote.unitPrice.basis, "quantity-tier-700");\n  assert.equal(quote.itemSubtotal.base, 196000);\n});\n\ntest("pre-shipping savings includes mandatory MOQ overbuy when shipping is unknown", () => {\n  const { mission, candidates } = fixture();\n  const candidate = candidates[0];\n  const conversation = readyConversation({ mission, candidate, source: "overbuy-no-shipping", moq: 700, unitPrice: 300, shippingCost: null, requireReady: false });\n  conversation.status = "offer_ready";\n  conversation.negotiation.latestEvaluation.status = "ready_for_comparison";\n  const quote = normalizeQuote(mission, candidate, conversation);\n  assert.equal(quote.itemSubtotal.base, 210000);\n  assert.equal(quote.economics.estimatedLandedSavingsBase, null);\n  assert.equal(quote.economics.savingsBeforeShippingBase, 4500);\n});\n\n`;
  if (!source.includes(anchor)) throw new Error("Missing quotes test insertion anchor");
  return source.replace(anchor, addition + anchor);
});

await edit("test/approval-order.test.mjs", source => {
  const decisionAnchor = `test("sample order refuses execution before the mission and human decision are approved", () => {`;
  const decisionTests = `test("non-orderable recommendation cannot be approved into a dead-end state", () => {\n  const { mission, supplier, quote, recommendation } = fixture();\n  quote.sample = { available: false, basePrice: null };\n  const approval = buildApprovalPacket(mission, recommendation, quote, supplier, []);\n  assert.equal(approval.action.kind, "progress_supplier_relationship");\n  assert.equal(approval.action.executable, false);\n  assert.throws(() => applyApprovalDecision(approval, "approve"), /not executable/);\n  applyApprovalDecision(approval, "negotiate_more");\n  assert.equal(approval.status, "returned_to_negotiation");\n});\n\ntest("sample execution refuses price drift after human approval", () => {\n  const { mission, supplier, quote, recommendation } = fixture();\n  const approval = buildApprovalPacket(mission, recommendation, quote, supplier, []);\n  applyApprovalDecision(approval, "approve");\n  mission.status = "approved";\n  quote.sample.basePrice = 300;\n  assert.throws(() => createSampleOrder(mission, approval, quote), /fresh approval required/);\n});\n\n`;
  if (!source.includes(decisionAnchor)) throw new Error("Missing approval-order test insertion anchor");
  source = source.replace(decisionAnchor, decisionTests + decisionAnchor);

  const eofAnchor = `test("remote sample provider receives stable idempotency key and returns real order id", async t => {`;
  const boundedTest = `test("remote sample provider response is bounded while streaming", async t => {\n  const server = http.createServer(async (req, res) => {\n    for await (const chunk of req) void chunk;\n    res.writeHead(200, { "Content-Type": "application/json", "Transfer-Encoding": "chunked" });\n    res.write('{"padding":"');\n    for (let index = 0; index < 80; index += 1) res.write("x".repeat(4096));\n    res.end('"}');\n  });\n  await new Promise((resolve, reject) => { server.once("error", reject); server.listen(0, "127.0.0.1", resolve); });\n  t.after(() => new Promise(resolve => server.close(resolve)));\n  const { port } = server.address();\n\n  const { mission, supplier, quote, recommendation } = fixture();\n  mission.status = "approved";\n  const approval = buildApprovalPacket({ ...mission, status: "awaiting_approval" }, recommendation, quote, supplier, []);\n  applyApprovalDecision(approval, "approve");\n  const order = createSampleOrder(mission, approval, quote);\n  const previous = process.env.VENDOR_SCOUT_ORDER_URL;\n  process.env.VENDOR_SCOUT_ORDER_URL = \`http://127.0.0.1:\${port}\`;\n  try {\n    await assert.rejects(() => submitSampleOrder(order), /response is too large/);\n  } finally {\n    if (previous == null) delete process.env.VENDOR_SCOUT_ORDER_URL; else process.env.VENDOR_SCOUT_ORDER_URL = previous;\n  }\n});\n\n`;
  if (!source.includes(eofAnchor)) throw new Error("Missing bounded provider test insertion anchor");
  return source.replace(eofAnchor, boundedTest + eofAnchor);
});

await edit("test/approval-runtime.test.mjs", source => {
  const from = `test("keep negotiating and reject decisions never create a sample order", async t => {\n  const runtime = await runtimeFor(t);\n\n  await runDemo(runtime.baseUrl);\n  let decision = await postJson(\`${"${runtime.baseUrl}"}/api/missions/mission-lidar-500/approval\`, { decision: "negotiate_more" });\n  assert.equal(decision.response.status, 200);\n  assert.equal(decision.payload.mission.status, "negotiating");\n  assert.equal(decision.payload.approvals[0].status, "returned_to_negotiation");\n  assert.equal(decision.payload.sampleOrders.length, 0);\n\n  await runDemo(runtime.baseUrl);\n  decision = await postJson(\`${"${runtime.baseUrl}"}/api/missions/mission-lidar-500/approval\`, { decision: "reject" });\n  assert.equal(decision.response.status, 200);\n  assert.equal(decision.payload.mission.status, "rejected");\n  assert.equal(decision.payload.approvals[0].status, "rejected");\n  assert.equal(decision.payload.sampleOrders.length, 0);\n});`;
  const to = `test("keep negotiating creates a fresh approval cycle and reject never creates a sample order", async t => {\n  const runtime = await runtimeFor(t);\n\n  await runDemo(runtime.baseUrl);\n  let state = await snapshot(runtime.baseUrl);\n  const firstApproval = state.approvals.find(item => item.status === "pending");\n  assert.ok(firstApproval);\n\n  let decision = await postJson(\`${"${runtime.baseUrl}"}/api/missions/mission-lidar-500/approval\`, { decision: "negotiate_more" });\n  assert.equal(decision.response.status, 200);\n  assert.equal(decision.payload.mission.status, "negotiating");\n  assert.equal(decision.payload.sampleOrders.length, 0);\n\n  let analysis = await postJson(\`${"${runtime.baseUrl}"}/api/missions/mission-lidar-500/analysis\`, { fxRates: [] });\n  assert.equal(analysis.response.status, 200, JSON.stringify(analysis.payload));\n  assert.equal(analysis.payload.mission.status, "awaiting_approval");\n  const secondApproval = analysis.payload.approvals.find(item => item.status === "pending");\n  assert.ok(secondApproval);\n  assert.notEqual(secondApproval.id, firstApproval.id);\n  assert.equal(secondApproval.cycle, 2);\n  assert.equal(analysis.payload.approvals.find(item => item.id === firstApproval.id).status, "returned_to_negotiation");\n\n  decision = await postJson(\`${"${runtime.baseUrl}"}/api/missions/mission-lidar-500/approval\`, { decision: "negotiate_more" });\n  assert.equal(decision.response.status, 200);\n  assert.equal(decision.payload.mission.status, "negotiating");\n\n  const revisedOffer = await postJson(\`${"${runtime.baseUrl}"}/api/missions/mission-lidar-500/suppliers/supplier-heliomotion/offer\`, {\n    sourceReference: "controlled/demo-reply/heliomotion-final",\n    unitPrice: 382,\n    currency: "USD",\n    moq: 100,\n    leadTimeDays: 18,\n    shippingTerms: "DDP Philadelphia",\n    shippingCost: 900,\n    sampleAvailable: true,\n    samplePrice: 300,\n    technicalConfirmed: true\n  });\n  assert.equal(revisedOffer.response.status, 200, JSON.stringify(revisedOffer.payload));\n  const prepared = await postJson(\`${"${runtime.baseUrl}"}/api/missions/mission-lidar-500/suppliers/supplier-heliomotion/counter\`, { action: "prepare" });\n  assert.equal(prepared.response.status, 200, JSON.stringify(prepared.payload));\n\n  analysis = await postJson(\`${"${runtime.baseUrl}"}/api/missions/mission-lidar-500/analysis\`, { fxRates: [] });\n  assert.equal(analysis.response.status, 200, JSON.stringify(analysis.payload));\n  const revisedApproval = analysis.payload.approvals.find(item => item.status === "pending");\n  assert.ok(revisedApproval);\n  assert.equal(revisedApproval.action.estimatedSpendBase, 300);\n  assert.equal(revisedApproval.packet.proposed.samplePriceBase, 300);\n\n  decision = await postJson(\`${"${runtime.baseUrl}"}/api/missions/mission-lidar-500/approval\`, { decision: "reject" });\n  assert.equal(decision.response.status, 200);\n  assert.equal(decision.payload.mission.status, "rejected");\n  assert.equal(decision.payload.approvals.find(item => item.id === revisedApproval.id).status, "rejected");\n  assert.equal(decision.payload.sampleOrders.length, 0);\n});`;
  return replaceOnce(source, from, to, "fresh approval cycle runtime test");
});

console.log("Applied six Qodo review remediations with regression coverage.");
