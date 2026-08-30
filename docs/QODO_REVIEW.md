# Qodo Review Focus

Vendor Scout is being built for a hackathon that requires substantive pull-request changes to receive Qodo review before merge.

## Current gate

Qodo review commands have been posted on PRs #2, #3, and #4, but GitHub currently shows no submitted Qodo review/check/thread for those PRs. A command comment is not treated as review evidence.

Do not merge the remaining substantive PR chain until Qodo is correctly authorized for the repository and an actual review exists.

Historical note: PR #1 was merged before Qodo review evidence existed. This cannot be retroactively corrected and should not be misrepresented.

## Final representative PR review focus

The final Phases 8–15 PR should be reviewed especially for:

### Procurement correctness

- quote extraction stays anchored to persisted supplier replies
- unknown shipping / price / MOQ / lead time / FX is not silently converted to zero
- quantity tiers and MOQ overbuy are calculated correctly
- cross-currency conversion requires source provenance
- a stale `offer_ready` state is revalidated against the current competing offer set
- incomplete landed-cost offers remain visible but do not beat complete landed-cost offers merely because unknown shipping makes them look cheap
- scoring/ranking and recommendation reasons match persisted evidence

### Idempotency / partial failures

- RFQ and counter retries do not duplicate externally accepted messages
- quote re-analysis does not duplicate comparison/approval events when evidence is unchanged
- changed quote evidence cannot silently replace a packet already under human review
- sample execution persists intent before external I/O and is safe to replay after completion
- remote order transport uses the stable idempotency key

### Human commitment boundary

- quote analysis can create a recommendation/approval packet but cannot spend money or accept terms
- `Approve sample` records a business decision only; it does not create a sample order
- `Keep negotiating` returns the mission to negotiation without a commitment
- `Reject` closes the recommendation without a commitment
- sample execution requires the mission to be `approved` and a matching persisted approved decision
- approved quote/sample must still exist and sample price must remain within the mission budget

### TrueForge tool safety

- MCP exposes exactly one intentional consequential action: `vendor_scout_execute_sample_order`
- that tool is marked `destructiveHint: true`, `openWorldHint: true`, `idempotentHint: true`
- docs/saved-agent configuration put that exact tool in `require_approval_for_tools`
- there is no generic `accept_offer`, `accept_terms`, `purchase`, or arbitrary `place_order` tool
- Vendor Scout server-side approval enforcement remains independent of the TrueForge approval UI

### Provenance / truthfulness

- controlled discovery/outreach/replies/sample actions are clearly labeled as controlled/simulated
- `.example` contacts cannot leak to a real outreach provider
- controlled preview never increments real supplier-contact claims
- controlled sample action never claims external spend or a real provider order ID
- live provider records preserve provider IDs/source references

### Security / production defaults

- mutation/MCP auth remains default-deny in production
- fixture discovery, outreach preview, sample preview, and dev reset remain disabled by default in production
- remote providers require HTTPS in production except loopback-local test/runtime cases
- credentials are never returned to the browser/dashboard
- state migrations preserve existing mission data and unknown versions fail closed

### UI / judge clarity

- the decision packet shows enough evidence to make a fast decision
- pending / business-approved-but-still-gated / completed-simulated states cannot be confused
- incomplete/unrankable quote evidence remains visible
- desktop/mobile rendering does not hide or clip the human decision controls

## Review follow-up requirement

For every material Qodo finding:

1. Fix it, or explicitly dismiss it with a concrete technical rationale.
2. Re-run the relevant tests/browser workflow.
3. Request follow-up Qodo review when required by the hackathon rules.
4. Record the representative reviewed PR under the README heading `## Qodo Code Review Evidence` before submission.
