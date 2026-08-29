import { createHash } from "node:crypto";

const FIXTURE_SUPPLIERS = Object.freeze([
  {
    id: "supplier-heliomotion",
    name: "HelioMotion Optics",
    country: "China",
    region: "East Asia",
    type: "Manufacturer",
    website: "heliomotion.example",
    confidence: .91,
    specMatch: .95,
    preliminaryUnitPrice: 388,
    currency: "USD",
    moq: 100,
    leadTimeDays: 18,
    availability: "Production capacity indicated",
    source: { kind: "controlled-fixture", reference: "supplier-catalog/hm-ld20" }
  },
  {
    id: "supplier-scanworks",
    name: "ScanWorks Taiwan",
    country: "Taiwan",
    region: "East Asia",
    type: "Authorized distributor",
    website: "scanworks.example",
    confidence: .88,
    specMatch: .92,
    preliminaryUnitPrice: 402,
    currency: "USD",
    moq: 250,
    leadTimeDays: 14,
    availability: "2,400 units indicated",
    source: { kind: "controlled-fixture", reference: "supplier-catalog/sw-x2" }
  },
  {
    id: "supplier-optipath",
    name: "OptiPath Components",
    country: "Malaysia",
    region: "Southeast Asia",
    type: "Distributor",
    website: "optipath.example",
    confidence: .79,
    specMatch: .89,
    preliminaryUnitPrice: 374,
    currency: "USD",
    moq: 100,
    leadTimeDays: 22,
    availability: "Stock claim requires verification",
    source: { kind: "controlled-fixture", reference: "supplier-catalog/op-360" }
  },
  {
    id: "supplier-vectorsense",
    name: "VectorSense GmbH",
    country: "Germany",
    region: "Europe",
    type: "Industrial distributor",
    website: "vectorsense.example",
    confidence: .93,
    specMatch: .84,
    preliminaryUnitPrice: 452,
    currency: "USD",
    moq: 500,
    leadTimeDays: 28,
    availability: "Made to order",
    source: { kind: "controlled-fixture", reference: "supplier-catalog/vs-l360" }
  },
  {
    id: "supplier-ameriscan",
    name: "AmeriScan Robotics Supply",
    country: "United States",
    region: "North America",
    type: "Distributor",
    website: "ameriscan.example",
    confidence: .86,
    specMatch: .81,
    preliminaryUnitPrice: 418,
    currency: "USD",
    moq: 50,
    leadTimeDays: 19,
    availability: "Stock available in batches",
    source: { kind: "controlled-fixture", reference: "supplier-catalog/as-r360" }
  }
]);

const MAX_REMOTE_RESPONSE_BYTES = 1_000_000;
const MAX_REMOTE_CANDIDATES = 50;

function stableCandidateId(missionId, name, reference) {
  const digest = createHash("sha256").update(`${missionId}\n${name}\n${reference}`).digest("hex").slice(0, 16);
  return `supplier-${digest}`;
}

function optionalNonNegative(value, key, index) {
  if (value == null) return null;
  if (!Number.isFinite(value) || value < 0) throw new Error(`Discovery result ${index + 1} has invalid ${key}`);
  return value;
}

export function normalizeDiscoveredCandidate(candidate, mission, index = 0, sourceKind = "external-research") {
  if (!candidate || typeof candidate !== "object") throw new Error(`Discovery result ${index + 1} is not an object`);
  const requiredStrings = ["name", "country", "region", "type"];
  for (const key of requiredStrings) {
    if (typeof candidate[key] !== "string" || !candidate[key].trim()) throw new Error(`Discovery result ${index + 1} is missing ${key}`);
  }
  for (const key of ["confidence", "specMatch"]) {
    if (!Number.isFinite(candidate[key]) || candidate[key] < 0 || candidate[key] > 1) throw new Error(`Discovery result ${index + 1} has ${key} outside 0..1`);
  }

  const reference = candidate.source?.reference || candidate.sourceReference || candidate.reference;
  if (typeof reference !== "string" || !reference.trim()) throw new Error(`Discovery result ${index + 1} requires source provenance`);
  const preliminaryUnitPrice = optionalNonNegative(candidate.preliminaryUnitPrice, "preliminaryUnitPrice", index);
  const moq = optionalNonNegative(candidate.moq, "moq", index);
  const leadTimeDays = optionalNonNegative(candidate.leadTimeDays, "leadTimeDays", index);

  return {
    id: candidate.id || stableCandidateId(mission.id, candidate.name.trim(), reference.trim()),
    missionId: mission.id,
    name: candidate.name.trim(),
    country: candidate.country.trim(),
    region: candidate.region.trim(),
    type: candidate.type.trim(),
    website: candidate.website || null,
    status: "discovered",
    confidence: candidate.confidence,
    specMatch: candidate.specMatch,
    preliminaryUnitPrice,
    currency: candidate.currency || "USD",
    moq,
    leadTimeDays,
    availability: candidate.availability || "Unknown",
    discoveredAt: candidate.discoveredAt || new Date().toISOString(),
    source: {
      kind: candidate.source?.kind || sourceKind,
      reference: reference.trim()
    }
  };
}

export function normalizeDiscoveredCandidates(mission, candidates, sourceKind = "external-research") {
  if (!Array.isArray(candidates) || candidates.length === 0) throw new Error("At least one supplier candidate is required");
  if (candidates.length > MAX_REMOTE_CANDIDATES) throw new Error(`No more than ${MAX_REMOTE_CANDIDATES} supplier candidates may be recorded at once`);
  return candidates.map((candidate, index) => normalizeDiscoveredCandidate(candidate, mission, index, sourceKind));
}

export function discoverFixtureSuppliers(mission) {
  return FIXTURE_SUPPLIERS
    .filter(candidate => mission.constraints.regions.includes(candidate.region))
    .filter(candidate => candidate.specMatch >= .8)
    .slice(0, 12)
    .map((candidate, index) => normalizeDiscoveredCandidate(candidate, mission, index, "controlled-fixture"));
}

async function discoverFromRemoteProvider(mission, { url, token }) {
  const parsedUrl = new URL(url);
  if (process.env.NODE_ENV === "production" && parsedUrl.protocol !== "https:") {
    throw new Error("Production discovery provider must use HTTPS");
  }

  const response = await fetch(parsedUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {})
    },
    body: JSON.stringify({
      mission: {
        id: mission.id,
        componentId: mission.componentId,
        specification: mission.specification,
        quantity: mission.quantity,
        constraints: mission.constraints
      }
    }),
    signal: AbortSignal.timeout(10_000)
  });
  if (!response.ok) throw new Error(`Discovery provider returned ${response.status}`);
  const declaredLength = Number(response.headers.get("content-length") || 0);
  if (declaredLength > MAX_REMOTE_RESPONSE_BYTES) throw new Error("Discovery provider response is too large");
  const raw = await response.text();
  if (Buffer.byteLength(raw) > MAX_REMOTE_RESPONSE_BYTES) throw new Error("Discovery provider response is too large");
  let payload;
  try { payload = JSON.parse(raw); } catch { throw new Error("Discovery provider returned invalid JSON"); }
  if (!Array.isArray(payload.suppliers)) throw new Error("Discovery provider response must contain a suppliers array");
  return normalizeDiscoveredCandidates(mission, payload.suppliers, "remote-discovery");
}

export async function discoverSuppliers(mission, options = {}) {
  const url = options.url ?? process.env.VENDOR_SCOUT_DISCOVERY_URL;
  const token = options.token ?? process.env.VENDOR_SCOUT_DISCOVERY_TOKEN;
  const allowFixtureFallback = options.allowFixtureFallback ?? (
    process.env.NODE_ENV !== "production" || process.env.VENDOR_SCOUT_ALLOW_FIXTURE_FALLBACK === "1"
  );

  if (url) {
    try {
      const candidates = await discoverFromRemoteProvider(mission, { url, token });
      return { provider: "remote", candidates, fallbackUsed: false };
    } catch (error) {
      if (!allowFixtureFallback) throw error;
      return {
        provider: "controlled-fixture",
        candidates: discoverFixtureSuppliers(mission),
        fallbackUsed: true,
        providerError: error.message
      };
    }
  }

  if (!allowFixtureFallback) {
    throw new Error("Supplier discovery provider is not configured and fixture fallback is disabled");
  }

  return {
    provider: "controlled-fixture",
    candidates: discoverFixtureSuppliers(mission),
    fallbackUsed: true,
    providerError: null
  };
}
