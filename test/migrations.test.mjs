import test from "node:test";
import assert from "node:assert/strict";
import { createSeed } from "../lib/seed.mjs";
import { CURRENT_CONTRACT_VERSION, migrateState } from "../lib/migrations.mjs";

test("known procurement state migrates without replacing mission data", () => {
  const original = createSeed({ missionStage: "contacting" });
  original.meta.contractVersion = "2.0.0";
  original.missions[0].title = "Preserve this mission";
  original.supplierCandidates[0].name = "Preserve this supplier";

  const result = migrateState(original);
  assert.equal(result.migrated, true);
  assert.equal(result.state.meta.contractVersion, CURRENT_CONTRACT_VERSION);
  assert.equal(result.state.missions[0].title, "Preserve this mission");
  assert.equal(result.state.supplierCandidates[0].name, "Preserve this supplier");
  assert.equal(result.state.meta.migratedFrom, "2.0.0");
});

test("unknown state versions fail closed instead of resetting data", () => {
  const state = createSeed({ missionStage: "draft" });
  state.meta.contractVersion = "legacy-unknown";
  assert.throws(() => migrateState(state), /Refusing to overwrite stored data/);
});
