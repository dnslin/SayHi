import {
  advanceDurableTask,
  coreContract,
  createDurableTask,
  type GateEvidenceKind,
  type StartWorkflowTaskRequest,
  type TaskLifecycleFileSystem,
  type TransitionWorkflowRequest,
  type WorkflowEventMetadata,
  type WorkflowGate,
  type WorkflowLifecycle,
  type WorkflowPhase,
  type WorkflowState,
} from "@dnslin/sayhi-core";

export interface TaskLifecycleFixture {
  readonly taskId: string;
  readonly title: string;
  readonly goal: string;
  readonly acceptanceCriterion: string;
  readonly files: readonly string[];
  readonly eventNamespace: string;
  readonly sessionRef: string;
}

export function taskLifecycleStartRequest(
  fixture: TaskLifecycleFixture,
  occurredAt: string,
): StartWorkflowTaskRequest {
  return {
    contractVersion: 1,
    task: {
      id: fixture.taskId,
      title: fixture.title,
      route: "build",
      parentTaskId: null,
      initiativeGraphId: null,
      intent: {
        goals: [fixture.goal],
        nonGoals: [],
        acceptanceCriteria: [fixture.acceptanceCriterion],
      },
      scope: {
        files: fixture.files,
        apis: ["TaskLifecycleFileSystem"],
        schemas: ["events.jsonl", "task.json"],
        locks: [],
      },
      baselineRef: "baseline.json",
      contexts: {},
      policies: {
        commit: "never",
        push: "never",
        maxRepairAttempts: 2,
      },
    },
    routeGate: {
      gate: "route",
      evidence: [
        {
          kind: "human-approval",
          reference: "evidence/build-route-selected.json",
        },
      ],
    },
    event: taskLifecycleEventMetadata(fixture, "CREATED", occurredAt),
  };
}

export function taskLifecycleExploreTransition(
  fixture: TaskLifecycleFixture,
  expectedVersion: number,
  suffix: string,
  occurredAt: string,
): TransitionWorkflowRequest {
  return {
    contractVersion: 1,
    taskId: fixture.taskId,
    expectedVersion,
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
    event: taskLifecycleEventMetadata(fixture, suffix, occurredAt),
  };
}

export function taskLifecycleEventMetadata(
  fixture: TaskLifecycleFixture,
  suffix: string,
  occurredAt: string,
): WorkflowEventMetadata {
  return {
    eventId: `EVENT-${fixture.eventNamespace}-${suffix}`,
    actor: {
      kind: "orchestrator",
      id: "sayhi-test",
      sessionRef: fixture.sessionRef,
    },
    reason: `Accept ${suffix}`,
    idempotencyKey: `IDEMPOTENCY-${fixture.eventNamespace}-${suffix}`,
    occurredAt,
  };
}

export function taskLifecycleTransition(
  fixture: TaskLifecycleFixture,
  state: WorkflowState,
  lifecycle: WorkflowLifecycle,
  phase: WorkflowPhase,
  suffix: string,
  occurredAt: string,
): TransitionWorkflowRequest {
  const transition = coreContract
    .readRouteDefinition(state.projection.route)
    .transitions.find(
      (candidate) =>
        candidate.from.lifecycle === state.projection.lifecycle &&
        candidate.from.phase === state.projection.phase &&
        candidate.to.lifecycle === lifecycle &&
        candidate.to.phase === phase,
    );
  if (transition === undefined) {
    throw new Error(`Missing transition to ${lifecycle}/${phase}.`);
  }
  if (state.projection.step !== transition.from.step) {
    throw new Error(`Unexpected Task Step for ${lifecycle}/${phase}.`);
  }
  return {
    contractVersion: 1,
    taskId: state.projection.id,
    expectedVersion: state.projection.version,
    to: transition.to,
    gates: transition.requiredGates.map((gate) => ({
      gate,
      evidence: [
        {
          kind: taskLifecycleEvidenceKind(gate),
          reference: `evidence/${suffix}-${gate}.json`,
        },
      ],
    })),
    event: taskLifecycleEventMetadata(fixture, suffix, occurredAt),
  };
}

export async function createCompletedDurableTask(
  fileSystem: TaskLifecycleFileSystem,
  fixture: TaskLifecycleFixture,
  createdAt: string,
  transitionedAt: string,
): Promise<WorkflowState> {
  const created = await createDurableTask({
    fileSystem,
    start: taskLifecycleStartRequest(fixture, createdAt),
  });
  if (!created.ok) {
    throw new Error(created.diagnostics[0]?.message ?? "Task creation failed");
  }
  let state = created.state;
  for (const [lifecycle, phase] of [
    ["active", "explore"],
    ["active", "plan"],
    ["active", "implement"],
    ["active", "review"],
    ["active", "finish"],
    ["completed", "finish"],
  ] as const) {
    const advanced = await advanceDurableTask({
      fileSystem,
      transition: taskLifecycleTransition(
        fixture,
        state,
        lifecycle,
        phase,
        `${lifecycle}-${phase}`,
        transitionedAt,
      ),
    });
    if (!advanced.ok) {
      throw new Error(advanced.diagnostics[0]?.message ?? "Task advancement failed");
    }
    state = advanced.state;
  }
  return state;
}

function taskLifecycleEvidenceKind(gate: WorkflowGate): GateEvidenceKind {
  switch (gate) {
    case "route":
    case "plan":
    case "cancel":
      return "human-approval";
    case "review":
    case "review-repair":
      return "review";
    case "explore":
    case "implement":
    case "integrate":
    case "finish":
    case "archive":
      return "validation";
    case "initiative-ready":
    case "replan":
    case "block":
    case "resume":
      return "workflow";
  }
}
