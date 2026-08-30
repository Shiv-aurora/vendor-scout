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
      if (response.ok) return { child, baseUrl };
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
  return fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
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
  const byKey = new Map();
  const server = http.createServer(async (req, res) => {
    let raw = "";
    for await (const chunk of req) raw += chunk;
    const key = req.headers["idempotency-key"];
    const body = JSON.parse(raw);
    if (!byKey.has(key)) {
      const result = { status: "accepted", messageId: `provider-${byKey.size + 1}` };
      byKey.set(key, result);
      requests.push({ key, body });
    }
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify(byKey.get(key)));
  });
  await new Promise((resolve, reject) => { server.once("error", reject); server.listen(0, "127.0.0.1", resolve); });
  const { port } = server.address();
  return { url: `http://127.0.0.1:${port}`, requests, close: () => new Promise(resolve => server.close(resolve)) };
}

async function startPartialFailureProvider() {
  const requests = [];
  const attemptsByRecipient = new Map();
  const acceptedByKey = new Map();
  const server = http.createServer(async (req, res) => {
    let raw = "";
    for await (const chunk of req) raw += chunk;
    const key = req.headers["idempotency-key"];
    const body = JSON.parse(raw);
    const recipient = body.message.to;
    const attempt = (attemptsByRecipient.get(recipient) || 0) + 1;
    attemptsByRecipient.set(recipient, attempt);
    requests.push({ key, body, attempt });

    if (recipient === "sales@supplier-two.test" && attempt === 1) {
      res.writeHead(503, { "Content-Type": "application/json" });
      return res.end(JSON.stringify({ message: "temporary supplier-two delivery failure" }));
    }

    if (!acceptedByKey.has(key)) {
      acceptedByKey.set(key, { status: "accepted", messageId: `provider-${acceptedByKey.size + 1}` });
    }
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify(acceptedByKey.get(key)));
  });
  await new Promise((resolve, reject) => { server.once("error", reject); server.listen(0, "127.0.0.1", resolve); });
  const { port } = server.address();
  return {
    url: `http://127.0.0.1:${port}`,
    requests,
    attemptsByRecipient,
    close: () => new Promise(resolve => server.close(resolve))
  };
}

const liveCandidates = [
  {
    name: "Live Lidar One",
    country: "United States",
    region: "North America",
    type: "Manufacturer",
    website: "https://supplier-one.test",
    contactEmail: "rfq@supplier-one.test",
    contactSourceReference: "https://supplier-one.test/contact",
    confidence: .93,
    specMatch: .96,
    preliminaryUnitPrice: 382,
    currency: "USD",
    moq: 100,
    leadTimeDays: 16,
    availability: "Production slots available",
    sourceReference: "https://supplier-one.test/lidar"
  },
  {
    name: "Live Lidar Two",
    country: "Germany",
    region: "Europe",
    type: "Manufacturer",
    website: "https://supplier-two.test",
    contactEmail: "sales@supplier-two.test",
    contactSourceReference: "https://supplier-two.test/contact",
    confidence: .91,
    specMatch: .94,
    preliminaryUnitPrice: 389,
    currency: "USD",
    moq: 200,
    leadTimeDays: 19,
    availability: "Available to quote",
    sourceReference: "https://supplier-two.test/lidar"
  }
];

test("real outreach provider advances contacting to negotiating exactly once", async t => {
  const provider = await startOutreachProvider();
  t.after(provider.close);
  const directory = await mkdtemp(join(tmpdir(), "vendor-scout-outreach-live-"));
  const port = await freePort();
  const runtime = await startServer({
    ...process.env,
    PORT: String(port),
    NODE_ENV: "development",
    VENDOR_SCOUT_DATA_PATH: join(directory, "runtime.json"),
    VENDOR_SCOUT_AGENT_TOKEN: "",
    VENDOR_SCOUT_MCP_TOKEN: "",
    VENDOR_SCOUT_OUTREACH_URL: provider.url,
    VENDOR_SCOUT_OUTREACH_TOKEN: "provider-token",
    TRUEFORGE_BASE_URL: ""
  });
  t.after(() => stop(runtime.child));

  let response = await postJson(`${runtime.baseUrl}/api/dev/reset`, { stage: "draft" });
  assert.equal(response.status, 200);

  let snapshot = await mcp(runtime.baseUrl, 1, "vendor_scout_record_supplier_candidates", { missionId: "mission-lidar-500", candidates: liveCandidates });
  assert.equal(snapshot.mission.status, "qualifying");
  snapshot = await mcp(runtime.baseUrl, 2, "vendor_scout_qualify_suppliers", { missionId: "mission-lidar-500" });
  assert.equal(snapshot.mission.status, "contacting");
  assert.equal(snapshot.suppliers.filter(candidate => candidate.status === "qualified").length, 2);

  snapshot = await mcp(runtime.baseUrl, 3, "vendor_scout_prepare_rfqs", { missionId: "mission-lidar-500" });
  assert.equal(snapshot.conversations.length, 2);
  assert.ok(snapshot.conversations.every(conversation => conversation.status === "rfq_draft"));
  assert.ok(snapshot.conversations.every(conversation => conversation.messages[0].delivery.status === "draft"));

  snapshot = await mcp(runtime.baseUrl, 4, "vendor_scout_send_rfqs", { missionId: "mission-lidar-500" });
  assert.equal(snapshot.mission.status, "negotiating");
  assert.equal(provider.requests.length, 2);
  assert.ok(snapshot.conversations.every(conversation => conversation.status === "rfq_sent"));
  assert.ok(snapshot.conversations.every(conversation => conversation.messages[0].delivery.provider === "remote-outreach"));

  snapshot = await mcp(runtime.baseUrl, 5, "vendor_scout_send_rfqs", { missionId: "mission-lidar-500" });
  assert.equal(snapshot.mission.status, "negotiating");
  assert.equal(provider.requests.length, 2, "retry must not send duplicate RFQs");

  response = await fetch(`${runtime.baseUrl}/api/dashboard`);
  const dashboard = await response.json();
  assert.equal(dashboard.summary.suppliersContacted, 2);
});

test("failed supplier outreach can retry after another supplier reply starts negotiation", async t => {
  const provider = await startPartialFailureProvider();
  t.after(provider.close);
  const directory = await mkdtemp(join(tmpdir(), "vendor-scout-outreach-partial-"));
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
  let snapshot = await mcp(runtime.baseUrl, 30, "vendor_scout_record_supplier_candidates", { missionId: "mission-lidar-500", candidates: liveCandidates });
  snapshot = await mcp(runtime.baseUrl, 31, "vendor_scout_qualify_suppliers", { missionId: "mission-lidar-500" });
  snapshot = await mcp(runtime.baseUrl, 32, "vendor_scout_prepare_rfqs", { missionId: "mission-lidar-500" });
  snapshot = await mcp(runtime.baseUrl, 33, "vendor_scout_send_rfqs", { missionId: "mission-lidar-500" });

  assert.equal(snapshot.mission.status, "contacting");
  const first = snapshot.conversations.find(conversation => conversation.supplierName === "Live Lidar One");
  const second = snapshot.conversations.find(conversation => conversation.supplierName === "Live Lidar Two");
  assert.equal(first.status, "rfq_sent");
  assert.equal(second.status, "delivery_failed");

  snapshot = await mcp(runtime.baseUrl, 34, "vendor_scout_record_supplier_reply", {
    missionId: "mission-lidar-500",
    supplierId: first.supplierId,
    content: "We can proceed with the RFQ and will send final commercial terms shortly.",
    sourceReference: "gmail/message/partial-reply",
    providerMessageId: "partial-reply"
  });
  assert.equal(snapshot.mission.status, "negotiating");

  snapshot = await mcp(runtime.baseUrl, 35, "vendor_scout_send_rfqs", { missionId: "mission-lidar-500" });
  assert.equal(snapshot.mission.status, "negotiating");
  assert.equal(snapshot.conversations.find(conversation => conversation.supplierName === "Live Lidar Two").status, "rfq_sent");
  assert.equal(provider.attemptsByRecipient.get("rfq@supplier-one.test"), 1, "already accepted supplier must not be resent");
  assert.equal(provider.attemptsByRecipient.get("sales@supplier-two.test"), 2, "failed supplier should retry once negotiation is active");
});

test("controlled preview creates conversation evidence but does not claim real outreach", async t => {
  const directory = await mkdtemp(join(tmpdir(), "vendor-scout-outreach-preview-"));
  const port = await freePort();
  const runtime = await startServer({
    ...process.env,
    PORT: String(port),
    NODE_ENV: "development",
    VENDOR_SCOUT_DATA_PATH: join(directory, "runtime.json"),
    VENDOR_SCOUT_AGENT_TOKEN: "",
    VENDOR_SCOUT_MCP_TOKEN: "",
    VENDOR_SCOUT_OUTREACH_URL: "",
    TRUEFORGE_BASE_URL: ""
  });
  t.after(() => stop(runtime.child));

  const reset = await postJson(`${runtime.baseUrl}/api/dev/reset`, { stage: "contacting" });
  assert.equal(reset.status, 200);
  let snapshot = await mcp(runtime.baseUrl, 10, "vendor_scout_prepare_rfqs", { missionId: "mission-lidar-500" });
  assert.equal(snapshot.mission.status, "contacting");
  assert.ok(snapshot.conversations.length >= 2);

  snapshot = await mcp(runtime.baseUrl, 11, "vendor_scout_send_rfqs", { missionId: "mission-lidar-500" });
  assert.equal(snapshot.mission.status, "contacting");
  assert.ok(snapshot.conversations.every(conversation => conversation.status === "previewed"));
  assert.ok(snapshot.conversations.every(conversation => conversation.messages[0].delivery.provider === "controlled-preview"));

  const response = await fetch(`${runtime.baseUrl}/api/dashboard`);
  const dashboard = await response.json();
  assert.equal(dashboard.summary.suppliersContacted, 0);
});

test("supplier reply is persisted with provenance and activates a conversation", async t => {
  const provider = await startOutreachProvider();
  t.after(provider.close);
  const directory = await mkdtemp(join(tmpdir(), "vendor-scout-outreach-reply-"));
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
  let snapshot = await mcp(runtime.baseUrl, 20, "vendor_scout_record_supplier_candidates", { missionId: "mission-lidar-500", candidates: [liveCandidates[0]] });
  snapshot = await mcp(runtime.baseUrl, 21, "vendor_scout_qualify_suppliers", { missionId: "mission-lidar-500" });
  snapshot = await mcp(runtime.baseUrl, 22, "vendor_scout_prepare_rfqs", { missionId: "mission-lidar-500" });
  snapshot = await mcp(runtime.baseUrl, 23, "vendor_scout_send_rfqs", { missionId: "mission-lidar-500" });
  assert.equal(snapshot.mission.status, "negotiating");
  const supplierId = snapshot.suppliers[0].id;

  snapshot = await mcp(runtime.baseUrl, 24, "vendor_scout_record_supplier_reply", {
    missionId: "mission-lidar-500",
    supplierId,
    content: "We can offer $379/unit, MOQ 100, 17-day lead time, with samples available for $220.",
    sourceReference: "gmail/message/reply-1",
    providerMessageId: "reply-1",
    receivedAt: "2026-08-29T18:00:00.000Z"
  });
  assert.equal(snapshot.conversations[0].status, "supplier_replied");
  assert.equal(snapshot.conversations[0].messages.filter(message => message.direction === "inbound").length, 1);
  assert.equal(snapshot.conversations[0].messages.at(-1).sourceReference, "gmail/message/reply-1");

  const response = await fetch(`${runtime.baseUrl}/api/dashboard`);
  const dashboard = await response.json();
  assert.equal(dashboard.summary.negotiationsActive, 1);
});
