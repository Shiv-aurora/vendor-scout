import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const appSource = readFileSync(new URL("../public/app.js", import.meta.url), "utf8");
const cssSource = readFileSync(new URL("../public/app.css", import.meta.url), "utf8");

test("Overview renders projected savings from the selected mission", () => {
  const start = appSource.indexOf("function renderOverview()");
  assert.notEqual(start, -1, "renderOverview must exist");
  const overview = appSource.slice(start, start + 7000);

  assert.match(overview, /money\(savings\)/);
  assert.doesNotMatch(overview, /money\(data\.summary\.projectedSavings\)/);
});

test("mobile navigation rail spans the viewport", () => {
  const mobileStart = cssSource.indexOf("@media (max-width: 760px)");
  assert.notEqual(mobileStart, -1, "mobile breakpoint must exist");
  const mobileCss = cssSource.slice(mobileStart, mobileStart + 1800);
  const rail = mobileCss.match(/\.rail\s*\{([\s\S]*?)\}/)?.[1] ?? "";

  assert.match(rail, /inset:\s*auto 0 0 0;/);
  assert.match(rail, /width:\s*auto;/);
});

test("public approval packet keeps all human choices visible without enabling browser mutations", () => {
  const start = appSource.indexOf("function approvalActionsMarkup");
  const end = appSource.indexOf("function decisionBlock", start);
  assert.notEqual(start, -1, "approval action renderer must exist");
  assert.ok(end > start, "approval action renderer must be bounded");

  const factory = new Function("escapeHtml", "money2", `${appSource.slice(start, end)}; return approvalActionsMarkup;`);
  const renderActions = factory(value => String(value), value => `$${Number(value).toFixed(2)}`);
  const markup = renderActions({ localActions: false, canApproveSample: false, samplePrice: null });

  assert.match(markup, /Approve sample unavailable/);
  assert.match(markup, /Send back to negotiate/);
  assert.match(markup, />Reject</);
  assert.equal((markup.match(/disabled aria-disabled="true"/g) || []).length, 3);
  assert.doesNotMatch(markup, /data-approval-decision/);
});
