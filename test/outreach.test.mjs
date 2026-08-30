import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { buildRfq, createRfqConversation, deliverRfq, isExternallyAccepted, outboundRfqMessage, recordSupplierReply, RFQ_REQUESTED_FIELDS } from "../lib/outreach.mjs";
import { createSeed } from "../lib/seed.mjs";

function qualifiedFixture() {
  const state = createSeed({ missionStage: "contacting" });
  return {
    mission: state.missions[0],
    candidate: state.supplierCandidates.find(candidate => candidate.status === "qualified")
  };
}

test("RFQ requests the complete quote packet without making a commitment", () => {
  const { mission, candidate } = qualifiedFixture();
  const rfq = buildRfq(mission, candidate);
  assert.ok(rfq.to.endsWith(".example"));
  assert.equal(rfq.requestedFields.length, RFQ_REQUESTED_FIELDS.length);
  for (const field of RFQ_REQUESTED_FIELDS) assert.match(rfq.body, new RegExp(field.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i"));
  assert.match(rfq.body, /non-binding request for quotation/i);
  assert.match(rfq.body, /No purchase commitment/i);
  assert.match(rfq.body, /360° scan/);
});

test("RFQ conversation IDs and outbound idempotency keys are stable", () => {
  const { mission, candidate } = qualifiedFixture();
  const first = createRfqConversation(mission, candidate, "2026-08-29T12:00:00.000Z");
  const second = createRfqConversation(mission, candidate, "2026-08-29T13:00:00.000Z");
  assert.equal(first.id, second.id);
  const firstMessage = outboundRfqMessage(first);
  const secondMessage = outboundRfqMessage(second);
  assert.equal(firstMessage.id, secondMessage.id);
  assert.equal(firstMessage.delivery.idempotencyKey, secondMessage.delivery.idempotencyKey);
  assert.equal(first.status, "rfq_draft");
});

test("controlled outreach preview is visibly simulated and never counts as external contact", async () => {
  const { mission, candidate } = qualifiedFixture();
  const conversation = createRfqConversation(mission, candidate);
  const message = outboundRfqMessage(conversation);
  const result = await deliverRfq({ mission, candidate, conversation, message }, { url: null, allowControlledPreview: true });
  assert.equal(result.provider, "controlled-preview");
  assert.equal(result.status, "simulated");
  assert.equal(result.simulated, true);
  message.delivery = { ...message.delivery, ...result };
  assert.equal(isExternallyAccepted(message), false);
});

test("fixture .example contacts cannot leak to a real outreach provider", async t => {
  let requests = 0;
  const server = http.createServer((req, res) => {
    requests += 1;
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ status: "accepted", messageId: "provider-1" }));
  });
  await new Promise((resolve, reject) => { server.once("error", reject); server.listen(0, "127.0.0.1", resolve); });
  t.after(() => new Promise(resolve => server.close(resolve)));
  const { port } = server.address();
  const { mission, candidate } = qualifiedFixture();
  const conversation = createRfqConversation(mission, candidate);
  await assert.rejects(
    deliverRfq({ mission, candidate, conversation, message: outboundRfqMessage(conversation) }, { url: `http://127.0.0.1:${port}`, allowControlledPreview: false }),
    /\.example supplier contacts/
  );
  assert.equal(requests, 0);
});

test("remote outreach uses an idempotency key and records real acceptance", async t => {
  let received;
  const server = http.createServer(async (req, res) => {
    let raw = "";
    for await (const chunk of req) raw += chunk;
    received = { key: req.headers["idempotency-key"], body: JSON.parse(raw) };
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ status: "accepted", messageId: "provider-42" }));
  });
  await new Promise((resolve, reject) => { server.once("error", reject); server.listen(0, "127.0.0.1", resolve); });
  t.after(() => new Promise(resolve => server.close(resolve)));
  const { port } = server.address();

  const { mission, candidate } = qualifiedFixture();
  const liveCandidate = structuredClone(candidate);
  liveCandidate.contact = { email: "rfq@supplier.test", sourceReference: "https://supplier.test/contact" };
  const conversation = createRfqConversation(mission, liveCandidate);
  const message = outboundRfqMessage(conversation);
  const result = await deliverRfq({ mission, candidate: liveCandidate, conversation, message }, { url: `http://127.0.0.1:${port}`, allowControlledPreview: false });
  assert.equal(result.provider, "remote-outreach");
  assert.equal(result.status, "accepted");
  assert.equal(result.externalMessageId, "provider-42");
  assert.equal(received.key, message.delivery.idempotencyKey);
  assert.equal(received.body.message.to, "rfq@supplier.test");
});

test("supplier reply persistence is provenance-required and idempotent", () => {
  const { mission, candidate } = qualifiedFixture();
  const conversation = createRfqConversation(mission, candidate);
  assert.throws(() => recordSupplierReply(conversation, { content: "Quote attached" }), /sourceReference/);

  recordSupplierReply(conversation, {
    content: "We can quote $381 per unit with a 17 day lead time.",
    sourceReference: "gmail/message/abc",
    providerMessageId: "abc",
    receivedAt: "2026-08-29T15:00:00.000Z"
  });
  recordSupplierReply(conversation, {
    content: "We can quote $381 per unit with a 17 day lead time.",
    sourceReference: "gmail/message/abc",
    providerMessageId: "abc",
    receivedAt: "2026-08-29T15:00:00.000Z"
  });
  assert.equal(conversation.messages.filter(message => message.direction === "inbound").length, 1);
  assert.equal(conversation.status, "supplier_replied");
});
