import test from "node:test";
import assert from "node:assert/strict";
import { APPROVAL_READY_DEMO_EXPECTATIONS, APPROVAL_READY_DEMO_SUPPLIERS } from "../lib/demo-fixture.mjs";
import { validateMission } from "../lib/domain.mjs";
import { migrateState } from "../lib/migrations.mjs";
import { createSeed, resolveSeedMode } from "../lib/seed.mjs";

test("draft is an explicit empty startup mode", () => {
  const state = createSeed({ seedMode: "draft" });
  assert.equal(state.missions[0].status, "draft");
  assert.deepEqual(state.supplierCandidates, []);
  assert.deepEqual(state.conversations, []);
  assert.deepEqual(state.quotes, []);
  assert.deepEqual(state.recommendations, []);
  assert.deepEqual(state.approvals, []);
  assert.deepEqual(state.sampleOrders, []);
});

test("unsupported startup seed modes fail closed", () => {
  assert.equal(resolveSeedMode("approval-ready"), "approval-ready");
  assert.throws(() => createSeed({ seedMode: "production-ish" }), /Unsupported Vendor Scout seed mode/);
});

test("approval-ready seed is contract-valid and stops at one pending human decision", () => {
  const state = createSeed({ seedMode: "approval-ready" });
  const mission = state.missions[0];
  const migration = migrateState(state);

  assert.deepEqual(validateMission(mission), []);
  assert.equal(migration.migrated, false);
  assert.equal(migration.state.meta.contractVersion, state.meta.contractVersion);
  assert.equal(mission.status, "awaiting_approval");
  assert.ok(state.supplierCandidates.length > 0);
  assert.ok(state.conversations.length > 0);
  assert.ok(state.conversations.every(conversation => conversation.negotiation?.offers?.length > 0));
  assert.ok(state.quotes.length > 0);
  assert.equal(state.recommendations.length, 1);
  assert.equal(state.approvals.length, 1);
  assert.equal(state.approvals[0].status, "pending");
  assert.equal(state.approvals[0].decision, null);
  assert.equal(state.approvals[0].decidedAt, null);
  assert.deepEqual(state.sampleOrders, []);
});

test("approval-ready seed matches the existing controlled decision demo economics and provenance", () => {
  const state = createSeed({ seedMode: "approval-ready" });
  const recommendation = state.recommendations[0];
  const quote = state.quotes.find(item => item.id === recommendation.quoteId);
  const approval = state.approvals[0];
  const serialized = JSON.stringify(state);

  assert.equal(state.meta.seedMode, "approval-ready");
  assert.equal(state.meta.evidenceMode, "controlled-demo");
  assert.equal(state.missions[0].id, APPROVAL_READY_DEMO_EXPECTATIONS.missionId);
  assert.equal(recommendation.supplierId, APPROVAL_READY_DEMO_EXPECTATIONS.recommendationSupplierId);
  assert.equal(recommendation.supplierName, APPROVAL_READY_DEMO_EXPECTATIONS.recommendationSupplierName);
  assert.equal(recommendation.humanApprovalRequired, true);
  assert.equal(recommendation.commitmentExecuted, false);
  assert.equal(quote.unitPrice.base, APPROVAL_READY_DEMO_EXPECTATIONS.recommendedUnitPrice);
  assert.equal(quote.leadTimeDays, APPROVAL_READY_DEMO_EXPECTATIONS.recommendedLeadTimeDays);
  assert.equal(quote.landedCost.base, APPROVAL_READY_DEMO_EXPECTATIONS.recommendedLandedCost);
  assert.equal(quote.economics.estimatedLandedSavingsBase, APPROVAL_READY_DEMO_EXPECTATIONS.projectedSavings);
  assert.equal(approval.action.estimatedSpendBase, APPROVAL_READY_DEMO_EXPECTATIONS.samplePrice);
  assert.equal(approval.action.kind, "order_sample");
  assert.equal(approval.action.withinBudget, true);

  const fixtureReferences = new Set(APPROVAL_READY_DEMO_SUPPLIERS.map(item => item.sourceReference));
  const inbound = state.conversations.flatMap(conversation => conversation.messages).filter(message => message.direction === "inbound");
  assert.equal(inbound.length, APPROVAL_READY_DEMO_SUPPLIERS.length);
  assert.ok(inbound.every(message => fixtureReferences.has(message.sourceReference)));
  assert.ok(inbound.every(message => message.content.startsWith("Controlled demo supplier response:")));
  assert.ok(state.conversations.every(conversation => {
    const outbound = conversation.messages.find(message => message.type === "rfq");
    return outbound?.delivery?.status === "simulated" &&
      outbound.delivery.provider === "controlled-preview" &&
      outbound.delivery.externalMessageId === null;
  }));
  assert.ok(state.quotes.every(item => fixtureReferences.has(item.sourceReference)));
  assert.doesNotMatch(serialized, /external order id|external spend occurred|live email (?:was )?sent/i);
});
