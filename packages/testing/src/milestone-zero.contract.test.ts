import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  validateCliContractRecord,
  validateCliDependencyGraph,
  validateCliDomainValue,
} from "@dnslin/sayhi-cli";
import { coreContract } from "@dnslin/sayhi-core";
import {
  validateOmpContractRecord,
  validateOmpDependencyGraph,
  validateOmpDomainValue,
} from "@dnslin/sayhi-omp";

const TASK_ID = "TASK-7";
const TRANSITION_EVENT_ID = "EVENT-TASK-7-EXPLORE";
const REPOSITORY_ROOT = fileURLToPath(new URL("../../../", import.meta.url));
const HASH_A = { algorithm: "sha256-lf-v1", digest: "a".repeat(64) } as const;
const HASH_B = { algorithm: "sha256-bytes-v1", digest: "b".repeat(64) } as const;
const CONTRACT_IDENTITY_A = `sha256:${"a".repeat(64)}` as const;
const FINGERPRINT = `sha256:${"f".repeat(64)}`;

const contextManifest = [
  {
    schemaVersion: 1,
    id: "CTX-7-ENGINE",
    source: { type: "project-path", value: ".omp/AGENTS.md" },
    kind: "engine-rules",
    reason: "Applies SayHi engine rules",
    required: true,
    mode: "full",
    trust: "engine-instruction",
    instructionPolicy: "scoped-instruction",
    scope: ["**/*"],
    identity: {
      algorithm: "sha256-lf-v1",
      digest: "b6f828a23c3b755709739c29c64033f1f630d7f54ff881be15afb66fcdcb6f95",
    },
    addedBy: TRANSITION_EVENT_ID,
    acceptedByEvent: TRANSITION_EVENT_ID,
  },
  {
    schemaVersion: 1,
    id: "CTX-7-SPEC",
    source: { type: "project-path", value: "docs/spec/acceptance.md" },
    kind: "spec",
    reason: "Defines Milestone 0 acceptance",
    required: true,
    mode: "full",
    trust: "approved-spec",
    instructionPolicy: "scoped-instruction",
    scope: ["**/*"],
    identity: {
      algorithm: "sha256-lf-v1",
      digest: "2b8c23506bbe7918714904c36248c5aba5693a1f6e9822443cca014e69bdfe8c",
    },
    addedBy: TRANSITION_EVENT_ID,
    acceptedByEvent: TRANSITION_EVENT_ID,
  },
  {
    schemaVersion: 1,
    id: "CTX-7-TASK",
    source: {
      type: "project-path",
      value: `.sayhi/tasks/${TASK_ID}/context/explore.md`,
    },
    kind: "task",
    reason: "Defines this executable baseline",
    required: true,
    mode: "full",
    trust: "task-context",
    instructionPolicy: "data-only",
    scope: ["**/*"],
    identity: {
      algorithm: "sha256-lf-v1",
      digest: "bb4c43a8c1674086f25b2dd67f87a692615beaa408bf1d454dbea6f7a6999f13",
    },
    addedBy: TRANSITION_EVENT_ID,
    acceptedByEvent: TRANSITION_EVENT_ID,
  },
  {
    schemaVersion: 1,
    id: "CTX-7-REFERENCE",
    source: { type: "project-path", value: "docs/references.md" },
    kind: "reference",
    reason: "Supplies attributed external background",
    required: true,
    mode: "full",
    trust: "untrusted-reference",
    instructionPolicy: "data-only",
    scope: ["**/*"],
    identity: {
      algorithm: "sha256-lf-v1",
      digest: "aa3410f6156777a94479266d749be354d5fb79bfb4cfd479c325b8a7a05930a4",
    },
    addedBy: TRANSITION_EVENT_ID,
    acceptedByEvent: TRANSITION_EVENT_ID,
  },
] as const;

const currentContext = [
  { source: contextManifest[0].source, content: "Engine rules\n" },
  { source: contextManifest[1].source, content: "Accepted specification\n" },
  { source: contextManifest[2].source, content: "Issue 7 task context\n" },
  { source: contextManifest[3].source, content: "External reference data\n" },
] as const;

const agentContract = {
  schemaVersion: 1,
  role: "research",
  runtimeName: "sayhi-v1-research",
  contractVersion: 1,
  tools: ["read"],
  network: "configured",
  skills: ["research"],
  spawns: [],
  repositoryAccess: "read-only",
  outputSchema: "schemas/agent/research-output.json",
  promptBaseIdentity: CONTRACT_IDENTITY_A,
  overridePolicy: "prompt-body-only",
} as const;

const skills = [
  {
    name: "research",
    identity: {
      algorithm: "sha256-lf-v1",
      digest: "06ba2795964bac116b1e7d69685479f798a207fc7d57091688ca60259a968271",
    },
    content: "research skill\n",
  },
] as const;

const dispatch = {
  schemaVersion: 1,
  dispatchId: "DISPATCH-7",
  taskId: TASK_ID,
  expectedTaskVersion: 2,
  phase: "explore",
  agentRole: "research",
  contextManifestIdentity:
    "sha256:452311e200983848fd535cd627cb726b32cfbd37cb682cde568f76fff2483552",
  agentContractIdentity:
    "sha256:cc4a65e817532269b5c19675b1b6ac2d9009d5efab70ef1b4e351750511361c3",
} as const;

const initiativeGraph = {
  schemaVersion: 1,
  id: "GRAPH-7",
  initiativeTaskId: "TASK-7-INITIATIVE",
  version: 1,
  nodes: [
    {
      taskId: TASK_ID,
      priority: 50,
      resources: {
        files: ["packages/testing/**"],
        apis: ["CoreContract"],
        schemas: ["milestone-zero"],
        locks: ["package-lock.json"],
      },
    },
  ],
  edges: [],
  updatedByEvent: TRANSITION_EVENT_ID,
} as const;

const externalReference = {
  schemaVersion: 1,
  id: "REFERENCE-7",
  kind: "issue",
  adapter: "github",
  uri: "https://github.com/dnslin/SayHi/issues/7",
  externalId: "7",
  observedVersion: "2026-07-14T00:44:14Z",
  role: "specification",
  identity: null,
  lastObservedAt: "2026-07-14T16:00:00Z",
} as const;

const knowledgeCandidate = {
  schemaVersion: 1,
  id: "KNOWLEDGE-7",
  taskId: TASK_ID,
  type: "convention",
  statement: "Milestone contracts interoperate through shared Core validation.",
  scope: ["packages/testing/**"],
  evidence: ["evidence/milestone-zero.json"],
  confidence: "high",
  proposedAction: "update-spec",
  target: "docs/spec/acceptance.md",
  status: "pending",
  createdBy: "RESULT-7",
} as const;

const skillLock = {
  schemaVersion: 1,
  registry: {
    repository: "https://github.com/dnslin/skills",
    commit: "1".repeat(40),
  },
  skills: [
    {
      name: "tdd",
      path: "tdd",
      files: [{ path: "SKILL.md", sha256: HASH_B }],
      upstream: {
        repository: "https://github.com/mattpocock/skills",
        commit: "2".repeat(40),
        path: "skills/engineering/tdd",
        license: "MIT",
      },
      sidecarIdentity: `sha256:${"c".repeat(64)}`,
    },
  ],
} as const;

const managedFile = {
  schemaVersion: 1,
  path: `.sayhi/tasks/${TASK_ID}/task.json`,
  ownershipClass: "engine-owned",
  installedBaseIdentity: HASH_A,
  generatedSourceVersion: "0.0.0",
  markerIds: [],
} as const;

const evidenceRecord = {
  schemaVersion: 1,
  id: "EVIDENCE-7",
  taskId: TASK_ID,
  kind: "validation",
  producer: "sayhi-contract-suite",
  baseFingerprint: FINGERPRINT,
  command: {
    argv: ["npm", "run", "test:contracts"],
    cwd: ".",
    exitCode: 0,
  },
  artifacts: [],
  result: "passed",
  startedAt: "2026-07-14T16:00:00Z",
  completedAt: "2026-07-14T16:01:00Z",
} as const;

const baseline = {
  schemaVersion: 1,
  capturedAt: "2026-07-14T16:00:00Z",
  repositoryRootIdentity: "PROJECT-7",
  head: "1".repeat(40),
  indexDigest: `sha256:${"2".repeat(64)}`,
  trackedWorktreeDigest: `sha256:${"3".repeat(64)}`,
  untracked: [],
  submodulesDigest: `sha256:${"4".repeat(64)}`,
  adoptedPaths: [],
  declaredScope: {
    files: ["packages/testing/**"],
    apis: ["CoreContract"],
    schemas: [],
    locks: ["package-lock.json"],
  },
} as const;

const lease = {
  schemaVersion: 1,
  leaseId: "LEASE-7",
  kind: "writer",
  projectId: "PROJECT-7",
  taskId: TASK_ID,
  owner: {
    sessionId: "SESSION-7",
    processId: 7007,
    hostId: "HOST-7",
    installId: "INSTALL-7",
  },
  baseFingerprint: FINGERPRINT,
  acquiredAt: "2026-07-14T16:00:00Z",
  heartbeatAt: "2026-07-14T16:00:30Z",
  expiresAt: "2026-07-14T16:01:00Z",
} as const;

const projectManifest = {
  schemaVersion: 1,
  projectId: "PROJECT-7",
  installed: {
    core: "0.0.0",
    cli: "0.0.0",
    ompPlugin: "0.0.0",
    projectSchema: 1,
    templates: "0.0.0",
    skillLockDigest: `sha256:${"5".repeat(64)}`,
  },
  initializedAt: "2026-07-14T16:00:00Z",
  updatedAt: "2026-07-14T16:00:00Z",
  ownershipManifest: ".sayhi/managed-files.json",
} as const;

test("AC-0001: one Task crosses every versioned Milestone 0 contract family", () => {
  const taskRequest = buildTaskRequest(TASK_ID, "CREATED");
  const taskEnvelopeRequest = {
    contractVersion: 1,
    kind: "recordEnvelope",
    value: { schemaVersion: 1, ...taskRequest.task },
  } as const;
  const domainResult = coreContract.validateDomainValue(taskEnvelopeRequest);
  assert.equal(domainResult.ok, true);
  assert.deepEqual(validateCliDomainValue(taskEnvelopeRequest), domainResult);
  assert.deepEqual(validateOmpDomainValue(taskEnvelopeRequest), domainResult);

  const started = coreContract.startWorkflowTask(taskRequest);
  if (!started.ok) {
    assert.fail(started.diagnostics[0]?.message ?? "Task creation failed");
  }

  const advanced = coreContract.transitionWorkflow(started.state, {
    contractVersion: 1,
    taskId: TASK_ID,
    expectedVersion: started.state.projection.version,
    to: { lifecycle: "active", phase: "explore", step: "ready" },
    gates: [
      {
        gate: "route",
        evidence: [
          {
            kind: "human-approval",
            reference: "evidence/build-route-accepted.json",
          },
        ],
      },
    ],
    event: eventMetadata(TRANSITION_EVENT_ID, "EXPLORE"),
  });
  if (!advanced.ok) {
    assert.fail(advanced.diagnostics[0]?.message ?? "Task transition failed");
  }
  assert.equal(advanced.state.projection.version, 2);
  assert.equal(advanced.state.projection.phase, "explore");

  const replayed = coreContract.replayWorkflowEvents(advanced.state.events);
  if (!replayed.ok) {
    assert.fail(replayed.diagnostics[0]?.message ?? "Event replay failed");
  }
  assert.deepEqual(replayed.state.projection, advanced.state.projection);
  assert.deepEqual(replayed.state.events, advanced.state.events);

  const binding = coreContract.bindPhaseExecution({
    contractVersion: 1,
    dispatch,
    manifest: contextManifest,
    currentContext,
    agentContract,
    skills,
  });
  if (!binding.ok) {
    assert.fail(binding.diagnostics[0]?.message ?? "Phase binding failed");
  }
  assert.equal(binding.binding.taskId, TASK_ID);
  assert.equal(
    binding.binding.expectedTaskVersion,
    replayed.state.projection.version,
  );

  const graphRequest = { contractVersion: 1, graph: initiativeGraph } as const;
  const graphResult = coreContract.validateDependencyGraph(graphRequest);
  assert.equal(graphResult.ok, true);
  assert.deepEqual(validateCliDependencyGraph(graphRequest), graphResult);
  assert.deepEqual(validateOmpDependencyGraph(graphRequest), graphResult);

  const recordRequests = [
    { contractVersion: 1, kind: "externalReference", record: externalReference },
    { contractVersion: 1, kind: "knowledgeCandidate", record: knowledgeCandidate },
    { contractVersion: 1, kind: "skillLock", record: skillLock },
    { contractVersion: 1, kind: "managedFile", record: managedFile },
  ] as const;
  for (const request of recordRequests) {
    const recordResult = coreContract.validateContractRecord(request);
    assert.equal(recordResult.ok, true, request.kind);
    assert.deepEqual(validateCliContractRecord(request), recordResult);
    assert.deepEqual(validateOmpContractRecord(request), recordResult);
  }

  const agentResult = {
    schemaVersion: 1,
    dispatchId: dispatch.dispatchId,
    taskId: TASK_ID,
    expectedTaskVersion: replayed.state.projection.version,
    phase: dispatch.phase,
    agentRole: dispatch.agentRole,
    contextManifestIdentity: dispatch.contextManifestIdentity,
    agentContractIdentity: dispatch.agentContractIdentity,
    outcome: "succeeded",
    artifacts: [],
    evidence: [evidenceRecord.id],
    findings: [],
    observedFinalFingerprint: FINGERPRINT,
  } as const;
  const versionedFixtures: readonly (readonly [string, unknown])[] = [
    ["Task Projection", replayed.state.projection],
    ["Workflow Event", advanced.event],
    ...contextManifest.map((entry) => ["Context Entry", entry] as const),
    ["Baseline", baseline],
    ["Lease", lease],
    ["Agent Contract", agentContract],
    ["Agent dispatch", dispatch],
    ["Agent result", agentResult],
    ["Evidence", evidenceRecord],
    ["Dependency Graph", initiativeGraph],
    ["External Reference", externalReference],
    ["Knowledge Candidate", knowledgeCandidate],
    ["Skill Lock", skillLock],
    ["project manifest", projectManifest],
    ["managed-file record", managedFile],
  ];
  for (const [name, fixture] of versionedFixtures) {
    const result = coreContract.validateDomainValue({
      contractVersion: 1,
      kind: "recordEnvelope",
      value: fixture,
    });
    assert.equal(result.ok, true, name);
  }
});

test("AC-0002: Route matrices declare Gates and reject undeclared transitions", () => {
  const expectedPhases = {
    quick: ["triage", "implement", "review", "finish"],
    build: ["triage", "explore", "plan", "implement", "review", "finish"],
    initiative: ["triage", "explore", "plan", "integrate", "finish"],
  } as const;

  for (const route of ["quick", "build", "initiative"] as const) {
    const definition = coreContract.readRouteDefinition(route);
    assert.deepEqual(definition.phases, expectedPhases[route]);
    const declaredPhases = new Set<string>(definition.phases);
    const declaredTransitions = new Set<string>();
    for (const transition of definition.transitions) {
      assert.ok(transition.requiredGates.length > 0);
      assert.ok(declaredPhases.has(transition.from.phase));
      assert.ok(declaredPhases.has(transition.to.phase));
      declaredTransitions.add(JSON.stringify([transition.from, transition.to]));
    }
    assert.equal(declaredTransitions.size, definition.transitions.length);
  }

  const started = coreContract.startWorkflowTask(
    buildTaskRequest("TASK-7-UNDECLARED", "UNDECLARED-CREATED"),
  );
  if (!started.ok) {
    assert.fail(started.diagnostics[0]?.message ?? "Task creation failed");
  }
  const rejected = coreContract.transitionWorkflow(started.state, {
    contractVersion: 1,
    taskId: started.state.projection.id,
    expectedVersion: started.state.projection.version,
    to: { lifecycle: "active", phase: "review", step: "ready" },
    gates: [],
    event: eventMetadata("EVENT-TASK-7-UNDECLARED", "UNDECLARED"),
  });
  assert.equal(rejected.ok, false);
  if (!rejected.ok) {
    assert.equal(rejected.diagnostics[0]?.code, "workflow.transition.illegal");
    assert.strictEqual(rejected.state, started.state);
  }
});

test("AC-0003: accepted specifications use the SayHi domain vocabulary", () => {
  const domainLanguage = readRepositoryFile("CONTEXT.md");
  const acceptedSpecifications = [
    "docs/spec/architecture.md",
    "docs/spec/data-contracts.md",
    "docs/spec/security.md",
    "docs/spec/workflow.md",
  ]
    .map(readRepositoryFile)
    .join("\n");
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
  const requiredUsage = [
    /\bRoute\b/u,
    /\bPhase\b/u,
    /\blifecycle\b/u,
    /\bTask\b/u,
    /\bProjection\b/u,
    /\bWorkflow Event\b/u,
    /\bContext Manifest\b/u,
    /\bPhase Agent\b/u,
    /\bWriter Lease\b/u,
    /\btrust tiers?\b/iu,
  ];
  for (const usage of requiredUsage) {
    assert.match(acceptedSpecifications, usage);
  }
});

test("AC-0004: provenance checks preserve the clean-room boundary", () => {
  const packageFiles = [
    "package.json",
    "packages/core/package.json",
    "packages/cli/package.json",
    "packages/omp-plugin/package.json",
    "packages/testing/package.json",
  ];
  for (const packageFile of packageFiles) {
    const manifest = JSON.parse(readRepositoryFile(packageFile)) as {
      readonly dependencies?: Readonly<Record<string, string>>;
      readonly devDependencies?: Readonly<Record<string, string>>;
    };
    const dependencyNames = [
      ...Object.keys(manifest.dependencies ?? {}),
      ...Object.keys(manifest.devDependencies ?? {}),
    ];
    for (const dependencyName of dependencyNames) {
      assert.doesNotMatch(dependencyName, /(?:trellis|oh-my-pi)/iu, packageFile);
    }
  }

  for (const sourceFile of collectTypeScriptSources(join(REPOSITORY_ROOT, "packages"))) {
    const imports = sourceFile.source.matchAll(
      /(?:\bfrom\s+|\bimport\s*\()\s*["']([^"']+)["']/gu,
    );
    for (const match of imports) {
      const specifier = match[1];
      assert.ok(specifier, sourceFile.path);
      assert.doesNotMatch(
        specifier,
        /(?:trellis|oh-my-pi)/iu,
        sourceFile.path,
      );
    }
  }

  const readme = readRepositoryFile("README.md");
  const references = readRepositoryFile("docs/references.md");
  assert.match(readme, /## Clean-room boundary/u);
  assert.match(readme, /MUST NOT copy or adapt OMP or Trellis/u);
  assert.match(references, /## Trellis/u);
  assert.match(references, /## Oh-My-Pi/u);
  assert.match(references, /does not reuse Trellis code/u);
});

test("AC-0005: security review exposes authority, trust, failure, and residual risk", () => {
  const security = readRepositoryFile("docs/spec/security.md");
  const objectives = markdownSection(security, "## 1. Security objectives");
  const trustBoundaries = markdownSection(security, "## 3. Trust boundaries");
  const authority = markdownSection(security, "## 4. Authority model");
  const failClosed = markdownSection(security, "## 17. Fail-closed matrix");
  const residualRisks = markdownSection(
    security,
    "## 18. Explicit residual risks",
  );

  assert.equal(
    objectives.split("\n").filter((line) => line.startsWith("- ")).length,
    8,
  );
  assert.match(trustBoundaries, /Orchestrator and Phase Agent/u);
  assert.match(trustBoundaries, /local state and external Trackers/u);
  assert.match(authority, /Core alone accepts transitions/u);
  assert.match(authority, /Humans approve persistent workflow entry/u);
  assert.ok(
    failClosed
      .split("\n")
      .filter((line) => line.startsWith("|") && !line.includes("---"))
      .length >= 9,
  );
  assert.match(failClosed, /Agent identity mismatch \| block dispatch/u);
  assert.match(failClosed, /output schema invalid \| reject Gate evidence/u);
  assert.ok(
    residualRisks.split("\n").filter((line) => line.startsWith("- ")).length >=
      6,
  );
  assert.match(residualRisks, /cannot be prevented, only detected/u);
});

function buildTaskRequest(taskId: string, eventSuffix: string) {
  return {
    contractVersion: 1,
    task: {
      id: taskId,
      title: "Prove the Milestone 0 executable design baseline",
      route: "build",
      parentTaskId: null,
      initiativeGraphId: null,
      intent: {
        goals: ["Prove every Milestone 0 contract interoperates"],
        nonGoals: ["Implement Foundation runtime behavior"],
        acceptanceCriteria: ["Every Milestone 0 acceptance check passes"],
      },
      scope: {
        files: ["packages/testing/**"],
        apis: ["CoreContract"],
        schemas: ["milestone-zero"],
        locks: ["package-lock.json"],
      },
      baselineRef: "baseline.json",
      contexts: { explore: "context/explore.jsonl" },
      policies: { commit: "never", push: "never", maxRepairAttempts: 2 },
    },
    routeGate: {
      gate: "route",
      evidence: [
        {
          kind: "human-approval",
          reference: "evidence/build-route-accepted.json",
        },
      ],
    },
    event: eventMetadata(`EVENT-TASK-7-${eventSuffix}`, eventSuffix),
  } as const;
}

function eventMetadata(eventId: string, suffix: string) {
  return {
    eventId,
    actor: {
      kind: "orchestrator",
      id: "sayhi-contract-suite",
      sessionRef: "SESSION-7",
    },
    reason: `Accept ${suffix}`,
    idempotencyKey: `IDEMPOTENCY-${suffix}`,
    occurredAt: "2026-07-14T16:00:00Z",
  } as const;
}

function readRepositoryFile(relativePath: string): string {
  return readFileSync(join(REPOSITORY_ROOT, relativePath), "utf8");
}

function collectTypeScriptSources(
  directory: string,
): readonly Readonly<{ path: string; source: string }>[] {
  const sources: Readonly<{ path: string; source: string }>[] = [];
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) {
      sources.push(...collectTypeScriptSources(path));
    } else if (entry.isFile() && entry.name.endsWith(".ts")) {
      sources.push({ path, source: readFileSync(path, "utf8") });
    }
  }
  return sources;
}

function markdownSection(markdown: string, heading: string): string {
  const start = markdown.indexOf(heading);
  assert.notEqual(start, -1, heading);
  const nextHeading = markdown.indexOf("\n## ", start + heading.length);
  return markdown.slice(start, nextHeading === -1 ? undefined : nextHeading);
}
