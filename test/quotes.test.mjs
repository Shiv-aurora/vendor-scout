import test from "node:test";
import assert from "node:assert/strict";
import { createSeed } from "../lib/seed.mjs";
import { createRfqConversation, recordSupplierReply } from "../lib/outreach.mjs";
import { prepareCounter, recordOfferTerms } from "../lib/negotiation.mjs";
import { analyzeQuotes, normalizeQuote } from "../lib/quotes.mjs";

function readyConversation({
  mission,
  candidate,
  source = "offer",
  unitPrice = 385,
  currency = "USD",
  quantityTiers = [],
  moq = 100,
  leadTimeDays = 18,
  shippingTerms = "DDP Philadelphia",
  shippingCost = 500,
  sampleAvailable = true,
  samplePrice = 180,
  technicalConfirmed = true,
  requireReady = true
}) {
  candidate.contact = { email: `${candidate.id}@supplier.test`, sourceReference: `https://${candidate.id}.test/contact` };
  const conversation = createRfqConversation(mission, candidate, "2026-08-29T10:00:00.000Z");
  recordSupplierReply(conversation, {
    content: `Structured supplier response ${source}`,
    sourceReference: `source/${source}`,
    providerMessageId: source,
    receivedAt: "2026-08-29T11:00:00.000Z"
  });
  recordOfferTerms(conversation, {
    sourceReference: `source/${source}`,
    unitPrice,
    currency,
    quantityTiers,
    moq,
    leadTimeDays,
    shippingTerms,
    shippingCost,
    sampleAvailable,
    samplePrice,
    technicalConfirmed
  }, { extractedAt: "2026-08-29T11:05:00.000Z" });
  const prepared = prepareCounter(mission, candidate, conversation);
  if (requireReady) {
    assert.equal(prepared.evaluation.status, "ready_for_comparison");
    assert.equal(conversation.status, "offer_ready");
  }
  return conversation;
}

function fixture() {
  const state = createSeed({ missionStage: "contacting" });
  const mission = state.missions[0];
  const candidates = state.supplierCandidates.filter(candidate => candidate.status === "qualified").map(candidate => structuredClone(candidate));
  return { mission, candidates };
}

test("quote normalization uses the applicable quantity tier and complete landed cost", () => {
  const { mission, candidates } = fixture();
  const candidate = candidates[0];
  const conversation = readyConversation({
    mission,
    candidate,
    source: "tiered",
    unitPrice: 390,
    quantityTiers: [
      { minQuantity: 100, unitPrice: 388 },
      { minQuantity: 500, unitPrice: 380 },
      { minQuantity: 1000, unitPrice: 370 }
    ],
    shippingCost: 1200
  });
  const quote = normalizeQuote(mission, candidate, conversation, { now: "2026-08-29T12:00:00.000Z" });
  assert.equal(quote.unitPrice.original, 380);
  assert.equal(quote.unitPrice.basis, "quantity-tier-500");
  assert.equal(quote.orderQuantity, 500);
  assert.equal(quote.itemSubtotal.base, 190000);
  assert.equal(quote.shipping.baseCost, 1200);
  assert.equal(quote.landedCost.base, 191200);
  assert.equal(quote.landedCost.complete, true);
  assert.equal(quote.economics.currentSupplierUnitCostBaseline, 214500);
  assert.equal(quote.economics.estimatedLandedSavingsBase, 23300);
  assert.equal(quote.completeness.missing.length, 0);
  assert.equal(quote.fx.kind, "identity");
});

test("MOQ overbuy is explicit and changes known production cost", () => {
  const { mission, candidates } = fixture();
  const candidate = candidates[0];
  const conversation = readyConversation({ mission, candidate, source: "overbuy", moq: 700, unitPrice: 300, requireReady: false });
  assert.equal(conversation.negotiation.latestEvaluation.status, "counter_required", "Phase 7 should normally counter this MOQ");
  conversation.status = "offer_ready";
  conversation.negotiation.latestEvaluation.status = "ready_for_comparison";
  const quote = normalizeQuote(mission, candidate, conversation);
  assert.equal(quote.orderQuantity, 700);
  assert.equal(quote.overbuyUnits, 200);
  assert.equal(quote.itemSubtotal.base, 210000);
});

test("missing shipping remains visibly incomplete instead of being treated as zero landed cost", () => {
  const { mission, candidates } = fixture();
  const candidate = candidates[0];
  const conversation = readyConversation({ mission, candidate, source: "shipping-missing", shippingCost: null });
  const quote = normalizeQuote(mission, candidate, conversation);
  assert.equal(quote.shipping.baseCost, null);
  assert.equal(quote.landedCost.base, null);
  assert.equal(quote.landedCost.complete, false);
  assert.ok(quote.completeness.missing.includes("shippingCost"));
  assert.equal(quote.economics.estimatedLandedSavingsBase, null);
  assert.ok(Number.isFinite(quote.economics.savingsBeforeShippingBase));
});

test("foreign-currency quote requires explicit FX provenance", () => {
  const { mission, candidates } = fixture();
  const candidate = candidates[0];
  const conversation = readyConversation({ mission, candidate, source: "eur", currency: "EUR", unitPrice: 350, shippingCost: 1000 });
  const quoteWithoutFx = normalizeQuote(mission, candidate, conversation);
  assert.equal(quoteWithoutFx.unitPrice.base, null);
  assert.ok(quoteWithoutFx.completeness.missing.includes("fxRate"));

  assert.throws(() => normalizeQuote(mission, candidate, conversation, {
    fxRates: [{ currency: "EUR", rateToBase: 1.15 }]
  }), /sourceReference provenance/);

  const quote = normalizeQuote(mission, candidate, conversation, {
    fxRates: [{ currency: "EUR", rateToBase: 1.15, sourceReference: "fx/ecb/2026-08-29", asOf: "2026-08-29" }]
  });
  assert.equal(quote.fx.sourceReference, "fx/ecb/2026-08-29");
  assert.equal(quote.unitPrice.base, 402.5);
  assert.equal(quote.shipping.baseCost, 1150);
});

test("analysis ranks complete offers with transparent score components and recommendation", () => {
  const { mission, candidates } = fixture();
  const a = candidates[0];
  const b = candidates[1];
  // Equal current unit prices keep both offers currently negotiation-ready; ranking is then driven by the full normalized economics/risk/lead model.
  const conversationA = readyConversation({ mission, candidate: a, source: "a", unitPrice: 382, leadTimeDays: 18, shippingCost: 900, samplePrice: 180 });
  const conversationB = readyConversation({ mission, candidate: b, source: "b", unitPrice: 382, leadTimeDays: 14, shippingCost: 1700, samplePrice: 220 });

  const analysis = analyzeQuotes(mission, [a, b], [conversationA, conversationB], { now: "2026-08-29T14:00:00.000Z" });
  assert.equal(analysis.quotes.length, 2);
  assert.equal(analysis.blockers.length, 0);
  assert.ok(analysis.recommendation);
  const ranked = [...analysis.quotes].filter(quote => quote.rank).sort((x, y) => x.rank - y.rank);
  assert.deepEqual(ranked.map(quote => quote.rank), [1, 2]);
  assert.ok(ranked[0].score.total >= ranked[1].score.total);
  for (const quote of ranked) {
    assert.deepEqual(Object.keys(quote.score.components).sort(), ["completeness", "economics", "leadTime", "moq", "sample", "supplierQuality"].sort());
    assert.ok(Math.abs(Object.values(quote.score.weights).reduce((sum, value) => sum + value, 0) - 1) < 1e-12);
  }
  assert.equal(analysis.recommendation.supplierId, ranked[0].supplierId);
  assert.equal(analysis.recommendation.humanApprovalRequired, true);
  assert.equal(analysis.recommendation.commitmentExecuted, false);
  assert.ok(analysis.recommendation.reasons.length >= 2);
});

test("incomplete landed-cost quote stays visible but cannot outrank a complete offer", () => {
  const { mission, candidates } = fixture();
  const a = candidates[0];
  const b = candidates[1];
  // Keep prices equal so current-offer revalidation does not invalidate either offer; isolate shipping completeness only.
  const incomplete = readyConversation({ mission, candidate: a, source: "incomplete", unitPrice: 370, shippingCost: null });
  const complete = readyConversation({ mission, candidate: b, source: "complete", unitPrice: 370, shippingCost: 1000 });
  const analysis = analyzeQuotes(mission, [a, b], [incomplete, complete]);
  const incompleteQuote = analysis.quotes.find(quote => quote.supplierId === a.id);
  const completeQuote = analysis.quotes.find(quote => quote.supplierId === b.id);
  assert.equal(incompleteQuote.rank, null);
  assert.equal(incompleteQuote.score, null);
  assert.equal(incompleteQuote.comparison.rankable, false);
  assert.equal(incompleteQuote.comparison.basis, "incomplete-landed-cost");
  assert.equal(completeQuote.rank, 1);
  assert.equal(completeQuote.comparison.basis, "complete-landed-cost");
  assert.equal(analysis.recommendation.supplierId, b.id);
  assert.equal(analysis.recommendation.status, "recommended");
});

test("analysis may make a provisional recommendation when every rankable offer lacks shipping cost", () => {
  const { mission, candidates } = fixture();
  const a = candidates[0];
  const b = candidates[1];
  const first = readyConversation({ mission, candidate: a, source: "provisional-a", unitPrice: 370, shippingCost: null });
  const second = readyConversation({ mission, candidate: b, source: "provisional-b", unitPrice: 370, shippingCost: null });
  const analysis = analyzeQuotes(mission, [a, b], [first, second]);
  assert.ok(analysis.recommendation);
  assert.equal(analysis.recommendation.status, "provisional");
  assert.ok(analysis.recommendation.risks.some(risk => /shippingCost/.test(risk)));
  assert.deepEqual(analysis.quotes.filter(quote => quote.rank).map(quote => quote.comparison.basis), ["known-cost-provisional", "known-cost-provisional"]);
});

test("recommendation identity is stable across re-analysis dates when evidence is unchanged", () => {
  const { mission, candidates } = fixture();
  const a = candidates[0];
  const b = candidates[1];
  const first = readyConversation({ mission, candidate: a, source: "stable-a", unitPrice: 382, shippingCost: 900 });
  const second = readyConversation({ mission, candidate: b, source: "stable-b", unitPrice: 382, shippingCost: 1200 });
  const dayOne = analyzeQuotes(mission, [a, b], [first, second], { now: "2026-08-29T14:00:00.000Z" });
  const dayTwo = analyzeQuotes(mission, [a, b], [first, second], { now: "2026-08-30T14:00:00.000Z" });
  assert.equal(dayOne.recommendation.id, dayTwo.recommendation.id);
  assert.equal(dayOne.recommendation.quoteId, dayTwo.recommendation.quoteId);
});

test("analysis refuses to fabricate a recommendation when no quote has normalized price and technical evidence", () => {
  const { mission, candidates } = fixture();
  const candidate = candidates[0];
  const conversation = readyConversation({ mission, candidate, source: "no-fx", currency: "EUR", unitPrice: 350, shippingCost: 900 });
  const analysis = analyzeQuotes(mission, [candidate], [conversation]);
  assert.equal(analysis.recommendation, null);
  assert.match(analysis.blockers[0], /enough normalized price\/FX and technical evidence/);
});
