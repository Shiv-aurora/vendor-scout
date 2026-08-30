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
const suppliers = [
  {
    id: "supplier-heliomotion",
    source: "controlled/demo-reply/heliomotion-final",
    providerMessageId: "controlled-heliomotion-final",
    reply: "Controlled demo supplier response: USD 382 per unit for 500 units, MOQ 100, 18-day production lead, DDP Philadelphia, shipping USD 900 total, one evaluation sample available for USD 180, all listed technical requirements confirmed.",
    offer: { unitPrice: 382, currency: "USD", moq: 100, leadTimeDays: 18, shippingTerms: "DDP Philadelphia", shippingCost: 900, sampleAvailable: true, samplePrice: 180, technicalConfirmed: true }
  },
  {
    id: "supplier-scanworks",
    source: "controlled/demo-reply/scanworks-final",
    providerMessageId: "controlled-scanworks-final",
    reply: "Controlled demo supplier response: USD 382 per unit for 500 units, MOQ 250, 14-day production lead, DDP Philadelphia, shipping USD 1300 total, one evaluation sample available for USD 220, all listed technical requirements confirmed.",
    offer: { unitPrice: 382, currency: "USD", moq: 250, leadTimeDays: 14, shippingTerms: "DDP Philadelphia", shippingCost: 1300, sampleAvailable: true, samplePrice: 220, technicalConfirmed: true }
  }
];

await post("/api/dev/reset", { stage: "contacting" });
await post(`/api/missions/${missionId}/actions`, { action: "prepare_outreach" });
await post(`/api/missions/${missionId}/actions`, { action: "send_outreach" });

for (const supplier of suppliers) {
  await post(`/api/missions/${missionId}/suppliers/${supplier.id}/reply`, {
    content: supplier.reply,
    sourceReference: supplier.source,
    providerMessageId: supplier.providerMessageId,
    receivedAt: new Date().toISOString()
  });
  await post(`/api/missions/${missionId}/suppliers/${supplier.id}/offer`, {
    sourceReference: supplier.source,
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
