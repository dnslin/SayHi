import { createHash } from "node:crypto";
import assert from "node:assert/strict";
import test from "node:test";

import {
  coreContract,
  type DependencyGraph,
  type GateEvidenceKind,
  type StartWorkflowTaskRequest,
  type WorkflowGate,
  type WorkflowRoute,
  type WorkflowEvent,
  type WorkflowState,
  type WorkflowTransition,
} from "@dnslin/sayhi-core";

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
      const definition = routeTransitions[route];
      const allowed = definition.find(
        (candidate) =>
          candidate.from.lifecycle === state.projection.lifecycle &&
          candidate.from.phase === state.projection.phase &&
          candidate.to.lifecycle === lifecycle &&
          candidate.to.phase === phase,
      );
      assert.ok(allowed, `missing ${route} transition to ${lifecycle}/${phase}`);
      const initiativeGraph =
        route === "initiative" &&
        state.projection.phase === "plan" &&
        phase === "integrate"
          ? validInitiativeGraphSnapshot(state)
          : undefined;

      const result = coreContract.transitionWorkflow(state, {
        contractVersion: 1,
        taskId: state.projection.id,
        expectedVersion: state.projection.version,
        to: { lifecycle, phase, step: allowed.to.step },
        gates: allowed.requiredGates.map((gate) => ({
          gate,
          evidence: [
            {
              kind: evidenceKind(gate),
              reference: `evidence/${gate}-${state.projection.version}.json`,
            },
          ],
        })),
        ...(initiativeGraph === undefined ? {} : { initiativeGraph }),
        event: eventMetadata(`${route}-${state.projection.version + 1}`),
      });

      assert.equal(result.ok, true);
      if (result.ok) {
        state = result.state;
      }
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
  const serialized = stableTestJson(payload);
  assert.ok(serialized);
  return `sha256:${createHash("sha256").update(serialized).digest("hex")}`;
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
  const result = coreContract.transitionWorkflow(state, {
    contractVersion: 1,
    taskId: state.projection.id,
    expectedVersion: state.projection.version,
    to: {
      lifecycle,
      phase,
      step: allowed.to.step,
    },
    gates: allowed.requiredGates.map((gate) => ({
      gate,
      evidence: [
        { kind: evidenceKind(gate), reference: `evidence/${suffix}-${gate}.json` },
      ],
    })),
    ...(blockers === undefined ? {} : { blockers }),
    ...(initiativeGraph === undefined ? {} : { initiativeGraph }),
    event: eventMetadata(suffix),
  });
  if (!result.ok) {
    assert.fail(result.diagnostics[0]?.message ?? "Workflow transition failed");
  }
  return result.state;
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

function startTask(route: WorkflowRoute, maxRepairAttempts = 2): WorkflowState {
  const result = coreContract.startWorkflowTask(
    startTaskRequest(route, maxRepairAttempts),
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
): StartWorkflowTaskRequest {
  return {
    contractVersion: 1,
    task: {
      id: `TASK-3-${route}`,
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
    event: eventMetadata(`${route}-created`),
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

function evidenceKind(gate: WorkflowGate): GateEvidenceKind {
  switch (gate) {
    case "route":
    case "plan":
      return "human-approval";
    case "review":
    case "review-repair":
      return "review";
    case "cancel":
      return "human-approval";
    case "explore":
    case "implement":
    case "integrate":
    case "finish":
      return "validation";
    case "archive":
      return "validation";
    case "initiative-ready":
    case "replan":
      return "workflow";
    case "block":
    case "resume":
      return "workflow";
  }
}
