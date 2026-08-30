import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { buildApprovalPacket, applyApprovalDecision } from "../lib/approval.mjs";
import { createSampleOrder, submitSampleOrder } from "../lib/orders.mjs";

function fixture() {
  const mission = {
    id: "mission-1",
    status: "awaiting_approval",
    quantity: 500,
    currentSupplier: { name: "Current Co", unitPrice: 429, currency: "USD", leadTimeDays: 42 },
    constraints: { sampleBudget: 500 }
  };
  const supplier = {
    id: "supplier-1", missionId: mission.id, name: "Better Supplier", confidence: .93, specMatch: .96,
    status: "qualified", reason: "Qualified", source: { kind: "live", reference: "source/supplier" }
  };
  const quote = {
    id: "quote-1", missionId: mission.id, supplierId: supplier.id, supplierName: supplier.name,
    sourceReference: "mail/final", baseCurrency: "USD", originalCurrency: "USD", rank: 1,
    unitPrice: { base: 380, original: 380 }, landedCost: { base: 191000, complete: true }, knownTotal: { base: 191000 },
    economics: { estimatedLandedSavingsBase: 23500, estimatedLandedSavingsPercent: 10.96 },
    leadTimeDays: 16, moq: 100, shipping: { terms: "DDP Philadelphia", baseCost: 1000 },
    supplierRiskScore: 8, score: { total: 94.2 }, sample: { available: true, basePrice: 180 }
  };
  const recommendation = {
    id: "recommendation-1", missionId: mission.id, quoteId: quote.id, supplierId: supplier.id,
    status: "recommended", reasons: ["Best landed cost"], risks: [], humanApprovalRequired: true, commitmentExecuted: false
  };
  return { mission, supplier, quote, recommendation };
}

test("approval packet contains fast-decision evidence and a budget-safe sample action", () => {
  const { mission, supplier, quote, recommendation } = fixture();
  const approval = buildApprovalPacket(mission, recommendation, quote, supplier, []);
  assert.equal(approval.status, "pending");
  assert.equal(approval.action.kind, "order_sample");
  assert.equal(approval.action.withinBudget, true);
  assert.equal(approval.action.estimatedSpendBase, 180);
  assert.equal(approval.packet.currentSupplier.unitPrice, 429);
  assert.equal(approval.packet.proposed.landedCostBase, 191000);
  assert.equal(approval.packet.proposed.savingsBase, 23500);
  assert.equal(approval.packet.qualification.source.reference, "source/supplier");
});

test("approval decision is explicit and cannot be replayed", () => {
  const { mission, supplier, quote, recommendation } = fixture();
  const approval = buildApprovalPacket(mission, recommendation, quote, supplier, []);
  applyApprovalDecision(approval, "approve", "2026-08-30T02:00:00.000Z");
  assert.equal(approval.status, "approved");
  assert.equal(approval.decision, "approve");
  assert.throws(() => applyApprovalDecision(approval, "approve"), /not pending/);
});

test("sample order refuses execution before the mission and human decision are approved", () => {
  const { mission, supplier, quote, recommendation } = fixture();
  const approval = buildApprovalPacket(mission, recommendation, quote, supplier, []);
  assert.throws(() => createSampleOrder(mission, approval, quote), /Mission must be approved/);
  mission.status = "approved";
  assert.throws(() => createSampleOrder(mission, approval, quote), /human-approved decision/);
  applyApprovalDecision(approval, "approve");
  const order = createSampleOrder(mission, approval, quote);
  assert.equal(order.totalBase, 180);
  assert.equal(order.status, "prepared");
});

test("controlled sample execution is explicit and never claims external spend", async () => {
  const { mission, supplier, quote, recommendation } = fixture();
  mission.status = "approved";
  const approval = buildApprovalPacket({ ...mission, status: "awaiting_approval" }, recommendation, quote, supplier, []);
  applyApprovalDecision(approval, "approve");
  const order = createSampleOrder(mission, approval, quote);
  const previous = process.env.VENDOR_SCOUT_ORDER_URL;
  delete process.env.VENDOR_SCOUT_ORDER_URL;
  try {
    const result = await submitSampleOrder(order, { allowControlledPreview: true });
    assert.equal(result.status, "simulated");
    assert.equal(result.simulated, true);
    assert.equal(result.provider, "controlled-sample-order");
    assert.equal(result.externalOrderId, null);
  } finally {
    if (previous == null) delete process.env.VENDOR_SCOUT_ORDER_URL; else process.env.VENDOR_SCOUT_ORDER_URL = previous;
  }
});

test("remote sample provider receives stable idempotency key and returns real order id", async t => {
  const requests = [];
  const server = http.createServer(async (req, res) => {
    let raw = "";
    for await (const chunk of req) raw += chunk;
    requests.push({ key: req.headers["idempotency-key"], body: JSON.parse(raw) });
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ orderId: "external-order-1" }));
  });
  await new Promise((resolve, reject) => { server.once("error", reject); server.listen(0, "127.0.0.1", resolve); });
  t.after(() => new Promise(resolve => server.close(resolve)));
  const { port } = server.address();

  const { mission, supplier, quote, recommendation } = fixture();
  mission.status = "approved";
  const approval = buildApprovalPacket({ ...mission, status: "awaiting_approval" }, recommendation, quote, supplier, []);
  applyApprovalDecision(approval, "approve");
  const order = createSampleOrder(mission, approval, quote);
  const previous = process.env.VENDOR_SCOUT_ORDER_URL;
  process.env.VENDOR_SCOUT_ORDER_URL = `http://127.0.0.1:${port}`;
  try {
    const result = await submitSampleOrder(order);
    assert.equal(result.status, "submitted");
    assert.equal(result.simulated, false);
    assert.equal(result.externalOrderId, "external-order-1");
    assert.equal(requests.length, 1);
    assert.equal(requests[0].key, order.idempotencyKey);
    assert.equal(requests[0].body.approvalId, approval.id);
  } finally {
    if (previous == null) delete process.env.VENDOR_SCOUT_ORDER_URL; else process.env.VENDOR_SCOUT_ORDER_URL = previous;
  }
});
