let data;
let selectedMissionId;

const $ = selector => document.querySelector(selector);
const $$ = selector => [...document.querySelectorAll(selector)];
const escapeHtml = value => String(value ?? "").replace(/[&<>"']/g, character => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[character]);
const number = value => new Intl.NumberFormat("en-US").format(value ?? 0);
const money = value => new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(value ?? 0);
const money2 = value => new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", minimumFractionDigits: 2 }).format(value ?? 0);

const stageOrder = ["discovering", "qualifying", "contacting", "negotiating", "comparing", "awaiting_approval", "approved"];
const stageNames = {
  draft: "Mission ready",
  discovering: "Discovering suppliers",
  qualifying: "Qualifying candidates",
  contacting: "Contacting suppliers",
  negotiating: "Negotiating terms",
  comparing: "Comparing quotes",
  awaiting_approval: "Waiting for approval",
  approved: "Approved action",
  rejected: "Rejected",
  completed: "Completed"
};

async function api(path, options) {
  const response = await fetch(path, options);
  const value = await response.json();
  if (!response.ok) throw new Error(value.error || "Request failed");
  return value;
}

function toast(message) {
  const element = $("#toast");
  if (!element) return;
  element.textContent = message;
  element.classList.add("show");
  setTimeout(() => element.classList.remove("show"), 2600);
}

function mission() {
  return data.missions.find(item => item.id === selectedMissionId) || data.missions[0];
}

function componentFor(currentMission) {
  return data.components.find(item => item.id === currentMission.componentId);
}

function progressFor(status) {
  if (status === "draft") return 0;
  if (["completed", "approved"].includes(status)) return 7;
  const index = stageOrder.indexOf(status);
  return index < 0 ? 0 : index + 1;
}

function qualificationClass(status) {
  return status === "qualified" ? "low" : status === "rejected" ? "critical" : "high";
}

function renderLanding() {
  $("#landing-mission-count").textContent = `${data.summary.activeMissions} active mission`;
  $("#landing-supplier-count").textContent = `${data.summary.suppliersDiscovered} suppliers discovered`;
  $("#landing-qualified-count").textContent = `${data.summary.suppliersQualified} qualified`;
  $("#landing-savings").textContent = `${money(data.summary.projectedSavings)} projected savings`;
}

function renderOverview() {
  const currentMission = mission();
  const component = componentFor(currentMission);
  const progress = progressFor(currentMission.status);
  const qualified = data.supplierCandidates.filter(candidate => candidate.missionId === currentMission.id && candidate.status === "qualified");
  const best = [...qualified].sort((a, b) => b.projectedSavings - a.projectedSavings)[0];

  $("#organization-name").textContent = `${data.organization.name.toUpperCase()} / PROCUREMENT`;
  $("#workspace-mode").lastChild.textContent = " Procurement foundation";
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
  $("#mission-max-lead").textContent = `${currentMission.constraints.maxLeadTimeDays} days`;
  $("#mission-best-candidate").textContent = best ? best.name : "Still qualifying";
  $("#mission-best-savings").textContent = best ? `${money(best.projectedSavings)} potential savings` : "No qualified offer yet";

  $("#trigger-component").textContent = component.name;
  $("#trigger-risk").textContent = `${component.score}/100 supply risk`;
  $("#trigger-summary").textContent = `${component.name} has ${number(component.inventory)} units observed, a ${component.leadTimeDays}-day lead time, and only ${component.supplierCount} current supplier. Vendor Scout is sourcing redundancy before that constraint becomes a production stop.`;
  $("#trigger-target").textContent = `${number(currentMission.quantity)} units · target ≤ ${money2(currentMission.constraints.targetUnitPrice)} · lead ≤ ${currentMission.constraints.maxLeadTimeDays} days`;

  $("#activity-timeline").innerHTML = [...data.activity].filter(item => item.missionId === currentMission.id).sort((a, b) => new Date(b.at) - new Date(a.at)).map(item => `<article class="event recovered"><span>${escapeHtml(item.stage)}</span><h3>${escapeHtml(item.title)}</h3><p>${escapeHtml(item.detail)}</p><time>${escapeHtml(new Date(item.at).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" }))}</time></article>`).join("");
}

function renderMissions() {
  $("#mission-table-body").innerHTML = data.missions.map(item => `<tr><td><span>${escapeHtml(item.title)}</span><small>${escapeHtml(item.specification)}</small></td><td>${number(item.quantity)}</td><td>${money2(item.currentSupplier.unitPrice)} → target ${money2(item.constraints.targetUnitPrice)}</td><td>${item.currentSupplier.leadTimeDays}d → max ${item.constraints.maxLeadTimeDays}d</td><td><span class="availability in_stock">● ${escapeHtml(stageNames[item.status])}</span></td></tr>`).join("");

  const currentMission = mission();
  const steps = ["Mission", "Discover", "Qualify", "Contact", "Negotiate", "Compare", "Approval"];
  const current = progressFor(currentMission.status);
  $("#mission-lifecycle").innerHTML = steps.map((step, index) => `${index ? "<i>→</i>" : ""}<span>${index + 1 <= current ? "✓ " : ""}${escapeHtml(step)}</span>`).join("");
  $("#mission-requirements").innerHTML = currentMission.constraints.requirements.map(requirement => `<div class="factor"><span>Requirement</span><b>${escapeHtml(requirement)}</b></div>`).join("");
}

function renderSuppliers() {
  const currentMission = mission();
  const candidates = data.supplierCandidates.filter(candidate => candidate.missionId === currentMission.id);
  $("#supplier-view-count").textContent = `${candidates.length} candidates`;
  $("#supplier-grid").innerHTML = candidates.map(candidate => `<article class="panel source-card"><header><div><h3>${escapeHtml(candidate.name)}</h3><code>${escapeHtml(candidate.type)}</code></div><span class="severity ${qualificationClass(candidate.status)}">${escapeHtml(candidate.status.replaceAll("_", " "))}</span></header><p class="source-region">${escapeHtml(candidate.country)} · ${escapeHtml(candidate.region)}</p><div class="source-stats"><span>Preliminary price<b>${money2(candidate.preliminaryUnitPrice)}</b></span><span>Lead time<b>${candidate.leadTimeDays} days</b></span><span>Confidence<b>${Math.round(candidate.confidence * 100)}%</b></span></div><p>${escapeHtml(candidate.reason)}</p></article>`).join("");

  $("#supplier-table-body").innerHTML = candidates.map(candidate => `<tr><td><span>${escapeHtml(candidate.name)}</span><small>${escapeHtml(candidate.source.reference)}</small></td><td>${escapeHtml(candidate.type)}</td><td>${money2(candidate.preliminaryUnitPrice)}</td><td>${candidate.moq}</td><td>${candidate.leadTimeDays} days</td><td>${Math.round(candidate.specMatch * 100)}%</td><td><span class="availability ${candidate.status === "qualified" ? "in_stock" : "low_stock"}">● ${escapeHtml(candidate.status.replaceAll("_", " "))}</span></td></tr>`).join("");
}

function renderConversations() {
  const currentMission = mission();
  const qualified = data.supplierCandidates.filter(candidate => candidate.missionId === currentMission.id && candidate.status === "qualified");
  $("#conversation-ready-count").textContent = qualified.length;
  $("#conversation-active-count").textContent = data.summary.negotiationsActive;
  $("#rfq-targets").innerHTML = qualified.map(candidate => `<div class="factor"><span>${escapeHtml(candidate.name)}</span><b>${money2(candidate.preliminaryUnitPrice)} · ${candidate.leadTimeDays} days · MOQ ${candidate.moq}</b></div>`).join("");
}

function renderApprovals() {
  $("#approval-waiting").textContent = data.summary.approvalsWaiting;
  const currentMission = mission();
  $("#approval-boundary").textContent = `Vendor Scout may discover, qualify, contact, negotiate, and compare within the ${escapeHtml(currentMission.title)} mission. It must stop before spending money, accepting commercial terms, or ordering samples.`;
}

function render() {
  if (!data?.missions?.length) return;
  if (!selectedMissionId) selectedMissionId = data.missions[0].id;
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

$$('[data-view]').forEach(button => { button.onclick = () => navigate(button.dataset.view); });
$$('[data-scroll]').forEach(element => { element.onclick = () => document.getElementById(element.dataset.scroll)?.scrollIntoView({ behavior: "smooth" }); });
$$('.enter-app').forEach(element => { element.onclick = () => { history.pushState(null, "", "#app"); showApp("overview"); }; });
$$('[data-open-view]').forEach(element => { element.onclick = () => { history.pushState(null, "", "#app"); showApp(element.dataset.openView); }; });
$(".back-home").onclick = () => { history.pushState(null, "", "#home"); showLanding(); };
$("#mobile-menu").onclick = () => { const open = $("#mobile-links").classList.toggle("open"); $("#mobile-menu").setAttribute("aria-expanded", open); };
window.addEventListener("hashchange", () => location.hash === "#app" ? showApp("overview") : location.hash === "#home" && showLanding());

api("/api/dashboard").then(value => {
  data = value;
  render();
  if (location.hash === "#app") showApp("overview");
}).catch(error => toast(error.message));
