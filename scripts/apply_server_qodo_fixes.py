from pathlib import Path

path = Path("server.mjs")
text = path.read_text()

replacements = []

replacements.append((
'''async function recordMissionSupplierReply(missionId, supplierId, payload) {
  const mission = state.missions.find(item => item.id === missionId);
  if (!mission) throw httpError(404, "Sourcing mission not found");
  const conversation = state.conversations.find(item => item.missionId === missionId && item.supplierId === supplierId);
  if (!conversation) throw httpError(404, "Supplier conversation not found");
  recordSupplierReply(conversation, payload);
  if (mission.status === "contacting" && conversationHasExternalContact(conversation)) {
    mission.status = transitionMission(mission.status, "outreach_complete");
    mission.updatedAt = new Date().toISOString();
  }
  addActivity(missionId, "conversation", `Supplier reply recorded from ${conversation.supplierName}`, "The reply was persisted with source provenance for later term extraction and negotiation.");
  await persist();
  return missionSnapshot(missionId);
}''',
'''async function recordMissionSupplierReply(missionId, supplierId, payload) {
  const mission = state.missions.find(item => item.id === missionId);
  if (!mission) throw httpError(404, "Sourcing mission not found");
  const conversation = state.conversations.find(item => item.missionId === missionId && item.supplierId === supplierId);
  if (!conversation) throw httpError(404, "Supplier conversation not found");
  const messageCountBefore = conversation.messages.length;
  recordSupplierReply(conversation, payload);
  const inserted = conversation.messages.length > messageCountBefore;
  if (!inserted) {
    await persist();
    return missionSnapshot(missionId);
  }
  if (mission.status === "contacting" && conversationHasExternalContact(conversation)) {
    mission.status = transitionMission(mission.status, "outreach_complete");
    mission.updatedAt = new Date().toISOString();
  }
  addActivity(missionId, "conversation", `Supplier reply recorded from ${conversation.supplierName}`, "The reply was persisted with source provenance for later term extraction and negotiation.");
  await persist();
  return missionSnapshot(missionId);
}'''
))

replacements.append((
'''  const prepared = prepareNegotiationCounter(mission, candidate, conversation, competitorOffersFor(missionId, supplierId));
  const message = prepared.message;
  if (!message) {
    await persist();
    return missionSnapshot(missionId);
  }''',
'''  const wasNegotiationReady = Boolean(mission.execution?.negotiationReady);
  const prepared = prepareNegotiationCounter(mission, candidate, conversation, competitorOffersFor(missionId, supplierId));
  const message = prepared.message;
  if (!message) {
    mission.execution = {
      ...(mission.execution || {}),
      negotiationReady: state.conversations.some(item => item.missionId === missionId && item.status === "offer_ready") || prepared.evaluation.status === "ready_for_comparison",
      lastNegotiationAt: new Date().toISOString()
    };
    if (prepared.evaluation.status === "ready_for_comparison" && !wasNegotiationReady) {
      addActivity(missionId, "negotiation", `${conversation.supplierName} offer is ready for comparison`, "No counter was generated because the persisted offer has no unresolved negotiation gap. Vendor Scout has not accepted the terms.");
    } else if (prepared.evaluation.status === "reject_recommended") {
      addActivity(missionId, "negotiation", `${conversation.supplierName} requires human judgment`, "The supplier explicitly failed a critical technical confirmation, so autonomous countering stopped.");
    }
    await persist();
    return missionSnapshot(missionId);
  }'''
))

replacements.append((
'''async function mcpRecordSuppliers(id, candidates) {
  return serializeMutation(async () => {
    let mission = state.missions.find(item => item.id === id);
    if (!mission) throw httpError(404, "Sourcing mission not found");
    const missionErrors = validateMission(mission);
    if (missionErrors.length) throw httpError(422, `Mission is invalid: ${missionErrors.join("; ")}`);
    if (mission.status === "draft") {
      await executeMissionAction(id, "start");
      mission = state.missions.find(item => item.id === id);
    }
    if (!new Set(["discovering", "qualifying"]).has(mission.status)) {
      throw httpError(409, `Live supplier research can only be recorded during discovery or qualification; mission status is ${mission.status}`);
    }

    const normalized = normalizeDiscoveredCandidates(mission, candidates, "trueforge-research");''',
'''async function mcpRecordSuppliers(id, candidates) {
  return serializeMutation(async () => {
    let mission = state.missions.find(item => item.id === id);
    if (!mission) throw httpError(404, "Sourcing mission not found");
    const missionErrors = validateMission(mission);
    if (missionErrors.length) throw httpError(422, `Mission is invalid: ${missionErrors.join("; ")}`);

    // Validate and normalize the complete researched batch before any mission transition is persisted.
    // This keeps a rejected MCP ingestion call atomic: malformed evidence cannot advance draft -> discovering.
    const normalized = normalizeDiscoveredCandidates(mission, candidates, "trueforge-research");

    if (mission.status === "draft") {
      await executeMissionAction(id, "start");
      mission = state.missions.find(item => item.id === id);
    }
    if (!new Set(["discovering", "qualifying"]).has(mission.status)) {
      throw httpError(409, `Live supplier research can only be recorded during discovery or qualification; mission status is ${mission.status}`);
    }'''
))

for old, new in replacements:
    count = text.count(old)
    if count != 1:
        raise SystemExit(f"expected exactly one server replacement match, found {count}")
    text = text.replace(old, new, 1)

path.write_text(text)
print(f"applied {len(replacements)} server remediations")
