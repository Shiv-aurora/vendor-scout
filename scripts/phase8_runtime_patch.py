from pathlib import Path

path = Path('server.mjs')
text = path.read_text()

text = text.replace(
    'import { latestOffer, markCounterAccepted, prepareCounter as prepareNegotiationCounter, recordOfferTerms } from "./lib/negotiation.mjs";\n',
    'import { latestOffer, markCounterAccepted, prepareCounter as prepareNegotiationCounter, recordOfferTerms } from "./lib/negotiation.mjs";\nimport { analyzeQuotes as computeQuoteAnalysis } from "./lib/quotes.mjs";\n',
    1
)

old_savings = '''  const projectedSavings = Math.max(0, ...qualified.map(candidate => candidate.projectedSavings || 0));
  const contacted = new Set(state.conversations.filter(conversationHasExternalContact).map(conversation => conversation.supplierId));'''
new_savings = '''  const latestRecommendation = [...state.recommendations].reverse().find(recommendation => activeMissions.some(mission => mission.id === recommendation.missionId)) || null;
  const recommendedQuote = latestRecommendation ? state.quotes.find(quote => quote.id === latestRecommendation.quoteId) : null;
  const analyzedSavings = recommendedQuote?.economics?.estimatedLandedSavingsBase ?? recommendedQuote?.economics?.savingsBeforeShippingBase;
  const projectedSavings = Number.isFinite(analyzedSavings)
    ? Math.max(0, analyzedSavings)
    : Math.max(0, ...qualified.map(candidate => candidate.projectedSavings || 0));
  const contacted = new Set(state.conversations.filter(conversationHasExternalContact).map(conversation => conversation.supplierId));'''
if old_savings not in text:
    raise SystemExit('dashboard savings anchor missing')
text = text.replace(old_savings, new_savings, 1)

anchor = 'async function executeMissionAction(id, action) {'
if anchor not in text:
    raise SystemExit('executeMissionAction anchor missing')
analysis_code = '''function quoteAnalysisSignature(analysis) {
  return JSON.stringify({
    quotes: analysis.quotes.map(quote => ({
      id: quote.id,
      sourceOfferId: quote.sourceOfferId,
      fx: quote.fx,
      knownTotal: quote.knownTotal,
      landedCost: quote.landedCost,
      score: quote.score,
      rank: quote.rank
    })),
    recommendation: analysis.recommendation,
    blockers: analysis.blockers
  });
}

async function analyzeMissionQuotes(missionId, fxRates = []) {
  const mission = state.missions.find(item => item.id === missionId);
  if (!mission) throw httpError(404, "Sourcing mission not found");
  requireOneOfStatuses(mission, ["negotiating", "comparing"], "analyze quotes");
  const candidates = state.supplierCandidates.filter(candidate => candidate.missionId === missionId);
  const conversations = state.conversations.filter(conversation => conversation.missionId === missionId);
  const analysis = computeQuoteAnalysis(mission, candidates, conversations, { fxRates });
  const signature = quoteAnalysisSignature(analysis);
  const changed = mission.execution?.quoteAnalysisSignature !== signature;

  state.quotes = [
    ...state.quotes.filter(quote => quote.missionId !== missionId),
    ...analysis.quotes
  ];
  state.recommendations = state.recommendations.filter(recommendation => recommendation.missionId !== missionId);
  if (analysis.recommendation) state.recommendations.push(analysis.recommendation);

  if (analysis.recommendation && mission.status === "negotiating") {
    mission.status = transitionMission(mission.status, "negotiation_complete");
  }
  mission.updatedAt = new Date().toISOString();
  mission.execution = {
    ...(mission.execution || {}),
    analysisReady: Boolean(analysis.recommendation),
    analysisAt: analysis.analyzedAt,
    analysisBaseCurrency: analysis.baseCurrency,
    analysisBlockers: analysis.blockers,
    quoteAnalysisSignature: signature
  };

  if (changed) {
    if (analysis.recommendation) {
      addActivity(
        missionId,
        "compare",
        `Quote analysis recommends ${analysis.recommendation.supplierName}`,
        `${analysis.quotes.filter(quote => quote.rank).length} comparable offer${analysis.quotes.filter(quote => quote.rank).length === 1 ? "" : "s"} ranked · recommendation is ${analysis.recommendation.status} · human approval still required.`
      );
    } else {
      addActivity(missionId, "compare", "Quote analysis blocked", analysis.blockers.join("; "));
    }
  }
  await persist();
  return missionSnapshot(missionId);
}

'''
text = text.replace(anchor, analysis_code + anchor, 1)

old_context_tail = '''async function mcpSendCounter(id, supplierId) {
  return serializeMutation(() => sendPreparedCounter(id, supplierId));
}

const mcpContext = {
  getMission: async id => missionSnapshot(id),
  discoverSuppliers: mcpDiscoverMission,
  recordSuppliers: mcpRecordSuppliers,
  qualifySuppliers: mcpQualifyMission,
  prepareOutreach: mcpPrepareOutreach,
  sendOutreach: mcpSendOutreach,
  recordReply: mcpRecordReply,
  recordOffer: mcpRecordOffer,
  prepareCounter: mcpPrepareCounter,
  sendCounter: mcpSendCounter
};'''
new_context_tail = '''async function mcpSendCounter(id, supplierId) {
  return serializeMutation(() => sendPreparedCounter(id, supplierId));
}

async function mcpAnalyzeQuotes(id, fxRates) {
  return serializeMutation(() => analyzeMissionQuotes(id, fxRates));
}

const mcpContext = {
  getMission: async id => missionSnapshot(id),
  discoverSuppliers: mcpDiscoverMission,
  recordSuppliers: mcpRecordSuppliers,
  qualifySuppliers: mcpQualifyMission,
  prepareOutreach: mcpPrepareOutreach,
  sendOutreach: mcpSendOutreach,
  recordReply: mcpRecordReply,
  recordOffer: mcpRecordOffer,
  prepareCounter: mcpPrepareCounter,
  sendCounter: mcpSendCounter,
  analyzeQuotes: mcpAnalyzeQuotes
};'''
if old_context_tail not in text:
    raise SystemExit('MCP context anchor missing')
text = text.replace(old_context_tail, new_context_tail, 1)

mission_route = '    const missionMatch = url.pathname.match(/^\\/api\\/missions\\/([^/]+)$/);'
if mission_route not in text:
    raise SystemExit('mission route anchor missing')
analysis_route = '''    const analysisMatch = url.pathname.match(/^\\/api\\/missions\\/([^/]+)\\/analysis$/);
    if (analysisMatch && req.method === "POST") {
      if (!isAgentAuthorized(req)) return json(res, configuredAgentToken ? 401 : 503, { error: configuredAgentToken ? "Agent authorization required" : "Agent mutation API is disabled until VENDOR_SCOUT_AGENT_TOKEN is configured" });
      const missionId = decodeURIComponent(analysisMatch[1]);
      const body = await readJsonBody(req, 128 * 1024);
      const snapshot = await serializeMutation(() => analyzeMissionQuotes(missionId, Array.isArray(body.fxRates) ? body.fxRates : []));
      return json(res, 200, snapshot);
    }

'''
text = text.replace(mission_route, analysis_route + mission_route, 1)

path.write_text(text)
Path('.github/workflows/one-shot-phase8-runtime.yml').unlink(missing_ok=True)
Path('scripts/phase8_runtime_patch.py').unlink(missing_ok=True)
