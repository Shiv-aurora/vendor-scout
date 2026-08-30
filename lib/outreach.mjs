import { createHash } from "node:crypto";

export const RFQ_REQUESTED_FIELDS = Object.freeze([
  "unit pricing for requested quantity",
  "quantity-tier pricing",
  "minimum order quantity (MOQ)",
  "current inventory / production availability",
  "production lead time",
  "shipping terms and estimated shipping cost",
  "sample availability and sample pricing",
  "relevant certifications",
  "technical confirmation against the requested specification"
]);

const MAX_PROVIDER_RESPONSE_BYTES = 256_000;
const PROVIDER_SUCCESS_STATUSES = new Set(["accepted", "sent", "delivered"]);
const RESERVED_DEMO_EMAIL = /@[^@]+\.example$/i;

function stableId(prefix, ...parts) {
  const digest = createHash("sha256").update(parts.join("\n")).digest("hex").slice(0, 18);
  return `${prefix}-${digest}`;
}

export function supplierContact(candidate) {
  const email = candidate.contact?.email || candidate.contactEmail || null;
  const reference = candidate.contact?.sourceReference || candidate.contactSourceReference || candidate.source?.reference || null;
  return { email, sourceReference: reference };
}

export function buildRfq(mission, candidate) {
  const contact = supplierContact(candidate);
  const subject = `RFQ: ${mission.quantity} × ${mission.specification}`;
  const requirements = mission.constraints.requirements.map(requirement => `- ${requirement}`).join("\n");
  const requestedFields = RFQ_REQUESTED_FIELDS.map(field => `- ${field}`).join("\n");
  const body = [
    `Hello ${candidate.name} team,`,
    "",
    `We are evaluating suppliers for ${mission.quantity} units of ${mission.specification}.`,
    "",
    "Technical requirements:",
    requirements,
    "",
    "Please include the following in your quotation:",
    requestedFields,
    "",
    `Target production lead time: ${mission.constraints.maxLeadTimeDays} days or less.`,
    `Delivery region requirements: ${mission.constraints.regions.join(", ")}.`,
    "",
    "This is a non-binding request for quotation. No purchase commitment or acceptance of commercial terms is being made by this message.",
    "",
    "Thank you,",
    "Vendor Scout on behalf of Atlas Robotics"
  ].join("\n");

  return {
    to: contact.email,
    contactSourceReference: contact.sourceReference,
    subject,
    body,
    requestedFields: [...RFQ_REQUESTED_FIELDS]
  };
}

export function createRfqConversation(mission, candidate, now = new Date().toISOString()) {
  const rfq = buildRfq(mission, candidate);
  const conversationId = stableId("conv", mission.id, candidate.id);
  const messageId = stableId("msg", conversationId, "initial-rfq");
  const idempotencyKey = stableId("rfq", mission.id, candidate.id, messageId);
  return {
    id: conversationId,
    missionId: mission.id,
    supplierId: candidate.id,
    supplierName: candidate.name,
    channel: "email",
    status: rfq.to ? "rfq_draft" : "missing_contact",
    createdAt: now,
    updatedAt: now,
    messages: [{
      id: messageId,
      type: "rfq",
      direction: "outbound",
      to: rfq.to,
      subject: rfq.subject,
      content: rfq.body,
      requestedFields: rfq.requestedFields,
      contactSourceReference: rfq.contactSourceReference,
      createdAt: now,
      delivery: {
        status: "draft",
        provider: null,
        externalMessageId: null,
        idempotencyKey,
        attemptedAt: null,
        deliveredAt: null,
        error: null
      }
    }]
  };
}

export function outboundRfqMessage(conversation) {
  return conversation.messages.find(message => message.direction === "outbound" && message.type === "rfq") || null;
}

export function isExternallyAccepted(message) {
  return PROVIDER_SUCCESS_STATUSES.has(message?.delivery?.status) && message.delivery.provider !== "controlled-preview";
}

export function recordSupplierReply(conversation, { content, sourceReference, providerMessageId, receivedAt = new Date().toISOString() }) {
  if (typeof content !== "string" || !content.trim()) throw new Error("Supplier reply content is required");
  if (typeof sourceReference !== "string" || !sourceReference.trim()) throw new Error("Supplier reply sourceReference is required");
  const normalizedContent = content.trim().slice(0, 100_000);
  const messageId = providerMessageId
    ? stableId("msg", conversation.id, "inbound", providerMessageId)
    : stableId("msg", conversation.id, "inbound", sourceReference, normalizedContent);
  if (conversation.messages.some(message => message.id === messageId)) return conversation;

  conversation.messages.push({
    id: messageId,
    type: "supplier_reply",
    direction: "inbound",
    content: normalizedContent,
    sourceReference: sourceReference.trim(),
    providerMessageId: providerMessageId || null,
    createdAt: receivedAt
  });
  conversation.status = "supplier_replied";
  conversation.updatedAt = receivedAt;
  return conversation;
}

async function readProviderJson(response) {
  const declared = Number(response.headers.get("content-length") || 0);
  if (declared > MAX_PROVIDER_RESPONSE_BYTES) throw new Error("Outreach provider response is too large");
  const raw = await response.text();
  if (Buffer.byteLength(raw) > MAX_PROVIDER_RESPONSE_BYTES) throw new Error("Outreach provider response is too large");
  let payload = {};
  if (raw) {
    try { payload = JSON.parse(raw); } catch { throw new Error("Outreach provider returned invalid JSON"); }
  }
  if (!response.ok) {
    const message = payload?.error?.message || payload?.message || payload?.error || `Outreach provider returned ${response.status}`;
    throw new Error(String(message));
  }
  return payload;
}

async function sendWithRemoteProvider({ url, token, mission, candidate, conversation, message }) {
  if (RESERVED_DEMO_EMAIL.test(message.to)) throw new Error("Controlled .example supplier contacts cannot be sent through an external outreach provider");
  const parsedUrl = new URL(url);
  if (process.env.NODE_ENV === "production" && parsedUrl.protocol !== "https:") {
    throw new Error("Production outreach provider must use HTTPS");
  }
  const response = await fetch(parsedUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Idempotency-Key": message.delivery.idempotencyKey,
      ...(token ? { Authorization: `Bearer ${token}` } : {})
    },
    body: JSON.stringify({
      mission: { id: mission.id, title: mission.title },
      supplier: { id: candidate.id, name: candidate.name },
      conversationId: conversation.id,
      message: {
        id: message.id,
        type: message.type || "supplier_message",
        to: message.to,
        subject: message.subject,
        body: message.content
      }
    }),
    signal: AbortSignal.timeout(15_000)
  });
  const payload = await readProviderJson(response);
  const status = String(payload.status || "accepted").toLowerCase();
  if (!PROVIDER_SUCCESS_STATUSES.has(status)) throw new Error(`Outreach provider returned unsupported delivery status: ${status}`);
  return {
    provider: "remote-outreach",
    status,
    externalMessageId: payload.messageId || payload.id || null,
    deliveredAt: payload.deliveredAt || new Date().toISOString(),
    simulated: false
  };
}

export async function deliverSupplierMessage({ mission, candidate, conversation, message }, options = {}) {
  if (!message?.to) throw new Error(`Supplier ${candidate.name} does not have a verified contact email`);
  if (!message?.delivery?.idempotencyKey) throw new Error("Supplier message requires a persisted idempotency key before delivery");
  const url = options.url ?? process.env.VENDOR_SCOUT_OUTREACH_URL;
  const token = options.token ?? process.env.VENDOR_SCOUT_OUTREACH_TOKEN;
  const allowControlledPreview = options.allowControlledPreview ?? (
    process.env.NODE_ENV !== "production" || process.env.VENDOR_SCOUT_ALLOW_OUTREACH_PREVIEW === "1"
  );

  if (url) return sendWithRemoteProvider({ url, token, mission, candidate, conversation, message });
  if (!allowControlledPreview) throw new Error("Outreach provider is not configured and controlled preview is disabled");

  return {
    provider: "controlled-preview",
    status: "simulated",
    externalMessageId: null,
    deliveredAt: null,
    simulated: true
  };
}

export async function deliverRfq(context, options = {}) {
  return deliverSupplierMessage(context, options);
}
