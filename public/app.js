let data;
let selectedMissionId;
let actionPending = false;

/* Charts are drawn at real pixel size so SVG text keeps its exact type size.
   Each entry maps a slot element id to a draw(width) function. */
const chartRegistry = new Map();
let resizeTimer;

const $ = selector => document.querySelector(selector);
const $$ = selector => [...document.querySelectorAll(selector)];
const escapeHtml = value => String(value ?? "").replace(/[&<>"']/g, character => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[character]);

const number = value => Number.isFinite(value) ? new Intl.NumberFormat("en-US").format(value) : "—";
const money = value => Number.isFinite(value) ? new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(value) : "—";
const money2 = value => Number.isFinite(value) ? new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", minimumFractionDigits: 2 }).format(value) : "—";
const moneyShort = value => Number.isFinite(value) ? new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", notation: "compact", maximumFractionDigits: 1 }).format(value) : "—";
const days = value => Number.isFinite(value) ? `${number(value)} days` : "—";
const percent = value => Number.isFinite(value) ? `${Math.round(value * 100)}%` : "—";
const plural = (count, word, suffix = "s") => `${count} ${word}${count === 1 ? "" : suffix}`;

const appViews = new Set(["overview", "missions", "suppliers", "conversations", "approvals"]);

const pageTitles = {
  overview: "Overview",
  missions: "Missions",
  suppliers: "Suppliers",
  conversations: "Negotiations",
  approvals: "Approvals"
};

const stageNames = {
  draft: "Mission ready",
  discovering: "Discovering suppliers",
  qualifying: "Qualifying candidates",
  contacting: "Ready for outreach",
  negotiating: "Negotiating terms",
  comparing: "Comparing quotes",
  awaiting_approval: "Waiting for approval",
  approved: "Approved action",
  rejected: "Rejected",
  completed: "Completed"
};

const conversationStates = {
  rfq_draft: { label: "RFQ draft", tone: "chip-plain" },
  sending: { label: "Sending", tone: "chip-warn" },
  previewed: { label: "Controlled preview — no email sent", tone: "chip-warn" },
  rfq_sent: { label: "RFQ sent", tone: "chip-live" },
  delivery_failed: { label: "Delivery failed", tone: "chip-crit" },
  missing_contact: { label: "Missing contact", tone: "chip-crit" },
  supplier_replied: { label: "Supplier replied", tone: "chip-live" },
  negotiating: { label: "Negotiating", tone: "chip-live" },
  counter_draft: { label: "Counter ready", tone: "chip-warn" },
  counter_sending: { label: "Sending counter", tone: "chip-warn" },
  counter_previewed: { label: "Counter preview — no email sent", tone: "chip-warn" },
  counter_sent: { label: "Counter sent", tone: "chip-live" },
  counter_delivery_failed: { label: "Counter delivery failed", tone: "chip-crit" },
  offer_ready: { label: "Offer ready to compare", tone: "chip-live" },
  human_review: { label: "Human review required", tone: "chip-crit" }
};

const progressByStatus = {
  draft: 0,
  discovering: 1,
  qualifying: 2,
  contacting: 3,
  negotiating: 4,
  comparing: 5,
  awaiting_approval: 6,
  approved: 7,
  rejected: 7,
  completed: 7
};

const nextActionByStatus = {
  draft: { action: "start", label: "Start supplier discovery" },
  discovering: { action: "discover", label: "Run supplier discovery" },
  qualifying: { action: "qualify", label: "Run qualification" }
};

/* The seven stages the agent moves through. */
const workflowStages = [
  { key: "mission", name: "Mission" },
  { key: "discover", name: "Discover" },
  { key: "qualify", name: "Qualify" },
  { key: "contact", name: "Contact" },
  { key: "negotiate", name: "Negotiate" },
  { key: "compare", name: "Compare" },
  { key: "approval", name: "Approval" }
];

const icons = {
  check: '<svg viewBox="0 0 12 12" fill="none" aria-hidden="true"><path d="M2.5 6.4l2.4 2.4L9.6 3.6" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  dot: '<svg viewBox="0 0 12 12" aria-hidden="true"><circle cx="6" cy="6" r="3" fill="currentColor"/></svg>',
  human: '<svg viewBox="0 0 12 12" fill="none" aria-hidden="true"><path d="M6 2.6v4" stroke="currentColor" stroke-width="1.9" stroke-linecap="round"/><circle cx="6" cy="9.2" r="1.05" fill="currentColor"/></svg>',
  stop: '<svg viewBox="0 0 12 12" fill="none" aria-hidden="true"><path d="M3.4 3.4l5.2 5.2M8.6 3.4l-5.2 5.2" stroke="currentColor" stroke-width="1.9" stroke-linecap="round"/></svg>'
};

/* --------------------------------------------------------------------------
   Data access
   -------------------------------------------------------------------------- */

async function api(path, options = {}) {
  const response = await fetch(path, options);
  let value;
  try { value = await response.json(); } catch { value = {}; }
  if (!response.ok) throw new Error(value.error || `Request failed (${response.status})`);
  return value;
}

function toast(message) {
  const element = $("#toast");
  if (!element) return;
  element.textContent = message;
  element.classList.add("show");
  setTimeout(() => element.classList.remove("show"), 2600);
}

function showWorkspaceError(message) {
  const element = $("#workspace-error");
  if (!element) return;
  element.hidden = !message;
  element.textContent = message || "";
}

function mission() {
  return data.missions.find(item => item.id === selectedMissionId) || data.missions[0];
}

function componentFor(currentMission) {
  return data.components.find(item => item.id === currentMission.componentId);
}

function progressFor(status) {
  return progressByStatus[status] ?? 0;
}

function latestForMission(items, missionId) {
  return [...(items || [])].reverse().find(item => item.missionId === missionId) || null;
}

function outboundMessage(conversation) {
  return conversation?.messages?.find(message => message.direction === "outbound" && message.type === "rfq") || null;
}

/* Everything the views need about the selected mission, derived once. */
function missionContext() {
  const currentMission = mission();
  const candidates = data.supplierCandidates.filter(item => item.missionId === currentMission.id);
  const conversations = data.conversations.filter(item => item.missionId === currentMission.id);
  const quotes = (data.quotes || []).filter(item => item.missionId === currentMission.id);
  const recommendation = latestForMission(data.recommendations, currentMission.id);
  const approval = latestForMission(data.approvals, currentMission.id);
  const order = latestForMission(data.sampleOrders, currentMission.id);

  const qualified = candidates.filter(item => item.status === "qualified");
  const offerThreads = conversations.filter(item => item.negotiation?.offers?.length);
  const counterRounds = conversations.reduce((max, item) => Math.max(max, item.negotiation?.counterRounds || 0), 0);
  const rankable = quotes.filter(item => Number.isInteger(item.rank));
  const winner = recommendation ? quotes.find(item => item.id === recommendation.quoteId) : null;

  return {
    mission: currentMission,
    component: componentFor(currentMission),
    candidates,
    conversations,
    quotes,
    recommendation,
    approval,
    order,
    qualified,
    offerThreads,
    counterRounds,
    rankable,
    winner,
    progress: progressFor(currentMission.status),
    localActions: Boolean(data.capabilities?.browserMutationsEnabled)
  };
}

/* --------------------------------------------------------------------------
   Agent state — derived only from persisted mission state
   -------------------------------------------------------------------------- */

function agentState(context) {
  const { mission: currentMission, candidates, qualified, offerThreads, quotes, counterRounds, order } = context;
  const status = currentMission.status;

  if (status === "draft") return { text: "Mission ready to run", tone: "idle" };
  if (status === "discovering") return { text: "Searching the supplier market", tone: "working" };
  if (status === "qualifying") return { text: `Qualifying ${plural(candidates.length, "candidate")}`, tone: "working" };
  if (status === "contacting") return { text: `Preparing RFQs for ${plural(qualified.length, "supplier")}`, tone: "working" };
  if (status === "negotiating") {
    if (counterRounds > 0) return { text: `Negotiating · round ${counterRounds}`, tone: "working" };
    if (!offerThreads.length) return { text: "Waiting on supplier replies", tone: "working" };
    return { text: `Reviewing ${plural(offerThreads.length, "supplier offer")}`, tone: "working" };
  }
  if (status === "comparing") return { text: `Comparing ${plural(quotes.length, "qualified offer")}`, tone: "working" };
  if (status === "awaiting_approval") return { text: "Human decision required", tone: "waiting" };
  if (status === "approved") return { text: order ? "Sample action executed" : "Approved — execution gated", tone: "settled" };
  if (status === "rejected") return { text: "Recommendation rejected", tone: "settled" };
  if (status === "completed") return { text: "Sample action complete", tone: "settled" };
  return { text: stageNames[status] || status, tone: "idle" };
}

/* Per-stage values shown under each workflow node. Empty stages stay empty. */
function workflowValues(context) {
  const { mission: currentMission, candidates, qualified, conversations, offerThreads, quotes, rankable, approval, order, counterRounds } = context;
  const offers = offerThreads.reduce((total, item) => total + item.negotiation.offers.length, 0);

  const approvalValue = order
    ? "sample ordered"
    : approval?.status === "pending"
      ? "1 waiting"
      : approval?.status === "approved"
        ? "approved"
        : approval?.status === "rejected"
          ? "rejected"
          : approval?.status === "returned_to_negotiation"
            ? "sent back"
            : "";

  return {
    mission: `${number(currentMission.quantity)} units`,
    discover: candidates.length ? `${candidates.length} found` : "",
    qualify: qualified.length || candidates.length ? `${qualified.length} qualified` : "",
    contact: conversations.length ? `${plural(conversations.length, "RFQ")}` : "",
    negotiate: counterRounds > 0 ? `${offers} offers · r${counterRounds}` : offers ? `${plural(offers, "offer")}` : "",
    compare: rankable.length ? `${rankable.length} ranked` : quotes.length ? `${plural(quotes.length, "quote")}` : "",
    approval: approvalValue
  };
}

/* --------------------------------------------------------------------------
   Chart infrastructure
   -------------------------------------------------------------------------- */

function chartSlot(id) {
  return `<div class="chart-slot" id="${id}"></div>`;
}

function registerChart(id, draw) {
  chartRegistry.set(id, draw);
}

function drawCharts() {
  for (const [id, draw] of chartRegistry) {
    const element = document.getElementById(id);
    if (!element || !element.isConnected) continue;
    const width = Math.round(element.clientWidth);
    // Slots inside an inactive view measure zero; they draw when that view opens.
    if (width < 80) continue;
    if (element.dataset.width === String(width)) continue;
    element.innerHTML = draw(width);
    element.dataset.width = String(width);
  }
}

function svg(width, height, label, body) {
  return `<svg width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" role="img" aria-label="${escapeHtml(label)}">${body}</svg>`;
}

const round = value => Math.round(value * 100) / 100;

function niceStep(range, target) {
  const raw = range / target;
  const magnitude = 10 ** Math.floor(Math.log10(raw));
  return [1, 2, 2.5, 4, 5, 10].map(step => step * magnitude).find(step => step >= raw) || magnitude * 10;
}

/* Place a point label in the first candidate slot that does not overlap
   anything already drawn, so dense clusters stay readable. */
function placeLabels(labels, bounds) {
  const occupied = [...(bounds.obstacles || [])];
  const overlaps = (a, b) => a.x1 < b.x2 && a.x2 > b.x1 && a.y1 < b.y2 && a.y2 > b.y1;

  return labels.map(label => {
    const width = Math.max(label.text.length, label.value.length) * 6.4 + 6;
    const offset = (label.radius || 6) + 6;
    const candidates = [
      { anchor: "start", tx: label.px + offset, nameY: label.py - 1, valueY: label.py + 12, x1: label.px + offset, x2: label.px + offset + width, y1: label.py - 12, y2: label.py + 16 },
      { anchor: "end", tx: label.px - offset, nameY: label.py - 1, valueY: label.py + 12, x1: label.px - offset - width, x2: label.px - offset, y1: label.py - 12, y2: label.py + 16 },
      { anchor: "start", tx: label.px + offset, nameY: label.py + 4, valueY: label.py + 17, x1: label.px + offset, x2: label.px + offset + width, y1: label.py - 7, y2: label.py + 21 },
      { anchor: "middle", tx: label.px, nameY: label.py - offset - 15, valueY: label.py - offset - 3, x1: label.px - width / 2, x2: label.px + width / 2, y1: label.py - offset - 26, y2: label.py - offset },
      { anchor: "middle", tx: label.px, nameY: label.py + offset + 12, valueY: label.py + offset + 24, x1: label.px - width / 2, x2: label.px + width / 2, y1: label.py + offset, y2: label.py + offset + 28 },
      { anchor: "end", tx: label.px - offset, nameY: label.py + 4, valueY: label.py + 17, x1: label.px - offset - width, x2: label.px - offset, y1: label.py - 7, y2: label.py + 21 }
    ];

    const fits = candidates.find(candidate =>
      candidate.x1 >= bounds.x1 && candidate.x2 <= bounds.x2 &&
      candidate.y1 >= bounds.y1 && candidate.y2 <= bounds.y2 &&
      !occupied.some(box => overlaps(candidate, box)));

    const chosen = fits || candidates[0];
    occupied.push(chosen);
    return { ...label, ...chosen };
  });
}

/* --------------------------------------------------------------------------
   Chart: unit price vs lead time
   Every discovered candidate, the current supplier, and any negotiated offer.
   -------------------------------------------------------------------------- */

/* A wide, short plot squeezes every point into one corner, so the height
   tracks the width until it would start dominating the page. */
const scatterHeight = width => (width < 560 ? 272 : Math.min(392, Math.max(300, Math.round(width * 0.36))));

function priceLeadChart(width, context) {
  const { mission: currentMission, candidates, quotes } = context;
  const current = currentMission.currentSupplier;
  const constraints = currentMission.constraints;

  const offerBySupplier = new Map(quotes.map(quote => [quote.supplierId, quote]));

  const leadValues = [
    ...candidates.map(item => item.leadTimeDays),
    ...quotes.map(item => item.leadTimeDays),
    current.leadTimeDays,
    constraints.maxLeadTimeDays
  ].filter(Number.isFinite);
  const priceValues = [
    ...candidates.map(item => item.preliminaryUnitPrice),
    ...quotes.map(item => item.unitPrice?.base),
    current.unitPrice,
    constraints.targetUnitPrice
  ].filter(Number.isFinite);

  if (!leadValues.length || !priceValues.length) return "";

  const height = scatterHeight(width);
  const pad = { top: 16, right: 16, bottom: 44, left: 58 };
  const plotW = width - pad.left - pad.right;
  const plotH = height - pad.top - pad.bottom;

  // Both domains hug the data. Anchoring lead time to zero would leave half
  // the plot empty, since no supplier ships in under two weeks.
  const leadLow = Math.min(...leadValues);
  const leadHigh = Math.max(...leadValues);
  const xPad = Math.max(2, (leadHigh - leadLow) * 0.12);
  const xMin = Math.max(0, Math.floor((leadLow - xPad) / 5) * 5);
  const xMax = Math.ceil((leadHigh + xPad) / 2) * 2;
  const priceLow = Math.min(...priceValues);
  const priceHigh = Math.max(...priceValues);
  const yPad = Math.max(8, (priceHigh - priceLow) * 0.16);
  const yMin = priceLow - yPad;
  const yMax = priceHigh + yPad;
  const yStep = niceStep(yMax - yMin, 5);

  const x = value => round(pad.left + ((value - xMin) / (xMax - xMin)) * plotW);
  const y = value => round(pad.top + plotH - ((value - yMin) / (yMax - yMin)) * plotH);

  const parts = [];

  // The mission's acceptance window: at or below target price, at or under the lead-time ceiling.
  const zoneRight = x(constraints.maxLeadTimeDays);
  const zoneTop = y(constraints.targetUnitPrice);
  parts.push(`<rect class="ch-zone" x="${pad.left}" y="${zoneTop}" width="${round(zoneRight - pad.left)}" height="${round(pad.top + plotH - zoneTop)}" rx="3"/>`);
  parts.push(`<line class="ch-zone-line" x1="${pad.left}" y1="${zoneTop}" x2="${zoneRight}" y2="${zoneTop}"/>`);
  parts.push(`<line class="ch-zone-line" x1="${zoneRight}" y1="${zoneTop}" x2="${zoneRight}" y2="${pad.top + plotH}"/>`);
  parts.push(`<text class="ch-zone-label" x="${pad.left + 8}" y="${round(pad.top + plotH - 10)}">Meets mission target</text>`);

  // Grid + axes
  for (let value = Math.ceil(yMin / yStep) * yStep; value <= yMax; value += yStep) {
    const py = y(value);
    parts.push(`<line class="ch-grid" x1="${pad.left}" y1="${py}" x2="${width - pad.right}" y2="${py}"/>`);
    parts.push(`<text class="ch-tick" x="${pad.left - 10}" y="${py + 4}" text-anchor="end">$${number(value)}</text>`);
  }
  const xStep = niceStep(xMax - xMin, 6);
  for (let value = Math.ceil(xMin / xStep) * xStep; value <= xMax; value += xStep) {
    parts.push(`<text class="ch-tick" x="${x(value)}" y="${pad.top + plotH + 20}" text-anchor="middle">${value}</text>`);
  }
  parts.push(`<line class="ch-axis" x1="${pad.left}" y1="${pad.top + plotH}" x2="${width - pad.right}" y2="${pad.top + plotH}"/>`);
  parts.push(`<text class="ch-axis-label" x="${round(pad.left + plotW / 2)}" y="${height - 8}" text-anchor="middle">Lead time (days)</text>`);
  parts.push(`<text class="ch-axis-label" transform="translate(14 ${round(pad.top + plotH / 2)}) rotate(-90)" text-anchor="middle">Unit price</text>`);

  const pointClass = {
    qualified: "ch-pt ch-pt-qualified",
    needs_review: "ch-pt ch-pt-review",
    rejected: "ch-pt ch-pt-rejected",
    discovered: "ch-pt"
  };

  // A dashed connector from the discovery estimate to the negotiated offer
  // makes the agent's price movement visible.
  // Narrow plots only have room to name the offers and the current supplier;
  // the candidate table underneath names the rest.
  const offersOnly = width < 520;
  const labels = [];
  for (const candidate of candidates) {
    if (!Number.isFinite(candidate.preliminaryUnitPrice) || !Number.isFinite(candidate.leadTimeDays)) continue;
    const cx = x(candidate.leadTimeDays);
    const cy = y(candidate.preliminaryUnitPrice);
    const quote = offerBySupplier.get(candidate.id);
    const shortName = candidate.name.split(" ")[0];

    if (quote && Number.isFinite(quote.unitPrice?.base) && Number.isFinite(quote.leadTimeDays)) {
      const qx = x(quote.leadTimeDays);
      const qy = y(quote.unitPrice.base);
      parts.push(`<line class="ch-connector" x1="${cx}" y1="${cy}" x2="${qx}" y2="${qy}"/>`);
      parts.push(`<circle class="${pointClass[candidate.status] || "ch-pt"}" cx="${cx}" cy="${cy}" r="4"/>`);
      parts.push(`<circle class="ch-pt ch-pt-offer" cx="${qx}" cy="${qy}" r="6"/>`);
      labels.push({ px: qx, py: qy, text: shortName, value: money2(quote.unitPrice.base), radius: 6, price: quote.unitPrice.base, offer: true });
    } else {
      parts.push(`<circle class="${pointClass[candidate.status] || "ch-pt"}" cx="${cx}" cy="${cy}" r="5.5"/>`);
      if (!offersOnly) labels.push({ px: cx, py: cy, text: shortName, value: money2(candidate.preliminaryUnitPrice), radius: 5.5 });
    }
  }

  // Current supplier: the baseline everything is measured against.
  if (Number.isFinite(current.unitPrice) && Number.isFinite(current.leadTimeDays)) {
    const cx = x(current.leadTimeDays);
    const cy = y(current.unitPrice);
    parts.push(`<rect class="ch-pt-current" x="${round(cx - 5)}" y="${round(cy - 5)}" width="10" height="10" rx="2"/>`);
    labels.push({ px: cx, py: cy, text: "Current", value: money2(current.unitPrice), radius: 7 });
  }

  // Offers cluster tightly against the target box, so a narrow plot names only
  // the cheapest one rather than printing two labels on top of each other.
  let drawn = labels;
  if (offersOnly && labels.filter(label => label.offer).length > 1) {
    const cheapest = labels.filter(label => label.offer).sort((a, b) => a.price - b.price)[0];
    drawn = labels.filter(label => !label.offer || label === cheapest);
  }

  const zoneLabelBox = { x1: pad.left, x2: pad.left + 130, y1: pad.top + plotH - 24, y2: pad.top + plotH };
  const placed = placeLabels(drawn, {
    x1: pad.left,
    x2: width - 2,
    y1: pad.top - 12,
    y2: pad.top + plotH + 4,
    obstacles: [zoneLabelBox]
  });

  for (const label of placed) {
    parts.push(`<text class="ch-name" x="${round(label.tx)}" y="${round(label.nameY)}" text-anchor="${label.anchor}">${escapeHtml(label.text)}</text>`);
    parts.push(`<text class="ch-sub" x="${round(label.tx)}" y="${round(label.valueY)}" text-anchor="${label.anchor}">${escapeHtml(label.value)}</text>`);
  }

  return svg(width, height, "Supplier unit price plotted against lead time", parts.join(""));
}

/* --------------------------------------------------------------------------
   Chart: sourcing funnel
   -------------------------------------------------------------------------- */

function funnelChart(width, stages, minHeight = 0) {
  const gap = 10;
  const height = Math.max(stages.length * 30 + (stages.length - 1) * gap + 6, minHeight);
  const rowHeight = (height - 6 - (stages.length - 1) * gap) / stages.length;
  const labelW = Math.min(150, Math.max(110, Math.round(width * 0.34)));
  const valueW = 34;
  const trackX = labelW + 10;
  const trackW = Math.max(40, width - trackX - valueW - 8);
  const max = Math.max(...stages.map(stage => stage.value), 1);

  const parts = [];
  stages.forEach((stage, index) => {
    const top = 3 + index * (rowHeight + gap);
    const mid = top + rowHeight / 2;
    const barH = 18;
    const barTop = round(mid - barH / 2);
    const fill = Math.max(stage.value > 0 ? 3 : 0, round((stage.value / max) * trackW));
    const isFinal = index === stages.length - 1 && stage.value > 0;

    parts.push(`<text class="ch-name" x="0" y="${round(mid + 4)}">${escapeHtml(stage.label)}</text>`);
    parts.push(`<rect class="ch-bar-track" x="${trackX}" y="${barTop}" width="${trackW}" height="${barH}" rx="4"/>`);
    if (fill > 0) {
      parts.push(`<rect class="${isFinal ? "ch-bar-save" : "ch-bar-best"}" x="${trackX}" y="${barTop}" width="${fill}" height="${barH}" rx="4"/>`);
    }
    parts.push(`<text class="${stage.value > 0 ? "ch-value" : "ch-sub"}" x="${width}" y="${round(mid + 4)}" text-anchor="end">${stage.value > 0 ? stage.value : "—"}</text>`);
  });

  return svg(width, height, "Suppliers remaining at each stage of the sourcing mission", parts.join(""));
}

/* --------------------------------------------------------------------------
   Chart: current spend vs recommended spend
   Both bars share a scale, so the saved amount is the visible remainder.
   -------------------------------------------------------------------------- */

function savingsChart(width, options) {
  const { baseline, recommended, savings, currentName, bestName, costLabel } = options;
  if (!Number.isFinite(baseline) || !Number.isFinite(recommended)) return "";

  const barH = 32;
  const max = Math.max(baseline, recommended);
  const parts = [];

  // Totals sit above each bar so they never fight the fill colour for contrast.
  const row = (labelY, name, value, valueClass, savedWidth) => {
    const barTop = labelY + 9;
    const w = Math.max(2, round((value / max) * width));
    parts.push(`<text class="ch-name" x="0" y="${labelY}">${escapeHtml(name)}</text>`);
    parts.push(`<text class="ch-value" x="${width}" y="${labelY}" text-anchor="end">${escapeHtml(money(value))}</text>`);
    parts.push(`<rect class="ch-bar-track" x="0" y="${barTop}" width="${width}" height="${barH}" rx="5"/>`);
    parts.push(`<rect class="${valueClass}" x="0" y="${barTop}" width="${w}" height="${barH}" rx="5"/>`);
    if (savedWidth > 0) {
      parts.push(`<rect class="ch-bar-save" x="${w}" y="${barTop}" width="${round(savedWidth)}" height="${barH}" rx="5"/>`);
    }
    return barTop + barH;
  };

  row(12, `${currentName} · paying today`, baseline, "ch-bar-current", 0);

  const savedWidth = round(((baseline - recommended) / max) * width);
  const bottom = row(12 + barH + 34, `${bestName} · negotiated`, recommended, "ch-bar-best", savedWidth);

  parts.push(`<text class="ch-sub" x="0" y="${bottom + 20}">${escapeHtml(costLabel || "")}</text>`);
  if (Number.isFinite(savings) && savings > 0) {
    parts.push(`<text class="ch-value" x="${width}" y="${bottom + 20}" text-anchor="end" fill="#1a7f4b">${escapeHtml(money(savings))} saved</text>`);
  }

  return svg(width, 2 * barH + 80, "Current supplier spend compared with the recommended supplier", parts.join(""));
}

/* --------------------------------------------------------------------------
   Chart: negotiation progression
   Points are real persisted prices; the reference lines are the mission
   target and the current supplier price.
   -------------------------------------------------------------------------- */

function negotiationChart(width, options) {
  const { points, target, currentPrice } = options;
  if (!points.length) return "";

  // A price number line: gates above the axis, real negotiation points below.
  // Two meaningful prices do not justify a full line chart, and a shared axis
  // makes "how far below the current supplier are we" readable at a glance.
  const axisY = 80;
  const left = 16;
  const right = Math.max(left + 40, width - 16);
  const plotW = right - left;

  const values = [...points.map(point => point.value), target, currentPrice].filter(Number.isFinite);
  const lo = Math.min(...values);
  const hi = Math.max(...values);
  const padValue = Math.max(3, (hi - lo) * 0.16);
  const min = lo - padValue;
  const max = hi + padValue;
  const x = value => round(left + ((value - min) / (max - min)) * plotW);
  const textWidth = text => text.length * 6.1 + 8;

  const parts = [`<line class="ch-axis" x1="${left}" y1="${axisY}" x2="${right}" y2="${axisY}"/>`];

  const gateRows = [];
  const gate = (value, label, className) => {
    if (!Number.isFinite(value)) return;
    const px = x(value);
    const w = textWidth(label);
    const anchor = px + w / 2 > right ? "end" : px - w / 2 < left ? "start" : "middle";
    const tx = anchor === "end" ? px + 5 : anchor === "start" ? px - 5 : px;
    const x1 = anchor === "end" ? tx - w : anchor === "start" ? tx : tx - w / 2;
    let ty = 24;
    if (gateRows.some(box => box.ty === ty && x1 < box.x2 && x1 + w > box.x1)) ty = 42;
    gateRows.push({ x1, x2: x1 + w, ty });
    parts.push(`<line class="${className}" x1="${px}" y1="${ty + 7}" x2="${px}" y2="${axisY + 8}"/>`);
    parts.push(`<text class="ch-sub" x="${round(tx)}" y="${ty}" text-anchor="${anchor}">${escapeHtml(label)}</text>`);
  };
  gate(currentPrice, `Current ${money2(currentPrice)}`, "ch-line-current");
  gate(target, `Target ≤${money2(target)}`, "ch-line-target");

  const first = points[0].value;
  const latest = points[points.length - 1].value;
  if (points.length > 1 && first !== latest) {
    const x1 = x(first);
    const x2 = x(latest);
    const dir = x2 > x1 ? 1 : -1;
    const flowY = axisY - 22;
    parts.push(`<line class="ch-flow" x1="${x1}" y1="${flowY}" x2="${round(x2 - dir * 7)}" y2="${flowY}"/>`);
    parts.push(`<path class="ch-flow-head" d="M ${x2} ${flowY} L ${round(x2 - dir * 8)} ${flowY - 4.5} L ${round(x2 - dir * 8)} ${flowY + 4.5} Z"/>`);
    const delta = latest - first;
    parts.push(`<text class="ch-value ${delta < 0 ? "is-good" : ""}" x="${round((x1 + x2) / 2)}" y="${flowY - 9}" text-anchor="middle">${delta < 0 ? "−" : "+"}${escapeHtml(money2(Math.abs(delta)))}</text>`);
  }

  const labelRows = [];
  points.forEach((point, index) => {
    const px = x(point.value);
    const isLatest = index === points.length - 1;
    parts.push(`<circle class="ch-pt ${isLatest ? "ch-pt-offer" : "ch-pt-qualified"}" cx="${px}" cy="${axisY}" r="${isLatest ? 6 : 4.5}"/>`);

    const w = Math.max(textWidth(point.label), textWidth(money2(point.value)));
    const anchor = px + w / 2 > right ? "end" : px - w / 2 < left ? "start" : "middle";
    const tx = anchor === "end" ? Math.min(px + w / 2, right) : anchor === "start" ? Math.max(px - w / 2, 0) : px;
    const x1 = anchor === "end" ? tx - w : anchor === "start" ? tx : tx - w / 2;
    let row = 0;
    if (labelRows.some(box => box.row === 0 && x1 < box.x2 && x1 + w > box.x1)) row = 1;
    labelRows.push({ x1, x2: x1 + w, row });

    const top = axisY + 21 + row * 28;
    parts.push(`<text class="ch-value" x="${round(tx)}" y="${top}" text-anchor="${anchor}">${escapeHtml(money2(point.value))}</text>`);
    parts.push(`<text class="ch-sub" x="${round(tx)}" y="${top + 14}" text-anchor="${anchor}">${escapeHtml(point.label)}</text>`);
  });

  const deepestRow = labelRows.reduce((deepest, box) => Math.max(deepest, box.row), 0);
  return svg(width, axisY + 33 + deepestRow * 28, "Unit price across the negotiation", parts.join(""));
}

/* --------------------------------------------------------------------------
   Shared markup builders
   -------------------------------------------------------------------------- */

function workflowRail(context) {
  const values = workflowValues(context);
  const state = agentState(context);
  const status = context.mission.status;
  const reached = Math.min(context.progress, workflowStages.length - 1);

  const nodes = workflowStages.map((stage, index) => {
    let className;
    let icon = icons.check;
    if (index < reached) {
      className = "is-done";
    } else if (index === reached) {
      className = "is-current";
      if (status === "awaiting_approval") { className += " needs-human"; icon = icons.human; }
      else if (status === "rejected") { className += " is-stopped"; icon = icons.stop; }
      else if (status === "approved" || status === "completed") { icon = icons.check; className += " is-complete"; }
      else icon = icons.dot;
    } else {
      className = "is-todo";
      icon = "";
    }
    const value = values[stage.key];
    return `<li class="wf-node ${className}">
      <div class="wf-mark">${icon}</div>
      <b>${stage.name}</b>
      <span>${value ? escapeHtml(value) : "—"}</span>
    </li>`;
  }).join("");

  const settled = state.tone === "settled";
  return `<article class="panel workflow ${settled ? "is-settled" : ""}">
    <div class="workflow-top">
      <div class="workflow-now">
        <i class="beacon"></i>
        <b>${escapeHtml(state.text)}</b>
      </div>
      <span class="chip chip-plain">Stage ${Math.min(context.progress + 1, 7)} of 7</span>
    </div>
    <ol class="wf-track">${nodes}</ol>
  </article>`;
}

function missionHead(context, trailing = "") {
  const { mission: currentMission, component } = context;
  const constraints = currentMission.constraints;
  return `<div class="mission-head">
    <div>
      <h2>${escapeHtml(currentMission.title)}</h2>
      <div class="mission-context">
        <span>${escapeHtml(component?.name || currentMission.specification)}</span>
        <span>${number(currentMission.quantity)} units</span>
        <span>target ≤ ${money2(constraints.targetUnitPrice)}</span>
        <span>lead ≤ ${constraints.maxLeadTimeDays} days</span>
      </div>
    </div>
    ${trailing}
  </div>`;
}

function statusChip(status) {
  const tone = status === "awaiting_approval" ? "chip-info"
    : status === "rejected" ? "chip-crit"
      : status === "approved" || status === "completed" ? "chip-live"
        : "chip-plain";
  return `<span class="chip ${tone}"><i class="dot"></i> ${escapeHtml(stageNames[status] || status)}</span>`;
}

function deltaMarkup(from, to, format = money2) {
  if (!Number.isFinite(to)) return `<span class="num">${format(from)}</span>`;
  return `<span class="delta"><span class="from">${format(from)}</span><span class="arrow">→</span><span class="to">${format(to)}</span></span>`;
}

function providerChip(context) {
  const provider = context.mission.execution?.discoveryProvider || data.capabilities?.discoveryProvider || "unconfigured";
  if (provider === "trueforge-tools") return { text: "TrueForge live research", tone: "chip-live" };
  if (provider === "remote") return { text: "Live discovery provider", tone: "chip-live" };
  if (provider === "controlled-fixture") return { text: "Controlled demo evidence", tone: "chip-warn" };
  return { text: "Discovery provider not configured", tone: "chip-plain" };
}

function quoteDisplayCost(quote) {
  if (quote?.landedCost?.complete && Number.isFinite(quote.landedCost.base)) return { value: money(quote.landedCost.base), label: "Landed cost", complete: true };
  if (Number.isFinite(quote?.knownTotal?.base)) return { value: money(quote.knownTotal.base), label: "Known cost · shipping incomplete", complete: false };
  return { value: "—", label: "Cost incomplete", complete: false };
}

function scoreComponentLabel(key) {
  return ({ economics: "Economics", leadTime: "Lead time", supplierQuality: "Supplier", moq: "MOQ fit", sample: "Sample", completeness: "Evidence" })[key] || key;
}

function formatTime(value) {
  if (!value) return "";
  return new Date(value).toLocaleString([], { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
}

/* --------------------------------------------------------------------------
   Landing page
   -------------------------------------------------------------------------- */

function renderLanding() {
  const context = missionContext();
  const { mission: currentMission, candidates, qualified, winner, recommendation, approval } = context;
  const current = currentMission.currentSupplier;

  $("#landing-stats").innerHTML = [
    [`${number(candidates.length)}`, "suppliers found"],
    [`${number(qualified.length)}`, "qualified"],
    [moneyShort(data.summary.projectedSavings), "projected savings"],
    [`${number(data.summary.approvalsWaiting)}`, "awaiting approval"]
  ].map(([value, label]) => `<div><b class="num">${escapeHtml(value)}</b><span>${escapeHtml(label)}</span></div>`).join("");

  // The landing story: current supplier → agent works → human approves.
  const steps = [
    {
      className: "is-problem",
      title: "Current supplier",
      note: `${current.name} · ${number(currentMission.quantity)} units needed`,
      figure: `${money2(current.unitPrice)} / unit · ${days(current.leadTimeDays)}`
    },
    {
      className: "is-agent",
      title: "Vendor Scout searches the market",
      note: `${plural(candidates.length, "candidate")} discovered · ${qualified.length} passed qualification`,
      figure: candidates.length ? `${plural(candidates.length, "supplier")} screened on price, lead time and technical fit` : "Discovery has not run yet"
    },
    {
      className: "is-agent",
      title: "It negotiates the terms",
      note: winner ? `Best negotiated offer from ${winner.supplierName}` : "Awaiting supplier offers",
      figure: winner ? `${money2(winner.unitPrice?.base)} / unit · ${days(winner.leadTimeDays)}` : `Target ≤ ${money2(currentMission.constraints.targetUnitPrice)}`
    },
    {
      className: "is-human",
      title: "A human approves the commitment",
      note: approval?.status === "pending" ? "Decision waiting now" : recommendation ? `Recommendation: ${recommendation.supplierName}` : "No recommendation yet",
      figure: winner ? `${money(data.summary.projectedSavings)} saved · sample ${money2(winner.sample?.basePrice)}` : "Nothing commits without approval"
    }
  ];

  $("#landing-flow").innerHTML = steps.map(step => `<div class="flow-step ${step.className}">
    <div class="flow-mark"><i></i></div>
    <div class="flow-step-body">
      <b>${escapeHtml(step.title)}</b>
      <span>${escapeHtml(step.note)}</span>
      <div class="flow-figure">${escapeHtml(step.figure)}</div>
    </div>
  </div>`).join("");

  const values = workflowValues(context);
  $("#landing-stages").innerHTML = workflowStages.map(stage => `<div>
    <i></i>
    <b>${stage.name}</b>
    <span>${escapeHtml(values[stage.key] || "not reached yet")}</span>
  </div>`).join("");

  $("#landing-packet").innerHTML = `
    <header>
      <span class="label">Decision packet</span>
      ${statusChip(currentMission.status)}
    </header>
    <div class="packet-row">
      <div><b>${escapeHtml(current.name)}</b><span>Current supplier</span></div>
      <div class="packet-value">${money2(current.unitPrice)}<small>${days(current.leadTimeDays)}</small></div>
    </div>
    <div class="packet-row">
      <div><b>${escapeHtml(winner ? winner.supplierName : "Mission target")}</b><span>${winner ? "Negotiated offer" : "What the agent is aiming for"}</span></div>
      <div class="packet-value">${winner ? money2(winner.unitPrice?.base) : `≤ ${money2(currentMission.constraints.targetUnitPrice)}`}<small>${winner ? days(winner.leadTimeDays) : `≤ ${currentMission.constraints.maxLeadTimeDays} days`}</small></div>
    </div>
    <footer>
      <span class="chip chip-plain">Approve sample</span>
      <span class="chip chip-plain">Keep negotiating</span>
      <span class="chip chip-plain">Reject</span>
    </footer>`;

  $("#landing-build-state").textContent = stageNames[currentMission.status];
}

/* --------------------------------------------------------------------------
   Overview
   -------------------------------------------------------------------------- */

function renderOverview() {
  const context = missionContext();
  const { mission: currentMission, component, candidates, qualified, winner, recommendation, approval, order } = context;
  const current = currentMission.currentSupplier;
  const savings = winner?.economics?.estimatedLandedSavingsBase ?? winner?.economics?.savingsBeforeShippingBase;

  const banner = approval?.status === "pending" && recommendation
    ? `<div class="decision-banner">
        <div class="db-copy">
          <b>A decision is waiting for you</b>
          <span>${escapeHtml(recommendation.supplierName)} is recommended for ${number(currentMission.quantity)} units. Nothing has been committed.</span>
        </div>
        <div class="db-figs">
          <div><strong>${escapeHtml(moneyShort(savings))}</strong><small>projected savings</small></div>
          <div><strong>${escapeHtml(money2(winner?.unitPrice?.base))}</strong><small>per unit</small></div>
          <div><strong>${escapeHtml(String(winner?.leadTimeDays ?? "—"))}d</strong><small>lead time</small></div>
        </div>
        <button class="btn btn-accent" data-view="approvals">Review decision</button>
      </div>`
    : "";

  const stats = `<dl class="panel stat-row">
    <div>
      <dt>Projected savings</dt>
      <dd class="${savings ? "is-good" : ""}">${escapeHtml(money(data.summary.projectedSavings))}</dd>
      <span class="stat-sub">${winner ? `on ${number(currentMission.quantity)} units vs ${escapeHtml(current.name)}` : "no comparable offer yet"}</span>
    </div>
    <div>
      <dt>Unit price</dt>
      <dd>${deltaMarkup(current.unitPrice, winner?.unitPrice?.base)}</dd>
      <span class="stat-sub">${winner ? `target was ≤ ${money2(currentMission.constraints.targetUnitPrice)}` : `target ≤ ${money2(currentMission.constraints.targetUnitPrice)}`}</span>
    </div>
    <div>
      <dt>Lead time</dt>
      <dd>${deltaMarkup(current.leadTimeDays, winner?.leadTimeDays, value => `${number(value)}d`)}</dd>
      <span class="stat-sub">ceiling ${currentMission.constraints.maxLeadTimeDays} days</span>
    </div>
    <div>
      <dt>Needs you</dt>
      <dd class="${data.summary.approvalsWaiting ? "is-attention" : ""}">${number(data.summary.approvalsWaiting)}</dd>
      <span class="stat-sub">${data.summary.approvalsWaiting ? "human decision pending" : "no open decision"}</span>
    </div>
  </dl>`;

  const funnelStages = [
    { label: "Discovered", value: candidates.length },
    { label: "Qualified", value: qualified.length },
    { label: "RFQ threads", value: context.conversations.length },
    { label: "Offers received", value: context.offerThreads.length },
    { label: "Comparable quotes", value: context.rankable.length },
    { label: "Recommended", value: recommendation ? 1 : 0 }
  ];

  const activity = [...data.activity]
    .filter(item => item.missionId === currentMission.id)
    .sort((a, b) => new Date(b.at) - new Date(a.at));

  const timeline = activity.length
    ? activity.map(item => `<div class="tl-item" data-stage="${escapeHtml(item.stage)}">
        <div class="tl-mark"><i></i></div>
        <div class="tl-body">
          <b>${escapeHtml(item.title)}</b>
          <p>${escapeHtml(item.detail)}</p>
        </div>
        <div class="tl-meta">
          <span class="label">${escapeHtml(item.stage)}</span>
          <time>${escapeHtml(formatTime(item.at))}</time>
        </div>
      </div>`).join("")
    : '<div class="empty">No mission activity yet.</div>';

  // Why this mission exists — stated as facts, not a paragraph.
  const supplyFacts = component
    ? `<dl class="panel facts facts-4">
        <div><dt>Component</dt><dd>${escapeHtml(component.name)}<small>${escapeHtml(component.mpn)}</small></dd></div>
        <div><dt>Current suppliers</dt><dd>${number(component.supplierCount)}<small>no sourcing redundancy</small></dd></div>
        <div><dt>Inventory observed</dt><dd>${number(component.inventory)} units<small>was ${number(component.previousInventory)}</small></dd></div>
        <div><dt>Supply risk</dt><dd>${number(component.score)}/100<small>${escapeHtml(component.severity)}</small></dd></div>
      </dl>`
    : "";

  $("#view-overview").innerHTML = `
    ${missionHead(context)}
    ${banner}
    ${workflowRail(context)}
    <div class="section-head"><h2>Mission economics</h2></div>
    ${stats}
    <div class="section-head"><h2>The supplier market for this part</h2><span>${escapeHtml(plural(candidates.length, "candidate"))} · current supplier marked in red</span></div>
    <div class="chart-grid-2">
      <article class="panel chart-box">
        <div class="chart-head"><h3>Unit price vs lead time</h3></div>
        <p class="chart-note">Cheaper is lower, faster is further left. The shaded box is what this mission accepts.</p>
        ${chartSlot("chart-overview-scatter")}
        <div class="chart-legend">
          <span><i class="lg-current"></i> Current supplier</span>
          <span><i class="lg-offer"></i> Negotiated offer</span>
          <span><i class="lg-solid"></i> Qualified</span>
          <span><i class="lg-review"></i> Needs review</span>
          <span><i class="lg-rejected"></i> Rejected</span>
          <span><i class="lg-zone"></i> Meets target</span>
        </div>
      </article>
      <article class="panel chart-box">
        <div class="chart-head"><h3>Sourcing funnel</h3></div>
        <p class="chart-note">How many suppliers survived each stage.</p>
        ${chartSlot("chart-overview-funnel")}
      </article>
    </div>
    <div class="section-head"><h2>Why this mission exists</h2></div>
    ${supplyFacts}
    <div class="section-head"><h2>Agent activity</h2><span>${escapeHtml(plural(activity.length, "event"))}</span></div>
    <article class="panel"><div class="timeline">${timeline}</div></article>`;

  registerChart("chart-overview-scatter", width => priceLeadChart(width, context));
  // Matching the scatter height keeps the paired panels level.
  // Level with the scatter panel beside it; on mobile the funnel sizes itself.
  registerChart("chart-overview-funnel", width => funnelChart(width, funnelStages, width < 380 ? 0 : 300));
}

/* --------------------------------------------------------------------------
   Missions
   -------------------------------------------------------------------------- */

function renderMissions() {
  const context = missionContext();
  const { mission: currentMission, localActions } = context;
  const constraints = currentMission.constraints;
  const provider = providerChip(context);

  const missionTable = data.missions.length > 1
    ? `<div class="section-head"><h2>All missions</h2></div>
      <article class="panel"><div class="table-wrap"><table class="data">
        <thead><tr><th>Mission</th><th class="num">Units</th><th class="num">Price objective</th><th class="num">Lead objective</th><th>Stage</th></tr></thead>
        <tbody>${data.missions.map(item => `<tr>
          <td><span class="cell-name">${escapeHtml(item.title)}</span><span class="cell-sub">${escapeHtml(item.specification)}</span></td>
          <td class="num">${number(item.quantity)}</td>
          <td class="num">${money2(item.currentSupplier.unitPrice)} → ${money2(item.constraints.targetUnitPrice)}</td>
          <td class="num">${item.currentSupplier.leadTimeDays}d → ${item.constraints.maxLeadTimeDays}d</td>
          <td>${statusChip(item.status)}</td>
        </tr>`).join("")}</tbody>
      </table></div></article>`
    : "";

  const executionStatus = currentMission.execution?.fallbackUsed
    ? "This run used controlled fixture evidence. A configured provider or TrueForge research tool can replace it without changing the mission contract."
    : currentMission.execution?.discoveryProvider === "trueforge-tools"
      ? "Supplier research on this mission was recorded through TrueForge tools with provenance."
      : currentMission.execution?.discoveryProvider === "remote"
        ? "Discovery evidence came from the configured external provider."
        : "Ready to execute discovery through TrueForge research, the configured provider, or controlled local fallback.";

  const next = nextActionByStatus[currentMission.status];
  const controls = [];
  if (localActions && next) {
    controls.push(`<button class="btn btn-accent" id="mission-next-action" data-action="${escapeHtml(next.action)}"${actionPending ? " disabled" : ""}>${actionPending ? "Running…" : escapeHtml(next.label)}</button>`);
  }
  if (localActions && data.capabilities?.devResetEnabled) {
    controls.push(`<button class="btn btn-ghost" id="mission-replay"${actionPending ? " disabled" : ""}>Replay from draft</button>`);
  }

  $("#view-missions").innerHTML = `
    ${missionHead(context)}
    <p class="objective">${escapeHtml(currentMission.objective)}</p>
    <div class="section-head"><h2>What the agent is allowed to do</h2><span>enforced on every stage transition</span></div>
    <dl class="panel facts facts-6">
      <div><dt>Quantity</dt><dd>${number(currentMission.quantity)} units</dd></div>
      <div><dt>Target price</dt><dd>≤ ${money2(constraints.targetUnitPrice)}<small>per unit</small></dd></div>
      <div><dt>Lead time</dt><dd>≤ ${constraints.maxLeadTimeDays} days<small>production ready</small></dd></div>
      <div><dt>Sample budget</dt><dd>${money2(constraints.sampleBudget)}<small>max human-gated spend</small></dd></div>
      <div><dt>Min confidence</dt><dd>${percent(constraints.minimumConfidence)}<small>to qualify a supplier</small></dd></div>
      <div><dt>Regions</dt><dd>${escapeHtml(constraints.regions.join(", "))}</dd></div>
    </dl>
    <div class="section-head"><h2>Technical requirements</h2><span>carried through discovery and qualification</span></div>
    <div style="display:flex;flex-wrap:wrap;gap:8px">${constraints.requirements.map(item => `<span class="tag">${escapeHtml(item)}</span>`).join("")}</div>
    <div class="section-head"><h2>Current supplier</h2></div>
    <dl class="panel facts facts-4">
      <div><dt>Supplier</dt><dd>${escapeHtml(currentMission.currentSupplier.name)}</dd></div>
      <div><dt>Unit price</dt><dd>${money2(currentMission.currentSupplier.unitPrice)}</dd></div>
      <div><dt>Lead time</dt><dd>${days(currentMission.currentSupplier.leadTimeDays)}</dd></div>
      <div><dt>Baseline spend</dt><dd>${money(currentMission.currentSupplier.unitPrice * currentMission.quantity)}<small>unit cost only</small></dd></div>
    </dl>
    ${missionTable}
    <div class="section-head"><h2>Execution</h2></div>
    <article class="panel exec">
      <div class="exec-copy">
        <span class="chip ${provider.tone}"><i class="dot"></i> ${escapeHtml(provider.text)}</span>
        <h3 style="margin-top:10px">Sourcing flow</h3>
        <p>${escapeHtml(executionStatus)}</p>
      </div>
      <div class="exec-actions">${controls.join("")}</div>
    </article>
    <div id="trueforge-slot"></div>`;

  $("#mission-next-action")?.addEventListener("click", event => runMissionAction(event.currentTarget.dataset.action));
  $("#mission-replay")?.addEventListener("click", replayMission);
  renderTrueForge(context);
}

function renderTrueForge(context) {
  const slot = $("#trueforge-slot");
  if (!slot) return;

  const capability = data.capabilities?.trueForge || {};
  const connection = context.mission.trueForge;
  const lastTurn = connection?.lastTurn;
  const configured = Boolean(capability.configured);
  const connected = Boolean(connection?.sessionId);
  const requiredCount = lastTurn?.requiredActions?.length || 0;
  const localActions = context.localActions;

  const controls = [];
  if (localActions && configured && !connected) controls.push('<button class="btn btn-primary" data-agent-action="connect_trueforge">Connect session</button>');
  if (localActions && configured && connected && lastTurn?.status !== "running" && requiredCount === 0) controls.push('<button class="btn btn-primary" data-agent-action="start_trueforge_turn">Run turn</button>');
  if (connected && requiredCount > 0) controls.push('<span class="chip chip-crit"><i class="dot"></i> Resolve required action in TrueForge</span>');
  if (localActions && configured && connected && lastTurn?.id) controls.push('<button class="btn btn-ghost" data-agent-action="sync_trueforge_turn">Sync turn state</button>');

  const stateText = !configured
    ? "Not configured for this runtime. Set TRUEFORGE_BASE_URL and TRUEFORGE_AGENT_NAME to enable a real persistent agent session."
    : !connected
      ? `Configured at ${capability.endpoint} with agent ${capability.agentName}. No session has been created for this mission yet.`
      : `Session ${connection.sessionId} is connected to ${connection.agentName}.${lastTurn?.id ? ` Last turn ${lastTurn.id}: ${lastTurn.status}.` : " No turn has been started yet."}${requiredCount ? ` ${plural(requiredCount, "action")} require attention.` : ""}`;

  slot.innerHTML = `<div class="section-head"><h2>TrueForge orchestration</h2></div>
    <article class="panel exec exec-stack">
      <div style="display:flex;justify-content:space-between;gap:20px;align-items:center;flex-wrap:wrap">
        <div class="exec-copy">
          <span class="chip ${connected ? "chip-live" : configured ? "chip-warn" : "chip-plain"}"><i class="dot"></i> ${connected ? "Session connected" : configured ? "Configured" : "Not configured"}</span>
          <p style="margin-top:10px">${escapeHtml(stateText)}</p>
        </div>
        <div class="exec-actions">${controls.join("")}</div>
      </div>
      ${lastTurn?.content ? `<pre>${escapeHtml(lastTurn.content)}</pre>` : ""}
    </article>`;

  $$("[data-agent-action]").forEach(button => {
    if (button.tagName !== "BUTTON") return;
    button.disabled = actionPending;
    button.onclick = () => runMissionAction(button.dataset.agentAction);
  });
}

/* --------------------------------------------------------------------------
   Suppliers
   -------------------------------------------------------------------------- */

function renderSuppliers() {
  const context = missionContext();
  const { candidates, qualified, quotes } = context;

  if (!candidates.length) {
    $("#view-suppliers").innerHTML = `${missionHead(context)}<div class="empty">No suppliers have been discovered for this mission yet.</div>`;
    return;
  }

  const quoteBySupplier = new Map(quotes.map(quote => [quote.supplierId, quote]));
  const rejected = candidates.filter(item => item.status === "rejected");
  const review = candidates.filter(item => item.status === "needs_review");
  const screened = [...review, ...rejected];

  const checkOrder = ["region", "confidence", "specification", "leadTime", "moq", "commercialPlausibility"];
  const checkNames = {
    region: "Allowed region",
    confidence: "Source confidence",
    specification: "Technical fit",
    leadTime: "Lead time",
    moq: "Minimum order quantity",
    commercialPlausibility: "Commercial plausibility"
  };

  const rows = candidates.map(candidate => {
    const checks = candidate.qualification?.checks;
    const checkMarkup = checks
      ? `<span class="checks" title="${checkOrder.map(key => `${checkNames[key]}: ${checks[key] ? "pass" : "fail"}`).join(" · ")}">${checkOrder.map(key => `<i class="${checks[key] ? "" : "fail"}"></i>`).join("")}</span>`
      : '<span class="checks-legend">not run</span>';
    const quote = quoteBySupplier.get(candidate.id);
    const priceCell = quote && Number.isFinite(quote.unitPrice?.base)
      ? deltaMarkup(candidate.preliminaryUnitPrice, quote.unitPrice.base)
      : `<span class="num">${money2(candidate.preliminaryUnitPrice)}</span>`;

    return `<tr class="${candidate.status === "qualified" ? "" : "row-muted"}">
      <td>
        <span class="cell-name">${escapeHtml(candidate.name)}</span>
        <span class="cell-sub">${escapeHtml(candidate.type)} · ${escapeHtml(candidate.country)}</span>
      </td>
      <td class="num">${priceCell}</td>
      <td class="num narrow-hide">${number(candidate.moq)}</td>
      <td class="num">${number(candidate.leadTimeDays)}d</td>
      <td class="num narrow-hide">${percent(candidate.specMatch)}</td>
      <td class="num narrow-hide">${percent(candidate.confidence)}</td>
      <td class="narrow-hide">${checkMarkup}</td>
      <td><span class="decision-tag ${escapeHtml(candidate.status)}"><i></i>${escapeHtml(candidate.status.replaceAll("_", " "))}</span></td>
    </tr>`;
  }).join("");

  const screenedMarkup = screened.length
    ? `<div class="section-head"><h2>Why suppliers were screened out</h2><span>${escapeHtml(plural(screened.length, "supplier"))}</span></div>
      <article class="panel"><div class="screened">${screened.map(candidate => {
        const reasons = candidate.qualification?.hardFailures?.length
          ? candidate.qualification.hardFailures
          : candidate.qualification?.reviewFlags || [];
        return `<div class="screened-item ${candidate.status === "rejected" ? "is-rejected" : ""}">
          <div>
            <b>${escapeHtml(candidate.name)}</b>
            <span class="screened-sub">${escapeHtml(candidate.status.replaceAll("_", " "))} · ${escapeHtml(candidate.country)}</span>
          </div>
          <div class="screened-reasons">${reasons.length ? reasons.map(reason => `<span>${escapeHtml(reason)}</span>`).join("") : `<span>${escapeHtml(candidate.reason || "No recorded reason")}</span>`}</div>
        </div>`;
      }).join("")}</div></article>`
    : "";

  const sourceKinds = [...new Set(candidates.map(item => item.source?.kind).filter(Boolean))];

  $("#view-suppliers").innerHTML = `
    ${missionHead(context, `<span class="chip chip-plain">${escapeHtml(plural(candidates.length, "candidate"))} · ${qualified.length} qualified</span>`)}
    <article class="panel chart-box">
      <div class="chart-head"><h3>How every candidate compares with the current supplier</h3></div>
      <p class="chart-note">Lower is cheaper, further left is faster. The shaded box is the price and lead time this mission accepts. Dashed lines show where negotiation moved a supplier.</p>
      ${chartSlot("chart-suppliers-scatter")}
      <div class="chart-legend">
        <span><i class="lg-current"></i> Current supplier</span>
        <span><i class="lg-offer"></i> Negotiated offer</span>
        <span><i class="lg-solid"></i> Qualified</span>
        <span><i class="lg-review"></i> Needs review</span>
        <span><i class="lg-rejected"></i> Rejected</span>
        <span><i class="lg-zone"></i> Meets target</span>
      </div>
    </article>
    <div class="section-head"><h2>Candidates</h2><span class="narrow-hide">MOQ is the smallest order a supplier accepts</span></div>
    <article class="panel"><div class="table-wrap"><table class="data">
      <thead><tr>
        <th>Supplier</th>
        <th class="num">Unit price</th>
        <th class="num narrow-hide">MOQ</th>
        <th class="num">Lead</th>
        <th class="num narrow-hide">Spec match</th>
        <th class="num narrow-hide">Confidence</th>
        <th class="narrow-hide">Checks</th>
        <th>Decision</th>
      </tr></thead>
      <tbody>${rows}</tbody>
    </table></div>
    <div class="narrow-hide" style="padding:12px 14px;border-top:1px solid var(--line)"><span class="checks-legend">Checks, in order: ${checkOrder.map(key => checkNames[key]).join(" · ")}</span></div>
    </article>
    ${screenedMarkup}
    <div class="section-head"><h2>Evidence</h2></div>
    <dl class="panel facts facts-3">
      <div><dt>Discovery source</dt><dd>${escapeHtml(sourceKinds.join(", ") || "unknown")}</dd></div>
      <div><dt>Qualification</dt><dd>${escapeHtml(context.mission.execution?.qualificationMode || "not run")}<small>deterministic checks, no scoring guesswork</small></dd></div>
      <div><dt>Provenance</dt><dd>every candidate<small>keeps its source reference and contact origin</small></dd></div>
    </dl>`;

  registerChart("chart-suppliers-scatter", width => priceLeadChart(width, context));
}

/* --------------------------------------------------------------------------
   Conversations / negotiations
   -------------------------------------------------------------------------- */

function negotiationStatusLabel(status) {
  return {
    counter_required: "Counter required",
    needs_information: "Needs information",
    ready_for_comparison: "Ready to compare",
    reject_recommended: "Human review required"
  }[status] || String(status || "Not evaluated").replaceAll("_", " ");
}

function offerMoney(value, currency) {
  if (!Number.isFinite(value)) return '<span class="unknown">not stated</span>';
  return `${escapeHtml(currency || "USD")} ${Number(value).toFixed(2)}`;
}

function renderConversations() {
  const context = missionContext();
  const { mission: currentMission, candidates, qualified, conversations, localActions } = context;
  const bySupplier = new Map(conversations.map(conversation => [conversation.supplierId, conversation]));
  const outreachCapability = data.capabilities?.outreach || {};
  const realProvider = outreachCapability.provider === "remote";

  const outreachStatus = realProvider
    ? "External outreach provider configured. Delivery acceptance counts as real supplier contact."
    : outreachCapability.provider === "controlled-preview"
      ? "Controlled preview is enabled. RFQs render and persist, but no email is sent and supplier-contact metrics stay unchanged."
      : "No outreach transport is configured for this runtime.";

  const controls = [];
  if (localActions && ["contacting", "negotiating"].includes(currentMission.status)) {
    controls.push(`<button class="btn btn-ghost" data-outreach-action="prepare_outreach"${actionPending ? " disabled" : ""}>Prepare RFQs</button>`);
    controls.push(`<button class="btn btn-accent" data-outreach-action="send_outreach"${actionPending ? " disabled" : ""}>${realProvider ? "Send RFQs" : "Preview RFQs"}</button>`);
  }

  const threads = qualified.length
    ? qualified.map(candidate => renderThread(candidate, bySupplier.get(candidate.id), context)).join("")
    : '<div class="empty">No qualified supplier is ready for outreach yet.</div>';

  $("#view-conversations").innerHTML = `
    ${missionHead(context, `<span class="chip chip-plain">${escapeHtml(plural(conversations.length, "thread"))}</span>`)}
    <article class="panel exec">
      <div class="exec-copy">
        <span class="chip ${realProvider ? "chip-live" : outreachCapability.provider === "controlled-preview" ? "chip-warn" : "chip-plain"}"><i class="dot"></i> ${realProvider ? "Live outreach transport" : outreachCapability.provider === "controlled-preview" ? "Controlled outreach preview" : "Outreach not configured"}</span>
        <h3 style="margin-top:10px">Supplier outreach</h3>
        <p>${escapeHtml(outreachStatus)}</p>
      </div>
      <div class="exec-actions">${controls.join("")}</div>
    </article>
    <div class="section-head"><h2>Negotiation threads</h2><span>RFQ means a non-binding request for a quote</span></div>
    <div class="threads">${threads}</div>`;

  $$("[data-outreach-action]").forEach(button => {
    button.disabled = actionPending;
    button.onclick = () => runMissionAction(button.dataset.outreachAction);
  });

  // Register a progression chart per thread that has one.
  qualified.forEach(candidate => {
    const conversation = bySupplier.get(candidate.id);
    const points = negotiationPoints(candidate, conversation);
    if (points.length < 2) return;
    registerChart(`chart-negotiation-${candidate.id}`, width => negotiationChart(width, {
      points,
      target: currentMission.constraints.targetUnitPrice,
      currentPrice: currentMission.currentSupplier.unitPrice
    }));
  });
}

/* Real price points only: the discovery estimate, then each persisted offer. */
function negotiationPoints(candidate, conversation) {
  const points = [];
  if (Number.isFinite(candidate.preliminaryUnitPrice)) {
    points.push({ label: "Discovery estimate", value: candidate.preliminaryUnitPrice });
  }
  const offers = conversation?.negotiation?.offers || [];
  offers.forEach((offer, index) => {
    if (!Number.isFinite(offer.unitPrice)) return;
    points.push({ label: offers.length > 1 ? `Offer ${index + 1}` : "Supplier offer", value: offer.unitPrice });
  });
  return points;
}

function renderThread(candidate, conversation, context) {
  const contact = candidate.contact?.email || candidate.contactEmail || "No verified contact";

  if (!conversation) {
    return `<article class="panel thread">
      <div class="thread-head">
        <div>
          <h3>${escapeHtml(candidate.name)}</h3>
          <p class="thread-to">${escapeHtml(contact)}</p>
        </div>
        <span class="chip chip-plain">Not prepared</span>
      </div>
      <div class="messages"><p class="msg-text">Qualified for outreach. No RFQ thread has been prepared yet.</p></div>
    </article>`;
  }

  const state = conversationStates[conversation.status] || { label: conversation.status.replaceAll("_", " "), tone: "chip-plain" };
  const negotiation = conversation.negotiation || null;
  const offer = negotiation?.offers?.at(-1) || null;
  const evaluation = negotiation?.latestEvaluation || null;
  const outbound = outboundMessage(conversation);
  const messages = [...(conversation.messages || [])];

  const messageMarkup = messages.map(message => {
    const inbound = message.direction === "inbound";
    const kind = message.type === "rfq" ? "RFQ sent"
      : message.type === "counter" ? `Counter · round ${number(message.negotiationRound)}`
        : inbound ? "Supplier reply" : String(message.type || "message").replaceAll("_", " ");
    const delivery = message.delivery || {};
    const deliveryNote = inbound
      ? ""
      : delivery.provider === "controlled-preview"
        ? "controlled preview · no email sent"
        : delivery.provider === "remote-outreach"
          ? `${delivery.status || "sent"}${delivery.externalMessageId ? ` · ${delivery.externalMessageId}` : ""}`
          : delivery.error || "not delivered yet";

    const preview = String(message.content || "").trim();
    const short = preview.length > 220 ? `${preview.slice(0, 217)}…` : preview;

    return `<div class="msg ${inbound ? "inbound" : "outbound"}">
      <div class="msg-mark"><i></i></div>
      <div class="msg-body">
        <div class="msg-top">
          <b>${escapeHtml(inbound ? conversation.supplierName || candidate.name : "Vendor Scout")}</b>
          <span class="chip chip-plain">${escapeHtml(kind)}</span>
          <time>${escapeHtml(formatTime(message.createdAt || message.at))}</time>
        </div>
        ${short ? `<p class="msg-text">${escapeHtml(short)}</p>` : ""}
        ${preview.length > 220 || message.subject ? `<details><summary>${escapeHtml(message.subject ? "View full message" : "View full text")}</summary><pre>${escapeHtml(message.subject ? `${message.subject}\n\n${message.content}` : message.content)}</pre></details>` : ""}
        ${deliveryNote ? `<p class="msg-src">Delivery: ${escapeHtml(deliveryNote)}</p>` : ""}
        ${message.sourceReference ? `<p class="msg-src">Source: ${escapeHtml(message.sourceReference)}</p>` : ""}
      </div>
    </div>`;
  }).join("");

  const points = negotiationPoints(candidate, conversation);
  const chartMarkup = points.length >= 2
    ? `<div class="chart-box" style="padding-top:16px;border-bottom:1px solid var(--line)">
        <div class="chart-head"><h3>Price across the negotiation</h3></div>
        ${chartSlot(`chart-negotiation-${candidate.id}`)}
      </div>`
    : "";

  const termsMarkup = offer
    ? `<dl class="terms">
        <div><dt>Unit price</dt><dd>${offerMoney(offer.unitPrice, offer.currency)}<small>${Number.isFinite(offer.unitPrice) ? `${money2(offer.unitPrice * context.mission.quantity)} for ${number(context.mission.quantity)}` : "quoted price"}</small></dd></div>
        <div><dt>MOQ</dt><dd>${number(offer.moq)}<small>minimum order</small></dd></div>
        <div><dt>Lead time</dt><dd>${Number.isFinite(offer.leadTimeDays) ? `${number(offer.leadTimeDays)}d` : '<span class="unknown">not stated</span>'}<small>ceiling ${context.mission.constraints.maxLeadTimeDays}d</small></dd></div>
        <div><dt>Shipping</dt><dd>${escapeHtml(offer.shippingTerms || "—")}<small>${Number.isFinite(offer.shippingCost) ? money(offer.shippingCost) : "cost not stated"}</small></dd></div>
        <div><dt>Sample</dt><dd>${offer.sampleAvailable == null ? '<span class="unknown">unknown</span>' : offer.sampleAvailable ? offerMoney(offer.samplePrice, offer.currency) : "not available"}<small>budget ${money2(context.mission.constraints.sampleBudget)}</small></dd></div>
        <div><dt>Technical fit</dt><dd>${offer.technicalConfirmed == null ? '<span class="unknown">unverified</span>' : offer.technicalConfirmed ? "confirmed" : "not confirmed"}<small>against mission spec</small></dd></div>
      </dl>`
    : "";

  const gapsMarkup = evaluation
    ? `<div class="gaps">
        ${evaluation.gaps.length
          ? evaluation.gaps.map(gap => `<div><b>${escapeHtml(gap.field)}</b>${escapeHtml(gap.reason)}</div>`).join("")
          : `<div class="${evaluation.status === "ready_for_comparison" ? "clear" : ""}"><b>${escapeHtml(negotiationStatusLabel(evaluation.status))}</b>No unresolved constraint gap on the persisted terms. Vendor Scout has not accepted them.</div>`}
        ${evaluation.missingFields.length ? `<div><b>Missing evidence</b>${escapeHtml(evaluation.missingFields.join(" · "))}</div>` : ""}
      </div>`
    : "";

  const contactSource = outbound?.contactSourceReference || candidate.contact?.sourceReference || candidate.source?.reference;

  return `<article class="panel thread">
    <div class="thread-head">
      <div>
        <h3>${escapeHtml(conversation.supplierName || candidate.name)}</h3>
        <p class="thread-to">${escapeHtml(outbound?.to || contact)}</p>
      </div>
      <span class="chip ${state.tone}"><i class="dot"></i> ${escapeHtml(state.label)}</span>
    </div>
    ${chartMarkup}
    ${termsMarkup}
    <div class="messages">${messageMarkup || '<p class="msg-text">No messages recorded yet.</p>'}</div>
    ${gapsMarkup}
    ${contactSource ? `<p class="provenance" style="margin:0;padding:12px 20px">Contact evidence: ${escapeHtml(contactSource)}</p>` : ""}
  </article>`;
}

/* --------------------------------------------------------------------------
   Approvals — the decision comes first
   -------------------------------------------------------------------------- */

function renderApprovals() {
  const view = $("#view-approvals");
  const context = missionContext();
  if (!view || !context.mission) return;

  const { mission: currentMission, quotes, recommendation, approval, order, winner, localActions } = context;
  const current = currentMission.currentSupplier;
  const baseline = current.unitPrice * currentMission.quantity;
  const savings = winner?.economics?.estimatedLandedSavingsBase ?? winner?.economics?.savingsBeforeShippingBase;
  const savingsPercent = winner?.economics?.estimatedLandedSavingsPercent ?? winner?.economics?.savingsPercentBeforeShipping;
  const cost = quoteDisplayCost(winner);
  const displayQuotes = [...quotes].sort((a, b) => (a.rank ?? Number.MAX_SAFE_INTEGER) - (b.rank ?? Number.MAX_SAFE_INTEGER));
  const comparisonReady = ["negotiating", "comparing"].includes(currentMission.status) && Boolean(currentMission.execution?.negotiationReady);

  view.innerHTML = `
    ${missionHead(context)}
    ${decisionBlock(context, { baseline, savings, savingsPercent, cost, comparisonReady, localActions })}
    ${winner && Number.isFinite(savings) ? savingsSection() : ""}
    ${displayQuotes.length ? comparisonSection(context, displayQuotes) : ""}
    ${recommendation ? evidenceSection(recommendation) : ""}
    ${displayQuotes.length ? offersSection(context, displayQuotes) : `<div class="section-head"><h2>Supplier offers</h2></div><div class="empty">No normalized quotes yet. The comparison appears here once negotiation produces a comparison-ready offer.</div>`}`;

  if (winner && Number.isFinite(savings)) {
    registerChart("chart-savings", width => savingsChart(width, {
      baseline,
      recommended: winner.landedCost?.complete ? winner.landedCost.base : winner.knownTotal?.base,
      savings,
      currentName: current.name,
      bestName: winner.supplierName,
      costLabel: `${number(currentMission.quantity)} units · ${winner.landedCost?.complete ? "complete landed cost incl. shipping" : "known cost, shipping incomplete"}`
    }));
  }

  $("#run-quote-analysis")?.addEventListener("click", runQuoteAnalysis);
  $$("[data-approval-decision]").forEach(button => {
    button.disabled = actionPending;
    button.onclick = () => runApprovalDecision(button.dataset.approvalDecision);
  });
}

function decisionBlock(context, options) {
  const { mission: currentMission, recommendation, approval, order, winner, localActions } = context;
  const { baseline, savings, savingsPercent, cost, comparisonReady } = options;
  const current = currentMission.currentSupplier;

  if (!recommendation || !winner) {
    return `<article class="panel state-card">
      <span class="chip chip-plain"><i class="dot"></i> Analysis pending</span>
      <div class="state-body">
        <h3>No recommendation yet</h3>
        <p>Negotiation evidence has to be normalized and compared before a human decision exists.</p>
        ${localActions && comparisonReady ? '<button class="btn btn-accent" id="run-quote-analysis" style="margin-top:14px">Run quote comparison</button>' : ""}
      </div>
    </article>`;
  }

  const canApproveSample = approval?.action?.kind === "order_sample" && approval?.action?.withinBudget === true;
  const samplePrice = winner.sample?.basePrice;

  const figures = `<dl class="decide-figs">
    <div>
      <dt>Unit price</dt>
      <dd>${deltaMarkup(current.unitPrice, winner.unitPrice?.base)}</dd>
      <small>target was ≤ ${money2(currentMission.constraints.targetUnitPrice)}</small>
    </div>
    <div>
      <dt>Lead time</dt>
      <dd>${deltaMarkup(current.leadTimeDays, winner.leadTimeDays, value => `${number(value)}d`)}</dd>
      <small>ceiling ${currentMission.constraints.maxLeadTimeDays} days</small>
    </div>
    <div>
      <dt>Projected savings</dt>
      <dd class="decide-emphasis">${escapeHtml(money(savings))}</dd>
      <small>${Number.isFinite(savingsPercent) ? `${savingsPercent.toFixed(1)}% of ${money(baseline)}` : `on ${number(currentMission.quantity)} units`}</small>
    </div>
    <div>
      <dt>Sample to approve</dt>
      <dd class="num">${winner.sample?.available === true ? money2(samplePrice) : "—"}</dd>
      <small>${winner.sample?.available === true ? `1 unit · budget ${money2(currentMission.constraints.sampleBudget)}` : "no sample offered"}</small>
    </div>
  </dl>`;

  const scoreBlock = `<div class="decide-score">
    <strong>${Number.isFinite(recommendation.score) ? recommendation.score.toFixed(1) : "—"}</strong>
    <span>decision score / 100</span>
  </div>`;

  // Pending decision: the three human actions sit immediately under the numbers.
  if (approval?.status === "pending") {
    const actions = localActions
      ? `<div class="decide-actions">
          ${canApproveSample ? `<button class="btn btn-lg btn-accent" data-approval-decision="approve">Approve sample · ${escapeHtml(money2(samplePrice))}</button>` : ""}
          <button class="btn btn-lg btn-ghost" data-approval-decision="negotiate_more">Send back to negotiate</button>
          <button class="btn btn-lg btn-danger" data-approval-decision="reject">Reject</button>
        </div>
        <p class="decide-guard">
          ${canApproveSample
            ? `<b>Approving buys one ${escapeHtml(money2(samplePrice))} evaluation sample.</b> It does not place the ${escapeHtml(money(winner.landedCost?.base))} production order or accept ${escapeHtml(winner.supplierName)}'s terms.`
            : "<b>No orderable in-budget sample is available.</b> Vendor Scout will not allow an approval without an executable action, so only negotiating further or rejecting is possible."}
          Sending it back re-opens negotiation against the mission target of ≤ ${escapeHtml(money2(currentMission.constraints.targetUnitPrice))} per unit.
        </p>`
      : `<p class="decide-guard"><b>Decisions are recorded through the agent API in this runtime.</b> The three human options are approve the sample, send the mission back to negotiation, or reject the recommendation.</p>`;

    return `<article class="decide">
      <div class="decide-top">
        <div>
          <span class="chip chip-info"><i class="dot"></i> Human decision required</span>
          <h2 style="margin-top:12px">${escapeHtml(recommendation.supplierName)} is the <em>recommended supplier</em></h2>
          <p class="decide-why">${escapeHtml(recommendation.status === "provisional"
            ? "Provisional recommendation — some cost evidence is still incomplete."
            : `Best evidence across price, lead time, supplier quality and completeness. ${cost.label} is ${cost.value}.`)}</p>
        </div>
        ${scoreBlock}
      </div>
      ${figures}
      ${actions}
    </article>`;
  }

  // Decision already recorded: show the outcome, keep the numbers visible.
  const outcome = order
    ? {
        className: order.simulated ? "state-card" : "state-card state-completed",
        chip: order.simulated ? '<span class="chip chip-warn"><i class="dot"></i> Controlled sample action</span>' : '<span class="chip chip-live"><i class="dot"></i> Sample order submitted</span>',
        title: `${order.supplierName} · ${plural(order.quantity, "sample unit")}`,
        body: order.simulated
          ? "The approved-action path executed end to end, but the final order provider was intentionally simulated. No external spend occurred."
          : `External order ${escapeHtml(order.externalOrderId || "submitted")} was accepted by the configured provider.`,
        facts: `<dl class="panel facts facts-3" style="margin-top:16px">
          <div><dt>Total</dt><dd>${money2(order.totalBase)}</dd></div>
          <div><dt>Provider</dt><dd>${escapeHtml(order.provider || "—")}</dd></div>
          <div><dt>Status</dt><dd>${escapeHtml(order.status)}</dd></div>
        </dl>`
      }
    : approval?.status === "approved"
      ? {
          className: "state-card state-approved",
          chip: '<span class="chip chip-warn"><i class="dot"></i> Business approval recorded</span>',
          title: "Approved — execution is still gated",
          body: "The sample action is authorized in Vendor Scout but has not executed. The next TrueForge turn may call <code>vendor_scout_execute_sample_order</code>; that tool is destructive and pauses for tool approval immediately before execution."
        }
      : approval?.status === "returned_to_negotiation"
        ? {
            className: "state-card",
            chip: '<span class="chip chip-plain"><i class="dot"></i> Sent back to negotiation</span>',
            title: "Vendor Scout is negotiating again",
            body: `The recommendation was not accepted and no commitment was made. The agent is working the mission target of ≤ ${escapeHtml(money2(currentMission.constraints.targetUnitPrice))} per unit.`
          }
        : approval?.status === "rejected"
          ? {
              className: "state-card state-rejected",
              chip: '<span class="chip chip-crit"><i class="dot"></i> Rejected</span>',
              title: "No action executed",
              body: "The recommendation was rejected. No commercial terms were accepted and no sample order was placed."
            }
          : {
              className: "state-card",
              chip: '<span class="chip chip-plain"><i class="dot"></i> Decision recorded</span>',
              title: String(approval?.status || currentMission.status).replaceAll("_", " "),
              body: ""
            };

  return `<article class="decide">
      <div class="decide-top">
        <div>
          ${outcome.chip}
          <h2 style="margin-top:12px">${escapeHtml(recommendation.supplierName)} is the <em>recommended supplier</em></h2>
          <p class="decide-why">${escapeHtml(`${cost.label} is ${cost.value} for ${number(currentMission.quantity)} units.`)}</p>
        </div>
        ${scoreBlock}
      </div>
      ${figures}
    </article>
    <article class="${outcome.className}">
      <div class="state-body">
        <h3>${escapeHtml(outcome.title)}</h3>
        <p>${outcome.body}</p>
        ${outcome.facts || ""}
      </div>
    </article>`;
}

function savingsSection() {
  return `<div class="section-head"><h2>What this saves</h2></div>
    <article class="panel chart-box">
      ${chartSlot("chart-savings")}
    </article>`;
}

/* Head-to-head table: the fastest way to compare offers against today's cost. */
function comparisonSection(context, displayQuotes) {
  const { mission: currentMission, recommendation } = context;
  const current = currentMission.currentSupplier;
  const baseline = current.unitPrice * currentMission.quantity;

  const columns = displayQuotes.map(quote => ({
    quote,
    winner: recommendation?.quoteId === quote.id
  }));

  const header = `<tr>
    <th>Term</th>
    <th class="num entity">${escapeHtml(current.name)}<span class="cell-sub">current supplier</span></th>
    ${columns.map(column => `<th class="num entity">${escapeHtml(column.quote.supplierName)}<span class="cell-sub">${column.winner ? "recommended" : `rank ${column.quote.rank ?? "—"}`}</span></th>`).join("")}
  </tr>`;

  const rows = [
    ["Unit price", money2(current.unitPrice), column => money2(column.quote.unitPrice?.base)],
    ["Lead time", days(current.leadTimeDays), column => days(column.quote.leadTimeDays)],
    ["Total for this order", `${money(baseline)}`, column => quoteDisplayCost(column.quote).value],
    ["Minimum order", "—", column => number(column.quote.moq)],
    ["Shipping terms", "—", column => escapeHtml(column.quote.shipping?.terms || "not stated")],
    ["Supplier risk", "—", column => Number.isFinite(column.quote.supplierRiskScore) ? `${column.quote.supplierRiskScore}/100` : "—"],
    ["Evaluation sample", "—", column => column.quote.sample?.available === true ? money2(column.quote.sample.basePrice) : column.quote.sample?.available === false ? "unavailable" : "unknown"],
    ["Decision score", "—", column => Number.isFinite(column.quote.score?.total) ? column.quote.score.total.toFixed(1) : "—"]
  ].map(([label, currentValue, render]) => `<tr>
    <td>${escapeHtml(label)}</td>
    <td class="num">${currentValue}</td>
    ${columns.map(column => `<td class="num">${render(column)}</td>`).join("")}
  </tr>`).join("");

  return `<div class="section-head"><h2>Head to head</h2><span>${escapeHtml(plural(displayQuotes.length, "negotiated offer"))} vs the current supplier</span></div>
    <article class="panel"><div class="table-wrap"><table class="data">
      <thead>${header}</thead>
      <tbody>${rows}</tbody>
    </table></div>
    <p class="provenance" style="padding:12px 14px">Current supplier total is a unit-cost baseline (${number(currentMission.quantity)} × ${money2(current.unitPrice)}); it excludes shipping, which is why savings are reported against landed cost.</p>
    </article>`;
}

function evidenceSection(recommendation) {
  const reasons = recommendation.reasons?.length
    ? `<ul>${recommendation.reasons.map(reason => `<li>${escapeHtml(reason)}</li>`).join("")}</ul>`
    : "<p class=\"msg-text\">No reasons recorded.</p>";
  const risks = recommendation.risks?.length
    ? `<div class="risk-list">${recommendation.risks.map(risk => `<span>${escapeHtml(risk)}</span>`).join("")}</div>`
    : '<div class="risk-list clear"><span>No unresolved risk flag on this recommendation.</span></div>';

  return `<div class="section-head"><h2>Why this offer won</h2></div>
    <article class="panel"><div class="reasons">
      <div>${reasons}</div>
      <div><h3>Watchouts</h3>${risks}</div>
    </div></article>`;
}

function offersSection(context, displayQuotes) {
  const { recommendation } = context;
  const cards = displayQuotes.map(quote => {
    const cost = quoteDisplayCost(quote);
    const selected = recommendation?.quoteId === quote.id;
    const components = quote.score?.components || {};

    return `<article class="offer ${selected ? "is-winner" : ""}">
      <div class="offer-top">
        <div class="offer-id">
          <span class="offer-rank">${Number.isInteger(quote.rank) ? quote.rank : "—"}</span>
          <div>
            <h3>${escapeHtml(quote.supplierName)}</h3>
            ${selected ? '<span class="chip chip-info" style="margin-top:4px">Recommended</span>' : ""}
          </div>
        </div>
        <div class="offer-cost">
          <strong>${escapeHtml(cost.value)}</strong>
          <span>${escapeHtml(cost.label)}</span>
        </div>
      </div>
      <dl class="facts facts-4">
        <div><dt>Unit</dt><dd>${money2(quote.unitPrice?.base)}</dd></div>
        <div><dt>Lead</dt><dd>${days(quote.leadTimeDays)}</dd></div>
        <div><dt>MOQ</dt><dd>${number(quote.moq)}</dd></div>
        <div><dt>Sample</dt><dd>${quote.sample?.available === true ? money2(quote.sample.basePrice) : quote.sample?.available === false ? "none" : "unknown"}</dd></div>
      </dl>
      <dl class="score-bars">
        ${Object.entries(components).map(([key, value]) => {
          const width = Math.max(0, Math.min(100, Number(value) || 0));
          return `<div>
            <dt>${escapeHtml(scoreComponentLabel(key))}</dt>
            <div class="sb-track"><i class="sb-fill" style="width:${width}%"></i></div>
            <dd>${Number.isFinite(value) ? Number(value).toFixed(0) : "—"}</dd>
          </div>`;
        }).join("")}
      </dl>
      ${quote.comparison?.rankable === false ? '<div class="note-warn">Not rankable: landed cost is incomplete while a complete comparison exists.</div>' : ""}
      ${quote.completeness?.missing?.length ? `<div class="note-warn">Missing evidence: ${escapeHtml(quote.completeness.missing.join(" · "))}</div>` : ""}
      <p class="provenance">Offer evidence: ${escapeHtml(quote.sourceReference || "unknown")}</p>
    </article>`;
  }).join("");

  return `<div class="section-head"><h2>Scored offers</h2><span>weighted on economics, lead time, supplier quality, MOQ, sample and evidence completeness</span></div>
    <div class="offers">${cards}</div>`;
}

/* --------------------------------------------------------------------------
   Actions
   -------------------------------------------------------------------------- */

async function runQuoteAnalysis() {
  if (actionPending) return;
  actionPending = true;
  try {
    const snapshot = await api(`/api/missions/${encodeURIComponent(mission().id)}/analysis`, {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ fxRates: [] })
    });
    data = await api("/api/dashboard");
    render();
    toast(snapshot.recommendations?.length ? "Quote comparison complete" : "Comparison needs more evidence");
  } catch (error) {
    showWorkspaceError(error.message);
    toast(error.message);
  } finally {
    actionPending = false;
  }
}

async function runApprovalDecision(decision) {
  if (!decision || actionPending) return;
  actionPending = true;
  try {
    await api(`/api/missions/${encodeURIComponent(mission().id)}/approval`, {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ decision })
    });
    data = await api("/api/dashboard");
    render();
    toast(decision === "approve" ? "Sample action approved" : decision === "negotiate_more" ? "Sent back to negotiation" : "Recommendation rejected");
  } catch (error) {
    showWorkspaceError(error.message);
    toast(error.message);
  } finally {
    actionPending = false;
  }
}

async function runMissionAction(action) {
  if (!action || actionPending) return;
  actionPending = true;
  render();
  try {
    const result = await api(`/api/missions/${encodeURIComponent(mission().id)}/actions`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action })
    });
    data = result.dashboard;
    render();
    toast(action.replaceAll("_", " "));
  } catch (error) {
    showWorkspaceError(error.message);
    toast(error.message);
  } finally {
    actionPending = false;
    render();
  }
}

async function replayMission() {
  if (actionPending) return;
  actionPending = true;
  render();
  try {
    data = await api("/api/dev/reset", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ stage: "draft" })
    });
    selectedMissionId = data.missions[0]?.id;
    render();
    toast("Mission reset to draft for replay");
  } catch (error) {
    showWorkspaceError(error.message);
    toast(error.message);
  } finally {
    actionPending = false;
    render();
  }
}

/* --------------------------------------------------------------------------
   Render + routing
   -------------------------------------------------------------------------- */

function renderRail(context) {
  const state = agentState(context);
  const railAgent = $("#rail-agent");
  railAgent.className = `rail-agent is-${state.tone === "working" ? "working" : state.tone}`;
  $("#rail-agent-state").textContent = state.text;
  $("#workspace-org").textContent = data.organization.name;

  const modeChip = $("#workspace-mode");
  modeChip.className = `chip ${state.tone === "waiting" ? "chip-info" : state.tone === "settled" ? "chip-live" : "chip-plain"}`;
  modeChip.querySelector("span").textContent = stageNames[context.mission.status] || context.mission.status;

  const counts = {
    "nav-count-suppliers": context.candidates.length,
    "nav-count-conversations": context.conversations.length,
    "nav-count-approvals": data.summary.approvalsWaiting
  };
  for (const [id, value] of Object.entries(counts)) {
    const element = document.getElementById(id);
    if (!element) continue;
    element.textContent = value;
    element.dataset.empty = value ? "false" : "true";
  }
}

function render() {
  if (!data?.missions?.length) {
    showWorkspaceError("No sourcing missions are available.");
    return;
  }
  showWorkspaceError("");
  if (!selectedMissionId || !data.missions.some(item => item.id === selectedMissionId)) selectedMissionId = data.missions[0].id;

  chartRegistry.clear();
  const context = missionContext();

  renderLanding();
  renderRail(context);
  renderOverview();
  renderMissions();
  renderSuppliers();
  renderConversations();
  renderApprovals();
  drawCharts();
}

function navigate(view) {
  const target = $(`#view-${view}`);
  const nav = $(`.nav-item[data-view='${view}']`);
  if (!target || !nav) return;
  $$(".view,.nav-item").forEach(element => element.classList.remove("active"));
  target.classList.add("active");
  nav.classList.add("active");
  $("#page-title").textContent = pageTitles[view];
  window.scrollTo(0, 0);
  drawCharts();
}

function hashView() {
  if (!location.hash.startsWith("#app")) return null;
  const view = location.hash.split("/")[1] || "overview";
  return appViews.has(view) ? view : "overview";
}

function openView(view = "overview") {
  const safeView = appViews.has(view) ? view : "overview";
  const hash = safeView === "overview" ? "#app" : `#app/${safeView}`;
  if (location.hash !== hash) history.pushState(null, "", hash);
  showApp(safeView);
}

function showApp(view = "overview") {
  $("#landing").hidden = true;
  $("#app-shell").hidden = false;
  render();
  navigate(view);
}

function showLanding() {
  $("#landing").hidden = false;
  $("#app-shell").hidden = true;
  window.scrollTo(0, 0);
}

/* Delegated so re-rendered markup keeps working. */
document.addEventListener("click", event => {
  const viewButton = event.target.closest("[data-view]");
  if (viewButton) { openView(viewButton.dataset.view); return; }
  const openButton = event.target.closest("[data-open-view]");
  if (openButton) { openView(openButton.dataset.openView); return; }
  if (event.target.closest(".enter-app")) { openView("overview"); return; }
  if (event.target.closest(".back-home")) {
    history.pushState(null, "", "#home");
    showLanding();
  }
});

$("#mobile-menu").onclick = () => {
  const open = $("#mobile-links").classList.toggle("open");
  $("#mobile-menu").setAttribute("aria-expanded", String(open));
};

window.addEventListener("hashchange", () => {
  const view = hashView();
  if (view) showApp(view);
  else if (location.hash === "#home") showLanding();
});

window.addEventListener("resize", () => {
  clearTimeout(resizeTimer);
  resizeTimer = setTimeout(() => {
    // Force a re-measure on every registered slot.
    for (const id of chartRegistry.keys()) {
      const element = document.getElementById(id);
      if (element) delete element.dataset.width;
    }
    drawCharts();
  }, 160);
});

api("/api/dashboard").then(value => {
  data = value;
  render();
  const view = hashView();
  if (view) showApp(view);
}).catch(error => {
  showWorkspaceError(error.message);
  toast(error.message);
});
