import test from "node:test";
import assert from "node:assert/strict";
import { createSeed } from "../lib/seed.mjs";

test("seed centers the product on a persistent sourcing mission", () => {
  const state = createSeed();
  assert.equal(state.meta.contractVersion, "2.0.0");
  assert.equal(state.organization.name, "Atlas Robotics");
  assert.equal(state.missions.length, 1);
  assert.equal(state.missions[0].componentId, "cmp-lidar");
  assert.equal(state.missions[0].quantity, 500);
  assert.equal(state.missions[0].status, "qualifying");
});

test("supplier candidates preserve qualification evidence and provenance", () => {
  const state = createSeed();
  assert.ok(state.supplierCandidates.length >= 4);
  assert.ok(state.supplierCandidates.some(candidate => candidate.status === "qualified"));
  assert.ok(state.supplierCandidates.some(candidate => candidate.status === "rejected"));
  assert.ok(state.supplierCandidates.some(candidate => candidate.status === "needs_review"));
  for (const candidate of state.supplierCandidates) {
    assert.ok(candidate.reason);
    assert.ok(candidate.source?.reference);
    assert.equal(candidate.missionId, state.missions[0].id);
  }
});

test("foundation does not fake completed outreach, quotes, or approvals", () => {
  const state = createSeed();
  assert.deepEqual(state.conversations, []);
  assert.deepEqual(state.quotes, []);
  assert.deepEqual(state.approvals, []);
  assert.deepEqual(state.sampleOrders, []);
});
