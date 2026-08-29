export const SOURCE_STATES = Object.freeze([
  "healthy", "suspicious", "degraded", "healing", "recovered"
]);

export const MISSION_STATES = Object.freeze([
  "draft",
  "discovering",
  "qualifying",
  "contacting",
  "negotiating",
  "comparing",
  "awaiting_approval",
  "approved",
  "rejected",
  "completed"
]);

const MISSION_TRANSITIONS = Object.freeze({
  draft: { start: "discovering" },
  discovering: { discovery_complete: "qualifying" },
  qualifying: { qualification_complete: "contacting" },
  contacting: { outreach_complete: "negotiating" },
  negotiating: { negotiation_complete: "comparing" },
  comparing: { analysis_complete: "awaiting_approval" },
  awaiting_approval: {
    approve: "approved",
    reject: "rejected",
    negotiate_more: "negotiating"
  },
  approved: { action_complete: "completed" }
});

export function validateObservation(value) {
  const errors = [];
  if (!value || typeof value !== "object") return ["observation must be an object"];
  for (const key of ["componentId", "supplierId", "sourceId", "collectedAt", "provenance"]) {
    if (!value[key]) errors.push(`${key} is required`);
  }
  if (value.inventory != null && (!Number.isFinite(value.inventory) || value.inventory < 0)) {
    errors.push("inventory must be a non-negative number or null");
  }
  if (value.leadTimeDays != null && (!Number.isFinite(value.leadTimeDays) || value.leadTimeDays < 0)) {
    errors.push("leadTimeDays must be a non-negative number or null");
  }
  if (!value.provenance?.reference || !value.provenance?.kind) {
    errors.push("provenance requires reference and kind");
  }
  return errors;
}

export function riskScore({ inventory, previousInventory, leadTimeDays, supplierCount, lifecycle, criticality = 1, sourceConfidence = 1 }) {
  const inventoryRisk = inventory == null ? 30 : inventory < 700 ? 92 : inventory < 2500 ? 70 : inventory < 10000 ? 35 : 8;
  const velocity = previousInventory > 0 && inventory != null ? Math.max(0, (previousInventory - inventory) / previousInventory) : 0;
  const velocityRisk = Math.min(100, velocity * 145);
  const leadRisk = Math.min(100, Math.max(0, ((leadTimeDays ?? 0) - 7) * 4.2));
  const concentrationRisk = supplierCount <= 1 ? 92 : supplierCount === 2 ? 55 : 18;
  const lifecycleRisk = lifecycle === "obsolete" ? 100 : lifecycle === "nrnd" ? 78 : 8;
  const weighted = inventoryRisk * .27 + velocityRisk * .23 + leadRisk * .18 + concentrationRisk * .17 + lifecycleRisk * .15;
  return Math.round(Math.min(100, weighted * (.75 + criticality * .25) * (.85 + sourceConfidence * .15)));
}

export function severityFor(score) {
  if (score >= 80) return "critical";
  if (score >= 60) return "high";
  if (score >= 35) return "medium";
  return "low";
}

export function transitionSource(current, event) {
  const transitions = {
    healthy: { anomaly: "suspicious", invalid: "degraded" },
    suspicious: { valid: "healthy", invalid: "degraded" },
    degraded: { heal: "healing" },
    healing: { verified: "recovered", failed: "degraded" },
    recovered: { valid: "healthy", invalid: "degraded" }
  };
  return transitions[current]?.[event] ?? current;
}

export function transitionMission(current, event) {
  if (!MISSION_STATES.includes(current)) return current;
  return MISSION_TRANSITIONS[current]?.[event] ?? current;
}

export function projectedSavings({ currentUnitPrice, candidateUnitPrice, quantity, shipping = 0 }) {
  if (![currentUnitPrice, candidateUnitPrice, quantity, shipping].every(Number.isFinite)) return 0;
  const currentCost = currentUnitPrice * quantity;
  const candidateCost = candidateUnitPrice * quantity + shipping;
  return Math.max(0, Math.round((currentCost - candidateCost) * 100) / 100);
}
