from pathlib import Path

server = Path('server.mjs')
text = server.read_text()
old = '''    recommendation: analysis.recommendation,
    blockers: analysis.blockers
  });'''
new = '''    recommendation: analysis.recommendation ? {
      id: analysis.recommendation.id,
      quoteId: analysis.recommendation.quoteId,
      supplierId: analysis.recommendation.supplierId,
      status: analysis.recommendation.status,
      score: analysis.recommendation.score,
      reasons: analysis.recommendation.reasons,
      risks: analysis.recommendation.risks,
      humanApprovalRequired: analysis.recommendation.humanApprovalRequired,
      commitmentExecuted: analysis.recommendation.commitmentExecuted
    } : null,
    blockers: analysis.blockers
  });'''
if old not in text:
    raise SystemExit('quote signature recommendation anchor missing')
server.write_text(text.replace(old, new, 1))

mcp_test = Path('test/mcp-runtime.test.mjs')
t = mcp_test.read_text()
replacements = {
  'assert.equal(rpc.result.serverInfo.version, "0.5.0");': 'assert.equal(rpc.result.serverInfo.version, "0.6.0");',
  'assert.equal(rpc.result.tools.length, 10);': 'assert.equal(rpc.result.tools.length, 11);',
  '    "vendor_scout_send_counter"\n  ])': '    "vendor_scout_send_counter",\n    "vendor_scout_analyze_quotes"\n  ])',
  '  assert.equal(byName("vendor_scout_send_counter").annotations.idempotentHint, true);': '  assert.equal(byName("vendor_scout_send_counter").annotations.idempotentHint, true);\n  assert.equal(byName("vendor_scout_analyze_quotes").annotations.openWorldHint, false);\n  assert.equal(byName("vendor_scout_analyze_quotes").annotations.destructiveHint, false);\n  assert.equal(byName("vendor_scout_analyze_quotes").annotations.idempotentHint, true);\n  assert.equal(byName("vendor_scout_analyze_quotes").inputSchema.properties.fxRates.items.required.includes("sourceReference"), true);'
}
for old_text, new_text in replacements.items():
    if old_text not in t:
        raise SystemExit(f'MCP test anchor missing: {old_text}')
    t = t.replace(old_text, new_text, 1)
mcp_test.write_text(t)

Path('.github/workflows/one-shot-phase8-contract-cleanup.yml').unlink(missing_ok=True)
Path('scripts/phase8_contract_cleanup.py').unlink(missing_ok=True)
