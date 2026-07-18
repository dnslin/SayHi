import type { DependencyGraph, WorkflowState } from "./workflow.js";

export type InitiativeReadiness = "ready" | "waiting" | "blocked" | "completed";

export type InitiativeReadinessBlockerCode =
  | "initiative_readiness.task_missing"
  | "initiative_readiness.task_blocked"
  | "initiative_readiness.task_cancelled"
  | "initiative_readiness.task_failed"
  | "initiative_readiness.task_repair_required"
  | "initiative_readiness.task_in_progress"
  | "initiative_readiness.task_route_invalid"
  | "initiative_readiness.task_context_invalid"
  | "initiative_readiness.task_gate_unmet"
  | "initiative_readiness.dependency_incomplete"
  | "initiative_readiness.dependency_blocked"
  | "initiative_readiness.dependency_cancelled"
  | "initiative_readiness.dependency_failed"
  | "initiative_readiness.dependency_evidence_required"
  | "initiative_readiness.dependency_repair_required";

export interface InitiativeReadinessBlocker {
  readonly code: InitiativeReadinessBlockerCode;
  readonly taskId: string;
  readonly message: string;
}


export type InitiativeReadinessContextState = "valid" | "invalid";
export interface InitiativeReadinessTask {
  readonly taskId: string;
  readonly state: WorkflowState | null;
  readonly contextState: InitiativeReadinessContextState;
}

export function requiresInitiativeTriageContext(
  state: WorkflowState | null,
): boolean {
  return (
    state !== null &&
    state.projection.route === "build" &&
    state.projection.lifecycle === "active" &&
    state.projection.phase === "triage"
  );
}

export interface InitiativeReadinessNode {
  readonly taskId: string;
  readonly readiness: InitiativeReadiness;
  readonly blockers: readonly InitiativeReadinessBlocker[];
}

export interface InitiativeReadinessResult {
  readonly nodes: readonly InitiativeReadinessNode[];
  readonly frontier: readonly string[];
}

export function deriveInitiativeReadiness(
  graph: DependencyGraph,
  tasks: readonly InitiativeReadinessTask[],
): InitiativeReadinessResult {
  const taskStates = new Map(tasks.map((task) => [task.taskId, task]));
  const nodesByTaskId = new Map(graph.nodes.map((node) => [node.taskId, node]));
  const incomingDependencies = new Map<
    string,
    readonly DependencyGraph["edges"][number][]
  >();
  for (const node of graph.nodes) {
    incomingDependencies.set(
      node.taskId,
      graph.edges.filter(
        (edge) => edge.type !== "supersedes" && edge.to === node.taskId,
      ),
    );
  }

  const readinessByTaskId = new Map<string, InitiativeReadinessNode>();
  const deriveNode = (taskId: string): InitiativeReadinessNode => {
    const existing = readinessByTaskId.get(taskId);
    if (existing !== undefined) {
      return existing;
    }

    const task = taskStates.get(taskId);
    const taskState = task?.state ?? null;
    const taskReadiness = readinessForTask(
      taskId,
      taskState,
      task?.contextState ?? "invalid",
    );
    const blockers = [...taskReadiness.blockers];
    let readiness = taskReadiness.readiness;
    if (readiness !== "completed" && readiness !== "blocked") {
      let hasIncompleteDependency = false;
      let hasBlockedDependency = false;
      for (const edge of incomingDependencies.get(taskId) ?? []) {
        const predecessor = deriveNode(edge.from);
        if (predecessor.readiness === "completed") {
          if (edge.type === "blocks") {
            continue;
          }
          hasIncompleteDependency = true;
          blockers.push(
            blocker(
              "initiative_readiness.dependency_evidence_required",
              edge.from,
              `Task ${edge.from} completed, but its ${edge.type} dependency has no local evidence binding.`,
            ),
          );
          continue;
        }
        if (edge.type === "blocks" && predecessor.readiness === "blocked") {
          hasBlockedDependency = true;
          blockers.push(blockedDependency(edge.from, predecessor));
          continue;
        }
        hasIncompleteDependency = true;
        blockers.push(
          blocker(
            "initiative_readiness.dependency_incomplete",
            edge.from,
            `Task ${edge.from} must complete before ${taskId} can satisfy its ${edge.type} dependency.`,
          ),
        );
      }
      readiness = hasBlockedDependency
        ? "blocked"
        : hasIncompleteDependency || readiness === "waiting"
          ? "waiting"
          : "ready";
    }

    const node = Object.freeze({
      taskId,
      readiness,
      blockers: Object.freeze(blockers),
    });
    readinessByTaskId.set(taskId, node);
    return node;
  };

  const nodes = Object.freeze(graph.nodes.map((node) => deriveNode(node.taskId)));
  const frontier = Object.freeze(
    nodes
      .filter((node) => node.readiness === "ready")
      .sort((left, right) => {
        const priority =
          nodesByTaskId.get(right.taskId)!.priority - nodesByTaskId.get(left.taskId)!.priority;
        return priority === 0
          ? left.taskId < right.taskId
            ? -1
            : left.taskId > right.taskId
              ? 1
              : 0
          : priority;
      })
      .map((node) => node.taskId),
  );
  return Object.freeze({ nodes, frontier });
}

function readinessForTask(
  taskId: string,
  state: WorkflowState | null,
  contextState: InitiativeReadinessContextState,
): Readonly<{
  readiness: InitiativeReadiness;
  blockers: readonly InitiativeReadinessBlocker[];
}> {
  if (state === null) {
    return waitingState(
      "initiative_readiness.task_missing",
      taskId,
      `Task ${taskId} has not been created in the Project Store.`,
    );
  }
  if (state.projection.route !== "build") {
    return blockedState(
      "initiative_readiness.task_route_invalid",
      taskId,
      `Task ${taskId} uses the ${state.projection.route} Route; Initiative graph nodes must be Build Tasks.`,
    );
  }
  if (
    state.projection.lifecycle === "completed" ||
    state.projection.lifecycle === "archived"
  ) {
    return readinessState("completed");
  }
  if (state.projection.lifecycle === "cancelled") {
    return blockedState(
      "initiative_readiness.task_cancelled",
      taskId,
      `Task ${taskId} was cancelled.`,
    );
  }
  if (state.projection.lifecycle === "blocked") {
    const detail = state.projection.blockers.join("; ");
    return blockedState(
      "initiative_readiness.task_blocked",
      taskId,
      detail.length === 0 ? `Task ${taskId} is blocked.` : `Task ${taskId} is blocked: ${detail}.`,
    );
  }
  if (hasCurrentFailedExecution(state)) {
    return blockedState(
      "initiative_readiness.task_failed",
      taskId,
      `Task ${taskId} has an unresolved failed Phase execution result.`,
    );
  }
  if (hasCurrentRepairRequirement(state)) {
    return blockedState(
      "initiative_readiness.task_repair_required",
      taskId,
      `Task ${taskId} requires Review repair before dependent work can proceed.`,
    );
  }
  if (!requiresInitiativeTriageContext(state)) {
    return waitingState(
      "initiative_readiness.task_in_progress",
      taskId,
      `Task ${taskId} is active at ${state.projection.phase} and cannot reenter the ready frontier.`,
    );
  }
  if (!hasAcceptedRouteGate(state)) {
    return waitingState(
      "initiative_readiness.task_gate_unmet",
      taskId,
      `Task ${taskId} lacks accepted human Route Gate evidence.`,
    );
  }
  if (contextState !== "valid") {
    return waitingState(
      "initiative_readiness.task_context_invalid",
      taskId,
      `Task ${taskId} has no valid triage Context Manifest.`,
    );
  }
  return readinessState("ready");
}

const EMPTY_READINESS_BLOCKERS: readonly InitiativeReadinessBlocker[] = Object.freeze([]);

function readinessState(
  readiness: InitiativeReadiness,
  blockers: readonly InitiativeReadinessBlocker[] = EMPTY_READINESS_BLOCKERS,
): Readonly<{
  readiness: InitiativeReadiness;
  blockers: readonly InitiativeReadinessBlocker[];
}> {
  return Object.freeze({
    readiness,
    blockers:
      blockers.length === 0 ? EMPTY_READINESS_BLOCKERS : Object.freeze(blockers),
  });
}

function waitingState(
  code: Extract<InitiativeReadinessBlockerCode, `initiative_readiness.task_${string}`>,
  taskId: string,
  message: string,
): Readonly<{
  readiness: InitiativeReadiness;
  blockers: readonly InitiativeReadinessBlocker[];
}> {
  return readinessState("waiting", [blocker(code, taskId, message)]);
}

function blockedState(
  code: Extract<InitiativeReadinessBlockerCode, `initiative_readiness.task_${string}`>,
  taskId: string,
  message: string,
): Readonly<{
  readiness: InitiativeReadiness;
  blockers: readonly InitiativeReadinessBlocker[];
}> {
  return readinessState("blocked", [blocker(code, taskId, message)]);
}

function hasAcceptedRouteGate(state: WorkflowState): boolean {
  const created = state.events[0];
  return (
    created?.type === "task_created" &&
    created.gates.some(
      (gate) =>
        gate.gate === "route" &&
        gate.evidence.some((evidence) => evidence.kind === "human-approval"),
    )
  );
}

function hasCurrentFailedExecution(state: WorkflowState): boolean {
  for (let index = state.events.length - 1; index >= 0; index -= 1) {
    const event = state.events[index]!;
    if (event.type === "workflow_transitioned" || event.type === "task_created") {
      return false;
    }
    if (event.type === "phase_execution_result_accepted") {
      return isFailureOutcome(event.result);
    }
  }
  return false;
}

function hasCurrentRepairRequirement(state: WorkflowState): boolean {
  for (let index = state.events.length - 1; index >= 0; index -= 1) {
    const event = state.events[index]!;
    if (event.type === "workflow_transitioned") {
      return (
        event.from.phase === "review" &&
        event.to.lifecycle === "active" &&
        event.to.phase === "implement" &&
        event.gates.some((gate) => gate.gate === "review-repair")
      );
    }
    if (event.type === "task_created") {
      return false;
    }
  }
  return false;
}

function isFailureOutcome(value: unknown): boolean {
  return (
    typeof value === "object" &&
    value !== null &&
    "outcome" in value &&
    ((value as { outcome?: unknown }).outcome === "failed" ||
      (value as { outcome?: unknown }).outcome === "blocked")
  );
}

function blockedDependency(
  predecessorTaskId: string,
  predecessor: InitiativeReadinessNode,
): InitiativeReadinessBlocker {
  const source =
    predecessor.blockers.find(
      (blocker) =>
        blocker.code !== "initiative_readiness.task_missing" &&
        blocker.code !== "initiative_readiness.dependency_incomplete",
    ) ?? predecessor.blockers[0];
  const code = propagatedBlockerCode(source?.code);
  const taskId = source?.taskId ?? predecessorTaskId;
  const message =
    source === undefined
      ? `Task ${predecessorTaskId} is blocked and cannot satisfy its blocking dependency.`
      : `Task ${predecessorTaskId} cannot satisfy its blocking dependency because ${source.message}`;
  return blocker(code, taskId, message);
}

function propagatedBlockerCode(
  source: InitiativeReadinessBlockerCode | undefined,
): Extract<InitiativeReadinessBlockerCode, `initiative_readiness.dependency_${string}`> {
  switch (source) {
    case "initiative_readiness.task_cancelled":
    case "initiative_readiness.dependency_cancelled":
      return "initiative_readiness.dependency_cancelled";
    case "initiative_readiness.task_failed":
    case "initiative_readiness.dependency_failed":
      return "initiative_readiness.dependency_failed";
    case "initiative_readiness.task_repair_required":
    case "initiative_readiness.dependency_repair_required":
      return "initiative_readiness.dependency_repair_required";
    default:
      return "initiative_readiness.dependency_blocked";
  }
}

function blocker(
  code: InitiativeReadinessBlockerCode,
  taskId: string,
  message: string,
): InitiativeReadinessBlocker {
  return Object.freeze({ code, taskId, message });
}
