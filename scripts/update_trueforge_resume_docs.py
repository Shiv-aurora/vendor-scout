from pathlib import Path

path = Path('docs/TRUEFORGE.md')
text = path.read_text()
old = '''Vendor Scout can create and reuse one TrueForge session per sourcing mission through:

```text
connect_trueforge
start_trueforge_turn
sync_trueforge_turn
```

`connect_trueforge` persists the returned session ID on the mission.

`start_trueforge_turn` starts a non-streaming turn and stores its turn ID immediately. Vendor Scout does not hold an HTTP request open while the agent works.

`sync_trueforge_turn` retrieves the current/terminal turn state and stores bounded output plus `requiredActions` so the product can expose a harness pause rather than hiding it.
'''
new = '''Vendor Scout can create, advance, inspect, and safely resume one TrueForge session per sourcing mission through:

```text
connect_trueforge
start_trueforge_turn
sync_trueforge_turn
resume_trueforge_approval
```

`connect_trueforge` persists the returned session ID on the mission.

`start_trueforge_turn` starts a non-streaming user-message turn and stores its turn ID immediately. Vendor Scout does not hold an HTTP request open while the agent works. If the previous terminal turn still contains `requiredActions`, Vendor Scout refuses to start another normal user-message turn until that pause is resolved.

`sync_trueforge_turn` retrieves the current/terminal turn state and stores bounded output plus `requiredActions` so the product can expose a harness pause rather than hiding it.

`resume_trueforge_approval` is a narrow persistence/debugging bridge for a pure TrueForge tool-approval pause. The caller supplies one `allow` or `deny` decision for every pending `(threadId, toolCallId)` pair from the last persisted required-actions set. Vendor Scout rejects invented, stale, duplicated, partial, or mismatched refs before contacting TrueForge.

Example Vendor Scout action payload:

```json
{
  "action": "resume_trueforge_approval",
  "approvals": [
    {
      "threadId": "thread-main",
      "toolCallId": "call-sample-order",
      "status": "allow"
    }
  ]
}
```

The final demo should still make the human decision visibly in the TrueForge UI. This action exists so the resumed turn chain can be persisted/tested and so runtime debugging does not require hand-building raw TrueForge requests.
'''
if old not in text: raise SystemExit('persistent session section anchor not found')
text = text.replace(old, new, 1)
old = '''The human approval decision is sent back to TrueForge as a `user.tool_approval` turn input. An allowed action proceeds; a denied action does not execute.

Vendor Scout still performs server-side checks after TrueForge approval:
'''
new = '''The human approval decision is sent back to TrueForge as a `user.tool_approval` turn input. An allowed action proceeds; a denied action does not execute.

Vendor Scout talks to TrueForge through the raw REST API, not through the TypeScript SDK serializer. The SDK-facing names are `threadId` / `toolCallId`, while the current raw wire schema uses `thread_id` / `tool_call_id`. `TrueForgeClient.submitToolApprovals(...)` deliberately serializes the raw wire form and is covered by a contract test against the current TrueForge schema.

Vendor Scout does not expose an auto-approve browser button for this harness pause. When `requiredActions` exist, the command-center TrueForge panel suppresses the normal “Run TrueForge turn” control and tells the operator to resolve the required action in TrueForge.

Vendor Scout still performs server-side checks after TrueForge approval:
'''
if old not in text: raise SystemExit('approval wire anchor not found')
text = text.replace(old, new, 1)
old = '''- persistent TrueForge sessions/turns
- MCP tool schemas and safety annotations
'''
new = '''- persistent TrueForge sessions/turns
- raw REST `user.tool_approval` serialization (`thread_id` / `tool_call_id`)
- exact pending-approval ref matching and rejection of stale/invented approval decisions
- blocking a new normal TrueForge turn while required actions remain unresolved
- persisted approval-resume turn chaining
- MCP tool schemas and safety annotations
'''
if old not in text: raise SystemExit('verification bullets anchor not found')
path.write_text(text.replace(old, new, 1))
