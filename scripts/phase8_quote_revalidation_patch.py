from pathlib import Path

path = Path('lib/quotes.mjs')
text = path.read_text()
text = text.replace('import { latestOffer } from "./negotiation.mjs";', 'import { evaluateOffer, latestOffer } from "./negotiation.mjs";', 1)
start = text.find('export function analyzeQuotes(')
if start < 0:
    raise SystemExit('analyzeQuotes anchor missing')
new_tail = r'''export function analyzeQuotes(mission, supplierCandidates, conversations, { fxRates = [], now = new Date().toISOString() } = {}) {
  const candidateById = new Map(supplierCandidates.filter(candidate => candidate.missionId === mission.id).map(candidate => [candidate.id, candidate]));
  const missionConversations = conversations.filter(conversation => conversation.missionId === mission.id);
  const offersBySupplier = new Map(missionConversations.map(conversation => [conversation.supplierId, latestOffer(conversation)]).filter(([, offer]) => Boolean(offer)));
  if (!offersBySupplier.size) throw new Error("No structured supplier offers are available for quote comparison");

  const offerEvaluations = [];
  const readyConversations = [];
  for (const conversation of missionConversations) {
    const candidate = candidateById.get(conversation.supplierId);
    const offer = offersBySupplier.get(conversation.supplierId);
    if (!candidate || !offer) continue;
    const competitorOffers = [...offersBySupplier.entries()]
      .filter(([supplierId]) => supplierId !== conversation.supplierId)
      .map(([, competitorOffer]) => competitorOffer);
    const evaluation = evaluateOffer(mission, candidate, offer, competitorOffers);
    offerEvaluations.push({ supplierId: candidate.id, conversationId: conversation.id, offerId: offer.id, evaluation });
    if (evaluation.status === "ready_for_comparison") {
      readyConversations.push({
        ...conversation,
        status: "offer_ready",
        negotiation: { ...(conversation.negotiation || {}), latestEvaluation: evaluation }
      });
    }
  }

  if (!readyConversations.length) {
    return {
      analyzedAt: now,
      baseCurrency: String(mission.currentSupplier.currency || "USD").toUpperCase(),
      quotes: [],
      offerEvaluations,
      recommendation: null,
      blockers: ["Current offer set has no supplier ready for comparison; negotiation must continue"]
    };
  }

  const quotes = readyConversations.map(conversation => {
    const candidate = candidateById.get(conversation.supplierId);
    const quote = normalizeQuote(mission, candidate, conversation, { fxRates, now });
    quote.missionMaxLeadTimeDays = mission.constraints.maxLeadTimeDays;
    return quote;
  });
  const eligible = quotes.filter(quote => quote.completeness.completeForTechnicalComparison && Number.isFinite(quote.knownTotal.base));
  if (!eligible.length) {
    return {
      analyzedAt: now,
      baseCurrency: String(mission.currentSupplier.currency || "USD").toUpperCase(),
      quotes,
      offerEvaluations,
      recommendation: null,
      blockers: ["No current ready offer has enough normalized price/FX and technical evidence for ranking"]
    };
  }
  const minKnownTotal = Math.min(...eligible.map(quote => quote.knownTotal.base));
  for (const quote of quotes) {
    if (eligible.includes(quote)) quote.score = scoreQuote(quote, mission, minKnownTotal);
  }
  const ranked = eligible.sort((a, b) => b.score.total - a.score.total || (a.knownTotal.base - b.knownTotal.base));
  ranked.forEach((quote, index) => { quote.rank = index + 1; });
  const winner = ranked[0];
  const runnerUp = ranked[1] || null;
  const recommendation = {
    id: stableId("recommendation", mission.id, winner.id, now.slice(0, 10)),
    missionId: mission.id,
    quoteId: winner.id,
    supplierId: winner.supplierId,
    supplierName: winner.supplierName,
    generatedAt: now,
    status: winner.landedCost.complete && winner.completeness.missing.length === 0 ? "recommended" : "provisional",
    score: winner.score.total,
    reasons: recommendationReasons(winner, runnerUp),
    risks: [
      ...winner.completeness.missing.map(field => `Missing ${field}`),
      ...(winner.overbuyUnits > 0 ? [`MOQ requires ${winner.overbuyUnits} excess units`] : []),
      ...(winner.supplierRiskScore > 25 ? [`Supplier-quality risk score is ${winner.supplierRiskScore}/100`] : [])
    ],
    humanApprovalRequired: true,
    commitmentExecuted: false
  };
  return {
    analyzedAt: now,
    baseCurrency: winner.baseCurrency,
    quotes,
    offerEvaluations,
    recommendation,
    blockers: []
  };
}
'''
path.write_text(text[:start] + new_tail)
Path('.github/workflows/one-shot-phase8-quote-revalidation.yml').unlink(missing_ok=True)
Path('scripts/phase8_quote_revalidation_patch.py').unlink(missing_ok=True)
