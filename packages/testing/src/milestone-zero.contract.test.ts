import assert from "node:assert/strict";
import test from "node:test";

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
const HASH_A = { algorithm: "sha256-lf-v1", digest: "a".repeat(64) } as const;
const HASH_B = { algorithm: "sha256-bytes-v1", digest: "b".repeat(64) } as const;
const CONTRACT_IDENTITY_A = `sha256:${"a".repeat(64)}` as const;
const FINGERPRINT = `sha256:${"f".repeat(64)}` as const;

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
  baseFingerprint: FINGERPRINT,
  requestedAt: "2026-07-14T16:00:00Z",
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
  dirtyPaths: [],
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
  const taskDomainRequest = {
    contractVersion: 1,
    kind: "identifier",
    value: taskRequest.task.id,
  } as const;
  const domainResult = coreContract.validateDomainValue(taskDomainRequest);
  assert.equal(domainResult.ok, true);
  assert.deepEqual(validateCliDomainValue(taskDomainRequest), domainResult);
  assert.deepEqual(validateOmpDomainValue(taskDomainRequest), domainResult);
  const malformedTask = coreContract.startWorkflowTask({
    ...taskRequest,
    task: { ...taskRequest.task, route: "unmanaged" },
  } as never);
  assert.equal(malformedTask.ok, false);
  if (!malformedTask.ok) {
    assert.equal(malformedTask.diagnostics[0]?.code, "workflow.request.invalid");
  }

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

  const agentResult = {
    schemaVersion: 1,
    dispatchId: dispatch.dispatchId,
    taskId: TASK_ID,
    expectedTaskVersion: replayed.state.projection.version,
    phase: dispatch.phase,
    agentRole: dispatch.agentRole,
    contextManifestIdentity: dispatch.contextManifestIdentity,
    agentContractIdentity: dispatch.agentContractIdentity,
    baseFingerprint: dispatch.baseFingerprint,
    outcome: "succeeded",
    artifacts: [],
    evidence: [evidenceRecord.id],
    findings: [],
    observedFinalFingerprint: FINGERPRINT,
  } as const;
  const recordRequests = [
    { contractVersion: 1, kind: "baseline", record: baseline },
    { contractVersion: 1, kind: "lease", record: lease },
    { contractVersion: 1, kind: "agentResult", record: agentResult },
    { contractVersion: 1, kind: "evidence", record: evidenceRecord },
    { contractVersion: 1, kind: "projectManifest", record: projectManifest },
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

  assert.equal(replayed.state.projection.schemaVersion, 1);
  assert.equal(advanced.event.schemaVersion, 1);
  for (const entry of contextManifest) {
    assert.equal(entry.schemaVersion, 1);
  }
  assert.equal(agentContract.schemaVersion, 1);
  assert.equal(dispatch.schemaVersion, 1);
  assert.equal(initiativeGraph.schemaVersion, 1);
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

