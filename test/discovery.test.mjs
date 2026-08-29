import test from "node:test";
import assert from "node:assert/strict";
import { discoverFixtureSuppliers, discoverSuppliers } from "../lib/discovery.mjs";
import { qualifySupplier, validateMission } from "../lib/domain.mjs";
import { createSeed } from "../lib/seed.mjs";

test("mission validates with every sourcing constraint required by Phase 2", () => {
  const mission = createSeed({ missionStage: "draft" }).missions[0];
  assert.deepEqual(validateMission(mission), []);

  const invalid = structuredClone(mission);
  invalid.constraints.regions = [];
  invalid.constraints.minimumConfidence = 2;
  invalid.constraints.sampleBudget = -1;
  const errors = validateMission(invalid);
  assert.ok(errors.some(error => error.includes("region")));
  assert.ok(errors.some(error => error.includes("confidence")));
  assert.ok(errors.some(error => error.includes("sample budget")));
});

test("controlled discovery executes against mission regions and preserves provenance", () => {
  const mission = createSeed({ missionStage: "draft" }).missions[0];
  const candidates = discoverFixtureSuppliers(mission);
  assert.ok(candidates.length >= 4);
  for (const candidate of candidates) {
    assert.equal(candidate.missionId, mission.id);
    assert.ok(mission.constraints.regions.includes(candidate.region));
    assert.equal(candidate.status, "discovered");
    assert.equal(candidate.source.kind, "controlled-fixture");
    assert.ok(candidate.source.reference);
  }
});

test("discovery adapter uses controlled fallback only when allowed", async () => {
  const mission = createSeed({ missionStage: "draft" }).missions[0];
  const result = await discoverSuppliers(mission, { url: null, allowFixtureFallback: true });
  assert.equal(result.provider, "controlled-fixture");
  assert.equal(result.fallbackUsed, true);
  assert.ok(result.candidates.length >= 4);

  await assert.rejects(
    discoverSuppliers(mission, { url: null, allowFixtureFallback: false }),
    /not configured/
  );
});

test("qualification applies mission constraints and produces explainable decisions", () => {
  const mission = createSeed({ missionStage: "draft" }).missions[0];
  const candidates = discoverFixtureSuppliers(mission).map(candidate => qualifySupplier(mission, candidate, "2026-08-29T12:00:00.000Z"));
  assert.ok(candidates.some(candidate => candidate.status === "qualified"));
  assert.ok(candidates.some(candidate => candidate.status === "needs_review"));
  assert.ok(candidates.some(candidate => candidate.status === "rejected"));
  for (const candidate of candidates) {
    assert.ok(candidate.reason);
    assert.ok(candidate.qualification?.checks);
    assert.equal(candidate.qualification.evaluatedAt, "2026-08-29T12:00:00.000Z");
  }
});
