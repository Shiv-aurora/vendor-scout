from pathlib import Path


def replace_once(path: str, old: str, new: str) -> None:
    file = Path(path)
    text = file.read_text()
    count = text.count(old)
    if count != 1:
        raise SystemExit(f"expected exactly one match in {path}, found {count}: {old!r}")
    file.write_text(text.replace(old, new, 1))


replace_once(
    "public/app.js",
    "${escapeHtml(money(data.summary.projectedSavings))}",
    "${escapeHtml(money(savings))}",
)

replace_once(
    "public/app.css",
    "    inset: auto 0 0 auto;\n    flex-direction: row;\n    align-items: center;\n    width: auto;",
    "    inset: auto 0 0 0;\n    flex-direction: row;\n    align-items: center;\n    width: auto;",
)

Path("test/ui-polish-regressions.test.mjs").write_text(r'''import test from "node:test";
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
''')

print("applied Qodo UI correctness fixes and regressions")
