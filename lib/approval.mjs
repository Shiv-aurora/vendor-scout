import { createHash } from "node:crypto";

function stableId(prefix, ...parts) {
  const digest = createHash("sha256").update(parts.join("\n")).digest("hex").slice(0, 18);
  return `${prefix}-${digest}`;
}

function finiteOrNull(value) {
  return Number.isFinite(value) ? value : null;
}

export function buildApprovalPacket(mission, recommendation, quote, supplier, competingQuotes = [], now = new Date().toISOString(), cycle = 1) {
  if (!mission || !recommendation || !quote || !supplier) throw new Error("Mission, recommendation, quote, and supplier are required");
  if (recommendation.missionId !== mission.id || quote.missionId !== mission.id || supplier.missionId !== mission.id) {
    throw new Error("Approval evidence must belong to the same sourcing mission");
  }
  if (recommendation.quoteId !== quote.id || recommendation.supplierId !== supplier.id) {
    throw new Error("Approval recommendation must match the recommended quote and supplier");
  }

  const samplePrice = finiteOrNull(quote.sample?.basePrice);
  const sampleAvailable = quote.sample?.available === true;
  const sampleWithinBudget = sampleAvailable && Number.isFinite(samplePrice) && samplePrice <= mission.constraints.sampleBudget;
  const action = sampleWithinBudget
    ? {
        kind: "order_sample",
        quantity: 1,
        estimatedSpendBase: samplePrice,
        currency: quote.baseCurrency,
        budgetBase: mission.constraints.sampleBudget,
        withinBudget: true,
        executable: true
      }
    : {
        kind: "progress_supplier_relationship",
        quantity: null,
        estimatedSpendBase: samplePrice,
        currency: quote.baseCurrency,
        budgetBase: mission.constraints.sampleBudget,
        withinBudget: false,
        executable: false
      };

  const comparable = competingQuotes
    .filter(item => item.missionId === mission.id && item.id !== quote.id)
    .sort((a, b) => (a.rank ?? Number.MAX_SAFE_INTEGER) - (b.rank ?? Number.MAX_SAFE_INTEGER))
    .map(item => ({
      quoteId: item.id,
      supplierId: item.supplierId,
      supplierName: item.supplierName,
      rank: item.rank ?? null,
      rankable: item.comparison?.rankable !== false,
      comparisonBasis: item.comparison?.basis ?? null,
      missingEvidence: item.completeness?.missing || [],
      score: item.score?.total ?? null,
      landedCostBase: item.landedCost?.base ?? null,
      knownTotalBase: item.knownTotal?.base ?? null,
      leadTimeDays: item.leadTimeDays,
      moq: item.moq,
      supplierRiskScore: item.supplierRiskScore,
      completeLandedCost: item.landedCost?.complete === true
    }));

  return {
    id: stableId("approval", mission.id, recommendation.id, quote.id, String(cycle)),
    cycle,
    missionId: mission.id,
    recommendationId: recommendation.id,
    quoteId: quote.id,
    supplierId: supplier.id,
    supplierName: supplier.name,
    type: action.kind,
    status: "pending",
    createdAt: now,
    updatedAt: now,
    decidedAt: null,
    decision: null,
    action,
    packet: {
      currentSupplier: {
        name: mission.currentSupplier.name,
        unitPrice: mission.currentSupplier.unitPrice,
        currency: mission.currentSupplier.currency,
        leadTimeDays: mission.currentSupplier.leadTimeDays,
        requestedQuantity: mission.quantity,
        baselineCost: mission.currentSupplier.unitPrice * mission.quantity
      },
      proposed: {
        supplierName: quote.supplierName,
        unitPriceBase: quote.unitPrice?.base ?? null,
        unitPriceOriginal: quote.unitPrice?.original ?? null,
        originalCurrency: quote.originalCurrency,
        landedCostBase: quote.landedCost?.base ?? null,
        knownTotalBase: quote.knownTotal?.base ?? null,
        landedCostComplete: quote.landedCost?.complete === true,
        savingsBase: quote.economics?.estimatedLandedSavingsBase ?? quote.economics?.savingsBeforeShippingBase ?? null,
        savingsPercent: quote.economics?.estimatedLandedSavingsPercent ?? quote.economics?.savingsPercentBeforeShipping ?? null,
        leadTimeDays: quote.leadTimeDays,
        moq: quote.moq,
        shippingTerms: quote.shipping?.terms ?? null,
        shippingCostBase: quote.shipping?.baseCost ?? null,
        supplierRiskScore: quote.supplierRiskScore,
        score: quote.score?.total ?? null,
        rank: quote.rank,
        sampleAvailable: quote.sample?.available ?? null,
        samplePriceBase: samplePrice,
        sourceReference: quote.sourceReference
      },
      qualification: {
        confidence: supplier.confidence,
        specMatch: supplier.specMatch,
        decision: supplier.status,
        reason: supplier.reason,
        source: supplier.source
      },
      competingOffers: comparable,
      reasons: recommendation.reasons || [],
      risks: recommendation.risks || [],
      recommendationStatus: recommendation.status
    }
  };
}

export function applyApprovalDecision(approval, decision, now = new Date().toISOString()) {
  if (!approval || approval.status !== "pending") throw new Error("Approval is not pending");
  if (!["approve", "negotiate_more", "reject"].includes(decision)) throw new Error("Approval decision must be approve, negotiate_more, or reject");
  if (decision === "approve" && (approval.action?.kind !== "order_sample" || approval.action?.withinBudget !== true)) {
    throw new Error("Approval action is not executable");
  }
  approval.status = decision === "approve" ? "approved" : decision === "reject" ? "rejected" : "returned_to_negotiation";
  approval.decision = decision;
  approval.decidedAt = now;
  approval.updatedAt = now;
  return approval;
}
