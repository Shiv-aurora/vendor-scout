import test from "node:test";
import assert from "node:assert/strict";
import { createSeed } from "../lib/seed.mjs";
import { createRfqConversation, recordSupplierReply } from "../lib/outreach.mjs";
import { evaluateOffer, latestOffer, prepareCounter, recordOfferTerms } from "../lib/negotiation.mjs";

function negotiationFixture() {
  const state = createSeed({ missionStage: "contacting" });
  const mission = state.missions[0];
  const candidate = state.supplierCandidates.find(item => item.status === "qualified");
  candidate.contact = { email: "sales@supplier.test", sourceReference: "https://supplier.test/contact" };
  const conversation = createRfqConversation(mission, candidate, "2026-08-29T12:00:00.000Z");
  recordSupplierReply(conversation, {
    content: "We can offer USD 405/unit, MOQ 600, 28-day lead time. FOB Shenzhen. Samples are available for USD 240.",
    sourceReference: "gmail/message/offer-1",
    providerMessageId: "offer-1",
    receivedAt: "2026-08-29T13:00:00.000Z"
  });
  return { mission, candidate, conversation };
}

test("offer terms must be anchored to a persisted supplier reply", () => {
  const { conversation } = negotiationFixture();
  assert.throws(() => recordOfferTerms(conversation, {
    sourceReference: "gmail/message/not-recorded",
    unitPrice: 405,
    currency: "USD"
  }), /persisted supplier reply/);

  const offer = recordOfferTerms(conversation, {
    sourceReference: "gmail/message/offer-1",
    unitPrice: 405,
    currency: "usd",
    moq: 600,
    leadTimeDays: 28,
    shippingTerms: "FOB Shenzhen",
    sampleAvailable: true,
    samplePrice: 240,
    technicalConfirmed: true
  }, { extractedAt: "2026-08-29T13:05:00.000Z" });
  assert.equal(offer.sourceReference, "gmail/message/offer-1");
  assert.equal(offer.currency, "USD");
  assert.equal(latestOffer(conversation).id, offer.id);
  assert.equal(conversation.status, "negotiating");
});

test("negotiation evaluation identifies price MOQ and lead-time gaps without inventing missing data", () => {
  const { mission, candidate, conversation } = negotiationFixture();
  const offer = recordOfferTerms(conversation, {
    sourceReference: "gmail/message/offer-1",
    unitPrice: 405,
    currency: "USD",
    moq: 600,
    leadTimeDays: 28,
    shippingTerms: "FOB Shenzhen",
    sampleAvailable: true,
    samplePrice: 240,
    technicalConfirmed: true
  });
  const evaluation = evaluateOffer(mission, candidate, offer);
  assert.equal(evaluation.status, "counter_required");
  assert.deepEqual(evaluation.gaps.map(gap => gap.field).sort(), ["leadTimeDays", "moq", "unitPrice"]);
  assert.equal(evaluation.missingFields.length, 0);
  assert.equal(evaluation.gaps.find(gap => gap.field === "unitPrice").target, mission.constraints.targetUnitPrice);
});

test("same-currency competing offers can tighten the counter benchmark without exposing supplier identity", () => {
  const { mission, candidate, conversation } = negotiationFixture();
  const offer = recordOfferTerms(conversation, {
    sourceReference: "gmail/message/offer-1",
    unitPrice: 398,
    currency: "USD",
    moq: 100,
    leadTimeDays: 18,
    shippingTerms: "FOB",
    sampleAvailable: true,
    samplePrice: 200,
    technicalConfirmed: true
  });
  const evaluation = evaluateOffer(mission, candidate, offer, [{ unitPrice: 385, currency: "USD" }]);
  assert.equal(evaluation.competitorBenchmark, 385);
  assert.equal(evaluation.gaps.find(gap => gap.field === "unitPrice").target, 385);

  const prepared = prepareCounter(mission, candidate, conversation, [{ unitPrice: 385, currency: "USD" }]);
  assert.match(prepared.message.content, /USD 385\.00 or better/);
  assert.doesNotMatch(prepared.message.content, /competitor|supplier identity|385.*supplier/i);
  assert.match(prepared.message.content, /non-binding/i);
  assert.match(prepared.message.content, /does not accept any commercial terms/i);
});

test("counter preparation is stable for the same offer and only asks evidence-backed gaps", () => {
  const { mission, candidate, conversation } = negotiationFixture();
  recordOfferTerms(conversation, {
    sourceReference: "gmail/message/offer-1",
    unitPrice: 410,
    currency: "USD",
    moq: null,
    leadTimeDays: 17,
    shippingTerms: null,
    sampleAvailable: null,
    technicalConfirmed: null
  });
  const first = prepareCounter(mission, candidate, conversation);
  const second = prepareCounter(mission, candidate, conversation);
  assert.equal(first.message.id, second.message.id);
  assert.equal(first.message.delivery.idempotencyKey, second.message.delivery.idempotencyKey);
  assert.equal(conversation.messages.filter(message => message.type === "counter").length, 1);
  assert.match(first.message.content, /Confirm the minimum order quantity/);
  assert.match(first.message.content, /Confirm shipping terms/);
  assert.match(first.message.content, /Confirm whether evaluation samples are available/);
  assert.match(first.message.content, /Confirm the offered part meets/);
  assert.doesNotMatch(first.message.content, /sample pricing/);
});

test("an offer that satisfies negotiation constraints becomes ready for comparison instead of being auto-accepted", () => {
  const { mission, candidate, conversation } = negotiationFixture();
  recordOfferTerms(conversation, {
    sourceReference: "gmail/message/offer-1",
    unitPrice: 385,
    currency: "USD",
    moq: 100,
    leadTimeDays: 18,
    shippingTerms: "DDP Philadelphia",
    shippingCost: 750,
    sampleAvailable: true,
    samplePrice: 180,
    technicalConfirmed: true
  });
  const result = prepareCounter(mission, candidate, conversation);
  assert.equal(result.evaluation.status, "ready_for_comparison");
  assert.equal(result.message, null);
  assert.equal(conversation.status, "offer_ready");
  assert.equal(conversation.messages.filter(message => message.type === "counter").length, 0);
});

test("explicit technical incompatibility stops autonomous countering for human judgment", () => {
  const { mission, candidate, conversation } = negotiationFixture();
  recordOfferTerms(conversation, {
    sourceReference: "gmail/message/offer-1",
    unitPrice: 370,
    currency: "USD",
    moq: 100,
    leadTimeDays: 15,
    shippingTerms: "FOB",
    sampleAvailable: true,
    samplePrice: 180,
    technicalConfirmed: false
  });
  const result = prepareCounter(mission, candidate, conversation);
  assert.equal(result.evaluation.status, "reject_recommended");
  assert.equal(result.message, null);
  assert.equal(conversation.status, "human_review");
});
