import { qualifySupplier, riskScore, severityFor } from "./domain.mjs";
import { discoverFixtureSuppliers } from "./discovery.mjs";
import { CURRENT_CONTRACT_VERSION } from "./migrations.mjs";

const ago = minutes => new Date(Date.now() - minutes * 60_000).toISOString();
const supportedSeedStages = new Set(["draft", "discovering", "qualifying", "contacting"]);

export function createSeed({ missionStage = process.env.NODE_ENV === "production" ? "draft" : "contacting" } = {}) {
  if (!supportedSeedStages.has(missionStage)) throw new Error(`Unsupported seed mission stage: ${missionStage}`);

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
    status: missionStage,
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
    },
    execution: {
      discoveryProvider: missionStage === "contacting" ? "controlled-fixture" : null,
      qualificationMode: missionStage === "contacting" ? "deterministic-rules" : null,
      fallbackUsed: missionStage === "contacting",
      lastRunAt: missionStage === "contacting" ? ago(2) : null
    }
  };

  const discovered = ["qualifying", "contacting"].includes(missionStage) ? discoverFixtureSuppliers(mission) : [];
  const supplierCandidates = missionStage === "contacting"
    ? discovered.map(candidate => qualifySupplier(mission, candidate, ago(2)))
    : discovered;

  const activity = [
    { id: "activity-1", missionId: mission.id, at: ago(42), stage: "mission", title: "Sourcing mission created", detail: "500 LiDAR modules · target ≤ $390 · lead time ≤ 21 days" }
  ];

  if (["discovering", "qualifying", "contacting"].includes(missionStage)) {
    activity.push({ id: "activity-2", missionId: mission.id, at: ago(34), stage: "discover", title: "Supplier discovery started", detail: "Searching the mission's allowed regions against technical and commercial constraints." });
  }
  if (["qualifying", "contacting"].includes(missionStage)) {
    activity.push({ id: "activity-3", missionId: mission.id, at: ago(31), stage: "discover", title: `${discovered.length} supplier candidates discovered`, detail: "Candidate evidence was preserved with source provenance for qualification." });
  }
  if (missionStage === "contacting") {
    const qualified = supplierCandidates.filter(candidate => candidate.status === "qualified").length;
    const rejected = supplierCandidates.filter(candidate => candidate.status === "rejected").length;
    const review = supplierCandidates.filter(candidate => candidate.status === "needs_review").length;
    activity.push({ id: "activity-4", missionId: mission.id, at: ago(2), stage: "qualify", title: "Qualification completed", detail: `${qualified} qualified · ${review} need review · ${rejected} rejected. Qualified suppliers are ready for outreach.` });
  }

  return {
    meta: {
      generatedAt: new Date().toISOString(),
      mode: "procurement-foundation",
      contractVersion: CURRENT_CONTRACT_VERSION
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
    activity
  };
}
