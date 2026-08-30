const MCP_SERVER_INFO = Object.freeze({ name: "vendor-scout", version: "0.8.0" });
const DEFAULT_PROTOCOL_VERSION = "2025-06-18";

const candidateSchema = {
  type: "object",
  properties: {
    name: { type: "string", minLength: 1 }, country: { type: "string", minLength: 1 }, region: { type: "string", minLength: 1 }, type: { type: "string", minLength: 1 },
    website: { type: ["string", "null"] }, contactEmail: { type: ["string", "null"] }, contactSourceReference: { type: ["string", "null"] },
    confidence: { type: "number", minimum: 0, maximum: 1 }, specMatch: { type: "number", minimum: 0, maximum: 1 },
    preliminaryUnitPrice: { type: ["number", "null"], minimum: 0 }, currency: { type: "string", minLength: 3, maxLength: 3 },
    moq: { type: ["number", "null"], minimum: 0 }, leadTimeDays: { type: ["number", "null"], minimum: 0 }, availability: { type: ["string", "null"] },
    sourceReference: { type: "string", minLength: 1 }
  },
  required: ["name", "country", "region", "type", "confidence", "specMatch", "sourceReference"],
  additionalProperties: false
};

const offerProperties = {
  sourceMessageId: { type: ["string", "null"] }, sourceReference: { type: "string", minLength: 1 }, unitPrice: { type: ["number", "null"], minimum: 0 },
  currency: { type: ["string", "null"], minLength: 3, maxLength: 3 },
  quantityTiers: { type: "array", maxItems: 20, items: { type: "object", properties: { minQuantity: { type: "integer", minimum: 1 }, unitPrice: { type: "number", minimum: 0 } }, required: ["minQuantity", "unitPrice"], additionalProperties: false } },
  moq: { type: ["integer", "null"], minimum: 1 }, availability: { type: ["string", "null"] }, leadTimeDays: { type: ["number", "null"], minimum: 0 },
  shippingTerms: { type: ["string", "null"] }, shippingCost: { type: ["number", "null"], minimum: 0 }, sampleAvailable: { type: ["boolean", "null"] },
  samplePrice: { type: ["number", "null"], minimum: 0 }, certifications: { type: "array", maxItems: 30, items: { type: "string", minLength: 1 } },
  technicalConfirmed: { type: ["boolean", "null"] }, notes: { type: ["string", "null"] }
};

const fxRateSchema = {
  type: "object",
  properties: {
    currency: { type: "string", minLength: 3, maxLength: 3 },
    rateToBase: { type: "number", exclusiveMinimum: 0 },
    sourceReference: { type: "string", minLength: 1 },
    asOf: { type: ["string", "null"] }
  },
  required: ["currency", "rateToBase", "sourceReference"],
  additionalProperties: false
};

const missionOnly = { type: "object", properties: { missionId: { type: "string", minLength: 1 } }, required: ["missionId"], additionalProperties: false };
const supplierOnly = { type: "object", properties: { missionId: { type: "string", minLength: 1 }, supplierId: { type: "string", minLength: 1 } }, required: ["missionId", "supplierId"], additionalProperties: false };
const annotations = (readOnly, openWorld, destructive = false) => ({ readOnlyHint: readOnly, destructiveHint: destructive, idempotentHint: true, openWorldHint: openWorld });

export const PROCUREMENT_MCP_TOOLS = Object.freeze([
  { name: "vendor_scout_get_mission", title: "Get sourcing mission", description: "Read the current persisted sourcing mission, evidence, conversations, offers, quotes, recommendation, approvals, and activity.", inputSchema: missionOnly, annotations: annotations(true, false) },
  { name: "vendor_scout_discover_suppliers", title: "Discover supplier candidates", description: "Run Vendor Scout supplier discovery using the configured provider or explicitly permitted controlled fallback.", inputSchema: missionOnly, annotations: annotations(false, true) },
  { name: "vendor_scout_record_supplier_candidates", title: "Record researched supplier candidates", description: "Persist provenance-backed supplier research. Unknown commercial fields may remain null.", inputSchema: { type: "object", properties: { missionId: { type: "string", minLength: 1 }, candidates: { type: "array", minItems: 1, maxItems: 50, items: candidateSchema } }, required: ["missionId", "candidates"], additionalProperties: false }, annotations: annotations(false, false) },
  { name: "vendor_scout_qualify_suppliers", title: "Qualify supplier candidates", description: "Persist explainable qualification decisions from mission constraints and supplier evidence.", inputSchema: missionOnly, annotations: annotations(false, false) },
  { name: "vendor_scout_prepare_rfqs", title: "Prepare supplier RFQs", description: "Create durable non-binding RFQ drafts for qualified suppliers without contacting them.", inputSchema: missionOnly, annotations: annotations(false, false) },
  { name: "vendor_scout_send_rfqs", title: "Send supplier RFQs", description: "Deliver unsent non-binding RFQs through the idempotent outreach transport or controlled preview when allowed.", inputSchema: missionOnly, annotations: annotations(false, true) },
  { name: "vendor_scout_record_supplier_reply", title: "Record supplier reply", description: "Persist a supplier reply with source provenance.", inputSchema: { type: "object", properties: { missionId: { type: "string", minLength: 1 }, supplierId: { type: "string", minLength: 1 }, content: { type: "string", minLength: 1, maxLength: 100000 }, sourceReference: { type: "string", minLength: 1 }, providerMessageId: { type: ["string", "null"] }, receivedAt: { type: ["string", "null"] } }, required: ["missionId", "supplierId", "content", "sourceReference"], additionalProperties: false }, annotations: annotations(false, false) },
  { name: "vendor_scout_record_offer_terms", title: "Record structured supplier offer terms", description: "Persist only explicit offer terms anchored to an already-recorded supplier reply. Unknown terms remain null.", inputSchema: { type: "object", properties: { missionId: { type: "string", minLength: 1 }, supplierId: { type: "string", minLength: 1 }, ...offerProperties }, required: ["missionId", "supplierId", "sourceReference"], additionalProperties: false }, annotations: annotations(false, false) },
  { name: "vendor_scout_prepare_counter", title: "Prepare negotiation counter", description: "Evaluate the latest persisted offer and create a non-binding counter only for explicit gaps or missing evidence. Critical technical conflicts stop for human judgment.", inputSchema: supplierOnly, annotations: annotations(false, false) },
  { name: "vendor_scout_send_counter", title: "Send negotiation counter", description: "Deliver the prepared non-binding counter through the same idempotent outreach transport. It cannot accept terms or create a purchase commitment.", inputSchema: supplierOnly, annotations: annotations(false, true) },
  { name: "vendor_scout_analyze_quotes", title: "Normalize and compare supplier quotes", description: "Deterministically normalize offers into comparable quote records, apply explicitly supplied provenance-backed FX rates, calculate known/landed costs and savings, score/rank eligible offers, and persist a human-approval-required recommendation. Missing shipping or FX stays visible; this tool never accepts terms or places an order.", inputSchema: { type: "object", properties: { missionId: { type: "string", minLength: 1 }, fxRates: { type: "array", maxItems: 30, items: fxRateSchema } }, required: ["missionId"], additionalProperties: false }, annotations: annotations(false, false) },
  { name: "vendor_scout_execute_sample_order", title: "Execute approved sample order", description: "Execute the already human-approved sample action. The mission must already contain a matching approved decision. This tool can create external spend when a live order provider is configured and MUST be human-approved in TrueForge before execution.", inputSchema: missionOnly, annotations: annotations(false, true, true) }
]);

function rpcResult(id, result) { return { jsonrpc: "2.0", id, result }; }
function rpcError(id, code, message, data) { return { jsonrpc: "2.0", id: id ?? null, error: { code, message, ...(data === undefined ? {} : { data }) } }; }
function toolResult(value, prefix) { const structuredContent = value && typeof value === "object" ? value : { value }; return { content: [{ type: "text", text: `${prefix}\n${JSON.stringify(structuredContent, null, 2)}` }], structuredContent, isError: false }; }
function toolError(message) { return { content: [{ type: "text", text: message }], isError: true }; }
function argumentsFor(message) { const value = message?.params?.arguments; return value && typeof value === "object" ? value : {}; }
function missionIdFrom(message) { const missionId = argumentsFor(message).missionId; if (typeof missionId !== "string" || !missionId.trim()) throw new Error("missionId is required"); return missionId.trim(); }
function supplierIdFrom(args) { if (typeof args.supplierId !== "string" || !args.supplierId.trim()) throw new Error("supplierId is required"); return args.supplierId.trim(); }

export async function handleMcpMessage(message, context) {
  if (!message || message.jsonrpc !== "2.0" || typeof message.method !== "string") return rpcError(message?.id, -32600, "Invalid Request");
  if (message.method === "notifications/initialized") return null;
  if (message.method === "initialize") {
    const requestedVersion = message.params?.protocolVersion;
    return rpcResult(message.id, {
      protocolVersion: typeof requestedVersion === "string" && requestedVersion ? requestedVersion : DEFAULT_PROTOCOL_VERSION,
      capabilities: { tools: { listChanged: false } }, serverInfo: MCP_SERVER_INFO,
      instructions: "Vendor Scout tools operate on persisted sourcing missions. Research, non-binding outreach, negotiation, and deterministic quote analysis may proceed autonomously. Supplier facts, offer terms, FX assumptions, and recommendation math must retain provenance. Quote analysis may recommend and create a pending approval packet. The sample-order execution tool is destructive and must be configured for TrueForge human approval; Vendor Scout additionally requires a persisted approved decision before it can execute."
    });
  }
  if (message.method === "ping") return rpcResult(message.id, {});
  if (message.method === "tools/list") return rpcResult(message.id, { tools: PROCUREMENT_MCP_TOOLS });
  if (message.method !== "tools/call") return rpcError(message.id, -32601, "Method not found");

  const name = message.params?.name;
  try {
    const args = argumentsFor(message);
    const missionId = missionIdFrom(message);
    if (name === "vendor_scout_get_mission") {
      const snapshot = await context.getMission(missionId);
      if (!snapshot) return rpcResult(message.id, toolError("Sourcing mission not found"));
      return rpcResult(message.id, toolResult(snapshot, "Current sourcing mission:"));
    }
    if (name === "vendor_scout_discover_suppliers") return rpcResult(message.id, toolResult(await context.discoverSuppliers(missionId), "Supplier discovery result:"));
    if (name === "vendor_scout_record_supplier_candidates") {
      if (!Array.isArray(args.candidates)) throw new Error("candidates array is required");
      return rpcResult(message.id, toolResult(await context.recordSuppliers(missionId, args.candidates), "Recorded supplier research:"));
    }
    if (name === "vendor_scout_qualify_suppliers") return rpcResult(message.id, toolResult(await context.qualifySuppliers(missionId), "Supplier qualification result:"));
    if (name === "vendor_scout_prepare_rfqs") return rpcResult(message.id, toolResult(await context.prepareOutreach(missionId), "Prepared supplier RFQs:"));
    if (name === "vendor_scout_send_rfqs") return rpcResult(message.id, toolResult(await context.sendOutreach(missionId), "Supplier outreach result:"));
    if (name === "vendor_scout_record_supplier_reply") return rpcResult(message.id, toolResult(await context.recordReply(missionId, supplierIdFrom(args), { content: args.content, sourceReference: args.sourceReference, providerMessageId: args.providerMessageId || null, receivedAt: args.receivedAt || new Date().toISOString() }), "Recorded supplier reply:"));
    if (name === "vendor_scout_record_offer_terms") {
      const offer = {}; for (const key of Object.keys(offerProperties)) if (Object.hasOwn(args, key)) offer[key] = args[key];
      return rpcResult(message.id, toolResult(await context.recordOffer(missionId, supplierIdFrom(args), offer), "Recorded supplier offer terms:"));
    }
    if (name === "vendor_scout_prepare_counter") return rpcResult(message.id, toolResult(await context.prepareCounter(missionId, supplierIdFrom(args)), "Negotiation counter result:"));
    if (name === "vendor_scout_send_counter") return rpcResult(message.id, toolResult(await context.sendCounter(missionId, supplierIdFrom(args)), "Negotiation delivery result:"));
    if (name === "vendor_scout_analyze_quotes") return rpcResult(message.id, toolResult(await context.analyzeQuotes(missionId, Array.isArray(args.fxRates) ? args.fxRates : []), "Quote comparison result:"));
    if (name === "vendor_scout_execute_sample_order") return rpcResult(message.id, toolResult(await context.executeSampleOrder(missionId), "Approved sample-order result:"));
    return rpcError(message.id, -32602, `Unknown tool: ${String(name)}`);
  } catch (error) {
    return rpcResult(message.id, toolError(error.message || "Tool execution failed"));
  }
}
