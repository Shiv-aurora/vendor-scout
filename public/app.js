let data;
let selectedMissionId;
let actionPending = false;

const $ = selector => document.querySelector(selector);
const $$ = selector => [...document.querySelectorAll(selector)];
const escapeHtml = value => String(value ?? "").replace(/[&<>"']/g, character => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[character]);
const number = value => Number.isFinite(value) ? new Intl.NumberFormat("en-US").format(value) : "—";
const money = value => Number.isFinite(value) ? new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(value) : "—";
const money2 = value => Number.isFinite(value) ? new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", minimumFractionDigits: 2 }).format(value) : "—";
const days = value => Number.isFinite(value) ? `${number(value)} days` : "—";
const appViews = new Set(["overview", "missions", "suppliers", "conversations", "approvals"]);

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
  rfq_draft: { label: "RFQ draft", tone: "fixture" },
  sending: { label: "Sending", tone: "fixture" },
  previewed: { label: "Controlled preview — no email sent", tone: "fixture" },
  rfq_sent: { label: "RFQ sent", tone: "live" },
  delivery_failed: { label: "Delivery failed", tone: "critical" },
  missing_contact: { label: "Missing contact", tone: "critical" },
  supplier_replied: { label: "Supplier replied", tone: "live" },
  negotiating: { label: "Negotiating", tone: "live" }
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

function qualificationClass(status) {
  if (status === "qualified") return "low";
  if (status === "rejected") return "critical";
  if (status === "needs_review") return "high";
  return "medium";
}

function providerLabel(currentMission) {
  const provider = currentMission.execution?.discoveryProvider || data.capabilities?.discoveryProvider || "unconfigured";
  if (provider === "trueforge-tools") return { text: "TrueForge live research", className: "live" };
  if (provider === "remote") return { text: "Live discovery provider", className: "live" };
  if (provider === "controlled-fixture") return { text: "Controlled demo fallback", className: "fixture" };
  return { text: "Discovery provider not configured", className: "" };
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

function renderLanding() {
  const active = data.summary.activeMissions;
  $("#landing-mission-count").textContent = `${active} active mission${active === 1 ? "" : "s"}`;
  $("#landing-supplier-count").textContent = `${data.summary.suppliersDiscovered} suppliers discovered`;
  $("#landing-qualified-count").textContent = `${data.summary.suppliersQualified} qualified`;
  $("#landing-savings").textContent = `${money(data.summary.projectedSavings)} projected savings`;
  const currentMission = mission();
  $("#landing-build-state").textContent = `Current demo: ${stageNames[currentMission.status]}`;
}

function renderOverview() {
  const currentMission = mission();
  const component = componentFor(currentMission);
  const progress = progressFor(currentMission.status);
  const qualified = data.supplierCandidates.filter(candidate => candidate.missionId === currentMission.id && candidate.status === "qualified");
  const best = [...qualified].sort((a, b) => b.projectedSavings - a.projectedSavings)[0];

  $("#organization-name").textContent = `${data.organization.name.toUpperCase()} / PROCUREMENT`;
  $("#workspace-mode").lastChild.textContent = ` ${stageNames[currentMission.status]}`;
  $("#scenario-status").textContent = stageNames[currentMission.status];
  $("#overview-mission-title").textContent = currentMission.title;
  $("#overview-mission-objective").textContent = currentMission.objective;
  $("#mission-progress-value").textContent = progress;
  $("#mission-progress-label").textContent = stageNames[currentMission.status];
  $("#mission-progress-ring").style.background = `radial-gradient(circle,#fff 57%,transparent 59%),conic-gradient(var(--blue) 0 ${Math.round(progress / 7 * 100)}%,#edf2f5 ${Math.round(progress / 7 * 100)}%)`;

  $("#active-mission-count").textContent = data.summary.activeMissions;
  $("#qualified-count").textContent = data.summary.suppliersQualified;
  $("#projected-savings").textContent = money(data.summary.projectedSavings);
  $("#approval-count").textContent = data.summary.approvalsWaiting;

  $("#mission-list").innerHTML = data.missions.map(item => `<button class="risk-card ${item.id === currentMission.id ? "active" : ""}" data-mission="${escapeHtml(item.id)}"><i class="risk-bar" style="background:var(--blue)"></i><div><h3>${escapeHtml(item.title)}</h3><p>${escapeHtml(stageNames[item.status])} · ${number(item.quantity)} units</p></div><strong>${progressFor(item.status)}<small>/7</small></strong></button>`).join("");
  $$('[data-mission]').forEach(element => { element.onclick = () => { selectedMissionId = element.dataset.mission; render(); }; });

  $("#mission-detail-title").textContent = currentMission.specification;
  $("#mission-status").textContent = stageNames[currentMission.status];
  $("#mission-status").className = `severity ${currentMission.status === "awaiting_approval" ? "critical" : "medium"}`;
  $("#mission-current-supplier").textContent = currentMission.currentSupplier.name;
  $("#mission-current-price").textContent = money2(currentMission.currentSupplier.unitPrice);
  $("#mission-target-price").textContent = money2(currentMission.constraints.targetUnitPrice);
  $("#mission-max-lead").textContent = days(currentMission.constraints.maxLeadTimeDays);
  $("#mission-best-candidate").textContent = best ? best.name : "No qualified candidate yet";
  $("#mission-best-savings").textContent = best ? `${money(best.projectedSavings)} potential savings before shipping` : "Discovery and qualification must complete first.";

  $("#trigger-component").textContent = component?.name || "Component unavailable";
  $("#trigger-risk").textContent = component ? `${component.score}/100 supply risk` : "No risk signal";
  $("#trigger-summary").textContent = component
    ? `${component.name} has ${number(component.inventory)} units observed, a ${component.leadTimeDays}-day lead time, and only ${component.supplierCount} current supplier. Vendor Scout is sourcing redundancy before that constraint becomes a production stop.`
    : "The mission component could not be resolved.";
  $("#trigger-target").textContent = `${number(currentMission.quantity)} units · target ≤ ${money2(currentMission.constraints.targetUnitPrice)} · lead ≤ ${currentMission.constraints.maxLeadTimeDays} days`;

  const activity = [...data.activity].filter(item => item.missionId === currentMission.id).sort((a, b) => new Date(b.at) - new Date(a.at));
  $("#activity-timeline").innerHTML = activity.length
    ? activity.map(item => `<article class="event recovered"><span>${escapeHtml(item.stage)}</span><h3>${escapeHtml(item.title)}</h3><p>${escapeHtml(item.detail)}</p><time>${escapeHtml(new Date(item.at).toLocaleString([], { hour: "numeric", minute: "2-digit", month: "short", day: "numeric" }))}</time></article>`).join("")
    : '<div class="empty-state">No mission activity yet.</div>';
}

function renderTrueForge(currentMission, localActions) {
  let panel = $("#trueforge-execution");
  if (!panel) {
    panel = document.createElement("article");
    panel.id = "trueforge-execution";
    panel.className = "panel execution-panel trueforge-panel";
    $("#view-missions .execution-panel")?.insertAdjacentElement("afterend", panel);
  }
  if (!panel) return;

  const capability = data.capabilities?.trueForge || {};
  const connection = currentMission.trueForge;
  const lastTurn = connection?.lastTurn;
  const configured = Boolean(capability.configured);
  const connected = Boolean(connection?.sessionId);
  const requiredCount = lastTurn?.requiredActions?.length || 0;
  const output = lastTurn?.content ? `<pre class="trueforge-output">${escapeHtml(lastTurn.content)}</pre>` : "";
  const controls = [];

  if (localActions && configured && !connected) controls.push('<button class="primary-button" data-agent-action="connect_trueforge">Connect TrueForge session</button>');
  if (localActions && configured && connected && lastTurn?.status !== "running") controls.push('<button class="primary-button" data-agent-action="start_trueforge_turn">Run TrueForge turn</button>');
  if (localActions && configured && connected && lastTurn?.id) controls.push('<button class="button light" data-agent-action="sync_trueforge_turn">Sync turn state</button>');

  const stateText = !configured
    ? "TrueForge is not configured for this runtime. Set TRUEFORGE_BASE_URL and TRUEFORGE_AGENT_NAME to enable a real persistent agent session."
    : !connected
      ? `TrueForge is configured at ${capability.endpoint} with agent ${capability.agentName}. No session has been created for this mission yet.`
      : `Persistent session ${connection.sessionId} is connected to ${connection.agentName}.${lastTurn?.id ? ` Last turn ${lastTurn.id}: ${lastTurn.status}.` : " No turn has been started yet."}${requiredCount ? ` ${requiredCount} TrueForge action${requiredCount === 1 ? "" : "s"} require attention.` : ""}`;

  panel.innerHTML = `<div><div class="provider-pill ${connected ? "live" : configured ? "fixture" : ""}">${connected ? "TrueForge session connected" : configured ? "TrueForge configured" : "TrueForge not configured"}</div><h3>Persistent TrueForge orchestration</h3><p>${escapeHtml(stateText)}</p>${output}</div><div class="execution-actions">${controls.join("")}</div>`;
  $$('[data-agent-action]').forEach(button => {
    button.disabled = actionPending;
    button.onclick = () => runMissionAction(button.dataset.agentAction);
  });
}

function renderMissions() {
  const currentMission = mission();
  $("#mission-table-body").innerHTML = data.missions.map(item => `<tr><td><span>${escapeHtml(item.title)}</span><small>${escapeHtml(item.specification)}</small></td><td>${number(item.quantity)}</td><td>${money2(item.currentSupplier.unitPrice)} → target ${money2(item.constraints.targetUnitPrice)}</td><td>${days(item.currentSupplier.leadTimeDays)} → max ${days(item.constraints.maxLeadTimeDays)}</td><td><span class="availability in_stock">● ${escapeHtml(stageNames[item.status])}</span></td></tr>`).join("");

  const steps = ["Mission", "Discover", "Qualify", "Contact", "Negotiate", "Compare", "Approval"];
  const current = progressFor(currentMission.status);
  $("#mission-lifecycle").innerHTML = steps.map((step, index) => `${index ? "<i>→</i>" : ""}<span>${index < current ? "✓ " : ""}${escapeHtml(step)}</span>`).join("");
  $("#mission-requirements").innerHTML = currentMission.constraints.requirements.map(requirement => `<div class="factor"><span>Requirement</span><b>${escapeHtml(requirement)}</b></div>`).join("");
  $("#mission-policy").innerHTML = [
    ["Allowed regions", currentMission.constraints.regions.join(" · ")],
    ["Minimum confidence", `${Math.round(currentMission.constraints.minimumConfidence * 100)}%`],
    ["Sample budget", money2(currentMission.constraints.sampleBudget)],
    ["Requested quantity", `${number(currentMission.quantity)} units`],
    ["Target price", `≤ ${money2(currentMission.constraints.targetUnitPrice)} / unit`],
    ["Lead-time ceiling", `≤ ${currentMission.constraints.maxLeadTimeDays} days`]
  ].map(([label, value]) => `<article class="policy-card"><span>${escapeHtml(label)}</span><strong>${escapeHtml(value)}</strong></article>`).join("");

  const provider = providerLabel(currentMission);
  const providerElement = $("#execution-provider");
  providerElement.textContent = provider.text;
  providerElement.className = `provider-pill ${provider.className}`.trim();
  $("#execution-status").textContent = currentMission.execution?.fallbackUsed
    ? "This run used controlled fixture evidence. A configured provider or TrueForge research tool can replace it without changing the mission contract."
    : currentMission.execution?.discoveryProvider === "trueforge-tools"
      ? "This mission contains provenance-backed supplier research recorded through TrueForge tools."
      : currentMission.execution?.discoveryProvider === "remote"
        ? "This mission's discovery evidence came from the configured external provider."
        : "The mission is ready to execute discovery through TrueForge research, the configured provider, or controlled local fallback.";

  const localActions = Boolean(data.capabilities?.browserMutationsEnabled);
  $("#execution-local-note").hidden = !localActions;
  $("#mission-replay").hidden = !localActions || !data.capabilities?.devResetEnabled;
  const next = nextActionByStatus[currentMission.status];
  const nextButton = $("#mission-next-action");
  nextButton.hidden = !localActions || !next;
  nextButton.disabled = actionPending;
  nextButton.textContent = actionPending ? "Running…" : next?.label || "No local action";
  nextButton.dataset.action = next?.action || "";
  renderTrueForge(currentMission, localActions);
}

function renderSuppliers() {
  const currentMission = mission();
  const candidates = data.supplierCandidates.filter(candidate => candidate.missionId === currentMission.id);
  $("#supplier-view-count").textContent = `${candidates.length} candidate${candidates.length === 1 ? "" : "s"}`;

  if (!candidates.length) {
    $("#supplier-grid").innerHTML = '<div class="empty-state">No suppliers have been discovered for this mission yet.</div>';
    $("#supplier-table-body").innerHTML = "";
    return;
  }

  $("#supplier-grid").innerHTML = candidates.map(candidate => {
    const checkSummary = candidate.qualification
      ? `${Object.values(candidate.qualification.checks).filter(Boolean).length}/${Object.keys(candidate.qualification.checks).length} checks passed`
      : "Awaiting qualification";
    const contact = candidate.contact?.email || candidate.contactEmail || "No verified contact";
    return `<article class="panel source-card"><header><div><h3>${escapeHtml(candidate.name)}</h3><code>${escapeHtml(candidate.type)}</code></div><span class="severity ${qualificationClass(candidate.status)}">${escapeHtml(candidate.status.replaceAll("_", " "))}</span></header><p class="source-region">${escapeHtml(candidate.country)} · ${escapeHtml(candidate.region)}</p><div class="source-stats"><span>Preliminary price<b>${money2(candidate.preliminaryUnitPrice)}</b></span><span>Lead time<b>${days(candidate.leadTimeDays)}</b></span><span>Confidence<b>${Math.round(candidate.confidence * 100)}%</b></span></div><p>${escapeHtml(candidate.reason || "Discovered candidate; qualification has not run yet.")}</p><div class="supplier-proof"><span>${escapeHtml(candidate.source?.kind || "unknown source")}</span><span>${escapeHtml(candidate.source?.reference || "no reference")}</span><span>${escapeHtml(contact)}</span><span>${escapeHtml(checkSummary)}</span></div></article>`;
  }).join("");

  $("#supplier-table-body").innerHTML = candidates.map(candidate => `<tr><td><span>${escapeHtml(candidate.name)}</span><small>${escapeHtml(candidate.source?.reference || "—")}</small></td><td>${escapeHtml(candidate.type)}</td><td>${money2(candidate.preliminaryUnitPrice)}</td><td>${number(candidate.moq)}</td><td>${days(candidate.leadTimeDays)}</td><td>${Math.round(candidate.specMatch * 100)}%</td><td><span class="availability ${candidate.status === "qualified" ? "in_stock" : "low_stock"}">● ${escapeHtml(candidate.status.replaceAll("_", " "))}</span></td></tr>`).join("");
}

function outboundMessage(conversation) {
  return conversation?.messages?.find(message => message.direction === "outbound" && message.type === "rfq") || null;
}

function latestReply(conversation) {
  return [...(conversation?.messages || [])].reverse().find(message => message.direction === "inbound") || null;
}

function renderConversations() {
  const currentMission = mission();
  const qualified = data.supplierCandidates.filter(candidate => candidate.missionId === currentMission.id && candidate.status === "qualified");
  const conversations = data.conversations.filter(conversation => conversation.missionId === currentMission.id);
  const bySupplier = new Map(conversations.map(conversation => [conversation.supplierId, conversation]));
  const localActions = Boolean(data.capabilities?.browserMutationsEnabled);
  const outreachCapability = data.capabilities?.outreach || {};

  $("#conversation-ready-count").textContent = qualified.length;
  $("#conversation-active-count").textContent = data.summary.negotiationsActive;

  const contractPanel = $("#view-conversations .contract-panel");
  if (contractPanel) {
    contractPanel.innerHTML = `<div><p class="eyebrow">PERSISTENT RFQ WORKFLOW</p><h2>${qualified.length} qualified supplier${qualified.length === 1 ? "" : "s"} can enter RFQ.</h2><p>Vendor Scout prepares a non-binding request, persists the thread before delivery, sends through an idempotent transport, and stores supplier replies with provenance.</p></div><pre>RFQ draft → external delivery
→ supplier reply → term extraction
→ negotiate → compare → approval</pre>`;
  }

  let execution = $("#outreach-execution");
  if (!execution) {
    execution = document.createElement("article");
    execution.id = "outreach-execution";
    execution.className = "panel execution-panel outreach-execution";
    contractPanel?.insertAdjacentElement("afterend", execution);
  }
  if (execution) {
    const realProvider = outreachCapability.provider === "remote";
    const status = realProvider
      ? "External outreach provider configured. Delivery acceptance is counted as real supplier contact."
      : outreachCapability.provider === "controlled-preview"
        ? "Controlled preview is enabled. RFQs render and persist, but no email is sent and supplier-contact metrics remain unchanged."
        : "No outreach transport is configured for this runtime.";
    const controls = [];
    if (localActions && ["contacting", "negotiating"].includes(currentMission.status)) {
      controls.push('<button class="button light" data-outreach-action="prepare_outreach">Prepare RFQs</button>');
      controls.push(`<button class="primary-button" data-outreach-action="send_outreach">${realProvider ? "Send RFQs" : "Preview RFQs"}</button>`);
    }
    execution.innerHTML = `<div><div class="provider-pill ${realProvider ? "live" : outreachCapability.provider === "controlled-preview" ? "fixture" : ""}">${realProvider ? "Live outreach transport" : outreachCapability.provider === "controlled-preview" ? "Controlled outreach preview" : "Outreach not configured"}</div><h3>Supplier outreach execution</h3><p>${escapeHtml(status)}</p></div><div class="execution-actions">${controls.join("")}</div>`;
    $$('[data-outreach-action]').forEach(button => {
      button.disabled = actionPending;
      button.onclick = () => runMissionAction(button.dataset.outreachAction);
    });
  }

  if (!qualified.length) {
    $("#rfq-targets").innerHTML = '<div class="empty-state">No qualified supplier is ready for outreach yet.</div>';
    return;
  }

  $("#rfq-targets").innerHTML = qualified.map(candidate => {
    const conversation = bySupplier.get(candidate.id);
    if (!conversation) {
      const contact = candidate.contact?.email || candidate.contactEmail || "No verified contact";
      return `<article class="panel conversation-card"><header><div><h3>${escapeHtml(candidate.name)}</h3><p>${escapeHtml(contact)}</p></div><span class="provider-pill">Not prepared</span></header><p>Qualified for outreach. No RFQ thread has been prepared yet.</p></article>`;
    }

    const outbound = outboundMessage(conversation);
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

    return `<article class="panel conversation-card"><header><div><h3>${escapeHtml(conversation.supplierName || candidate.name)}</h3><p>${escapeHtml(outbound?.to || "No verified contact")}</p></div><span class="provider-pill ${state.tone}">${escapeHtml(state.label)}</span></header><div class="conversation-meta"><span>Contact evidence<b>${escapeHtml(source)}</b></span><span>Delivery<b>${escapeHtml(deliveryLine)}</b></span></div>${rfqMarkup}${replyMarkup}</article>`;
  }).join("");
}

function renderApprovals() {
  $("#approval-waiting").textContent = data.summary.approvalsWaiting;
  const currentMission = mission();
  $("#approval-boundary").textContent = `Vendor Scout may discover, qualify, contact, negotiate, and compare within the ${currentMission.title} mission. It must stop before spending money, accepting commercial terms, or ordering samples.`;
}

function render() {
  if (!data?.missions?.length) {
    showWorkspaceError("No sourcing missions are available.");
    return;
  }
  showWorkspaceError("");
  if (!selectedMissionId || !data.missions.some(item => item.id === selectedMissionId)) selectedMissionId = data.missions[0].id;
  renderLanding();
  renderOverview();
  renderMissions();
  renderSuppliers();
  renderConversations();
  renderApprovals();
}

function navigate(view) {
  const target = $(`#view-${view}`);
  const nav = $(`.nav-item[data-view='${view}']`);
  if (!target || !nav) return;
  $$(".view,.nav-item").forEach(element => element.classList.remove("active"));
  target.classList.add("active");
  nav.classList.add("active");
  $("#page-title").textContent = {
    overview: "Overview",
    missions: "Sourcing Missions",
    suppliers: "Suppliers",
    conversations: "Conversations",
    approvals: "Approvals"
  }[view];
  window.scrollTo(0, 0);
}

async function runMissionAction(action) {
  if (!action || actionPending) return;
  actionPending = true;
  renderMissions();
  renderConversations();
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
    renderMissions();
    renderConversations();
  }
}

async function replayMission() {
  if (actionPending) return;
  actionPending = true;
  renderMissions();
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
    renderMissions();
  }
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

$$('[data-view]').forEach(button => { button.onclick = () => openView(button.dataset.view); });
$$('[data-scroll]').forEach(element => { element.onclick = () => document.getElementById(element.dataset.scroll)?.scrollIntoView({ behavior: "smooth" }); });
$$('.enter-app').forEach(element => { element.onclick = () => openView("overview"); });
$$('[data-open-view]').forEach(element => { element.onclick = () => openView(element.dataset.openView); });
$(".back-home").onclick = () => { history.pushState(null, "", "#home"); showLanding(); };
$("#mobile-menu").onclick = () => { const open = $("#mobile-links").classList.toggle("open"); $("#mobile-menu").setAttribute("aria-expanded", open); };
$("#mission-next-action").onclick = event => runMissionAction(event.currentTarget.dataset.action);
$("#mission-replay").onclick = replayMission;
window.addEventListener("hashchange", () => {
  const view = hashView();
  if (view) showApp(view);
  else if (location.hash === "#home") showLanding();
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
