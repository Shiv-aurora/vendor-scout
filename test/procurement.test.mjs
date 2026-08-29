import test from "node:test";
import assert from "node:assert/strict";
import { createSeed } from "../lib/seed.mjs";
import { CURRENT_CONTRACT_VERSION } from "../lib/migrations.mjs";

test("default demo seed is internally consistent and ready for outreach", () => {
  const state = createSeed();
  assert.equal(state.meta.contractVersion, CURRENT_CONTRACT_VERSION);
  assert.equal(state.organization.name, "Atlas Robotics");
  assert.equal(state.missions.length, 1);
  assert.equal(state.missions[0].componentId, "cmp-lidar");
  assert.equal(state.missions[0].quantity, 500);
  assert.equal(state.missions[0].status, "contacting");
  assert.ok(state.supplierCandidates.length >= 4);
  assert.ok(state.supplierCandidates.every(candidate => candidate.status !== "discovered"));
});

test("draft replay seed contains the mission but no precomputed supplier work", () => {
  const state = createSeed({ missionStage: "draft" });
  assert.equal(state.missions[0].status, "draft");
  assert.deepEqual(state.supplierCandidates, []);
  assert.equal(state.activity.length, 1);
});

test("supplier candidates preserve qualification evidence and provenance", () => {
  const state = createSeed();
  assert.ok(state.supplierCandidates.some(candidate => candidate.status === "qualified"));
  assert.ok(state.supplierCandidates.some(candidate => candidate.status === "rejected"));
  assert.ok(state.supplierCandidates.some(candidate => candidate.status === "needs_review"));
  for (const candidate of state.supplierCandidates) {
    assert.ok(candidate.reason);
    assert.ok(candidate.source?.reference);
    assert.ok(candidate.qualification?.checks);
    assert.equal(candidate.missionId, state.missions[0].id);
  }
});

test("foundation does not fake outreach, quotes, approvals, or sample orders", () => {
  const state = createSeed();
  assert.deepEqual(state.conversations, []);
  assert.deepEqual(state.quotes, []);
  assert.deepEqual(state.approvals, []);
  assert.deepEqual(state.sampleOrders, []);
});
