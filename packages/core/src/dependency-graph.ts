import { isRepositoryRelativePath } from "./repository-path.js";
import { DURABLE_RECORD_SCHEMA_VERSION, isIdentifier } from "./validation.js";
import type {
  DependencyGraph,
  DependencyGraphEdge,
  DependencyGraphEdgeType,
  DependencyGraphNode,
  InitiativeRepairContext,
} from "./workflow.js";

export const DEPENDENCY_GRAPH_CONTRACT_VERSION = 1 as const;

export type DependencyGraphDiagnosticCode =
  | "dependency_graph.request.invalid"
  | "dependency_graph.contract_version.unsupported"
  | "dependency_graph.schema_version.unsupported"
  | "dependency_graph.graph.invalid"
  | "dependency_graph.node.duplicate"
  | "dependency_graph.edge.invalid"
  | "dependency_graph.edge.reference_missing"
  | "dependency_graph.cycle.detected";

export interface DependencyGraphValidationRequest {
  readonly contractVersion: typeof DEPENDENCY_GRAPH_CONTRACT_VERSION;
  readonly graph: unknown;
}

export interface DependencyGraphDiagnostic {
  readonly code: DependencyGraphDiagnosticCode;
  readonly path: string;
  readonly message: string;
  readonly remediation: string;
}

export interface DependencyGraphValidationSuccess {
  readonly ok: true;
  readonly contractVersion: typeof DEPENDENCY_GRAPH_CONTRACT_VERSION;
  readonly graph: DependencyGraph;
}

export interface DependencyGraphValidationFailure {
  readonly ok: false;
  readonly contractVersion: typeof DEPENDENCY_GRAPH_CONTRACT_VERSION;
  readonly diagnostics: readonly DependencyGraphDiagnostic[];
}

export type DependencyGraphValidationResult =
  | DependencyGraphValidationSuccess
  | DependencyGraphValidationFailure;

export function validateDependencyGraph(
  request: unknown,
): DependencyGraphValidationResult {
  try {
    if (!isUnknownRecord(request)) {
      return failure(
        "dependency_graph.request.invalid",
        "$",
        "Dependency Graph validation request must be a readable object.",
        "Provide contractVersion and graph in a plain data object.",
      );
    }
    if (request.contractVersion !== DEPENDENCY_GRAPH_CONTRACT_VERSION) {
      return failure(
        "dependency_graph.contract_version.unsupported",
        "$.contractVersion",
        `Dependency Graph contract version ${String(request.contractVersion)} is unsupported.`,
        `Use Dependency Graph contract version ${DEPENDENCY_GRAPH_CONTRACT_VERSION}.`,
      );
    }
    if (!isUnknownRecord(request.graph)) {
      return failure(
        "dependency_graph.request.invalid",
        "$.graph",
        "Dependency Graph must be a readable object.",
        "Provide a plain Dependency Graph data object.",
      );
    }
    return validateReadableDependencyGraph(request.graph);
  } catch {
    return failure(
      "dependency_graph.request.invalid",
      "$",
      "Dependency Graph validation request could not be read safely.",
      "Provide a plain data object without accessors and retry.",
    );
  }
}

function validateReadableDependencyGraph(
  graph: Record<string, unknown>,
): DependencyGraphValidationResult {
  if (graph.schemaVersion !== DURABLE_RECORD_SCHEMA_VERSION) {
    return failure(
      "dependency_graph.schema_version.unsupported",
      "$.graph.schemaVersion",
      `Dependency Graph schema version ${String(graph.schemaVersion)} is unsupported.`,
      `Use Dependency Graph schema version ${DURABLE_RECORD_SCHEMA_VERSION}.`,
    );
  }
  const metadataFailure = validateGraphMetadata(graph);
  if (metadataFailure !== null) {
    return metadataFailure;
  }
  if (!Array.isArray(graph.nodes)) {
    return invalidGraph(
      "$.graph.nodes",
      "Dependency Graph nodes must be an array.",
      "Provide an array containing at least one Build Task node.",
    );
  }
  if (graph.nodes.length === 0) {
    return invalidGraph(
      "$.graph.nodes",
      "Dependency Graph must contain at least one Build Task node.",
      "Add the Initiative's independently verifiable Build nodes.",
    );
  }
  if (!Array.isArray(graph.edges)) {
    return invalidGraph(
      "$.graph.edges",
      "Dependency Graph edges must be an array.",
      "Provide an array of typed dependency edges.",
    );
  }

  const initiativeTaskId = graph.initiativeTaskId as string;
  const nodeIds = new Set<string>();
  const nodeOrder: string[] = [];
  for (let index = 0; index < graph.nodes.length; index += 1) {
    const sourceNode = graph.nodes[index];
    const nodeFailure = validateNode(sourceNode, index);
    if (nodeFailure !== null) {
      return nodeFailure;
    }
    const node = sourceNode as DependencyGraphNode;
    if (node.taskId === initiativeTaskId) {
      return invalidGraph(
        `$.graph.nodes[${index}].taskId`,
        "Dependency Graph nodes must identify Build Tasks, not the Initiative parent.",
        "Use a distinct Build Task id for the node.",
      );
    }
    if (nodeIds.has(node.taskId)) {
      return failure(
        "dependency_graph.node.duplicate",
        `$.graph.nodes[${index}].taskId`,
        `Dependency Graph node taskId ${node.taskId} is duplicated.`,
        "Assign every Dependency Graph node a unique Build Task id.",
      );
    }
    nodeIds.add(node.taskId);
    nodeOrder.push(node.taskId);
  }

  const edges: DependencyGraphEdge[] = [];
  for (let index = 0; index < graph.edges.length; index += 1) {
    const sourceEdge = graph.edges[index];
    const edgeFailure = validateEdge(sourceEdge, index);
    if (edgeFailure !== null) {
      return edgeFailure;
    }
    const edge = sourceEdge as DependencyGraphEdge;
    if (!nodeIds.has(edge.from)) {
      return failure(
        "dependency_graph.edge.reference_missing",
        `$.graph.edges[${index}].from`,
        `Dependency Graph edge source ${edge.from} is not a declared node.`,
        "Reference a declared node taskId or add the missing Build node.",
      );
    }
    if (!nodeIds.has(edge.to)) {
      return failure(
        "dependency_graph.edge.reference_missing",
        `$.graph.edges[${index}].to`,
        `Dependency Graph edge target ${edge.to} is not a declared node.`,
        "Reference a declared node taskId or add the missing Build node.",
      );
    }
    edges.push(edge);
  }
  for (let index = 0; index < graph.nodes.length; index += 1) {
    const node = graph.nodes[index] as DependencyGraphNode;
    if (
      node.repair !== undefined &&
      !edges.some((edge) => edge.type === "blocks" && edge.to === node.taskId)
    ) {
      return invalidGraph(
        `$.graph.nodes[${index}].repair`,
        "Dependency Graph Repair nodes must have an explicit blocking predecessor.",
        "Add blocks edges from the completed Build nodes that constrain the Repair.",
      );
    }
  }


  const cycleTaskId = findCycleTaskId(nodeOrder, edges);
  if (cycleTaskId !== null) {
    return failure(
      "dependency_graph.cycle.detected",
      "$.graph.edges",
      `Dependency Graph contains a directed cycle through ${cycleTaskId}.`,
      "Remove or redirect an edge so dependency ordering is acyclic.",
    );
  }

  return Object.freeze({
    ok: true,
    contractVersion: DEPENDENCY_GRAPH_CONTRACT_VERSION,
    graph: copyDependencyGraph(graph as unknown as DependencyGraph),
  });
}

function validateGraphMetadata(
  graph: Record<string, unknown>,
): DependencyGraphValidationFailure | null {
  const identifiers = [
    ["id", graph.id, "stable graph id"],
    ["initiativeTaskId", graph.initiativeTaskId, "Initiative Task id"],
    ["updatedByEvent", graph.updatedByEvent, "accepted Workflow Event id"],
  ] as const;
  for (const [field, value, description] of identifiers) {
    if (!isIdentifier(value)) {
      return invalidGraph(
        `$.graph.${field}`,
        `Dependency Graph ${field} must be a non-empty identifier.`,
        `Provide the ${description}.`,
      );
    }
  }
  if (
    !Number.isSafeInteger(graph.version) ||
    (graph.version as number) < 1 ||
    Object.is(graph.version, -0)
  ) {
    return invalidGraph(
      "$.graph.version",
      "Dependency Graph version must be a positive safe integer.",
      "Provide the durable graph revision beginning at version 1.",
    );
  }
  return null;
}

function validateNode(
  value: unknown,
  index: number,
): DependencyGraphValidationFailure | null {
  const path = `$.graph.nodes[${index}]`;
  if (!isUnknownRecord(value)) {
    return invalidGraph(
      path,
      "Dependency Graph node must be a readable object.",
      "Provide taskId, priority, and Resource Claims for the Build Task node.",
    );
  }
  if (!isIdentifier(value.taskId)) {
    return invalidGraph(
      `${path}.taskId`,
      "Dependency Graph node taskId must be a non-empty identifier.",
      "Provide the stable Build Task id.",
    );
  }
  if (!Number.isSafeInteger(value.priority)) {
    return invalidGraph(
      `${path}.priority`,
      "Dependency Graph node priority must be a safe integer.",
      "Provide an integer priority for deterministic scheduling order.",
    );
  }
  if (!isUnknownRecord(value.resources)) {
    return invalidGraph(
      `${path}.resources`,
      "Dependency Graph node must declare Resource Claims.",
      "Provide files, apis, schemas, and locks arrays.",
    );
  }

  const resources = value.resources;
  const resourceKinds = ["files", "apis", "schemas", "locks"] as const;
  for (const kind of resourceKinds) {
    const resourceFailure = validateResourceList(
      resources[kind],
      `${path}.resources.${kind}`,
      kind === "files" || kind === "locks",
    );
    if (resourceFailure !== null) {
      return resourceFailure;
    }
  }
  const repairFailure = validateRepairContext(value.repair, `${path}.repair`);
  if (repairFailure !== null) {
    return repairFailure;
  }

  return null;
}

function validateRepairContext(
  value: unknown,
  path: string,
): DependencyGraphValidationFailure | null {
  if (value === undefined) {
    return null;
  }
  if (!isUnknownRecord(value)) {
    return invalidGraph(
      path,
      "Dependency Graph Repair context must be a readable object.",
      "Provide failureKind, summary, and evidence for the Repair node.",
    );
  }
  if (value.failureKind !== "conflict" && value.failureKind !== "acceptance-failed") {
    return invalidGraph(
      `${path}.failureKind`,
      "Dependency Graph Repair context must identify a conflict or failed acceptance.",
      "Use conflict or acceptance-failed for the Repair failure kind.",
    );
  }
  if (typeof value.summary !== "string" || value.summary.trim().length === 0) {
    return invalidGraph(
      `${path}.summary`,
      "Dependency Graph Repair context summary must be non-empty.",
      "Record the integration failure that the Repair node addresses.",
    );
  }
  if (!Array.isArray(value.evidence) || value.evidence.length === 0) {
    return invalidGraph(
      `${path}.evidence`,
      "Dependency Graph Repair context must retain at least one evidence reference.",
      "Reference the conflict or failed acceptance evidence for the Repair node.",
    );
  }
  for (let index = 0; index < value.evidence.length; index += 1) {
    const evidence = value.evidence[index];
    if (
      !isUnknownRecord(evidence) ||
      (evidence.kind !== "human-approval" &&
        evidence.kind !== "validation" &&
        evidence.kind !== "review" &&
        evidence.kind !== "workflow") ||
      typeof evidence.reference !== "string" ||
      evidence.reference.trim().length === 0
    ) {
      return invalidGraph(
        `${path}.evidence[${index}]`,
        "Dependency Graph Repair evidence must be a typed non-empty reference.",
        "Provide Gate Evidence that identifies the failed Integration result.",
      );
    }
  }
  return null;
}

function validateResourceList(
  value: unknown,
  path: string,
  requiresRepositoryPath: boolean,
): DependencyGraphValidationFailure | null {
  if (!Array.isArray(value)) {
    return invalidGraph(
      path,
      "Resource Claim collection must be an array.",
      "Provide a list of claimed resources, or an empty array when none apply.",
    );
  }
  for (let index = 0; index < value.length; index += 1) {
    const claim = value[index];
    if (
      typeof claim !== "string" ||
      (requiresRepositoryPath && !isRepositoryRelativePath(claim))
    ) {
      return invalidGraph(
        `${path}[${index}]`,
        requiresRepositoryPath
          ? "File Resource Claim must be a repository-relative path without traversal."
          : "Resource Claim must be a string.",
        "Provide a valid resource identifier in the declared claim collection.",
      );
    }
  }
  return null;
}

function validateEdge(
  value: unknown,
  index: number,
): DependencyGraphValidationFailure | null {
  const path = `$.graph.edges[${index}]`;
  if (!isUnknownRecord(value)) {
    return failure(
      "dependency_graph.edge.invalid",
      path,
      "Dependency Graph edge must be a readable object.",
      "Provide from, to, type, and reason for the dependency edge.",
    );
  }
  if (!isIdentifier(value.from)) {
    return invalidEdge(
      `${path}.from`,
      "Dependency Graph edge source must be a non-empty node taskId.",
    );
  }
  if (!isIdentifier(value.to)) {
    return invalidEdge(
      `${path}.to`,
      "Dependency Graph edge target must be a non-empty node taskId.",
    );
  }
  if (value.from === value.to) {
    return invalidEdge(path, "Dependency Graph edge cannot reference the same node twice.");
  }
  if (!isDependencyGraphEdgeType(value.type)) {
    return invalidEdge(
      `${path}.type`,
      "Dependency Graph edge type is unsupported.",
    );
  }
  if (typeof value.reason !== "string" || value.reason.trim().length === 0) {
    return invalidEdge(
      `${path}.reason`,
      "Dependency Graph edge reason must be a non-empty string.",
    );
  }
  return null;
}

function isDependencyGraphEdgeType(
  value: unknown,
): value is DependencyGraphEdgeType {
  return (
    value === "blocks" ||
    value === "informs" ||
    value === "validates" ||
    value === "supersedes"
  );
}

function invalidGraph(
  path: string,
  message: string,
  remediation: string,
): DependencyGraphValidationFailure {
  return failure("dependency_graph.graph.invalid", path, message, remediation);
}

function invalidEdge(
  path: string,
  message: string,
): DependencyGraphValidationFailure {
  return failure(
    "dependency_graph.edge.invalid",
    path,
    message,
    "Provide a typed edge between two distinct declared nodes with a reason.",
  );
}

interface DirectedEdge {
  readonly from: string;
  readonly to: string;
}

function findCycleTaskId(
  nodeOrder: readonly string[],
  edges: readonly DirectedEdge[],
): string | null {
  const outgoing = new Map<string, string[]>();
  const state = new Map<string, 0 | 1 | 2>();
  for (const taskId of nodeOrder) {
    outgoing.set(taskId, []);
    state.set(taskId, 0);
  }
  for (const edge of edges) {
    outgoing.get(edge.from)!.push(edge.to);
  }

  for (const start of nodeOrder) {
    if (state.get(start) !== 0) {
      continue;
    }
    state.set(start, 1);
    const stack: Array<{ taskId: string; nextIndex: number }> = [
      { taskId: start, nextIndex: 0 },
    ];
    while (stack.length > 0) {
      const frame = stack[stack.length - 1]!;
      const dependents = outgoing.get(frame.taskId)!;
      const dependent = dependents[frame.nextIndex];
      if (dependent === undefined) {
        state.set(frame.taskId, 2);
        stack.pop();
        continue;
      }
      frame.nextIndex += 1;
      const dependentState = state.get(dependent)!;
      if (dependentState === 1) {
        return dependent;
      }
      if (dependentState === 0) {
        state.set(dependent, 1);
        stack.push({ taskId: dependent, nextIndex: 0 });
      }
    }
  }
  return null;
}

function isUnknownRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function copyDependencyGraph(graph: DependencyGraph): DependencyGraph {
  return Object.freeze({
    schemaVersion: graph.schemaVersion,
    id: graph.id,
    initiativeTaskId: graph.initiativeTaskId,
    version: graph.version,
    nodes: Object.freeze(
      graph.nodes.map((node) =>
        Object.freeze({
          taskId: node.taskId,
          priority: node.priority,
          resources: Object.freeze({
            files: copyStrings(node.resources.files),
            apis: copyStrings(node.resources.apis),
            schemas: copyStrings(node.resources.schemas),
            locks: copyStrings(node.resources.locks),
          }),
          ...(node.repair === undefined
            ? {}
            : { repair: copyRepairContext(node.repair) }),

        }),
      ),
    ),
    edges: Object.freeze(
      graph.edges.map((edge) =>
        Object.freeze({
          from: edge.from,
          to: edge.to,
          type: edge.type,
          reason: edge.reason,
        }),
      ),
    ),
    updatedByEvent: graph.updatedByEvent,
  });
}

function copyRepairContext(context: InitiativeRepairContext): InitiativeRepairContext {
  return Object.freeze({
    failureKind: context.failureKind,
    summary: context.summary,
    evidence: Object.freeze(
      context.evidence.map((evidence) =>
        Object.freeze({ kind: evidence.kind, reference: evidence.reference }),
      ),
    ),
  });
}

function copyStrings(values: readonly string[]): readonly string[] {
  return Object.freeze([...values]);
}

function failure(
  code: DependencyGraphDiagnosticCode,
  path: string,
  message: string,
  remediation: string,
): DependencyGraphValidationFailure {
  return Object.freeze({
    ok: false,
    contractVersion: DEPENDENCY_GRAPH_CONTRACT_VERSION,
    diagnostics: Object.freeze([
      Object.freeze({ code, path, message, remediation }),
    ]),
  });
}
