from pathlib import Path

path = Path('server.mjs')
text = path.read_text()

old_sig = '''    recommendation: analysis.recommendation,
    blockers: analysis.blockers
  });'''
new_sig = '''    offerEvaluations: analysis.offerEvaluations,
    recommendation: analysis.recommendation,
    blockers: analysis.blockers
  });'''
if old_sig not in text:
    raise SystemExit('signature anchor missing')
text = text.replace(old_sig, new_sig, 1)

old_block = '''  state.quotes = [
    ...state.quotes.filter(quote => quote.missionId !== missionId),
    ...analysis.quotes
  ];
  state.recommendations = state.recommendations.filter(recommendation => recommendation.missionId !== missionId);'''
new_block = '''  const currentEvaluationByConversation = new Map(analysis.offerEvaluations.map(item => [item.conversationId, item.evaluation]));
  for (const conversation of conversations) {
    const evaluation = currentEvaluationByConversation.get(conversation.id);
    if (!evaluation || !conversation.negotiation) continue;
    conversation.negotiation.latestEvaluation = evaluation;
    if (evaluation.status === "ready_for_comparison") conversation.status = "offer_ready";
    else if (evaluation.status === "reject_recommended") conversation.status = "human_review";
    else if (["offer_ready", "human_review", "supplier_replied", "counter_sent", "counter_previewed"].includes(conversation.status)) conversation.status = "negotiating";
  }

  state.quotes = [
    ...state.quotes.filter(quote => quote.missionId !== missionId),
    ...analysis.quotes
  ];
  state.recommendations = state.recommendations.filter(recommendation => recommendation.missionId !== missionId);'''
if old_block not in text:
    raise SystemExit('quote persistence anchor missing')
text = text.replace(old_block, new_block, 1)

old_exec = '''    analysisReady: Boolean(analysis.recommendation),
    analysisAt: analysis.analyzedAt,'''
new_exec = '''    negotiationReady: analysis.offerEvaluations.some(item => item.evaluation.status === "ready_for_comparison"),
    analysisReady: Boolean(analysis.recommendation),
    analysisAt: analysis.analyzedAt,'''
if old_exec not in text:
    raise SystemExit('execution anchor missing')
text = text.replace(old_exec, new_exec, 1)

path.write_text(text)
Path('.github/workflows/one-shot-phase8-evaluation-sync.yml').unlink(missing_ok=True)
Path('scripts/phase8_apply_evaluations.py').unlink(missing_ok=True)
