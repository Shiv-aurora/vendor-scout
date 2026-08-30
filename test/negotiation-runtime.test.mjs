import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { spawn } from "node:child_process";
import { mkdtemp } from "node:fs/promises";
import net from "node:net";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";

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

async function startServer(environment) {
  const child = spawn(process.execPath, ["server.mjs"], { cwd: root, env: environment, stdio: ["ignore", "pipe", "pipe"] });
  let diagnostics = "";
  child.stdout.on("data", chunk => { diagnostics += chunk; });
  child.stderr.on("data", chunk => { diagnostics += chunk; });
  const baseUrl = `http://127.0.0.1:${environment.PORT}`;
  for (let attempt = 0; attempt < 80; attempt += 1) {
    if (child.exitCode != null) throw new Error(`Server exited: ${diagnostics}`);
    try {
      const response = await fetch(`${baseUrl}/health`);
      if (response.ok) return { child, baseUrl, diagnostics: () => diagnostics };
    } catch {}
    await sleep(50);
  }
  child.kill("SIGTERM");
  throw new Error(`Server did not start: ${diagnostics}`);
}

async function stop(child) {
  if (child.exitCode != null) return;
  child.kill("SIGTERM");
  await Promise.race([new Promise(resolve => child.once("exit", resolve)), sleep(1000)]);
}

async function postJson(url, body) {
  return fetch(url, { method: "POST", headers: { "Content-Type": "application/json", Accept: "application/json, text/event-stream" }, body: JSON.stringify(body) });
}

async function mcp(baseUrl, id, name, args) {
  const response = await postJson(`${baseUrl}/mcp`, { jsonrpc: "2.0", id, method: "tools/call", params: { name, arguments: args } });
  const body = await response.json();
  assert.equal(response.status, 200, JSON.stringify(body));
  assert.equal(body.result?.isError, false, JSON.stringify(body));
  return body.result.structuredContent;
}

async function startOutreachProvider() {
  const requests = [];
  const acceptedByKey = new Map();
  const server = http.createServer(async (req, res) => {
    let raw = "";
    for await (const chunk of req) raw += chunk;
    const key = req.headers["idempotency-key"];
    const body = JSON.parse(raw);
    if (!acceptedByKey.has(key)) {
      acceptedByKey.set(key, { status: "accepted", messageId: `provider-${acceptedByKey.size + 1}` });
      requests.push({ key, body });
    }
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify(acceptedByKey.get(key)));
  });
  await new Promise((resolve, reject) => { server.once("error", reject); server.listen(0, "127.0.0.1", resolve); });
  const { port } = server.address();
  return { url: `http://127.0.0.1:${port}`, requests, close: () => new Promise(resolve => server.close(resolve)) };
}

const candidate = {
  name: "Negotiable Lidar Inc",
  country: "United States",
  region: "North America",
  type: "Manufacturer",
  website: "https://negotiable.test",
  contactEmail: "sales@negotiable.test",
  contactSourceReference: "https://negotiable.test/contact",
  confidence: .94,
  specMatch: .97,
  preliminaryUnitPrice: 388,
  currency: "USD",
  moq: 100,
  leadTimeDays: 18,
  availability: "Production capacity available",
  sourceReference: "https://negotiable.test/lidar"
};

async function setupNegotiatingMission(t) {
  const provider = await startOutreachProvider();
  t.after(provider.close);
  const directory = await mkdtemp(join(tmpdir(), "vendor-scout-negotiation-"));
  const port = await freePort();
  const runtime = await startServer({
    ...process.env,
    PORT: String(port),
    NODE_ENV: "development",
    VENDOR_SCOUT_DATA_PATH: join(directory, "runtime.json"),
    VENDOR_SCOUT_OUTREACH_URL: provider.url,
    TRUEFORGE_BASE_URL: ""
  });
  t.after(() => stop(runtime.child));

  await postJson(`${runtime.baseUrl}/api/dev/reset`, { stage: "draft" });
  let snapshot = await mcp(runtime.baseUrl, 1, "vendor_scout_record_supplier_candidates", { missionId: "mission-lidar-500", candidates: [candidate] });
  snapshot = await mcp(runtime.baseUrl, 2, "vendor_scout_qualify_suppliers", { missionId: "mission-lidar-500" });
  assert.equal(snapshot.mission.status, "contacting");
  snapshot = await mcp(runtime.baseUrl, 3, "vendor_scout_prepare_rfqs", { missionId: "mission-lidar-500" });
  snapshot = await mcp(runtime.baseUrl, 4, "vendor_scout_send_rfqs", { missionId: "mission-lidar-500" });
  assert.equal(snapshot.mission.status, "negotiating");
  assert.equal(provider.requests.length, 1);
  return { runtime, provider, supplierId: snapshot.suppliers[0].id };
}

test("negotiation cycles from supplier reply through a counter to a stronger offer", async t => {
  const { runtime, provider, supplierId } = await setupNegotiatingMission(t);

  let snapshot = await mcp(runtime.baseUrl, 10, "vendor_scout_record_supplier_reply", {
    missionId: "mission-lidar-500",
    supplierId,
    content: "Initial offer: USD 410/unit, MOQ 600, 28-day production lead. FOB. Samples available for USD 240. Technical requirements confirmed.",
    sourceReference: "gmail/message/neg-1",
    providerMessageId: "neg-1"
  });
  assert.equal(snapshot.conversations[0].status, "supplier_replied");

  snapshot = await mcp(runtime.baseUrl, 11, "vendor_scout_record_offer_terms", {
    missionId: "mission-lidar-500",
    supplierId,
    sourceReference: "gmail/message/neg-1",
    unitPrice: 410,
    currency: "USD",
    moq: 600,
    leadTimeDays: 28,
    shippingTerms: "FOB",
    sampleAvailable: true,
    samplePrice: 240,
    technicalConfirmed: true
  });
  assert.equal(snapshot.conversations[0].negotiation.offers.length, 1);

  snapshot = await mcp(runtime.baseUrl, 12, "vendor_scout_prepare_counter", { missionId: "mission-lidar-500", supplierId });
  const conversation = snapshot.conversations[0];
  assert.equal(conversation.status, "counter_draft");
  assert.equal(conversation.negotiation.latestEvaluation.status, "counter_required");
  assert.deepEqual(conversation.negotiation.latestEvaluation.gaps.map(gap => gap.field).sort(), ["leadTimeDays", "moq", "unitPrice"]);
  const counter = conversation.messages.find(message => message.type === "counter");
  assert.ok(counter);
  assert.match(counter.content, /USD 390\.00 or better/);
  assert.match(counter.content, /MOQ to 500 units or lower/);
  assert.match(counter.content, /21 days or less/);
  assert.match(counter.content, /non-binding/i);

  snapshot = await mcp(runtime.baseUrl, 13, "vendor_scout_send_counter", { missionId: "mission-lidar-500", supplierId });
  assert.equal(snapshot.conversations[0].status, "counter_sent");
  assert.equal(snapshot.conversations[0].negotiation.counterRounds, 1);
  assert.equal(provider.requests.length, 2, "provider should receive RFQ plus one counter");
  assert.equal(provider.requests[1].body.message.type, "counter");

  snapshot = await mcp(runtime.baseUrl, 14, "vendor_scout_send_counter", { missionId: "mission-lidar-500", supplierId });
  assert.equal(provider.requests.length, 2, "retry must not duplicate an accepted counter");

  snapshot = await mcp(runtime.baseUrl, 15, "vendor_scout_record_supplier_reply", {
    missionId: "mission-lidar-500",
    supplierId,
    content: "Revised: USD 385/unit, MOQ 100, 18-day lead, DDP Philadelphia, samples USD 180, technical requirements confirmed.",
    sourceReference: "gmail/message/neg-2",
    providerMessageId: "neg-2"
  });
  snapshot = await mcp(runtime.baseUrl, 16, "vendor_scout_record_offer_terms", {
    missionId: "mission-lidar-500",
    supplierId,
    sourceReference: "gmail/message/neg-2",
    unitPrice: 385,
    currency: "USD",
    moq: 100,
    leadTimeDays: 18,
    shippingTerms: "DDP Philadelphia",
    shippingCost: 0,
    sampleAvailable: true,
    samplePrice: 180,
    technicalConfirmed: true
  });
  assert.equal(snapshot.conversations[0].negotiation.offers.length, 2);

  snapshot = await mcp(runtime.baseUrl, 17, "vendor_scout_prepare_counter", { missionId: "mission-lidar-500", supplierId });
  assert.equal(snapshot.conversations[0].status, "offer_ready");
  assert.equal(snapshot.conversations[0].negotiation.latestEvaluation.status, "ready_for_comparison");
  assert.equal(snapshot.mission.status, "negotiating", "Phase 7 should not skip ahead into Phase 8 comparison");
  assert.equal(snapshot.mission.execution.negotiationReady, true);
  assert.equal(snapshot.conversations[0].messages.filter(message => message.type === "counter").length, 1);
});

test("offer extraction cannot detach terms from the recorded supplier evidence", async t => {
  const { runtime, supplierId } = await setupNegotiatingMission(t);
  await mcp(runtime.baseUrl, 20, "vendor_scout_record_supplier_reply", {
    missionId: "mission-lidar-500",
    supplierId,
    content: "USD 399/unit, MOQ 100, 18 days.",
    sourceReference: "gmail/message/source-a",
    providerMessageId: "source-a"
  });

  const response = await postJson(`${runtime.baseUrl}/mcp`, {
    jsonrpc: "2.0",
    id: 21,
    method: "tools/call",
    params: {
      name: "vendor_scout_record_offer_terms",
      arguments: {
        missionId: "mission-lidar-500",
        supplierId,
        sourceReference: "gmail/message/not-recorded",
        unitPrice: 399,
        currency: "USD"
      }
    }
  });
  const body = await response.json();
  assert.equal(body.result.isError, true);
  assert.match(body.result.content[0].text, /persisted supplier reply/);
});

test("critical technical conflict stops before autonomous counter delivery", async t => {
  const { runtime, provider, supplierId } = await setupNegotiatingMission(t);
  await mcp(runtime.baseUrl, 30, "vendor_scout_record_supplier_reply", {
    missionId: "mission-lidar-500",
    supplierId,
    content: "USD 370/unit, MOQ 100, 15 days, FOB, but the offered part does not meet the required UART interface.",
    sourceReference: "gmail/message/technical-fail",
    providerMessageId: "technical-fail"
  });
  await mcp(runtime.baseUrl, 31, "vendor_scout_record_offer_terms", {
    missionId: "mission-lidar-500",
    supplierId,
    sourceReference: "gmail/message/technical-fail",
    unitPrice: 370,
    currency: "USD",
    moq: 100,
    leadTimeDays: 15,
    shippingTerms: "FOB",
    sampleAvailable: true,
    samplePrice: 150,
    technicalConfirmed: false
  });
  const snapshot = await mcp(runtime.baseUrl, 32, "vendor_scout_prepare_counter", { missionId: "mission-lidar-500", supplierId });
  assert.equal(snapshot.conversations[0].status, "human_review");
  assert.equal(snapshot.conversations[0].negotiation.latestEvaluation.status, "reject_recommended");
  assert.equal(snapshot.conversations[0].messages.filter(message => message.type === "counter").length, 0);
  assert.equal(provider.requests.length, 1, "no counter should be sent for a critical technical conflict");
});
