import { riskScore, severityFor } from "./domain.mjs";

const ago = days => new Date(Date.now() - days * 86400000).toISOString();

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

  const sources = [
    { id: "src-supplier-a", name: "Northstar Components", reference: "sample-source-01", state: "healthy", freshness: "4m", rows: 28, kind: "sample", region: { country: "United States", market: "North America" } },
    { id: "src-manufacturer", name: "Vector Optics Catalog", reference: "sample-source-02", state: "healthy", freshness: "11m", rows: 14, kind: "sample", region: { country: "Germany", market: "Europe" } },
    { id: "src-controlled", name: "Local Quality Fixture", reference: "sample-source-03", state: "recovered", freshness: "1m", rows: 8, kind: "sample", region: { country: "Local", market: "Demo fixture" } },
    { id: "src-distributor", name: "Arcline Industrial", reference: "sample-source-04", state: "healthy", freshness: "19m", rows: 41, kind: "sample", region: { country: "Canada", market: "North America" } }
  ];

  const catalog = components.map((component, index) => ({
    id: `sample-${component.id}`,
    title: component.name,
    componentId: component.id,
    supplierId: sources[index % sources.length].id,
    sourceId: sources[index % sources.length].id,
    mpn: component.mpn,
    manufacturer: ["Lumen Dynamics", "Northstar Compute", "Arcline Motion", "Vector Power", "SignalWorks"][index],
    collectedAt: ago(index / 24),
    inventory: component.inventory,
    price: { amount: [429, 899, 174, 238, 39][index], currency: "USD" },
    availability: component.inventory < 1000 ? "low_stock" : "in_stock",
    provenance: { kind: "sample", region: sources[index % sources.length].region.country, reference: `local-sample-${index + 1}` }
  }));

  const lidarHistory = [18, 11, 4].map((days, index) => ({
    ...catalog[0],
    id: `sample-lidar-history-${index + 1}`,
    collectedAt: ago(days),
    inventory: [18000, 9200, 2100][index],
    provenance: { ...catalog[0].provenance, reference: `local-history-${index + 1}` }
  }));

  return {
    meta: { generatedAt: new Date().toISOString(), mode: "local-demo", contractVersion: "1.0.0" },
    product: { id: "prd-rover", name: "Atlas Delivery Rover", sku: "ATLAS-R2", targetBuild: 500, buildDate: "September 2026" },
    components,
    trends: {
      "cmp-lidar": [18000, 9200, 2100, 617],
      "cmp-som": [7800, 6500, 5100, 4120],
      "cmp-motor": [14200, 13900, 13400, 12800],
      "cmp-bms": [9800, 9100, 8400, 7600],
      "cmp-radio": [26000, 25100, 24000, 23100]
    },
    sources,
    observations: [...lidarHistory, ...catalog],
    alternatives: [
      { id: "alt-1", componentId: "cmp-lidar", mpn: "LD19-R2", manufacturer: "Lumen Dynamics", confidence: .82, status: "possible", checks: ["Connector pinout", "Driver validation"], stock: 6400 },
      { id: "alt-2", componentId: "cmp-lidar", mpn: "YDLIDAR-X4", manufacturer: "EAI Robotics", confidence: .68, status: "review", checks: ["Range tolerance", "Ingress rating", "Mount geometry"], stock: 3100 }
    ],
    qualityEvents: [
      { at: ago(.08), sourceId: "src-controlled", state: "degraded", title: "Sample validation failed", detail: "The inventory field was missing from a local fixture and was quarantined." },
      { at: ago(.06), sourceId: "src-controlled", state: "healing", title: "Local fixture corrected", detail: "The sample record was updated without contacting an external service." },
      { at: ago(.03), sourceId: "src-controlled", state: "recovered", title: "Sample verified", detail: "8 local records passed the demo data contract." }
    ]
  };
}
