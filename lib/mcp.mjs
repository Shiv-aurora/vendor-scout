const MCP_SERVER_INFO = Object.freeze({ name: "vendor-scout", version: "0.4.0" });
const DEFAULT_PROTOCOL_VERSION = "2025-06-18";

const candidateSchema = {
  type: "object",
  properties: {
    name: { type: "string", minLength: 1 },
    country: { type: "string", minLength: 1 },
    region: { type: "string", minLength: 1 },
    type: { type: "string", minLength: 1 },
    website: { type: ["string", "null"] },
    contactEmail: { type: ["string", "null"] },
    contactSourceReference: { type: ["string", "null"] },
    confidence: { type: "number", minimum: 0, maximum: 1 },
    specMatch: { type: "number", minimum: 0, maximum: 1 },
    preliminaryUnitPrice: { type: ["number", "null"], minimum: 0 },
    currency: { type: "string", minLength: 3, maxLength: 3 },
    moq: { type: ["number", "null"], minimum: 0 },
    leadTimeDays: { type: ["number", "null"], minimum: 0 },
    availability: { type: ["string", "null"] },
    sourceReference: { type: "string", minLength: 1 }
  },
  required: ["name", "country", "region", "type", "confidence", "specMatch", "sourceReference"],
  additionalProperties: false
};

export const PROCUREMENT_MCP_TOOLS = Object.freeze([
  {
    name: "vendor_scout_get_mission",
    title: "Get sourcing mission",
    description: "Read the current Vendor Scout sourcing mission, supplier evidence, conversations, quotes, approvals, and activity without modifying state.",
    inputSchema: {
      type: "object",
      properties: { missionId: { type: "string", minLength: 1 } },
      required: ["missionId"],
      additionalProperties: false
    },
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false }
  },
  {
    name: "vendor_scout_discover_suppliers",
    title: "Discover supplier candidates",
    description: "Run Vendor Scout supplier discovery for a sourcing mission. Uses the configured discovery provider and preserves source provenance; controlled fixture fallback is used only when the Vendor Scout runtime allows it.",
    inputSchema: {
      type: "object",
      properties: { missionId: { type: "string", minLength: 1 } },
      required: ["missionId"],
      additionalProperties: false
    },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: true }
  },
  {
    name: "vendor_scout_record_supplier_candidates",
    title: "Record researched supplier candidates",
    description: "Persist supplier candidates already discovered through TrueForge research or other live tools. Every candidate must include a real sourceReference. A contact email may be included only with contact provenance. Unknown price, MOQ, or lead time may remain null instead of being invented.",
    inputSchema: {
      type: "object",
      properties: {
        missionId: { type: "string", minLength: 1 },
        candidates: { type: "array", minItems: 1, maxItems: 50, items: candidateSchema }
      },
      required: ["missionId", "candidates"],
      additionalProperties: false
    },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false }
  },
  {
    name: "vendor_scout_qualify_suppliers",
    title: "Qualify supplier candidates",
    description: "Evaluate discovered supplier candidates against the mission region, confidence, technical-fit, lead-time, MOQ, and commercial constraints and persist explainable Qualified, Needs review, or Rejected decisions.",
    inputSchema: {
      type: "object",
      properties: { missionId: { type: "string", minLength: 1 } },
      required: ["missionId"],
      additionalProperties: false
    },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false }
  },
  {
    name: "vendor_scout_prepare_rfqs",
    title: "Prepare supplier RFQs",
    description: "Create persistent non-binding RFQ drafts for qualified suppliers. Drafts request pricing tiers, MOQ, inventory, lead time, shipping, sample terms, certifications, and technical confirmation. This does not contact suppliers.",
    inputSchema: {
      type: "object",
      properties: { missionId: { type: "string", minLength: 1 } },
      required: ["missionId"],
      additionalProperties: false
    },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false }
  },
  {
    name: "vendor_scout_send_rfqs",
    title: "Send supplier RFQs",
    description: "Send prepared non-binding RFQs through Vendor Scout's configured outreach provider. Delivery is idempotent. Controlled previews are visibly marked and never advance the mission to negotiation; real external acceptance does.",
    inputSchema: {
      type: "object",
      properties: { missionId: { type: "string", minLength: 1 } },
      required: ["missionId"],
      additionalProperties: false
    },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: true }
  },
  {
    name: "vendor_scout_record_supplier_reply",
    title: "Record supplier reply",
    description: "Persist a supplier reply in its sourcing conversation with source provenance. Use this after a real email/MCP transport receives a supplier response so later negotiation and quote extraction operate on durable evidence.",
    inputSchema: {
      type: "object",
      properties: {
        missionId: { type: "string", minLength: 1 },
        supplierId: { type: "string", minLength: 1 },
        content: { type: "string", minLength: 1, maxLength: 100000 },
        sourceReference: { type: "string", minLength: 1 },
        providerMessageId: { type: ["string", "null"] },
        receivedAt: { type: ["string", "null"] }
      },
      required: ["missionId", "supplierId", "content", "sourceReference"],
      additionalProperties: false
    },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false }
  }
]);

function rpcResult(id, result) {
  return { jsonrpc: "2.0", id, result };
}

function rpcError(id, code, message, data) {
  return { jsonrpc: "2.0", id: id ?? null, error: { code, message, ...(data === undefined ? {} : { data }) } };
}

function toolResult(value, prefix) {
  const structuredContent = value && typeof value === "object" ? value : { value };
  return {
    content: [{ type: "text", text: `${prefix}\n${JSON.stringify(structuredContent, null, 2)}` }],
    structuredContent,
    isError: false
  };
}

function toolError(message) {
  return { content: [{ type: "text", text: message }], isError: true };
}

function argumentsFor(message) {
  const value = message?.params?.arguments;
  return value && typeof value === "object" ? value : {};
}

function missionIdFrom(message) {
  const missionId = argumentsFor(message).missionId;
  if (typeof missionId !== "string" || !missionId.trim()) throw new Error("missionId is required");
  return missionId.trim();
}

export async function handleMcpMessage(message, { getMission, discoverSuppliers, recordSuppliers, qualifySuppliers, prepareOutreach, sendOutreach, recordReply }) {
  if (!message || message.jsonrpc !== "2.0" || typeof message.method !== "string") return rpcError(message?.id, -32600, "Invalid Request");
  if (message.method === "notifications/initialized") return null;

  if (message.method === "initialize") {
    const requestedVersion = message.params?.protocolVersion;
    return rpcResult(message.id, {
      protocolVersion: typeof requestedVersion === "string" && requestedVersion ? requestedVersion : DEFAULT_PROTOCOL_VERSION,
      capabilities: { tools: { listChanged: false } },
      serverInfo: MCP_SERVER_INFO,
      instructions: "Vendor Scout procurement tools operate on persisted sourcing missions. Research and qualification may proceed autonomously. Qualified suppliers may receive non-binding RFQs through the configured outreach transport. Supplier replies must be recorded with provenance. Spending money, accepting commercial terms, ordering samples, or another consequential commitment remains human-gated and is not exposed by these tools."
    });
  }

  if (message.method === "ping") return rpcResult(message.id, {});
  if (message.method === "tools/list") return rpcResult(message.id, { tools: PROCUREMENT_MCP_TOOLS });

  if (message.method === "tools/call") {
    const name = message.params?.name;
    try {
      const args = argumentsFor(message);
      const missionId = missionIdFrom(message);
      if (name === "vendor_scout_get_mission") {
        const snapshot = await getMission(missionId);
        if (!snapshot) return rpcResult(message.id, toolError("Sourcing mission not found"));
        return rpcResult(message.id, toolResult(snapshot, "Current sourcing mission:"));
      }
      if (name === "vendor_scout_discover_suppliers") return rpcResult(message.id, toolResult(await discoverSuppliers(missionId), "Supplier discovery result:"));
      if (name === "vendor_scout_record_supplier_candidates") {
        if (!Array.isArray(args.candidates)) throw new Error("candidates array is required");
        return rpcResult(message.id, toolResult(await recordSuppliers(missionId, args.candidates), "Recorded supplier research:"));
      }
      if (name === "vendor_scout_qualify_suppliers") return rpcResult(message.id, toolResult(await qualifySuppliers(missionId), "Supplier qualification result:"));
      if (name === "vendor_scout_prepare_rfqs") return rpcResult(message.id, toolResult(await prepareOutreach(missionId), "Prepared supplier RFQs:"));
      if (name === "vendor_scout_send_rfqs") return rpcResult(message.id, toolResult(await sendOutreach(missionId), "Supplier outreach result:"));
      if (name === "vendor_scout_record_supplier_reply") {
        if (typeof args.supplierId !== "string" || !args.supplierId.trim()) throw new Error("supplierId is required");
        return rpcResult(message.id, toolResult(await recordReply(missionId, args.supplierId.trim(), {
          content: args.content,
          sourceReference: args.sourceReference,
          providerMessageId: args.providerMessageId || null,
          receivedAt: args.receivedAt || new Date().toISOString()
        }), "Recorded supplier reply:"));
      }
      return rpcError(message.id, -32602, `Unknown tool: ${String(name)}`);
    } catch (error) {
      return rpcResult(message.id, toolError(error.message || "Tool execution failed"));
    }
  }

  return rpcError(message.id, -32601, "Method not found");
}
