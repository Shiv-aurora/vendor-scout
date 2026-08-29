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

function normalizeCandidate(candidate, mission, index, sourceKind) {
  if (!candidate || typeof candidate !== "object") throw new Error(`Discovery result ${index + 1} is not an object`);
  const requiredStrings = ["name", "country", "region", "type"];
  for (const key of requiredStrings) {
    if (!candidate[key]) throw new Error(`Discovery result ${index + 1} is missing ${key}`);
  }
  for (const key of ["confidence", "specMatch", "preliminaryUnitPrice", "moq", "leadTimeDays"]) {
    if (!Number.isFinite(candidate[key])) throw new Error(`Discovery result ${index + 1} has invalid ${key}`);
  }

  const reference = candidate.source?.reference || candidate.reference || `${sourceKind}/${candidate.id || index + 1}`;
  return {
    id: candidate.id || `supplier-${mission.id}-${index + 1}`,
    missionId: mission.id,
    name: candidate.name,
    country: candidate.country,
    region: candidate.region,
    type: candidate.type,
    website: candidate.website || null,
    status: "discovered",
    confidence: candidate.confidence,
    specMatch: candidate.specMatch,
    preliminaryUnitPrice: candidate.preliminaryUnitPrice,
    currency: candidate.currency || "USD",
    moq: candidate.moq,
    leadTimeDays: candidate.leadTimeDays,
    availability: candidate.availability || "Unknown",
    discoveredAt: new Date().toISOString(),
    source: {
      kind: candidate.source?.kind || sourceKind,
      reference
    }
  };
}

export function discoverFixtureSuppliers(mission) {
  return FIXTURE_SUPPLIERS
    .filter(candidate => mission.constraints.regions.includes(candidate.region))
    .filter(candidate => candidate.specMatch >= .8)
    .slice(0, 12)
    .map((candidate, index) => normalizeCandidate(candidate, mission, index, "controlled-fixture"));
}

async function discoverFromRemoteProvider(mission, { url, token }) {
  const response = await fetch(url, {
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
  const payload = await response.json();
  if (!Array.isArray(payload.suppliers)) throw new Error("Discovery provider response must contain a suppliers array");
  return payload.suppliers.map((candidate, index) => normalizeCandidate(candidate, mission, index, "remote-discovery"));
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
