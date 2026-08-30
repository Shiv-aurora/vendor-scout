import { APPROVAL_READY_DEMO_SUPPLIERS } from "../lib/demo-fixture.mjs";

const baseUrl = (process.argv[2] || process.env.VENDOR_SCOUT_BASE_URL || "http://127.0.0.1:3000").replace(/\/$/, "");

async function post(path, body) {
  const response = await fetch(`${baseUrl}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify(body)
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(`${path}: ${payload.error || response.status}`);
  return payload;
}

const missionId = "mission-lidar-500";
const suppliers = APPROVAL_READY_DEMO_SUPPLIERS;

await post("/api/dev/reset", { stage: "contacting" });
await post(`/api/missions/${missionId}/actions`, { action: "prepare_outreach" });
await post(`/api/missions/${missionId}/actions`, { action: "send_outreach" });

for (const supplier of suppliers) {
  await post(`/api/missions/${missionId}/suppliers/${supplier.id}/reply`, {
    content: supplier.reply,
    sourceReference: supplier.sourceReference,
    providerMessageId: supplier.providerMessageId,
    receivedAt: new Date().toISOString()
  });
  await post(`/api/missions/${missionId}/suppliers/${supplier.id}/offer`, {
    sourceReference: supplier.sourceReference,
    ...supplier.offer
  });
  await post(`/api/missions/${missionId}/suppliers/${supplier.id}/counter`, { action: "prepare" });
}

const result = await post(`/api/missions/${missionId}/analysis`, { fxRates: [] });
const approval = result.approvals?.find(item => item.status === "pending");
if (result.mission?.status !== "awaiting_approval" || !approval) {
  throw new Error(`Demo did not reach approval: ${JSON.stringify({ status: result.mission?.status, approvals: result.approvals?.map(item => item.status) })}`);
}
console.log(JSON.stringify({
  missionStatus: result.mission.status,
  recommendation: result.recommendations?.[0]?.supplierName,
  approvalId: approval.id,
  action: approval.action,
  note: "All supplier messages in this demo builder are explicitly controlled evidence; no real supplier was contacted."
}, null, 2));
