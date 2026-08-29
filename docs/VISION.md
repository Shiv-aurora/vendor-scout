# Vendor Scout — Vision

## Hackathon

Vendor Scout is being built for the **TrueForge Hackathon by WeMakeDevs**.

The project should clearly demonstrate an autonomous agent doing real work through TrueForge: discovering information, using tools, running analysis, maintaining an ongoing workflow, and stopping for human approval before a consequential action.

The product should be understandable in about 10 seconds.

## One-line product

**Vendor Scout continuously finds better hardware suppliers, negotiates with them for you, and brings the best deal to a human for approval.**

## Problem

Hardware companies depend on suppliers that can become expensive, slow, unavailable, or unreliable.

Procurement is also reactive. Teams often search for alternatives only after a supplier becomes a problem, then spend days finding vendors, requesting quotes, comparing terms, and negotiating.

A supply chain should not wait until something breaks before looking for better options.

## Vision

Vendor Scout turns procurement into a continuous autonomous process.

A company tells Vendor Scout what hardware component it needs and the constraints that matter:

- quantity
- target price
- maximum lead time
- technical requirements
- acceptable regions
- minimum supplier requirements
- sample budget

Vendor Scout then works on the mission autonomously.

It should:

1. Discover potential suppliers internationally.
2. Research and qualify the suppliers.
3. Contact promising suppliers.
4. Request pricing, availability, MOQ, lead time, shipping, certifications, and sample terms.
5. Continue conversations when suppliers reply.
6. Negotiate pricing and terms using the company's constraints and competing quotes.
7. Normalize quotes so different suppliers can be compared fairly.
8. Evaluate cost, reliability, lead time, geography, MOQ, shipping, and supplier risk.
9. Recommend the strongest option.
10. Stop before a consequential commitment and ask the human to approve, reject, or continue negotiating.
11. After approval, take the approved next action, such as ordering test units or progressing the supplier relationship.
12. Continue looking for better or safer alternatives over time.

The agent should do as much work as possible itself. Human attention should be required only when judgment or commitment genuinely matters.

## Demo Scope

Keep the working demo narrow.

The primary demo should focus on **hardware components** and one strong sourcing mission from beginning to end.

Example:

> Atlas Robotics needs 500 LiDAR modules. Its current supplier has a long lead time and weak supplier redundancy. Find a qualified alternative supplier with better economics and lead time.

The demo should visibly progress through:

**Mission → Discover → Qualify → Contact → Negotiate → Compare → Human Approval**

The strongest ending is a concrete decision such as:

> Vendor Scout negotiated a qualified supplier from $X to $Y per unit, reduced lead time, and found a sample order available for $Z. Approve the sample order?

## Product Experience

Vendor Scout should feel like a procurement command center, not a chatbot and not a scraping dashboard.

The main interface should make it obvious:

- what Vendor Scout is currently working on
- which suppliers it found
- why suppliers were accepted or rejected
- which suppliers have been contacted
- what conversations are happening
- what quotes have been received
- what Vendor Scout negotiated
- how offers compare
- how much money or supply risk can be reduced
- what decisions currently require a human

A useful navigation structure is:

- Overview
- Sourcing Missions
- Suppliers
- Conversations
- Approvals

The interface should make autonomous progress visible in real time.

## Core Product Objects

The product should naturally revolve around:

### Sourcing Mission

A specific procurement objective with requirements and constraints.

### Supplier Candidate

A discovered supplier being researched and qualified.

### Conversation

The ongoing RFQ and negotiation with a supplier.

### Quote

Structured commercial terms extracted from supplier communication.

### Recommendation

Vendor Scout's comparison and reasoning across qualified offers.

### Approval

A consequential decision that requires the user.

### Sample Order

An approved test purchase or equivalent next step used to validate a supplier before production commitment.

## Human-in-the-Loop

Human approval is not a decorative confirmation screen.

Vendor Scout should autonomously perform research, outreach, analysis, and negotiation within the user's constraints.

It should stop when a real commitment is required, such as:

- spending money
- ordering samples
- accepting commercial terms
- committing to a supplier
- making another action that materially affects the company

The approval screen should provide enough evidence for a fast decision.

Example:

- current supplier cost
- proposed supplier cost
- annual savings
- lead-time difference
- MOQ
- shipping
- supplier confidence/risk
- important tradeoffs
- sample cost
- Vendor Scout recommendation

Actions could include:

**Approve sample / Keep negotiating / Reject**

## TrueForge

TrueForge should be central to how the product works, not added as a label.

The final system should visibly use the capabilities that matter for this workflow, including:

- autonomous agent execution
- real tools / MCP integrations
- subagents where useful
- persistent sourcing sessions
- sandboxed computation or generated analysis
- human approval before consequential actions

A strong use of sandbox execution is quote normalization and supplier comparison across currencies, shipping, quantity tiers, MOQ, and landed cost.

## What Makes Vendor Scout Different

Vendor Scout is not:

- another supplier database
- a price scraper
- an RFQ template generator
- a procurement chatbot
- a dashboard that only warns about supply risk

Its value is that it **acts**.

It finds the vendor, investigates them, starts the conversation, negotiates the deal, compares the result, and brings the human the decision.

## Final Impression

A judge should understand this immediately:

> **Vendor Scout makes hardware supply chains cheaper and more reliable by continuously finding and negotiating with alternative suppliers. The agent handles the work; the human approves the commitment.**

The product should feel autonomous, credible, visual, and complete enough that the demo resembles a real procurement workflow rather than a sequence of mocked AI screens.
