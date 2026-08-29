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

export function validateMission(value) {
  const errors = [];
  if (!value || typeof value !== "object") return ["mission must be an object"];
  for (const key of ["id", "title", "organizationId", "productId", "componentId", "objective", "specification", "status"]) {
    if (!value[key]) errors.push(`${key} is required`);
  }
  if (!MISSION_STATES.includes(value.status)) errors.push("status is invalid");
  if (!Number.isInteger(value.quantity) || value.quantity <= 0) errors.push("quantity must be a positive integer");
  if (!value.currentSupplier?.name) errors.push("current supplier name is required");
  if (!Number.isFinite(value.currentSupplier?.unitPrice) || value.currentSupplier.unitPrice < 0) errors.push("current supplier unit price must be non-negative");
  if (!Number.isFinite(value.currentSupplier?.leadTimeDays) || value.currentSupplier.leadTimeDays < 0) errors.push("current supplier lead time must be non-negative");

  const constraints = value.constraints;
  if (!constraints || typeof constraints !== "object") {
    errors.push("constraints are required");
    return errors;
  }
  if (!Number.isFinite(constraints.targetUnitPrice) || constraints.targetUnitPrice < 0) errors.push("target unit price must be non-negative");
  if (!Number.isFinite(constraints.maxLeadTimeDays) || constraints.maxLeadTimeDays <= 0) errors.push("maximum lead time must be positive");
  if (!Array.isArray(constraints.regions) || constraints.regions.length === 0) errors.push("at least one supplier region is required");
  if (!Number.isFinite(constraints.minimumConfidence) || constraints.minimumConfidence < 0 || constraints.minimumConfidence > 1) errors.push("minimum confidence must be between 0 and 1");
  if (!Number.isFinite(constraints.sampleBudget) || constraints.sampleBudget < 0) errors.push("sample budget must be non-negative");
  if (!Array.isArray(constraints.requirements) || constraints.requirements.length === 0) errors.push("at least one technical requirement is required");
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

export function qualifySupplier(mission, candidate, now = new Date().toISOString()) {
  const constraints = mission.constraints;
  const hasLeadTime = Number.isFinite(candidate.leadTimeDays);
  const hasMoq = Number.isFinite(candidate.moq);
  const hasPrice = Number.isFinite(candidate.preliminaryUnitPrice);
  const checks = {
    region: constraints.regions.includes(candidate.region),
    confidence: candidate.confidence >= constraints.minimumConfidence,
    specification: candidate.specMatch >= 0.9,
    leadTime: hasLeadTime && candidate.leadTimeDays <= constraints.maxLeadTimeDays,
    moq: hasMoq && candidate.moq <= mission.quantity,
    commercialPlausibility: hasPrice && candidate.preliminaryUnitPrice <= mission.currentSupplier.unitPrice
  };

  const hardFailures = [];
  if (!checks.region) hardFailures.push("region is outside the mission policy");
  if (candidate.specMatch < 0.8) hardFailures.push("technical match is below the minimum viable threshold");
  if (candidate.confidence < Math.max(0, constraints.minimumConfidence - 0.1)) hardFailures.push("supplier confidence is materially below threshold");
  if (hasLeadTime && candidate.leadTimeDays > constraints.maxLeadTimeDays + 5) hardFailures.push(`lead time exceeds the mission limit by ${candidate.leadTimeDays - constraints.maxLeadTimeDays} days`);
  if (hasMoq && candidate.moq > mission.quantity * 2) hardFailures.push("MOQ is incompatible with the requested quantity");

  const reviewFlags = [];
  if (!checks.confidence) reviewFlags.push("confidence is below threshold");
  if (!checks.specification) reviewFlags.push("technical fit needs confirmation");
  if (!hasLeadTime) reviewFlags.push("lead time is not yet verified");
  else if (!checks.leadTime) reviewFlags.push(`lead time is ${candidate.leadTimeDays - constraints.maxLeadTimeDays} day${candidate.leadTimeDays - constraints.maxLeadTimeDays === 1 ? "" : "s"} over target`);
  if (!hasMoq) reviewFlags.push("MOQ is not yet verified");
  else if (!checks.moq) reviewFlags.push("MOQ exceeds the requested quantity");
  if (!hasPrice) reviewFlags.push("preliminary unit price is not yet available");
  else if (!checks.commercialPlausibility) reviewFlags.push("preliminary price is above the current supplier");

  let status = "qualified";
  let reason = "Region, confidence, technical fit, MOQ, lead time, and preliminary economics pass the mission screen.";
  if (hardFailures.length) {
    status = "rejected";
    reason = `Rejected: ${hardFailures.join("; ")}.`;
  } else if (reviewFlags.length) {
    status = "needs_review";
    reason = `Needs review: ${reviewFlags.join("; ")}.`;
  }

  return {
    ...candidate,
    status,
    reason,
    qualification: {
      evaluatedAt: now,
      checks,
      hardFailures,
      reviewFlags
    },
    projectedSavings: projectedSavings({
      currentUnitPrice: mission.currentSupplier.unitPrice,
      candidateUnitPrice: candidate.preliminaryUnitPrice,
      quantity: mission.quantity
    })
  };
}
