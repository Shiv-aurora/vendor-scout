import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { spawn } from "node:child_process";
import { mkdtemp } from "node:fs/promises";
import net from "node:net";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { handleMcpMessage } from "../lib/mcp.mjs";
import { TrueForgeClient } from "../lib/trueforge.mjs";
import { createSeed } from "../lib/seed.mjs";
import { createRfqConversation, deliverRfq, outboundRfqMessage, recordSupplierReply } from "../lib/outreach.mjs";
import { evaluateOffer, prepareCounter, recordOfferTerms } from "../lib/negotiation.mjs";

const root = fileURLToPath(new URL("..", import.meta.url));
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

async function freePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const { port } = server.address();
      server.close(error => error ? reject(error) : resolve(port));
    });
  });
}

async function startRuntime(t) {
  const directory = await mkdtemp(join(tmpdir(), "vendor-scout-qodo-stack-"));
  const port = await freePort();
  const child = spawn(process.execPath, ["server.mjs"], {
    cwd: root,
    env: {
      ...process.env,
      PORT: String(port),
      NODE_ENV: "development",
      VENDOR_SCOUT_DATA_PATH: join(directory, "runtime.json"),
      VENDOR_SCOUT_AGENT_TOKEN: "",
      VENDOR_SCOUT_MCP_TOKEN: "",
      TRUEFORGE_BASE_URL: ""
    },
    stdio: ["ignore", "pipe", "pipe"]
  });
  let diagnostics = "";
  child.stdout.on("data", chunk => { diagnostics += chunk; });
  child.stderr.on("data", chunk => { diagnostics += chunk; });
  const baseUrl = `http://127.0.0.1:${port}`;
  for (let attempt = 0; attempt < 60; attempt += 1) {
    if (child.exitCode != null) throw new Error(`Server exited: ${diagnostics}`);
    try {
      if ((await fetch(`${baseUrl}/health`)).ok) break;
    } catch {}
    await sleep(50);
  }
  t.after(() => { if (child.exitCode == null) child.kill("SIGTERM"); });
  return { baseUrl };
}

async function postJson(url, body) {
  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify(body)
  });
  const payload = response.status === 202 ? null : await response.json();
  return { response, payload };
}

function liveFixture() {
  const state = createSeed({ missionStage: "contacting" });
  const mission = state.missions[0];
  const candidate = structuredClone(state.supplierCandidates.find(item => item.status === "qualified"));
  candidate.contact = { email: "rfq@supplier.test", sourceReference: "https://supplier.test/contact" };
  const conversation = createRfqConversation(mission, candidate, "2026-08-29T12:00:00.000Z");
  recordSupplierReply(conversation, {
    content: "Offer",
    sourceReference: "gmail/message/offer",
    providerMessageId: "offer",
    receivedAt: "2026-08-29T13:00:00Z"
  });
  return { mission, candidate, conversation };
}

test("MCP rejects unsupported protocol versions and never executes id-less tool calls", async () => {
  let mutations = 0;
  const context = { recordSuppliers: async () => { mutations += 1; return {}; } };
  const initialized = await handleMcpMessage({
    jsonrpc: "2.0",
    id: 1,
    method: "initialize",
    params: { protocolVersion: "2099-01-01" }
  }, context);
  assert.equal(initialized.result.protocolVersion, "2025-06-18");

  const notification = await handleMcpMessage({
    jsonrpc: "2.0",
    method: "tools/call",
    params: {
      name: "vendor_scout_record_supplier_candidates",
      arguments: { missionId: "m", candidates: [] }
    }
  }, context);
  assert.equal(notification, null);
  assert.equal(mutations, 0);
});

test("MCP candidate schema rejects caller-controlled identity and provenance metadata", async () => {
  let called = false;
  const result = await handleMcpMessage({
    jsonrpc: "2.0",
    id: 2,
    method: "tools/call",
    params: {
      name: "vendor_scout_record_supplier_candidates",
      arguments: {
        missionId: "m",
        candidates: [{
          id: "spoof",
          name: "A",
          country: "US",
          region: "North America",
          type: "Manufacturer",
          confidence: 0.9,
          specMatch: 0.9,
          sourceReference: "ref"
        }]
      }
    }
  }, { recordSuppliers: async () => { called = true; } });
  assert.equal(result.result.isError, true);
  assert.match(result.result.content[0].text, /unsupported property id/);
  assert.equal(called, false);
});

test("failed researched-supplier ingestion leaves a draft mission unchanged", async t => {
  const runtime = await startRuntime(t);
  await postJson(`${runtime.baseUrl}/api/dev/reset`, { stage: "draft" });
  const call = await postJson(`${runtime.baseUrl}/mcp`, {
    jsonrpc: "2.0",
    id: 3,
    method: "tools/call",
    params: {
      name: "vendor_scout_record_supplier_candidates",
      arguments: {
        missionId: "mission-lidar-500",
        candidates: [{
          name: "Bad",
          country: "US",
          region: "North America",
          type: "Manufacturer",
          confidence: 2,
          specMatch: 0.9,
          sourceReference: "ref"
        }]
      }
    }
  });
  assert.equal(call.payload.result.isError, true);
  const mission = await fetch(`${runtime.baseUrl}/api/missions/mission-lidar-500`).then(r => r.json());
  assert.equal(mission.mission.status, "draft");
  assert.equal(mission.activity.some(item => item.title === "Mission started"), false);
});

test("TrueForge rejects oversized chunked responses before full buffering", async t => {
  const server = http.createServer((req, res) => {
    res.writeHead(200, { "Content-Type": "application/json", "Transfer-Encoding": "chunked" });
    res.write('{"data":{"id":"');
    for (let i = 0; i < 40; i += 1) res.write("x".repeat(65536));
    res.end('"}}');
  });
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  t.after(() => new Promise(resolve => server.close(resolve)));
  const { port } = server.address();
  const client = new TrueForgeClient({ baseUrl: `http://127.0.0.1:${port}`, agentName: "vendor-scout" });
  await assert.rejects(client.createSession(), /response is too large/);
});

test("outreach requires explicit success status and bounds chunked responses", async t => {
  const { mission, candidate, conversation } = liveFixture();
  const message = outboundRfqMessage(conversation);
  let mode = "missing";
  const server = http.createServer((req, res) => {
    res.writeHead(200, { "Content-Type": "application/json", "Transfer-Encoding": "chunked" });
    if (mode === "missing") return res.end("{}");
    res.write('{"status":"accepted","pad":"');
    for (let i = 0; i < 8; i += 1) res.write("x".repeat(65536));
    res.end('"}');
  });
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  t.after(() => new Promise(resolve => server.close(resolve)));
  const { port } = server.address();
  await assert.rejects(
    deliverRfq({ mission, candidate, conversation, message }, { url: `http://127.0.0.1:${port}`, allowControlledPreview: false }),
    /missing delivery status/
  );
  mode = "large";
  await assert.rejects(
    deliverRfq({ mission, candidate, conversation, message }, { url: `http://127.0.0.1:${port}`, allowControlledPreview: false }),
    /response is too large/
  );
});

test("trailing-dot .example contacts never reach a live outreach provider", async t => {
  let requests = 0;
  const server = http.createServer((req, res) => {
    requests += 1;
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end('{"status":"accepted"}');
  });
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  t.after(() => new Promise(resolve => server.close(resolve)));
  const { port } = server.address();
  const { mission, candidate } = liveFixture();
  candidate.contact.email = "sales@supplier.example.";
  const conversation = createRfqConversation(mission, candidate);
  await assert.rejects(
    deliverRfq({ mission, candidate, conversation, message: outboundRfqMessage(conversation) }, { url: `http://127.0.0.1:${port}`, allowControlledPreview: false }),
    /\.example supplier contacts/
  );
  assert.equal(requests, 0);
});

test("supplier reply timestamps are validated and normalized", () => {
  const { conversation } = liveFixture();
  assert.throws(
    () => recordSupplierReply(conversation, { content: "x", sourceReference: "ref-2", receivedAt: { bad: true } }),
    /receivedAt must be a valid ISO timestamp/
  );
  recordSupplierReply(conversation, {
    content: "x",
    sourceReference: "ref-2",
    providerMessageId: "two",
    receivedAt: "2026-08-29T15:00:00Z"
  });
  assert.equal(conversation.messages.at(-1).createdAt, "2026-08-29T15:00:00.000Z");
});

test("replayed supplier replies do not duplicate activity", async t => {
  const runtime = await startRuntime(t);
  await postJson(`${runtime.baseUrl}/api/dev/reset`, { stage: "contacting" });
  await postJson(`${runtime.baseUrl}/mcp`, {
    jsonrpc: "2.0",
    id: 4,
    method: "tools/call",
    params: {
      name: "vendor_scout_prepare_rfqs",
      arguments: { missionId: "mission-lidar-500" }
    }
  });
  const reply = {
    jsonrpc: "2.0",
    method: "tools/call",
    params: {
      name: "vendor_scout_record_supplier_reply",
      arguments: {
        missionId: "mission-lidar-500",
        supplierId: "supplier-heliomotion",
        content: "same",
        sourceReference: "gmail/same",
        providerMessageId: "same",
        receivedAt: "2026-08-29T16:00:00Z"
      }
    }
  };
  await postJson(`${runtime.baseUrl}/mcp`, { ...reply, id: 5 });
  await postJson(`${runtime.baseUrl}/mcp`, { ...reply, id: 6 });
  const mission = await fetch(`${runtime.baseUrl}/api/missions/mission-lidar-500`).then(r => r.json());
  assert.equal(
    mission.activity.filter(item => item.title.includes("Supplier reply recorded from HelioMotion Optics")).length,
    1
  );
});

test("tier pricing is evaluated while foreign currency is explicitly deferred to provenance-backed FX comparison", () => {
  const { mission, candidate, conversation } = liveFixture();
  let offer = recordOfferTerms(conversation, {
    sourceReference: "gmail/message/offer",
    unitPrice: 380,
    currency: "EUR",
    moq: 100,
    leadTimeDays: 18,
    shippingTerms: "DDP",
    sampleAvailable: true,
    samplePrice: 100,
    technicalConfirmed: true
  });
  let evaluation = evaluateOffer(mission, candidate, offer);
  assert.equal(evaluation.status, "ready_for_comparison");
  assert.equal(evaluation.requiresFx, true);
  assert.equal(evaluation.priceComparable, false);

  offer = recordOfferTerms(conversation, {
    sourceReference: "gmail/message/offer",
    unitPrice: null,
    currency: "USD",
    quantityTiers: [
      { minQuantity: 100, unitPrice: 410 },
      { minQuantity: 500, unitPrice: 385 }
    ],
    moq: 100,
    leadTimeDays: 18,
    shippingTerms: "DDP",
    sampleAvailable: true,
    samplePrice: 100,
    technicalConfirmed: true
  });
  evaluation = evaluateOffer(mission, candidate, offer);
  assert.equal(evaluation.effectiveUnitPrice, 385);
  assert.equal(evaluation.priceBasis, "quantity-tier-500");
  assert.equal(evaluation.missingFields.includes("unitPrice"), false);
  assert.equal(evaluation.status, "ready_for_comparison");
});

test("changed extraction supersedes a stale unsent counter", () => {
  const { mission, candidate, conversation } = liveFixture();
  recordOfferTerms(conversation, {
    sourceReference: "gmail/message/offer",
    unitPrice: 410,
    currency: "USD",
    moq: 100,
    leadTimeDays: 18,
    shippingTerms: "DDP",
    sampleAvailable: true,
    samplePrice: 100,
    technicalConfirmed: true
  });
  const first = prepareCounter(mission, candidate, conversation).message;
  recordOfferTerms(conversation, {
    sourceReference: "gmail/message/offer",
    unitPrice: 405,
    currency: "USD",
    moq: 100,
    leadTimeDays: 18,
    shippingTerms: "DDP",
    sampleAvailable: true,
    samplePrice: 100,
    technicalConfirmed: true
  });
  const second = prepareCounter(mission, candidate, conversation).message;
  assert.notEqual(second.id, first.id);
  assert.notEqual(second.delivery.idempotencyKey, first.delivery.idempotencyKey);
  assert.equal(first.delivery.status, "superseded");
});

test("direct counter send persists negotiation readiness when no counter is needed", async t => {
  const runtime = await startRuntime(t);
  await postJson(`${runtime.baseUrl}/api/dev/reset`, { stage: "negotiating" });
  const reply = {
    content: "ready offer",
    sourceReference: "gmail/ready",
    providerMessageId: "ready",
    receivedAt: "2026-08-29T17:00:00Z"
  };
  await postJson(`${runtime.baseUrl}/api/missions/mission-lidar-500/suppliers/supplier-heliomotion/reply`, reply);
  await postJson(`${runtime.baseUrl}/api/missions/mission-lidar-500/suppliers/supplier-heliomotion/offer`, {
    sourceReference: "gmail/ready",
    unitPrice: 385,
    currency: "USD",
    moq: 100,
    leadTimeDays: 18,
    shippingTerms: "DDP",
    shippingCost: 700,
    sampleAvailable: true,
    samplePrice: 180,
    technicalConfirmed: true
  });
  const result = await postJson(`${runtime.baseUrl}/api/missions/mission-lidar-500/suppliers/supplier-heliomotion/counter`, { action: "send" });
  assert.equal(result.response.status, 200);
  assert.equal(result.payload.mission.execution.negotiationReady, true);
  assert.equal(result.payload.conversations.find(item => item.supplierId === "supplier-heliomotion").status, "offer_ready");
});
