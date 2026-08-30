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
  const byKey = new Map();
  const server = http.createServer(async (req, res) => {
    let raw = "";
    for await (const chunk of req) raw += chunk;
    const key = req.headers["idempotency-key"];
    const body = JSON.parse(raw);
    if (!byKey.has(key)) {
      byKey.set(key, { status: "accepted", messageId: `provider-${byKey.size + 1}` });
      requests.push({ key, body });
    }
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify(byKey.get(key)));
  });
  await new Promise((resolve, reject) => { server.once("error", reject); server.listen(0, "127.0.0.1", resolve); });
  const { port } = server.address();
  return { url: `http://127.0.0.1:${port}`, requests, close: () => new Promise(resolve => server.close(resolve)) };
}

const candidates = [
  {
    name: "Compare Lidar One", country: "United States", region: "North America", type: "Manufacturer",
    website: "https://compare-one.test", contactEmail: "sales@compare-one.test", contactSourceReference: "https://compare-one.test/contact",
    confidence: .94, specMatch: .97, preliminaryUnitPrice: 382, currency: "USD", moq: 100, leadTimeDays: 18,
    availability: "Available", sourceReference: "https://compare-one.test/lidar"
  },
  {
    name: "Compare Lidar Two", country: "Germany", region: "Europe", type: "Manufacturer",
    website: "https://compare-two.test", contactEmail: "sales@compare-two.test", contactSourceReference: "https://compare-two.test/contact",
    confidence: .91, specMatch: .95, preliminaryUnitPrice: 382, currency: "USD", moq: 100, leadTimeDays: 14,
    availability: "Available", sourceReference: "https://compare-two.test/lidar"
  }
];

async function setupMission(t) {
  const provider = await startOutreachProvider();
  t.after(provider.close);
  const directory = await mkdtemp(join(tmpdir(), "vendor-scout-quote-runtime-"));
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
  let snapshot = await mcp(runtime.baseUrl, 1, "vendor_scout_record_supplier_candidates", { missionId: "mission-lidar-500", candidates });
  snapshot = await mcp(runtime.baseUrl, 2, "vendor_scout_qualify_suppliers", { missionId: "mission-lidar-500" });
  snapshot = await mcp(runtime.baseUrl, 3, "vendor_scout_prepare_rfqs", { missionId: "mission-lidar-500" });
  snapshot = await mcp(runtime.baseUrl, 4, "vendor_scout_send_rfqs", { missionId: "mission-lidar-500" });
  assert.equal(snapshot.mission.status, "negotiating");
  return { runtime, provider, supplierIds: snapshot.suppliers.map(item => item.id) };
}

async function recordReadyOffer(runtime, idBase, supplierId, { source, price, lead, shipping }) {
  let snapshot = await mcp(runtime.baseUrl, idBase, "vendor_scout_record_supplier_reply", {
    missionId: "mission-lidar-500", supplierId,
    content: `Final negotiated offer ${source}: USD ${price}/unit, MOQ 100, ${lead}-day lead, DDP Philadelphia, shipping USD ${shipping}, samples USD 180, technical requirements confirmed.`,
    sourceReference: `mail/${source}`, providerMessageId: source
  });
  snapshot = await mcp(runtime.baseUrl, idBase + 1, "vendor_scout_record_offer_terms", {
    missionId: "mission-lidar-500", supplierId, sourceReference: `mail/${source}`,
    unitPrice: price, currency: "USD", moq: 100, leadTimeDays: lead, shippingTerms: "DDP Philadelphia", shippingCost: shipping,
    sampleAvailable: true, samplePrice: 180, technicalConfirmed: true
  });
  snapshot = await mcp(runtime.baseUrl, idBase + 2, "vendor_scout_prepare_counter", { missionId: "mission-lidar-500", supplierId });
  return snapshot;
}

test("Phase 8 persists normalized quotes, ranks offers, and stops before approval", async t => {
  const { runtime, supplierIds } = await setupMission(t);
  await recordReadyOffer(runtime, 10, supplierIds[0], { source: "quote-a", price: 382, lead: 18, shipping: 900 });
  await recordReadyOffer(runtime, 20, supplierIds[1], { source: "quote-b", price: 382, lead: 14, shipping: 1300 });

  let snapshot = await mcp(runtime.baseUrl, 30, "vendor_scout_analyze_quotes", { missionId: "mission-lidar-500" });
  assert.equal(snapshot.mission.status, "comparing", JSON.stringify({
    status: snapshot.mission.status,
    execution: snapshot.mission.execution,
    quotes: snapshot.quotes?.map(quote => ({ supplier: quote.supplierName, knownTotal: quote.knownTotal, landedCost: quote.landedCost, completeness: quote.completeness, score: quote.score, rank: quote.rank })),
    recommendation: snapshot.recommendations?.[0] || null,
    conversations: snapshot.conversations?.map(conversation => ({ supplier: conversation.supplierName, status: conversation.status, evaluation: conversation.negotiation?.latestEvaluation }))
  }, null, 2));
  assert.equal(snapshot.mission.execution.analysisReady, true);
  assert.equal(snapshot.quotes.length, 2);
  assert.equal(snapshot.recommendations.length, 1);
  assert.equal(snapshot.approvals.length, 0, "Phase 8 must not create Phase 9 approval state");
  assert.equal(snapshot.recommendations[0].humanApprovalRequired, true);
  assert.equal(snapshot.recommendations[0].commitmentExecuted, false);
  const ranked = [...snapshot.quotes].sort((a, b) => a.rank - b.rank);
  assert.deepEqual(ranked.map(quote => quote.rank), [1, 2]);
  assert.ok(ranked[0].score.total >= ranked[1].score.total);
  assert.equal(snapshot.recommendations[0].quoteId, ranked[0].id);
  assert.ok(ranked.every(quote => Number.isFinite(quote.landedCost.base)));
  assert.ok(ranked.every(quote => quote.score.components.economics != null));

  const activityCount = snapshot.activity.filter(item => item.title.startsWith("Quote analysis recommends")).length;
  snapshot = await mcp(runtime.baseUrl, 31, "vendor_scout_analyze_quotes", { missionId: "mission-lidar-500" });
  assert.equal(snapshot.quotes.length, 2);
  assert.equal(snapshot.recommendations.length, 1);
  assert.equal(snapshot.activity.filter(item => item.title.startsWith("Quote analysis recommends")).length, activityCount, "idempotent re-analysis should not duplicate the analysis event");
});

test("Phase 8 revalidates stale ready state when a stronger competitor appears", async t => {
  const { runtime, supplierIds } = await setupMission(t);
  let snapshot = await recordReadyOffer(runtime, 40, supplierIds[0], { source: "stale-a", price: 388, lead: 18, shipping: 900 });
  assert.equal(snapshot.conversations.find(item => item.supplierId === supplierIds[0]).status, "offer_ready");
  snapshot = await recordReadyOffer(runtime, 50, supplierIds[1], { source: "stronger-b", price: 382, lead: 14, shipping: 1200 });
  assert.equal(snapshot.conversations.find(item => item.supplierId === supplierIds[1]).status, "offer_ready");

  snapshot = await mcp(runtime.baseUrl, 60, "vendor_scout_analyze_quotes", { missionId: "mission-lidar-500" });
  const first = snapshot.conversations.find(item => item.supplierId === supplierIds[0]);
  const second = snapshot.conversations.find(item => item.supplierId === supplierIds[1]);
  assert.equal(first.negotiation.latestEvaluation.status, "counter_required");
  assert.equal(first.status, "negotiating");
  assert.equal(second.negotiation.latestEvaluation.status, "ready_for_comparison");
  assert.equal(second.status, "offer_ready");
  assert.equal(snapshot.quotes.length, 1, "stale ready offer must not be ranked");
  assert.equal(snapshot.recommendations[0].supplierId, supplierIds[1]);
});

test("Phase 8 requires provenance-backed FX before ranking a foreign-currency ready offer", async t => {
  const { runtime, supplierIds } = await setupMission(t);
  const supplierId = supplierIds[0];
  await mcp(runtime.baseUrl, 70, "vendor_scout_record_supplier_reply", {
    missionId: "mission-lidar-500", supplierId,
    content: "EUR 330/unit, MOQ 100, 18-day lead, DDP Philadelphia, shipping EUR 900, sample EUR 150, technical confirmed.",
    sourceReference: "mail/eur", providerMessageId: "eur"
  });
  await mcp(runtime.baseUrl, 71, "vendor_scout_record_offer_terms", {
    missionId: "mission-lidar-500", supplierId, sourceReference: "mail/eur",
    unitPrice: 330, currency: "EUR", moq: 100, leadTimeDays: 18, shippingTerms: "DDP Philadelphia", shippingCost: 900,
    sampleAvailable: true, samplePrice: 150, technicalConfirmed: true
  });
  await mcp(runtime.baseUrl, 72, "vendor_scout_prepare_counter", { missionId: "mission-lidar-500", supplierId });

  let snapshot = await mcp(runtime.baseUrl, 73, "vendor_scout_analyze_quotes", { missionId: "mission-lidar-500" });
  assert.equal(snapshot.mission.status, "negotiating");
  assert.equal(snapshot.recommendations.length, 0);
  assert.equal(snapshot.quotes[0].unitPrice.base, null);
  assert.ok(snapshot.mission.execution.analysisBlockers[0].includes("normalized price/FX"));

  snapshot = await mcp(runtime.baseUrl, 74, "vendor_scout_analyze_quotes", {
    missionId: "mission-lidar-500",
    fxRates: [{ currency: "EUR", rateToBase: 1.16, sourceReference: "fx/ecb/2026-08-29", asOf: "2026-08-29" }]
  });
  assert.equal(snapshot.mission.status, "comparing");
  assert.equal(snapshot.recommendations.length, 1);
  assert.equal(snapshot.quotes[0].fx.sourceReference, "fx/ecb/2026-08-29");
  assert.equal(snapshot.approvals.length, 0);
});
