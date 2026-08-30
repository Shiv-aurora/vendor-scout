import { buildApprovalPacket } from "./approval.mjs";
import { APPROVAL_READY_DEMO_SUPPLIERS } from "./demo-fixture.mjs";
import { qualifySupplier, riskScore, severityFor, transitionMission } from "./domain.mjs";
import { discoverFixtureSuppliers } from "./discovery.mjs";
import { CURRENT_CONTRACT_VERSION } from "./migrations.mjs";
import { latestOffer, prepareCounter, recordOfferTerms } from "./negotiation.mjs";
import { createRfqConversation, outboundRfqMessage, recordSupplierReply } from "./outreach.mjs";
import { analyzeQuotes } from "./quotes.mjs";

const ago = minutes => new Date(Date.now() - minutes * 60_000).toISOString();
const supportedSeedStages = new Set(["draft", "discovering", "qualifying", "contacting"]);
export const SEED_MODES = Object.freeze(["draft", "approval-ready"]);

function createFoundationSeed(missionStage) {
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

function addControlledActivity(state, missionId, stage, title, detail, at) {
  state.activity.push({
    id: `activity-controlled-${state.activity.length + 1}`,
    missionId,
    at,
    stage,
    title,
    detail
  });
}

export function createApprovalReadySeed() {
  const state = createFoundationSeed("contacting");
  const mission = state.missions[0];
  const startedAt = Date.now() - 60_000;
  let tick = 0;
  const nextTime = () => new Date(startedAt + tick++ * 1000).toISOString();
  const candidateById = new Map(state.supplierCandidates.map(candidate => [candidate.id, candidate]));

  for (const fixture of APPROVAL_READY_DEMO_SUPPLIERS) {
    const candidate = candidateById.get(fixture.id);
    if (!candidate || candidate.status !== "qualified") {
      throw new Error(`Approval-ready demo supplier ${fixture.id} must be a qualified controlled fixture`);
    }
    const conversation = createRfqConversation(mission, candidate, nextTime());
    const rfq = outboundRfqMessage(conversation);
    rfq.delivery = {
      ...rfq.delivery,
      status: "simulated",
      provider: "controlled-preview",
      externalMessageId: null,
      attemptedAt: nextTime(),
      deliveredAt: null,
      error: null
    };
    conversation.status = "previewed";
    conversation.updatedAt = rfq.delivery.attemptedAt;
    state.conversations.push(conversation);
  }

  addControlledActivity(
    state,
    mission.id,
    "contact",
    "2 controlled RFQ previews prepared",
    "The persisted RFQs are non-binding controlled demo evidence. No external supplier message was sent.",
    nextTime()
  );
  addControlledActivity(
    state,
    mission.id,
    "contact",
    "Controlled supplier outreach checkpoint",
    "0 externally accepted · 2 controlled previews. The demo contains no claim of live email delivery.",
    nextTime()
  );

  for (const fixture of APPROVAL_READY_DEMO_SUPPLIERS) {
    const conversation = state.conversations.find(item => item.supplierId === fixture.id);
    const candidate = candidateById.get(fixture.id);
    const receivedAt = nextTime();
    recordSupplierReply(conversation, {
      content: fixture.reply,
      sourceReference: fixture.sourceReference,
      providerMessageId: fixture.providerMessageId,
      receivedAt
    });
    if (mission.status === "contacting") mission.status = transitionMission(mission.status, "outreach_complete");
    addControlledActivity(
      state,
      mission.id,
      "conversation",
      `Controlled supplier reply recorded from ${candidate.name}`,
      `The explicitly controlled reply was persisted with provenance ${fixture.sourceReference}.`,
      receivedAt
    );

    const offer = recordOfferTerms(conversation, {
      sourceReference: fixture.sourceReference,
      ...fixture.offer
    }, { extractedAt: nextTime() });
    addControlledActivity(
      state,
      mission.id,
      "negotiation",
      `Controlled offer terms recorded from ${candidate.name}`,
      `Structured terms were derived from controlled reply ${offer.sourceReference}; no commercial terms were accepted.`,
      offer.extractedAt
    );
  }

  for (const fixture of APPROVAL_READY_DEMO_SUPPLIERS) {
    const conversation = state.conversations.find(item => item.supplierId === fixture.id);
    const candidate = candidateById.get(fixture.id);
    const competitorOffers = state.conversations
      .filter(item => item.supplierId !== fixture.id)
      .map(latestOffer)
      .filter(Boolean);
    const result = prepareCounter(mission, candidate, conversation, competitorOffers, { now: nextTime() });
    if (result.evaluation.status !== "ready_for_comparison") {
      throw new Error(`Approval-ready demo offer from ${candidate.name} is not comparison-ready`);
    }
    addControlledActivity(
      state,
      mission.id,
      "negotiation",
      `${candidate.name} controlled offer is ready for comparison`,
      "The persisted demo offer satisfies the mission screen. Vendor Scout has not accepted its terms.",
      result.evaluation.evaluatedAt
    );
  }

  const analysisAt = nextTime();
  const analysis = analyzeQuotes(mission, state.supplierCandidates, state.conversations, { fxRates: [], now: analysisAt });
  if (!analysis.recommendation) throw new Error("Approval-ready demo quote analysis did not produce a recommendation");

  const evaluationByConversation = new Map(analysis.offerEvaluations.map(item => [item.conversationId, item.evaluation]));
  for (const conversation of state.conversations) {
    const evaluation = evaluationByConversation.get(conversation.id);
    if (!evaluation) continue;
    conversation.negotiation.latestEvaluation = evaluation;
    conversation.updatedAt = evaluation.evaluatedAt;
    if (evaluation.status === "ready_for_comparison") conversation.status = "offer_ready";
  }
  state.quotes = analysis.quotes;
  state.recommendations = [analysis.recommendation];
  mission.status = transitionMission(mission.status, "negotiation_complete");

  const recommendedQuote = analysis.quotes.find(quote => quote.id === analysis.recommendation.quoteId);
  const recommendedSupplier = candidateById.get(analysis.recommendation.supplierId);
  const approvalAt = nextTime();
  const approval = buildApprovalPacket(
    mission,
    analysis.recommendation,
    recommendedQuote,
    recommendedSupplier,
    analysis.quotes,
    approvalAt,
    1
  );
  state.approvals = [approval];
  mission.status = transitionMission(mission.status, "analysis_complete");
  mission.updatedAt = approvalAt;
  mission.execution = {
    ...(mission.execution || {}),
    outreachMode: "controlled-preview",
    externalSupplierMessages: 0,
    negotiationReady: true,
    analysisReady: true,
    analysisAt: analysis.analyzedAt,
    analysisBaseCurrency: analysis.baseCurrency,
    analysisBlockers: analysis.blockers
  };
  state.meta = { ...state.meta, seedMode: "approval-ready", evidenceMode: "controlled-demo" };

  addControlledActivity(
    state,
    mission.id,
    "compare",
    `Quote analysis recommends ${analysis.recommendation.supplierName}`,
    `${analysis.quotes.length} controlled offers ranked · recommendation is ${analysis.recommendation.status} · human approval still required.`,
    analysisAt
  );
  addControlledActivity(
    state,
    mission.id,
    "approval",
    `Approval requested for ${approval.supplierName}`,
    `${approval.action.currency} ${approval.action.estimatedSpendBase.toFixed(2)} controlled sample · human decision required before any action.`,
    approvalAt
  );

  return state;
}

export function resolveSeedMode(value = process.env.VENDOR_SCOUT_SEED_MODE || "draft") {
  const seedMode = String(value).trim().toLowerCase();
  if (!SEED_MODES.includes(seedMode)) throw new Error(`Unsupported Vendor Scout seed mode: ${seedMode || "empty"}`);
  return seedMode;
}

export function createSeed({ missionStage, seedMode } = {}) {
  if (missionStage != null) return createFoundationSeed(missionStage);
  const selectedMode = resolveSeedMode(seedMode);
  return selectedMode === "approval-ready" ? createApprovalReadySeed() : createFoundationSeed("draft");
}
