export const APPROVAL_READY_DEMO_SUPPLIERS = Object.freeze([
  Object.freeze({
    id: "supplier-heliomotion",
    sourceReference: "controlled/demo-reply/heliomotion-final",
    providerMessageId: "controlled-heliomotion-final",
    reply: "Controlled demo supplier response: USD 382 per unit for 500 units, MOQ 100, 18-day production lead, DDP Philadelphia, shipping USD 900 total, one evaluation sample available for USD 180, all listed technical requirements confirmed.",
    offer: Object.freeze({
      unitPrice: 382,
      currency: "USD",
      moq: 100,
      leadTimeDays: 18,
      shippingTerms: "DDP Philadelphia",
      shippingCost: 900,
      sampleAvailable: true,
      samplePrice: 180,
      technicalConfirmed: true
    })
  }),
  Object.freeze({
    id: "supplier-scanworks",
    sourceReference: "controlled/demo-reply/scanworks-final",
    providerMessageId: "controlled-scanworks-final",
    reply: "Controlled demo supplier response: USD 382 per unit for 500 units, MOQ 250, 14-day production lead, DDP Philadelphia, shipping USD 1300 total, one evaluation sample available for USD 220, all listed technical requirements confirmed.",
    offer: Object.freeze({
      unitPrice: 382,
      currency: "USD",
      moq: 250,
      leadTimeDays: 14,
      shippingTerms: "DDP Philadelphia",
      shippingCost: 1300,
      sampleAvailable: true,
      samplePrice: 220,
      technicalConfirmed: true
    })
  })
]);

export const APPROVAL_READY_DEMO_EXPECTATIONS = Object.freeze({
  missionId: "mission-lidar-500",
  recommendationSupplierId: "supplier-scanworks",
  recommendationSupplierName: "ScanWorks Taiwan",
  recommendedUnitPrice: 382,
  recommendedLeadTimeDays: 14,
  recommendedLandedCost: 192300,
  projectedSavings: 22200,
  samplePrice: 220
});
