import { projectedSavings, riskScore, severityFor } from "./domain.mjs";

const ago = minutes => new Date(Date.now() - minutes * 60_000).toISOString();

export function createSeed() {
  const components = [
    { id: "cmp-lidar", mpn: "LD06-HIGHRES", name: "360° LiDAR Module", assembly: "Navigation Stack", supplierCount: 1, inventory: 617, previousInventory: 2100, leadTimeDays: 42, lifecycle: "active", criticality: 1, sourceConfidence: .96 },
    { id: "cmp-som", mpn: "JETSON-ORIN-NX", name: "Edge AI Compute Module", assembly: "Compute Core", supplierCount: 2, inventory: 4120, previousInventory: 5100, leadTimeDays: 21, lifecycle: "active", criticality: 1, sourceConfidence: .94 },
    { id: "cmp-motor", mpn: "BLDC-6384", name: "Brushless Drive Motor", assembly: "Drive System", supplierCount: 3, inventory: 12800, previousInventory: 13400, leadTimeDays: 12, lifecycle: "active", criticality: .8, sourceConfidence: .91 },
    { id: "cmp-bms", mpn: "BMS-13S-80A", name: "Battery Management System", assembly: "Power System", supplierCount: 2, inventory: 7600, previousInventory: 8400, leadTimeDays: 14, lifecycle: "active", criticality: .9, sourceConfidence: .93 },
    { id: "cmp-radio", mpn: "SX1262-MOD", name: "LoRa Radio Module", assembly: "Connectivity", supplierCount: 4, inventory: 23100, previousInventory: 24000, leadTimeDays: 7, lifecycle: "active", criticality: .6, sourceConfidence: .97 }
  ].map(component => {
    const score = riskScore(component);
    return { ...component, score, severity: severityFor(score) };
  });

  const mission = {
    id: "mission-lidar-500",
    title: "Source 500 production LiDAR modules",
    organizationId: "org-atlas",
    productId: "prd-rover",
    componentId: "cmp-lidar",
    quantity: 500,
    status: "qualifying",
    priority: "high",
    createdAt: ago(42),
    updatedAt: ago(2),
    objective: "Find a qualified alternative supplier with better economics and a production lead time under 21 days.",
    specification: "LD06-HIGHRES compatible 360° LiDAR module for the Atlas R2 navigation stack",
    currentSupplier: {
      name: "Northstar Components",
      unitPrice: 429,
      currency: "USD",
      leadTimeDays: 42,
      supplierCoverage: 1
    },
    constraints: {
      targetUnitPrice: 390,
      maxLeadTimeDays: 21,
      regions: ["North America", "Europe", "East Asia", "Southeast Asia"],
      minimumConfidence: .8,
      sampleBudget: 500,
      requirements: ["360° scan", "12m+ operating range", "5V UART/USB compatible", "Production availability"]
    }
  };

  const supplierCandidates = [
    {
      id: "supplier-heliomotion",
      missionId: mission.id,
      name: "HelioMotion Optics",
      country: "China",
      region: "East Asia",
      type: "Manufacturer",
      website: "heliomotion.example",
      status: "qualified",
      confidence: .91,
      specMatch: .95,
      preliminaryUnitPrice: 388,
      currency: "USD",
      moq: 100,
      leadTimeDays: 18,
      availability: "Production capacity indicated",
      source: { kind: "discovery-fixture", reference: "supplier-catalog/hm-ld20" },
      reason: "Strong electrical and mechanical match, target pricing is plausible, and lead time is inside the mission limit."
    },
    {
      id: "supplier-scanworks",
      missionId: mission.id,
      name: "ScanWorks Taiwan",
      country: "Taiwan",
      region: "East Asia",
      type: "Authorized distributor",
      website: "scanworks.example",
      status: "qualified",
      confidence: .88,
      specMatch: .92,
      preliminaryUnitPrice: 402,
      currency: "USD",
      moq: 250,
      leadTimeDays: 14,
      availability: "2,400 units indicated",
      source: { kind: "discovery-fixture", reference: "supplier-catalog/sw-x2" },
      reason: "Fastest lead time and strong spec fit; price needs negotiation to reach the target."
    },
    {
      id: "supplier-optipath",
      missionId: mission.id,
      name: "OptiPath Components",
      country: "Malaysia",
      region: "Southeast Asia",
      type: "Distributor",
      website: "optipath.example",
      status: "needs_review",
      confidence: .79,
      specMatch: .89,
      preliminaryUnitPrice: 374,
      currency: "USD",
      moq: 100,
      leadTimeDays: 22,
      availability: "Stock claim requires verification",
      source: { kind: "discovery-fixture", reference: "supplier-catalog/op-360" },
      reason: "Best preliminary economics, but supplier confidence is below the mission threshold and lead time is one day over target."
    },
    {
      id: "supplier-vectorsense",
      missionId: mission.id,
      name: "VectorSense GmbH",
      country: "Germany",
      region: "Europe",
      type: "Industrial distributor",
      website: "vectorsense.example",
      status: "rejected",
      confidence: .93,
      specMatch: .84,
      preliminaryUnitPrice: 452,
      currency: "USD",
      moq: 500,
      leadTimeDays: 28,
      availability: "Made to order",
      source: { kind: "discovery-fixture", reference: "supplier-catalog/vs-l360" },
      reason: "Commercial terms miss both the price and lead-time constraints without a compensating reliability advantage."
    }
  ].map(candidate => ({
    ...candidate,
    projectedSavings: projectedSavings({
      currentUnitPrice: mission.currentSupplier.unitPrice,
      candidateUnitPrice: candidate.preliminaryUnitPrice,
      quantity: mission.quantity
    })
  }));

  return {
    meta: {
      generatedAt: new Date().toISOString(),
      mode: "procurement-foundation",
      contractVersion: "2.0.0"
    },
    organization: { id: "org-atlas", name: "Atlas Robotics" },
    product: { id: "prd-rover", name: "Atlas Delivery Rover", sku: "ATLAS-R2", targetBuild: 500, buildDate: "September 2026" },
    components,
    missions: [mission],
    supplierCandidates,
    conversations: [],
    quotes: [],
    recommendations: [],
    approvals: [],
    sampleOrders: [],
    activity: [
      { id: "activity-1", missionId: mission.id, at: ago(42), stage: "mission", title: "Sourcing mission created", detail: "500 LiDAR modules · target ≤ $390 · lead time ≤ 21 days" },
      { id: "activity-2", missionId: mission.id, at: ago(31), stage: "discover", title: "4 supplier candidates discovered", detail: "Candidates span East Asia, Southeast Asia, and Europe." },
      { id: "activity-3", missionId: mission.id, at: ago(12), stage: "qualify", title: "2 suppliers qualified", detail: "HelioMotion Optics and ScanWorks Taiwan passed the initial commercial and technical screen." },
      { id: "activity-4", missionId: mission.id, at: ago(2), stage: "qualify", title: "1 supplier needs review", detail: "OptiPath has the lowest preliminary price, but confidence and lead time need verification." }
    ]
  };
}
