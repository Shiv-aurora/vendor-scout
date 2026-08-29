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

test("MCP tools execute the persisted Mission → Discover → Qualify workflow", async t => {
  const directory = await mkdtemp(join(tmpdir(), "vendor-scout-mcp-"));
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

  let response = await postJson(`${runtime.baseUrl}/api/dev/reset`, { stage: "draft" });
  assert.equal(response.status, 200);

  let rpc = await mcp(runtime.baseUrl, 1, "initialize", { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "test-client", version: "1" } });
  assert.equal(rpc.result.protocolVersion, "2025-06-18");
  assert.equal(rpc.result.serverInfo.name, "vendor-scout");
  assert.equal(rpc.result.capabilities.tools.listChanged, false);

  response = await postJson(`${runtime.baseUrl}/mcp`, { jsonrpc: "2.0", method: "notifications/initialized", params: {} });
  assert.equal(response.status, 202);

  rpc = await mcp(runtime.baseUrl, 2, "tools/list");
  assert.equal(rpc.result.tools.length, 3);
  const readTool = rpc.result.tools.find(tool => tool.name === "vendor_scout_get_mission");
  const discoverTool = rpc.result.tools.find(tool => tool.name === "vendor_scout_discover_suppliers");
  assert.equal(readTool.annotations.readOnlyHint, true);
  assert.equal(discoverTool.annotations.openWorldHint, true);
  assert.equal(discoverTool.annotations.destructiveHint, false);

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
