import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { missionTurnPrompt, summarizeTurn, TrueForgeClient } from "../lib/trueforge.mjs";
import { createSeed } from "../lib/seed.mjs";

async function startMockTrueForge() {
  const requests = [];
  let getTurnCount = 0;
  let turnPostCount = 0;
  const server = http.createServer(async (req, res) => {
    let body = "";
    for await (const chunk of req) body += chunk;
    const parsedBody = body ? JSON.parse(body) : null;
    requests.push({ method: req.method, url: req.url, authorization: req.headers.authorization, body: parsedBody });

    const send = (status, value) => {
      res.writeHead(status, { "Content-Type": "application/json" });
      res.end(JSON.stringify(value));
    };

    if (req.method === "POST" && req.url === "/api/v1/sessions/") {
      return send(201, { data: { id: "sess-vendor-scout", agent: { type: "reference", name: "vendor-scout", id: "agent-1" } } });
    }
    if (req.method === "GET" && req.url === "/api/v1/sessions/sess-vendor-scout") {
      return send(200, { data: { id: "sess-vendor-scout" } });
    }
    if (req.method === "POST" && req.url === "/api/v1/sessions/sess-vendor-scout/turns") {
      turnPostCount += 1;
      return send(200, { data: { id: turnPostCount === 1 ? "turn-1" : "turn-2", state: { status: "running" } } });
    }
    if (req.method === "GET" && req.url === "/api/v1/sessions/sess-vendor-scout/turns/turn-1") {
      getTurnCount += 1;
      if (getTurnCount === 1) return send(200, { data: { id: "turn-1", state: { status: "running" } } });
      return send(200, { data: { id: "turn-1", state: { status: "done", output: { content: "Two suppliers are ready for outreach." }, requiredActions: [] } } });
    }
    return send(404, { message: "not found" });
  });

  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const { port } = server.address();
  return {
    baseUrl: `http://127.0.0.1:${port}`,
    requests,
    close: () => new Promise(resolve => server.close(resolve))
  };
}

test("TrueForge adapter creates a named persistent session and non-streaming turn", async t => {
  const mock = await startMockTrueForge();
  t.after(mock.close);
  const client = new TrueForgeClient({ baseUrl: mock.baseUrl, token: "id-token", agentName: "vendor-scout" });

  const session = await client.createSession();
  assert.equal(session.id, "sess-vendor-scout");
  const turn = await client.createTurn(session.id, "Continue the mission");
  assert.equal(turn.id, "turn-1");
  assert.equal(turn.state.status, "running");
  const done = await client.waitForTurn(session.id, turn.id, { timeoutMs: 2000, pollMs: 5 });
  assert.equal(done.state.status, "done");

  assert.deepEqual(mock.requests[0].body, { agent: { name: "vendor-scout" } });
  assert.equal(mock.requests[0].authorization, "Bearer id-token");
  assert.equal(mock.requests[1].body.stream, false);
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

test("mission prompt carries constraints and explicit approval boundary", () => {
  const state = createSeed({ missionStage: "contacting" });
  const mission = state.missions[0];
  const prompt = missionTurnPrompt(mission, { suppliers: state.supplierCandidates, activity: state.activity });
  assert.match(prompt, /Do not spend money/);
  assert.match(prompt, /explicit human approval/);
  assert.match(prompt, /targetUnitPrice/);
  assert.match(prompt, /controlled-fixture/);
  assert.match(prompt, /Source 500 production LiDAR modules|mission-lidar-500/);
});

test("turn summary stores bounded output and required actions", () => {
  const result = summarizeTurn({
    id: "turn-2",
    state: {
      status: "done",
      output: { content: "ready" },
      requiredActions: [{ type: "tool_approval", id: "approval-1" }]
    }
  });
  assert.equal(result.id, "turn-2");
  assert.equal(result.status, "done");
  assert.equal(result.content, "ready");
  assert.equal(result.requiredActions.length, 1);
});
