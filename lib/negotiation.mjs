import { createHash } from "node:crypto";

const MAX_CERTIFICATIONS = 30;
const MAX_TIERS = 20;
const EXTERNALLY_ACCEPTED_STATUSES = new Set(["accepted", "sent", "delivered"]);

function stableId(prefix, ...parts) {
  const digest = createHash("sha256").update(parts.join("\n")).digest("hex").slice(0, 18);
  return `${prefix}-${digest}`;
}

function nullableNonNegative(value, field) {
  if (value == null) return null;
  if (!Number.isFinite(value) || value < 0) throw new Error(`${field} must be a non-negative number or null`);
  return value;
}

function nullableBoolean(value, field) {
  if (value == null) return null;
  if (typeof value !== "boolean") throw new Error(`${field} must be boolean or null`);
  return value;
}

function nullableString(value, field, maxLength = 2000) {
  if (value == null) return null;
  if (typeof value !== "string" || !value.trim()) throw new Error(`${field} must be a non-empty string or null`);
  return value.trim().slice(0, maxLength);
}

function normalizeTiers(value) {
  if (value == null) return [];
  if (!Array.isArray(value)) throw new Error("quantityTiers must be an array");
  if (value.length > MAX_TIERS) throw new Error(`quantityTiers may contain no more than ${MAX_TIERS} entries`);
  return value.map((tier, index) => {
    if (!tier || typeof tier !== "object") throw new Error(`quantityTiers[${index}] must be an object`);
    if (!Number.isInteger(tier.minQuantity) || tier.minQuantity <= 0) throw new Error(`quantityTiers[${index}].minQuantity must be a positive integer`);
    if (!Number.isFinite(tier.unitPrice) || tier.unitPrice < 0) throw new Error(`quantityTiers[${index}].unitPrice must be a non-negative number`);
    return { minQuantity: tier.minQuantity, unitPrice: tier.unitPrice };
  }).sort((a, b) => a.minQuantity - b.minQuantity);
}

function normalizeCertifications(value) {
  if (value == null) return [];
  if (!Array.isArray(value)) throw new Error("certifications must be an array");
  if (value.length > MAX_CERTIFICATIONS) throw new Error(`certifications may contain no more than ${MAX_CERTIFICATIONS} entries`);
  return [...new Set(value.map((item, index) => {
    if (typeof item !== "string" || !item.trim()) throw new Error(`certifications[${index}] must be a non-empty string`);
    return item.trim().slice(0, 200);
  }))];
}

export function normalizeOfferTerms(input, { conversation, sourceMessage, extractedAt = new Date().toISOString() }) {
  if (!input || typeof input !== "object") throw new Error("Offer terms must be an object");
  if (!conversation?.id) throw new Error("Conversation is required");
  if (!sourceMessage?.id || sourceMessage.direction !== "inbound") throw new Error("Offer terms must be anchored to a persisted inbound supplier message");

  const sourceReference = input.sourceReference || sourceMessage.sourceReference;
  if (typeof sourceReference !== "string" || !sourceReference.trim()) throw new Error("Offer terms require sourceReference provenance");
  if (sourceMessage.sourceReference && sourceReference.trim() !== sourceMessage.sourceReference) {
    throw new Error("Offer sourceReference must match the persisted supplier reply");
  }

  const currency = input.currency == null ? null : String(input.currency).trim().toUpperCase();
  if (currency != null && !/^[A-Z]{3}$/.test(currency)) throw new Error("currency must be a three-letter code or null");
  const moq = input.moq == null ? null : input.moq;
  if (moq != null && (!Number.isInteger(moq) || moq <= 0)) throw new Error("moq must be a positive integer or null");
  const leadTimeDays = input.leadTimeDays == null ? null : input.leadTimeDays;
  if (leadTimeDays != null && (!Number.isFinite(leadTimeDays) || leadTimeDays < 0)) throw new Error("leadTimeDays must be non-negative or null");

  const offer = {
    id: stableId("offer", conversation.id, sourceMessage.id, sourceReference.trim()),
    sourceMessageId: sourceMessage.id,
    sourceReference: sourceReference.trim(),
    extractedAt,
    unitPrice: nullableNonNegative(input.unitPrice, "unitPrice"),
    currency,
    quantityTiers: normalizeTiers(input.quantityTiers),
    moq,
    availability: nullableString(input.availability, "availability"),
    leadTimeDays,
    shippingTerms: nullableString(input.shippingTerms, "shippingTerms"),
    shippingCost: nullableNonNegative(input.shippingCost, "shippingCost"),
    sampleAvailable: nullableBoolean(input.sampleAvailable, "sampleAvailable"),
    samplePrice: nullableNonNegative(input.samplePrice, "samplePrice"),
    certifications: normalizeCertifications(input.certifications),
    technicalConfirmed: nullableBoolean(input.technicalConfirmed, "technicalConfirmed"),
    notes: nullableString(input.notes, "notes", 5000)
  };

  const meaningful = [
    offer.unitPrice,
    offer.moq,
    offer.availability,
    offer.leadTimeDays,
    offer.shippingTerms,
    offer.shippingCost,
    offer.sampleAvailable,
    offer.samplePrice,
    offer.technicalConfirmed,
    offer.notes,
    offer.quantityTiers.length ? offer.quantityTiers : null,
    offer.certifications.length ? offer.certifications : null
  ].some(value => value != null);
  if (!meaningful) throw new Error("At least one explicit supplier offer term is required");
  return offer;
}

export function recordOfferTerms(conversation, input, options = {}) {
  const sourceReference = input?.sourceReference;
  const sourceMessageId = input?.sourceMessageId;
  const sourceMessage = [...(conversation.messages || [])].reverse().find(message => (
    message.direction === "inbound" && (
      (sourceMessageId && message.id === sourceMessageId) ||
      (sourceReference && message.sourceReference === sourceReference)
    )
  ));
  if (!sourceMessage) throw new Error("Offer terms must reference a persisted supplier reply by sourceMessageId or sourceReference");

  const offer = normalizeOfferTerms(input, { conversation, sourceMessage, extractedAt: options.extractedAt });
  conversation.negotiation = conversation.negotiation || { offers: [], counterRounds: 0, latestEvaluation: null };
  const existingIndex = conversation.negotiation.offers.findIndex(item => item.id === offer.id);
  if (existingIndex >= 0) conversation.negotiation.offers[existingIndex] = offer;
  else conversation.negotiation.offers.push(offer);
  conversation.status = "negotiating";
  conversation.updatedAt = offer.extractedAt;
  return offer;
}

export function latestOffer(conversation) {
  const offers = conversation?.negotiation?.offers || [];
  return offers.length ? offers[offers.length - 1] : null;
}

function effectivePriceForQuantity(offer, quantity) {
  if (Number.isFinite(offer?.unitPrice)) return { price: offer.unitPrice, basis: "unit-price" };
  const tiers = Array.isArray(offer?.quantityTiers) ? offer.quantityTiers : [];
  const applicable = tiers
    .filter(tier => Number.isInteger(tier.minQuantity) && tier.minQuantity <= quantity && Number.isFinite(tier.unitPrice))
    .sort((a, b) => b.minQuantity - a.minQuantity)[0];
  return applicable
    ? { price: applicable.unitPrice, basis: `quantity-tier-${applicable.minQuantity}` }
    : { price: null, basis: null };
}

function sameCurrencyCompetitorBenchmark(offer, competitorOffers, quantity) {
  if (!offer?.currency) return null;
  const prices = competitorOffers
    .filter(candidate => candidate?.currency === offer.currency)
    .map(candidate => effectivePriceForQuantity(candidate, quantity).price)
    .filter(Number.isFinite);
  return prices.length ? Math.min(...prices) : null;
}

export function evaluateOffer(mission, candidate, offer, competitorOffers = []) {
  if (!mission || !candidate || !offer) throw new Error("Mission, supplier, and offer are required for negotiation evaluation");
  const gaps = [];
  const missingFields = [];
  const targetCurrency = mission.currentSupplier?.currency || "USD";
  const pricing = effectivePriceForQuantity(offer, mission.quantity);
  const effectiveUnitPrice = pricing.price;
  const benchmark = sameCurrencyCompetitorBenchmark(offer, competitorOffers, mission.quantity);
  const priceComparable = Number.isFinite(effectiveUnitPrice) && offer.currency === targetCurrency;
  const requiresFx = Number.isFinite(effectiveUnitPrice) && Boolean(offer.currency) && offer.currency !== targetCurrency;

  if (!Number.isFinite(effectiveUnitPrice)) missingFields.push("unitPrice");
  else if (!offer.currency) missingFields.push("currency");
  else if (priceComparable) {
    const desired = benchmark == null ? mission.constraints.targetUnitPrice : Math.min(mission.constraints.targetUnitPrice, benchmark);
    if (effectiveUnitPrice > desired) {
      gaps.push({
        field: "unitPrice",
        priority: "high",
        offered: effectiveUnitPrice,
        target: desired,
        currency: offer.currency,
        reason: benchmark != null && benchmark < mission.constraints.targetUnitPrice
          ? `price is above the strongest same-currency competing offer of ${benchmark}`
          : `price is above the mission target of ${mission.constraints.targetUnitPrice}`
      });
    }
  }

  if (!Number.isInteger(offer.moq)) missingFields.push("moq");
  else if (offer.moq > mission.quantity) gaps.push({ field: "moq", priority: "high", offered: offer.moq, target: mission.quantity, reason: "MOQ exceeds requested quantity" });

  if (!Number.isFinite(offer.leadTimeDays)) missingFields.push("leadTimeDays");
  else if (offer.leadTimeDays > mission.constraints.maxLeadTimeDays) gaps.push({ field: "leadTimeDays", priority: "high", offered: offer.leadTimeDays, target: mission.constraints.maxLeadTimeDays, reason: "lead time exceeds mission limit" });

  if (!offer.shippingTerms) missingFields.push("shippingTerms");
  if (offer.sampleAvailable == null) missingFields.push("sampleAvailable");
  else if (offer.sampleAvailable && !Number.isFinite(offer.samplePrice)) missingFields.push("samplePrice");
  if (offer.technicalConfirmed == null) missingFields.push("technicalConfirmed");
  else if (offer.technicalConfirmed === false) gaps.push({ field: "technicalConfirmed", priority: "critical", offered: false, target: true, reason: "supplier explicitly did not confirm the required technical fit" });

  let status = "ready_for_comparison";
  if (gaps.some(gap => gap.priority === "critical")) status = "reject_recommended";
  else if (gaps.length) status = "counter_required";
  else if (missingFields.length) status = "needs_information";

  return {
    evaluatedAt: new Date().toISOString(),
    offerId: offer.id,
    supplierId: candidate.id,
    status,
    targetCurrency,
    competitorBenchmark: benchmark,
    effectiveUnitPrice,
    priceBasis: pricing.basis,
    priceComparable,
    requiresFx,
    gaps,
    missingFields
  };
}

function money(value, currency) {
  return `${currency || "USD"} ${Number(value).toFixed(2)}`;
}

function counterBasisSignature(mission, offer, evaluation) {
  const semantic = {
    missionQuantity: mission.quantity,
    targetUnitPrice: mission.constraints.targetUnitPrice,
    targetCurrency: evaluation.targetCurrency,
    competitorBenchmark: evaluation.competitorBenchmark,
    offer: {
      unitPrice: offer.unitPrice,
      currency: offer.currency,
      quantityTiers: offer.quantityTiers,
      moq: offer.moq,
      leadTimeDays: offer.leadTimeDays,
      shippingTerms: offer.shippingTerms,
      shippingCost: offer.shippingCost,
      sampleAvailable: offer.sampleAvailable,
      samplePrice: offer.samplePrice,
      technicalConfirmed: offer.technicalConfirmed
    },
    effectiveUnitPrice: evaluation.effectiveUnitPrice,
    priceBasis: evaluation.priceBasis,
    gaps: evaluation.gaps,
    missingFields: evaluation.missingFields
  };
  return createHash("sha256").update(JSON.stringify(semantic)).digest("hex").slice(0, 20);
}

export function buildCounterMessage(mission, candidate, conversation, evaluation, basisSignature = counterBasisSignature(mission, latestOffer(conversation), evaluation)) {
  const offer = latestOffer(conversation);
  if (!offer || evaluation.offerId !== offer.id) throw new Error("Counter must be based on the latest persisted supplier offer");
  if (evaluation.status === "ready_for_comparison") throw new Error("Offer has no negotiation gaps; proceed to quote comparison instead of countering");
  if (evaluation.status === "reject_recommended") throw new Error("Offer has a critical technical conflict; do not auto-counter without human judgment");

  const asks = [];
  for (const gap of evaluation.gaps) {
    if (gap.field === "unitPrice") asks.push(`Improve unit pricing to ${money(gap.target, gap.currency)} or better for ${mission.quantity} units.`);
    if (gap.field === "moq") asks.push(`Reduce MOQ to ${gap.target} units or lower so it fits this production run.`);
    if (gap.field === "leadTimeDays") asks.push(`Commit to a production lead time of ${gap.target} days or less.`);
  }
  const missing = new Set(evaluation.missingFields);
  if (missing.has("unitPrice")) asks.push(`Confirm unit pricing for ${mission.quantity} units and any relevant quantity tiers.`);
  if (missing.has("currency")) asks.push("Confirm the three-letter currency code for the quoted pricing.");
  if (missing.has("moq")) asks.push("Confirm the minimum order quantity.");
  if (missing.has("leadTimeDays")) asks.push("Confirm production lead time in days.");
  if (missing.has("shippingTerms")) asks.push("Confirm shipping terms and any estimated shipping cost.");
  if (missing.has("sampleAvailable")) asks.push("Confirm whether evaluation samples are available.");
  if (missing.has("samplePrice")) asks.push(`Confirm sample pricing; our sample budget is ${money(mission.constraints.sampleBudget, targetCurrencyFor(mission))}.`);
  if (missing.has("technicalConfirmed")) asks.push(`Confirm the offered part meets the required specification: ${mission.constraints.requirements.join("; ")}.`);
  if (!asks.length) throw new Error("No evidence-backed negotiation ask can be generated");

  const round = (conversation.negotiation?.counterRounds || 0) + 1;
  const originalRfq = conversation.messages.find(message => message.type === "rfq" && message.direction === "outbound");
  if (!originalRfq?.to) throw new Error("Conversation does not have a verified outbound supplier contact");
  const subject = originalRfq.subject?.startsWith("Re:") ? originalRfq.subject : `Re: ${originalRfq.subject || `RFQ ${mission.id}`}`;
  const content = [
    `Hello ${candidate.name} team,`,
    "",
    "Thank you for the response. We reviewed the offered terms against the current sourcing mission.",
    "",
    "To keep this moving, please address the following:",
    ...asks.map(ask => `- ${ask}`),
    "",
    "This counter/request is non-binding and does not accept any commercial terms or create a purchase commitment.",
    "",
    "Thank you,",
    "Vendor Scout on behalf of Atlas Robotics"
  ].join("\n");
  const id = stableId("msg", conversation.id, "counter", offer.id, basisSignature, String(round));
  return {
    id,
    type: "counter",
    direction: "outbound",
    to: originalRfq.to,
    subject,
    content,
    basedOnOfferId: offer.id,
    basedOnEvaluationSignature: basisSignature,
    negotiationRound: round,
    createdAt: new Date().toISOString(),
    delivery: {
      status: "draft",
      provider: null,
      externalMessageId: null,
      idempotencyKey: stableId("counter", mission.id, candidate.id, offer.id, basisSignature, String(round)),
      attemptedAt: null,
      deliveredAt: null,
      error: null
    }
  };
}

function targetCurrencyFor(mission) {
  return mission.currentSupplier?.currency || "USD";
}

export function prepareCounter(mission, candidate, conversation, competitorOffers = []) {
  const offer = latestOffer(conversation);
  if (!offer) throw new Error("No structured supplier offer has been recorded for this conversation");
  const evaluation = evaluateOffer(mission, candidate, offer, competitorOffers);
  conversation.negotiation.latestEvaluation = evaluation;
  if (evaluation.status === "ready_for_comparison") {
    conversation.status = "offer_ready";
    conversation.updatedAt = evaluation.evaluatedAt;
    return { evaluation, message: null };
  }
  if (evaluation.status === "reject_recommended") {
    conversation.status = "human_review";
    conversation.updatedAt = evaluation.evaluatedAt;
    return { evaluation, message: null };
  }

  const basisSignature = counterBasisSignature(mission, offer, evaluation);
  const countersForOffer = conversation.messages.filter(message => message.type === "counter" && message.basedOnOfferId === offer.id && message.delivery?.status !== "superseded");
  const existing = countersForOffer.find(message => message.basedOnEvaluationSignature === basisSignature);
  if (existing) return { evaluation, message: existing };

  for (const stale of countersForOffer) {
    if (EXTERNALLY_ACCEPTED_STATUSES.has(stale.delivery?.status)) {
      throw new Error("Offer terms changed after a counter was externally accepted; record a new supplier reply before continuing negotiation");
    }
    stale.delivery = {
      ...stale.delivery,
      status: "superseded",
      error: "Superseded because the persisted offer/evaluation inputs changed before external acceptance"
    };
  }

  const message = buildCounterMessage(mission, candidate, conversation, evaluation, basisSignature);
  conversation.messages.push(message);
  conversation.status = "counter_draft";
  conversation.updatedAt = message.createdAt;
  return { evaluation, message };
}

export function markCounterAccepted(conversation, message) {
  conversation.negotiation = conversation.negotiation || { offers: [], counterRounds: 0, latestEvaluation: null };
  conversation.negotiation.counterRounds = Math.max(conversation.negotiation.counterRounds || 0, message.negotiationRound || 0);
  conversation.status = "counter_sent";
  conversation.updatedAt = message.delivery.deliveredAt || new Date().toISOString();
  return conversation;
}
