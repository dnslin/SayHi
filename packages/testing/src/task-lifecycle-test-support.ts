import {
  advanceDurableTask,
  coreContract,
  createDurableTask,
  decideDurableBuildPlan,
  freezeDurableContextManifest,
  readGateEvidenceKinds,
  recordDurableBuildPlan,
  dispatchDurablePhaseExecution,
  recordDurablePhaseExecutionResult,
  type ContextManifestFileSystem,
  type AgentResultOutcome,
  type BindPhaseExecutionRequest,
  type ContractIdentity,
  type PhaseAgentContract,
  type ReviewFinding,
  type SkillMaterial,
  type StartWorkflowTaskRequest,
  type TransitionWorkflowRequest,
  type WorkflowEventMetadata,
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

export interface TestPhaseAgent {
  readonly role: "implementation" | "standards-review" | "spec-review";
  readonly contractIdentity: ContractIdentity;
  readonly contract: PhaseAgentContract;
  readonly skills?: readonly SkillMaterial[];
}

export const IMPLEMENTATION_AGENT = {
  role: "implementation",
  contractIdentity:
    "sha256:c98ac3a4104841044e7aa58e7564fd140fd9386861d8b8d5c4176f964f19bd08",
  contract: {
    schemaVersion: 1,
    role: "implementation",
    runtimeName: "sayhi-v1-implementation",
    contractVersion: 1,
    tools: ["read", "edit", "bash"],
    network: "none",
    skills: ["implement", "tdd"],
    spawns: [],
    repositoryAccess: "exclusive-write",
    outputSchema: "schemas/agent/implementation-output.json",
    promptBaseIdentity: `sha256:${"a".repeat(64)}`,
    overridePolicy: "prompt-body-only",
  },
  skills: [
    {
      name: "implement",
      identity: {
        algorithm: "sha256-lf-v1",
        digest: "918901d60ffbd690430096b5aa9e9b1c68ad82e8f5287e58dea1924002cf8543",
      },
      content: "implement skill\n",
    },
    {
      name: "tdd",
      identity: {
        algorithm: "sha256-lf-v1",
        digest: "ddf8a3f4287831a447c0b4e2c506026a849b77036f67c659275025d130f5040d",
      },
      content: "tdd skill\n",
    },
  ],
} as const satisfies TestPhaseAgent;
export const REVIEW_AGENTS = [
  {
    role: "standards-review",
    contractIdentity:
      "sha256:21a8ae092397c5873d98bcb0f0cf6fd080f62a83096bc7aa35b4185829c0784b",
    contract: {
      schemaVersion: 1,
      role: "standards-review",
      runtimeName: "sayhi-v1-standards-review",
      contractVersion: 1,
      tools: [],
      network: "none",
      skills: [],
      spawns: [],
      repositoryAccess: "read-only",
      outputSchema: "schemas/agent/standards-review-output.json",
      promptBaseIdentity: `sha256:${"b".repeat(64)}`,
      overridePolicy: "prompt-body-only",
    },
  },
  {
    role: "spec-review",
    contractIdentity:
      "sha256:6a82f7bca42776d7b92abcf2facf4a88a6b1b2bb212bafc3dafd2632ce62b97f",
    contract: {
      schemaVersion: 1,
      role: "spec-review",
      runtimeName: "sayhi-v1-spec-review",
      contractVersion: 1,
      tools: [],
      network: "none",
      skills: [],
      spawns: [],
      repositoryAccess: "read-only",
      outputSchema: "schemas/agent/spec-review-output.json",
      promptBaseIdentity: `sha256:${"b".repeat(64)}`,
      overridePolicy: "prompt-body-only",
    },
  },
] as const satisfies readonly TestPhaseAgent[];


export function taskLifecycleStartRequest(
  fixture: TaskLifecycleFixture,
  occurredAt: string,
  maxRepairAttempts = 2,
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
        maxRepairAttempts,
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
          kind: readGateEvidenceKinds(gate)[0]!,
          reference: `evidence/${suffix}-${gate}.json`,
        },
      ],
    })),
    event: taskLifecycleEventMetadata(fixture, suffix, occurredAt),
  };
}

export async function recordTestPhaseResult(
  request: Readonly<{
    fileSystem: ContextManifestFileSystem;
    fixture: TaskLifecycleFixture;
    planIdentity: ContractIdentity;
    contextManifestIdentity: ContractIdentity;
    state: WorkflowState;
    phase: "implement" | "review";
    agent: TestPhaseAgent;
    materials: Pick<BindPhaseExecutionRequest, "manifest" | "currentContext">;
    outcome: AgentResultOutcome;
    reviewFindings?: readonly ReviewFinding[];
    suffix: string;
    occurredAt: string;
  }>,
): Promise<WorkflowState> {
  const dispatched = await dispatchDurablePhaseExecution({
    fileSystem: request.fileSystem,
    planIdentity: request.planIdentity,
    execution: {
      contractVersion: 1,
      dispatch: {
        schemaVersion: 1,
        dispatchId: `DISPATCH-${request.fixture.eventNamespace}-${request.suffix}`,
        taskId: request.fixture.taskId,
        expectedTaskVersion: request.state.projection.version,
        phase: request.phase,
        agentRole: request.agent.role,
        baseFingerprint: `sha256:${"d".repeat(64)}`,
        requestedAt: request.occurredAt,
        contextManifestIdentity: request.contextManifestIdentity,
        agentContractIdentity: request.agent.contractIdentity,
      },
      manifest: request.materials.manifest,
      currentContext: request.materials.currentContext,
      agentContract: request.agent.contract,
      skills: request.agent.skills ?? [],
    },
    event: taskLifecycleEventMetadata(
      request.fixture,
      `${request.suffix}-DISPATCHED`,
      request.occurredAt,
    ),
  });
  if (!dispatched.ok) {
    throw new Error(dispatched.diagnostics[0]?.message ?? "Phase dispatch failed");
  }
  const result = await recordDurablePhaseExecutionResult({
    fileSystem: request.fileSystem,
    taskId: request.fixture.taskId,
    result: {
      schemaVersion: 1,
      dispatchId: dispatched.binding.dispatchId,
      taskId: request.fixture.taskId,
      expectedTaskVersion: dispatched.binding.expectedTaskVersion,
      phase: request.phase,
      agentRole: request.agent.role,
      contextManifestIdentity: dispatched.binding.contextManifestIdentity,
      agentContractIdentity: dispatched.binding.agentContractIdentity,
      baseFingerprint: dispatched.binding.baseFingerprint,
      outcome: request.outcome,
      artifacts: [`artifacts/${request.agent.role}.md`],
      evidence: [`evidence/${request.agent.role}.json`],
      findings: [],
      ...(request.phase === "review"
        ? { reviewFindings: request.reviewFindings ?? [] }
        : {}),
      observedFinalFingerprint: dispatched.binding.baseFingerprint,
    },
    event: taskLifecycleEventMetadata(
      request.fixture,
      `${request.suffix}-RESULT`,
      request.occurredAt,
    ),
  });
  if (!result.ok) {
    throw new Error(result.diagnostics[0]?.message ?? "Phase result failed");
  }
  return result.state;
}

export async function createCompletedDurableTask(
  fileSystem: ContextManifestFileSystem,
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
  const frozen = await freezeDurableContextManifest({
    fileSystem,
    taskId: fixture.taskId,
    expectedVersion: state.projection.version,
    phase: "implement",
    event: taskLifecycleEventMetadata(fixture, "IMPLEMENT-CONTEXT", transitionedAt),
  });
  if (!frozen.ok) {
    throw new Error(frozen.diagnostics[0]?.message ?? "Context freeze failed");
  }
  const planned = await recordDurableBuildPlan({
    fileSystem,
    taskId: fixture.taskId,
    expectedVersion: frozen.state.projection.version,
    content: `# ${fixture.title}\n\n${fixture.goal}\n`,
    event: taskLifecycleEventMetadata(fixture, "PLAN-RECORDED", transitionedAt),
  });
  if (!planned.ok) {
    throw new Error(planned.diagnostics[0]?.message ?? "Plan recording failed");
  }
  const approved = await decideDurableBuildPlan({
    fileSystem,
    taskId: fixture.taskId,
    expectedVersion: planned.state.projection.version,
    decision: "approved",
    planIdentity: planned.plan.identity,
    contextManifestIdentity: planned.plan.contextManifestIdentity,
    event: {
      ...taskLifecycleEventMetadata(fixture, "PLAN-APPROVED", transitionedAt),
      actor: {
        kind: "user",
        id: "sayhi-test-user",
        sessionRef: fixture.sessionRef,
      },
    },
  });
  if (!approved.ok || approved.decision !== "approved") {
    throw new Error(
      !approved.ok
        ? approved.diagnostics[0]?.message ?? "Plan approval failed"
        : "Plan approval was rejected",
    );
  }
  state = approved.state;
  state = await recordTestPhaseResult({
    fileSystem,
    fixture,
    planIdentity: planned.plan.identity,
    contextManifestIdentity: planned.plan.contextManifestIdentity,
    state,
    phase: "implement",
    agent: IMPLEMENTATION_AGENT,
    materials: { manifest: [], currentContext: [] },
    outcome: "succeeded",
    suffix: "IMPLEMENT",
    occurredAt: transitionedAt,
  });
  const reviewed = await advanceDurableTask({
    fileSystem,
    transition: taskLifecycleTransition(
      fixture,
      state,
      "active",
      "review",
      "REVIEW",
      transitionedAt,
    ),
  });
  if (!reviewed.ok) {
    throw new Error(reviewed.diagnostics[0]?.message ?? "Review entry failed");
  }
  state = reviewed.state;
  for (const reviewAgent of REVIEW_AGENTS) {
    state = await recordTestPhaseResult({
      fileSystem,
      fixture,
      planIdentity: planned.plan.identity,
      state,
      contextManifestIdentity: planned.plan.contextManifestIdentity,
      phase: "review",
      agent: reviewAgent,
      materials: { manifest: [], currentContext: [] },
      outcome: "succeeded",
      suffix: reviewAgent.role,
      occurredAt: transitionedAt,
    });
  }
  for (const [lifecycle, phase] of [
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

