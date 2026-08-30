import test from "node:test";
import assert from "node:assert/strict";
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
  for (let attempt = 0; attempt < 60; attempt += 1) {
    if (child.exitCode != null) throw new Error(`Server exited during startup: ${diagnostics}`);
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

async function postJson(url, body, headers = {}) {
  return fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json, text/event-stream", ...headers },
    body: JSON.stringify(body)
  });
}

async function mcp(baseUrl, id, method, params = {}, headers = {}) {
  const response = await postJson(`${baseUrl}/mcp`, { jsonrpc: "2.0", id, method, params }, headers);
  const body = await response.json();
  assert.equal(response.status, 200, JSON.stringify(body));
  assert.equal(body.jsonrpc, "2.0");
  assert.equal(body.id, id);
  return body;
}

async function createDevelopmentRuntime(t, prefix) {
  const directory = await mkdtemp(join(tmpdir(), prefix));
  const port = await freePort();
  const runtime = await startServer({
    ...process.env,
    PORT: String(port),
    NODE_ENV: "development",
    VENDOR_SCOUT_DATA_PATH: join(directory, "runtime.json"),
    VENDOR_SCOUT_AGENT_TOKEN: "",
    VENDOR_SCOUT_MCP_TOKEN: "",
    TRUEFORGE_BASE_URL: ""
  });
  t.after(() => stop(runtime.child));
  return runtime;
}

test("MCP tools execute the persisted Mission → Discover → Qualify workflow", async t => {
  const runtime = await createDevelopmentRuntime(t, "vendor-scout-mcp-");

  let response = await postJson(`${runtime.baseUrl}/api/dev/reset`, { stage: "draft" });
  assert.equal(response.status, 200);

  let rpc = await mcp(runtime.baseUrl, 1, "initialize", { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "test-client", version: "1" } });
  assert.equal(rpc.result.protocolVersion, "2025-06-18");
  assert.equal(rpc.result.serverInfo.name, "vendor-scout");
  assert.equal(rpc.result.serverInfo.version, "0.5.0");
  assert.equal(rpc.result.capabilities.tools.listChanged, false);

  response = await postJson(`${runtime.baseUrl}/mcp`, { jsonrpc: "2.0", method: "notifications/initialized", params: {} });
  assert.equal(response.status, 202);

  rpc = await mcp(runtime.baseUrl, 2, "tools/list");
  assert.equal(rpc.result.tools.length, 10);
  const names = rpc.result.tools.map(tool => tool.name);
  for (const expected of [
    "vendor_scout_get_mission",
    "vendor_scout_discover_suppliers",
    "vendor_scout_record_supplier_candidates",
    "vendor_scout_qualify_suppliers",
    "vendor_scout_prepare_rfqs",
    "vendor_scout_send_rfqs",
    "vendor_scout_record_supplier_reply",
    "vendor_scout_record_offer_terms",
    "vendor_scout_prepare_counter",
    "vendor_scout_send_counter"
  ]) assert.ok(names.includes(expected), `missing MCP tool ${expected}`);

  const byName = name => rpc.result.tools.find(tool => tool.name === name);
  assert.equal(byName("vendor_scout_get_mission").annotations.readOnlyHint, true);
  assert.equal(byName("vendor_scout_discover_suppliers").annotations.openWorldHint, true);
  assert.equal(byName("vendor_scout_record_supplier_candidates").inputSchema.properties.candidates.maxItems, 50);
  assert.equal(byName("vendor_scout_prepare_rfqs").annotations.openWorldHint, false);
  assert.equal(byName("vendor_scout_send_rfqs").annotations.openWorldHint, true);
  assert.ok(byName("vendor_scout_record_supplier_reply").inputSchema.required.includes("sourceReference"));
  assert.ok(byName("vendor_scout_record_offer_terms").inputSchema.required.includes("sourceReference"));
  assert.equal(byName("vendor_scout_record_offer_terms").annotations.openWorldHint, false);
  assert.equal(byName("vendor_scout_prepare_counter").annotations.openWorldHint, false);
  assert.equal(byName("vendor_scout_prepare_counter").annotations.idempotentHint, true);
  assert.equal(byName("vendor_scout_send_counter").annotations.openWorldHint, true);
  assert.equal(byName("vendor_scout_send_counter").annotations.destructiveHint, false);
  assert.equal(byName("vendor_scout_send_counter").annotations.idempotentHint, true);
  assert.ok(!names.some(name => /accept|purchase|order_sample|place_order/.test(name)), "MCP surface must not expose a commitment tool");

  rpc = await mcp(runtime.baseUrl, 3, "tools/call", { name: "vendor_scout_get_mission", arguments: { missionId: "mission-lidar-500" } });
  assert.equal(rpc.result.structuredContent.mission.status, "draft");

  rpc = await mcp(runtime.baseUrl, 4, "tools/call", { name: "vendor_scout_discover_suppliers", arguments: { missionId: "mission-lidar-500" } });
  assert.equal(rpc.result.isError, false);
  assert.equal(rpc.result.structuredContent.mission.status, "qualifying");
  assert.ok(rpc.result.structuredContent.suppliers.length >= 4);
  assert.ok(rpc.result.structuredContent.suppliers.every(candidate => candidate.source.reference));

  rpc = await mcp(runtime.baseUrl, 5, "tools/call", { name: "vendor_scout_qualify_suppliers", arguments: { missionId: "mission-lidar-500" } });
  assert.equal(rpc.result.isError, false);
  assert.equal(rpc.result.structuredContent.mission.status, "contacting");
  assert.ok(rpc.result.structuredContent.suppliers.some(candidate => candidate.status === "qualified"));
  assert.ok(rpc.result.structuredContent.suppliers.some(candidate => candidate.status === "needs_review"));
  assert.ok(rpc.result.structuredContent.suppliers.some(candidate => candidate.status === "rejected"));

  rpc = await mcp(runtime.baseUrl, 6, "tools/call", { name: "vendor_scout_qualify_suppliers", arguments: { missionId: "mission-lidar-500" } });
  assert.equal(rpc.result.structuredContent.mission.status, "contacting");
});

test("MCP records provenance-backed TrueForge research without inventing missing commercial fields", async t => {
  const runtime = await createDevelopmentRuntime(t, "vendor-scout-mcp-live-");
  let response = await postJson(`${runtime.baseUrl}/api/dev/reset`, { stage: "draft" });
  assert.equal(response.status, 200);

  const liveCandidate = {
    name: "Evidence Lidar Inc",
    country: "United States",
    region: "North America",
    type: "Manufacturer",
    website: "https://evidence.example/lidar",
    confidence: .9,
    specMatch: .94,
    preliminaryUnitPrice: null,
    moq: null,
    leadTimeDays: null,
    availability: "Contact supplier",
    sourceReference: "https://evidence.example/lidar"
  };

  let rpc = await mcp(runtime.baseUrl, 10, "tools/call", {
    name: "vendor_scout_record_supplier_candidates",
    arguments: { missionId: "mission-lidar-500", candidates: [liveCandidate] }
  });
  assert.equal(rpc.result.isError, false);
  assert.equal(rpc.result.structuredContent.mission.status, "qualifying");
  assert.equal(rpc.result.structuredContent.mission.execution.discoveryProvider, "trueforge-tools");
  assert.equal(rpc.result.structuredContent.mission.execution.fallbackUsed, false);
  assert.equal(rpc.result.structuredContent.suppliers.length, 1);
  assert.equal(rpc.result.structuredContent.suppliers[0].source.kind, "trueforge-research");
  assert.equal(rpc.result.structuredContent.suppliers[0].source.reference, liveCandidate.sourceReference);
  assert.equal(rpc.result.structuredContent.suppliers[0].preliminaryUnitPrice, null);

  const firstId = rpc.result.structuredContent.suppliers[0].id;
  rpc = await mcp(runtime.baseUrl, 11, "tools/call", {
    name: "vendor_scout_record_supplier_candidates",
    arguments: { missionId: "mission-lidar-500", candidates: [liveCandidate] }
  });
  assert.equal(rpc.result.structuredContent.suppliers.length, 1);
  assert.equal(rpc.result.structuredContent.suppliers[0].id, firstId);

  rpc = await mcp(runtime.baseUrl, 12, "tools/call", { name: "vendor_scout_qualify_suppliers", arguments: { missionId: "mission-lidar-500" } });
  assert.equal(rpc.result.structuredContent.mission.status, "contacting");
  assert.equal(rpc.result.structuredContent.suppliers[0].status, "needs_review");
  assert.match(rpc.result.structuredContent.suppliers[0].reason, /unit price is not yet available/);

  response = await fetch(`${runtime.baseUrl}/api/dashboard`);
  const dashboard = await response.json();
  assert.ok(dashboard.activity.some(item => item.title === "1 researched supplier candidate recorded"));
});

test("production MCP endpoint is closed without a configured bearer token", async t => {
  const directory = await mkdtemp(join(tmpdir(), "vendor-scout-mcp-production-"));
  const port = await freePort();
  const runtime = await startServer({
    ...process.env,
    PORT: String(port),
    NODE_ENV: "production",
    VENDOR_SCOUT_DATA_PATH: join(directory, "runtime.json"),
    VENDOR_SCOUT_AGENT_TOKEN: "",
    VENDOR_SCOUT_MCP_TOKEN: "",
    VENDOR_SCOUT_ALLOW_FIXTURE_FALLBACK: "0",
    TRUEFORGE_BASE_URL: ""
  });
  t.after(() => stop(runtime.child));

  let response = await fetch(`${runtime.baseUrl}/api/capabilities`);
  let body = await response.json();
  assert.equal(body.mcp.enabled, false);

  response = await postJson(`${runtime.baseUrl}/mcp`, { jsonrpc: "2.0", id: 1, method: "tools/list", params: {} });
  body = await response.json();
  assert.equal(response.status, 503);
  assert.match(body.error, /MCP is disabled/);
});
