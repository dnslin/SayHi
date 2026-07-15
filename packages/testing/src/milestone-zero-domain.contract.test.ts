import assert from "node:assert/strict";
import { join } from "node:path";
import test from "node:test";

import {
  collectTextSources,
  readRepositoryFile,
  REPOSITORY_ROOT,
} from "./repository-test-support.js";

test("AC-0003: accepted specifications and ADRs use the SayHi domain vocabulary", () => {
  const domainLanguage = readRepositoryFile("CONTEXT.md");
  const acceptedDocuments = [
    ...collectTextSources(join(REPOSITORY_ROOT, "docs", "spec")),
    ...collectTextSources(join(REPOSITORY_ROOT, "docs", "adr")),
  ].filter((source) => source.path.endsWith(".md"));
  const documentsByPath = new Map(
    acceptedDocuments.map((source) => [source.path, source.source]),
  );
  const domainDefinitions = [
    "**Route**:",
    "**Phase**:",
    "**Task**:",
    "**Projection**:",
    "**Workflow Event**:",
    "**Context Manifest**:",
    "**Phase Agent**:",
    "**Writer Lease**:",
    "**Trust Tier**:",
  ];
  for (const definition of domainDefinitions) {
    assert.ok(domainLanguage.includes(definition), definition);
  }

  const avoidedAliases = [
    /\btask status\b/iu,
    /\blifecycle state\b/iu,
    /\bfull Task directory\b/iu,
    /\bsource event history\b/iu,
    /\blog line\b/iu,
    /\bmutable status\b/iu,
    /\bcopied mirror\b/iu,
    /\bsemantic search result\b/iu,
    /\bfull repository dump\b/iu,
    /\bconfidence score\b/iu,
    /\bunrestricted general agent\b/iu,
    /\badvisory lock file\b/iu,
    /\bparent-child list\b/iu,
  ];
  for (const document of acceptedDocuments) {
    for (const alias of avoidedAliases) {
      assert.doesNotMatch(document.source, alias, document.path);
    }
  }

  const adrVocabulary = [
    [
      "docs/adr/0004-repository-owned-project-store.md",
      [/\bTasks\b/u, /\bExternal References\b/u],
    ],
    [
      "docs/adr/0005-route-aware-seven-phase-workflow.md",
      [/\bRoute\b/u, /\blifecycle\b/u, /\bPhase\b/u, /\bStep\b/u, /\bGates\b/u],
    ],
    [
      "docs/adr/0006-event-log-and-task-projection.md",
      [/\bTask\b/u, /\bWorkflow Event\b/u, /\bProjection\b/u],
    ],
    [
      "docs/adr/0007-layered-context-and-trust.md",
      [/\bContext Manifests\b/u, /\bEngine Instruction\b/u, /\bTask Context\b/u],
    ],
    [
      "docs/adr/0008-capability-sealed-phase-agents.md",
      [/\bPhase Agent\b/u, /\bCapability Contract\b/u, /\bPrompt Overrides\b/u],
    ],
    [
      "docs/adr/0009-reader-writer-barrier-without-worktrees.md",
      [/\bRead Wave\b/u, /\bWriter Lease\b/u, /\brepository fingerprint\b/u],
    ],
    [
      "docs/adr/0010-local-task-authority-for-trackers.md",
      [/\bTask Projection\b/u, /\bEvent stream\b/u, /\bExternal References\b/u],
    ],
  ] as const;
  for (const [path, terms] of adrVocabulary) {
    const source = documentsByPath.get(path);
    assert.ok(source, path);
    for (const term of terms) {
      assert.match(source, term, path);
    }
  }
});
