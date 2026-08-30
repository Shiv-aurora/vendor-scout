from pathlib import Path

app_path = Path('public/app.js')
text = app_path.read_text()

old_states = '''const conversationStates = {
  rfq_draft: { label: "RFQ draft", tone: "fixture" },
  sending: { label: "Sending", tone: "fixture" },
  previewed: { label: "Controlled preview — no email sent", tone: "fixture" },
  rfq_sent: { label: "RFQ sent", tone: "live" },
  delivery_failed: { label: "Delivery failed", tone: "critical" },
  missing_contact: { label: "Missing contact", tone: "critical" },
  supplier_replied: { label: "Supplier replied", tone: "live" },
  negotiating: { label: "Negotiating", tone: "live" }
};'''
new_states = '''const conversationStates = {
  rfq_draft: { label: "RFQ draft", tone: "fixture" },
  sending: { label: "Sending", tone: "fixture" },
  previewed: { label: "Controlled preview — no email sent", tone: "fixture" },
  rfq_sent: { label: "RFQ sent", tone: "live" },
  delivery_failed: { label: "Delivery failed", tone: "critical" },
  missing_contact: { label: "Missing contact", tone: "critical" },
  supplier_replied: { label: "Supplier replied", tone: "live" },
  negotiating: { label: "Negotiating", tone: "live" },
  counter_draft: { label: "Counter ready", tone: "fixture" },
  counter_sending: { label: "Sending counter", tone: "fixture" },
  counter_previewed: { label: "Counter preview — no email sent", tone: "fixture" },
  counter_sent: { label: "Counter sent", tone: "live" },
  counter_delivery_failed: { label: "Counter delivery failed", tone: "critical" },
  offer_ready: { label: "Offer ready for comparison", tone: "live" },
  human_review: { label: "Human review required", tone: "critical" }
};'''
if old_states not in text:
    raise SystemExit('conversation states anchor missing')
text = text.replace(old_states, new_states, 1)

old_helpers = '''function latestReply(conversation) {
  return [...(conversation?.messages || [])].reverse().find(message => message.direction === "inbound") || null;
}

function renderConversations() {'''
new_helpers = '''function latestReply(conversation) {
  return [...(conversation?.messages || [])].reverse().find(message => message.direction === "inbound") || null;
}

function latestCounter(conversation) {
  return [...(conversation?.messages || [])].reverse().find(message => message.direction === "outbound" && message.type === "counter") || null;
}

function offerMoney(value, currency) {
  if (!Number.isFinite(value)) return "—";
  return `${escapeHtml(currency || "USD")} ${Number(value).toFixed(2)}`;
}

function negotiationStatusLabel(status) {
  return {
    counter_required: "Counter required",
    needs_information: "Needs information",
    ready_for_comparison: "Ready for comparison",
    reject_recommended: "Human review required"
  }[status] || String(status || "Not evaluated").replaceAll("_", " ");
}

function renderConversations() {'''
if old_helpers not in text:
    raise SystemExit('conversation helper anchor missing')
text = text.replace(old_helpers, new_helpers, 1)

old_block = '''    const outbound = outboundMessage(conversation);
    const reply = latestReply(conversation);
    const state = conversationStates[conversation.status] || { label: conversation.status.replaceAll("_", " "), tone: "" };
    const delivery = outbound?.delivery || {};
    const isPreview = delivery.provider === "controlled-preview" || conversation.status === "previewed";
    const source = outbound?.contactSourceReference || candidate.contact?.sourceReference || candidate.contactSourceReference || candidate.source?.reference || "No contact provenance";
    const deliveryLine = isPreview
      ? "preview only · no external message was sent"
      : delivery.provider === "remote-outreach"
        ? `${delivery.status || "sent"}${delivery.externalMessageId ? ` · ${delivery.externalMessageId}` : ""}`
        : delivery.error || "Delivery has not been attempted";
    const replyMarkup = reply
      ? `<div class="conversation-reply"><span>Supplier reply</span><p>${escapeHtml(reply.content)}</p><small>Source: ${escapeHtml(reply.sourceReference || "unknown")}</small></div>`
      : '<div class="conversation-reply empty-reply">No supplier reply recorded yet</div>';
    const rfqMarkup = outbound
      ? `<details class="rfq-details"><summary>View RFQ</summary><div><b>${escapeHtml(outbound.subject)}</b><small>To: ${escapeHtml(outbound.to || "No verified contact")}</small><pre>${escapeHtml(outbound.content)}</pre></div></details>`
      : "";

    return `<article class="panel conversation-card"><header><div><h3>${escapeHtml(conversation.supplierName || candidate.name)}</h3><p>${escapeHtml(outbound?.to || "No verified contact")}</p></div><span class="provider-pill ${state.tone}">${escapeHtml(state.label)}</span></header><div class="conversation-meta"><span>Contact evidence<b>${escapeHtml(source)}</b></span><span>Delivery<b>${escapeHtml(deliveryLine)}</b></span></div>${rfqMarkup}${replyMarkup}</article>`;'''
new_block = '''    const outbound = outboundMessage(conversation);
    const reply = latestReply(conversation);
    const counter = latestCounter(conversation);
    const negotiation = conversation.negotiation || null;
    const offer = negotiation?.offers?.at(-1) || null;
    const evaluation = negotiation?.latestEvaluation || null;
    const state = conversationStates[conversation.status] || { label: conversation.status.replaceAll("_", " "), tone: "" };
    const delivery = outbound?.delivery || {};
    const isPreview = delivery.provider === "controlled-preview" || conversation.status === "previewed";
    const source = outbound?.contactSourceReference || candidate.contact?.sourceReference || candidate.contactSourceReference || candidate.source?.reference || "No contact provenance";
    const deliveryLine = isPreview
      ? "preview only · no external message was sent"
      : delivery.provider === "remote-outreach"
        ? `${delivery.status || "sent"}${delivery.externalMessageId ? ` · ${delivery.externalMessageId}` : ""}`
        : delivery.error || "Delivery has not been attempted";
    const replyMarkup = reply
      ? `<div class="conversation-reply"><span>Supplier reply</span><p>${escapeHtml(reply.content)}</p><small>Source: ${escapeHtml(reply.sourceReference || "unknown")}</small></div>`
      : '<div class="conversation-reply empty-reply">No supplier reply recorded yet</div>';
    const rfqMarkup = outbound
      ? `<details class="rfq-details"><summary>View RFQ</summary><div><b>${escapeHtml(outbound.subject)}</b><small>To: ${escapeHtml(outbound.to || "No verified contact")}</small><pre>${escapeHtml(outbound.content)}</pre></div></details>`
      : "";
    const gapsMarkup = evaluation
      ? `<div class="negotiation-gaps">${evaluation.gaps.length ? evaluation.gaps.map(gap => `<span><b>${escapeHtml(gap.field)}</b>${escapeHtml(gap.reason)}</span>`).join("") : '<span class="gap-clear"><b>No unresolved constraint gap</b>Offer can move to comparison without accepting it.</span>'}${evaluation.missingFields.length ? `<span><b>Missing evidence</b>${escapeHtml(evaluation.missingFields.join(" · "))}</span>` : ""}</div>`
      : "";
    const offerMarkup = offer
      ? `<section class="negotiation-panel"><div class="negotiation-title"><div><p class="eyebrow">LATEST PERSISTED OFFER</p><h4>${escapeHtml(negotiationStatusLabel(evaluation?.status))}</h4></div><small>Source: ${escapeHtml(offer.sourceReference)}</small></div><div class="offer-grid"><span>Unit price<b>${offerMoney(offer.unitPrice, offer.currency)}</b></span><span>MOQ<b>${number(offer.moq)}</b></span><span>Lead time<b>${days(offer.leadTimeDays)}</b></span><span>Shipping<b>${escapeHtml(offer.shippingTerms || "—")}</b></span><span>Sample<b>${offer.sampleAvailable == null ? "—" : offer.sampleAvailable ? offerMoney(offer.samplePrice, offer.currency) : "Not available"}</b></span><span>Technical fit<b>${offer.technicalConfirmed == null ? "Unverified" : offer.technicalConfirmed ? "Confirmed" : "Not confirmed"}</b></span></div>${gapsMarkup}</section>`
      : "";
    const counterDelivery = counter?.delivery || {};
    const counterMarkup = counter
      ? `<details class="rfq-details counter-details"><summary>View negotiation counter · round ${number(counter.negotiationRound)}</summary><div><b>${escapeHtml(counter.subject)}</b><small>${counterDelivery.provider === "controlled-preview" ? "Controlled preview · no external message sent" : counterDelivery.provider === "remote-outreach" ? `${escapeHtml(counterDelivery.status || "sent")} · ${escapeHtml(counterDelivery.externalMessageId || "provider accepted")}` : escapeHtml(counterDelivery.error || "Counter not delivered yet")}</small><pre>${escapeHtml(counter.content)}</pre></div></details>`
      : "";

    return `<article class="panel conversation-card"><header><div><h3>${escapeHtml(conversation.supplierName || candidate.name)}</h3><p>${escapeHtml(outbound?.to || "No verified contact")}</p></div><span class="provider-pill ${state.tone}">${escapeHtml(state.label)}</span></header><div class="conversation-meta"><span>Contact evidence<b>${escapeHtml(source)}</b></span><span>Delivery<b>${escapeHtml(deliveryLine)}</b></span></div>${rfqMarkup}${replyMarkup}${offerMarkup}${counterMarkup}</article>`;'''
if old_block not in text:
    raise SystemExit('conversation render block missing')
text = text.replace(old_block, new_block, 1)
app_path.write_text(text)

css_path = Path('public/procurement.css')
css = css_path.read_text()
css += '''\n.negotiation-panel{border:1px solid #d6e3f3;background:#f8fbff;border-radius:12px;padding:14px;margin-top:12px}.negotiation-title{display:flex;justify-content:space-between;gap:12px;align-items:flex-start}.negotiation-title h4{margin:0;font-size:14px}.negotiation-title small{font:8px var(--mono);color:var(--muted);max-width:48%;overflow-wrap:anywhere;text-align:right}.offer-grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:8px;margin-top:12px}.offer-grid span{border:1px solid #dce7f5;background:#fff;border-radius:9px;padding:10px;color:var(--muted);font-size:8px;text-transform:uppercase}.offer-grid b{display:block;color:var(--ink);font-size:10px;text-transform:none;margin-top:4px;overflow-wrap:anywhere}.negotiation-gaps{display:grid;gap:7px;margin-top:10px}.negotiation-gaps span{border-left:2px solid var(--amber);padding:7px 10px;background:#fffaf0;color:#6f5a30;font-size:9px;line-height:1.45}.negotiation-gaps span b{display:block;color:var(--ink);font-size:9px;margin-bottom:2px}.negotiation-gaps .gap-clear{border-left-color:var(--green);background:#f7fcf9;color:#45705a}.counter-details{margin-top:12px;border-color:#cbdcf3}@media(max-width:720px){.negotiation-title{display:grid}.negotiation-title small{max-width:none;text-align:left}.offer-grid{grid-template-columns:repeat(2,minmax(0,1fr))}}\n'''
css_path.write_text(css)

Path('.github/workflows/one-shot-phase7-ui.yml').unlink(missing_ok=True)
Path('scripts/phase7_ui_patch.py').unlink(missing_ok=True)
