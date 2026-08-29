export const CURRENT_CONTRACT_VERSION = "2.2.0";

function withCollections(state) {
  return {
    ...state,
    supplierCandidates: state.supplierCandidates || [],
    conversations: state.conversations || [],
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
  if (version === CURRENT_CONTRACT_VERSION) return { state, migrated: false };

  if (version === "2.0.0" || version === "2.1.0") {
    return {
      migrated: true,
      state: migrateToCurrent(state, version)
    };
  }

  throw new Error(
    `Unsupported persisted state contract ${version || "unknown"}. Refusing to overwrite stored data; use an explicit migration or development reset.`
  );
}
