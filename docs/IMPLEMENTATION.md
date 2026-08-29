# Vendor Scout — Implementation Plan

## Goal

Build the current Vendor Scout repository into the TrueForge hackathon product described in `vision.md`.

The existing repository already provides a useful product shell and hardware supply context. Build forward from what exists instead of treating the project as a blank application.

The implementation should prioritize a **working end-to-end sourcing mission** over broad feature coverage.

---

# Phase 1 — Reframe the Existing Product

Transform the existing experience from supply-risk observation into autonomous procurement.

Build:

- updated Vendor Scout product framing
- new landing-page copy centered on autonomous sourcing and negotiation
- procurement-focused navigation
- removal or demotion of old local-demo, sample-data, and data-healing framing
- an Overview focused on active sourcing work, savings, negotiations, and approvals
- reuse of the existing Atlas Robotics / hardware context where it helps the demo

The product should immediately communicate:

> Find better suppliers. Negotiate automatically. Approve the best deal.

---

# Phase 2 — Sourcing Mission

Create the core object around which the product operates.

Build a Sourcing Mission experience with fields such as:

- component
- part/specification
- quantity
- current supplier information
- current price where available
- target price
- maximum lead time
- acceptable supplier constraints
- regions
- sample budget
- mission status

Use one strong hardware mission as the primary demo path.

The existing risky LiDAR component can become the initial sourcing trigger if it remains the strongest demo scenario.

Add the mission lifecycle needed to show autonomous progress.

---

# Phase 3 — Supplier Discovery

Make Vendor Scout able to find potential suppliers for the requested hardware component.

Build:

- supplier discovery
- structured candidate records
- source/provenance information
- supplier location
- product/spec match
- preliminary pricing when available
- MOQ
- lead-time information
- relevant supplier metadata
- visible discovery progress in the UI

The mission should produce multiple candidates rather than immediately choosing one supplier.

---

# Phase 4 — Supplier Qualification

Build the agent workflow that investigates candidates and decides which are worth contacting.

Evaluate useful signals such as:

- specification compatibility
- supplier legitimacy
- manufacturer/distributor status
- certifications where relevant
- geographic exposure
- lead time
- MOQ
- availability
- commercial plausibility
- reliability/confidence
- inconsistencies or warning signals

Show:

- Qualified
- Rejected
- Needs review

Each decision should have a concise reason.

Use subagents where they materially improve the workflow.

---

# Phase 5 — TrueForge Agent Core

Connect the sourcing mission to TrueForge and make it the orchestrator of the procurement workflow.

Build the TrueForge-driven execution needed for:

- mission persistence
- tool use
- discovery
- qualification
- outreach
- conversations
- negotiation
- quote analysis
- approval

A sourcing mission should behave like an ongoing agent session rather than a sequence of disconnected AI requests.

Expose agent progress in the product so the demo visibly shows that Vendor Scout is doing work.

---

# Phase 6 — Supplier Outreach

Allow Vendor Scout to contact qualified suppliers.

Build:

- RFQ creation
- supplier outreach
- message storage
- conversation threads
- requested commercial fields such as:
  - unit pricing
  - quantity tiers
  - MOQ
  - inventory
  - lead time
  - shipping terms
  - sample availability
  - sample pricing
  - relevant certifications or technical confirmation

The Conversations screen should show the real procurement discussion clearly.

---

# Phase 7 — Autonomous Negotiation

Make Vendor Scout continue the conversation after the first supplier response.

Build negotiation behavior that can:

- understand a supplier reply
- extract the offered terms
- compare the offer against mission constraints
- use competing offers where appropriate
- counter pricing
- negotiate MOQ
- negotiate shipping
- negotiate lead time
- ask for samples
- ask for missing information
- continue until the offer is strong enough, rejected, or requires human judgment

The negotiation should feel goal-directed rather than like generic email generation.

---

# Phase 8 — Quote Normalization and Analysis

Convert supplier conversations into comparable structured quotes.

Build:

- quote extraction
- currency normalization
- quantity-tier normalization
- shipping and landed-cost calculations where possible
- MOQ comparison
- lead-time comparison
- sample-cost comparison
- supplier-risk consideration
- savings calculations versus the current supplier
- scoring/ranking across offers

Use TrueForge sandbox/code execution for meaningful computation in this phase.

Show the analysis visually.

The user should be able to understand why Vendor Scout prefers one offer over another.

---

# Phase 9 — Human Approval

Build the central human-in-the-loop moment.

When Vendor Scout reaches a consequential action, it should stop and present a decision.

The approval experience should show:

- recommended supplier
- negotiated price
- original/current price
- expected savings
- lead time
- MOQ
- shipping/landed cost
- supplier qualification summary
- important risks
- competing offers
- sample terms
- Vendor Scout recommendation

Primary actions:

- Approve
- Keep negotiating
- Reject

The mission must not silently cross the approval boundary.

---

# Phase 10 — Sample Order / Approved Action

After approval, complete the approved next step.

For the hackathon demo, this can focus on sample procurement or an equivalent controlled purchasing action.

Build:

- approved sample-order action
- resulting order/status record
- mission timeline update
- clear confirmation of what happened
- persistence of the decision and outcome

The final demo should visibly prove that the agent did real work and only executed the consequential step after approval.

---

# Phase 11 — Command Center and Activity

Make the full workflow easy to understand without reading logs.

Build an Overview that can show metrics such as:

- active sourcing missions
- suppliers discovered
- suppliers qualified
- suppliers contacted
- negotiations active
- quotes received
- projected savings
- approvals waiting

Add a live activity stream such as:

> Mission created  
> 18 suppliers discovered  
> 7 rejected  
> 6 qualified  
> 4 RFQs sent  
> 3 suppliers replied  
> Supplier A countered  
> Quote comparison completed  
> Approval requested

The user should be able to understand Vendor Scout's work at a glance.

---

# Phase 12 — Demo Reliability

Make the main demo path dependable.

Ensure the full primary mission can be demonstrated from beginning to end:

**Create/open mission → Discover → Qualify → Contact → Negotiate → Compare → Approve → Sample action**

Add any controlled fallback/demo fixtures needed so external service failure does not destroy the presentation, while keeping the core integrations and agent behavior real.

Keep the demo focused on hardware sourcing.

---

# Phase 13 — Product Polish

Once the end-to-end workflow works, improve presentation.

Focus on:

- removing obsolete Canary/local-demo language
- consistent Vendor Scout branding
- loading/progress states
- agent activity visualization
- conversation readability
- supplier cards
- quote comparison
- approval clarity
- responsive layout
- strong empty/error states
- demo-friendly transitions

Do not let polish delay the core workflow.

---

# Phase 14 — Verification

Verify the product as a complete hackathon submission.

Cover:

- mission state transitions
- supplier qualification
- conversation persistence
- quote extraction
- comparison calculations
- approval enforcement
- post-approval action
- failed tool/API behavior
- reset/replay of the demo mission

Run the existing checks and extend tests around the new procurement workflow.

---

# Phase 15 — Hackathon Submission Readiness

Finish the repository as a project judges can understand quickly.

Update the README with:

- problem
- product
- 10-second explanation
- architecture
- TrueForge usage
- tools/integrations
- human approval flow
- setup
- demo instructions
- screenshots where useful
- Qodo / required hackathon evidence

Prepare the final demo around one story rather than a feature tour.

## Primary Demo Story

> Atlas Robotics has a hardware component with weak supplier coverage or unfavorable terms.

Vendor Scout:

1. opens a sourcing mission
2. discovers global alternatives
3. qualifies them
4. contacts the strongest candidates
5. receives supplier responses
6. negotiates
7. normalizes and compares the resulting quotes
8. recommends the strongest option
9. stops for approval
10. executes the approved sample-order action

The demo should end with a concrete outcome such as:

> **Vendor Scout found and negotiated a qualified alternative supplier, improved the economics and/or lead time, and is ready to order test units with one human approval.**

---

# Priority Order

If time becomes constrained, prioritize in this order:

1. TrueForge-driven sourcing mission
2. supplier discovery
3. qualification
4. real outreach/conversation
5. negotiation
6. quote comparison
7. human approval
8. approved sample action
9. visible activity/progress
10. UI polish
11. secondary features

A small end-to-end system is more important than a large partially working procurement platform.
