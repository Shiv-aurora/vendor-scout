import { createHash } from "node:crypto";

const MAX_RESPONSE_BYTES = 256 * 1024;

function stableId(prefix, ...parts) {
  const digest = createHash("sha256").update(parts.join("\n")).digest("hex").slice(0, 18);
  return `${prefix}-${digest}`;
}

function normalizeProviderUrl(value) {
  if (!value) return null;
  const url = new URL(value);
  const loopback = ["localhost", "127.0.0.1", "::1"].includes(url.hostname);
  if (url.username || url.password) throw new Error("Sample-order credentials must not be embedded in VENDOR_SCOUT_ORDER_URL");
  if (process.env.NODE_ENV === "production" && url.protocol !== "https:" && !loopback) {
    throw new Error("Production sample-order provider must use HTTPS unless loopback-local");
  }
  return url;
}

async function readBoundedJson(response) {
  const declaredHeader = response.headers.get("content-length");
  const declared = declaredHeader == null ? null : Number(declaredHeader);
  if (Number.isFinite(declared) && declared > MAX_RESPONSE_BYTES) {
    await response.body?.cancel().catch(() => {});
    throw new Error("Sample-order provider response is too large");
  }

  const chunks = [];
  let totalBytes = 0;
  if (response.body) {
    const reader = response.body.getReader();
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        totalBytes += value.byteLength;
        if (totalBytes > MAX_RESPONSE_BYTES) {
          await reader.cancel("Sample-order provider response exceeded size limit").catch(() => {});
          throw new Error("Sample-order provider response is too large");
        }
        chunks.push(Buffer.from(value));
      }
    } finally {
      try { reader.releaseLock(); } catch {}
    }
  }

  const raw = Buffer.concat(chunks, totalBytes).toString("utf8");
  let payload = {};
  if (raw) {
    try { payload = JSON.parse(raw); } catch { throw new Error("Sample-order provider returned invalid JSON"); }
  }
  if (!response.ok) throw new Error(String(payload?.error || payload?.message || `Sample-order provider returned ${response.status}`));
  return payload;
}

export function createSampleOrder(mission, approval, quote, now = new Date().toISOString()) {
  if (!mission || !approval || !quote) throw new Error("Mission, approval, and quote are required");
  if (mission.status !== "approved") throw new Error("Mission must be approved before sample execution");
  if (approval.status !== "approved" || approval.decision !== "approve") throw new Error("A human-approved decision is required before sample execution");
  if (approval.action?.kind !== "order_sample") throw new Error("The approved action is not a sample order");
  if (approval.quoteId !== quote.id || approval.missionId !== mission.id) throw new Error("Approved action does not match the selected quote");
  const samplePrice = quote.sample?.basePrice;
  const approvedSamplePrice = approval.action?.estimatedSpendBase;
  if (quote.sample?.available !== true || !Number.isFinite(samplePrice)) throw new Error("Recommended quote does not contain an orderable sample price");
  if (!Number.isFinite(approvedSamplePrice) || approval.action?.withinBudget !== true) throw new Error("Human approval does not contain an executable sample spend");
  if (quote.baseCurrency !== approval.action.currency) throw new Error("Sample currency no longer matches the human-approved action; fresh approval required");
  if (Math.abs(samplePrice - approvedSamplePrice) > 1e-9) throw new Error("Sample price no longer matches the human-approved spend; fresh approval required");
  if (approvedSamplePrice > mission.constraints.sampleBudget) throw new Error("Sample price exceeds the mission sample budget");

  return {
    id: stableId("sample-order", mission.id, approval.id, quote.id),
    missionId: mission.id,
    approvalId: approval.id,
    quoteId: quote.id,
    supplierId: quote.supplierId,
    supplierName: quote.supplierName,
    quantity: approval.action.quantity || 1,
    unitPriceBase: approvedSamplePrice,
    totalBase: approvedSamplePrice * (approval.action.quantity || 1),
    currency: quote.baseCurrency,
    sourceReference: quote.sourceReference,
    status: "prepared",
    provider: null,
    simulated: null,
    externalOrderId: null,
    idempotencyKey: stableId("order-key", mission.id, approval.id, quote.id),
    createdAt: now,
    submittedAt: null,
    completedAt: null,
    error: null
  };
}

export async function submitSampleOrder(order, { allowControlledPreview = false } = {}) {
  const providerUrl = normalizeProviderUrl(process.env.VENDOR_SCOUT_ORDER_URL);
  const token = process.env.VENDOR_SCOUT_ORDER_TOKEN || "";
  const now = new Date().toISOString();

  if (!providerUrl) {
    if (!allowControlledPreview) throw new Error("No sample-order provider is configured");
    return {
      status: "simulated",
      provider: "controlled-sample-order",
      simulated: true,
      externalOrderId: null,
      submittedAt: now
    };
  }

  const response = await fetch(providerUrl, {
    method: "POST",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
      "Idempotency-Key": order.idempotencyKey,
      ...(token ? { Authorization: `Bearer ${token}` } : {})
    },
    body: JSON.stringify({
      orderId: order.id,
      supplierId: order.supplierId,
      supplierName: order.supplierName,
      quantity: order.quantity,
      unitPrice: order.unitPriceBase,
      total: order.totalBase,
      currency: order.currency,
      approvalId: order.approvalId,
      quoteId: order.quoteId,
      sourceReference: order.sourceReference
    }),
    signal: AbortSignal.timeout(15_000)
  });
  const payload = await readBoundedJson(response);
  const externalOrderId = payload.orderId || payload.id || payload.externalOrderId;
  if (!externalOrderId) throw new Error("Sample-order provider response is missing an order ID");
  return {
    status: "submitted",
    provider: "remote-order-provider",
    simulated: false,
    externalOrderId: String(externalOrderId),
    submittedAt: now
  };
}
