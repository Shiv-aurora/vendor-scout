import test from "node:test";
import assert from "node:assert/strict";
import { riskScore, severityFor, transitionSource, validateObservation } from "../lib/domain.mjs";
test("severe shortage produces a critical score", () => { const score=riskScore({inventory:617,previousInventory:2100,leadTimeDays:42,supplierCount:1,lifecycle:"active",criticality:1,sourceConfidence:.96}); assert.ok(score>=80); assert.equal(severityFor(score),"critical"); });
test("healthy component stays low risk", () => { const score=riskScore({inventory:30000,previousInventory:31000,leadTimeDays:5,supplierCount:4,lifecycle:"active",criticality:.6,sourceConfidence:.98}); assert.ok(score<35); assert.equal(severityFor(score),"low"); });
test("unknown stock remains valid and is not converted to zero", () => { const errors=validateObservation({componentId:"c",supplierId:"s",sourceId:"x",collectedAt:new Date().toISOString(),inventory:null,provenance:{reference:"local-sample",kind:"sample"}}); assert.deepEqual(errors,[]); assert.ok(validateObservation({inventory:-1,provenance:{}}).length>0); });
test("healing state machine requires verification", () => { assert.equal(transitionSource("healthy","invalid"),"degraded"); assert.equal(transitionSource("degraded","heal"),"healing"); assert.equal(transitionSource("healing","verified"),"recovered"); });
