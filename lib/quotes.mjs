import { createHash } from "node:crypto";
import { evaluateOffer, latestOffer } from "./negotiation.mjs";

const SCORE_WEIGHTS = Object.freeze({
  economics: 0.40,
  leadTime: 0.20,
  supplierQuality: 0.15,
  moq: 0.10,
  sample: 0.05,
  completeness: 0.10
});

function stableId(prefix, ...parts) {
  const digest = createHash("sha256").update(parts.join("\n")).digest("hex").slice(0, 18);
  return `${prefix}-${digest}`;
}

function round(value, digits = 2) {
  if (!Number.isFinite(value)) return null;
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

function clamp(value, min = 0, max = 100) {
  return Math.min(max, Math.max(min, value));
}

function normalizeFxRates(baseCurrency, rates = []) {
  const normalized = new Map();
  normalized.set(baseCurrency, {
    currency: baseCurrency,
    rateToBase: 1,
    sourceReference: "same-currency",
    asOf: null,
    kind: "identity"
  });
  if (rates == null) return normalized;
  if (!Array.isArray(rates)) throw new Error("fxRates must be an array");
  for (const [index, item] of rates.entries()) {
    if (!item || typeof item !== "object") throw new Error(`fxRates[${index}] must be an object`);
    const currency = String(item.currency || "").trim().toUpperCase();
    if (!/^[A-Z]{3}$/.test(currency)) throw new Error(`fxRates[${index}].currency must be a three-letter currency code`);
    if (!Number.isFinite(item.rateToBase) || item.rateToBase <= 0) throw new Error(`fxRates[${index}].rateToBase must be positive`);
    if (currency !== baseCurrency && (typeof item.sourceReference !== "string" || !item.sourceReference.trim())) {
      throw new Error(`fxRates[${index}] requires sourceReference provenance`);
    }
    normalized.set(currency, {
      currency,
      rateToBase: item.rateToBase,
      sourceReference: currency === baseCurrency ? "same-currency" : item.sourceReference.trim(),
      asOf: item.asOf || null,
      kind: currency === baseCurrency ? "identity" : "provided"
    });
  }
  return normalized;
}

function applicableTier(offer, quantity) {
  const tiers = (offer.quantityTiers || []).filter(tier => tier.minQuantity <= quantity);
  return tiers.length ? tiers.sort((a, b) => b.minQuantity - a.minQuantity)[0] : null;
}

function effectiveUnitPrice(offer, quantity) {
  const tier = applicableTier(offer, quantity);
  if (tier) return { value: tier.unitPrice, basis: `quantity-tier-${tier.minQuantity}`, tier };
  if (Number.isFinite(offer.unitPrice)) return { value: offer.unitPrice, basis: "stated-unit-price", tier: null };
  return { value: null, basis: "missing", tier: null };
}

function supplierRisk(candidate) {
  const confidenceRisk = (1 - clamp(candidate.confidence || 0, 0, 1)) * 55;
  const technicalRisk = (1 - clamp(candidate.specMatch || 0, 0, 1)) * 45;
  return round(clamp(confidenceRisk + technicalRisk), 1);
}

function sampleScore(offer, mission) {
  if (offer.sampleAvailable === false) return 0;
  if (offer.sampleAvailable == null) return 40;
  if (!Number.isFinite(offer.samplePrice)) return 70;
  return offer.samplePrice <= mission.constraints.sampleBudget ? 100 : clamp(100 * mission.constraints.sampleBudget / offer.samplePrice);
}

function leadScore(leadTimeDays, maxLeadTimeDays) {
  if (!Number.isFinite(leadTimeDays)) return 35;
  if (leadTimeDays <= 0) return 100;
  if (leadTimeDays <= maxLeadTimeDays) {
    return clamp(50 + 50 * (maxLeadTimeDays - leadTimeDays) / maxLeadTimeDays);
  }
  return clamp(50 * maxLeadTimeDays / leadTimeDays);
}

function moqScore(moq, quantity) {
  if (!Number.isFinite(moq)) return 40;
  if (moq <= quantity) return 100;
  return clamp(100 * quantity / moq);
}

function completenessFlags(offer, fx, effectivePrice) {
  const missing = [];
  if (!Number.isFinite(effectivePrice.value)) missing.push("unitPrice");
  if (!offer.currency) missing.push("currency");
  else if (!fx) missing.push("fxRate");
  if (!Number.isFinite(offer.moq)) missing.push("moq");
  if (!Number.isFinite(offer.leadTimeDays)) missing.push("leadTimeDays");
  if (!offer.shippingTerms) missing.push("shippingTerms");
  if (!Number.isFinite(offer.shippingCost)) missing.push("shippingCost");
  if (offer.technicalConfirmed !== true) missing.push("technicalConfirmation");
  return missing;
}

export function normalizeQuote(mission, candidate, conversation, { fxRates = [], now = new Date().toISOString() } = {}) {
  if (!mission || !candidate || !conversation) throw new Error("Mission, supplier, and conversation are required");
  const offer = latestOffer(conversation);
  if (!offer) throw new Error(`Supplier ${candidate.name} does not have a structured offer`);
  const evaluation = conversation.negotiation?.latestEvaluation;
  if (evaluation?.status !== "ready_for_comparison" && conversation.status !== "offer_ready") {
    throw new Error(`Supplier ${candidate.name} is not ready for quote comparison`);
  }

  const baseCurrency = String(mission.currentSupplier.currency || "USD").toUpperCase();
  const fxMap = normalizeFxRates(baseCurrency, fxRates);
  const fx = offer.currency ? fxMap.get(offer.currency) || null : null;
  const orderQuantity = Math.max(mission.quantity, Number.isFinite(offer.moq) ? offer.moq : mission.quantity);
  const effective = effectiveUnitPrice(offer, orderQuantity);
  const overbuyUnits = Math.max(0, orderQuantity - mission.quantity);
  const itemSubtotalOriginal = Number.isFinite(effective.value) ? round(effective.value * orderQuantity) : null;
  const shippingCostOriginal = Number.isFinite(offer.shippingCost) ? round(offer.shippingCost) : null;
  const knownTotalOriginal = Number.isFinite(itemSubtotalOriginal)
    ? round(itemSubtotalOriginal + (shippingCostOriginal || 0))
    : null;
  const landedCostOriginal = Number.isFinite(itemSubtotalOriginal) && Number.isFinite(shippingCostOriginal)
    ? round(itemSubtotalOriginal + shippingCostOriginal)
    : null;
  const toBase = value => Number.isFinite(value) && fx ? round(value * fx.rateToBase) : null;
  const effectiveUnitPriceBase = toBase(effective.value);
  const itemSubtotalBase = toBase(itemSubtotalOriginal);
  const shippingCostBase = toBase(shippingCostOriginal);
  const knownTotalBase = toBase(knownTotalOriginal);
  const landedCostBase = toBase(landedCostOriginal);
  const samplePriceBase = toBase(offer.samplePrice);
  const baselineTotalBase = round(mission.currentSupplier.unitPrice * mission.quantity);
  const savingsBeforeShippingBase = Number.isFinite(itemSubtotalBase)
    ? round(baselineTotalBase - itemSubtotalBase)
    : null;
  const estimatedLandedSavingsBase = Number.isFinite(landedCostBase)
    ? round(baselineTotalBase - landedCostBase)
    : null;
  const missing = completenessFlags(offer, fx, effective);
  const completenessScore = clamp(100 - missing.length * 12);
  const risk = supplierRisk(candidate);

  return {
    id: stableId("quote", mission.id, candidate.id, offer.id),
    missionId: mission.id,
    supplierId: candidate.id,
    supplierName: candidate.name,
    conversationId: conversation.id,
    sourceOfferId: offer.id,
    sourceMessageId: offer.sourceMessageId,
    sourceReference: offer.sourceReference,
    normalizedAt: now,
    baseCurrency,
    originalCurrency: offer.currency,
    fx: fx ? { ...fx } : null,
    quantity: mission.quantity,
    orderQuantity,
    overbuyUnits,
    unitPrice: {
      original: effective.value,
      base: effectiveUnitPriceBase,
      basis: effective.basis,
      applicableTier: effective.tier
    },
    itemSubtotal: { original: itemSubtotalOriginal, base: itemSubtotalBase },
    shipping: {
      terms: offer.shippingTerms,
      originalCost: shippingCostOriginal,
      baseCost: shippingCostBase,
      includedInLandedCost: Number.isFinite(shippingCostOriginal)
    },
    knownTotal: { original: knownTotalOriginal, base: knownTotalBase },
    landedCost: {
      original: landedCostOriginal,
      base: landedCostBase,
      complete: Number.isFinite(landedCostBase)
    },
    leadTimeDays: offer.leadTimeDays,
    moq: offer.moq,
    sample: {
      available: offer.sampleAvailable,
      originalPrice: offer.samplePrice,
      basePrice: samplePriceBase
    },
    certifications: offer.certifications || [],
    technicalConfirmed: offer.technicalConfirmed,
    supplierRiskScore: risk,
    evidence: {
      supplierConfidence: candidate.confidence,
      specMatch: candidate.specMatch,
      supplierSource: candidate.source,
      offerSourceReference: offer.sourceReference
    },
    completeness: {
      score: round(completenessScore, 1),
      missing,
      completeForLandedCost: Number.isFinite(landedCostBase),
      completeForTechnicalComparison: offer.technicalConfirmed === true && Number.isFinite(effectiveUnitPriceBase)
    },
    economics: {
      currentSupplierUnitCostBaseline: baselineTotalBase,
      savingsBeforeShippingBase,
      estimatedLandedSavingsBase,
      savingsPercentBeforeShipping: Number.isFinite(savingsBeforeShippingBase) && baselineTotalBase > 0
        ? round(100 * savingsBeforeShippingBase / baselineTotalBase, 2)
        : null,
      estimatedLandedSavingsPercent: Number.isFinite(estimatedLandedSavingsBase) && baselineTotalBase > 0
        ? round(100 * estimatedLandedSavingsBase / baselineTotalBase, 2)
        : null
    },
    score: null,
    rank: null
  };
}

function comparisonCostBase(quote) {
  if (quote.landedCost.complete && Number.isFinite(quote.landedCost.base)) return quote.landedCost.base;
  return quote.knownTotal.base;
}

function economicsScore(quote, minComparisonTotal) {
  const total = comparisonCostBase(quote);
  if (!Number.isFinite(total) || !Number.isFinite(minComparisonTotal) || minComparisonTotal <= 0) return 0;
  return clamp(100 * minComparisonTotal / total);
}

function scoreQuote(quote, mission, minComparisonTotal) {
  const components = {
    economics: round(economicsScore(quote, minComparisonTotal), 1),
    leadTime: round(leadScore(quote.leadTimeDays, mission.constraints.maxLeadTimeDays), 1),
    supplierQuality: round(100 - quote.supplierRiskScore, 1),
    moq: round(moqScore(quote.moq, mission.quantity), 1),
    sample: round(sampleScore({ sampleAvailable: quote.sample.available, samplePrice: quote.sample.basePrice }, mission), 1),
    completeness: round(quote.completeness.score, 1)
  };
  const total = round(Object.entries(SCORE_WEIGHTS).reduce((sum, [key, weight]) => sum + components[key] * weight, 0), 1);
  return { total, components, weights: SCORE_WEIGHTS };
}

function recommendationReasons(winner, runnerUp) {
  const reasons = [];
  if (Number.isFinite(winner.landedCost.base)) reasons.push(`Complete estimated landed cost is ${winner.baseCurrency} ${winner.landedCost.base.toFixed(2)}.`);
  else if (Number.isFinite(winner.knownTotal.base)) reasons.push(`Known normalized cost is ${winner.baseCurrency} ${winner.knownTotal.base.toFixed(2)}; landed cost remains incomplete.`);
  if (Number.isFinite(winner.economics.estimatedLandedSavingsBase)) reasons.push(`Estimated savings versus the current unit-cost baseline are ${winner.baseCurrency} ${winner.economics.estimatedLandedSavingsBase.toFixed(2)}.`);
  else if (Number.isFinite(winner.economics.savingsBeforeShippingBase)) reasons.push(`Pre-shipping savings versus the current supplier are ${winner.baseCurrency} ${winner.economics.savingsBeforeShippingBase.toFixed(2)}.`);
  if (Number.isFinite(winner.leadTimeDays)) reasons.push(`Lead time is ${winner.leadTimeDays} days versus the ${winner.missionMaxLeadTimeDays || "mission"} limit.`);
  if (winner.supplierRiskScore <= 15) reasons.push("Supplier qualification confidence and technical-match risk are strong.");
  if (runnerUp && winner.score.total - runnerUp.score.total >= 5) reasons.push(`Composite score leads the next offer by ${round(winner.score.total - runnerUp.score.total, 1)} points.`);
  if (winner.completeness.missing.length) reasons.push(`Remaining uncertainty: ${winner.completeness.missing.join(", ")}.`);
  return reasons;
}

export function analyzeQuotes(mission, supplierCandidates, conversations, { fxRates = [], now = new Date().toISOString() } = {}) {
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
    const evaluation = evaluateOffer(mission, candidate, offer, competitorOffers, { now });
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
  const completeLanded = eligible.filter(quote => quote.landedCost.complete && Number.isFinite(quote.landedCost.base));
  const rankingPool = completeLanded.length ? completeLanded : eligible;
  const comparisonBasis = completeLanded.length ? "complete-landed-cost" : "known-cost-provisional";
  const minComparisonTotal = Math.min(...rankingPool.map(comparisonCostBase));
  for (const quote of quotes) {
    quote.comparison = {
      eligible: eligible.includes(quote),
      rankable: rankingPool.includes(quote),
      basis: rankingPool.includes(quote) ? comparisonBasis : "incomplete-landed-cost"
    };
    if (rankingPool.includes(quote)) quote.score = scoreQuote(quote, mission, minComparisonTotal);
  }
  const ranked = rankingPool.sort((a, b) => b.score.total - a.score.total || (comparisonCostBase(a) - comparisonCostBase(b)));
  ranked.forEach((quote, index) => { quote.rank = index + 1; });
  const winner = ranked[0];
  const runnerUp = ranked[1] || null;
  const recommendation = {
    id: stableId("recommendation", mission.id, winner.id),
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
