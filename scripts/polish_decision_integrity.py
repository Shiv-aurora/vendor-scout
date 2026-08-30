from pathlib import Path

server = Path('server.mjs')
text = server.read_text()
old = '''async function executeApprovedSampleOrder(missionId) {
  const mission = state.missions.find(item => item.id === missionId);
  if (!mission) throw httpError(404, "Sourcing mission not found");
  requireStatus(mission, "approved", "execute approved sample action");
  const approval = [...state.approvals].reverse().find(item => item.missionId === missionId && item.status === "approved");
'''
new = '''async function executeApprovedSampleOrder(missionId) {
  const mission = state.missions.find(item => item.id === missionId);
  if (!mission) throw httpError(404, "Sourcing mission not found");
  const completedOrder = [...state.sampleOrders].reverse().find(item => item.missionId === missionId && ["submitted", "simulated"].includes(item.status));
  if (mission.status === "completed" && completedOrder) return missionSnapshot(missionId);
  requireStatus(mission, "approved", "execute approved sample action");
  const approval = [...state.approvals].reverse().find(item => item.missionId === missionId && item.status === "approved");
'''
if old not in text: raise SystemExit('sample idempotency anchor not found')
server.write_text(text.replace(old, new, 1))

approval = Path('lib/approval.mjs')
text = approval.read_text()
old = '''  const comparable = competingQuotes
    .filter(item => item.missionId === mission.id && item.id !== quote.id)
    .filter(item => Number.isInteger(item.rank))
    .sort((a, b) => a.rank - b.rank)
    .map(item => ({
'''
new = '''  const comparable = competingQuotes
    .filter(item => item.missionId === mission.id && item.id !== quote.id)
    .sort((a, b) => (a.rank ?? Number.MAX_SAFE_INTEGER) - (b.rank ?? Number.MAX_SAFE_INTEGER))
    .map(item => ({
'''
if old not in text: raise SystemExit('approval competitor anchor not found')
text = text.replace(old, new, 1)
text = text.replace('      rank: item.rank,\n      score: item.score?.total ?? null,\n', '      rank: item.rank ?? null,\n      rankable: item.comparison?.rankable !== false,\n      comparisonBasis: item.comparison?.basis ?? null,\n      missingEvidence: item.completeness?.missing || [],\n      score: item.score?.total ?? null,\n', 1)
approval.write_text(text)

app = Path('public/app.js')
text = app.read_text()
text = text.replace('  const ranked = quotes.filter(quote => Number.isInteger(quote.rank)).sort((a, b) => a.rank - b.rank);\n', '  const ranked = quotes.filter(quote => Number.isInteger(quote.rank)).sort((a, b) => a.rank - b.rank);\n  const displayQuotes = [...quotes].sort((a, b) => (a.rank ?? Number.MAX_SAFE_INTEGER) - (b.rank ?? Number.MAX_SAFE_INTEGER));\n', 1)
text = text.replace('  const quoteCards = ranked.length\n    ? ranked.map(quote => {\n', '  const quoteCards = displayQuotes.length\n    ? displayQuotes.map(quote => {\n', 1)
text = text.replace('<span class="quote-rank">#${quote.rank}</span><h3>${escapeHtml(quote.supplierName)}</h3>', '<span class="quote-rank">${Number.isInteger(quote.rank) ? `#${quote.rank}` : "—"}</span><h3>${escapeHtml(quote.supplierName)}</h3>', 1)
text = text.replace('${ranked.length ? `${ranked.length} comparable offer${ranked.length === 1 ? "" : "s"}` : "Waiting for comparison"}', '${displayQuotes.length ? `${displayQuotes.length} supplier offer${displayQuotes.length === 1 ? "" : "s"} · ${ranked.length} rankable` : "Waiting for comparison"}', 1)
app.write_text(text)
