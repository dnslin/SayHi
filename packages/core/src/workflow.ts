import { hashCanonicalJson, stableJson } from "./identity.js";

import {
  DEPENDENCY_GRAPH_CONTRACT_VERSION,
  validateDependencyGraph as validateDependencyGraphContract,
  type DependencyGraphDiagnostic,
  type DependencyGraphDiagnosticCode,
} from "./dependency-graph.js";

import { isRepositoryRelativePath } from "./repository-path.js";
import {
  DURABLE_RECORD_SCHEMA_VERSION,
  isIdentifier,
  isTimestamp,
} from "./validation.js";

export { isRepositoryRelativePath } from "./repository-path.js";
export { isIdentifier } from "./validation.js";

export const WORKFLOW_CONTRACT_VERSION = 1 as const;

export type WorkflowRoute = "quick" | "build" | "initiative";
export type WorkflowPhase =
  | "triage"
  | "explore"
  | "plan"
  | "implement"
  | "review"
  | "integrate"
  | "finish";
export type WorkflowLifecycle =
  | "proposed"
  | "active"
  | "blocked"
  | "completed"
  | "archived"
  | "cancelled";
export type WorkflowGate =
  | "route"
  | "explore"
  | "plan"
  | "implement"
  | "review"
  | "integrate"
  | "finish"
  | "initiative-ready"
  | "replan"
  | "review-repair"
  | "block"
  | "resume"
  | "cancel"
  | "archive";

export interface WorkflowTransitionEndpoint {
  readonly lifecycle: WorkflowLifecycle;
  readonly phase: WorkflowPhase;
  readonly step: string;
}

export interface WorkflowTransition {
  readonly from: WorkflowTransitionEndpoint;
  readonly to: WorkflowTransitionEndpoint;
  readonly requiredGates: readonly WorkflowGate[];
}

export interface RouteDefinition {
  readonly route: WorkflowRoute;
  readonly phases: readonly WorkflowPhase[];
  readonly transitions: readonly WorkflowTransition[];
}

export type GateEvidenceKind =
  | "human-approval"
  | "validation"
  | "review"
  | "workflow";

export interface GateEvidence {
  readonly kind: GateEvidenceKind;
  readonly reference: string;
}

export interface GateAcceptance {
  readonly gate: WorkflowGate;
  readonly evidence: readonly GateEvidence[];
}

export interface WorkflowActor {
  readonly kind: "orchestrator" | "user" | "agent" | "system";
  readonly id: string;
  readonly sessionRef: string;
}

export interface WorkflowEventMetadata {
  readonly eventId: string;
  readonly actor: WorkflowActor;
  readonly reason: string;
  readonly idempotencyKey: string;
  readonly occurredAt: string;
}

export interface TaskIntent {
  readonly goals: readonly string[];
  readonly nonGoals: readonly string[];
  readonly acceptanceCriteria: readonly string[];
}

export interface TaskScope {
  readonly files: readonly string[];
  readonly apis: readonly string[];
  readonly schemas: readonly string[];
  readonly locks: readonly string[];
}

export type DependencyGraphEdgeType =
  | "blocks"
  | "informs"
  | "validates"
  | "supersedes";

export interface DependencyGraphNode {
  readonly taskId: string;
  readonly priority: number;
  readonly resources: TaskScope;
}

export interface DependencyGraphEdge {
  readonly from: string;
  readonly to: string;
  readonly type: DependencyGraphEdgeType;
  readonly reason: string;
}

export interface DependencyGraph {
  readonly schemaVersion: typeof DURABLE_RECORD_SCHEMA_VERSION;
  readonly id: string;
  readonly initiativeTaskId: string;
  readonly version: number;
  readonly nodes: readonly DependencyGraphNode[];
  readonly edges: readonly DependencyGraphEdge[];
  readonly updatedByEvent: string;
}

export interface TaskPolicies {
  readonly commit: "auto-after-review" | "confirm" | "never";
  readonly push: "never";
  readonly maxRepairAttempts: number;
}

export interface WorkflowTaskDefinition {
  readonly id: string;
  readonly title: string;
  readonly route: WorkflowRoute;
  readonly parentTaskId: string | null;
  readonly initiativeGraphId: string | null;
  readonly intent: TaskIntent;
  readonly scope: TaskScope;
  readonly baselineRef: string;
  readonly contexts: Readonly<Partial<Record<WorkflowPhase, string>>>;
  readonly policies: TaskPolicies;
}

export interface WorkflowPosition {
  readonly lifecycle: WorkflowLifecycle;
  readonly phase: WorkflowPhase;
  readonly step: string;
}

export interface WorkflowEventHead {
  readonly sequence: number;
  readonly eventId: string;
  readonly chainDigest: string;
}

export interface TaskProjection extends WorkflowTaskDefinition {
  readonly schemaVersion: typeof DURABLE_RECORD_SCHEMA_VERSION;
  readonly lifecycle: WorkflowLifecycle;
  readonly phase: WorkflowPhase;
  readonly step: string;
  readonly version: number;
  readonly eventHead: WorkflowEventHead;
  readonly blockers: readonly string[];
  readonly externalReferences: readonly string[];
  readonly createdAt: string;
  readonly updatedAt: string;
}

interface WorkflowEventBase {
  readonly schemaVersion: typeof DURABLE_RECORD_SCHEMA_VERSION;
  readonly eventId: string;
  readonly taskId: string;
  readonly route: WorkflowRoute;
  readonly sequence: number;
  readonly previousChainDigest: string | null;
  readonly chainDigest: string;
  readonly to: WorkflowPosition;
  readonly actor: WorkflowActor;
  readonly outcome: "accepted";
  readonly gates: readonly GateAcceptance[];
  readonly blockers: readonly string[];
  readonly initiativeGraph: DependencyGraph | null;
  readonly reason: string;
  readonly idempotencyKey: string;
  readonly occurredAt: string;
}

export interface TaskCreatedEvent extends WorkflowEventBase {
  readonly type: "task_created";
  readonly from: null;
  readonly task: WorkflowTaskDefinition;
}

export interface WorkflowTransitionedEvent extends WorkflowEventBase {
  readonly type: "workflow_transitioned";
  readonly from: WorkflowPosition;
}

export type WorkflowEvent = TaskCreatedEvent | WorkflowTransitionedEvent;

export interface WorkflowState {
  readonly events: readonly WorkflowEvent[];
  readonly projection: TaskProjection;
}

export interface StartWorkflowTaskRequest {
  readonly contractVersion: typeof WORKFLOW_CONTRACT_VERSION;
  readonly task: WorkflowTaskDefinition;
  readonly routeGate?: GateAcceptance;
  readonly event: WorkflowEventMetadata;
}

export interface TransitionWorkflowRequest {
  readonly contractVersion: typeof WORKFLOW_CONTRACT_VERSION;
  readonly taskId: string;
  readonly expectedVersion: number;
  readonly to: WorkflowPosition;
  readonly gates: readonly GateAcceptance[];
  readonly blockers?: readonly string[];
  readonly initiativeGraph?: DependencyGraph;
  readonly event: WorkflowEventMetadata;
}

export type WorkflowDiagnosticCode = DependencyGraphDiagnosticCode
  | "workflow.request.invalid"
  | "workflow.contract_version.unsupported"
  | "workflow.task.mismatch"
  | "workflow.state.inconsistent"
  | "workflow.version.stale"
  | "workflow.transition.illegal"
  | "workflow.gate.unmet"
  | "workflow.gate.unexpected"
  | "workflow.gate.evidence_invalid"
  | "workflow.event.sequence_invalid"
  | "workflow.event.chain_invalid"
  | "workflow.event.idempotency_conflict"
  | "workflow.repair.exhausted"
  | "workflow.graph.invalid"
  | "workflow.event.invalid";

export interface WorkflowDiagnostic {
  readonly code: WorkflowDiagnosticCode;
  readonly path: string;
  readonly message: string;
  readonly remediation: string;
}

export type StartWorkflowTaskResult =
  | Readonly<{
      ok: true;
      contractVersion: typeof WORKFLOW_CONTRACT_VERSION;
      state: WorkflowState;
      event: TaskCreatedEvent;
    }>
  | Readonly<{
      ok: false;
      contractVersion: typeof WORKFLOW_CONTRACT_VERSION;
      diagnostics: readonly WorkflowDiagnostic[];
    }>;

export type TransitionWorkflowResult =
  | Readonly<{
      ok: true;
      contractVersion: typeof WORKFLOW_CONTRACT_VERSION;
      state: WorkflowState;
      event: WorkflowTransitionedEvent;
    }>
  | Readonly<{
      ok: false;
      contractVersion: typeof WORKFLOW_CONTRACT_VERSION;
      state: WorkflowState;
      diagnostics: readonly WorkflowDiagnostic[];
    }>;

export type ReplayWorkflowEventsResult =
  | Readonly<{
      ok: true;
      contractVersion: typeof WORKFLOW_CONTRACT_VERSION;
      state: WorkflowState;
    }>
  | Readonly<{
      ok: false;
      contractVersion: typeof WORKFLOW_CONTRACT_VERSION;
      diagnostics: readonly WorkflowDiagnostic[];
    }>;

const routeDefinitions: Readonly<Record<WorkflowRoute, RouteDefinition>> =
  Object.freeze({
    quick: routeDefinition(
      "quick",
      ["triage", "implement", "review", "finish"],
      [
        routeTransition("active", "triage", "active", "implement", "route"),
        routeTransition(
          "active",
          "implement",
          "active",
          "review",
          "implement",
        ),
        routeTransition(
          "active",
          "review",
          "active",
          "implement",
          "review-repair",
        ),
        routeTransition("active", "review", "active", "finish", "review"),
        routeTransition("active", "finish", "completed", "finish", "finish"),
      ],
    ),
    build: routeDefinition(
      "build",
      ["triage", "explore", "plan", "implement", "review", "finish"],
      [
        routeTransition("active", "triage", "active", "explore", "route"),
        routeTransition("active", "explore", "active", "plan", "explore"),
        routeTransition("active", "plan", "active", "implement", "plan"),
        routeTransition("active", "implement", "active", "plan", "replan"),
        routeTransition(
          "active",
          "implement",
          "active",
          "review",
          "implement",
        ),
        routeTransition(
          "active",
          "review",
          "active",
          "implement",
          "review-repair",
        ),
        routeTransition("active", "review", "active", "finish", "review"),
        routeTransition("active", "finish", "completed", "finish", "finish"),
      ],
    ),
    initiative: routeDefinition(
      "initiative",
      ["triage", "explore", "plan", "integrate", "finish"],
      [
        routeTransition("active", "triage", "active", "explore", "route"),
        routeTransition("active", "explore", "active", "plan", "explore"),
        routeTransition(
          "active",
          "plan",
          "active",
          "integrate",
          "plan",
          "initiative-ready",
        ),
        routeTransition(
          "active",
          "integrate",
          "active",
          "finish",
          "integrate",
        ),
        routeTransition("active", "finish", "completed", "finish", "finish"),
      ],
    ),
  });

const evidenceKindsByGate: Readonly<
  Record<WorkflowGate, readonly GateEvidenceKind[]>
> = Object.freeze({
  route: Object.freeze(["human-approval", "workflow"] as const),
  explore: Object.freeze(["validation"] as const),
  plan: Object.freeze(["human-approval"] as const),
  implement: Object.freeze(["validation"] as const),
  review: Object.freeze(["review"] as const),
  integrate: Object.freeze(["validation"] as const),
  finish: Object.freeze(["validation"] as const),
  "initiative-ready": Object.freeze(["workflow"] as const),
  replan: Object.freeze(["workflow"] as const),
  "review-repair": Object.freeze(["review"] as const),
  block: Object.freeze(["workflow"] as const),
  resume: Object.freeze(["workflow"] as const),
  cancel: Object.freeze(["human-approval"] as const),
  archive: Object.freeze(["validation"] as const),
});

export function readRouteDefinition(route: WorkflowRoute): RouteDefinition {
  return routeDefinitions[route];
}

export function startWorkflowTask(
  request: StartWorkflowTaskRequest,
): StartWorkflowTaskResult {
  const diagnostic = validateStartRequest(request);
  if (diagnostic !== null) {
    return startFailure(diagnostic);
  }

  const task = copyTaskDefinition(request.task);
  const unsignedEvent = {
    schemaVersion: DURABLE_RECORD_SCHEMA_VERSION,
    eventId: request.event.eventId,
    taskId: task.id,
    route: task.route,
    sequence: 1,
    previousChainDigest: null,
    type: "task_created" as const,
    from: null,
    to: freezePosition({
      lifecycle: "active",
      phase: "triage",
      step: "ready",
    }),
    actor: copyActor(request.event.actor),
    outcome: "accepted" as const,
    gates: copyGateAcceptances([request.routeGate!]),
    blockers: Object.freeze([] as string[]),
    initiativeGraph: null,
    reason: request.event.reason,
    idempotencyKey: request.event.idempotencyKey,
    occurredAt: request.event.occurredAt,
    task,
  };
  const event = Object.freeze({
    ...unsignedEvent,
    chainDigest: digestEvent(unsignedEvent),
  });
  const projection = projectCreatedEvent(event);
  const state = freezeState([event], projection);

  return Object.freeze({
    ok: true,
    contractVersion: WORKFLOW_CONTRACT_VERSION,
    state,
    event,
  });
}

export function transitionWorkflow(
  state: WorkflowState,
  request: TransitionWorkflowRequest,
): TransitionWorkflowResult {
  const stateIsConsistent = stateMatchesAcceptedHistory(state);
  const repeatedEvent = state.events.find(
    (event) => event.idempotencyKey === request.event.idempotencyKey,
  );
  if (
    repeatedEvent !== undefined &&
    request.contractVersion === WORKFLOW_CONTRACT_VERSION &&
    request.taskId === state.projection.id &&
    stateIsConsistent
  ) {
    if (
      repeatedEvent.type === "workflow_transitioned" &&
      matchesTransitionIntent(repeatedEvent, request)
    ) {
      return Object.freeze({
        ok: true,
        contractVersion: WORKFLOW_CONTRACT_VERSION,
        state,
        event: repeatedEvent,
      });
    }
    return transitionFailure(
      state,
      diagnostic(
        "workflow.event.idempotency_conflict",
        "$.event.idempotencyKey",
        "Idempotency key was already accepted for different workflow intent.",
        "Reuse a key only for an identical retry, or submit a new stable key.",
      ),
    );
  }

  const requestDiagnostic = validateTransitionRequest(
    state,
    request,
    stateIsConsistent,
  );
  if (requestDiagnostic !== null) {
    return transitionFailure(state, requestDiagnostic);
  }

  const transition = findTransition(state.projection, request.to);
  if (transition === undefined) {
    return transitionFailure(
      state,
      diagnostic(
        "workflow.transition.illegal",
        "$.to",
        `Route ${state.projection.route} does not permit ${state.projection.lifecycle}/${state.projection.phase} -> ${request.to.lifecycle}/${request.to.phase}.`,
        "Choose a transition exposed by readRouteDefinition for the Task Route.",
      ),
    );
  }

  const gateDiagnostic = validateGates(transition.requiredGates, request.gates);
  if (gateDiagnostic !== null) {
    return transitionFailure(state, gateDiagnostic);
  }

  const invariantDiagnostic = validateTransitionInvariants(
    state.projection,
    state.events,
    request.to,
    request.blockers,
  );
  if (invariantDiagnostic !== null) {
    return transitionFailure(state, invariantDiagnostic);
  }
  const initiativeGraph = validateInitiativeGraphTransition(
    state.projection,
    state.events,
    request.to,
    request.initiativeGraph,
  );
  if (isWorkflowDiagnostic(initiativeGraph)) {
    return transitionFailure(state, initiativeGraph);
  }

  const tail = state.events[state.events.length - 1]!;
  const unsignedEvent = {
    schemaVersion: DURABLE_RECORD_SCHEMA_VERSION,
    eventId: request.event.eventId,
    taskId: state.projection.id,
    route: state.projection.route,
    sequence: state.projection.version + 1,
    previousChainDigest: tail.chainDigest,
    type: "workflow_transitioned" as const,
    from: freezePosition(positionOf(state.projection)),
    to: freezePosition(request.to),
    actor: copyActor(request.event.actor),
    outcome: "accepted" as const,
    gates: copyGateAcceptances(request.gates),
    blockers: blockersAfterTransition(state.projection, request),
    initiativeGraph,
    reason: request.event.reason,
    idempotencyKey: request.event.idempotencyKey,
    occurredAt: request.event.occurredAt,
  };
  const event = Object.freeze({
    ...unsignedEvent,
    chainDigest: digestEvent(unsignedEvent),
  });
  const projection = projectTransitionEvent(state.projection, event);
  const nextState = freezeState([...state.events, event], projection);

  return Object.freeze({
    ok: true,
    contractVersion: WORKFLOW_CONTRACT_VERSION,
    state: nextState,
    event,
  });
}

export function replayWorkflowEvents(
  events: readonly WorkflowEvent[],
): ReplayWorkflowEventsResult {
  if (events.length === 0) {
    return replayFailure(
      diagnostic(
        "workflow.event.sequence_invalid",
        "$[0]",
        "Workflow Event replay requires a task_created Event at sequence 1.",
        "Provide the complete accepted Event stream beginning at sequence 1.",
      ),
    );
  }

  const acceptedEvents: WorkflowEvent[] = [];
  const seenIdempotencyKeys = new Set<string>();
  let projection: TaskProjection | null = null;

  for (let index = 0; index < events.length; index += 1) {
    const sourceEvent = events[index]!;
    const recordDiagnostic = validateReplayEvent(sourceEvent, index);
    if (recordDiagnostic !== null) {
      return replayFailure(recordDiagnostic);
    }
    if (seenIdempotencyKeys.has(sourceEvent.idempotencyKey)) {
      return replayFailure(
        diagnostic(
          "workflow.event.idempotency_conflict",
          `$[${index}].idempotencyKey`,
          "Workflow Event idempotency key appears more than once in history.",
          "Restore the append-only stream without duplicate retry Events.",
        ),
      );
    }
    seenIdempotencyKeys.add(sourceEvent.idempotencyKey);

    const expectedSequence = index + 1;
    if (sourceEvent.sequence !== expectedSequence) {
      return replayFailure(
        diagnostic(
          "workflow.event.sequence_invalid",
          `$[${index}].sequence`,
          `Workflow Event sequence must be ${expectedSequence}.`,
          "Restore the complete append-only Event stream in sequence order.",
        ),
      );
    }

    const previousEvent = acceptedEvents[index - 1];
    const expectedPreviousDigest = previousEvent?.chainDigest ?? null;
    if (sourceEvent.previousChainDigest !== expectedPreviousDigest) {
      return replayFailure(
        diagnostic(
          "workflow.event.chain_invalid",
          `$[${index}].previousChainDigest`,
          "Workflow Event does not reference the preceding accepted Event digest.",
          "Restore the original Event order and unmodified Event content.",
        ),
      );
    }

    if (sourceEvent.chainDigest !== digestEvent(sourceEvent)) {
      return replayFailure(
        diagnostic(
          "workflow.event.chain_invalid",
          `$[${index}].chainDigest`,
          "Workflow Event digest does not match its accepted content.",
          "Restore the original immutable Event content.",
        ),
      );
    }

    if (index === 0) {
      if (!isValidCreationEvent(sourceEvent)) {
        return replayFailure(
          diagnostic(
            "workflow.event.invalid",
            "$[0]",
            "The first Workflow Event must create an active Task in Triage.",
            "Begin the stream with a valid task_created Event.",
          ),
        );
      }
      const event = copyCreatedEvent(sourceEvent);
      projection = projectCreatedEvent(event);
      acceptedEvents.push(event);
      continue;
    }

    if (
      projection === null ||
      sourceEvent.type !== "workflow_transitioned" ||
      sourceEvent.taskId !== projection.id ||
      sourceEvent.route !== projection.route ||
      !positionsEqual(sourceEvent.from, positionOf(projection))
    ) {
      return replayFailure(
        diagnostic(
          "workflow.event.invalid",
          `$[${index}]`,
          "Workflow Event does not continue the projected Task state.",
          "Restore the accepted Event for this Task, Route, and prior position.",
        ),
      );
    }

    const allowed = findTransition(projection, sourceEvent.to);
    if (allowed === undefined) {
      return replayFailure(
        diagnostic(
          "workflow.transition.illegal",
          `$[${index}].to`,
          "Workflow Event contains a transition not permitted by its Route.",
          "Remove the Event and request an exposed Route transition.",
        ),
      );
    }

    const gateDiagnostic = validateGates(allowed.requiredGates, sourceEvent.gates);
    if (gateDiagnostic !== null) {
      return replayFailure({ ...gateDiagnostic, path: `$[${index}].gates` });
    }

    const invariantDiagnostic = validateTransitionInvariants(
      projection,
      acceptedEvents,
      sourceEvent.to,
      sourceEvent.blockers,
    );
    if (invariantDiagnostic !== null) {
      return replayFailure({ ...invariantDiagnostic, path: `$[${index}]` });
    }
    const initiativeGraph = validateInitiativeGraphTransition(
      projection,
      acceptedEvents,
      sourceEvent.to,
      sourceEvent.initiativeGraph,
    );
    if (isWorkflowDiagnostic(initiativeGraph)) {
      return replayFailure({
        ...initiativeGraph,
        path: `$[${index}]${initiativeGraph.path.slice(1)}`,
      });
    }

    const event = copyTransitionEvent(sourceEvent, initiativeGraph);
    projection = projectTransitionEvent(projection, event);
    acceptedEvents.push(event);
  }

  return Object.freeze({
    ok: true,
    contractVersion: WORKFLOW_CONTRACT_VERSION,
    state: freezeState(acceptedEvents, projection!),
  });
}

function routeDefinition(
  route: WorkflowRoute,
  phases: readonly WorkflowPhase[],
  transitions: readonly WorkflowTransition[],
): RouteDefinition {
  return Object.freeze({
    route,
    phases: Object.freeze([...phases]),
    transitions: Object.freeze([...transitions, ...lifecycleTransitions(phases)]),
  });
}

function lifecycleTransitions(
  phases: readonly WorkflowPhase[],
): readonly WorkflowTransition[] {
  return [
    ...phases.flatMap((phase) => [
      routeTransition("active", phase, "blocked", phase, "block"),
      routeTransition("blocked", phase, "active", phase, "resume"),
      routeTransition("active", phase, "cancelled", phase, "cancel"),
    ]),
    routeTransition("completed", "finish", "archived", "finish", "archive"),
  ];
}

function routeTransition(
  fromLifecycle: WorkflowLifecycle,
  fromPhase: WorkflowPhase,
  toLifecycle: WorkflowLifecycle,
  toPhase: WorkflowPhase,
  ...requiredGates: readonly WorkflowGate[]
): WorkflowTransition {
  return Object.freeze({
    from: Object.freeze({
      lifecycle: fromLifecycle,
      phase: fromPhase,
      step: transitionStep(fromLifecycle),
    }),
    to: Object.freeze({
      lifecycle: toLifecycle,
      phase: toPhase,
      step: transitionStep(toLifecycle),
    }),
    requiredGates: Object.freeze([...requiredGates]),
  });
}

function transitionStep(lifecycle: WorkflowLifecycle): string {
  return lifecycle === "completed" || lifecycle === "archived"
    ? lifecycle
    : "ready";
}

function validateStartRequest(
  request: StartWorkflowTaskRequest,
): WorkflowDiagnostic | null {
  if (request.contractVersion !== WORKFLOW_CONTRACT_VERSION) {
    return diagnostic(
      "workflow.contract_version.unsupported",
      "$.contractVersion",
      "Workflow contract version is not supported.",
      `Set contractVersion to ${WORKFLOW_CONTRACT_VERSION} and retry.`,
    );
  }
  if (!isIdentifier(request.task.id)) {
    return invalidRequest("$.task.id", "Task id must be a non-empty identifier.");
  }
  if (!isWorkflowRoute(request.task.route)) {
    return invalidRequest("$.task.route", "Task Route is not supported.");
  }
  if (request.task.title.trim().length === 0) {
    return invalidRequest("$.task.title", "Task title must not be empty.");
  }
  if (request.task.baselineRef.trim().length === 0) {
    return invalidRequest(
      "$.task.baselineRef",
      "Task must reference its captured Baseline.",
    );
  }
  if (
    !Number.isSafeInteger(request.task.policies.maxRepairAttempts) ||
    request.task.policies.maxRepairAttempts < 0 ||
    request.task.policies.maxRepairAttempts > 2
  ) {
    return invalidRequest(
      "$.task.policies.maxRepairAttempts",
      "Maximum repair attempts must be a safe integer from 0 through 2.",
    );
  }
  const pathDiagnostic = validateTaskPaths(request.task, "$.task");
  if (pathDiagnostic !== null) {
    return pathDiagnostic;
  }
  const routeGateDiagnostic = validateRouteGate(
    request.task.route,
    request.routeGate,
  );
  if (routeGateDiagnostic !== null) {
    return routeGateDiagnostic;
  }
  return validateEventMetadata(request.event, "$.event");
}

function validateRouteGate(
  route: WorkflowRoute,
  routeGate: GateAcceptance | undefined,
): WorkflowDiagnostic | null {
  if (routeGate === undefined) {
    return diagnostic(
      "workflow.gate.unmet",
      "$.routeGate",
      `Route ${route} has not been accepted for Task creation.`,
      "Provide the Route Gate with typed acceptance Evidence.",
    );
  }
  const gateDiagnostic = validateGates(["route"], [routeGate]);
  if (gateDiagnostic !== null) {
    return { ...gateDiagnostic, path: "$.routeGate" };
  }
  if (
    route !== "quick" &&
    !routeGate.evidence.some((evidence) => evidence.kind === "human-approval")
  ) {
    return diagnostic(
      "workflow.gate.evidence_invalid",
      "$.routeGate",
      `Route ${route} requires human confirmation before Task creation.`,
      "Attach human-approval Evidence to the Route Gate.",
    );
  }
  return null;
}

function validateTaskPaths(
  task: WorkflowTaskDefinition,
  path: string,
): WorkflowDiagnostic | null {
  const scopePaths = [
    ["files", task.scope.files],
    ["locks", task.scope.locks],
  ] as const;
  for (const [kind, values] of scopePaths) {
    for (let index = 0; index < values.length; index += 1) {
      if (!isRepositoryRelativePath(values[index])) {
        return invalidRequest(
          `${path}.scope.${kind}[${index}]`,
          "Task Scope paths must be repository-relative, use '/', and contain no '..' traversal.",
        );
      }
    }
  }
  if (!isRepositoryRelativePath(task.baselineRef)) {
    return invalidRequest(
      `${path}.baselineRef`,
      "Baseline reference must be a repository-relative path.",
    );
  }
  for (const [phase, reference] of Object.entries(task.contexts)) {
    if (!isRepositoryRelativePath(reference)) {
      return invalidRequest(
        `${path}.contexts.${phase}`,
        "Context reference must be a repository-relative path.",
      );
    }
  }
  return null;
}


function validateTransitionRequest(
  state: WorkflowState,
  request: TransitionWorkflowRequest,
  stateIsConsistent: boolean,
): WorkflowDiagnostic | null {
  if (request.contractVersion !== WORKFLOW_CONTRACT_VERSION) {
    return diagnostic(
      "workflow.contract_version.unsupported",
      "$.contractVersion",
      "Workflow contract version is not supported.",
      `Set contractVersion to ${WORKFLOW_CONTRACT_VERSION} and retry.`,
    );
  }
  if (request.taskId !== state.projection.id) {
    return diagnostic(
      "workflow.task.mismatch",
      "$.taskId",
      "Transition Task id does not match the current Projection.",
      "Reload the intended Task and submit its stable id.",
    );
  }
  if (!stateIsConsistent) {
    return diagnostic(
      "workflow.state.inconsistent",
      "$.state",
      "Task Projection or accepted Workflow Event history is inconsistent.",
      "Rebuild the Projection from a complete valid Event stream before mutation.",
    );
  }
  if (request.expectedVersion !== state.projection.version) {
    return diagnostic(
      "workflow.version.stale",
      "$.expectedVersion",
      `Expected Task version ${request.expectedVersion} does not match current version ${state.projection.version}.`,
      "Reload the current Projection and reconsider the transition.",
    );
  }
  if (request.to.step.trim().length === 0) {
    return invalidRequest("$.to.step", "Target Step must not be empty.");
  }
  if (
    request.blockers !== undefined &&
    request.blockers.some(
      (blocker) => typeof blocker !== "string" || blocker.trim().length === 0,
    )
  ) {
    return invalidRequest(
      "$.blockers",
      "Blocker reasons must be non-empty strings.",
    );
  }
  return validateEventMetadata(request.event, "$.event");
}

function validateTransitionInvariants(
  projection: TaskProjection,
  events: readonly WorkflowEvent[],
  to: WorkflowPosition,
  blockers: readonly string[] | undefined,
): WorkflowDiagnostic | null {
  const preservesPosition =
    to.lifecycle === "blocked" ||
    to.lifecycle === "cancelled" ||
    (projection.lifecycle === "blocked" && to.lifecycle === "active");
  if (
    preservesPosition &&
    (to.phase !== projection.phase || to.step !== projection.step)
  ) {
    return invalidRequest(
      "$.to",
      `${to.lifecycle} must retain the current Phase and Step.`,
    );
  }
  if (to.lifecycle === "blocked" && (blockers === undefined || blockers.length === 0)) {
    return invalidRequest(
      "$.blockers",
      "Blocked Tasks must retain at least one blocker reason.",
    );
  }
  if (to.lifecycle !== "blocked" && blockers !== undefined && blockers.length > 0) {
    return invalidRequest(
      "$.blockers",
      "Blocker reasons may be supplied only when entering blocked.",
    );
  }
  if (
    projection.lifecycle === "active" &&
    projection.phase === "review" &&
    to.lifecycle === "active" &&
    to.phase === "implement" &&
    countRepairAttempts(events) >= projection.policies.maxRepairAttempts
  ) {
    return diagnostic(
      "workflow.repair.exhausted",
      "$.to",
      "Configured Review repair attempts are exhausted.",
      "Transition the Task to blocked with the unresolved Review Evidence.",
    );
  }
  return null;
}

function validateInitiativeGraphTransition(
  projection: TaskProjection,
  events: readonly WorkflowEvent[],
  to: WorkflowPosition,
  initiativeGraph: DependencyGraph | null | undefined,
): DependencyGraph | WorkflowDiagnostic | null {
  const entersInitiativeIntegrate =
    projection.route === "initiative" &&
    projection.phase === "plan" &&
    to.phase === "integrate";
  if (!entersInitiativeIntegrate) {
    return initiativeGraph === null || initiativeGraph === undefined
      ? null
      : invalidRequest(
          "$.initiativeGraph",
          "Dependency Graph snapshots may be supplied only when Initiative enters Integrate.",
        );
  }
  if (initiativeGraph === null || initiativeGraph === undefined) {
    return diagnostic(
      "workflow.gate.unmet",
      "$.initiativeGraph",
      "Initiative cannot leave Plan without a validated Dependency Graph snapshot.",
      "Provide the current graph snapshot with the Initiative readiness Gate.",
    );
  }
  return validateInitiativeGraphSnapshot(initiativeGraph, projection, events);
}

function validateInitiativeGraphSnapshot(
  graph: DependencyGraph,
  projection: TaskProjection,
  events: readonly WorkflowEvent[],
): DependencyGraph | WorkflowDiagnostic {
  const validation = validateDependencyGraphContract({
    contractVersion: DEPENDENCY_GRAPH_CONTRACT_VERSION,
    graph,
  });
  if (!validation.ok) {
    return dependencyGraphWorkflowDiagnostic(validation.diagnostics[0]!);
  }
  if (validation.graph.id !== projection.initiativeGraphId) {
    return graphFailure(
      "$.initiativeGraph.id",
      "Dependency Graph id does not match the Initiative Projection.",
    );
  }
  if (validation.graph.initiativeTaskId !== projection.id) {
    return graphFailure(
      "$.initiativeGraph.initiativeTaskId",
      "Dependency Graph Initiative Task id does not match the Projection.",
    );
  }
  if (!events.some((event) => event.eventId === validation.graph.updatedByEvent)) {
    return graphFailure(
      "$.initiativeGraph.updatedByEvent",
      "Dependency Graph is not bound to an accepted Event in this Task history.",
    );
  }
  return validation.graph;
}

function isWorkflowDiagnostic(
  value: DependencyGraph | WorkflowDiagnostic | null,
): value is WorkflowDiagnostic {
  return value !== null && Object.hasOwn(value, "code");
}

function dependencyGraphWorkflowDiagnostic(
  value: DependencyGraphDiagnostic,
): WorkflowDiagnostic {
  const graphPath = "$.graph";
  const suffix = value.path.startsWith(graphPath)
    ? value.path.slice(graphPath.length)
    : "";
  return Object.freeze({
    ...value,
    path: `$.initiativeGraph${suffix}`,
  });
}


function graphFailure(path: string, message: string): WorkflowDiagnostic {
  return diagnostic(
    "workflow.graph.invalid",
    path,
    message,
    "Provide the current schema-valid, acyclic graph bound to this Initiative.",
  );
}

function countRepairAttempts(events: readonly WorkflowEvent[]): number {
  let attempts = 0;
  for (const event of events) {
    if (
      event.type === "workflow_transitioned" &&
      event.from.lifecycle === "active" &&
      event.from.phase === "review" &&
      event.to.lifecycle === "active" &&
      event.to.phase === "implement"
    ) {
      attempts += 1;
    }
  }
  return attempts;
}

function blockersAfterTransition(
  projection: TaskProjection,
  request: TransitionWorkflowRequest,
): readonly string[] {
  if (request.to.lifecycle === "blocked") {
    return copyStrings(request.blockers!);
  }
  if (projection.lifecycle === "blocked" && request.to.lifecycle === "active") {
    return Object.freeze([]);
  }
  return projection.blockers;
}

function matchesTransitionIntent(
  event: WorkflowTransitionedEvent,
  request: TransitionWorkflowRequest,
): boolean {
  return (
    event.taskId === request.taskId &&
    event.sequence === request.expectedVersion + 1 &&
    positionsEqual(event.to, request.to) &&
    stableJson(event.gates) === stableJson(request.gates) &&
    stableJson(event.blockers) === stableJson(request.blockers ?? []) &&
    stableJson(event.initiativeGraph) ===
      stableJson(request.initiativeGraph ?? null) &&
    event.reason === request.event.reason &&
    event.actor.kind === request.event.actor.kind &&
    event.actor.id === request.event.actor.id &&
    event.actor.sessionRef === request.event.actor.sessionRef
  );
}

function validateReplayEvent(
  event: WorkflowEvent,
  index: number,
): WorkflowDiagnostic | null {
  const path = `$[${index}]`;
  if (event.schemaVersion !== DURABLE_RECORD_SCHEMA_VERSION) {
    return diagnostic(
      "workflow.event.invalid",
      `${path}.schemaVersion`,
      "Workflow Event schema version is not supported.",
      `Migrate the Event to schemaVersion ${DURABLE_RECORD_SCHEMA_VERSION}.`,
    );
  }
  if (!Object.hasOwn(event, "initiativeGraph")) {
    return diagnostic(
      "workflow.event.invalid",
      `${path}.initiativeGraph`,
      "Workflow Event must declare the initiativeGraph field.",
      "Restore initiativeGraph as null or the accepted Dependency Graph snapshot.",
    );
  }
  if (event.initiativeGraph !== null && !isUnknownRecord(event.initiativeGraph)) {
    return diagnostic(
      "workflow.event.invalid",
      `${path}.initiativeGraph`,
      "Workflow Event initiativeGraph must be null or a readable object.",
      "Restore initiativeGraph as null or the accepted Dependency Graph snapshot.",
    );
  }
  if (
    !isIdentifier(event.taskId) ||
    !isWorkflowRoute(event.route) ||
    !Number.isSafeInteger(event.sequence) ||
    event.sequence < 1 ||
    typeof event.chainDigest !== "string" ||
    (event.previousChainDigest !== null &&
      typeof event.previousChainDigest !== "string") ||
    event.outcome !== "accepted" ||
    !isWorkflowPosition(event.to) ||
    !Array.isArray(event.gates) ||
    !event.gates.every(isGateAcceptance) ||
    !isStringArray(event.blockers)
  ) {
    return diagnostic(
      "workflow.event.invalid",
      path,
      "Workflow Event record contains invalid required fields.",
      "Restore a schema-valid accepted Workflow Event.",
    );
  }
  if (
    event.type === "task_created"
      ? event.from !== null || !isWorkflowTaskDefinition(event.task)
      : event.type !== "workflow_transitioned" || !isWorkflowPosition(event.from)
  ) {
    return diagnostic(
      "workflow.event.invalid",
      path,
      "Workflow Event type payload is invalid.",
      "Restore the required task_created or workflow_transitioned payload.",
    );
  }
  return validateEventMetadata(event, path);
}

function validateEventMetadata(
  event: WorkflowEventMetadata,
  path: string,
): WorkflowDiagnostic | null {
  if (!isIdentifier(event.eventId)) {
    return invalidRequest(`${path}.eventId`, "Event id must be non-empty.");
  }
  if (!isWorkflowActor(event.actor)) {
    return invalidRequest(
      `${path}.actor`,
      "Event actor requires a supported kind, stable id, and session reference.",
    );
  }
  if (typeof event.reason !== "string" || event.reason.trim().length === 0) {
    return invalidRequest(`${path}.reason`, "Accepted Event reason must not be empty.");
  }
  if (!isIdentifier(event.idempotencyKey)) {
    return invalidRequest(
      `${path}.idempotencyKey`,
      "Event idempotency key must not be empty.",
    );
  }
  if (!isTimestamp(event.occurredAt)) {
    return invalidRequest(
      `${path}.occurredAt`,
      "Event occurrence time must be a valid RFC 3339 UTC timestamp.",
    );
  }
  return null;
}

function isWorkflowActor(value: unknown): value is WorkflowActor {
  if (!isUnknownRecord(value)) {
    return false;
  }
  return (
    (value.kind === "orchestrator" ||
      value.kind === "user" ||
      value.kind === "agent" ||
      value.kind === "system") &&
    isIdentifier(value.id) &&
    typeof value.sessionRef === "string" &&
    value.sessionRef.length > 0
  );
}

function isWorkflowPosition(value: unknown): value is WorkflowPosition {
  if (!isUnknownRecord(value)) {
    return false;
  }
  return (
    isWorkflowLifecycle(value.lifecycle) &&
    isWorkflowPhase(value.phase) &&
    typeof value.step === "string" &&
    value.step.length > 0
  );
}

function isGateAcceptance(value: unknown): value is GateAcceptance {
  if (!isUnknownRecord(value) || !isWorkflowGate(value.gate)) {
    return false;
  }
  return (
    Array.isArray(value.evidence) &&
    value.evidence.every(
      (evidence) =>
        isUnknownRecord(evidence) &&
        isGateEvidenceKind(evidence.kind) &&
        typeof evidence.reference === "string" &&
        evidence.reference.length > 0,
    )
  );
}

function isWorkflowTaskDefinition(value: unknown): value is WorkflowTaskDefinition {
  if (!isUnknownRecord(value)) {
    return false;
  }
  const intent = value.intent;
  const scope = value.scope;
  const contexts = value.contexts;
  const policies = value.policies;
  return (
    isIdentifier(value.id) &&
    typeof value.title === "string" &&
    value.title.trim().length > 0 &&
    isWorkflowRoute(value.route) &&
    (value.parentTaskId === null || isIdentifier(value.parentTaskId)) &&
    (value.initiativeGraphId === null || isIdentifier(value.initiativeGraphId)) &&
    isUnknownRecord(intent) &&
    isStringArray(intent.goals) &&
    isStringArray(intent.nonGoals) &&
    isStringArray(intent.acceptanceCriteria) &&
    isUnknownRecord(scope) &&
    isStringArray(scope.files) &&
    scope.files.every(isRepositoryRelativePath) &&
    isStringArray(scope.apis) &&
    isStringArray(scope.schemas) &&
    isStringArray(scope.locks) &&
    scope.locks.every(isRepositoryRelativePath) &&
    isRepositoryRelativePath(value.baselineRef) &&
    isUnknownRecord(contexts) &&
    Object.entries(contexts).every(
      ([phase, reference]) =>
        isWorkflowPhase(phase) &&
        isRepositoryRelativePath(reference),
    ) &&
    isUnknownRecord(policies) &&
    (policies.commit === "auto-after-review" ||
      policies.commit === "confirm" ||
      policies.commit === "never") &&
    policies.push === "never" &&
    Number.isSafeInteger(policies.maxRepairAttempts) &&
    (policies.maxRepairAttempts as number) >= 0 &&
    (policies.maxRepairAttempts as number) <= 2
  );
}

function isWorkflowLifecycle(value: unknown): value is WorkflowLifecycle {
  return (
    value === "proposed" ||
    value === "active" ||
    value === "blocked" ||
    value === "completed" ||
    value === "archived" ||
    value === "cancelled"
  );
}

export function isWorkflowPhase(value: unknown): value is WorkflowPhase {
  return (
    value === "triage" ||
    value === "explore" ||
    value === "plan" ||
    value === "implement" ||
    value === "review" ||
    value === "integrate" ||
    value === "finish"
  );
}

function isWorkflowGate(value: unknown): value is WorkflowGate {
  return typeof value === "string" && Object.hasOwn(evidenceKindsByGate, value);
}

function isGateEvidenceKind(value: unknown): value is GateEvidenceKind {
  return (
    value === "human-approval" ||
    value === "validation" ||
    value === "review" ||
    value === "workflow"
  );
}

function isStringArray(value: unknown): value is readonly string[] {
  return (
    Array.isArray(value) &&
    value.every((item) => typeof item === "string" && item.trim().length > 0)
  );
}

export function isUnknownRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function validateGates(
  requiredGates: readonly WorkflowGate[],
  gates: readonly GateAcceptance[],
): WorkflowDiagnostic | null {
  const accepted = new Map<WorkflowGate, GateAcceptance>();
  for (const gate of gates) {
    if (accepted.has(gate.gate)) {
      return diagnostic(
        "workflow.gate.unexpected",
        "$.gates",
        `Gate ${gate.gate} is declared more than once.`,
        "Provide each required Gate exactly once.",
      );
    }
    accepted.set(gate.gate, gate);
  }

  for (const requiredGate of requiredGates) {
    const acceptance = accepted.get(requiredGate);
    if (acceptance === undefined) {
      return diagnostic(
        "workflow.gate.unmet",
        "$.gates",
        `Required Gate ${requiredGate} has not been satisfied.`,
        "Provide the required Gate with typed Evidence before retrying.",
      );
    }
    if (acceptance.evidence.length === 0) {
      return diagnostic(
        "workflow.gate.evidence_invalid",
        "$.gates",
        `Gate ${requiredGate} requires at least one Evidence reference.`,
        "Attach typed Evidence produced for this Gate.",
      );
    }
    const allowedKinds = evidenceKindsByGate[requiredGate];
    for (const evidence of acceptance.evidence) {
      if (
        !allowedKinds.includes(evidence.kind) ||
        evidence.reference.trim().length === 0
      ) {
        return diagnostic(
          "workflow.gate.evidence_invalid",
          "$.gates",
          `Gate ${requiredGate} contains incompatible or empty Evidence.`,
          `Use ${allowedKinds.join(" or ")} Evidence with a stable reference.`,
        );
      }
    }
  }

  for (const gate of accepted.keys()) {
    if (!requiredGates.includes(gate)) {
      return diagnostic(
        "workflow.gate.unexpected",
        "$.gates",
        `Gate ${gate} is not a prerequisite of this transition.`,
        "Submit only the Gates declared by the Route transition.",
      );
    }
  }
  return null;
}

function findTransition(
  projection: TaskProjection,
  to: WorkflowPosition,
): WorkflowTransition | undefined {
  return routeDefinitions[projection.route].transitions.find(
    (candidate) =>
      candidate.from.lifecycle === projection.lifecycle &&
      candidate.from.phase === projection.phase &&
      candidate.from.step === projection.step &&
      candidate.to.lifecycle === to.lifecycle &&
      candidate.to.phase === to.phase &&
      candidate.to.step === to.step,
  );
}

function projectCreatedEvent(event: TaskCreatedEvent): TaskProjection {
  return Object.freeze({
    schemaVersion: DURABLE_RECORD_SCHEMA_VERSION,
    ...event.task,
    lifecycle: event.to.lifecycle,
    phase: event.to.phase,
    step: event.to.step,
    version: event.sequence,
    eventHead: freezeEventHead(event),
    blockers: copyStrings(event.blockers),
    externalReferences: Object.freeze([]),
    createdAt: event.occurredAt,
    updatedAt: event.occurredAt,
  });
}

function projectTransitionEvent(
  projection: TaskProjection,
  event: WorkflowTransitionedEvent,
): TaskProjection {
  return Object.freeze({
    ...projection,
    lifecycle: event.to.lifecycle,
    phase: event.to.phase,
    step: event.to.step,
    version: event.sequence,
    eventHead: freezeEventHead(event),
    blockers: copyStrings(event.blockers),
    updatedAt: event.occurredAt,
  });
}

function copyTaskDefinition(task: WorkflowTaskDefinition): WorkflowTaskDefinition {
  return Object.freeze({
    id: task.id,
    title: task.title,
    route: task.route,
    parentTaskId: task.parentTaskId,
    initiativeGraphId: task.initiativeGraphId,
    intent: Object.freeze({
      goals: copyStrings(task.intent.goals),
      nonGoals: copyStrings(task.intent.nonGoals),
      acceptanceCriteria: copyStrings(task.intent.acceptanceCriteria),
    }),
    scope: Object.freeze({
      files: copyStrings(task.scope.files),
      apis: copyStrings(task.scope.apis),
      schemas: copyStrings(task.scope.schemas),
      locks: copyStrings(task.scope.locks),
    }),
    baselineRef: task.baselineRef,
    contexts: Object.freeze({ ...task.contexts }),
    policies: Object.freeze({ ...task.policies }),
  });
}

function copyCreatedEvent(event: TaskCreatedEvent): TaskCreatedEvent {
  return Object.freeze({
    ...event,
    from: null,
    to: freezePosition(event.to),
    actor: copyActor(event.actor),
    gates: copyGateAcceptances(event.gates),
    blockers: copyStrings(event.blockers),
    initiativeGraph: null,
    task: copyTaskDefinition(event.task),
  });
}

function copyTransitionEvent(
  event: WorkflowTransitionedEvent,
  initiativeGraph: DependencyGraph | null,
): WorkflowTransitionedEvent {
  return Object.freeze({
    ...event,
    from: freezePosition(event.from),
    to: freezePosition(event.to),
    actor: copyActor(event.actor),
    gates: copyGateAcceptances(event.gates),
    blockers: copyStrings(event.blockers),
    initiativeGraph,
  });
}


function copyGateAcceptances(
  gates: readonly GateAcceptance[],
): readonly GateAcceptance[] {
  return Object.freeze(
    gates.map((gate) =>
      Object.freeze({
        gate: gate.gate,
        evidence: Object.freeze(
          gate.evidence.map((evidence) => Object.freeze({ ...evidence })),
        ),
      }),
    ),
  );
}

function copyActor(actor: WorkflowActor): WorkflowActor {
  return Object.freeze({ ...actor });
}

function copyStrings(values: readonly string[]): readonly string[] {
  return Object.freeze([...values]);
}

function freezePosition(position: WorkflowPosition): WorkflowPosition {
  return Object.freeze({ ...position });
}

function freezeEventHead(event: WorkflowEvent): WorkflowEventHead {
  return Object.freeze({
    sequence: event.sequence,
    eventId: event.eventId,
    chainDigest: event.chainDigest,
  });
}

function freezeState(
  events: readonly WorkflowEvent[],
  projection: TaskProjection,
): WorkflowState {
  return Object.freeze({
    events: Object.freeze([...events]),
    projection,
  });
}

function positionOf(projection: TaskProjection): WorkflowPosition {
  return {
    lifecycle: projection.lifecycle,
    phase: projection.phase,
    step: projection.step,
  };
}

function positionsEqual(left: WorkflowPosition, right: WorkflowPosition): boolean {
  return (
    left.lifecycle === right.lifecycle &&
    left.phase === right.phase &&
    left.step === right.step
  );
}

function stateMatchesAcceptedHistory(state: WorkflowState): boolean {
  const replayed = replayWorkflowEvents(state.events);
  return (
    replayed.ok &&
    stableJson(replayed.state.projection) === stableJson(state.projection)
  );
}

function isValidCreationEvent(event: WorkflowEvent): event is TaskCreatedEvent {
  return (
    event.type === "task_created" &&
    event.from === null &&
    event.sequence === 1 &&
    event.previousChainDigest === null &&
    event.taskId === event.task.id &&
    event.route === event.task.route &&
    event.to.lifecycle === "active" &&
    event.to.phase === "triage" &&
    event.to.step.length > 0 &&
    event.gates.length === 1 &&
    validateRouteGate(event.route, event.gates[0]) === null &&
    event.blockers.length === 0 &&
    event.initiativeGraph === null &&
    validateStartRequest({
      contractVersion: WORKFLOW_CONTRACT_VERSION,
      task: event.task,
      routeGate: event.gates[0]!,
      event,
    }) === null
  );
}

function digestEvent(
  event: Omit<TaskCreatedEvent, "chainDigest"> |
    Omit<WorkflowTransitionedEvent, "chainDigest"> |
    WorkflowEvent,
): string {
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
  if (event.type === "task_created") {
    payload.task = event.task;
  }
  return hashCanonicalJson(payload);
}




function isWorkflowRoute(value: unknown): value is WorkflowRoute {
  return value === "quick" || value === "build" || value === "initiative";
}

function invalidRequest(path: string, message: string): WorkflowDiagnostic {
  return diagnostic(
    "workflow.request.invalid",
    path,
    message,
    "Provide a schema-valid workflow request and retry.",
  );
}

function diagnostic(
  code: WorkflowDiagnosticCode,
  path: string,
  message: string,
  remediation: string,
): WorkflowDiagnostic {
  return Object.freeze({ code, path, message, remediation });
}

function startFailure(diagnosticValue: WorkflowDiagnostic): StartWorkflowTaskResult {
  return Object.freeze({
    ok: false,
    contractVersion: WORKFLOW_CONTRACT_VERSION,
    diagnostics: Object.freeze([diagnosticValue]),
  });
}

function transitionFailure(
  state: WorkflowState,
  diagnosticValue: WorkflowDiagnostic,
): TransitionWorkflowResult {
  return Object.freeze({
    ok: false,
    contractVersion: WORKFLOW_CONTRACT_VERSION,
    state,
    diagnostics: Object.freeze([diagnosticValue]),
  });
}

function replayFailure(
  diagnosticValue: WorkflowDiagnostic,
): ReplayWorkflowEventsResult {
  return Object.freeze({
    ok: false,
    contractVersion: WORKFLOW_CONTRACT_VERSION,
    diagnostics: Object.freeze([diagnosticValue]),
  });
}
