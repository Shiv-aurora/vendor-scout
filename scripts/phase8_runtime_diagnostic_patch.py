from pathlib import Path

path = Path('test/quote-runtime.test.mjs')
text = path.read_text()
old = '  assert.equal(snapshot.mission.status, "comparing");\n'
new = '''  assert.equal(snapshot.mission.status, "comparing", JSON.stringify({\n    status: snapshot.mission.status,\n    execution: snapshot.mission.execution,\n    quotes: snapshot.quotes?.map(quote => ({ supplier: quote.supplierName, knownTotal: quote.knownTotal, landedCost: quote.landedCost, completeness: quote.completeness, score: quote.score, rank: quote.rank })),\n    recommendation: snapshot.recommendations?.[0] || null,\n    conversations: snapshot.conversations?.map(conversation => ({ supplier: conversation.supplierName, status: conversation.status, evaluation: conversation.negotiation?.latestEvaluation }))\n  }, null, 2));\n'''
if old not in text:
    raise SystemExit('target assertion not found')
path.write_text(text.replace(old, new, 1))
Path('.github/workflows/one-shot-phase8-runtime-diagnostic.yml').unlink(missing_ok=True)
Path('scripts/phase8_runtime_diagnostic_patch.py').unlink(missing_ok=True)
