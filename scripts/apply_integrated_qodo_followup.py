from pathlib import Path


def replace_once(path, old, new):
    p = Path(path)
    text = p.read_text()
    count = text.count(old)
    if count != 1:
        raise SystemExit(f"{path}: expected one match, found {count}")
    p.write_text(text.replace(old, new, 1))

replace_once(
    "lib/negotiation.mjs",
'''function effectivePriceForQuantity(offer, quantity) {
  if (Number.isFinite(offer?.unitPrice)) return { price: offer.unitPrice, basis: "unit-price" };
  const tiers = Array.isArray(offer?.quantityTiers) ? offer.quantityTiers : [];
  const applicable = tiers
    .filter(tier => Number.isInteger(tier.minQuantity) && tier.minQuantity <= quantity && Number.isFinite(tier.unitPrice))
    .sort((a, b) => b.minQuantity - a.minQuantity)[0];
  return applicable
    ? { price: applicable.unitPrice, basis: `quantity-tier-${applicable.minQuantity}` }
    : { price: null, basis: null };
}''',
'''function effectivePriceForQuantity(offer, quantity) {
  const tiers = Array.isArray(offer?.quantityTiers) ? offer.quantityTiers : [];
  const applicable = tiers
    .filter(tier => Number.isInteger(tier.minQuantity) && tier.minQuantity <= quantity && Number.isFinite(tier.unitPrice))
    .sort((a, b) => b.minQuantity - a.minQuantity)[0];
  if (applicable) return { price: applicable.unitPrice, basis: `quantity-tier-${applicable.minQuantity}` };
  if (Number.isFinite(offer?.unitPrice)) return { price: offer.unitPrice, basis: "unit-price" };
  return { price: null, basis: null };
}''')

replace_once(
    "lib/mcp.mjs",
'''function validateCandidateBatch(candidates) {
  if (!Array.isArray(candidates)) throw new Error("candidates array is required");
  if (!candidates.length) throw new Error("candidates array must contain at least one supplier");
  if (candidates.length > 50) throw new Error("candidates array may contain no more than 50 suppliers");
  for (const [index, candidate] of candidates.entries()) {
    if (!candidate || typeof candidate !== "object" || Array.isArray(candidate)) throw new Error(`candidate ${index + 1} must be an object`);
    for (const key of Object.keys(candidate)) {
      if (!CANDIDATE_PROPERTIES.has(key)) throw new Error(`candidate ${index + 1} has unsupported property ${key}`);
    }
  }
}''',
'''function validateCandidateBatch(candidates) {
  if (!Array.isArray(candidates)) throw new Error("candidates array is required");
  if (!candidates.length) throw new Error("candidates array must contain at least one supplier");
  if (candidates.length > 50) throw new Error("candidates array may contain no more than 50 suppliers");

  const requiredStrings = ["name", "country", "region", "type", "sourceReference"];
  const nullableStrings = ["website", "contactEmail", "contactSourceReference", "availability"];
  const rangedNumbers = [["confidence", 0, 1, false], ["specMatch", 0, 1, false], ["preliminaryUnitPrice", 0, Infinity, true], ["moq", 0, Infinity, true], ["leadTimeDays", 0, Infinity, true]];

  for (const [index, candidate] of candidates.entries()) {
    const label = `candidate ${index + 1}`;
    if (!candidate || typeof candidate !== "object" || Array.isArray(candidate)) throw new Error(`${label} must be an object`);
    for (const key of Object.keys(candidate)) {
      if (!CANDIDATE_PROPERTIES.has(key)) throw new Error(`${label} has unsupported property ${key}`);
    }
    for (const field of requiredStrings) {
      if (typeof candidate[field] !== "string" || !candidate[field].trim()) throw new Error(`${label}.${field} must be a non-empty string`);
    }
    for (const field of nullableStrings) {
      const value = candidate[field];
      if (value != null && typeof value !== "string") throw new Error(`${label}.${field} must be a string or null`);
    }
    for (const [field, min, max, nullable] of rangedNumbers) {
      const value = candidate[field];
      if (value == null && nullable) continue;
      if (!Number.isFinite(value) || value < min || value > max) throw new Error(`${label}.${field} is outside the allowed numeric range`);
    }
    if (candidate.currency != null && (typeof candidate.currency !== "string" || candidate.currency.length !== 3)) {
      throw new Error(`${label}.currency must be a three-letter string`);
    }
  }
}''')

replace_once(
    "lib/outreach.mjs",
'''  const normalizedReceivedAt = normalizeReceivedAt(receivedAt);
  const normalizedContent = content.trim().slice(0, 100_000);
  const normalizedProviderMessageId = providerMessageId == null ? null : providerMessageId.trim();
  const messageId = normalizedProviderMessageId
    ? stableId("msg", conversation.id, "inbound", normalizedProviderMessageId)
    : stableId("msg", conversation.id, "inbound", sourceReference, normalizedContent);''',
'''  const normalizedReceivedAt = normalizeReceivedAt(receivedAt);
  const normalizedContent = content.trim().slice(0, 100_000);
  const normalizedSourceReference = sourceReference.trim();
  const normalizedProviderMessageId = providerMessageId == null ? null : providerMessageId.trim();
  const messageId = normalizedProviderMessageId
    ? stableId("msg", conversation.id, "inbound", normalizedProviderMessageId)
    : stableId("msg", conversation.id, "inbound", normalizedSourceReference, normalizedContent);''')

replace_once(
    "lib/outreach.mjs",
'''    sourceReference: sourceReference.trim(),''',
'''    sourceReference: normalizedSourceReference,''')

for path, label in [("lib/trueforge.mjs", "TrueForge"), ("lib/outreach.mjs", "Outreach provider")]:
    if path == "lib/trueforge.mjs":
        old = '''  const declaredLength = Number(response.headers.get("content-length") || 0);
  if (declaredLength > limit) throw new Error("TrueForge response is too large");'''
        new = '''  const declaredLength = Number(response.headers.get("content-length") || 0);
  if (declaredLength > limit) {
    try { await response.body?.cancel(); } catch {}
    throw new Error("TrueForge response is too large");
  }'''
    else:
        old = '''  const declared = Number(response.headers.get("content-length") || 0);
  if (declared > limit) throw new Error(`${label} response is too large`);'''
        new = '''  const declared = Number(response.headers.get("content-length") || 0);
  if (declared > limit) {
    try { await response.body?.cancel(); } catch {}
    throw new Error(`${label} response is too large`);
  }'''
    replace_once(path, old, new)

# Strengthen existing tier regression so both standalone and tier prices are present.
replace_once(
    "test/qodo-stack-regressions.test.mjs",
'''    unitPrice: null,
    currency: "USD",
    quantityTiers: [
      { minQuantity: 100, unitPrice: 410 },
      { minQuantity: 500, unitPrice: 385 }
    ],''',
'''    unitPrice: 410,
    currency: "USD",
    quantityTiers: [
      { minQuantity: 100, unitPrice: 405 },
      { minQuantity: 500, unitPrice: 385 }
    ],''')

# Make the replay regression vary only insignificant source-reference whitespace and avoid provider-ID dedupe.
replace_once(
    "test/qodo-stack-regressions.test.mjs",
'''        sourceReference: "gmail/same",
        providerMessageId: "same",
        receivedAt: "2026-08-29T16:00:00Z"''',
'''        sourceReference: "gmail/same",
        receivedAt: "2026-08-29T16:00:00Z"''')
replace_once(
    "test/qodo-stack-regressions.test.mjs",
'''  await postJson(`${runtime.baseUrl}/mcp`, { ...reply, id: 5 });
  await postJson(`${runtime.baseUrl}/mcp`, { ...reply, id: 6 });''',
'''  await postJson(`${runtime.baseUrl}/mcp`, { ...reply, id: 5 });
  const whitespaceReplay = structuredClone(reply);
  whitespaceReplay.params.arguments.sourceReference = "  gmail/same  ";
  await postJson(`${runtime.baseUrl}/mcp`, { ...whitespaceReplay, id: 6 });''')

p = Path("test/qodo-stack-regressions.test.mjs")
text = p.read_text()
marker = 'test("MCP candidate values honor the published schema", async () => {'
if marker not in text:
    text += r'''

test("MCP candidate values honor the published schema", async () => {
  let calls = 0;
  const base = {
    name: "Valid Supplier",
    country: "US",
    region: "North America",
    type: "Manufacturer",
    confidence: 0.9,
    specMatch: 0.9,
    sourceReference: "https://supplier.test/evidence"
  };
  const context = { recordSuppliers: async () => { calls += 1; return {}; } };
  for (const badCandidate of [
    { ...base, website: 42 },
    { ...base, currency: "X" },
    { ...base, confidence: 2 },
    { ...base, preliminaryUnitPrice: -1 },
    { ...base, sourceReference: "   " }
  ]) {
    const result = await handleMcpMessage({
      jsonrpc: "2.0",
      id: 90 + calls,
      method: "tools/call",
      params: { name: "vendor_scout_record_supplier_candidates", arguments: { missionId: "m", candidates: [badCandidate] } }
    }, context);
    assert.equal(result.result.isError, true);
  }
  assert.equal(calls, 0);
});

test("declared oversized provider bodies are rejected before parsing", async t => {
  const server = http.createServer((req, res) => {
    const trueForge = req.url.includes("/api/v1/sessions");
    res.writeHead(200, {
      "Content-Type": "application/json",
      "Content-Length": String(trueForge ? 2_000_001 : 300_000)
    });
    res.end("{}");
  });
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  t.after(() => new Promise(resolve => server.close(resolve)));
  const { port } = server.address();

  const client = new TrueForgeClient({ baseUrl: `http://127.0.0.1:${port}`, agentName: "vendor-scout" });
  await assert.rejects(client.createSession(), /TrueForge response is too large/);

  const { mission, candidate, conversation } = liveFixture();
  await assert.rejects(
    deliverRfq(
      { mission, candidate, conversation, message: outboundRfqMessage(conversation) },
      { url: `http://127.0.0.1:${port}/outreach`, allowControlledPreview: false }
    ),
    /Outreach provider response is too large/
  );
});
'''
    p.write_text(text)

print("applied four integrated Qodo follow-up fixes")
