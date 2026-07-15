import assert from "node:assert/strict";
import test from "node:test";

import { readRepositoryFile } from "./repository-test-support.js";

test("AC-0005: every privileged operation has explicit threat-model coverage", () => {
  const security = readRepositoryFile("docs/spec/security.md");
  const objectives = markdownSection(security, "## 1. Security objectives")
    .split("\n")
    .filter((line) => line.startsWith("- "))
    .map((line) => line.slice(2).replace(/[.;]$/u, ""));
  const requirements = [
    ["change workflow state", /\bCore\b/u, /\bcross\b/u, /\breject\b/u, /\bcan\b/u],
    ["mutate files outside accepted scope", /\bCore\b.*\bWriter Lease\b/u, /\bcrosses\b/u, /\bblock\b.*\bpreserve\b/u, /\bcannot\b/u],
    ["bypass review or validation", /\bhuman approval\b.*\bCore Gate\b/u, /\bcrosses\b/u, /\breject\b.*\bblock\b/u, /\bcan\b/u],
    ["convert untrusted content into project instructions", /\bCore trust policy\b/u, /\bcrosses\b/u, /\bdata-only\b.*\bdeny\b/u, /\breduce\b.*\bdo not eliminate\b/u],
    ["include unrelated user work in a commit", /\bscoped commit policy\b/u, /\bseparated\b/u, /\bblock\b/u, /\bremain\b/u],
    ["expose credentials or sensitive logs", /\bredaction\b.*\bdurable-record policy\b/u, /\bcrosses\b/u, /\bredact\b.*\breject\b/u, /\bincomplete\b.*\bmay\b/u],
    ["replace pinned Skills or Phase Agents", /\brelease identity\b.*\bCore contract policy\b/u, /\bcross(?:es)?\b/u, /\bblock\b/u, /\bstill\b/u],
    ["perform prohibited Git or external side effects", /\bhuman policy\b.*\btyped ports\b/u, /\bcross\b/u, /\bdeny\b.*\buncertain\b/u, /\bmay\b/u],
  ] as const;
  assert.deepEqual(objectives, requirements.map(([operation]) => operation));
  assert.ok(markdownSection(security, "## 3. Trust boundaries").length > 0);
  assert.ok(markdownSection(security, "## 4. Authority model").length > 0);
  const failClosed = markdownSection(security, "## 17. Fail-closed matrix");
  assert.ok(markdownSection(security, "## 18. Explicit residual risks").length > 0);

  const coverageRows = failClosed
    .split("\n")
    .filter((line) => line.startsWith("|") && !line.includes("---"))
    .map((line) => line.split("|").slice(1, -1).map((cell) => cell.trim()))
    .filter((cells) => cells.length === 5 && cells[0] !== "Privileged operation");
  assert.equal(coverageRows.length, requirements.length);
  for (const [operation, authority, boundary, failure, risk] of requirements) {
    const coverage = coverageRows.find((cells) => cells[0] === operation);
    assert.ok(coverage, operation);
    assert.match(coverage[1] ?? "", authority, operation);
    assert.match(coverage[2] ?? "", boundary, operation);
    assert.match(coverage[3] ?? "", failure, operation);
    assert.match(coverage[4] ?? "", risk, operation);
  }
});

function markdownSection(markdown: string, heading: string): string {
  const start = markdown.indexOf(heading);
  assert.notEqual(start, -1, heading);
  const nextHeading = markdown.indexOf("\n## ", start + heading.length);
  return markdown.slice(start, nextHeading === -1 ? undefined : nextHeading);
}
