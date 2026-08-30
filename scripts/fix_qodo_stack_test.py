from pathlib import Path

path = Path("test/qodo-stack-regressions.test.mjs")
text = path.read_text()
old = '''test("direct counter send persists negotiation readiness when no counter is needed", async t => {
  const runtime = await startRuntime(t);
  await postJson(`${runtime.baseUrl}/api/dev/reset`, { stage: "negotiating" });
  const reply = {'''
new = '''test("direct counter send persists negotiation readiness when no counter is needed", async t => {
  const runtime = await startRuntime(t);
  await postJson(`${runtime.baseUrl}/api/dev/reset`, { stage: "contacting" });
  const prepared = await postJson(`${runtime.baseUrl}/mcp`, {
    jsonrpc: "2.0",
    id: 7,
    method: "tools/call",
    params: {
      name: "vendor_scout_prepare_rfqs",
      arguments: { missionId: "mission-lidar-500" }
    }
  });
  if (prepared.payload?.result?.isError) throw new Error(prepared.payload.result.content?.[0]?.text || "RFQ setup failed");
  const reply = {'''
if text.count(old) != 1:
    raise SystemExit(f"expected one direct-send fixture match, found {text.count(old)}")
path.write_text(text.replace(old, new, 1))
print("corrected direct-send regression fixture")
