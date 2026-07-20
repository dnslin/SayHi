import { createHash } from "node:crypto";
import assert from "node:assert/strict";
import test from "node:test";

import {
  coreContract,
  readGateEvidenceKinds,
  type DependencyGraph,
  type ContractIdentity,
  type StartWorkflowTaskRequest,
  type WorkflowGate,
  type WorkflowRoute,
  type WorkflowEvent,
  type WorkflowState,
  type WorkflowTransition,
} from "@dnslin/sayhi-core";

const SKILL_LOCK_IDENTITY = `sha256:${"c".repeat(64)}` as ContractIdentity;

const routeTransitions = {
  quick: [
    transition("active", "triage", "active", "implement", "route"),
    transition("active", "implement", "active", "review", "implement"),
    transition(
      "active",
      "review",
      "active",
      "implement",
      "review-repair",
    ),
    transition("active", "review", "active", "finish", "review"),
    transition("active", "finish", "completed", "finish", "finish"),
    ...lifecycleTransitions(["triage", "implement", "review", "finish"]),
  ],
  build: [
    transition("active", "triage", "active", "explore", "route"),
    transition("active", "explore", "active", "plan", "explore"),
    transition("active", "plan", "active", "implement", "plan"),
    transition("active", "implement", "active", "plan", "replan"),
    transition("active", "implement", "active", "review", "implement"),
    transition(
      "active",
      "review",
      "active",
      "implement",
      "review-repair",
    ),
    transition("active", "review", "active", "finish", "review"),
    transition("active", "finish", "completed", "finish", "finish"),
    ...lifecycleTransitions([
      "triage",
      "explore",
      "plan",
      "implement",
      "review",
      "finish",
    ]),
  ],
  initiative: [
    transition("active", "triage", "active", "explore", "route"),
    transition("active", "explore", "active", "plan", "explore"),
    transition(
      "active",
      "plan",
      "active",
      "integrate",
      "plan",
      "initiative-ready",
    ),
    transition("active", "integrate", "active", "finish", "integrate"),
    transition("active", "finish", "completed", "finish", "finish"),
    ...lifecycleTransitions(["triage", "explore", "plan", "integrate", "finish"]),
  ],
} as const satisfies Readonly<Record<WorkflowRoute, readonly WorkflowTransition[]>>;

const routePhases = {
  quick: ["triage", "implement", "review", "finish"],
  build: ["triage", "explore", "plan", "implement", "review", "finish"],
  initiative: ["triage", "explore", "plan", "integrate", "finish"],
} as const;

const happyTargets = {
  quick: [
    ["active", "implement"],
    ["active", "review"],
    ["active", "implement"],
    ["active", "review"],
    ["active", "finish"],
    ["completed", "finish"],
  ],
  build: [
    ["active", "explore"],
    ["active", "plan"],
    ["active", "implement"],
    ["active", "plan"],
    ["active", "implement"],
    ["active", "review"],
    ["active", "implement"],
    ["active", "review"],
    ["active", "finish"],
    ["completed", "finish"],
  ],
  initiative: [
    ["active", "explore"],
    ["active", "plan"],
    ["active", "integrate"],
    ["active", "finish"],
    ["completed", "finish"],
  ],
} as const;

test("Core exposes only the permitted Route transitions and their required Gates", () => {
  for (const route of ["quick", "build", "initiative"] as const) {
    assert.deepEqual(coreContract.readRouteDefinition(route), {
      route,
      phases: routePhases[route],
      transitions: routeTransitions[route],
    });
  }
});

test("accepted Quick, Build, and Initiative Events replay to the same Task Projection", () => {
  for (const route of ["quick", "build", "initiative"] as const) {
    let state = startTask(route);

    for (const [lifecycle, phase] of happyTargets[route]) {
      state = advanceTask(
        state,
        lifecycle,
        phase,
        `${route}-${state.projection.version + 1}`,
      );
    }

    assert.equal(state.projection.lifecycle, "completed");
    assert.equal(state.projection.phase, "finish");
    assert.equal(state.projection.version, state.events.length);

    const replayed = coreContract.replayWorkflowEvents(state.events);
    assert.equal(replayed.ok, true);
    if (replayed.ok) {
      assert.deepEqual(replayed.state.projection, state.projection);
      assert.deepEqual(replayed.state.events, state.events);
    }
  }
});

test("an accepted Quick escalation preserves Task continuity and replays as a Build", () => {
  const start = startTaskRequest("quick");
  const created = coreContract.startWorkflowTask({
    ...start,
    task: {
      ...start.task,
      contexts: {
        triage: "context/triage.jsonl",
        implement: "context/implement.jsonl",
      },
    },
  });
  assert.equal(created.ok, true);
  if (!created.ok) {
    return;
  }

  const request = {
    contractVersion: 1 as const,
    taskId: created.state.projection.id,
    expectedVersion: created.state.projection.version,
    routeGate: {
      gate: "route" as const,
      evidence: [
        {
          kind: "human-approval" as const,
          reference: "evidence/build-route-approved.json",
        },
      ],
    },
    event: eventMetadata("quick-escalated"),
  };
  const accepted = coreContract.escalateQuickToBuild(created.state, request);
  assert.equal(accepted.ok, true);
  if (!accepted.ok) {
    return;
  }

  assert.equal(accepted.event.type, "route_escalated");
  assert.equal(accepted.event.route, "build");
  assert.equal(accepted.state.projection.route, "build");
  assert.deepEqual(accepted.state.projection, {
    ...created.state.projection,
    route: "build",
    phase: "explore",
    updatedAt: accepted.event.occurredAt,
    version: 2,
    eventHead: {
      sequence: 2,
      eventId: accepted.event.eventId,
      chainDigest: accepted.event.chainDigest,
    },
  });

  const replayed = coreContract.replayWorkflowEvents(accepted.state.events);
  assert.equal(replayed.ok, true);
  if (replayed.ok) {
    assert.deepEqual(replayed.state, accepted.state);
  }

  const retried = coreContract.escalateQuickToBuild(accepted.state, request);
  assert.equal(retried.ok, true);
  if (retried.ok) {
    assert.strictEqual(retried.state, accepted.state);
    assert.strictEqual(retried.event, accepted.event);
    assert.equal(retried.state.events.length, 2);
  }
});

test("Quick escalation remains resumable after declined Route approval and requires Build Plan approval", () => {
  const quick = startTask("quick");
  const declined = coreContract.escalateQuickToBuild(quick, {
    contractVersion: 1,
    taskId: quick.projection.id,
    expectedVersion: quick.projection.version,
    routeGate: {
      gate: "route",
      evidence: [{ kind: "workflow", reference: "evidence/route-proposed.json" }],
    },
    event: eventMetadata("quick-escalation-declined"),
  });
  assert.equal(declined.ok, false);
  if (!declined.ok) {
    assert.strictEqual(declined.state, quick);
    assert.equal(declined.diagnostics[0]?.code, "workflow.gate.evidence_invalid");
  }

  const accepted = coreContract.escalateQuickToBuild(quick, {
    contractVersion: 1,
    taskId: quick.projection.id,
    expectedVersion: quick.projection.version,
    routeGate: {
      gate: "route",
      evidence: [
        { kind: "human-approval", reference: "evidence/build-route-approved.json" },
      ],
    },
    event: eventMetadata("quick-escalation-accepted"),
  });
  assert.equal(accepted.ok, true);
  if (!accepted.ok) {
    return;
  }
  assert.equal(accepted.state.events.length, 2);

  const planning = advanceTask(
    accepted.state,
    "active",
    "plan",
    "escalated-explore-complete",
  );
  const unapprovedImplementation = coreContract.transitionWorkflow(planning, {
    contractVersion: 1,
    taskId: planning.projection.id,
    expectedVersion: planning.projection.version,
    to: { lifecycle: "active", phase: "implement", step: "ready" },
    gates: [],
    event: eventMetadata("escalated-plan-unapproved"),
  });
  assert.equal(unapprovedImplementation.ok, false);
  if (!unapprovedImplementation.ok) {
    assert.strictEqual(unapprovedImplementation.state, planning);
    assert.equal(unapprovedImplementation.diagnostics[0]?.code, "workflow.gate.unmet");
  }

  const implementing = advanceTask(
    planning,
    "active",
    "implement",
    "escalated-plan-approved",
  );
  assert.equal(implementing.projection.phase, "implement");
});

test("Core seals a Build Plan transition without durable Plan authority", () => {
  let state = startTask("build");
  state = advanceTask(state, "active", "explore", "sealed-plan-explore");
  state = advanceTask(state, "active", "plan", "sealed-plan-plan");
  const bypass = coreContract.transitionWorkflow(state, {
    contractVersion: 1,
    taskId: state.projection.id,
    expectedVersion: state.projection.version,
    to: { lifecycle: "active", phase: "implement", step: "ready" },
    gates: [
      {
        gate: "plan",
        evidence: [
          {
            kind: "human-approval",
            reference: "plans/forged-plan.json",
          },
        ],
      },
    ],
    event: eventMetadata("sealed-plan-bypass"),
  });

  assert.equal(bypass.ok, false);
  const replayBypassPayload = {
    schemaVersion: state.events[0]!.schemaVersion,
    eventId: "EVENT-sealed-plan-replay-bypass",
    taskId: state.projection.id,
    route: "build",
    sequence: state.projection.version + 1,
    previousChainDigest: state.events.at(-1)!.chainDigest,
    type: "workflow_transitioned",
    from: {
      lifecycle: state.projection.lifecycle,
      phase: state.projection.phase,
      step: state.projection.step,
    },
    to: { lifecycle: "active", phase: "implement", step: "ready" },
    actor: { kind: "orchestrator", id: "sayhi-test", sessionRef: "session-test" },
    outcome: "accepted",
    gates: [
      {
        gate: "plan",
        evidence: [
          {
            kind: "human-approval",
            reference: "plans/forged-plan.json",
          },
        ],
      },
    ],
    blockers: state.projection.blockers,
    initiativeGraph: null,
    reason: "Accept sealed-plan-replay-bypass",
    idempotencyKey: "IDEMPOTENCY-sealed-plan-replay-bypass",
    occurredAt: "2026-07-15T12:00:00Z",
  };
  const replayBypassEvent = {
    ...replayBypassPayload,
    chainDigest: digestReplayEvent(replayBypassPayload),
  } as unknown as WorkflowEvent;
  const replayBypass = coreContract.replayWorkflowEvents([
    ...state.events,
    replayBypassEvent,
  ]);
  assert.equal(replayBypass.ok, false);
});

test("Core rejects malformed Build Plan record metadata without throwing", () => {
  let state = startTask("build");
  state = advanceTask(state, "active", "explore", "malformed-plan-explore");
  state = advanceTask(state, "active", "plan", "malformed-plan-ready");
  const contextManifestIdentity: ContractIdentity = `sha256:${"e".repeat(64)}`;
  const frozen = coreContract.recordContextManifestChange(state, {
    contractVersion: 1,
    taskId: state.projection.id,
    expectedVersion: state.projection.version,
    phase: "implement",
    manifestPath: "context/implement.jsonl",
    manifestIdentity: contextManifestIdentity,
    change: "frozen",
    event: eventMetadata("malformed-plan-context"),
  });
  assert.equal(frozen.ok, true);
  if (!frozen.ok) {
    return;
  }
  const recorded = coreContract.recordBuildPlanChange(frozen.state, {
    contractVersion: 1,
    taskId: frozen.state.projection.id,
    expectedVersion: frozen.state.projection.version,
    change: "recorded",
    planIdentity: `sha256:${"f".repeat(64)}` as ContractIdentity,
    requirementsIdentity: hashTestValue(frozen.state.projection.intent),
    contextManifestPath: "context/implement.jsonl",
    contextManifestIdentity,
    event: undefined as never,
  });
  assert.equal(recorded.ok, false);
  if (!recorded.ok) {
    assert.equal(recorded.diagnostics[0]?.code, "workflow.request.invalid");
  }
});

test("Core and replay reject decisions for a superseded Build Plan", () => {
  let state = startTask("build");
  state = advanceTask(state, "active", "explore", "superseded-core-explore");
  state = advanceTask(state, "active", "plan", "superseded-core-plan");
  const original = establishBuildPlanAuthority(state, "superseded-core-original");
  const revisedPlanIdentity: ContractIdentity = `sha256:${"a".repeat(64)}`;
  const revised = coreContract.recordBuildPlanChange(original.state, {
    contractVersion: 1,
    taskId: original.state.projection.id,
    expectedVersion: original.state.projection.version,
    change: "recorded",
    planIdentity: revisedPlanIdentity,
    requirementsIdentity: hashTestValue(original.state.projection.intent),
    contextManifestPath: "context/implement.jsonl",
    contextManifestIdentity: original.contextManifestIdentity,
    event: eventMetadata("superseded-core-revised"),
  });
  assert.equal(revised.ok, true);
  if (!revised.ok) {
    return;
  }
  const staleRejection = coreContract.recordBuildPlanChange(revised.state, {
    contractVersion: 1,
    taskId: revised.state.projection.id,
    expectedVersion: revised.state.projection.version,
    change: "rejected",
    planIdentity: original.planIdentity,
    requirementsIdentity: hashTestValue(revised.state.projection.intent),
    contextManifestPath: "context/implement.jsonl",
    contextManifestIdentity: original.contextManifestIdentity,
    event: {
      ...eventMetadata("superseded-core-rejection"),
      actor: { kind: "user", id: "reviewer-42", sessionRef: "review-session" },
    },
  });
  assert.equal(staleRejection.ok, false);
  if (!staleRejection.ok) {
    assert.equal(staleRejection.diagnostics[0]?.code, "workflow.transition.illegal");
  }
  const staleApproval = coreContract.transitionWorkflow(revised.state, {
    contractVersion: 1,
    taskId: revised.state.projection.id,
    expectedVersion: revised.state.projection.version,
    to: { lifecycle: "active", phase: "implement", step: "ready" },
    gates: [
      {
        gate: "plan",
        evidence: [
          {
            kind: "human-approval",
            reference: `plans/${original.planIdentity.slice("sha256:".length)}.json`,
          },
          {
            kind: "human-approval",
            reference: `context/implement.jsonl#${original.contextManifestIdentity}`,
          },
        ],
      },
    ],
    event: {
      ...eventMetadata("superseded-core-approval"),
      actor: { kind: "user", id: "reviewer-42", sessionRef: "review-session" },
    },
  });
  assert.equal(staleApproval.ok, false);
  if (!staleApproval.ok) {
    assert.equal(staleApproval.diagnostics[0]?.code, "workflow.gate.evidence_invalid");
  }
  const position = {
    lifecycle: revised.state.projection.lifecycle,
    phase: revised.state.projection.phase,
    step: revised.state.projection.step,
  };
  const staleRejectionPayload = {
    schemaVersion: revised.state.events[0]!.schemaVersion,
    eventId: "EVENT-superseded-core-replay-rejection",
    taskId: revised.state.projection.id,
    route: "build",
    sequence: revised.state.projection.version + 1,
    previousChainDigest: revised.state.events.at(-1)!.chainDigest,
    type: "build_plan_changed",
    from: position,
    to: position,
    actor: { kind: "user", id: "reviewer-42", sessionRef: "review-session" },
    outcome: "accepted",
    gates: [],
    blockers: revised.state.projection.blockers,
    initiativeGraph: null,
    reason: "Reject superseded Plan.",
    idempotencyKey: "IDEMPOTENCY-superseded-core-replay-rejection",
    occurredAt: "2026-07-15T12:10:00Z",
    change: "rejected",
    planIdentity: original.planIdentity,
    requirementsIdentity: hashTestValue(revised.state.projection.intent),
    contextManifestPath: "context/implement.jsonl",
    contextManifestIdentity: original.contextManifestIdentity,
  };
  const staleRejectionEvent = {
    ...staleRejectionPayload,
    chainDigest: digestReplayEvent(staleRejectionPayload),
  } as unknown as WorkflowEvent;
  const replayed = coreContract.replayWorkflowEvents([
    ...revised.state.events,
    staleRejectionEvent,
  ]);
  assert.equal(replayed.ok, false);
});

test("illegal, stale, and unmet-Gate transitions preserve the prior workflow state", () => {
  const state = startTask("build");
  const snapshot = structuredClone(state);
  const routeGate = [
    {
      gate: "route" as const,
      evidence: [
        {
          kind: "human-approval" as const,
          reference: "evidence/route-approved.json",
        },
      ],
    },
  ];
  const attempts = [
    {
      request: {
        contractVersion: 1 as const,
        taskId: state.projection.id,
        expectedVersion: state.projection.version,
        to: { lifecycle: "active" as const, phase: "implement" as const, step: "ready" },
        gates: routeGate,
        event: eventMetadata("illegal"),
      },
      code: "workflow.transition.illegal",
    },
    {
      request: {
        contractVersion: 1 as const,
        taskId: state.projection.id,
        expectedVersion: state.projection.version - 1,
        to: { lifecycle: "active" as const, phase: "explore" as const, step: "ready" },
        gates: routeGate,
        event: eventMetadata("stale"),
      },
      code: "workflow.version.stale",
    },
    {
      request: {
        contractVersion: 1 as const,
        taskId: state.projection.id,
        expectedVersion: state.projection.version,
        to: { lifecycle: "active" as const, phase: "explore" as const, step: "ready" },
        gates: [],
        event: eventMetadata("ungated"),
      },
      code: "workflow.gate.unmet",
    },
    {
      request: {
        contractVersion: 1 as const,
        taskId: state.projection.id,
        expectedVersion: state.projection.version,
        to: { lifecycle: "active" as const, phase: "explore" as const, step: "ready" },
        gates: [{ gate: "route" as const, evidence: [] }],
        event: eventMetadata("evidence-free"),
      },
      code: "workflow.gate.evidence_invalid",
    },
  ];

  for (const { request, code } of attempts) {
    const result = coreContract.transitionWorkflow(state, request);

    assert.equal(result.ok, false);
    if (!result.ok) {
      assert.strictEqual(result.state, state);
      assert.equal(result.diagnostics[0]?.code, code);
    }
    assert.deepEqual(state, snapshot);
  }
});

test("an idempotent transition retry returns the accepted result without another Event", () => {
  const started = startTask("build");
  const request = {
    contractVersion: 1 as const,
    taskId: started.projection.id,
    expectedVersion: started.projection.version,
    to: { lifecycle: "active" as const, phase: "explore" as const, step: "ready" },
    gates: [
      {
        gate: "route" as const,
        evidence: [
          {
            kind: "human-approval" as const,
            reference: "evidence/route-approved.json",
          },
        ],
      },
    ],
    event: eventMetadata("idempotent"),
  };
  const accepted = coreContract.transitionWorkflow(started, request);
  assert.equal(accepted.ok, true);
  if (!accepted.ok) {
    return;
  }

  const retried = coreContract.transitionWorkflow(accepted.state, request);
  assert.equal(retried.ok, true);
  if (retried.ok) {
    assert.strictEqual(retried.state, accepted.state);
    assert.strictEqual(retried.event, accepted.event);
    assert.equal(retried.state.events.length, 2);
  }

  const conflicting = coreContract.transitionWorkflow(accepted.state, {
    ...request,
    event: { ...request.event, reason: "Different transition intent" },
  });
  assert.equal(conflicting.ok, false);
  if (!conflicting.ok) {
    assert.strictEqual(conflicting.state, accepted.state);
    assert.equal(
      conflicting.diagnostics[0]?.code,
      "workflow.event.idempotency_conflict",
    );
  }
});

test("a Projection position inconsistent with its Event head cannot advance", () => {
  const state = startTask("build");
  const inconsistentState: WorkflowState = {
    events: state.events,
    projection: { ...state.projection, phase: "plan" },
  };
  const snapshot = structuredClone(inconsistentState);
  const result = coreContract.transitionWorkflow(inconsistentState, {
    contractVersion: 1,
    taskId: inconsistentState.projection.id,
    expectedVersion: inconsistentState.projection.version,
    to: { lifecycle: "active", phase: "implement", step: "ready" },
    gates: [
      {
        gate: "plan",
        evidence: [
          {
            kind: "human-approval",
            reference: "evidence/plan-approved.json",
          },
        ],
      },
    ],
    event: eventMetadata("inconsistent"),
  });

  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.strictEqual(result.state, inconsistentState);
    assert.equal(result.diagnostics[0]?.code, "workflow.state.inconsistent");
  }
  assert.deepEqual(inconsistentState, snapshot);
});

test("mutation rejects a Task whose earlier Event history is invalid", () => {
  let state = startTask("build");
  state = advanceTask(state, "active", "explore", "history-explore");
  const forgedState: WorkflowState = {
    events: [
      { ...state.events[0]!, reason: "tampered after acceptance" },
      state.events[1]!,
    ],
    projection: state.projection,
  };
  const snapshot = structuredClone(forgedState);
  const result = coreContract.transitionWorkflow(forgedState, {
    contractVersion: 1,
    taskId: forgedState.projection.id,
    expectedVersion: forgedState.projection.version,
    to: { lifecycle: "active", phase: "plan", step: "ready" },
    gates: [
      {
        gate: "explore",
        evidence: [
          { kind: "validation", reference: "evidence/explore-complete.json" },
        ],
      },
    ],
    event: eventMetadata("forged-history"),
  });

  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.strictEqual(result.state, forgedState);
    assert.equal(result.diagnostics[0]?.code, "workflow.state.inconsistent");
  }
  assert.deepEqual(forgedState, snapshot);
});

test("Route transitions reject undeclared target Steps", () => {
  const state = startTask("build");
  const snapshot = structuredClone(state);
  const result = coreContract.transitionWorkflow(state, {
    contractVersion: 1,
    taskId: state.projection.id,
    expectedVersion: state.projection.version,
    to: { lifecycle: "active", phase: "explore", step: "invented" },
    gates: [
      {
        gate: "route",
        evidence: [
          { kind: "human-approval", reference: "evidence/route-approved.json" },
        ],
      },
    ],
    event: eventMetadata("undeclared-step"),
  });

  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.strictEqual(result.state, state);
    assert.equal(result.diagnostics[0]?.code, "workflow.transition.illegal");
  }
  assert.deepEqual(state, snapshot);
});

test("Task creation rejects repair policies above the Engine limit", () => {
  const result = coreContract.startWorkflowTask(startTaskRequest("build", 3));

  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.equal(result.diagnostics[0]?.code, "workflow.request.invalid");
  }
});

test("Task creation rejects repository paths that escape Task Scope", () => {
  const request = startTaskRequest("build");
  const result = coreContract.startWorkflowTask({
    ...request,
    task: {
      ...request.task,
      scope: { ...request.task.scope, files: ["../outside.ts"] },
    },
  });

  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.equal(result.diagnostics[0]?.code, "workflow.request.invalid");
    assert.equal(result.diagnostics[0]?.path, "$.task.scope.files[0]");
  }
});

test("Build and Initiative creation require Route confirmation", () => {
  for (const route of ["build", "initiative"] as const) {
    const request = startTaskRequest(route);
    const { routeGate, ...unconfirmed } = request;
    assert.ok(routeGate);
    const result = coreContract.startWorkflowTask(unconfirmed);

    assert.equal(result.ok, false);
    if (!result.ok) {
      assert.equal(result.diagnostics[0]?.code, "workflow.gate.unmet");
      assert.equal(result.diagnostics[0]?.path, "$.routeGate");
    }
  }
});

test("Initiative cannot leave Plan without a validated graph snapshot", () => {
  let state = startTask("initiative");
  state = advanceTask(state, "active", "explore", "graph-explore");
  state = advanceTask(state, "active", "plan", "graph-plan");
  const snapshot = structuredClone(state);
  const transitionGates = [
    {
      gate: "plan",
      evidence: [
        { kind: "human-approval", reference: "evidence/plan-approved.json" },
      ],
    },
    {
      gate: "initiative-ready",
      evidence: [{ kind: "workflow", reference: "evidence/graph-ready.json" }],
    },
  ] as const;
  const result = coreContract.transitionWorkflow(state, {
    contractVersion: 1,
    taskId: state.projection.id,
    expectedVersion: state.projection.version,
    to: { lifecycle: "active", phase: "integrate", step: "ready" },
    gates: transitionGates,
    event: eventMetadata("graph-missing"),
  });

  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.strictEqual(result.state, state);
    assert.equal(result.diagnostics[0]?.code, "workflow.gate.unmet");
    assert.equal(result.diagnostics[0]?.path, "$.initiativeGraph");
  }

  const graphBase = {
    schemaVersion: 1 as const,
    id: state.projection.initiativeGraphId!,
    initiativeTaskId: state.projection.id,
    version: 1,
    nodes: [
      {
        taskId: "TASK-3-node-a",
        priority: 50,
        resources: {
          files: ["packages/core/**"],
          apis: ["CoreContract"],
          schemas: [],
          locks: [],
        },
      },
      {
        taskId: "TASK-3-node-b",
        priority: 40,
        resources: { files: [], apis: [], schemas: [], locks: [] },
      },
    ],
    edges: [],
    updatedByEvent: state.events[state.events.length - 1]!.eventId,
  };
  const invalidGraphs = [
    {
      name: "cycle",
      code: "dependency_graph.cycle.detected",
      path: "$.initiativeGraph.edges",
      graph: {
        ...graphBase,
        edges: [
          { from: "TASK-3-node-a", to: "TASK-3-node-b", type: "blocks", reason: "a" },
          { from: "TASK-3-node-b", to: "TASK-3-node-a", type: "blocks", reason: "b" },
        ],
      },
    },
    {
      name: "missing-node",
      code: "dependency_graph.edge.reference_missing",
      path: "$.initiativeGraph.edges[0].to",
      graph: {
        ...graphBase,
        edges: [
          {
            from: "TASK-3-node-a",
            to: "TASK-3-missing",
            type: "blocks",
            reason: "missing",
          },
        ],
      },
    },
    {
      name: "unsafe-resource",
      code: "dependency_graph.graph.invalid",
      path: "$.initiativeGraph.nodes[0].resources.files[0]",
      graph: {
        ...graphBase,
        nodes: [
          {
            ...graphBase.nodes[0]!,
            resources: {
              ...graphBase.nodes[0]!.resources,
              files: ["../outside.ts"],
            },
          },
        ],
      },
    },
  ] as const;

  for (const { name, graph, code, path } of invalidGraphs) {
    const request = {
      contractVersion: 1 as const,
      taskId: state.projection.id,
      expectedVersion: state.projection.version,
      to: { lifecycle: "active" as const, phase: "integrate" as const, step: "ready" },
      gates: transitionGates,
      initiativeGraph: graph,
      event: eventMetadata(`graph-${name}`),
    };
    const invalid = coreContract.transitionWorkflow(state, request);
    assert.equal(invalid.ok, false, name);
    if (!invalid.ok) {
      assert.strictEqual(invalid.state, state);
      assert.equal(invalid.diagnostics[0]?.code, code);
      assert.equal(invalid.diagnostics[0]?.path, path);
    }
  }
  assert.deepEqual(state, snapshot);
});

test("Core propagates blocked, cancelled, failed, and repair-required states through blocking edges", () => {
  const ready = startTask("build", 2, "ready");

  let blocked = startTask("build", 2, "blocked");
  blocked = advanceTask(blocked, "blocked", "triage", "blocked", ["Dependency failed."]);

  let cancelled = startTask("build", 2, "cancelled");
  cancelled = advanceTask(cancelled, "cancelled", "triage", "cancelled");

  let failed = startTask("build", 2, "failed");
  failed = advanceTask(failed, "active", "explore", "failed-explore");
  failed = advanceTask(failed, "active", "plan", "failed-plan");
  failed = advanceTask(failed, "active", "implement", "failed-implement");
  failed = recordWorkflowAgentResult(
    failed,
    "implement",
    "implementation",
    "blocked",
    [],
    "failed-result",
  );

  let repair = startTask("build", 2, "repair");
  repair = advanceTask(repair, "active", "explore", "repair-explore");
  repair = advanceTask(repair, "active", "plan", "repair-plan");
  repair = advanceTask(repair, "active", "implement", "repair-implement");
  repair = advanceTask(repair, "active", "review", "repair-review");
  repair = advanceTask(repair, "active", "implement", "repair-required");

  const states = [
    { taskId: ready.projection.id, state: ready },
    { taskId: blocked.projection.id, state: blocked },
    { taskId: `${blocked.projection.id}-dependent`, state: null },
    { taskId: `${blocked.projection.id}-dependent-dependent`, state: null },
    { taskId: cancelled.projection.id, state: cancelled },
    { taskId: `${cancelled.projection.id}-dependent`, state: null },
    { taskId: failed.projection.id, state: failed },
    { taskId: `${failed.projection.id}-dependent`, state: null },
    { taskId: repair.projection.id, state: repair },
    { taskId: `${repair.projection.id}-dependent`, state: null },
  ] as const;
  const graph = {
    schemaVersion: 1,
    id: "GRAPH-3-READINESS",
    initiativeTaskId: "TASK-3-INITIATIVE",
    version: 1,
    nodes: states.map(({ taskId }, index) => ({
      taskId,
      priority: 100 - index,
      resources: { files: [], apis: [], schemas: [], locks: [] },
    })),
    edges: [
      blockingEdge(blocked.projection.id),
      blockingEdge(`${blocked.projection.id}-dependent`),
      blockingEdge(cancelled.projection.id),
      blockingEdge(failed.projection.id),
      blockingEdge(repair.projection.id),
    ],
    updatedByEvent: "EVENT-3-READINESS",
  } as const satisfies DependencyGraph;

  const derived = coreContract.deriveInitiativeReadiness(
    graph,
    states.map(({ taskId, state }) => ({
      taskId,
      state,
      contextState: "valid" as const,
    })),
  );
  assert.deepEqual(derived.frontier, [ready.projection.id]);
  assert.deepEqual(
    derived.nodes.map((node) => ({
      taskId: node.taskId,
      readiness: node.readiness,
      blockerCodes: node.blockers.map((blocker) => blocker.code),
    })),
    [
      { taskId: ready.projection.id, readiness: "ready", blockerCodes: [] },
      {
        taskId: blocked.projection.id,
        readiness: "blocked",
        blockerCodes: ["initiative_readiness.task_blocked"],
      },
      {
        taskId: `${blocked.projection.id}-dependent`,
        readiness: "blocked",
        blockerCodes: [
          "initiative_readiness.task_missing",
          "initiative_readiness.dependency_blocked",
        ],
      },
      {
        taskId: `${blocked.projection.id}-dependent-dependent`,
        readiness: "blocked",
        blockerCodes: [
          "initiative_readiness.task_missing",
          "initiative_readiness.dependency_blocked",
        ],
      },
      {
        taskId: cancelled.projection.id,
        readiness: "blocked",
        blockerCodes: ["initiative_readiness.task_cancelled"],
      },
      {
        taskId: `${cancelled.projection.id}-dependent`,
        readiness: "blocked",
        blockerCodes: [
          "initiative_readiness.task_missing",
          "initiative_readiness.dependency_cancelled",
        ],
      },
      {
        taskId: failed.projection.id,
        readiness: "blocked",
        blockerCodes: ["initiative_readiness.task_failed"],
      },
      {
        taskId: `${failed.projection.id}-dependent`,
        readiness: "blocked",
        blockerCodes: [
          "initiative_readiness.task_missing",
          "initiative_readiness.dependency_failed",
        ],
      },
      {
        taskId: repair.projection.id,
        readiness: "blocked",
        blockerCodes: ["initiative_readiness.task_repair_required"],
      },
      {
        taskId: `${repair.projection.id}-dependent`,
        readiness: "blocked",
        blockerCodes: [
          "initiative_readiness.task_missing",
          "initiative_readiness.dependency_repair_required",
        ],
      },
    ],
  );

  const transitive = derived.nodes.find(
    (node) => node.taskId === `${blocked.projection.id}-dependent-dependent`,
  );
  assert.deepEqual(
    transitive?.blockers.map((blocker) => ({ code: blocker.code, taskId: blocker.taskId })),
    [
      {
        code: "initiative_readiness.task_missing",
        taskId: `${blocked.projection.id}-dependent-dependent`,
      },
      {
        code: "initiative_readiness.dependency_blocked",
        taskId: blocked.projection.id,
      },
    ],
  );

  const replayed = states.map(({ taskId, state }) => {
    if (state === null) {
      return { taskId, state, contextState: "valid" as const };
    }
    const result = coreContract.replayWorkflowEvents(state.events);
    assert.equal(result.ok, true);
    return {
      taskId,
      state: result.ok ? result.state : null,
      contextState: "valid" as const,
    };
  });
  assert.deepEqual(coreContract.deriveInitiativeReadiness(graph, replayed), derived);
});

test("Core excludes in-progress Nodes from the frontier and clears a superseded failed result", () => {
  let inProgress = startTask("build", 2, "in-progress");
  inProgress = advanceTask(inProgress, "active", "explore", "in-progress-explore");

  let retried = startTask("build", 2, "retried");
  retried = advanceTask(retried, "active", "explore", "retried-explore");
  retried = advanceTask(retried, "active", "plan", "retried-plan");
  retried = advanceTask(retried, "active", "implement", "retried-implement");
  retried = recordWorkflowAgentResult(
    retried,
    "implement",
    "implementation",
    "blocked",
    [],
    "retried-failed-result",
  );
  retried = recordWorkflowAgentResult(
    retried,
    "implement",
    "implementation",
    "succeeded",
    [],
    "retried-successful-result",
  );

  const graph = {
    schemaVersion: 1,
    id: "GRAPH-3-IN-PROGRESS",
    initiativeTaskId: "TASK-3-INITIATIVE",
    version: 1,
    nodes: [inProgress, retried].map((state, index) => ({
      taskId: state.projection.id,
      priority: 100 - index,
      resources: { files: [], apis: [], schemas: [], locks: [] },
    })),
    edges: [],
    updatedByEvent: "EVENT-3-IN-PROGRESS",
  } as const satisfies DependencyGraph;
  const derived = coreContract.deriveInitiativeReadiness(graph, [
    { taskId: inProgress.projection.id, state: inProgress, contextState: "valid" },
    { taskId: retried.projection.id, state: retried, contextState: "valid" },
  ]);

  assert.deepEqual(derived.frontier, []);
  assert.deepEqual(
    derived.nodes.map((node) => ({
      taskId: node.taskId,
      readiness: node.readiness,
      blockerCodes: node.blockers.map((blocker) => blocker.code),
    })),
    [
      {
        taskId: inProgress.projection.id,
        readiness: "waiting",
        blockerCodes: ["initiative_readiness.task_in_progress"],
      },
      {
        taskId: retried.projection.id,
        readiness: "waiting",
        blockerCodes: ["initiative_readiness.task_in_progress"],
      },
    ],
  );
});

test("Core holds informative and validation dependents outside the ready frontier", () => {
  const prerequisite = startTask("build", 2, "prerequisite");
  const informed = startTask("build", 2, "informed");
  const validated = startTask("build", 2, "validated");
  const graph = {
    schemaVersion: 1,
    id: "GRAPH-3-NONBLOCKING",
    initiativeTaskId: "TASK-3-INITIATIVE",
    version: 1,
    nodes: [prerequisite, informed, validated].map((state, index) => ({
      taskId: state.projection.id,
      priority: 100 - index,
      resources: { files: [], apis: [], schemas: [], locks: [] },
    })),
    edges: [
      {
        from: prerequisite.projection.id,
        to: informed.projection.id,
        type: "informs",
        reason: "The informed Node needs the predecessor evidence.",
      },
      {
        from: prerequisite.projection.id,
        to: validated.projection.id,
        type: "validates",
        reason: "The validated Node needs the predecessor result.",
      },
    ],
    updatedByEvent: "EVENT-3-NONBLOCKING",
  } as const satisfies DependencyGraph;
  const derived = coreContract.deriveInitiativeReadiness(graph, [
    { taskId: prerequisite.projection.id, state: prerequisite, contextState: "valid" },
    { taskId: informed.projection.id, state: informed, contextState: "valid" },
    { taskId: validated.projection.id, state: validated, contextState: "valid" },
  ]);

  assert.deepEqual(derived.frontier, [prerequisite.projection.id]);
  assert.deepEqual(
    derived.nodes.map((node) => ({
      taskId: node.taskId,
      readiness: node.readiness,
      blockerCodes: node.blockers.map((blocker) => blocker.code),
    })),
    [
      { taskId: prerequisite.projection.id, readiness: "ready", blockerCodes: [] },
      {
        taskId: informed.projection.id,
        readiness: "waiting",
        blockerCodes: ["initiative_readiness.dependency_incomplete"],
      },
      {
        taskId: validated.projection.id,
        readiness: "waiting",
        blockerCodes: ["initiative_readiness.dependency_incomplete"],
      },
    ],
  );
});

test("Core rejects non-Build Tasks from an Initiative ready frontier", () => {
  const quick = startTask("quick", 2, "quick-node");
  const graph = {
    schemaVersion: 1,
    id: "GRAPH-3-QUICK-NODE",
    initiativeTaskId: "TASK-3-INITIATIVE",
    version: 1,
    nodes: [
      {
        taskId: quick.projection.id,
        priority: 100,
        resources: { files: [], apis: [], schemas: [], locks: [] },
      },
    ],
    edges: [],
    updatedByEvent: "EVENT-3-QUICK-NODE",
  } as const satisfies DependencyGraph;
  const derived = coreContract.deriveInitiativeReadiness(graph, [
    { taskId: quick.projection.id, state: quick, contextState: "valid" },
  ]);

  assert.deepEqual(derived.frontier, []);
  assert.deepEqual(derived.nodes, [
    {
      taskId: quick.projection.id,
      readiness: "blocked",
      blockers: [
        {
          code: "initiative_readiness.task_route_invalid",
          taskId: quick.projection.id,
          message: `Task ${quick.projection.id} uses the quick Route; Initiative graph nodes must be Build Tasks.`,
        },
      ],
    },
  ]);
});

test("Core fails closed when completed informative or validating dependencies lack evidence bindings", () => {
  let completed = startTask("build", 2, "completed-evidence");
  completed = advanceTask(completed, "active", "explore", "evidence-explore");
  completed = advanceTask(completed, "active", "plan", "evidence-plan");
  completed = advanceTask(completed, "active", "implement", "evidence-implement");
  completed = advanceTask(completed, "active", "review", "evidence-review");
  completed = advanceTask(completed, "active", "finish", "evidence-finish");
  completed = advanceTask(completed, "completed", "finish", "evidence-completed");
  const informed = startTask("build", 2, "evidence-informed");
  const validated = startTask("build", 2, "evidence-validated");
  const graph = {
    schemaVersion: 1,
    id: "GRAPH-3-EVIDENCE",
    initiativeTaskId: "TASK-3-INITIATIVE",
    version: 1,
    nodes: [completed, informed, validated].map((state, index) => ({
      taskId: state.projection.id,
      priority: 100 - index,
      resources: { files: [], apis: [], schemas: [], locks: [] },
    })),
    edges: [
      {
        from: completed.projection.id,
        to: informed.projection.id,
        type: "informs",
        reason: "The informed Node needs bound evidence.",
      },
      {
        from: completed.projection.id,
        to: validated.projection.id,
        type: "validates",
        reason: "The validated Node needs bound evidence.",
      },
    ],
    updatedByEvent: "EVENT-3-EVIDENCE",
  } as const satisfies DependencyGraph;
  const derived = coreContract.deriveInitiativeReadiness(graph, [
    { taskId: completed.projection.id, state: completed, contextState: "valid" },
    { taskId: informed.projection.id, state: informed, contextState: "valid" },
    { taskId: validated.projection.id, state: validated, contextState: "valid" },
  ]);

  assert.deepEqual(derived.frontier, []);
  assert.deepEqual(
    derived.nodes.map((node) => ({
      taskId: node.taskId,
      readiness: node.readiness,
      blockerCodes: node.blockers.map((blocker) => blocker.code),
    })),
    [
      { taskId: completed.projection.id, readiness: "completed", blockerCodes: [] },
      {
        taskId: informed.projection.id,
        readiness: "waiting",
        blockerCodes: ["initiative_readiness.dependency_evidence_required"],
      },
      {
        taskId: validated.projection.id,
        readiness: "waiting",
        blockerCodes: ["initiative_readiness.dependency_evidence_required"],
      },
    ],
  );
});

test("a block retry must repeat the accepted blocker intent", () => {
  const started = startTask("build");
  const request = {
    contractVersion: 1 as const,
    taskId: started.projection.id,
    expectedVersion: started.projection.version,
    to: { lifecycle: "blocked" as const, phase: "triage" as const, step: "ready" },
    gates: [
      {
        gate: "block" as const,
        evidence: [
          { kind: "workflow" as const, reference: "evidence/dependency-blocked.json" },
        ],
      },
    ],
    blockers: ["dependency unavailable"],
    event: eventMetadata("block-idempotency"),
  };
  const accepted = coreContract.transitionWorkflow(started, request);
  assert.equal(accepted.ok, true);
  if (!accepted.ok) {
    return;
  }

  const { blockers, ...withoutBlockers } = request;
  assert.deepEqual(blockers, ["dependency unavailable"]);
  const retried = coreContract.transitionWorkflow(accepted.state, withoutBlockers);
  assert.equal(retried.ok, false);
  if (!retried.ok) {
    assert.strictEqual(retried.state, accepted.state);
    assert.equal(
      retried.diagnostics[0]?.code,
      "workflow.event.idempotency_conflict",
    );
  }
});

test("Routes block, resume, cancel, and archive without losing their Phase state", () => {
  for (const route of ["quick", "build", "initiative"] as const) {
    let state = startTask(route);
    const phase = state.projection.phase;
    const step = state.projection.step;

    state = advanceTask(
      state,
      "blocked",
      phase,
      `${route}-blocked`,
      ["dependency unavailable"],
    );
    assert.equal(state.projection.lifecycle, "blocked");
    assert.equal(state.projection.phase, phase);
    assert.equal(state.projection.step, step);
    assert.deepEqual(state.projection.blockers, ["dependency unavailable"]);

    const blockedReplay = coreContract.replayWorkflowEvents(state.events);
    assert.equal(blockedReplay.ok, true);
    if (blockedReplay.ok) {
      assert.deepEqual(blockedReplay.state.projection, state.projection);
    }

    state = advanceTask(state, "active", phase, `${route}-resumed`);
    assert.deepEqual(state.projection.blockers, []);
    state = advanceTask(state, "cancelled", phase, `${route}-cancelled`);
    assert.equal(state.projection.lifecycle, "cancelled");
    assert.equal(state.projection.phase, phase);
    assert.equal(state.projection.step, step);
  }

  let archived = startTask("quick");
  for (const [lifecycle, phase] of happyTargets.quick) {
    archived = advanceTask(
      archived,
      lifecycle,
      phase,
      `quick-archive-${archived.projection.version}`,
    );
  }
  archived = advanceTask(archived, "archived", "finish", "quick-archived");
  assert.equal(archived.projection.lifecycle, "archived");
  assert.equal(archived.projection.phase, "finish");
  assert.equal(archived.projection.step, "archived");
});

test("Build repair transitions stop at the configured attempt limit", () => {
  let state = startTask("build", 1);
  for (const [lifecycle, phase] of [
    ["active", "explore"],
    ["active", "plan"],
    ["active", "implement"],
    ["active", "review"],
    ["active", "implement"],
    ["active", "review"],
  ] as const) {
    state = advanceTask(
      state,
      lifecycle,
      phase,
      `repair-${state.projection.version}`,
    );
  }
  state = recordWorkflowReviewResults(
    state,
    "blocked",
    [
      {
        id: "FINDING-repair-exhausted",
        severity: "blocking",
        subject: "acceptance-criterion",
        reference: "The workflow completes",
        message: "The repaired behavior remains incomplete.",
        remediation: "Block the Task with the preserved Review evidence.",
      },
    ],
    "repair-exhausted",
  );

  const rejected = coreContract.transitionWorkflow(state, {
    contractVersion: 1,
    taskId: state.projection.id,
    expectedVersion: state.projection.version,
    to: { lifecycle: "active", phase: "implement", step: "ready" },
    gates: [
      {
        gate: "review-repair",
        evidence: [
          { kind: "review", reference: "evidence/review-still-blocked.json" },
        ],
      },
    ],
    event: eventMetadata("repair-exhausted"),
  });
  assert.equal(rejected.ok, false);
  if (!rejected.ok) {
    assert.strictEqual(rejected.state, state);
    assert.equal(rejected.diagnostics[0]?.code, "workflow.repair.exhausted");
  }

  state = advanceTask(
    state,
    "blocked",
    "review",
    "repair-blocked",
    ["repair attempts exhausted"],
  );
  assert.equal(state.projection.lifecycle, "blocked");
});


test("replay rejects Build Review results with mismatched observed final fingerprints", () => {
  let state = startTask("build");
  for (const [lifecycle, phase] of [
    ["active", "explore"],
    ["active", "plan"],
    ["active", "implement"],
    ["active", "review"],
  ] as const) {
    state = advanceTask(state, lifecycle, phase, `observed-fingerprint-${phase}`);
  }
  state = recordWorkflowAgentResult(
    state,
    "review",
    "standards-review",
    "succeeded",
    [],
    "observed-fingerprint-standards",
  );
  state = recordWorkflowAgentResult(
    state,
    "review",
    "spec-review",
    "succeeded",
    [],
    "observed-fingerprint-spec",
  );
  const resultEvent = state.events.at(-1)!;
  assert.equal(resultEvent.type, "phase_execution_result_accepted");
  if (resultEvent.type !== "phase_execution_result_accepted") {
    return;
  }
  const payload: Record<string, unknown> = {
    ...resultEvent,
    result: {
      ...(resultEvent.result as Record<string, unknown>),
      observedFinalFingerprint: `sha256:${"e".repeat(64)}`,
    },
  };
  const replayed = coreContract.replayWorkflowEvents([
    ...state.events.slice(0, -1),
    { ...payload, chainDigest: digestReplayEvent(payload) },
  ]);
  assert.equal(replayed.ok, false);
  if (!replayed.ok) {
    assert.equal(replayed.diagnostics[0]?.code, "workflow.event.invalid");
  }
});

test("Core rejects a Review result with a mismatched observed final fingerprint", () => {
  let state = startTask("build");
  for (const [lifecycle, phase] of [
    ["active", "explore"],
    ["active", "plan"],
    ["active", "implement"],
    ["active", "review"],
  ] as const) {
    state = advanceTask(state, lifecycle, phase, `result-fingerprint-${phase}`);
  }
  const accepted = recordWorkflowAgentResult(
    state,
    "review",
    "spec-review",
    "succeeded",
    [],
    "result-fingerprint-spec",
  );
  const resultEvent = accepted.events.at(-1)!;
  assert.equal(resultEvent.type, "phase_execution_result_accepted");
  if (resultEvent.type !== "phase_execution_result_accepted") {
    return;
  }
  const dispatched = coreContract.replayWorkflowEvents(accepted.events.slice(0, -1));
  assert.equal(dispatched.ok, true);
  if (!dispatched.ok) {
    return;
  }
  const rejected = coreContract.recordPhaseExecutionResult(dispatched.state, {
    contractVersion: 1,
    taskId: dispatched.state.projection.id,
    expectedVersion: dispatched.state.projection.version,
    result: {
      ...(resultEvent.result as Record<string, unknown>),
      observedFinalFingerprint: `sha256:${"e".repeat(64)}`,
    },
    event: eventMetadata("result-fingerprint-mismatched"),
  });
  assert.equal(rejected.ok, false);
  if (!rejected.ok) {
    assert.equal(rejected.diagnostics[0]?.code, "workflow.transition.illegal");
  }
});

test("Core rejects malformed, unbound, and duplicate Phase results", () => {
  let state = startTask("build");
  for (const [lifecycle, phase] of [
    ["active", "explore"],
    ["active", "plan"],
    ["active", "implement"],
    ["active", "review"],
  ] as const) {
    state = advanceTask(state, lifecycle, phase, `result-binding-${phase}`);
  }
  const malformed = coreContract.recordPhaseExecutionResult(state, {
    contractVersion: 1,
    taskId: state.projection.id,
    expectedVersion: state.projection.version,
    result: {},
    event: eventMetadata("result-malformed"),
  });
  assert.equal(malformed.ok, false);
  if (!malformed.ok) {
    assert.equal(malformed.diagnostics[0]?.code, "workflow.request.invalid");
  }
  const unbound = coreContract.recordPhaseExecutionResult(state, {
    contractVersion: 1,
    taskId: state.projection.id,
    expectedVersion: state.projection.version,
    result: {
      schemaVersion: 1,
      dispatchId: "DISPATCH-UNBOUND",
      taskId: state.projection.id,
      expectedTaskVersion: state.projection.version,
      phase: "review",
      agentRole: "standards-review",
      contextManifestIdentity: `sha256:${"a".repeat(64)}`,
      agentContractIdentity: `sha256:${"b".repeat(64)}`,
      baseFingerprint: `sha256:${"d".repeat(64)}`,
      outcome: "succeeded",
      artifacts: [],
      evidence: [],
      findings: [],
      reviewFindings: [],
      observedFinalFingerprint: `sha256:${"d".repeat(64)}`,
    },
    event: eventMetadata("result-unbound"),
  });
  assert.equal(unbound.ok, false);
  if (!unbound.ok) {
    assert.equal(unbound.diagnostics[0]?.code, "workflow.transition.illegal");
  }
  const acceptedState = recordWorkflowAgentResult(
    state,
    "review",
    "standards-review",
    "succeeded",
    [],
    "result-duplicate",
  );
  const acceptedResult = acceptedState.events.at(-1)!;
  assert.equal(acceptedResult.type, "phase_execution_result_accepted");
  if (acceptedResult.type !== "phase_execution_result_accepted") {
    return;
  }
  const duplicate = coreContract.recordPhaseExecutionResult(acceptedState, {
    contractVersion: 1,
    taskId: acceptedState.projection.id,
    expectedVersion: acceptedState.projection.version,
    result: acceptedResult.result,
    event: eventMetadata("result-duplicate"),
  });
  assert.equal(duplicate.ok, false);
  if (!duplicate.ok) {
    assert.equal(duplicate.diagnostics[0]?.code, "workflow.transition.illegal");
  }
});

test("Core rejects results from superseded Phase dispatches", () => {
  let state = startTask("build");
  for (const [lifecycle, phase] of [
    ["active", "explore"],
    ["active", "plan"],
    ["active", "implement"],
    ["active", "review"],
  ] as const) {
    state = advanceTask(state, lifecycle, phase, `superseded-result-${phase}`);
  }
  const approval = state.events.find(
    (event) =>
      event.type === "workflow_transitioned" &&
      event.from.phase === "plan" &&
      event.to.phase === "implement",
  );
  assert.ok(approval, "Build Plan approval Event is missing");
  const planReference = approval.gates
    .find((gate) => gate.gate === "plan")
    ?.evidence.find((evidence) => evidence.reference.startsWith("plans/"));
  assert.ok(planReference, "Build Plan reference is missing");
  const planIdentity = `sha256:${planReference.reference.slice("plans/".length, -".json".length)}` as ContractIdentity;
  const firstBinding = {
    schemaVersion: 1 as const,
    dispatchId: "DISPATCH-SUPERSEDED-FIRST",
    taskId: state.projection.id,
    expectedTaskVersion: state.projection.version,
    phase: "review" as const,
    agentRole: "standards-review" as const,
    baseFingerprint: `sha256:${"d".repeat(64)}`,
    requestedAt: "2026-07-17T10:12:00Z",
    contextManifestIdentity: `sha256:${"a".repeat(64)}`,
    agentContractIdentity: `sha256:${"b".repeat(64)}`,
    skillLockIdentity: SKILL_LOCK_IDENTITY,
    skillIdentities: [],
  };
  const first = coreContract.recordPhaseExecutionDispatch(state, {
    contractVersion: 1,
    taskId: state.projection.id,
    expectedVersion: state.projection.version,
    planIdentity,
    binding: firstBinding,
    event: eventMetadata("superseded-first-dispatch"),
  });
  assert.equal(first.ok, true);
  if (!first.ok) {
    return;
  }
  const second = coreContract.recordPhaseExecutionDispatch(first.state, {
    contractVersion: 1,
    taskId: first.state.projection.id,
    expectedVersion: first.state.projection.version,
    planIdentity,
    binding: {
      ...firstBinding,
      dispatchId: "DISPATCH-SUPERSEDED-SECOND",
      expectedTaskVersion: first.state.projection.version,
      requestedAt: "2026-07-17T10:12:15Z",
    },
    event: eventMetadata("superseded-second-dispatch"),
  });
  assert.equal(second.ok, true);
  if (!second.ok) {
    return;
  }
  const staleResult = {
    schemaVersion: 1,
    dispatchId: firstBinding.dispatchId,
    taskId: firstBinding.taskId,
    expectedTaskVersion: firstBinding.expectedTaskVersion,
    phase: firstBinding.phase,
    agentRole: firstBinding.agentRole,
    contextManifestIdentity: firstBinding.contextManifestIdentity,
    agentContractIdentity: firstBinding.agentContractIdentity,
    baseFingerprint: firstBinding.baseFingerprint,
    outcome: "succeeded",
    artifacts: [],
    evidence: [],
    findings: [],
    reviewFindings: [],
    observedFinalFingerprint: firstBinding.baseFingerprint,
  };
  const stale = coreContract.recordPhaseExecutionResult(second.state, {
    contractVersion: 1,
    taskId: second.state.projection.id,
    expectedVersion: second.state.projection.version,
    result: staleResult,
    event: eventMetadata("superseded-first-result"),
  });
  assert.equal(stale.ok, false);
  if (!stale.ok) {
    assert.equal(stale.diagnostics[0]?.code, "workflow.transition.illegal");
  }
  const replayPayload: Record<string, unknown> = {
    schemaVersion: 1,
    eventId: "EVENT-REPLAY-SUPERSEDED-RESULT",
    taskId: second.state.projection.id,
    route: "build",
    sequence: second.state.projection.version + 1,
    previousChainDigest: second.state.events.at(-1)!.chainDigest,
    type: "phase_execution_result_accepted",
    from: {
      lifecycle: second.state.projection.lifecycle,
      phase: second.state.projection.phase,
      step: second.state.projection.step,
    },
    to: {
      lifecycle: second.state.projection.lifecycle,
      phase: second.state.projection.phase,
      step: second.state.projection.step,
    },
    actor: { kind: "agent", id: "reviewer", sessionRef: "replay" },
    outcome: "accepted",
    gates: [],
    blockers: second.state.projection.blockers,
    initiativeGraph: null,
    reason: "Record a superseded result.",
    idempotencyKey: "REPLAY-SUPERSEDED-RESULT",
    occurredAt: "2026-07-17T10:12:30Z",
    result: staleResult,
  };
  const replayed = coreContract.replayWorkflowEvents([
    ...second.state.events,
    { ...replayPayload, chainDigest: digestReplayEvent(replayPayload) },
  ]);
  assert.equal(replayed.ok, false);
  if (!replayed.ok) {
    assert.equal(replayed.diagnostics[0]?.code, "workflow.event.invalid");
  }
});

test("replay requires a current Implementation result before Build Review", () => {
  let state = startTask("build");
  for (const [lifecycle, phase] of [
    ["active", "explore"],
    ["active", "plan"],
    ["active", "implement"],
  ] as const) {
    state = advanceTask(state, lifecycle, phase, `replay-implementation-${phase}`);
  }
  const payload: Record<string, unknown> = {
    schemaVersion: 1,
    eventId: "EVENT-REPLAY-IMPLEMENTATION-REQUIRED",
    taskId: state.projection.id,
    route: "build",
    sequence: state.projection.version + 1,
    previousChainDigest: state.events.at(-1)!.chainDigest,
    type: "workflow_transitioned",
    from: {
      lifecycle: state.projection.lifecycle,
      phase: state.projection.phase,
      step: state.projection.step,
    },
    to: { lifecycle: "active", phase: "review", step: "ready" },
    actor: { kind: "agent", id: "implementer", sessionRef: "replay" },
    outcome: "accepted",
    gates: [
      {
        gate: "implement",
        evidence: [{ kind: "validation", reference: "evidence/implementation.json" }],
      },
    ],
    blockers: [],
    initiativeGraph: null,
    reason: "Enter Review without a result.",
    idempotencyKey: "REPLAY-IMPLEMENTATION-REQUIRED",
    occurredAt: "2026-07-17T10:10:00Z",
  };
  const replayed = coreContract.replayWorkflowEvents([
    ...state.events,
    { ...payload, chainDigest: digestReplayEvent(payload) },
  ]);
  assert.equal(replayed.ok, false);
  if (!replayed.ok) {
    assert.equal(replayed.diagnostics[0]?.code, "workflow.transition.illegal");
  }
});

test("replay requires Review dispatches to use the Implementation fingerprint", () => {
  let state = startTask("build");
  for (const [lifecycle, phase] of [
    ["active", "explore"],
    ["active", "plan"],
    ["active", "implement"],
    ["active", "review"],
  ] as const) {
    state = advanceTask(state, lifecycle, phase, `replay-fingerprint-${phase}`);
  }
  const approval = state.events.find(
    (event) =>
      event.type === "workflow_transitioned" &&
      event.from.phase === "plan" &&
      event.to.phase === "implement",
  );
  assert.ok(approval, "Build Plan approval Event is missing");
  const planReference = approval.gates
    .find((gate) => gate.gate === "plan")
    ?.evidence.find((evidence) => evidence.reference.startsWith("plans/"));
  assert.ok(planReference, "Build Plan reference is missing");
  const payload: Record<string, unknown> = {
    schemaVersion: 1,
    eventId: "EVENT-REPLAY-FINGERPRINT-DISPATCH",
    taskId: state.projection.id,
    route: "build",
    sequence: state.projection.version + 1,
    previousChainDigest: state.events.at(-1)!.chainDigest,
    type: "phase_execution_dispatched",
    from: {
      lifecycle: state.projection.lifecycle,
      phase: state.projection.phase,
      step: state.projection.step,
    },
    to: {
      lifecycle: state.projection.lifecycle,
      phase: state.projection.phase,
      step: state.projection.step,
    },
    actor: { kind: "agent", id: "reviewer", sessionRef: "replay" },
    outcome: "accepted",
    gates: [],
    blockers: state.projection.blockers,
    initiativeGraph: null,
    reason: "Dispatch Review from the wrong fingerprint.",
    idempotencyKey: "REPLAY-FINGERPRINT-DISPATCH",
    occurredAt: "2026-07-17T10:10:15Z",
    planIdentity: `sha256:${planReference.reference.slice("plans/".length, -".json".length)}`,
    binding: {
      schemaVersion: 1,
      dispatchId: "DISPATCH-REPLAY-FINGERPRINT",
      taskId: state.projection.id,
      expectedTaskVersion: state.projection.version,
      phase: "review",
      agentRole: "standards-review",
      baseFingerprint: `sha256:${"e".repeat(64)}`,
      requestedAt: "2026-07-17T10:10:15Z",
      contextManifestIdentity: `sha256:${"c".repeat(64)}`,
      agentContractIdentity: `sha256:${"b".repeat(64)}`,
      skillLockIdentity: SKILL_LOCK_IDENTITY,
      skillIdentities: [],
    },
  };
  const replayed = coreContract.replayWorkflowEvents([
    ...state.events,
    { ...payload, chainDigest: digestReplayEvent(payload) },
  ]);
  assert.equal(replayed.ok, false);
  if (!replayed.ok) {
    assert.equal(replayed.diagnostics[0]?.code, "workflow.transition.illegal");
  }
  const stalePayload: Record<string, unknown> = {
    ...payload,
    eventId: "EVENT-REPLAY-STALE-DISPATCH",
    idempotencyKey: "REPLAY-STALE-DISPATCH",
    binding: {
      ...(payload.binding as Record<string, unknown>),
      dispatchId: "DISPATCH-REPLAY-STALE",
      expectedTaskVersion: state.projection.version - 1,
      baseFingerprint: `sha256:${"d".repeat(64)}`,
    },
  };
  const stale = coreContract.replayWorkflowEvents([
    ...state.events,
    { ...stalePayload, chainDigest: digestReplayEvent(stalePayload) },
  ]);
  assert.equal(stale.ok, false);
  if (!stale.ok) {
    assert.equal(stale.diagnostics[0]?.code, "workflow.transition.illegal");
  }
});

test("replay validates structured Review findings", () => {
  let state = startTask("build");
  for (const [lifecycle, phase] of [
    ["active", "explore"],
    ["active", "plan"],
    ["active", "implement"],
    ["active", "review"],
  ] as const) {
    state = advanceTask(state, lifecycle, phase, `replay-findings-${phase}`);
  }
  const recorded = recordWorkflowAgentResult(
    state,
    "review",
    "standards-review",
    "succeeded",
    [],
    "replay-findings-result",
  );
  const resultEvent = recorded.events.at(-1)!;
  assert.equal(resultEvent.type, "phase_execution_result_accepted");
  if (resultEvent.type !== "phase_execution_result_accepted") {
    return;
  }
  const payload: Record<string, unknown> = {
    ...resultEvent,
    result: {
      ...(resultEvent.result as Record<string, unknown>),
      reviewFindings: ["not structured"],
    },
  };
  const replayed = coreContract.replayWorkflowEvents([
    ...recorded.events.slice(0, -1),
    { ...payload, chainDigest: digestReplayEvent(payload) },
  ]);
  assert.equal(replayed.ok, false);
  if (!replayed.ok) {
    assert.equal(replayed.diagnostics[0]?.code, "workflow.event.invalid");
  }
});

test("replay preserves legacy Review results without reviewFindings", () => {
  let state = startTask("build");
  for (const [lifecycle, phase] of [
    ["active", "explore"],
    ["active", "plan"],
    ["active", "implement"],
    ["active", "review"],
  ] as const) {
    state = advanceTask(state, lifecycle, phase, `legacy-findings-${phase}`);
  }
  const recorded = recordWorkflowAgentResult(
    state,
    "review",
    "standards-review",
    "succeeded",
    [],
    "legacy-findings-result",
  );
  const resultEvent = recorded.events.at(-1)!;
  assert.equal(resultEvent.type, "phase_execution_result_accepted");
  if (resultEvent.type !== "phase_execution_result_accepted") {
    return;
  }
  const { reviewFindings: _reviewFindings, ...legacyResult } =
    resultEvent.result as Record<string, unknown>;
  const payload: Record<string, unknown> = {
    ...resultEvent,
    result: legacyResult,
  };
  const replayed = coreContract.replayWorkflowEvents([
    ...recorded.events.slice(0, -1),
    { ...payload, chainDigest: digestReplayEvent(payload) },
  ]);
  assert.equal(replayed.ok, true);
  if (replayed.ok) {
    assert.equal(replayed.state.projection.phase, "review");
  }
});

test("replay rejects unbound and duplicate Phase results", () => {
  let state = startTask("build");
  for (const [lifecycle, phase] of [
    ["active", "explore"],
    ["active", "plan"],
    ["active", "implement"],
    ["active", "review"],
  ] as const) {
    state = advanceTask(state, lifecycle, phase, `replay-result-link-${phase}`);
  }
  const unboundPayload: Record<string, unknown> = {
    schemaVersion: 1,
    eventId: "EVENT-REPLAY-RESULT-UNBOUND",
    taskId: state.projection.id,
    route: "build",
    sequence: state.projection.version + 1,
    previousChainDigest: state.events.at(-1)!.chainDigest,
    type: "phase_execution_result_accepted",
    from: {
      lifecycle: state.projection.lifecycle,
      phase: state.projection.phase,
      step: state.projection.step,
    },
    to: {
      lifecycle: state.projection.lifecycle,
      phase: state.projection.phase,
      step: state.projection.step,
    },
    actor: { kind: "agent", id: "reviewer", sessionRef: "replay" },
    outcome: "accepted",
    gates: [],
    blockers: [],
    initiativeGraph: null,
    reason: "Record an unbound Review result.",
    idempotencyKey: "REPLAY-RESULT-UNBOUND",
    occurredAt: "2026-07-17T10:11:00Z",
    result: {
      schemaVersion: 1,
      dispatchId: "DISPATCH-REPLAY-MISSING",
      taskId: state.projection.id,
      expectedTaskVersion: state.projection.version,
      phase: "review",
      agentRole: "standards-review",
      contextManifestIdentity: `sha256:${"a".repeat(64)}`,
      agentContractIdentity: `sha256:${"b".repeat(64)}`,
      baseFingerprint: `sha256:${"d".repeat(64)}`,
      outcome: "succeeded",
      artifacts: [],
      evidence: [],
      findings: [],
      reviewFindings: [],
      observedFinalFingerprint: `sha256:${"d".repeat(64)}`,
    },
  };
  const unbound = coreContract.replayWorkflowEvents([
    ...state.events,
    { ...unboundPayload, chainDigest: digestReplayEvent(unboundPayload) },
  ]);
  assert.equal(unbound.ok, false);
  if (!unbound.ok) {
    assert.equal(unbound.diagnostics[0]?.code, "workflow.event.invalid");
  }
  const recorded = recordWorkflowAgentResult(
    state,
    "review",
    "standards-review",
    "succeeded",
    [],
    "replay-result-duplicate",
  );
  const acceptedResult = recorded.events.at(-1)!;
  assert.equal(acceptedResult.type, "phase_execution_result_accepted");
  if (acceptedResult.type !== "phase_execution_result_accepted") {
    return;
  }
  const duplicatePayload: Record<string, unknown> = {
    ...acceptedResult,
    eventId: "EVENT-REPLAY-RESULT-DUPLICATE",
    sequence: recorded.projection.version + 1,
    previousChainDigest: acceptedResult.chainDigest,
    idempotencyKey: "REPLAY-RESULT-DUPLICATE",
    occurredAt: "2026-07-17T10:11:15Z",
  };
  const duplicate = coreContract.replayWorkflowEvents([
    ...recorded.events,
    { ...duplicatePayload, chainDigest: digestReplayEvent(duplicatePayload) },
  ]);
  assert.equal(duplicate.ok, false);
  if (!duplicate.ok) {
    assert.equal(duplicate.diagnostics[0]?.code, "workflow.event.invalid");
  }
});

test("replay rejects transition Events with missing initiativeGraph data", () => {
  const state = advanceTask(
    startTask("build"),
    "active",
    "explore",
    "replay-missing-graph",
  );
  const sourceEvent = state.events[1]!;
  const {
    initiativeGraph: _omittedGraph,
    chainDigest: _originalDigest,
    ...eventWithoutGraph
  } = sourceEvent;
  const omittedGraphEvent = {
    ...eventWithoutGraph,
    chainDigest: digestReplayEvent(eventWithoutGraph),
  } as unknown as WorkflowEvent;
  const undefinedGraphPayload = {
    ...eventWithoutGraph,
    initiativeGraph: undefined,
  };
  const undefinedGraphEvent = {
    ...undefinedGraphPayload,
    chainDigest: digestReplayEvent(undefinedGraphPayload),
  } as unknown as WorkflowEvent;

  for (const malformedEvent of [omittedGraphEvent, undefinedGraphEvent]) {
    const replayed = coreContract.replayWorkflowEvents([
      state.events[0]!,
      malformedEvent,
    ]);

    assert.equal(replayed.ok, false);
    if (!replayed.ok) {
      assert.equal(replayed.diagnostics[0]?.code, "workflow.event.invalid");
      assert.equal(replayed.diagnostics[0]?.path, "$[1].initiativeGraph");
    }
  }
});

test("replay rejects malformed Event metadata and duplicate idempotency keys", () => {
  let state = startTask("build");
  state = advanceTask(state, "active", "explore", "replay-explore");
  state = advanceTask(state, "active", "plan", "replay-plan");
  const snapshot = structuredClone(state.events);

  const malformed = {
    ...state.events[1]!,
    occurredAt: "not-a-timestamp",
  };
  const malformedReplay = coreContract.replayWorkflowEvents([
    state.events[0]!,
    malformed,
  ]);
  assert.equal(malformedReplay.ok, false);
  if (!malformedReplay.ok) {
    assert.equal(malformedReplay.diagnostics[0]?.code, "workflow.request.invalid");
  }

  const created = state.events[0]!;
  assert.equal(created.type, "task_created");
  if (created.type !== "task_created") {
    return;
  }
  const invalidPolicy = {
    ...created,
    task: {
      ...created.task,
      policies: { ...created.task.policies, maxRepairAttempts: 3 },
    },
  };
  const policyReplay = coreContract.replayWorkflowEvents([invalidPolicy]);
  assert.equal(policyReplay.ok, false);
  if (!policyReplay.ok) {
    assert.equal(policyReplay.diagnostics[0]?.code, "workflow.event.invalid");
  }

  const duplicateKey = {
    ...state.events[2]!,
    idempotencyKey: state.events[1]!.idempotencyKey,
  };
  const duplicateReplay = coreContract.replayWorkflowEvents([
    state.events[0]!,
    state.events[1]!,
    duplicateKey,
  ]);
  assert.equal(duplicateReplay.ok, false);
  if (!duplicateReplay.ok) {
    assert.equal(
      duplicateReplay.diagnostics[0]?.code,
      "workflow.event.idempotency_conflict",
    );
  }
  assert.deepEqual(state.events, snapshot);
});

test("replay rejects Build Plan rejections without user attribution or recorded evidence", () => {
  let state = startTask("build");
  state = advanceTask(state, "active", "explore", "plan-replay-explore");
  state = advanceTask(state, "active", "plan", "plan-replay-plan");
  const position = {
    lifecycle: state.projection.lifecycle,
    phase: state.projection.phase,
    step: state.projection.step,
  };
  const material = {
    planIdentity: `sha256:${"a".repeat(64)}`,
    requirementsIdentity: hashTestValue(state.projection.intent),
    contextManifestPath: "context/implement.jsonl",
    contextManifestIdentity: `sha256:${"c".repeat(64)}`,
  };
  const frozenContextPayload = {
    schemaVersion: state.events[0]!.schemaVersion,
    eventId: "EVENT-BUILD-PLAN-CONTEXT-FROZEN",
    taskId: state.projection.id,
    route: "build",
    sequence: state.projection.version + 1,
    previousChainDigest: state.events.at(-1)!.chainDigest,
    type: "context_manifest_changed",
    from: position,
    to: position,
    actor: { kind: "agent", id: "planner", sessionRef: "plan-session" },
    outcome: "accepted",
    gates: [],
    blockers: state.projection.blockers,
    initiativeGraph: null,
    reason: "Freeze Plan Context.",
    idempotencyKey: "IDEMPOTENCY-BUILD-PLAN-CONTEXT-FROZEN",
    occurredAt: "2026-07-15T11:59:00Z",
    phase: "implement",
    manifestPath: material.contextManifestPath,
    manifestIdentity: material.contextManifestIdentity,
    change: "frozen",
  };
  const frozenContextEvent = {
    ...frozenContextPayload,
    chainDigest: digestReplayEvent(frozenContextPayload),
  } as unknown as WorkflowEvent;
  const recordedPayload = {
    schemaVersion: state.events[0]!.schemaVersion,
    eventId: "EVENT-BUILD-PLAN-RECORDED",
    taskId: state.projection.id,
    route: "build",
    sequence: frozenContextPayload.sequence + 1,
    previousChainDigest: frozenContextEvent.chainDigest,
    type: "build_plan_changed",
    from: position,
    to: position,
    actor: { kind: "agent", id: "planner", sessionRef: "plan-session" },
    outcome: "accepted",
    gates: [],
    blockers: state.projection.blockers,
    initiativeGraph: null,
    reason: "Record Plan evidence.",
    idempotencyKey: "IDEMPOTENCY-BUILD-PLAN-RECORDED",
    occurredAt: "2026-07-15T12:00:00Z",
    change: "recorded",
    ...material,
  };
  const recordedEvent = {
    ...recordedPayload,
    chainDigest: digestReplayEvent(recordedPayload),
  } as unknown as WorkflowEvent;
  const recordedReplay = coreContract.replayWorkflowEvents([
    ...state.events,
    frozenContextEvent,
    recordedEvent,
  ]);
  assert.equal(recordedReplay.ok, true);
  const unboundRecordPayload = {
    ...recordedPayload,
    eventId: "EVENT-BUILD-PLAN-UNBOUND",
    sequence: state.projection.version + 1,
    previousChainDigest: state.events.at(-1)!.chainDigest,
    idempotencyKey: "IDEMPOTENCY-BUILD-PLAN-UNBOUND",
  };
  const unboundRecordEvent = {
    ...unboundRecordPayload,
    chainDigest: digestReplayEvent(unboundRecordPayload),
  } as unknown as WorkflowEvent;
  const unboundRecordReplay = coreContract.replayWorkflowEvents([
    ...state.events,
    unboundRecordEvent,
  ]);
  assert.equal(unboundRecordReplay.ok, false);
  if (!unboundRecordReplay.ok) {
    assert.equal(unboundRecordReplay.diagnostics[0]?.code, "workflow.event.invalid");
  }

  const agentRejectionPayload = {
    ...recordedPayload,
    eventId: "EVENT-BUILD-PLAN-REJECTED-AGENT",
    sequence: recordedPayload.sequence + 1,
    previousChainDigest: recordedEvent.chainDigest,
    actor: { kind: "agent", id: "reviewer", sessionRef: "review-session" },
    reason: "Reject Plan evidence.",
    idempotencyKey: "IDEMPOTENCY-BUILD-PLAN-REJECTED-AGENT",
    occurredAt: "2026-07-15T12:01:00Z",
    change: "rejected",
  };
  const agentRejectionEvent = {
    ...agentRejectionPayload,
    chainDigest: digestReplayEvent(agentRejectionPayload),
  } as unknown as WorkflowEvent;
  const agentRejectionReplay = coreContract.replayWorkflowEvents([
    ...state.events,
    frozenContextEvent,
    recordedEvent,
    agentRejectionEvent,
  ]);
  assert.equal(agentRejectionReplay.ok, false);
  if (!agentRejectionReplay.ok) {
    assert.equal(agentRejectionReplay.diagnostics[0]?.code, "workflow.event.invalid");
  }

  const unrecordedRejectionPayload = {
    ...recordedPayload,
    eventId: "EVENT-BUILD-PLAN-REJECTED-UNRECORDED",
    actor: { kind: "user", id: "reviewer", sessionRef: "review-session" },
    reason: "Reject unrecorded Plan evidence.",
    idempotencyKey: "IDEMPOTENCY-BUILD-PLAN-REJECTED-UNRECORDED",
    occurredAt: "2026-07-15T12:01:00Z",
    change: "rejected",
  };
  const unrecordedRejectionEvent = {
    ...unrecordedRejectionPayload,
    chainDigest: digestReplayEvent(unrecordedRejectionPayload),
  } as unknown as WorkflowEvent;
  const unrecordedRejectionReplay = coreContract.replayWorkflowEvents([
    ...state.events,
    frozenContextEvent,
    unrecordedRejectionEvent,
  ]);
  assert.equal(unrecordedRejectionReplay.ok, false);
  if (!unrecordedRejectionReplay.ok) {
    assert.equal(
      unrecordedRejectionReplay.diagnostics[0]?.code,
      "workflow.event.invalid",
    );
  }
});

test("replay rejects a stale Event sequence without changing accepted history", () => {
  const started = startTask("build");
  const advanced = coreContract.transitionWorkflow(started, {
    contractVersion: 1,
    taskId: started.projection.id,
    expectedVersion: started.projection.version,
    to: { lifecycle: "active", phase: "explore", step: "ready" },
    gates: [
      {
        gate: "route",
        evidence: [
          {
            kind: "human-approval",
            reference: "evidence/route-approved.json",
          },
        ],
      },
    ],
    event: eventMetadata("accepted"),
  });
  assert.equal(advanced.ok, true);
  if (!advanced.ok) {
    return;
  }

  const acceptedSnapshot = structuredClone(advanced.state.events);
  const staleEvent = {
    ...advanced.state.events[1]!,
    eventId: "EVENT-stale",
    sequence: 1,
  };
  const replayed = coreContract.replayWorkflowEvents([
    advanced.state.events[0]!,
    staleEvent,
  ]);

  assert.equal(replayed.ok, false);
  if (!replayed.ok) {
    assert.equal(replayed.diagnostics[0]?.code, "workflow.event.sequence_invalid");
  }
  assert.deepEqual(advanced.state.events, acceptedSnapshot);
});

function digestReplayEvent(event: Record<string, unknown>): string {
  const payload: Record<string, unknown> = {
    schemaVersion: event.schemaVersion,
    eventId: event.eventId,
    taskId: event.taskId,
    route: event.route,
    sequence: event.sequence,
    previousChainDigest: event.previousChainDigest,
    type: event.type,
    from: event.from,
    to: event.to,
    actor: event.actor,
    outcome: event.outcome,
    gates: event.gates,
    blockers: event.blockers,
    initiativeGraph: event.initiativeGraph,
    reason: event.reason,
    idempotencyKey: event.idempotencyKey,
    occurredAt: event.occurredAt,
  };
  if (event.type === "build_plan_changed") {
    payload.change = event.change;
    payload.planIdentity = event.planIdentity;
    payload.requirementsIdentity = event.requirementsIdentity;
    payload.contextManifestPath = event.contextManifestPath;
    payload.contextManifestIdentity = event.contextManifestIdentity;
  } else if (event.type === "context_manifest_changed") {
    payload.phase = event.phase;
    payload.manifestPath = event.manifestPath;
    payload.manifestIdentity = event.manifestIdentity;
    payload.change = event.change;
  } else if (event.type === "phase_execution_dispatched") {
    payload.planIdentity = event.planIdentity;
    payload.binding = event.binding;
  } else if (event.type === "phase_execution_result_accepted") {
    payload.result = event.result;
  }
  const serialized = stableTestJson(payload);
  assert.ok(serialized);
  return `sha256:${createHash("sha256").update(serialized).digest("hex")}`;
}

function hashTestValue(value: unknown): ContractIdentity {
  const serialized = stableTestJson(value);
  assert.ok(serialized);
  return `sha256:${createHash("sha256").update(serialized).digest("hex")}` as ContractIdentity;
}

function stableTestJson(value: unknown): string | undefined {
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map((item) => stableTestJson(item)).join(",")}]`;
  }
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${stableTestJson(record[key])}`)
    .join(",")}}`;
}

function lifecycleTransitions(
  phases: readonly WorkflowTransition["from"]["phase"][],
): readonly WorkflowTransition[] {
  return [
    ...phases.flatMap((phase) => [
      transition("active", phase, "blocked", phase, "block"),
      transition("blocked", phase, "active", phase, "resume"),
      transition("active", phase, "cancelled", phase, "cancel"),
    ]),
    transition("completed", "finish", "archived", "finish", "archive"),
  ];
}

function advanceTask(
  state: WorkflowState,
  lifecycle: WorkflowTransition["to"]["lifecycle"],
  phase: WorkflowTransition["to"]["phase"],
  suffix: string,
  blockers?: readonly string[],
): WorkflowState {
  const buildPlanAuthority =
    state.projection.route === "build" &&
    state.projection.lifecycle === "active" &&
    state.projection.phase === "plan" &&
    lifecycle === "active" &&
    phase === "implement"
      ? establishBuildPlanAuthority(state, suffix)
      : undefined;
  if (buildPlanAuthority !== undefined) {
    state = buildPlanAuthority.state;
  }
  if (
    state.projection.route === "build" &&
    state.projection.lifecycle === "active" &&
    state.projection.phase === "implement" &&
    lifecycle === "active" &&
    phase === "review"
  ) {
    state = recordWorkflowAgentResult(
      state,
      "implement",
      "implementation",
      "succeeded",
      [],
      `${suffix}-implementation`,
    );
  }
  if (
    state.projection.route === "build" &&
    state.projection.lifecycle === "active" &&
    state.projection.phase === "review" &&
    lifecycle === "active" &&
    phase === "finish"
  ) {
    state = recordWorkflowReviewResults(state, "succeeded", [], suffix);
  }
  if (
    state.projection.route === "build" &&
    state.projection.lifecycle === "active" &&
    state.projection.phase === "review" &&
    lifecycle === "active" &&
    phase === "implement"
  ) {
    state = recordWorkflowReviewResults(
      state,
      "blocked",
      [
        {
          id: `FINDING-${suffix}`,
          severity: "blocking",
          subject: "acceptance-criterion",
          reference: "The workflow completes",
          message: "The reviewed behavior is incomplete.",
          remediation: "Repair the behavior and rerun both review axes.",
        },
      ],
      suffix,
    );
  }

  const allowed = routeTransitions[state.projection.route].find(
    (candidate) =>
      candidate.from.lifecycle === state.projection.lifecycle &&
      candidate.from.phase === state.projection.phase &&
      candidate.to.lifecycle === lifecycle &&
      candidate.to.phase === phase,
  );
  assert.ok(allowed, `missing transition to ${lifecycle}/${phase}`);
  assert.equal(state.projection.step, allowed.from.step);
  const initiativeGraph =
    state.projection.route === "initiative" &&
    state.projection.phase === "plan" &&
    phase === "integrate"
      ? validInitiativeGraphSnapshot(state)
      : undefined;
  const gates =
    buildPlanAuthority === undefined
      ? allowed.requiredGates.map((gate) => ({
          gate,
          evidence: [
            { kind: evidenceKind(gate), reference: `evidence/${suffix}-${gate}.json` },
          ],
        }))
      : [
          {
            gate: "plan" as const,
            evidence: [
              {
                kind: "human-approval" as const,
                reference: `plans/${buildPlanAuthority.planIdentity.slice("sha256:".length)}.json`,
              },
              {
                kind: "human-approval" as const,
                reference: `context/implement.jsonl#${buildPlanAuthority.contextManifestIdentity}`,
              },
            ],
          },
        ];
  const event =
    buildPlanAuthority === undefined
      ? eventMetadata(suffix)
      : {
          ...eventMetadata(suffix),
          actor: {
            kind: "user" as const,
            id: "sayhi-test-user",
            sessionRef: "session-3",
          },
        };
  const result = coreContract.transitionWorkflow(state, {
    contractVersion: 1,
    taskId: state.projection.id,
    expectedVersion: state.projection.version,
    to: {
      lifecycle,
      phase,
      step: allowed.to.step,
    },
    gates,
    ...(blockers === undefined ? {} : { blockers }),
    ...(initiativeGraph === undefined ? {} : { initiativeGraph }),
    event,
  });
  if (!result.ok) {
    assert.fail(result.diagnostics[0]?.message ?? "Workflow transition failed");
  }
  return result.state;
}

function recordWorkflowReviewResults(
  state: WorkflowState,
  outcome: "succeeded" | "blocked",
  findings: readonly Record<string, unknown>[],
  suffix: string,
): WorkflowState {
  let result = state;
  for (const role of ["standards-review", "spec-review"] as const) {
    result = recordWorkflowAgentResult(
      result,
      "review",
      role,
      outcome,
      findings.map((finding) => ({ ...finding, id: `${finding.id}-${role}` })),
      `${suffix}-${role}`,
    );
  }
  return result;
}

function recordWorkflowAgentResult(
  state: WorkflowState,
  phase: "implement" | "review",
  agentRole: "implementation" | "standards-review" | "spec-review",
  outcome: "succeeded" | "blocked",
  findings: readonly Record<string, unknown>[],
  suffix: string,
  baseFingerprint?: ContractIdentity,
  observedFinalFingerprint?: ContractIdentity,
): WorkflowState {
  const planApproval = state.events.find(
    (event) =>
      event.type === "workflow_transitioned" &&
      event.from.phase === "plan" &&
      event.to.phase === "implement",
  );
  assert.ok(planApproval, "Build Plan approval Event is missing");
  const planReference = planApproval.gates
    .find((gate) => gate.gate === "plan")
    ?.evidence.find((evidence) => evidence.reference.startsWith("plans/"));
  assert.ok(planReference, "Build Plan reference is missing");
  const fingerprint =
    baseFingerprint ??
    (phase === "review"
      ? `sha256:${"d".repeat(64)}`
      : `sha256:${"c".repeat(64)}`);
  const binding = {
    schemaVersion: 1 as const,
    dispatchId: `DISPATCH-${suffix}`,
    taskId: state.projection.id,
    expectedTaskVersion: state.projection.version,
    phase,
    agentRole,
    baseFingerprint: fingerprint,
    requestedAt: "2026-07-17T10:00:00Z",
    contextManifestIdentity: `sha256:${"a".repeat(64)}`,
    agentContractIdentity: `sha256:${"b".repeat(64)}`,
    skillLockIdentity: SKILL_LOCK_IDENTITY,
    skillIdentities: [],
  };
  const dispatched = coreContract.recordPhaseExecutionDispatch(state, {
    contractVersion: 1,
    taskId: state.projection.id,
    expectedVersion: state.projection.version,
    planIdentity: `sha256:${planReference.reference.slice("plans/".length, -".json".length)}`,
    binding,
    event: eventMetadata(`DISPATCH-${suffix}`),
  });
  if (!dispatched.ok) {
    assert.fail(dispatched.diagnostics[0]?.message ?? "Phase dispatch failed");
  }
  const recorded = coreContract.recordPhaseExecutionResult(dispatched.state, {
    contractVersion: 1,
    taskId: dispatched.state.projection.id,
    expectedVersion: dispatched.state.projection.version,
    result: {
      schemaVersion: 1,
      dispatchId: binding.dispatchId,
      taskId: binding.taskId,
      expectedTaskVersion: binding.expectedTaskVersion,
      phase,
      agentRole,
      contextManifestIdentity: binding.contextManifestIdentity,
      agentContractIdentity: binding.agentContractIdentity,
      baseFingerprint: binding.baseFingerprint,
      outcome,
      artifacts: [],
      evidence: [],
      findings: [],
      ...(phase === "review" ? { reviewFindings: findings } : {}),
      observedFinalFingerprint: observedFinalFingerprint ?? `sha256:${"d".repeat(64)}`,
    },
    event: eventMetadata(`RESULT-${suffix}`),
  });
  if (!recorded.ok) {
    assert.fail(recorded.diagnostics[0]?.message ?? "Agent result failed");
  }
  return recorded.state;
}

function establishBuildPlanAuthority(state: WorkflowState, suffix: string) {
  const contextManifestIdentity: ContractIdentity = `sha256:${"c".repeat(64)}`;
  const frozen = coreContract.recordContextManifestChange(state, {
    contractVersion: 1,
    taskId: state.projection.id,
    expectedVersion: state.projection.version,
    phase: "implement",
    manifestPath: "context/implement.jsonl",
    manifestIdentity: contextManifestIdentity,
    change: "frozen",
    event: eventMetadata(`${suffix}-context`),
  });
  if (!frozen.ok) {
    assert.fail(frozen.diagnostics[0]?.message ?? "Implement Context freeze failed");
  }
  const planIdentity: ContractIdentity = `sha256:${"d".repeat(64)}`;
  const recorded = coreContract.recordBuildPlanChange(frozen.state, {
    contractVersion: 1,
    taskId: frozen.state.projection.id,
    expectedVersion: frozen.state.projection.version,
    change: "recorded",
    planIdentity,
    requirementsIdentity: hashTestValue(frozen.state.projection.intent),
    contextManifestPath: "context/implement.jsonl",
    contextManifestIdentity,
    event: eventMetadata(`${suffix}-plan`),
  });
  if (!recorded.ok) {
    assert.fail(recorded.diagnostics[0]?.message ?? "Build Plan record failed");
  }
  return Object.freeze({
    state: recorded.state,
    planIdentity,
    contextManifestIdentity,
  });
}

function validInitiativeGraphSnapshot(state: WorkflowState): DependencyGraph {
  const graphId = state.projection.initiativeGraphId;
  const updatedByEvent = state.events[state.events.length - 1]?.eventId;
  assert.ok(graphId);
  assert.ok(updatedByEvent);
  return {
    schemaVersion: 1,
    id: graphId,
    initiativeTaskId: state.projection.id,
    version: 1,
    nodes: [
      {
        taskId: `${state.projection.id}-node-1`,
        priority: 50,
        resources: {
          files: ["packages/core/**"],
          apis: ["CoreContract"],
          schemas: [],
          locks: [],
        },
      },
    ],
    edges: [],
    updatedByEvent,
  };
}

function transition(
  fromLifecycle: WorkflowTransition["from"]["lifecycle"],
  fromPhase: WorkflowTransition["from"]["phase"],
  toLifecycle: WorkflowTransition["to"]["lifecycle"],
  toPhase: WorkflowTransition["to"]["phase"],
  ...requiredGates: readonly WorkflowGate[]
): WorkflowTransition {
  return {
    from: {
      lifecycle: fromLifecycle,
      phase: fromPhase,
      step: expectedStep(fromLifecycle),
    },
    to: {
      lifecycle: toLifecycle,
      phase: toPhase,
      step: expectedStep(toLifecycle),
    },
    requiredGates,
  };
}

function expectedStep(
  lifecycle: WorkflowTransition["to"]["lifecycle"],
): string {
  return lifecycle === "completed" || lifecycle === "archived"
    ? lifecycle
    : "ready";
}

function startTask(
  route: WorkflowRoute,
  maxRepairAttempts = 2,
  taskIdSuffix: string = route,
): WorkflowState {
  const result = coreContract.startWorkflowTask(
    startTaskRequest(route, maxRepairAttempts, taskIdSuffix),
  );

  if (!result.ok) {
    assert.fail(result.diagnostics[0]?.message ?? "Task start failed");
  }
  assert.equal(result.ok, true);
  return result.state;
}

function startTaskRequest(
  route: WorkflowRoute,
  maxRepairAttempts = 2,
  taskIdSuffix: string = route,
): StartWorkflowTaskRequest {
  return {
    contractVersion: 1,
    task: {
      id: `TASK-3-${taskIdSuffix}`,
      title: `Exercise the ${route} workflow`,
      route,
      parentTaskId: null,
      initiativeGraphId: route === "initiative" ? "GRAPH-3" : null,
      intent: {
        goals: [`Complete ${route}`],
        nonGoals: [],
        acceptanceCriteria: ["The workflow completes"],
      },
      scope: {
        files: ["packages/core/**"],
        apis: ["CoreContract"],
        schemas: [],
        locks: [],
      },
      baselineRef: "baseline.json",
      contexts: {},
      policies: {
        commit: "never",
        push: "never",
        maxRepairAttempts,
      },
    },
    routeGate: {
      gate: "route",
      evidence: [
        {
          kind: route === "quick" ? "workflow" : "human-approval",
          reference: `evidence/${route}-route-accepted.json`,
        },
      ],
    },
    event: eventMetadata(`${taskIdSuffix}-created`),
  };
}

function blockingEdge(from: string): DependencyGraph["edges"][number] {
  return {
    from,
    to: `${from}-dependent`,
    type: "blocks",
    reason: `Task ${from} must complete first.`,
  };
}

function eventMetadata(suffix: string) {
  return {
    eventId: `EVENT-${suffix}`,
    actor: {
      kind: "orchestrator" as const,
      id: "sayhi-test",
      sessionRef: "session-3",
    },
    reason: `Accept ${suffix}`,
    idempotencyKey: `IDEMPOTENCY-${suffix}`,
    occurredAt: "2026-07-14T04:00:00Z",
  };
}

function evidenceKind(gate: WorkflowGate) {
  return readGateEvidenceKinds(gate)[0]!;
}
