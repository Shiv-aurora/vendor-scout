from pathlib import Path

trueforge = Path('lib/trueforge.mjs')
text = trueforge.read_text()
old = '''  async createTurn(sessionId, content) {
    const payload = await this.request(`api/v1/sessions/${encodeURIComponent(sessionId)}/turns`, {
      method: "POST",
      body: {
        stream: false,
        input: [{ type: "user.message", content }]
      }
    });
    if (!payload?.data?.id) throw new Error("TrueForge turn response is missing data.id");
    return payload.data;
  }
'''
new = '''  async createTurnInput(sessionId, input) {
    if (!Array.isArray(input) || input.length === 0) throw new Error("TrueForge turn input must be a non-empty array");
    const payload = await this.request(`api/v1/sessions/${encodeURIComponent(sessionId)}/turns`, {
      method: "POST",
      body: { stream: false, input }
    });
    if (!payload?.data?.id) throw new Error("TrueForge turn response is missing data.id");
    return payload.data;
  }

  async createTurn(sessionId, content) {
    return this.createTurnInput(sessionId, [{ type: "user.message", content }]);
  }

  async submitToolApprovals(sessionId, approvals) {
    if (!Array.isArray(approvals) || approvals.length === 0) throw new Error("At least one TrueForge tool approval is required");
    const input = approvals.map((item, index) => {
      const threadId = typeof item?.threadId === "string" ? item.threadId.trim() : "";
      const toolCallId = typeof item?.toolCallId === "string" ? item.toolCallId.trim() : "";
      const status = item?.status;
      if (!threadId) throw new Error(`approvals[${index}].threadId is required`);
      if (!toolCallId) throw new Error(`approvals[${index}].toolCallId is required`);
      if (!["allow", "deny"].includes(status)) throw new Error(`approvals[${index}].status must be allow or deny`);
      const reason = typeof item?.reason === "string" && item.reason.trim() ? item.reason.trim().slice(0, 2000) : null;
      return {
        type: "user.tool_approval",
        thread_id: threadId,
        tool_call_id: toolCallId,
        approval: status === "allow" ? { status: "allow" } : { status: "deny", ...(reason ? { reason } : {}) }
      };
    });
    return this.createTurnInput(sessionId, input);
  }
'''
if old not in text: raise SystemExit('trueforge createTurn anchor not found')
trueforge.write_text(text.replace(old, new, 1))

server = Path('server.mjs')
text = server.read_text()
text = text.replace('async function executeMissionAction(id, action) {', 'async function executeMissionAction(id, action, payload = {}) {', 1)
helper_anchor = 'async function executeMissionAction(id, action, payload = {}) {'
helper = '''function pendingTrueForgeApprovalRefs(requiredActions = []) {
  const refs = [];
  for (const action of requiredActions) {
    if (action?.type !== "tool.approval_required") continue;
    const threadId = action.threadId || action.thread_id;
    const toolCalls = Array.isArray(action.toolCalls) ? action.toolCalls : Array.isArray(action.tool_calls) ? action.tool_calls : [];
    if (!threadId) continue;
    for (const ref of toolCalls) {
      const toolCallId = ref?.id || ref?.toolCallId || ref?.tool_call_id;
      if (toolCallId) refs.push({ threadId: String(threadId), toolCallId: String(toolCallId) });
    }
  }
  return refs;
}

function normalizeTrueForgeApprovalPayload(requiredActions, approvals) {
  const pending = pendingTrueForgeApprovalRefs(requiredActions);
  if (!pending.length) throw httpError(409, "The last TrueForge turn has no pending tool approvals");
  const otherRequired = (requiredActions || []).filter(action => action?.type !== "tool.approval_required");
  if (otherRequired.length) throw httpError(409, "The TrueForge turn also has non-approval required actions; resolve the complete pause in the TrueForge UI");
  if (!Array.isArray(approvals) || approvals.length !== pending.length) {
    throw httpError(400, `Exactly ${pending.length} pending TrueForge tool approval decision${pending.length === 1 ? "" : "s"} must be supplied`);
  }
  const pendingKeys = new Set(pending.map(item => `${item.threadId}\n${item.toolCallId}`));
  const seen = new Set();
  const normalized = approvals.map((item, index) => {
    const threadId = typeof item?.threadId === "string" ? item.threadId.trim() : "";
    const toolCallId = typeof item?.toolCallId === "string" ? item.toolCallId.trim() : "";
    const status = item?.status;
    if (!threadId || !toolCallId) throw httpError(400, `approvals[${index}] requires threadId and toolCallId`);
    if (!["allow", "deny"].includes(status)) throw httpError(400, `approvals[${index}].status must be allow or deny`);
    const key = `${threadId}\n${toolCallId}`;
    if (!pendingKeys.has(key)) throw httpError(409, `Approval ${toolCallId} is not pending on the last TrueForge turn`);
    if (seen.has(key)) throw httpError(400, `Duplicate approval decision for ${toolCallId}`);
    seen.add(key);
    return {
      threadId,
      toolCallId,
      status,
      ...(typeof item.reason === "string" && item.reason.trim() ? { reason: item.reason.trim().slice(0, 2000) } : {})
    };
  });
  if (seen.size !== pendingKeys.size) throw httpError(400, "Every pending TrueForge tool approval must receive exactly one decision");
  return normalized;
}

'''
if helper not in text:
    text = text.replace(helper_anchor, helper + helper_anchor, 1)

old = '''    if (!mission.trueForge?.sessionId) throw httpError(409, "Connect a TrueForge session before starting a turn");
    if (mission.trueForge.lastTurn?.status === "running") throw httpError(409, "A TrueForge turn is already running for this mission");
'''
new = '''    if (!mission.trueForge?.sessionId) throw httpError(409, "Connect a TrueForge session before starting a turn");
    if (mission.trueForge.lastTurn?.status === "running") throw httpError(409, "A TrueForge turn is already running for this mission");
    if (mission.trueForge.lastTurn?.requiredActions?.length) throw httpError(409, "Resolve the pending TrueForge required actions before starting another normal turn");
'''
if old not in text: raise SystemExit('start trueforge guard anchor not found')
text = text.replace(old, new, 1)

sync_tail = '''    if (summary.status !== previousStatus) {
      const required = summary.requiredActions.length ? ` · ${summary.requiredActions.length} action${summary.requiredActions.length === 1 ? "" : "s"} require attention` : "";
      addActivity(id, "agent", `TrueForge turn ${summary.status}`, `Turn ${summary.id} changed from ${previousStatus} to ${summary.status}${required}.`);
    }
  } else {
'''
resume = '''    if (summary.status !== previousStatus) {
      const required = summary.requiredActions.length ? ` · ${summary.requiredActions.length} action${summary.requiredActions.length === 1 ? "" : "s"} require attention` : "";
      addActivity(id, "agent", `TrueForge turn ${summary.status}`, `Turn ${summary.id} changed from ${previousStatus} to ${summary.status}${required}.`);
    }
  } else if (action === "resume_trueforge_approval") {
    requireTrueForgeConfigured();
    const lastTurn = mission.trueForge?.lastTurn;
    if (!mission.trueForge?.sessionId || !lastTurn?.id) throw httpError(409, "No TrueForge turn exists for this mission");
    if (lastTurn.status === "running") throw httpError(409, "The TrueForge turn is still running; sync it before resolving an approval");
    const approvals = normalizeTrueForgeApprovalPayload(lastTurn.requiredActions, payload.approvals);
    const resumedFrom = lastTurn.id;
    const turn = await trueForge.submitToolApprovals(mission.trueForge.sessionId, approvals);
    const summary = summarizeTurn(turn);
    const now = new Date().toISOString();
    mission.trueForge.lastTurn = { ...summary, resumedFrom, startedAt: now, syncedAt: now };
    mission.updatedAt = now;
    const allowed = approvals.filter(item => item.status === "allow").length;
    const denied = approvals.length - allowed;
    addActivity(id, "agent", "TrueForge approval decisions submitted", `${allowed} allowed · ${denied} denied · resumed from turn ${resumedFrom} as ${summary.id}.`);
  } else {
'''
if sync_tail not in text: raise SystemExit('sync tail anchor not found')
text = text.replace(sync_tail, resume, 1)

old = '      const result = await serializeMutation(() => executeMissionAction(id, body.action));\n'
new = '      const result = await serializeMutation(() => executeMissionAction(id, body.action, body));\n'
if old not in text: raise SystemExit('action route payload anchor not found')
server.write_text(text.replace(old, new, 1))

app = Path('public/app.js')
text = app.read_text()
old = '  if (localActions && configured && connected && lastTurn?.status !== "running") controls.push(\'<button class="primary-button" data-agent-action="start_trueforge_turn">Run TrueForge turn</button>\');\n'
new = '  if (localActions && configured && connected && lastTurn?.status !== "running" && requiredCount === 0) controls.push(\'<button class="primary-button" data-agent-action="start_trueforge_turn">Run TrueForge turn</button>\');\n  if (connected && requiredCount > 0) controls.push(\'<span class="provider-pill critical">Resolve required action in TrueForge</span>\');\n'
if old not in text: raise SystemExit('trueforge UI controls anchor not found')
app.write_text(text.replace(old, new, 1))

unit = Path('test/trueforge.test.mjs')
text = unit.read_text()
text = text.replace('  let getTurnCount = 0;\n', '  let getTurnCount = 0;\n  let turnPostCount = 0;\n', 1)
old = '''    if (req.method === "POST" && req.url === "/api/v1/sessions/sess-vendor-scout/turns") {
      return send(200, { data: { id: "turn-1", state: { status: "running" } } });
    }
'''
new = '''    if (req.method === "POST" && req.url === "/api/v1/sessions/sess-vendor-scout/turns") {
      turnPostCount += 1;
      return send(200, { data: { id: turnPostCount === 1 ? "turn-1" : "turn-2", state: { status: "running" } } });
    }
'''
if old not in text: raise SystemExit('trueforge unit mock POST anchor not found')
text = text.replace(old, new, 1)
old = '''  assert.equal(mock.requests[1].body.stream, false);
  assert.equal(mock.requests[1].body.input[0].type, "user.message");
});
'''
new = '''  assert.equal(mock.requests[1].body.stream, false);
  assert.equal(mock.requests[1].body.input[0].type, "user.message");

  const resumed = await client.submitToolApprovals(session.id, [{ threadId: "thread-main", toolCallId: "call-order", status: "allow" }]);
  assert.equal(resumed.id, "turn-2");
  const approvalRequest = mock.requests.find(request => request.method === "POST" && request.body?.input?.[0]?.type === "user.tool_approval");
  assert.ok(approvalRequest);
  assert.deepEqual(approvalRequest.body, {
    stream: false,
    input: [{ type: "user.tool_approval", thread_id: "thread-main", tool_call_id: "call-order", approval: { status: "allow" } }]
  });
});
'''
if old not in text: raise SystemExit('trueforge unit assertion anchor not found')
unit.write_text(text.replace(old, new, 1))

runtime = Path('test/trueforge-runtime.test.mjs')
text = runtime.read_text()
text = text.replace('  let getTurnCount = 0;\n', '  let getTurnCount = 0;\n  let turnPostCount = 0;\n', 1)
old = '''    if (req.method === "POST" && req.url === "/api/v1/sessions/sess-42/turns") {
      assert.equal(body.stream, false);
      assert.equal(body.input[0].type, "user.message");
      assert.match(body.input[0].content, /human approval/);
      return send(200, { data: { id: "turn-42", state: { status: "running" } } });
    }
    if (req.method === "GET" && req.url === "/api/v1/sessions/sess-42/turns/turn-42") {
      getTurnCount += 1;
      return send(200, {
        data: {
          id: "turn-42",
          state: getTurnCount > 0
            ? { status: "done", output: { content: "Qualified suppliers are ready for RFQ outreach." }, requiredActions: [] }
            : { status: "running" }
        }
      });
    }
'''
new = '''    if (req.method === "POST" && req.url === "/api/v1/sessions/sess-42/turns") {
      turnPostCount += 1;
      assert.equal(body.stream, false);
      if (turnPostCount === 1) {
        assert.equal(body.input[0].type, "user.message");
        assert.match(body.input[0].content, /human approval/);
        return send(200, { data: { id: "turn-42", state: { status: "running" } } });
      }
      assert.deepEqual(body.input, [{ type: "user.tool_approval", thread_id: "thread-main", tool_call_id: "call-sample", approval: { status: "allow" } }]);
      return send(200, { data: { id: "turn-43", state: { status: "running" } } });
    }
    if (req.method === "GET" && req.url === "/api/v1/sessions/sess-42/turns/turn-42") {
      getTurnCount += 1;
      return send(200, {
        data: {
          id: "turn-42",
          state: {
            status: "done",
            output: null,
            required_actions: [{
              id: "approval-event-1",
              type: "tool.approval_required",
              thread_id: "thread-main",
              tool_calls: [{ id: "call-sample", source_event_id: "model-message-1" }]
            }]
          }
        }
      });
    }
    if (req.method === "GET" && req.url === "/api/v1/sessions/sess-42/turns/turn-43") {
      return send(200, { data: { id: "turn-43", state: { status: "done", output: { content: "Approved tool execution completed." }, required_actions: [] } } });
    }
'''
if old not in text: raise SystemExit('trueforge runtime mock anchor not found')
text = text.replace(old, new, 1)

helper_old = '''async function postAction(baseUrl, action) {
  const response = await fetch(`${baseUrl}/api/missions/mission-lidar-500/actions`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action })
  });
  const body = await response.json();
  assert.equal(response.status, 200, body.error);
  return body.dashboard;
}
'''
helper_new = '''async function postAction(baseUrl, action, extra = {}, expectedStatus = 200) {
  const response = await fetch(`${baseUrl}/api/missions/mission-lidar-500/actions`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action, ...extra })
  });
  const body = await response.json();
  assert.equal(response.status, expectedStatus, body.error);
  return body;
}
'''
if helper_old not in text: raise SystemExit('runtime postAction helper anchor not found')
text = text.replace(helper_old, helper_new, 1)

old = '''  let dashboard = await postAction(runtime.baseUrl, "connect_trueforge");
  assert.equal(dashboard.missions[0].trueForge.sessionId, "sess-42");
  assert.equal(dashboard.missions[0].trueForge.agentName, "vendor-scout");

  dashboard = await postAction(runtime.baseUrl, "start_trueforge_turn");
  assert.equal(dashboard.missions[0].trueForge.lastTurn.id, "turn-42");
  assert.equal(dashboard.missions[0].trueForge.lastTurn.status, "running");

  dashboard = await postAction(runtime.baseUrl, "sync_trueforge_turn");
  assert.equal(dashboard.missions[0].trueForge.lastTurn.status, "done");
  assert.match(dashboard.missions[0].trueForge.lastTurn.content, /RFQ outreach/);
  assert.ok(dashboard.activity.some(item => item.title === "TrueForge session connected"));
  assert.ok(dashboard.activity.some(item => item.title === "TrueForge turn done"));
});
'''
new = '''  let result = await postAction(runtime.baseUrl, "connect_trueforge");
  let dashboard = result.dashboard;
  assert.equal(dashboard.missions[0].trueForge.sessionId, "sess-42");
  assert.equal(dashboard.missions[0].trueForge.agentName, "vendor-scout");

  result = await postAction(runtime.baseUrl, "start_trueforge_turn");
  dashboard = result.dashboard;
  assert.equal(dashboard.missions[0].trueForge.lastTurn.id, "turn-42");
  assert.equal(dashboard.missions[0].trueForge.lastTurn.status, "running");

  result = await postAction(runtime.baseUrl, "sync_trueforge_turn");
  dashboard = result.dashboard;
  assert.equal(dashboard.missions[0].trueForge.lastTurn.status, "done");
  assert.equal(dashboard.missions[0].trueForge.lastTurn.requiredActions.length, 1);

  result = await postAction(runtime.baseUrl, "start_trueforge_turn", {}, 409);
  assert.match(result.error, /Resolve the pending TrueForge required actions/);

  result = await postAction(runtime.baseUrl, "resume_trueforge_approval", {
    approvals: [{ threadId: "thread-main", toolCallId: "not-pending", status: "allow" }]
  }, 409);
  assert.match(result.error, /not pending/);

  result = await postAction(runtime.baseUrl, "resume_trueforge_approval", {
    approvals: [{ threadId: "thread-main", toolCallId: "call-sample", status: "allow" }]
  });
  dashboard = result.dashboard;
  assert.equal(dashboard.missions[0].trueForge.lastTurn.id, "turn-43");
  assert.equal(dashboard.missions[0].trueForge.lastTurn.status, "running");
  assert.equal(dashboard.missions[0].trueForge.lastTurn.resumedFrom, "turn-42");

  result = await postAction(runtime.baseUrl, "sync_trueforge_turn");
  dashboard = result.dashboard;
  assert.equal(dashboard.missions[0].trueForge.lastTurn.status, "done");
  assert.match(dashboard.missions[0].trueForge.lastTurn.content, /Approved tool execution completed/);
  assert.ok(dashboard.activity.some(item => item.title === "TrueForge session connected"));
  assert.ok(dashboard.activity.some(item => item.title === "TrueForge approval decisions submitted"));
});
'''
if old not in text: raise SystemExit('runtime test flow anchor not found')
runtime.write_text(text.replace(old, new, 1))
