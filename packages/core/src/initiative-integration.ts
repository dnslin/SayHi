import {
  DEPENDENCY_GRAPH_CONTRACT_VERSION,
  validateDependencyGraph,
} from "./dependency-graph.js";
import type { InitiativeReadinessResult } from "./initiative-readiness.js";
import type {
  DependencyGraph,
  InitiativeRepairContext,
  TaskIntent,
  TaskScope,
} from "./workflow.js";

export interface InitiativeRepairNode {
  readonly taskId: string;
  readonly priority: number;
  readonly resources: TaskScope;
  readonly blockers: readonly string[];
  readonly context: InitiativeRepairContext;
  readonly intent: TaskIntent;
}

export interface PrepareInitiativeRepairGraphRequest {
  readonly graph: DependencyGraph;
  readonly readiness: InitiativeReadinessResult;
  readonly repairs: readonly InitiativeRepairNode[];
  readonly updatedByEvent: string;
}

export function pendingInitiativeIntegrationTaskIds(
  graph: DependencyGraph,
  readiness: InitiativeReadinessResult,
): readonly string[] {
  const graphTaskIds = new Set(graph.nodes.map((node) => node.taskId));
  const readinessByTaskId = new Map<string, InitiativeReadinessResult["nodes"][number]>();
  for (const node of readiness.nodes) {
    if (readinessByTaskId.has(node.taskId)) {
      throw new TypeError(`Initiative readiness contains duplicate Task ${node.taskId}.`);
    }
    if (!graphTaskIds.has(node.taskId)) {
      throw new TypeError(
        `Initiative readiness contains Task ${node.taskId} outside the accepted Dependency Graph.`,
      );
    }
    readinessByTaskId.set(node.taskId, node);
  }
  const missingTaskId = graph.nodes.find(
    (node) => !readinessByTaskId.has(node.taskId),
  )?.taskId;
  if (missingTaskId !== undefined) {
    throw new TypeError(
      `Initiative readiness is missing Dependency Graph Task ${missingTaskId}.`,
    );
  }
  return Object.freeze(
    graph.nodes
      .filter((node) => readinessByTaskId.get(node.taskId)?.readiness !== "completed")
      .map((node) => node.taskId),
  );
}

export function prepareInitiativeRepairGraph(
  request: PrepareInitiativeRepairGraphRequest,
): DependencyGraph {
  const pendingTaskIds = pendingInitiativeIntegrationTaskIds(
    request.graph,
    request.readiness,
  );
  if (pendingTaskIds.length > 0) {
    throw new TypeError(
      `Initiative Integration requires completed Build nodes; pending: ${pendingTaskIds.join(", ")}.`,
    );
  }
  if (request.repairs.length === 0) {
    throw new TypeError("A failed Initiative Integration must create at least one Repair node.");
  }

  const taskIds = new Set(request.graph.nodes.map((node) => node.taskId));
  const repairNodes = request.repairs.map((repair) => {
    if (taskIds.has(repair.taskId)) {
      throw new TypeError(`Initiative Repair Task ${repair.taskId} already exists in the graph.`);
    }
    taskIds.add(repair.taskId);
    if (repair.blockers.length === 0) {
      throw new TypeError(
        `Initiative Repair Task ${repair.taskId} must declare completed Build blockers.`,
      );
    }
    const blockerIds = new Set<string>();
    for (const blockerTaskId of repair.blockers) {
      if (!blockerIds.add(blockerTaskId)) {
        throw new TypeError(
          `Initiative Repair Task ${repair.taskId} repeats blocker ${blockerTaskId}.`,
        );
      }
      if (!request.graph.nodes.some((node) => node.taskId === blockerTaskId)) {
        throw new TypeError(
          `Initiative Repair Task ${repair.taskId} references unknown blocker ${blockerTaskId}.`,
        );
      }
    }
    if (!hasRepairIntent(repair.intent)) {
      throw new TypeError(
        `Initiative Repair Task ${repair.taskId} must declare goals and independently verifiable acceptance criteria.`,
      );
    }
    return repair;
  });

  const graph = {
    ...request.graph,
    version: request.graph.version + 1,
    nodes: [
      ...request.graph.nodes,
      ...repairNodes.map((repair) => ({
        taskId: repair.taskId,
        priority: repair.priority,
        resources: repair.resources,
        repair: repair.context,
        repairIntent: repair.intent,
      })),
    ],
    edges: [
      ...request.graph.edges,
      ...repairNodes.flatMap((repair) =>
        repair.blockers.map((blockerTaskId) => ({
          from: blockerTaskId,
          to: repair.taskId,
          type: "blocks" as const,
          reason: repair.context.summary,
        })),
      ),
    ],
    updatedByEvent: request.updatedByEvent,
  };
  const validation = validateDependencyGraph({
    contractVersion: DEPENDENCY_GRAPH_CONTRACT_VERSION,
    graph,
  });
  if (!validation.ok) {
    throw new TypeError(validation.diagnostics[0]?.message ?? "Invalid Initiative Repair graph.");
  }
  return validation.graph;
}

function hasRepairIntent(value: unknown): value is TaskIntent {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return false;
  }
  const intent = value as Record<string, unknown>;
  return (
    isNonEmptyStringList(intent.goals) &&
    isStringList(intent.nonGoals) &&
    isNonEmptyStringList(intent.acceptanceCriteria)
  );
}

function isNonEmptyStringList(value: unknown): value is readonly string[] {
  return Array.isArray(value) && value.length > 0 && isStringList(value);
}

function isStringList(value: unknown): value is readonly string[] {
  return (
    Array.isArray(value) &&
    value.every(
      (entry) => typeof entry === "string" && entry.trim().length > 0,
    )
  );
}
