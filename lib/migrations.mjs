export const CURRENT_CONTRACT_VERSION = "2.1.0";

export function migrateState(state) {
  if (!state || typeof state !== "object") throw new Error("Persisted state is not a valid object");
  const version = state.meta?.contractVersion;
  if (version === CURRENT_CONTRACT_VERSION) return { state, migrated: false };

  if (version === "2.0.0") {
    return {
      migrated: true,
      state: {
        ...state,
        meta: {
          ...state.meta,
          contractVersion: CURRENT_CONTRACT_VERSION,
          migratedAt: new Date().toISOString(),
          migratedFrom: "2.0.0"
        },
        supplierCandidates: state.supplierCandidates || [],
        conversations: state.conversations || [],
        quotes: state.quotes || [],
        recommendations: state.recommendations || [],
        approvals: state.approvals || [],
        sampleOrders: state.sampleOrders || [],
        activity: state.activity || []
      }
    };
  }

  throw new Error(
    `Unsupported persisted state contract ${version || "unknown"}. Refusing to overwrite stored data; use an explicit migration or development reset.`
  );
}
