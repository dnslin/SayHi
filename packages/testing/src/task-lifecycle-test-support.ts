import type {
  StartWorkflowTaskRequest,
  TransitionWorkflowRequest,
  WorkflowEventMetadata,
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
