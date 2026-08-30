from pathlib import Path

server = Path('server.mjs')
text = server.read_text()
text = text.replace('  const existing = state.approvals.find(item => item.id === packet.id);\n  if (existing?.status && existing.status !== "pending") return existing;\n', '  const existing = state.approvals.find(item => item.id === packet.id);\n  if (existing) return existing;\n', 1)
text = text.replace('  requireOneOfStatuses(mission, ["negotiating", "comparing"], "analyze quotes");\n', '  requireOneOfStatuses(mission, ["negotiating", "comparing", "awaiting_approval"], "analyze quotes");\n', 1)
old = '  const signature = quoteAnalysisSignature(analysis);\n  const changed = mission.execution?.quoteAnalysisSignature !== signature;\n\n'
new = '  const signature = quoteAnalysisSignature(analysis);\n  const changed = mission.execution?.quoteAnalysisSignature !== signature;\n  if (mission.status === "awaiting_approval" && changed) {\n    throw httpError(409, "Quote evidence changed after the approval packet was created; choose Keep negotiating before re-analysis");\n  }\n\n'
if old not in text: raise SystemExit('signature anchor not found')
text = text.replace(old, new, 1)
server.write_text(text)

mcp_test = Path('test/mcp-runtime.test.mjs')
text = mcp_test.read_text()
text = text.replace('assert.equal(rpc.result.serverInfo.version, "0.6.0");', 'assert.equal(rpc.result.serverInfo.version, "0.8.0");', 1)
text = text.replace('assert.equal(rpc.result.tools.length, 11);', 'assert.equal(rpc.result.tools.length, 12);', 1)
text = text.replace('    "vendor_scout_analyze_quotes"\n', '    "vendor_scout_analyze_quotes",\n    "vendor_scout_execute_sample_order"\n', 1)
old = '  assert.equal(byName("vendor_scout_analyze_quotes").inputSchema.properties.fxRates.items.required.includes("sourceReference"), true);\n  assert.ok(!names.some(name => /accept|purchase|order_sample|place_order/.test(name)), "MCP surface must not expose a commitment tool");\n'
new = '  assert.equal(byName("vendor_scout_analyze_quotes").inputSchema.properties.fxRates.items.required.includes("sourceReference"), true);\n  assert.equal(byName("vendor_scout_execute_sample_order").annotations.openWorldHint, true);\n  assert.equal(byName("vendor_scout_execute_sample_order").annotations.destructiveHint, true);\n  assert.equal(byName("vendor_scout_execute_sample_order").annotations.idempotentHint, true);\n  assert.ok(!names.some(name => /accept_offer|accept_terms|purchase|place_order/.test(name)), "MCP surface must not expose an uncontrolled commitment tool");\n'
if old not in text: raise SystemExit('MCP safety anchor not found')
mcp_test.write_text(text.replace(old, new, 1))

quote = Path('test/quote-runtime.test.mjs')
text = quote.read_text()
text = text.replace('test("Phase 8 persists normalized quotes, ranks offers, and stops before approval", async t => {', 'test("quote analysis persists normalized offers and creates one pending approval packet", async t => {', 1)
text = text.replace('  assert.equal(snapshot.mission.status, "comparing", JSON.stringify({', '  assert.equal(snapshot.mission.status, "awaiting_approval", JSON.stringify({', 1)
text = text.replace('  assert.equal(snapshot.approvals.length, 0, "Phase 8 must not create Phase 9 approval state");', '  assert.equal(snapshot.approvals.length, 1);\n  assert.equal(snapshot.approvals[0].status, "pending");\n  assert.equal(snapshot.approvals[0].quoteId, snapshot.recommendations[0].quoteId);\n  assert.equal(snapshot.approvals[0].packet.proposed.supplierName, snapshot.recommendations[0].supplierName);', 1)
old = '  const activityCount = snapshot.activity.filter(item => item.title.startsWith("Quote analysis recommends")).length;\n  snapshot = await mcp(runtime.baseUrl, 31, "vendor_scout_analyze_quotes", { missionId: "mission-lidar-500" });\n  assert.equal(snapshot.quotes.length, 2);\n  assert.equal(snapshot.recommendations.length, 1);\n  assert.equal(snapshot.activity.filter(item => item.title.startsWith("Quote analysis recommends")).length, activityCount, "idempotent re-analysis should not duplicate the analysis event");\n'
new = '  const activityCount = snapshot.activity.filter(item => item.title.startsWith("Quote analysis recommends")).length;\n  const approvalActivityCount = snapshot.activity.filter(item => item.title.startsWith("Approval requested for")).length;\n  snapshot = await mcp(runtime.baseUrl, 31, "vendor_scout_analyze_quotes", { missionId: "mission-lidar-500" });\n  assert.equal(snapshot.mission.status, "awaiting_approval");\n  assert.equal(snapshot.quotes.length, 2);\n  assert.equal(snapshot.recommendations.length, 1);\n  assert.equal(snapshot.approvals.length, 1);\n  assert.equal(snapshot.activity.filter(item => item.title.startsWith("Quote analysis recommends")).length, activityCount, "idempotent re-analysis should not duplicate the analysis event");\n  assert.equal(snapshot.activity.filter(item => item.title.startsWith("Approval requested for")).length, approvalActivityCount, "idempotent re-analysis should not duplicate the approval event");\n'
if old not in text: raise SystemExit('quote idempotency anchor not found')
text = text.replace(old, new, 1)
# Second test successful analysis now reaches approval.
old = '  assert.equal(snapshot.quotes.length, 1, "stale ready offer must not be ranked");\n  assert.equal(snapshot.recommendations[0].supplierId, supplierIds[1]);\n'
new = '  assert.equal(snapshot.mission.status, "awaiting_approval");\n  assert.equal(snapshot.quotes.length, 1, "stale ready offer must not be ranked");\n  assert.equal(snapshot.recommendations[0].supplierId, supplierIds[1]);\n  assert.equal(snapshot.approvals.length, 1);\n'
if old not in text: raise SystemExit('stale quote anchor not found')
text = text.replace(old, new, 1)
text = text.replace('  assert.equal(snapshot.mission.status, "comparing");\n  assert.equal(snapshot.recommendations.length, 1);\n  assert.equal(snapshot.quotes[0].fx.sourceReference, "fx/ecb/2026-08-29");\n  assert.equal(snapshot.approvals.length, 0);\n', '  assert.equal(snapshot.mission.status, "awaiting_approval");\n  assert.equal(snapshot.recommendations.length, 1);\n  assert.equal(snapshot.quotes[0].fx.sourceReference, "fx/ecb/2026-08-29");\n  assert.equal(snapshot.approvals.length, 1);\n', 1)
quote.write_text(text)
