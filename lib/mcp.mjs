const MCP_SERVER_INFO = Object.freeze({ name: "vendor-scout", version: "0.2.0" });
const DEFAULT_PROTOCOL_VERSION = "2025-06-18";

export const PROCUREMENT_MCP_TOOLS = Object.freeze([
  {
    name: "vendor_scout_get_mission",
    title: "Get sourcing mission",
    description: "Read the current Vendor Scout sourcing mission, supplier evidence, quotes, approvals, and activity without modifying state.",
    inputSchema: {
      type: "object",
      properties: { missionId: { type: "string", minLength: 1 } },
      required: ["missionId"],
      additionalProperties: false
    },
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false
    }
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
    annotations: {
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: true
    }
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
    annotations: {
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false
    }
  }
]);

function rpcResult(id, result) {
  return { jsonrpc: "2.0", id, result };
}

function rpcError(id, code, message, data) {
  return {
    jsonrpc: "2.0",
    id: id ?? null,
    error: { code, message, ...(data === undefined ? {} : { data }) }
  };
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
  return {
    content: [{ type: "text", text: message }],
    isError: true
  };
}

function missionIdFrom(message) {
  const missionId = message?.params?.arguments?.missionId;
  if (typeof missionId !== "string" || !missionId.trim()) throw new Error("missionId is required");
  return missionId;
}

export async function handleMcpMessage(message, { getMission, discoverSuppliers, qualifySuppliers }) {
  if (!message || message.jsonrpc !== "2.0" || typeof message.method !== "string") {
    return rpcError(message?.id, -32600, "Invalid Request");
  }

  if (message.method === "notifications/initialized") return null;

  if (message.method === "initialize") {
    const requestedVersion = message.params?.protocolVersion;
    return rpcResult(message.id, {
      protocolVersion: typeof requestedVersion === "string" && requestedVersion ? requestedVersion : DEFAULT_PROTOCOL_VERSION,
      capabilities: { tools: { listChanged: false } },
      serverInfo: MCP_SERVER_INFO,
      instructions: "Vendor Scout procurement tools operate on persisted sourcing missions. Discovery and qualification may proceed autonomously; consequential procurement commitments remain human-gated by the application."
    });
  }

  if (message.method === "ping") return rpcResult(message.id, {});

  if (message.method === "tools/list") {
    return rpcResult(message.id, { tools: PROCUREMENT_MCP_TOOLS });
  }

  if (message.method === "tools/call") {
    const name = message.params?.name;
    try {
      const missionId = missionIdFrom(message);
      if (name === "vendor_scout_get_mission") {
        const snapshot = await getMission(missionId);
        if (!snapshot) return rpcResult(message.id, toolError("Sourcing mission not found"));
        return rpcResult(message.id, toolResult(snapshot, "Current sourcing mission:"));
      }
      if (name === "vendor_scout_discover_suppliers") {
        const result = await discoverSuppliers(missionId);
        return rpcResult(message.id, toolResult(result, "Supplier discovery result:"));
      }
      if (name === "vendor_scout_qualify_suppliers") {
        const result = await qualifySuppliers(missionId);
        return rpcResult(message.id, toolResult(result, "Supplier qualification result:"));
      }
      return rpcError(message.id, -32602, `Unknown tool: ${String(name)}`);
    } catch (error) {
      return rpcResult(message.id, toolError(error.message || "Tool execution failed"));
    }
  }

  return rpcError(message.id, -32601, "Method not found");
}
