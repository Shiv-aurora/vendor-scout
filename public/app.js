let data;
let selected = "cmp-lidar";
const $ = selector => document.querySelector(selector);
const $$ = selector => [...document.querySelectorAll(selector)];
const colors = { critical: "#ff6b63", high: "#f6c85d", medium: "#45d68d", low: "#45d68d" };
const escapeHtml = value => String(value).replace(/[&<>"']/g, character => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[character]);
const number = value => new Intl.NumberFormat("en-US").format(value);

async function api(path, options) {
  const response = await fetch(path, options);
  const value = await response.json();
  if (!response.ok) throw new Error(value.error || "Request failed");
  return value;
}

function toast(message) {
  const element = $("#toast");
  element.textContent = message;
  element.classList.add("show");
  setTimeout(() => element.classList.remove("show"), 2600);
}

function latestCatalog() {
  const latest = new Map();
  [...data.observations].sort((a, b) => new Date(b.collectedAt) - new Date(a.collectedAt)).forEach(item => {
    if (!latest.has(item.componentId)) latest.set(item.componentId, item);
  });
  return [...latest.values()];
}

function renderSummary() {
  $("#product-name").textContent = `${data.product.name} · ${data.product.sku}`;
  $("#readiness-score").textContent = data.summary.readiness;
  $("#score-ring").style.background = `radial-gradient(circle,#101e19 57%,transparent 59%),conic-gradient(${data.summary.readiness < 75 ? "var(--red)" : "var(--green)"} 0 ${data.summary.readiness}%,#28342f ${data.summary.readiness}%)`;
  $("#critical-count").textContent = data.summary.critical;
  $("#component-count").textContent = data.summary.components;
  $("#healthy-count").textContent = `${data.summary.sourcesHealthy}/${data.sources.length}`;
  $("#data-mode").lastChild.textContent = " Local demo · no external connections";
  $("#landing-product-count").textContent = `${latestCatalog().length} sample products`;
  $("#landing-observation-count").textContent = `${data.observations.length} local observations`;
  const cards = [{ key: "northstar", id: "src-supplier-a" }, { key: "arcline", id: "src-distributor" }];
  cards.forEach(({ key, id }) => {
    const source = data.sources.find(item => item.id === id);
    $(`#landing-${key}-state`).textContent = source.state;
    $(`#landing-${key}-count`).textContent = `${source.rows} sample rows`;
  });
}

function renderRisks() {
  $("#risk-list").innerHTML = [...data.components].sort((a, b) => b.score - a.score).map(component => `<button class="risk-card ${component.id === selected ? "active" : ""}" data-component="${escapeHtml(component.id)}"><i class="risk-bar" style="background:${colors[component.severity] || colors.low}"></i><div><h3>${escapeHtml(component.name)}</h3><p>${escapeHtml(component.mpn)} · ${escapeHtml(component.assembly)}</p></div><strong>${component.score}<small>/100</small></strong></button>`).join("");
  $$('[data-component]').forEach(element => { element.onclick = () => { selected = element.dataset.component; renderRisks(); renderDetail(); }; });
}

function drawSparkline(canvas, values) {
  const rect = canvas.getBoundingClientRect();
  if (!rect.width || values.length < 2) return;
  const scale = window.devicePixelRatio || 1;
  const width = rect.width;
  const height = rect.height;
  canvas.width = width * scale;
  canvas.height = height * scale;
  const context = canvas.getContext("2d");
  context.scale(scale, scale);
  const maximum = Math.max(...values);
  const minimum = Math.min(...values);
  const x = index => 18 + index * ((width - 36) / (values.length - 1));
  const y = value => height - 18 - ((value - minimum) / (maximum - minimum || 1)) * (height - 38);
  context.beginPath();
  values.forEach((value, index) => index ? context.lineTo(x(index), y(value)) : context.moveTo(x(index), y(value)));
  context.strokeStyle = "#f45b50";
  context.lineWidth = 2;
  context.stroke();
}

function renderDetail() {
  const component = data.components.find(item => item.id === selected);
  $("#detail-name").textContent = component.name;
  $("#detail-mpn").textContent = component.mpn;
  $("#detail-assembly").textContent = component.assembly;
  $("#detail-severity").textContent = component.severity;
  $("#detail-severity").className = `severity ${component.severity}`;
  $("#current-stock").textContent = number(component.inventory);
  $("#trend-chart").innerHTML = '<canvas aria-label="Inventory trend"></canvas>';
  drawSparkline($("#trend-chart canvas"), data.trends[selected] || []);
  $("#risk-factors").innerHTML = `<div class="factor"><span>Lead time</span><b>${component.leadTimeDays} days</b></div><div class="factor"><span>Supplier coverage</span><b>${component.supplierCount} sources</b></div><div class="factor"><span>Sample confidence</span><b>${Math.round(component.sourceConfidence * 100)}%</b></div>`;
  const alternatives = data.alternatives.filter(item => item.componentId === component.id);
  $("#impact-component").textContent = component.name;
  $("#impact-assembly").textContent = component.assembly;
  $("#impact-title").textContent = `The ${component.assembly.toLowerCase()}—and the entire rover build.`;
  $("#impact-summary").textContent = `A shortage in ${component.name} blocks ${component.assembly}, putting the next ${data.product.name} sample production run at risk.`;
  $("#impact-alternatives").textContent = `${alternatives.length} sample alternatives require engineering review`;
}

function renderSources() {
  $("#source-grid").innerHTML = data.sources.map(source => `<article class="panel source-card"><header><div><h3>${escapeHtml(source.name)}</h3><code>${escapeHtml(source.reference)}</code></div><span class="state ${source.state}">● ${escapeHtml(source.state)}</span></header><p class="source-region">${escapeHtml(source.region.country)} · ${escapeHtml(source.region.market)}</p><div class="source-stats"><span>Sample freshness<b>${escapeHtml(source.freshness)}</b></span><span>Stored rows<b>${source.rows}</b></span><span>Data mode<b>Local fixture</b></span></div></article>`).join("");
}

function renderCharts(rows) {
  const names = Object.fromEntries(data.sources.map(source => [source.id, source.name]));
  const counts = rows.reduce((result, item) => { const key = names[item.sourceId] || "Unknown"; result[key] = (result[key] || 0) + 1; return result; }, {});
  const entries = Object.entries(counts);
  const maximum = Math.max(1, ...entries.map(([, count]) => count));
  $("#coverage-total").textContent = `${rows.length} samples`;
  $("#coverage-chart").innerHTML = entries.map(([label, count]) => `<div class="bar-row"><div><span>${escapeHtml(label)}</span><b>${count}</b></div><i><em style="width:${Math.round(count / maximum * 100)}%"></em></i></div>`).join("");
  $("#component-donut").innerHTML = `<span><b>${rows.length}</b>samples</span>`;
  $("#component-legend").innerHTML = data.components.map((component, index) => `<div><i style="background:${["#2878ff", "#35b46f", "#f5a623", "#8c6ff7", "#f45b50"][index]}"></i><span>${escapeHtml(component.name)}</span><b>1</b></div>`).join("");
}

function renderCatalog() {
  const rows = latestCatalog();
  const sourceNames = Object.fromEntries(data.sources.map(source => [source.id, source.name]));
  $("#catalog-count").textContent = `${rows.length} sample products`;
  $("#catalog-list").innerHTML = rows.map(item => `<tr><td><span>${escapeHtml(item.title)}</span><small>${escapeHtml(item.mpn)}</small></td><td>${escapeHtml(sourceNames[item.sourceId])}</td><td>${new Intl.NumberFormat("en-US", { style: "currency", currency: item.price.currency }).format(item.price.amount)}</td><td><span class="availability ${item.availability}">● ${escapeHtml(item.availability.replaceAll("_", " "))}</span><small>${number(item.inventory)} units</small></td><td>${escapeHtml(item.provenance.region)}</td></tr>`).join("");
  renderCharts(rows);
}

function renderTimeline() {
  $("#timeline").innerHTML = data.qualityEvents.map(event => `<article class="event ${event.state}"><span>${escapeHtml(event.state)}</span><h3>${escapeHtml(event.title)}</h3><p>${escapeHtml(event.detail)}</p><time>${escapeHtml(new Date(event.at).toLocaleString())}</time></article>`).join("");
  $("#quality-reference").textContent = data.sources.find(source => source.id === "src-controlled")?.reference || "local fixture";
}

function render() { renderSummary(); renderRisks(); renderDetail(); renderSources(); renderCatalog(); renderTimeline(); }
function navigate(view) {
  const target = $(`#view-${view}`);
  const nav = $(`.nav-item[data-view='${view}']`);
  if (!target || !nav) return;
  $$(".view,.nav-item").forEach(element => element.classList.remove("active"));
  target.classList.add("active");
  nav.classList.add("active");
  $("#page-title").textContent = { command: "Dashboard", sources: "Sample Data", healing: "Data Quality Demo" }[view];
  window.scrollTo(0, 0);
}

async function runDemo(path, message) {
  try { data = await api(path, { method: "POST" }); render(); toast(message); }
  catch (error) { toast(error.message); }
}

$$('[data-view]').forEach(button => { button.onclick = () => navigate(button.dataset.view); });
$$('[data-impact]').forEach(button => { button.onclick = () => $("#production-impact").scrollIntoView({ behavior: "smooth", block: "center" }); });
$("#demo-degrade").onclick = () => runDemo("/api/demo/degrade", "Local sample degraded");
$("#demo-heal").onclick = () => runDemo("/api/demo/heal", "Local sample corrected");
$("#demo-verify").onclick = () => runDemo("/api/demo/verify", "Local sample verified");
$("#demo-reset").onclick = () => runDemo("/api/demo/reset", "Demo reset");
$$('[data-scroll]').forEach(element => { element.onclick = () => document.getElementById(element.dataset.scroll).scrollIntoView({ behavior: "smooth" }); });
$("#mobile-menu").onclick = () => { const open = $("#mobile-links").classList.toggle("open"); $("#mobile-menu").setAttribute("aria-expanded", open); };

let contextShown = false;
function closeContext() { $("#context-modal").hidden = true; document.body.style.overflow = ""; }
function showApp() { $("#landing").hidden = true; $("#app-shell").hidden = false; window.scrollTo(0, 0); if (data) render(); if (!contextShown) { contextShown = true; $("#context-modal").hidden = false; } }
function showLanding() { closeContext(); contextShown = false; $("#landing").hidden = false; $("#app-shell").hidden = true; window.scrollTo(0, 0); }
$$('[data-close-context]').forEach(button => { button.onclick = closeContext; });
$("#context-start").onclick = closeContext;
$$('.enter-app').forEach(element => { element.onclick = () => { history.pushState(null, "", "#app"); showApp(); navigate("command"); }; });
$$('[data-open-view]').forEach(element => { element.onclick = () => { history.pushState(null, "", "#app"); showApp(); navigate(element.dataset.openView); }; });
$(".back-home").onclick = () => { history.pushState(null, "", "#home"); showLanding(); };
window.addEventListener("hashchange", () => location.hash === "#app" ? showApp() : location.hash === "#home" && showLanding());

api("/api/dashboard").then(value => { data = value; render(); if (location.hash === "#app") showApp(); }).catch(error => toast(error.message));
