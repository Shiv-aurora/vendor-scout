export const CURRENT_CONTRACT_VERSION = "2.3.0";

function withCollections(state) {
  return {
    ...state,
    supplierCandidates: state.supplierCandidates || [],
    conversations: (state.conversations || []).map(conversation => ({
      ...conversation,
      messages: conversation.messages || [],
      ...(conversation.negotiation ? {
        negotiation: {
          offers: conversation.negotiation.offers || [],
          counterRounds: conversation.negotiation.counterRounds || 0,
          latestEvaluation: conversation.negotiation.latestEvaluation || null
        }
      } : {})
    })),
    quotes: state.quotes || [],
    recommendations: state.recommendations || [],
    approvals: state.approvals || [],
    sampleOrders: state.sampleOrders || [],
    activity: state.activity || []
  };
}

function migrateToCurrent(state, migratedFrom) {
  const now = new Date().toISOString();
  const normalized = withCollections(state);
  return {
    ...normalized,
    meta: {
      ...normalized.meta,
      contractVersion: CURRENT_CONTRACT_VERSION,
      migratedAt: now,
      migratedFrom
    }
  };
}

export function migrateState(state) {
  if (!state || typeof state !== "object") throw new Error("Persisted state is not a valid object");
  const version = state.meta?.contractVersion;
  if (version === CURRENT_CONTRACT_VERSION) return { state: withCollections(state), migrated: false };

  if (["2.0.0", "2.1.0", "2.2.0"].includes(version)) {
    return {
      migrated: true,
      state: migrateToCurrent(state, version)
    };
  }

  throw new Error(
    `Unsupported persisted state contract ${version || "unknown"}. Refusing to overwrite stored data; use an explicit migration or development reset.`
  );
}
