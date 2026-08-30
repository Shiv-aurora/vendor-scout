# Codex Handoff — Live TrueForge Validation

Use this handoff **only** in a Codex/development environment that can run persistent local services, configure model providers, expose local networking, and interact with the TrueForge harness. Ordinary Vendor Scout implementation is already complete in GitHub; do not use Codex merely because the project is large.

## Repository

Repository:

```text
https://github.com/Shiv-aurora/vendor-scout
```

Working branch:

```text
build/final-product-copy2
```

Do **not** merge PR #5 or any parent PR. The repository has a hackathon-required Qodo review gate that is not yet satisfied.

## Read first

Before changing anything, inspect the repository and read:

- `docs/VISION.md`
- `docs/IMPLEMENTATION.md`
- `docs/STATUS.md`
- `docs/TRUEFORGE.md`
- `docs/DEMO.md`
- `docs/QODO_REVIEW.md`
- `README.md`

Treat GitHub as the source of truth. Reconcile these docs with the current code before making changes.

## Why this is a Codex task

The remaining proof requires an environment-sensitive workflow rather than more normal repository coding:

- a separate TrueForge service/runtime
- Node/runtime setup required by the current TrueForge release
- a configured model provider
- Vendor Scout running as a second persistent local service
- Streamable HTTP MCP networking between the two services
- saved TrueForge agent configuration
- sandbox execution
- an interactive `tool.approval_required` pause
- approval resume through a new TrueForge turn
- repeated shell/runtime/network debugging if the local harness differs from the documented contract

Do not simplify the project to avoid this integration. Do not replace TrueForge with a mock for the final proof.

## Objective

Produce **real external validation** of the final Vendor Scout + TrueForge loop:

```text
TrueForge persistent session
→ Vendor Scout MCP tool use
→ meaningful sandbox quote computation/check
→ Vendor Scout quote analysis
→ awaiting_approval
→ human business approval in Vendor Scout
→ later TrueForge tool call to vendor_scout_execute_sample_order
→ real TrueForge tool.approval_required pause
→ human allow or deny through TrueForge
→ approval-resume turn
→ Vendor Scout approved action only after an allow
```

A controlled Vendor Scout sample-order provider is acceptable for the final action as long as the product clearly shows `simulated=true` / no external spend. The **TrueForge runtime/tool call/sandbox/approval pause itself must be real**.

## Existing Vendor Scout integration

Vendor Scout already provides:

- TrueForge HTTP session adapter (`lib/trueforge.mjs`)
- persistent TrueForge session ID and last-turn state on each sourcing mission
- `/mcp` Streamable HTTP JSON-RPC endpoint
- 12 procurement MCP tools
- sandbox-oriented mission instructions
- `vendor_scout_execute_sample_order` marked `destructiveHint: true`, `openWorldHint: true`, `idempotentHint: true`
- server-side business approval and sample-budget enforcement independent of TrueForge
- explicit `resume_trueforge_approval` mission action
- raw REST approval serialization using `thread_id` / `tool_call_id`
- protection against starting a new normal TrueForge turn while required actions remain unresolved
- validation that submitted approval refs exactly match the required actions stored on the last TrueForge turn

The Vendor Scout action API is:

```text
POST /api/missions/mission-lidar-500/actions
```

Useful actions:

```json
{ "action": "connect_trueforge" }
{ "action": "start_trueforge_turn" }
{ "action": "sync_trueforge_turn" }
```

To resume a pure TrueForge tool-approval pause after the human decides:

```json
{
  "action": "resume_trueforge_approval",
  "approvals": [
    {
      "threadId": "<thread from required action>",
      "toolCallId": "<pending tool call id>",
      "status": "allow"
    }
  ]
}
```

For a denial:

```json
{
  "action": "resume_trueforge_approval",
  "approvals": [
    {
      "threadId": "<thread from required action>",
      "toolCallId": "<pending tool call id>",
      "status": "deny",
      "reason": "Denied by the human reviewer"
    }
  ]
}
```

Vendor Scout will reject invented, duplicated, partial, or stale approval references.

## TrueForge configuration target

Start a real current TrueForge server. Prefer the official current package/runtime rather than copying old assumptions from this file.

Create/save an agent named:

```text
vendor-scout
```

Attach Vendor Scout as a Streamable HTTP MCP connector at:

```text
http://127.0.0.1:3000/mcp
```

(or an equivalent reachable address if the services are containerized).

Enable sandbox execution.

Configure approval policy so this exact tool requires human approval:

```text
vendor_scout_execute_sample_order
```

Representative target agent settings are documented in `docs/TRUEFORGE.md`; adapt field names only if the current TrueForge version has changed.

## Model/provider

Use an actually available model provider in the Codex environment. Do not commit provider secrets.

If a custom/OpenAI-compatible local provider is used, confirm it genuinely supports the tool-calling behavior TrueForge needs. Do not fake a model response just to make the harness appear connected.

Keep cost bounded. This is a narrow one-mission validation, not a load test.

## Recommended validation route

### 1. Baseline repository

Before external setup, run:

```bash
npm ci
npm run check
```

Do not weaken or delete failing tests to proceed.

### 2. Start Vendor Scout

Use an isolated state file. Local development mode is acceptable for the controlled demo path.

```bash
export VENDOR_SCOUT_DATA_PATH=/tmp/vendor-scout-live-trueforge.json
npm start
```

### 3. Build reliable decision evidence when needed

If live supplier communication is unavailable, use the repository's explicitly controlled demo evidence rather than inventing a real supplier exchange:

```bash
npm run demo:decision
```

This is acceptable only as the procurement evidence fallback. It does **not** replace the required real TrueForge harness proof.

### 4. Start/configure TrueForge

Run the real TrueForge service, configure a model provider, save the `vendor-scout` agent, attach the MCP connector, enable sandbox, and configure the destructive tool approval rule.

### 5. Prove session + MCP

Use Vendor Scout `connect_trueforge`, then start/sync a turn.

Capture evidence that:

- the real TrueForge session ID is persisted in Vendor Scout
- the TrueForge turn is real, not a mock server
- Vendor Scout MCP tools are visible/called from TrueForge
- the same mission state changes in the Vendor Scout UI/API

### 6. Prove sandbox

Before final quote analysis, make the TrueForge turn use sandbox/code execution to check persisted quote arithmetic such as:

- quantity-tier effective unit price
- MOQ / overbuy
- shipping
- FX when source-backed FX is available
- landed cost
- savings against the current supplier baseline

The sandbox result is an independent check. Vendor Scout remains the deterministic persisted source of truth.

Capture visible TrueForge evidence of the sandbox call/output.

### 7. Reach the business decision

Call/run `vendor_scout_analyze_quotes` through the TrueForge tool loop (or have the agent do so as instructed).

Verify Vendor Scout reaches:

```text
awaiting_approval
```

Open `#app/approvals` and verify the human decision packet.

### 8. Record the business approval

Use Vendor Scout's **Approve sample** control.

Immediately verify:

- mission status is `approved`
- the Approval record is approved
- `sampleOrders` is still empty
- UI says business approval is recorded but execution is still gated

Do not execute the sample action directly at this point.

### 9. Prove the TrueForge destructive pause

Start the next TrueForge turn.

The agent should see the approved mission and request:

```text
vendor_scout_execute_sample_order
```

The TrueForge turn must end with an actual:

```text
tool.approval_required
```

for that tool call.

Capture:

- tool name
- tool args / mission id
- thread ID
- tool-call ID
- required-action state
- TrueForge UI/harness approval control

Do not bypass this by calling Vendor Scout MCP directly for the final proof.

### 10. Resume through TrueForge

Prefer visibly clicking Allow/Deny in the TrueForge UI for the final video.

For debugging or persistence synchronization, Vendor Scout supports `resume_trueforge_approval`, which creates the documented `user.tool_approval` turn input and stores the resumed turn chain. It must use only the refs from the persisted last required-actions set.

Test both outcomes if practical:

**Deny**
- TrueForge resumes without executing the sample tool
- Vendor Scout must not create a sample order

**Allow**
- TrueForge resumes the paused call
- Vendor Scout receives the destructive MCP request
- Vendor Scout independently re-checks its business approval/budget
- controlled sample provider may complete with `simulated=true`
- final mission becomes completed only after successful execution

### 11. Final evidence

Record exact versions and the final successful path in `docs/STATUS.md`:

- TrueForge version/commit/package version
- model provider type + model name (no secret)
- Vendor Scout branch/head SHA
- session ID (non-secret runtime ID)
- turn IDs
- MCP tool calls observed
- sandbox proof
- approval-required event proof
- allow/deny result
- final Vendor Scout mission/order state

If screenshots/logs are small and safe, store them under an appropriate `docs/evidence/` path. Do not commit credentials, tokens, raw sensitive headers, or unrelated local state.

## Acceptance criteria

The task is complete only when all of these are true:

1. A real TrueForge server is running with a real configured model provider.
2. TrueForge creates a real persistent `vendor-scout` session and Vendor Scout persists its ID.
3. TrueForge visibly calls at least one Vendor Scout MCP procurement tool.
4. TrueForge visibly uses sandbox/code execution for meaningful quote arithmetic/checking.
5. Vendor Scout reaches `awaiting_approval` with the final decision packet.
6. Business approval does not itself create/submit a sample order.
7. A later TrueForge turn attempts `vendor_scout_execute_sample_order`.
8. TrueForge emits a real `tool.approval_required` pause for that exact call.
9. Allow/deny is resolved through TrueForge's approval mechanism; the pause is not bypassed.
10. An allowed action reaches Vendor Scout and passes its independent approval/budget checks; a denied action does not execute.
11. The final controlled action, if used, is visibly labeled simulated/no external spend.
12. `npm run check` remains green after any integration fixes.
13. Any code/config reliability changes are committed and pushed to `build/final-product-copy2`.
14. `docs/STATUS.md` is updated with actual external evidence.
15. PR #5 remains unmerged until Qodo review is genuinely present.

## Constraints

- Do not reduce the product to a mock or static demo.
- Do not disable TrueForge approval policy to make the run easier.
- Do not auto-approve the destructive tool in a script for the final proof.
- Do not invent supplier facts, replies, FX, shipping, or provider IDs.
- Do not send controlled `.example` contacts to real suppliers.
- Do not place real external spend unless the user has separately and explicitly requested that; controlled sample execution is sufficient for this hackathon proof.
- Do not expose tokens/secrets in commits, logs, screenshots, README, or STATUS.
- Do not merge Qodo-gated PRs.
- Keep any setup fixes focused and coherent; no parallel replacement architecture.

## Operating instructions

Inspect first, then make the smallest useful integration fixes needed for the real runtime.

Use the existing architecture. If current TrueForge behavior differs from the documented contract, verify against the installed/current TrueForge source or API and adapt Vendor Scout narrowly rather than guessing.

After every meaningful runtime fix, rerun the relevant focused test and then `npm run check`.

Before ending:

- push necessary repo changes to `build/final-product-copy2`
- update `docs/STATUS.md`
- leave the working tree clean
- report the exact TrueForge/model/runtime evidence and any blocker still outside the repository

Do not return a theoretical setup guide instead of attempting the live integration.