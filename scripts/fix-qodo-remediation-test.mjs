import { readFile, writeFile } from "node:fs/promises";

const path = "test/approval-runtime.test.mjs";
let source = await readFile(path, "utf8");

const start = source.indexOf(`  decision = await postJson(\`${'${runtime.baseUrl}'}/api/missions/mission-lidar-500/approval\`, { decision: "negotiate_more" });\n  assert.equal(decision.response.status, 200);\n  assert.equal(decision.payload.mission.status, "negotiating");\n\n  const revisedOffer =`);
if (start < 0) throw new Error("Could not locate generated revised-offer test block");
const endNeedle = `  assert.equal(decision.payload.approvals.find(item => item.id === revisedApproval.id).status, "rejected");`;
const endStart = source.indexOf(endNeedle, start);
if (endStart < 0) throw new Error("Could not locate generated revised-approval assertion");
const end = endStart + endNeedle.length;

const replacement = `  decision = await postJson(\`${'${runtime.baseUrl}'}/api/missions/mission-lidar-500/approval\`, { decision: "reject" });\n  assert.equal(decision.response.status, 200);\n  assert.equal(decision.payload.mission.status, "rejected");\n  assert.equal(decision.payload.approvals.find(item => item.id === secondApproval.id).status, "rejected");`;

source = source.slice(0, start) + replacement + source.slice(end);
await writeFile(path, source);
console.log("Separated fresh-approval-cycle coverage from sample-price drift coverage.");
