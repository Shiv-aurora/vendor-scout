from pathlib import Path

app = Path('public/app.js')
text = app.read_text()
old = '''function renderApprovals() {
  $("#approval-waiting").textContent = data.summary.approvalsWaiting;
  const currentMission = mission();
  $("#approval-boundary").textContent = `Vendor Scout may discover, qualify, contact, negotiate, and compare within the ${currentMission.title} mission. It must stop before spending money, accepting commercial terms, or ordering samples.`;
}
'''
new = r'''function quoteDisplayCost(quote) {
  if (quote?.landedCost?.complete && Number.isFinite(quote.landedCost.base)) return { value: money(quote.landedCost.base), label: "Complete landed cost", complete: true };
  if (Number.isFinite(quote?.knownTotal?.base)) return { value: money(quote.knownTotal.base), label: "Known cost · shipping incomplete", complete: false };
  return { value: "—", label: "Cost incomplete", complete: false };
}

function scoreComponentLabel(key) {
  return ({ economics: "Economics", leadTime: "Lead time", supplierQuality: "Supplier quality", moq: "MOQ fit", sample: "Sample terms", completeness: "Evidence" })[key] || key;
}

function latestForMission(items, missionId) {
  return [...(items || [])].reverse().find(item => item.missionId === missionId) || null;
}

function decisionButtonMarkup(localActions, status, approval) {
  if (!localActions || status !== "awaiting_approval" || approval?.status !== "pending") return "";
  return `<div class="decision-actions"><button class="primary-button" data-approval-decision="approve">Approve sample</button><button class="button light" data-approval-decision="negotiate_more">Keep negotiating</button><button class="button danger-button" data-approval-decision="reject">Reject</button></div>`;
}

function renderApprovals() {
  const view = $("#view-approvals");
  const currentMission = mission();
  if (!view || !currentMission) return;
  const quotes = (data.quotes || []).filter(quote => quote.missionId === currentMission.id);
  const ranked = quotes.filter(quote => Number.isInteger(quote.rank)).sort((a, b) => a.rank - b.rank);
  const recommendation = latestForMission(data.recommendations, currentMission.id);
  const approval = latestForMission(data.approvals, currentMission.id);
  const order = latestForMission(data.sampleOrders, currentMission.id);
  const localActions = Boolean(data.capabilities?.browserMutationsEnabled);
  const winner = recommendation ? quotes.find(quote => quote.id === recommendation.quoteId) : null;
  const cost = quoteDisplayCost(winner);
  const samplePrice = winner?.sample?.basePrice;
  const savings = winner?.economics?.estimatedLandedSavingsBase ?? winner?.economics?.savingsBeforeShippingBase;
  const savingsPercent = winner?.economics?.estimatedLandedSavingsPercent ?? winner?.economics?.savingsPercentBeforeShipping;
  const comparisonReady = ["negotiating", "comparing"].includes(currentMission.status) && Boolean(currentMission.execution?.negotiationReady);

  const quoteCards = ranked.length
    ? ranked.map(quote => {
        const quoteCost = quoteDisplayCost(quote);
        const selected = recommendation?.quoteId === quote.id;
        const score = quote.score?.total;
        const scoreComponents = quote.score?.components || {};
        return `<article class="panel quote-card ${selected ? "quote-winner" : ""}">
          <header><div><span class="quote-rank">#${quote.rank}</span><h3>${escapeHtml(quote.supplierName)}</h3></div><div class="quote-score"><strong>${Number.isFinite(score) ? score.toFixed(1) : "—"}</strong><small>/100</small></div></header>
          <div class="quote-cost"><strong>${escapeHtml(quoteCost.value)}</strong><span>${escapeHtml(quoteCost.label)}</span></div>
          <div class="quote-facts"><span>Unit price<b>${money2(quote.unitPrice?.base)}</b></span><span>Lead time<b>${days(quote.leadTimeDays)}</b></span><span>MOQ<b>${number(quote.moq)}</b></span><span>Shipping<b>${escapeHtml(quote.shipping?.terms || "Unknown")}</b></span><span>Supplier risk<b>${Number.isFinite(quote.supplierRiskScore) ? `${quote.supplierRiskScore}/100` : "—"}</b></span><span>Sample<b>${quote.sample?.available === true ? money2(quote.sample?.basePrice) : quote.sample?.available === false ? "Unavailable" : "Unknown"}</b></span></div>
          <div class="score-breakdown">${Object.entries(scoreComponents).map(([key, value]) => `<span><i style="width:${Math.max(0, Math.min(100, Number(value) || 0))}%"></i><b>${escapeHtml(scoreComponentLabel(key))}</b><em>${Number.isFinite(value) ? Number(value).toFixed(0) : "—"}</em></span>`).join("")}</div>
          ${quote.comparison?.rankable === false ? '<div class="evidence-warning">Not rankable: landed cost is incomplete while a complete comparison exists.</div>' : ""}
          ${quote.completeness?.missing?.length ? `<div class="evidence-warning">Missing: ${escapeHtml(quote.completeness.missing.join(" · "))}</div>` : ""}
          <small class="evidence-source">Offer evidence: ${escapeHtml(quote.sourceReference || "unknown")}</small>
        </article>`;
      }).join("")
    : '<div class="empty-state decision-empty">No normalized quotes yet. Vendor Scout will show the comparison here after negotiation reaches a comparison-ready offer.</div>';

  const reasons = recommendation?.reasons?.length ? `<ul>${recommendation.reasons.map(reason => `<li>${escapeHtml(reason)}</li>`).join("")}</ul>` : "";
  const risks = recommendation?.risks?.length ? `<div class="recommendation-risks"><b>Watchouts</b>${recommendation.risks.map(risk => `<span>${escapeHtml(risk)}</span>`).join("")}</div>` : '<div class="recommendation-risks clear"><b>Evidence check</b><span>No recommendation-specific risk flag is unresolved.</span></div>';
  const decisionButtons = decisionButtonMarkup(localActions, currentMission.status, approval);

  let decisionState;
  if (!recommendation) {
    decisionState = `<article class="panel decision-state"><span class="provider-pill">Analysis pending</span><h2>No recommendation yet.</h2><p>Negotiation evidence must be normalized and compared before a human decision is created.</p>${localActions && comparisonReady ? '<button class="primary-button" id="run-quote-analysis">Run quote comparison</button>' : ""}</article>`;
  } else if (approval?.status === "pending") {
    decisionState = `<article class="panel decision-state pending-decision"><span class="provider-pill live">Human decision required</span><h2>Approve one controlled next step.</h2><p>The agent has finished the research, negotiation, and comparison work. No terms have been accepted and no money has been spent.</p>${decisionButtons}</article>`;
  } else if (approval?.status === "approved" && !order) {
    decisionState = `<article class="panel decision-state execution-gate"><span class="provider-pill fixture">Business approval recorded</span><h2>Approved — execution is still gated.</h2><p>The sample action is authorized in Vendor Scout, but has not executed. The next TrueForge turn may call <code>vendor_scout_execute_sample_order</code>; that tool is destructive and must pause in TrueForge for tool approval immediately before execution.</p></article>`;
  } else if (approval?.status === "returned_to_negotiation") {
    decisionState = `<article class="panel decision-state"><span class="provider-pill">Returned to negotiation</span><h2>Keep negotiating.</h2><p>The recommendation was not accepted. Vendor Scout returned the mission to negotiation without making a commitment.</p></article>`;
  } else if (approval?.status === "rejected") {
    decisionState = `<article class="panel decision-state"><span class="provider-pill critical">Rejected</span><h2>No action executed.</h2><p>The human rejected the recommendation. No commercial terms or sample order were committed.</p></article>`;
  } else if (order) {
    decisionState = `<article class="panel decision-state ${order.simulated ? "simulation-state" : "completed-state"}"><span class="provider-pill ${order.simulated ? "fixture" : "live"}">${order.simulated ? "Controlled sample action" : "Sample order submitted"}</span><h2>${escapeHtml(order.supplierName)} · ${number(order.quantity)} sample unit</h2><p>${order.simulated ? "The entire approved-action path executed, but the final order provider was intentionally simulated; no external spend occurred." : `External order ${escapeHtml(order.externalOrderId || "submitted")} was accepted by the configured provider.`}</p><div class="completion-facts"><span>Total<b>${money2(order.totalBase)}</b></span><span>Provider<b>${escapeHtml(order.provider || "—")}</b></span><span>Status<b>${escapeHtml(order.status)}</b></span></div></article>`;
  } else {
    decisionState = `<article class="panel decision-state"><span class="provider-pill">Decision recorded</span><h2>${escapeHtml(String(approval?.status || currentMission.status).replaceAll("_", " "))}</h2></article>`;
  }

  view.innerHTML = `<div class="recovery-hero decision-hero"><div><p class="eyebrow">COMPARE → HUMAN APPROVAL → APPROVED ACTION</p><h2>The agent does the work.<br><em>The human commits.</em></h2><p>Every number below comes from persisted supplier evidence. Unknown cost stays unknown; incomplete landed-cost offers cannot beat complete ones by looking artificially cheap.</p></div><span class="verified-badge"><i></i> ${data.summary.approvalsWaiting} waiting</span></div>
    ${recommendation && winner ? `<article class="panel recommendation-hero"><div class="recommendation-main"><div><span class="recommendation-label">VENDOR SCOUT RECOMMENDS</span><h2>${escapeHtml(recommendation.supplierName)}</h2><p>${escapeHtml(recommendation.status === "provisional" ? "Provisional recommendation — some cost evidence remains incomplete." : "Best current evidence across economics, lead time, supplier quality, MOQ, sample terms, and completeness.")}</p></div><div class="recommendation-score"><strong>${Number.isFinite(recommendation.score) ? recommendation.score.toFixed(1) : "—"}</strong><span>decision score</span></div></div><div class="recommendation-metrics"><span>Negotiated unit<b>${money2(winner.unitPrice?.base)}</b><small>Current ${money2(currentMission.currentSupplier.unitPrice)}</small></span><span>${escapeHtml(cost.label)}<b>${escapeHtml(cost.value)}</b><small>${cost.complete ? "Comparable landed economics" : "Incomplete cost evidence"}</small></span><span>Projected savings<b>${money(savings)}</b><small>${Number.isFinite(savingsPercent) ? `${savingsPercent.toFixed(1)}% vs current` : "vs current supplier"}</small></span><span>Lead time<b>${days(winner.leadTimeDays)}</b><small>Current ${days(currentMission.currentSupplier.leadTimeDays)}</small></span><span>MOQ<b>${number(winner.moq)}</b><small>${number(currentMission.quantity)} units requested</small></span><span>Sample<b>${winner.sample?.available === true ? money2(samplePrice) : "—"}</b><small>Budget ${money2(currentMission.constraints.sampleBudget)}</small></span></div><div class="recommendation-evidence"><div><h3>Why this offer</h3>${reasons}</div>${risks}</div></article>` : ""}
    <div class="section-title decision-section-title"><div><p class="eyebrow">NORMALIZED QUOTE COMPARISON</p><h2>${ranked.length ? `${ranked.length} comparable offer${ranked.length === 1 ? "" : "s"}` : "Waiting for comparison"}</h2></div><span class="local-badge">Deterministic scoring</span></div><div class="quote-grid">${quoteCards}</div>
    <div class="section-title decision-section-title"><div><p class="eyebrow">HUMAN COMMITMENT BOUNDARY</p><h2>One decision. Full evidence.</h2></div></div>${decisionState}`;

  $("#run-quote-analysis")?.addEventListener("click", runQuoteAnalysis);
  $$('[data-approval-decision]').forEach(button => { button.onclick = () => runApprovalDecision(button.dataset.approvalDecision); });
}

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
    toast(decision === "approve" ? "Sample action approved" : decision === "negotiate_more" ? "Returned to negotiation" : "Recommendation rejected");
  } catch (error) {
    showWorkspaceError(error.message);
    toast(error.message);
  } finally {
    actionPending = false;
  }
}
'''
if old not in text: raise SystemExit('renderApprovals anchor not found')
app.write_text(text.replace(old, new, 1))

css = Path('public/procurement.css')
styles = r'''

/* Decision / approval command center */
.decision-hero{margin-bottom:22px}.decision-hero>div:first-child{max-width:760px}.recommendation-hero{padding:28px;margin-bottom:24px;border:1px solid #bfd4ff;background:linear-gradient(135deg,#f8fbff 0%,#fff 58%,#f7faf8 100%);box-shadow:0 16px 40px rgba(25,51,88,.08)}
.recommendation-main{display:flex;justify-content:space-between;gap:24px;align-items:flex-start}.recommendation-label{display:inline-flex;font-size:11px;font-weight:800;letter-spacing:.12em;color:#1d5fd1;margin-bottom:8px}.recommendation-main h2{font-size:32px;margin:0 0 6px}.recommendation-main p{max-width:720px;color:#536273;margin:0;line-height:1.55}.recommendation-score{width:104px;height:104px;flex:0 0 104px;border-radius:50%;display:grid;place-content:center;text-align:center;background:#102a43;color:#fff;box-shadow:inset 0 0 0 8px rgba(255,255,255,.09)}.recommendation-score strong{font-size:30px;line-height:1}.recommendation-score span{font-size:10px;opacity:.72;margin-top:5px}
.recommendation-metrics{display:grid;grid-template-columns:repeat(6,minmax(0,1fr));gap:10px;margin-top:22px}.recommendation-metrics span,.completion-facts span{padding:13px 14px;border:1px solid #dce5ed;border-radius:10px;background:#fff;color:#667587;font-size:10px;text-transform:uppercase;letter-spacing:.06em}.recommendation-metrics b,.completion-facts b{display:block;margin-top:7px;color:#142536;font-size:17px;letter-spacing:0;text-transform:none}.recommendation-metrics small{display:block;margin-top:5px;color:#83909b;text-transform:none;letter-spacing:0;line-height:1.3}
.recommendation-evidence{display:grid;grid-template-columns:1.4fr .8fr;gap:18px;margin-top:18px}.recommendation-evidence>div{border-top:1px solid #dfe8ef;padding-top:15px}.recommendation-evidence h3{margin:0 0 8px;font-size:13px}.recommendation-evidence ul{margin:0;padding-left:18px;color:#475767;line-height:1.55;font-size:13px}.recommendation-risks{display:flex;flex-direction:column;gap:7px}.recommendation-risks b{font-size:13px}.recommendation-risks span{font-size:12px;padding:7px 9px;border-radius:7px;background:#fff4e8;color:#7a4b13}.recommendation-risks.clear span{background:#eef8f2;color:#316547}
.decision-section-title{margin-top:24px}.quote-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:16px}.quote-card{padding:20px;position:relative;overflow:hidden}.quote-card.quote-winner{border:1px solid #96b8ff;box-shadow:0 12px 30px rgba(40,91,172,.09)}.quote-card.quote-winner:before{content:"RECOMMENDED";position:absolute;right:0;top:0;background:#225fc6;color:#fff;padding:5px 10px;font-size:9px;font-weight:800;letter-spacing:.1em}.quote-card header{display:flex;justify-content:space-between;align-items:flex-start;gap:18px}.quote-card header>div:first-child{display:flex;gap:10px;align-items:center}.quote-card h3{font-size:18px;margin:0}.quote-rank{display:grid;place-items:center;width:28px;height:28px;border-radius:7px;background:#eef3f7;font-size:11px;font-weight:800}.quote-score strong{font-size:24px}.quote-score small{font-size:10px;color:#768596}.quote-cost{margin:18px 0 12px}.quote-cost strong{display:block;font-size:27px}.quote-cost span{font-size:11px;color:#718091}.quote-facts{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:8px}.quote-facts span{padding:9px;background:#f7f9fb;border-radius:7px;color:#748292;font-size:9px;text-transform:uppercase}.quote-facts b{display:block;margin-top:4px;color:#223547;font-size:12px;text-transform:none;white-space:normal}.score-breakdown{display:grid;gap:7px;margin-top:15px}.score-breakdown span{position:relative;height:21px;background:#edf2f6;border-radius:5px;overflow:hidden;display:flex;align-items:center;justify-content:space-between;padding:0 7px}.score-breakdown i{position:absolute;left:0;top:0;bottom:0;background:rgba(41,101,200,.13)}.score-breakdown b,.score-breakdown em{position:relative;z-index:1;font-size:9px;font-style:normal}.evidence-warning{margin-top:10px;padding:8px 10px;border-radius:7px;background:#fff3e3;color:#795018;font-size:11px}.evidence-source{display:block;margin-top:10px;color:#8996a1;word-break:break-all}.decision-empty{grid-column:1/-1}
.decision-state{margin-top:0;padding:26px}.decision-state h2{font-size:25px;margin:10px 0 7px}.decision-state p{max-width:760px;color:#596978;line-height:1.55}.pending-decision{border-color:#c8d9ff;background:#fbfdff}.execution-gate{border-color:#edd9a3;background:#fffdf7}.simulation-state{border-color:#d8dde3;background:#fafbfc}.completed-state{border-color:#b7dfc6;background:#f7fcf9}.decision-actions{display:flex;gap:10px;flex-wrap:wrap;margin-top:18px}.danger-button{border-color:#e5b8b8!important;color:#9a3434!important;background:#fffafa!important}.completion-facts{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:10px;margin-top:16px}.decision-state code{padding:2px 5px;border-radius:4px;background:#edf2f5;font-size:12px}
@media(max-width:1050px){.recommendation-metrics{grid-template-columns:repeat(3,minmax(0,1fr))}.quote-grid{grid-template-columns:1fr}}
@media(max-width:700px){.recommendation-main{flex-direction:column}.recommendation-score{width:88px;height:88px;flex-basis:88px}.recommendation-metrics{grid-template-columns:repeat(2,minmax(0,1fr))}.recommendation-evidence{grid-template-columns:1fr}.quote-facts{grid-template-columns:repeat(2,minmax(0,1fr))}.completion-facts{grid-template-columns:1fr}.decision-actions>*{flex:1 1 100%}}
'''
css.write_text(css.read_text() + styles)
