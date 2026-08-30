# Vendor Scout — Final Demo Runbook

## 10-second explanation

> Vendor Scout finds alternative hardware suppliers, negotiates against your constraints, compares the real economics, and brings the best deal to a human. The agent does the work; the human approves the commitment.

Primary story: **Atlas Robotics needs 500 production LiDAR modules with better economics and a production lead time under 21 days.**

## Three proof moments

1. **Autonomous procurement:** TrueForge reads one persistent sourcing mission, finds/records alternatives, qualifies them, prepares RFQs, and continues supplier negotiations through Vendor Scout MCP tools.
2. **Negotiation + code execution:** after supplier offers are ready, TrueForge uses sandbox execution to check the quote math, then Vendor Scout persists a deterministic normalized comparison and recommendation.
3. **Real stop before consequence:** Vendor Scout reaches `awaiting_approval`; the human approves the business decision; a later TrueForge turn attempts the destructive sample-order tool and visibly pauses for tool approval before execution.

## Recommended 3-minute video

### 0:00–0:15 — Hook

Show the landing page / command center while saying:

> Atlas Robotics has one LiDAR supplier at $429 a unit with a 42-day lead time. Vendor Scout is an autonomous procurement agent: give it the requirement, and it finds alternatives, negotiates, compares the result, and only asks a human when a real commitment is ready.

Avoid opening with architecture or implementation details.

### 0:15–0:35 — Mission

Open **Sourcing Missions**.

Point to:

- 500 units
- target ≤ $390
- lead time ≤ 21 days
- allowed regions
- technical requirements
- sample budget
- persistent lifecycle

Then switch briefly to the TrueForge session to prove this is one ongoing agent session, not a sequence of disconnected chat prompts.

### 0:35–1:00 — Discover + qualify

In TrueForge, show the Vendor Scout MCP connector/tool calls.

Show Vendor Scout **Suppliers** immediately afterward:

- multiple candidates
- provenance/source reference
- Qualified / Needs review / Rejected
- concise reason for each decision

If using the controlled fallback for recording reliability, say explicitly:

> I’m using the controlled fallback here so the video does not depend on a supplier site being available. Vendor Scout labels it as demo evidence; the same MCP record path accepts live research with source provenance.

Never imply controlled supplier records are real companies/messages.

### 1:00–1:35 — Outreach + autonomous negotiation

Open **Conversations**.

Show:

- persisted RFQ
- contact/source evidence
- supplier reply provenance
- structured offer terms
- exact price / MOQ / lead-time gap
- generated counter
- round number
- controlled-vs-real delivery label

Narration:

> Vendor Scout does not just generate an email. It extracts explicit terms from the recorded supplier response, compares them to the mission and competing offers, and counters only the actual gaps. Missing data stays missing.

For a live provider path, show the provider ID. For the controlled demo path, point out `no external message sent`.

### 1:35–1:55 — TrueForge sandbox

Return to the TrueForge turn.

Show it executing code in the sandbox to independently check:

- effective quantity-tier unit price
- MOQ / overbuy
- shipping
- FX if applicable
- landed cost
- savings versus current supplier

Then show the `vendor_scout_analyze_quotes` tool call.

Narration:

> The agent does not eyeball two quotes. It uses code execution to check the economics, then Vendor Scout persists the deterministic comparison so the recommendation is reproducible.

### 1:55–2:25 — Decision packet

Open **Approvals**.

This is the most important product screen. Hold here long enough to read it.

Point out:

- recommended supplier
- decision score
- $429 current vs negotiated unit price
- landed cost
- projected savings
- 42-day current vs proposed lead time
- MOQ
- sample cost vs sample budget
- evidence check / risks
- competing quote cards and score breakdown

Say:

> At this point the autonomous work is done. Nothing has been accepted and no money has been spent.

### 2:25–2:40 — Business approval

Click **Approve sample**.

Immediately point out the next screen:

> This does not place the order. It records the business decision, and execution is still gated.

The page should visibly say:

- `Business approval recorded`
- `Approved — execution is still gated`
- `vendor_scout_execute_sample_order`

This prevents the approval screen from looking like a decorative modal.

### 2:40–2:55 — TrueForge approval pause

Go back to TrueForge and run the next turn.

The agent should attempt `vendor_scout_execute_sample_order`.

Show the harness/tool approval pause before execution. This is the sponsor-proof moment.

Narration:

> The sample-order tool is marked destructive. TrueForge pauses immediately before it executes, even though Vendor Scout already has the approved business decision.

Allow it for the controlled demo. If you deny it, show that no sample order is created.

### 2:55–3:00 — Concrete ending

Return to Approvals. Show the completed state.

For controlled demo:

> The full approved-action path completed. This final provider is intentionally simulated, so no external spend occurred.

For a real order adapter:

> The provider accepted order [ID].

End on the outcome, not a feature list.

## Deterministic local climax

If external services fail before recording, run Vendor Scout locally and build the exact decision state:

```bash
npm install
npm run dev
# second terminal
npm run demo:decision
```

Open:

```text
http://localhost:3000/#app/approvals
```

This produces controlled supplier reply/offer evidence, runs the real negotiation/quote engine, and stops at `awaiting_approval`. It is designed as a reliable fallback, not as evidence of real supplier communication.

## Live TrueForge recording checklist

Before recording the final submission, verify all of these visually:

- TrueForge server is running with a configured model provider
- saved agent is named `vendor-scout`
- Vendor Scout MCP connector is attached
- sandbox is enabled
- `vendor_scout_execute_sample_order` is in `require_approval_for_tools`
- a mission TrueForge session ID is persisted
- at least one actual Vendor Scout MCP tool call is visible in TrueForge
- sandbox code execution is visible during quote verification
- `vendor_scout_analyze_quotes` reaches `awaiting_approval`
- business approval in Vendor Scout creates no sample order yet
- a later TrueForge turn emits the actual tool-approval pause for the destructive sample action
- allow/deny is performed through TrueForge, not by bypassing the harness
- final Vendor Scout screen reflects the resulting real or controlled provider truth

## Submission hygiene before upload

- make the GitHub repository public
- verify MIT license is visible
- get actual Qodo review on the representative final PR and address findings
- update README `## Qodo Code Review Evidence` with that PR/review
- ensure README public links work without authentication
- disclose AI-assisted development (already present in README)
- do not claim controlled supplier messages/orders are live external evidence
- use one demo story; do not turn the video into a feature tour
