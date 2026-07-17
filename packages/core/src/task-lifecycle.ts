import {
  hashCanonicalJson,
  isContractIdentity,
  stableJson,
} from "./identity.js";
import {
  buildPlanFileName,
  createDurableBuildPlan,
  parseDurableBuildPlan,
  serializeDurableBuildPlan,
  type DurableBuildPlan,
} from "./build-plan.js";
import {
  validateDependencyGraph,
  type DependencyGraphDiagnostic,
} from "./dependency-graph.js";
import {
  RECORD_CONTRACT_VERSION,
  validateContractRecord,
  type AgentResultRecord,
  type BaselineRecord,
} from "./record-contracts.js";
import type {
  ManagedProjectFileSystem,
  ManagedProjectPathKind,
} from "./managed-project.js";
import {
  contentMatchesIdentity,
  hashTextContent,
  parseContextManifest,
  serializeContextManifest,
  type ContextManifestDiagnostic,
  type ContextManifestEntry,
  type ContextTrustTier,
} from "./context-manifest.js";
import {
  authorizePhaseExecution,
  bindPhaseExecution,
  parsePhaseExecutionBinding,
  parsePhaseExecutionResult,
  phaseExecutionResultMatchesBinding,
  type BindPhaseExecutionRequest,
  type PhaseExecutionBinding,
  type PhaseExecutionDiagnosticCode,
  type PhaseExecutionMaterials,
} from "./execution.js";
import {
  approveSpec,
  isApprovedSpec,
  readApprovedSpecs,
} from "./spec-approval.js";
import {
  adoptWorkflowBaseline,
  currentImplementContextChange,
  isRepositoryRelativePath,
  replayWorkflowEvents,
  startWorkflowTask,
  recordContextManifestChange,
  recordBuildPlanChange,
  transitionWorkflow,
  escalateQuickToBuild,
  recordPhaseExecutionDispatch,
  recordPhaseExecutionResult,
  type BaselineAdoptedEvent,
  type StartWorkflowTaskRequest,
  type ContextManifestChangedEvent,
  type BuildPlanChangedEvent,
  type EscalateQuickToBuildRequest,
  type PhaseExecutionDispatchedEvent,
  type PhaseExecutionResultAcceptedEvent,
  type TaskCreatedEvent,
  type DependencyGraph,
  type DependencyGraphEdge,
  type TaskProjection,
  type TaskScope,
  type TransitionWorkflowRequest,
  type WorkflowDiagnostic,
  type WorkflowDiagnosticCode,
  type WorkflowEvent,
  type WorkflowEventMetadata,
  type WorkflowState,
  type WorkflowTransitionedEvent,
  type RouteEscalatedEvent,
  type WorkflowPhase,
} from "./workflow.js";

export const TASK_LIFECYCLE_CONTRACT_VERSION = 1 as const;

const TASKS_DIRECTORY = ".sayhi/tasks";
const TASK_ARCHIVE_DIRECTORY = `${TASKS_DIRECTORY}/archive`;
const QUICK_RESULT_FILE_NAME = "quick.json";

export interface TaskLifecycleDirectoryEntry {
  readonly name: string;
  readonly kind: ManagedProjectPathKind;
}

export interface TaskLifecycleFileSystem extends ManagedProjectFileSystem {
  appendFile(path: string, content: string): Promise<void>;
  listDirectory(path: string): Promise<readonly TaskLifecycleDirectoryEntry[]>;
  withTaskMutationLock<Result>(
    path: string,
    operation: () => Promise<Result>,
  ): Promise<Result>;
}

export interface TaskArchiveFileSystem extends TaskLifecycleFileSystem {
  moveDirectory(source: string, target: string): Promise<void>;
}
export interface ContextManifestFileSystem extends TaskLifecycleFileSystem {
  readRepositoryFile(path: string): Promise<string>;
}


export interface TaskBaselineCaptureRequest {
  readonly taskId: string;
  readonly declaredScope: TaskScope;
  readonly adoptedPaths: readonly string[];
}

export interface TaskWriter {
  writeFile(path: string, content: string): Promise<void>;
}
export interface ScopedTaskWriter extends TaskWriter {
  assertWritablePath(path: string): void;
}

export interface TaskBaselineFileSystem extends TaskLifecycleFileSystem {
  captureBaseline(request: TaskBaselineCaptureRequest): Promise<BaselineRecord>;
  withWriterMutationLock<Result>(
    operation: (writer: TaskWriter) => Promise<Result>,
  ): Promise<Result>;
}



export type TaskLifecycleDiagnosticCode =
  | WorkflowDiagnosticCode
  | PhaseExecutionDiagnosticCode
  | "task_lifecycle.task_id.invalid"
  | "task_lifecycle.store.invalid"
  | "task_lifecycle.task.exists"
  | "task_lifecycle.history.missing"
  | "task_lifecycle.history.invalid"
  | "task_lifecycle.io_failed"
  | "task_lifecycle.baseline.missing"
  | "task_lifecycle.baseline.invalid"
  | "task_lifecycle.baseline.adoption_required"
  | "task_lifecycle.baseline.drift"
  | "task_lifecycle.writer.scope"
  | "task_lifecycle.writer.unavailable"
  | "context_manifest.missing"
  | "context_manifest.invalid"
  | "context_manifest.source.unreadable"
  | "context_manifest.source.duplicate"
  | "context_manifest.approval_required"
  | "context_manifest.entry.missing"
  | "context_manifest.stale"
  | "task_lifecycle.handoff.invalid"
  | "task_lifecycle.quick_result.invalid"
  | "task_lifecycle.quick_result.missing"
  | "initiative_graph.record.missing"
  | "initiative_graph.record.invalid"
  | "initiative_graph.record.conflict"
  | "initiative_graph.task.mismatch"
  | "initiative_graph.identity.mismatch"
  | "initiative_graph.event.mismatch"
  | "build_plan.missing"
  | "build_plan.invalid"
  | "build_plan.phase.invalid"
  | "build_plan.approval_required"
  | "build_plan.context_stale"
  | "build_plan.rejected"
  | "phase_execution.binding.invalid"
  | "phase_execution.phase.invalid"
  | "phase_execution.missing"
  | "phase_execution.result.invalid";

export interface TaskLifecycleDiagnostic {
  readonly code: TaskLifecycleDiagnosticCode;
  readonly path: string;
  readonly message: string;
  readonly remediation: string;
}

export interface CreateDurableTaskRequest {
  readonly fileSystem: TaskLifecycleFileSystem;
  readonly start: StartWorkflowTaskRequest;
}

export interface AdvanceDurableTaskRequest {
  readonly fileSystem: TaskLifecycleFileSystem;
  readonly transition: TransitionWorkflowRequest;
}

export interface EscalateDurableQuickToBuildRequest {
  readonly fileSystem: TaskLifecycleFileSystem;
  readonly escalation: EscalateQuickToBuildRequest;
}

export interface ArchiveDurableTaskRequest {
  readonly fileSystem: TaskArchiveFileSystem;
  readonly transition: TransitionWorkflowRequest;
}

export interface RecoverDurableTaskRequest {
  readonly fileSystem: TaskLifecycleFileSystem;
  readonly taskId: string;
}

export interface CreateDurableTaskHandoffRequest {
  readonly fileSystem: TaskLifecycleFileSystem;
  readonly taskId: string;
  readonly expectedVersion: number;
  readonly repositoryFingerprint: string;
  readonly artifactReferences: readonly string[];
  readonly createdAt: string;
}

export interface DurableTaskHandoff {
  readonly schemaVersion: 1;
  readonly taskId: string;
  readonly phase: WorkflowPhase;
  readonly step: string;
  readonly projectionVersion: number;
  readonly blockers: readonly string[];
  readonly repositoryFingerprint: string;
  readonly artifactReferences: readonly string[];
  readonly createdAt: string;
}
export type DurableQuickRecordLocation = "active" | "archive";
export interface DurableQuickResult {
  readonly schemaVersion: 1;
  readonly taskId: string;
  readonly projectionVersion: number;
  readonly baselineBefore: BaselineRecord;
  readonly baselineAfter: BaselineRecord;
  readonly changedPaths: readonly string[];
  readonly commit: null;
  readonly workflow: WorkflowState;
}
export interface RecordDurableQuickResultRequest {
  readonly fileSystem: TaskBaselineFileSystem;
  readonly taskId: string;
  readonly expectedVersion: number;
  readonly baselineAfter: BaselineRecord;
  readonly changedPaths: readonly string[];
}
export interface CompleteDurableQuickResultRequest
  extends RecordDurableQuickResultRequest {
  readonly transition: TransitionWorkflowRequest;
}
export interface ReadDurableQuickResultRequest {
  readonly fileSystem: TaskLifecycleFileSystem;
  readonly taskId: string;
  readonly location: DurableQuickRecordLocation;
}
export interface ReadDurableTaskRequest {
  readonly fileSystem: TaskLifecycleFileSystem;
  readonly taskId: string;
}
export interface InspectDurableInitiativeGraphRequest {
  readonly fileSystem: TaskLifecycleFileSystem;
  readonly initiativeTaskId: string;
}
export type InitiativeGraphNodeStatus =
  | Readonly<{ state: "missing" }>
  | Readonly<{
      state: "recorded";
      lifecycle: TaskProjection["lifecycle"];
      phase: TaskProjection["phase"];
      step: string;
      version: number;
    }>;
export interface InitiativeGraphNodeInspection {
  readonly taskId: string;
  readonly dependencies: readonly Readonly<{
    taskId: string;
    type: DependencyGraphEdge["type"];
    reason: string;
  }>[];
  readonly status: InitiativeGraphNodeStatus;
}
export type InspectDurableInitiativeGraphResult =
  | Readonly<{
      ok: true;
      contractVersion: typeof TASK_LIFECYCLE_CONTRACT_VERSION;
      graph: DependencyGraph;
      nodes: readonly InitiativeGraphNodeInspection[];
    }>
  | TaskLifecycleFailure;


export interface DiagnoseDurableTasksRequest {
  readonly fileSystem: TaskLifecycleFileSystem;
}
export interface ListDurableTasksRequest {
  readonly fileSystem: TaskLifecycleFileSystem;
}


export interface AdoptDurableTaskBaselineRequest {
  readonly fileSystem: TaskBaselineFileSystem;
  readonly taskId: string;
  readonly expectedVersion: number;
  readonly baseline: BaselineRecord;
  readonly event: WorkflowEventMetadata;
}

export interface WithDurableTaskWriterRequest<Value> {
  readonly fileSystem: TaskBaselineFileSystem;
  readonly taskId: string;
  readonly expectedVersion: number;
  readonly operation: (writer: ScopedTaskWriter) => Promise<Value>;
}
export interface AddDurableContextManifestEntryRequest {
  readonly fileSystem: ContextManifestFileSystem;
  readonly taskId: string;
  readonly expectedVersion: number;
  readonly phase: WorkflowPhase;
  readonly source: string;
  readonly event: WorkflowEventMetadata;
  readonly persist?: boolean;
}

export interface InspectDurableContextManifestRequest {
  readonly fileSystem: ContextManifestFileSystem;
  readonly taskId: string;
  readonly phase: WorkflowPhase;
}
export interface RefreshDurableContextManifestRequest {
  readonly fileSystem: ContextManifestFileSystem;
  readonly taskId: string;
  readonly expectedVersion: number;
  readonly phase: WorkflowPhase;
  readonly acceptRequiredApprovedSpecChanges: boolean;
  readonly event: WorkflowEventMetadata;
  readonly persist?: boolean;
}
export interface FreezeDurableContextManifestRequest {
  readonly fileSystem: ContextManifestFileSystem;
  readonly taskId: string;
  readonly expectedVersion: number;
  readonly phase: WorkflowPhase;
  readonly event: WorkflowEventMetadata;
  readonly persist?: boolean;
}

export interface RemoveDurableContextManifestEntryRequest {
  readonly fileSystem: ContextManifestFileSystem;
  readonly taskId: string;
  readonly expectedVersion: number;
  readonly phase: WorkflowPhase;
  readonly entryId: string;
  readonly event: WorkflowEventMetadata;
  readonly persist?: boolean;
}

export interface RecordDurableBuildPlanRequest {
  readonly fileSystem: ContextManifestFileSystem;
  readonly taskId: string;
  readonly expectedVersion: number;
  readonly content: string;
  readonly event: WorkflowEventMetadata;
}
export interface DecideDurableBuildPlanRequest {
  readonly fileSystem: ContextManifestFileSystem;
  readonly taskId: string;
  readonly expectedVersion: number;
  readonly decision: "approved" | "rejected";
  readonly planIdentity: string;
  readonly contextManifestIdentity: string;
  readonly event: WorkflowEventMetadata;
}

export interface DispatchDurablePhaseExecutionRequest {
  readonly fileSystem: ContextManifestFileSystem;
  readonly planIdentity: string;
  readonly execution: BindPhaseExecutionRequest;
  readonly event: WorkflowEventMetadata;
}

export interface ResumeDurablePhaseExecutionRequest {
  readonly fileSystem: ContextManifestFileSystem;
  readonly taskId: string;
  readonly materials: PhaseExecutionMaterials;
}

export interface RecordDurablePhaseExecutionResultRequest {
  readonly fileSystem: TaskLifecycleFileSystem;
  readonly taskId: string;
  readonly result: AgentResultRecord;
  readonly event: WorkflowEventMetadata;
}





interface TaskLifecycleFailure {
  readonly ok: false;
  readonly contractVersion: typeof TASK_LIFECYCLE_CONTRACT_VERSION;
  readonly diagnostics: readonly TaskLifecycleDiagnostic[];
}

export type CreateDurableTaskResult =
  | Readonly<{
      ok: true;
      contractVersion: typeof TASK_LIFECYCLE_CONTRACT_VERSION;
      state: WorkflowState;
      event: TaskCreatedEvent;
    }>
  | TaskLifecycleFailure;

export type AdvanceDurableTaskResult =
  | Readonly<{
      ok: true;
      contractVersion: typeof TASK_LIFECYCLE_CONTRACT_VERSION;
      state: WorkflowState;
      event: WorkflowTransitionedEvent;
      appended: boolean;
    }>
  | TaskLifecycleFailure;

export type EscalateDurableQuickToBuildResult =
  | Readonly<{
      ok: true;
      contractVersion: typeof TASK_LIFECYCLE_CONTRACT_VERSION;
      state: WorkflowState;
      event: RouteEscalatedEvent;
      appended: boolean;
    }>
  | TaskLifecycleFailure;

export type AdoptDurableTaskBaselineResult =
  | Readonly<{
      ok: true;
      contractVersion: typeof TASK_LIFECYCLE_CONTRACT_VERSION;
      state: WorkflowState;
      event: BaselineAdoptedEvent;
      appended: boolean;
    }>
  | TaskLifecycleFailure;

export type WithDurableTaskWriterResult<Value> =
  | Readonly<{
      ok: true;
      contractVersion: typeof TASK_LIFECYCLE_CONTRACT_VERSION;
      value: Value;
      finalBaseline: BaselineRecord;
      changedPaths: readonly string[];
    }>
  | TaskLifecycleFailure;
export type AddDurableContextManifestEntryResult =
  | Readonly<{
      ok: true;
      contractVersion: typeof TASK_LIFECYCLE_CONTRACT_VERSION;
      state: WorkflowState;
      event: ContextManifestChangedEvent;
      entry: ContextManifestEntry;
      planned: boolean;
    }>
  | TaskLifecycleFailure;
export type RefreshDurableContextManifestResult =
  | Readonly<{
      ok: true;
      contractVersion: typeof TASK_LIFECYCLE_CONTRACT_VERSION;
      state: WorkflowState;
      event: ContextManifestChangedEvent;
      entries: readonly ContextManifestEntry[];
      planned: boolean;
    }>
  | TaskLifecycleFailure;
export type FreezeDurableContextManifestResult =
  | Readonly<{
      ok: true;
      contractVersion: typeof TASK_LIFECYCLE_CONTRACT_VERSION;
      state: WorkflowState;
      event: ContextManifestChangedEvent;
      entries: readonly ContextManifestEntry[];
      planned: boolean;
    }>
  | TaskLifecycleFailure;

export type RemoveDurableContextManifestEntryResult =
  | Readonly<{
      ok: true;
      contractVersion: typeof TASK_LIFECYCLE_CONTRACT_VERSION;
      state: WorkflowState;
      event: ContextManifestChangedEvent;
      entries: readonly ContextManifestEntry[];
      planned: boolean;
    }>
  | TaskLifecycleFailure;
export type RecordDurableBuildPlanResult =
  | Readonly<{
      ok: true;
      contractVersion: typeof TASK_LIFECYCLE_CONTRACT_VERSION;
      state: WorkflowState;
      plan: DurableBuildPlan;
      event: BuildPlanChangedEvent;
      created: boolean;
      appended: boolean;
    }>
  | TaskLifecycleFailure;
export type DecideDurableBuildPlanResult =
  | Readonly<{
      ok: true;
      contractVersion: typeof TASK_LIFECYCLE_CONTRACT_VERSION;
      decision: "approved";
      state: WorkflowState;
      plan: DurableBuildPlan;
      event: WorkflowTransitionedEvent;
      appended: boolean;
    }>
  | Readonly<{
      ok: true;
      contractVersion: typeof TASK_LIFECYCLE_CONTRACT_VERSION;
      decision: "rejected";
      state: WorkflowState;
      plan: DurableBuildPlan;
      event: BuildPlanChangedEvent;
      appended: boolean;
    }>
  | TaskLifecycleFailure;

export type DispatchDurablePhaseExecutionResult =
  | Readonly<{
      ok: true;
      contractVersion: typeof TASK_LIFECYCLE_CONTRACT_VERSION;
      state: WorkflowState;
      plan: DurableBuildPlan;
      binding: PhaseExecutionBinding;
      event: PhaseExecutionDispatchedEvent;
      appended: boolean;
    }>
  | TaskLifecycleFailure;

export type ResumeDurablePhaseExecutionResult =
  | Readonly<{
      ok: true;
      contractVersion: typeof TASK_LIFECYCLE_CONTRACT_VERSION;
      status: "ready";
      state: WorkflowState;
      plan: DurableBuildPlan;
      binding: PhaseExecutionBinding;
    }>
  | Readonly<{
      ok: true;
      contractVersion: typeof TASK_LIFECYCLE_CONTRACT_VERSION;
      status: "completed";
      state: WorkflowState;
      binding: PhaseExecutionBinding;
      result: AgentResultRecord;
    }>
  | TaskLifecycleFailure;

export type RecordDurablePhaseExecutionResultResult =
  | Readonly<{
      ok: true;
      contractVersion: typeof TASK_LIFECYCLE_CONTRACT_VERSION;
      state: WorkflowState;
      event: PhaseExecutionResultAcceptedEvent;
      result: AgentResultRecord;
      appended: boolean;
    }>
  | TaskLifecycleFailure;



export type InspectDurableContextManifestResult =
  | Readonly<{
      ok: true;
      contractVersion: typeof TASK_LIFECYCLE_CONTRACT_VERSION;
      state: "valid" | "stale";
      entries: readonly ContextManifestEntry[];
      diagnostics: readonly ContextManifestDiagnostic[];
    }>
  | Readonly<{
      ok: false;
      contractVersion: typeof TASK_LIFECYCLE_CONTRACT_VERSION;
      state: "missing" | "invalid";
      diagnostics: readonly ContextManifestDiagnostic[];
    }>;
export type ReadDurableTaskResult =
  | Readonly<{
      ok: true;
      contractVersion: typeof TASK_LIFECYCLE_CONTRACT_VERSION;
      state: WorkflowState;
    }>
  | TaskLifecycleFailure;
export type ListDurableTasksResult =
  | Readonly<{
      ok: true;
      contractVersion: typeof TASK_LIFECYCLE_CONTRACT_VERSION;
      taskIds: readonly string[];
    }>
  | TaskLifecycleFailure;




export type RecoverDurableTaskResult =
  | Readonly<{
      ok: true;
      contractVersion: typeof TASK_LIFECYCLE_CONTRACT_VERSION;
      state: WorkflowState;
      recovered: boolean;
      handoff: DurableTaskHandoff | null;
    }>
  | TaskLifecycleFailure;

export type CreateDurableTaskHandoffResult =
  | Readonly<{
      ok: true;
      contractVersion: typeof TASK_LIFECYCLE_CONTRACT_VERSION;
      handoff: DurableTaskHandoff;
    }>
  | TaskLifecycleFailure;

export type ArchiveDurableTaskResult =
  | Readonly<{
      ok: true;
      contractVersion: typeof TASK_LIFECYCLE_CONTRACT_VERSION;
      state: WorkflowState;
      moved: boolean;
    }>
  | TaskLifecycleFailure;
export type RecordDurableQuickResultResult =
  | Readonly<{
      ok: true;
      contractVersion: typeof TASK_LIFECYCLE_CONTRACT_VERSION;
      result: DurableQuickResult;
    }>
  | TaskLifecycleFailure;
export type CompleteDurableQuickResultResult =
  | Readonly<{
      ok: true;
      contractVersion: typeof TASK_LIFECYCLE_CONTRACT_VERSION;
      state: WorkflowState;
      event: WorkflowTransitionedEvent;
      result: DurableQuickResult;
    }>
  | TaskLifecycleFailure;
export type ReadDurableQuickResultResult =
  | Readonly<{
      ok: true;
      contractVersion: typeof TASK_LIFECYCLE_CONTRACT_VERSION;
      state: WorkflowState;
      result: DurableQuickResult;
      location: DurableQuickRecordLocation;
    }>
  | TaskLifecycleFailure;

export type DiagnoseDurableTasksResult =
  | Readonly<{
      ok: true;
      contractVersion: typeof TASK_LIFECYCLE_CONTRACT_VERSION;
      state: "healthy";
      taskCount: number;
      diagnostics: readonly [];
    }>
  | Readonly<{
      ok: false;
      contractVersion: typeof TASK_LIFECYCLE_CONTRACT_VERSION;
      state: "corrupt";
      diagnostics: readonly TaskLifecycleDiagnostic[];
    }>;

interface TaskPaths {
  readonly taskDirectory: string;
  readonly archiveTaskDirectory: string;
  readonly eventsPath: string;
  readonly projectionPath: string;
  readonly graphPath: string;
  readonly handoffPath: string;
  readonly lockPath: string;
  readonly quickResultPath: string;
  readonly plansDirectory: string;
}

type LoadTaskResult =
  | Readonly<{ ok: true; state: WorkflowState; eventsPath: string; projectionPath: string }>
  | TaskLifecycleFailure;

export async function diagnoseDurableTasks(
  request: DiagnoseDurableTasksRequest,
): Promise<DiagnoseDurableTasksResult> {
  let entries: readonly TaskLifecycleDirectoryEntry[];
  try {
    entries = await request.fileSystem.listDirectory(TASKS_DIRECTORY);
  } catch {
    return diagnosisFailure([ioDiagnostic(TASKS_DIRECTORY)]);
  }

  const diagnostics: TaskLifecycleDiagnostic[] = [];
  let taskCount = 0;
  for (const entry of entries) {
    if (entry.name === "archive" && entry.kind === "directory") {
      continue;
    }
    const entryPath = `${TASKS_DIRECTORY}/${entry.name}`;
    if (entry.kind !== "directory") {
      diagnostics.push(
        diagnostic(
          "task_lifecycle.history.missing",
          entryPath,
          "A Task Store entry is not a real directory.",
          "Restore or remove the unsafe Task entry before retrying.",
        ),
      );
      continue;
    }
    const paths = taskPaths(entry.name);
    if (!paths.ok) {
      diagnostics.push(...paths.diagnostics);
      continue;
    }
    taskCount += 1;
    const loaded = await runWithTaskLock(
      request.fileSystem,
      paths.lockPath,
      () => loadTask(request.fileSystem, entry.name),
    );
    if (!loaded.ok) {
      diagnostics.push(...loaded.diagnostics);
    }
  }

  if (diagnostics.length > 0) {
    return diagnosisFailure(diagnostics);
  }
  return Object.freeze({
    ok: true,
    contractVersion: TASK_LIFECYCLE_CONTRACT_VERSION,
    state: "healthy",
    taskCount,
    diagnostics: Object.freeze([] as const),
  });
}

export async function createDurableTask(
  request: CreateDurableTaskRequest,
): Promise<CreateDurableTaskResult> {
  const started = startWorkflowTask(request.start);
  if (!started.ok) {
    return failure(started.diagnostics);
  }
  const paths = taskPaths(started.state.projection.id);
  if (!paths.ok) {
    return paths;
  }
  return runWithTaskLock(request.fileSystem, paths.lockPath, () =>
    createDurableTaskLocked(
      request.fileSystem,
      paths,
      started.state,
      started.event,
    ),
  );
}

export async function advanceDurableTask(
  request: AdvanceDurableTaskRequest,
): Promise<AdvanceDurableTaskResult> {
  const transition = request.transition as TransitionWorkflowRequest | undefined;
  const paths = taskPaths(transition?.taskId);
  if (!paths.ok) {
    return paths;
  }
  if (transition?.to?.lifecycle === "archived") {
    return failure([
      diagnostic(
        "workflow.transition.illegal",
        "$.to.lifecycle",
        "Archive transitions require the durable archive operation.",
        "Use archiveDurableTask to archive a completed Task.",
      ),
    ]);
  }
  return runWithTaskLock(request.fileSystem, paths.lockPath, () =>
    advanceDurableTaskLocked(request, paths),
  );
}

export async function escalateDurableQuickToBuild(
  request: EscalateDurableQuickToBuildRequest,
): Promise<EscalateDurableQuickToBuildResult> {
  const escalation = request.escalation as EscalateQuickToBuildRequest | undefined;
  const paths = taskPaths(escalation?.taskId);
  if (!paths.ok) {
    return paths;
  }
  return runWithTaskLock(request.fileSystem, paths.lockPath, () =>
    escalateDurableQuickToBuildLocked(request, paths),
  );
}
export async function archiveDurableTask(
  request: ArchiveDurableTaskRequest,
): Promise<ArchiveDurableTaskResult> {
  const transition = request.transition as TransitionWorkflowRequest | undefined;
  const paths = taskPaths(transition?.taskId);
  if (!paths.ok) {
    return paths;
  }
  const target = transition?.to as
    | Readonly<{ lifecycle?: unknown; phase?: unknown; step?: unknown }>
    | undefined;
  if (
    target === undefined ||
    typeof target.lifecycle !== "string" ||
    typeof target.phase !== "string" ||
    typeof target.step !== "string"
  ) {
    return failure([
      diagnostic(
        "workflow.request.invalid",
        "$.to",
        "Workflow transition request is malformed.",
        "Provide a complete transition target and retry.",
      ),
    ]);
  }
  return runWithTaskLock(request.fileSystem, paths.lockPath, () =>
    archiveDurableTaskLocked(request, paths),
  );
}

export async function createDurableTaskHandoff(
  request: CreateDurableTaskHandoffRequest,
): Promise<CreateDurableTaskHandoffResult> {
  const paths = taskPaths(request.taskId);
  if (!paths.ok) {
    return paths;
  }
  return runWithTaskLock(request.fileSystem, paths.lockPath, () =>
    createDurableTaskHandoffLocked(request, paths),
  );
}

export async function recoverDurableTask(
  request: RecoverDurableTaskRequest,
): Promise<RecoverDurableTaskResult> {
  const paths = taskPaths(request.taskId);
  if (!paths.ok) {
    return paths;
  }
  return runWithTaskLock(request.fileSystem, paths.lockPath, () =>
    recoverDurableTaskLocked(request, paths),
  );
}

export async function adoptDurableTaskBaseline(
  request: AdoptDurableTaskBaselineRequest,
): Promise<AdoptDurableTaskBaselineResult> {
  const paths = taskPaths(request.taskId);
  if (!paths.ok) {
    return paths;
  }
  return runWithTaskLock(request.fileSystem, paths.lockPath, () =>
    adoptDurableTaskBaselineLocked(request, paths),
  );
}

export async function withDurableTaskWriter<Value>(
  request: WithDurableTaskWriterRequest<Value>,
): Promise<WithDurableTaskWriterResult<Value>> {
  const paths = taskPaths(request.taskId);
  if (!paths.ok) {
    return paths;
  }
  try {
    return await request.fileSystem.withWriterMutationLock((writer) =>
      runWithTaskLock(request.fileSystem, paths.lockPath, () =>
        withDurableTaskWriterLocked(request, paths, writer),
      ),
    );
  } catch {
    return writerUnavailable();
  }
}
export async function recordDurableQuickResult(
  request: RecordDurableQuickResultRequest,
): Promise<RecordDurableQuickResultResult> {
  const paths = taskPaths(request.taskId);
  if (!paths.ok) {
    return paths;
  }
  try {
    return await request.fileSystem.withWriterMutationLock(() =>
      runWithTaskLock(request.fileSystem, paths.lockPath, () =>
        recordDurableQuickResultLocked(request, paths),
      ),
    );
  } catch {
    return writerUnavailable();
  }
}
export async function completeDurableQuickResult(
  request: CompleteDurableQuickResultRequest,
): Promise<CompleteDurableQuickResultResult> {
  const paths = taskPaths(request.taskId);
  if (!paths.ok) {
    return paths;
  }
  try {
    return await request.fileSystem.withWriterMutationLock(() =>
      runWithTaskLock(request.fileSystem, paths.lockPath, () =>
        completeDurableQuickResultLocked(request, paths),
      ),
    );
  } catch {
    return writerUnavailable();
  }
}
export async function readDurableQuickResult(
  request: ReadDurableQuickResultRequest,
): Promise<ReadDurableQuickResultResult> {
  const paths = taskPaths(request.taskId);
  if (!paths.ok) {
    return paths;
  }
  return runWithTaskLock(request.fileSystem, paths.lockPath, async () => {
    const taskDirectory =
      request.location === "active"
        ? paths.taskDirectory
        : paths.archiveTaskDirectory;
    const loaded = await loadTask(request.fileSystem, request.taskId, taskDirectory);
    if (!loaded.ok) {
      return loaded;
    }
    if (loaded.state.projection.route !== "quick") {
      return quickResultInvalid(
        taskDirectory,
        "The durable Task is not a Quick.",
        "Use the Task lifecycle commands for Build and Initiative records.",
      );
    }
    const result = await loadDurableQuickResult(
      request.fileSystem,
      `${taskDirectory}/${QUICK_RESULT_FILE_NAME}`,
      loaded.state,
    );
    return result.ok
      ? Object.freeze({
          ok: true as const,
          contractVersion: TASK_LIFECYCLE_CONTRACT_VERSION,
          state: loaded.state,
          result: result.value,
          location: request.location,
        })
      : result;
  });
}
export async function readDurableTask(
  request: ReadDurableTaskRequest,
): Promise<ReadDurableTaskResult> {
  const loaded = await loadTask(request.fileSystem, request.taskId);
  return loaded.ok
    ? Object.freeze({
        ok: true,
        contractVersion: TASK_LIFECYCLE_CONTRACT_VERSION,
        state: loaded.state,
      })
    : loaded;
}
export async function listDurableTasks(
  request: ListDurableTasksRequest,
): Promise<ListDurableTasksResult> {
  let entries: readonly TaskLifecycleDirectoryEntry[];
  try {
    entries = await request.fileSystem.listDirectory(TASKS_DIRECTORY);
  } catch {
    return failure([ioDiagnostic(TASKS_DIRECTORY)]);
  }
  const taskIds: string[] = [];
  for (const entry of entries) {
    if (entry.name === "archive" && entry.kind === "directory") {
      continue;
    }
    const entryPath = `${TASKS_DIRECTORY}/${entry.name}`;
    if (entry.kind !== "directory") {
      return failure([
        diagnostic(
          "task_lifecycle.history.missing",
          entryPath,
          "A Task Store entry is not a real directory.",
          "Restore or remove the unsafe Task entry before retrying.",
        ),
      ]);
    }
    const task = await readDurableTask({ fileSystem: request.fileSystem, taskId: entry.name });
    if (!task.ok) {
      return task;
    }
    taskIds.push(task.state.projection.id);
  }
  return Object.freeze({
    ok: true,
    contractVersion: TASK_LIFECYCLE_CONTRACT_VERSION,
    taskIds: Object.freeze(taskIds),
  });
}

export async function inspectDurableInitiativeGraph(
  request: InspectDurableInitiativeGraphRequest,
): Promise<InspectDurableInitiativeGraphResult> {
  const paths = taskPaths(request.initiativeTaskId);
  if (!paths.ok) {
    return paths;
  }
  const loaded = await loadTask(request.fileSystem, request.initiativeTaskId);
  if (!loaded.ok) {
    return loaded;
  }
  const graphRecord = await loadInitiativeGraphRecord(
    request.fileSystem,
    paths.graphPath,
    loaded.state,
  );
  if (!graphRecord.ok) {
    return graphRecord;
  }
  const inspectedNodes = await Promise.all(
    graphRecord.graph.nodes.map((node) =>
      inspectInitiativeGraphNode(request.fileSystem, graphRecord.graph, node),
    ),
  );
  const nodes: InitiativeGraphNodeInspection[] = [];
  for (const inspectedNode of inspectedNodes) {
    if (!inspectedNode.ok) {
      return inspectedNode;
    }
    nodes.push(inspectedNode.value);
  }
  return Object.freeze({
    ok: true,
    contractVersion: TASK_LIFECYCLE_CONTRACT_VERSION,
    graph: graphRecord.graph,
    nodes: Object.freeze(nodes),
  });
}


export async function addDurableContextManifestEntry(
  request: AddDurableContextManifestEntryRequest,
): Promise<AddDurableContextManifestEntryResult> {
  const paths = taskPaths(request.taskId);
  if (!paths.ok) {
    return paths;
  }
  try {
    return await runWithTaskLock(request.fileSystem, paths.lockPath, () =>
      addDurableContextManifestEntryLocked(request, paths),
    );
  } catch {
    return ioFailure(paths.taskDirectory);
  }
}
export async function refreshDurableContextManifest(
  request: RefreshDurableContextManifestRequest,
): Promise<RefreshDurableContextManifestResult> {
  const paths = taskPaths(request.taskId);
  if (!paths.ok) {
    return paths;
  }
  try {
    return await runWithTaskLock(request.fileSystem, paths.lockPath, () =>
      refreshDurableContextManifestLocked(request, paths),
    );
  } catch {
    return ioFailure(paths.taskDirectory);
  }
}
export async function freezeDurableContextManifest(
  request: FreezeDurableContextManifestRequest,
): Promise<FreezeDurableContextManifestResult> {
  const paths = taskPaths(request.taskId);
  if (!paths.ok) {
    return paths;
  }
  try {
    return await runWithTaskLock(request.fileSystem, paths.lockPath, () =>
      freezeDurableContextManifestLocked(request, paths),
    );
  } catch {
    return ioFailure(paths.taskDirectory);
  }
}
export async function recordDurableBuildPlan(
  request: RecordDurableBuildPlanRequest,
): Promise<RecordDurableBuildPlanResult> {
  const paths = taskPaths(request.taskId);
  if (!paths.ok) {
    return paths;
  }
  try {
    return await runWithTaskLock(request.fileSystem, paths.lockPath, () =>
      recordDurableBuildPlanLocked(request, paths),
    );
  } catch {
    return ioFailure(paths.taskDirectory);
  }
}
export async function decideDurableBuildPlan(
  request: DecideDurableBuildPlanRequest,
): Promise<DecideDurableBuildPlanResult> {
  const paths = taskPaths(request.taskId);
  if (!paths.ok) {
    return paths;
  }
  try {
    return await runWithTaskLock(request.fileSystem, paths.lockPath, () =>
      decideDurableBuildPlanLocked(request, paths),
    );
  } catch {
    return ioFailure(paths.taskDirectory);
  }
}

export async function dispatchDurablePhaseExecution(
  request: DispatchDurablePhaseExecutionRequest,
): Promise<DispatchDurablePhaseExecutionResult> {
  const paths = taskPaths(request.execution?.dispatch?.taskId);
  if (!paths.ok) {
    return paths;
  }
  try {
    return await runWithTaskLock(request.fileSystem, paths.lockPath, () =>
      dispatchDurablePhaseExecutionLocked(request, paths),
    );
  } catch {
    return ioFailure(paths.taskDirectory);
  }
}

export async function resumeDurablePhaseExecution(
  request: ResumeDurablePhaseExecutionRequest,
): Promise<ResumeDurablePhaseExecutionResult> {
  const paths = taskPaths(request.taskId);
  if (!paths.ok) {
    return paths;
  }
  try {
    return await runWithTaskLock(request.fileSystem, paths.lockPath, () =>
      resumeDurablePhaseExecutionLocked(request, paths),
    );
  } catch {
    return ioFailure(paths.taskDirectory);
  }
}

export async function recordDurablePhaseExecutionResult(
  request: RecordDurablePhaseExecutionResultRequest,
): Promise<RecordDurablePhaseExecutionResultResult> {
  const paths = taskPaths(request.taskId);
  if (!paths.ok) {
    return paths;
  }
  try {
    return await runWithTaskLock(request.fileSystem, paths.lockPath, () =>
      recordDurablePhaseExecutionResultLocked(request, paths),
    );
  } catch {
    return ioFailure(paths.taskDirectory);
  }
}

export async function removeDurableContextManifestEntry(
  request: RemoveDurableContextManifestEntryRequest,
): Promise<RemoveDurableContextManifestEntryResult> {
  const paths = taskPaths(request.taskId);
  if (!paths.ok) {
    return paths;
  }
  try {
    return await runWithTaskLock(request.fileSystem, paths.lockPath, () =>
      removeDurableContextManifestEntryLocked(request, paths),
    );
  } catch {
    return ioFailure(paths.taskDirectory);
  }
}



export async function inspectDurableContextManifest(
  request: InspectDurableContextManifestRequest,
): Promise<InspectDurableContextManifestResult> {
  const loaded = await loadTask(request.fileSystem, request.taskId);
  if (!loaded.ok) {
    return Object.freeze({
      ok: false,
      contractVersion: TASK_LIFECYCLE_CONTRACT_VERSION,
      state: "invalid",
      diagnostics: Object.freeze(
        loaded.diagnostics.map((item) =>
          contextManifestDiagnostic(item.path, item.message, item.remediation),
        ),
      ),
    });
  }
  const reference = loaded.state.projection.contexts[request.phase];
  if (reference === undefined) {
    return missingContextManifest(`context/${request.phase}.jsonl`);
  }
  const path = `.sayhi/tasks/${request.taskId}/${reference}`;
  try {
    if ((await request.fileSystem.inspect(path)).kind !== "file") {
      return missingContextManifest(path);
    }
    const parsed = parseContextManifest(await request.fileSystem.readFile(path));
    if (!parsed.ok) {
      return invalidContextManifest(parsed.diagnostics);
    }
    const approvalDiagnostics = await approvedSpecBindingDiagnostics(
      request.fileSystem,
      parsed.entries,
    );
    if (approvalDiagnostics.length > 0) {
      return invalidContextManifest(approvalDiagnostics);
    }
    const diagnostics: ContextManifestDiagnostic[] = [];
    for (const entry of parsed.entries) {
      if (entry.source.type !== "project-path") {
        continue;
      }
      try {
        const content = await request.fileSystem.readRepositoryFile(entry.source.value);
        if (!contentMatchesIdentity(content, entry.identity)) {
          diagnostics.push(
            contextManifestDiagnostic(
              entry.source.value,
              "Context Manifest content no longer matches its identity.",
              "Restore the source or refresh the phase Manifest before dispatch.",
            ),
          );
        }
      } catch {
        diagnostics.push(
          contextManifestDiagnostic(
            entry.source.value,
            "Required Context Manifest content is missing.",
            "Restore the required source or refresh and approve the phase Manifest.",
          ),
        );
      }
    }
    return Object.freeze({
      ok: true,
      contractVersion: TASK_LIFECYCLE_CONTRACT_VERSION,
      state: diagnostics.length === 0 ? "valid" : "stale",
      entries: parsed.entries,
      diagnostics: Object.freeze(diagnostics),
    });
  } catch {
    return invalidContextManifest([
      contextManifestDiagnostic(
        path,
        "Context Manifest could not be inspected safely.",
        "Repair the Context Manifest file and retry inspection.",
      ),
    ]);
  }
}



type InitiativeGraphRecordLoadResult =
  | Readonly<{ ok: true; graph: DependencyGraph }>
  | TaskLifecycleFailure;
type InitiativeGraphNodeInspectionResult =
  | Readonly<{ ok: true; value: InitiativeGraphNodeInspection }>
  | TaskLifecycleFailure;

async function inspectInitiativeGraphNode(
  fileSystem: TaskLifecycleFileSystem,
  graph: DependencyGraph,
  node: DependencyGraph["nodes"][number],
): Promise<InitiativeGraphNodeInspectionResult> {
  const dependencies = Object.freeze(
    graph.edges
      .filter((edge) => edge.to === node.taskId)
      .map((edge) =>
        Object.freeze({
          taskId: edge.from,
          type: edge.type,
          reason: edge.reason,
        }),
      ),
  );
  const task = await readDurableTask({ fileSystem, taskId: node.taskId });
  if (!task.ok) {
    return task.diagnostics.some(
      (item) => item.code === "task_lifecycle.history.missing",
    )
      ? Object.freeze({
          ok: true,
          value: Object.freeze({
            taskId: node.taskId,
            dependencies,
            status: Object.freeze({ state: "missing" as const }),
          }),
        })
      : task;
  }
  const projection = task.state.projection;
  return Object.freeze({
    ok: true,
    value: Object.freeze({
      taskId: node.taskId,
      dependencies,
      status: Object.freeze({
        state: "recorded" as const,
        lifecycle: projection.lifecycle,
        phase: projection.phase,
        step: projection.step,
        version: projection.version,
      }),
    }),
  });
}

async function loadInitiativeGraphRecord(
  fileSystem: TaskLifecycleFileSystem,
  path: string,
  state: WorkflowState,
): Promise<InitiativeGraphRecordLoadResult> {
  const projection = state.projection;
  try {
    if ((await fileSystem.inspect(path)).kind !== "file") {
      return initiativeGraphFailure(
        "initiative_graph.record.missing",
        path,
        "The Initiative Dependency Graph record is missing or unsafe.",
        "Restore graph.json from the accepted Initiative Event history before retrying.",
      );
    }
    let graph: unknown;
    try {
      graph = JSON.parse(await fileSystem.readFile(path));
    } catch {
      return initiativeGraphFailure(
        "initiative_graph.record.invalid",
        path,
        "The Initiative Dependency Graph record is not valid JSON.",
        "Restore a complete schema-valid graph.json file before retrying.",
      );
    }
    const validated = validateDependencyGraph({ contractVersion: 1, graph });
    if (!validated.ok) {
      return failure(
        validated.diagnostics.map((item) =>
          dependencyGraphRecordDiagnostic(path, item),
        ),
      );
    }
    if (projection.route !== "initiative") {
      return initiativeGraphFailure(
        "initiative_graph.task.mismatch",
        path,
        "The graph record belongs to a Task that is not an Initiative.",
        "Inspect the Initiative Task that owns this graph record.",
      );
    }
    if (validated.graph.initiativeTaskId !== projection.id) {
      return initiativeGraphFailure(
        "initiative_graph.task.mismatch",
        path,
        "The graph record belongs to a different Initiative Task.",
        "Restore the graph.json record accepted for this Initiative.",
      );
    }
    if (validated.graph.id !== projection.initiativeGraphId) {
      return initiativeGraphFailure(
        "initiative_graph.identity.mismatch",
        path,
        "The graph record id does not match the Initiative Projection.",
        "Restore the graph.json record bound to this Initiative Projection.",
      );
    }
    if (
      !state.events.some(
        (event) => event.eventId === validated.graph.updatedByEvent,
      )
    ) {
      return initiativeGraphFailure(
        "initiative_graph.event.mismatch",
        path,
        "The graph record is not bound to an accepted Initiative Event.",
        "Restore the graph.json record accepted by this Initiative history.",
      );
    }
    return Object.freeze({ ok: true, graph: validated.graph });
  } catch {
    return ioFailure(path);
  }
}

async function preflightInitiativeGraphRecord(
  fileSystem: TaskLifecycleFileSystem,
  paths: TaskPaths,
  state: WorkflowState,
  graph: DependencyGraph,
): Promise<TaskLifecycleFailure | null> {
  const existing = await fileSystem.inspect(paths.graphPath);
  if (existing.kind === "missing") {
    return null;
  }
  const loaded = await loadInitiativeGraphRecord(
    fileSystem,
    paths.graphPath,
    state,
  );
  if (!loaded.ok) {
    return loaded;
  }
  return stableJson(loaded.graph) === stableJson(graph)
    ? null
    : initiativeGraphFailure(
        "initiative_graph.record.conflict",
        paths.graphPath,
        "The graph record conflicts with the accepted Initiative transition.",
        "Resolve the graph record conflict before retrying the transition.",
      );
}

function dependencyGraphRecordDiagnostic(
  path: string,
  item: DependencyGraphDiagnostic,
): TaskLifecycleDiagnostic {
  const prefix = "$.graph";
  const suffix = item.path.startsWith(prefix) ? item.path.slice(prefix.length) : "";
  return diagnostic(item.code, `${path}${suffix}`, item.message, item.remediation);
}

function initiativeGraphFailure(
  code: Extract<
    TaskLifecycleDiagnosticCode,
    | "initiative_graph.record.missing"
    | "initiative_graph.record.invalid"
    | "initiative_graph.record.conflict"
    | "initiative_graph.task.mismatch"
    | "initiative_graph.identity.mismatch"
    | "initiative_graph.event.mismatch"
  >,
  path: string,
  message: string,
  remediation: string,
): TaskLifecycleFailure {
  return failure([diagnostic(code, path, message, remediation)]);
}

function latestInitiativeGraph(state: WorkflowState): DependencyGraph | null {
  for (let index = state.events.length - 1; index >= 0; index -= 1) {
    const graph = state.events[index]!.initiativeGraph;
    if (graph !== null) {
      return graph;
    }
  }
  return null;
}

async function writeInitiativeGraphIfChanged(
  fileSystem: TaskLifecycleFileSystem,
  path: string,
  graph: DependencyGraph,
): Promise<boolean> {
  return writeSnapshotIfChanged(
    fileSystem,
    path,
    serializeInitiativeGraph(graph),
  );
}

async function createDurableTaskLocked(
  fileSystem: TaskLifecycleFileSystem,
  paths: TaskPaths,
  state: WorkflowState,
  event: TaskCreatedEvent,
): Promise<CreateDurableTaskResult> {
  let activePath = TASKS_DIRECTORY;
  try {
    const tasksDirectory = await fileSystem.inspect(TASKS_DIRECTORY);
    if (tasksDirectory.kind !== "directory") {
      return failure([
        diagnostic(
          "task_lifecycle.store.invalid",
          TASKS_DIRECTORY,
          "The Managed Project Tasks directory is unavailable.",
          "Initialize or repair the Managed Project before creating a Task.",
        ),
      ]);
    }
    activePath = paths.taskDirectory;
    const taskDirectory = await fileSystem.inspect(paths.taskDirectory);
    if (taskDirectory.kind !== "missing") {
      return failure([
        diagnostic(
          "task_lifecycle.task.exists",
          paths.taskDirectory,
          "A durable Task already exists at this path.",
          "Use a new Task id or load the existing durable Task.",
        ),
      ]);
    }
    await fileSystem.createDirectory(paths.taskDirectory);
    activePath = paths.eventsPath;
    await fileSystem.appendFile(paths.eventsPath, serializeEvent(event));
    activePath = paths.projectionPath;
    await fileSystem.writeFile(
      paths.projectionPath,
      serializeProjection(state.projection),
    );
    return Object.freeze({
      ok: true,
      contractVersion: TASK_LIFECYCLE_CONTRACT_VERSION,
      state,
      event,
    });
  } catch {
    return ioFailure(activePath);
  }
}
async function addDurableContextManifestEntryLocked(
  request: AddDurableContextManifestEntryRequest,
  paths: TaskPaths,
): Promise<AddDurableContextManifestEntryResult> {
  const loaded = await loadTask(request.fileSystem, request.taskId);
  if (!loaded.ok) {
    return loaded;
  }
  const manifest = await loadContextManifestForMutation(
    request.fileSystem,
    paths,
    loaded.state.projection,
    request.phase,
  );
  if (!manifest.ok) {
    return manifest;
  }
  const { entries, manifestPath, manifestReference } = manifest;
  if (!isRepositoryRelativePath(request.source)) {
    return contextLifecycleFailure(
      "context_manifest.source.unreadable",
      request.source,
      "Context source must be a repository-relative path.",
      "Use a normalized path without absolute roots, backslashes, or '..' traversal.",
    );
  }
  let content: string;
  try {
    content = await request.fileSystem.readRepositoryFile(request.source);
  } catch {
    return contextLifecycleFailure(
      "context_manifest.source.unreadable",
      request.source,
      "Context source is missing, unreadable, or unsafe.",
      "Restore a regular repository file at the requested source path.",
    );
  }
  if (entries.some((entry) => entry.source.value === request.source)) {
    return contextLifecycleFailure(
      "context_manifest.source.duplicate",
      request.source,
      "Context source is already bound to this Manifest.",
      "Use context refresh for the existing entry or choose a different source.",
    );
  }
  const identity = hashTextContent(content);
  let approvedSpec = false;
  if (request.source.startsWith(".sayhi/spec/")) {
    const approvals = await readApprovedSpecs(request.fileSystem);
    if (approvals.ok === false) {
      const diagnostic = approvals.diagnostics[0]!;
      return contextLifecycleFailure(
        "context_manifest.invalid",
        diagnostic.path,
        diagnostic.message,
        diagnostic.remediation,
      );
    }
    approvedSpec = isApprovedSpec(approvals.approvals, request.source, identity);
  }
  const trust: ContextTrustTier = approvedSpec
    ? "approved-spec"
    : request.source.startsWith(`${paths.taskDirectory}/`)
      ? "task-context"
      : "untrusted-reference";
  const entry = Object.freeze({
    schemaVersion: 1 as const,
    id: `CTX-${request.phase}-${hashCanonicalJson({ phase: request.phase, source: request.source }).slice(7, 19)}`,
    source: Object.freeze({ type: "project-path", value: request.source }),
    kind: trust === "approved-spec" ? "spec" : "reference",
    reason: "Selected through the SayHi CLI.",
    required: true,
    mode: "full" as const,
    trust,
    instructionPolicy:
      trust === "approved-spec" ? "scoped-instruction" : "data-only",
    scope: Object.freeze(["**/*"]),
    identity,
    addedBy: "sayhi-cli",
  }) satisfies ContextManifestEntry;
  const nextEntries = Object.freeze([...entries, entry]);
  const changed = recordContextManifestChange(loaded.state, {
    contractVersion: 1,
    taskId: request.taskId,
    expectedVersion: request.expectedVersion,
    phase: request.phase,
    manifestPath: manifestReference,
    manifestIdentity: hashCanonicalJson(nextEntries),
    change: "added",
    event: request.event,
  });
  if (!changed.ok) {
    return failure(changed.diagnostics);
  }
  const persisted = await persistContextManifestChange({
    fileSystem: request.fileSystem,
    paths,
    manifestPath,
    entries: nextEntries,
    previousEventCount: loaded.state.events.length,
    state: changed.state,
    persist: request.persist ?? true,
  });
  if (persisted !== null) {
    return persisted;
  }
  return Object.freeze({
    ok: true,
    contractVersion: TASK_LIFECYCLE_CONTRACT_VERSION,
    state: changed.state,
    event: changed.event,
    entry,
    planned: request.persist === false,
  });
}
async function refreshDurableContextManifestLocked(
  request: RefreshDurableContextManifestRequest,
  paths: TaskPaths,
): Promise<RefreshDurableContextManifestResult> {
  const loaded = await loadTask(request.fileSystem, request.taskId);
  if (!loaded.ok) {
    return loaded;
  }
  const manifest = await loadContextManifestForMutation(
    request.fileSystem,
    paths,
    loaded.state.projection,
    request.phase,
    request.acceptRequiredApprovedSpecChanges,
  );
  if (!manifest.ok) {
    return manifest;
  }
  const approvals = manifest.entries.some(
    (entry) => entry.trust === "approved-spec",
  )
    ? await readApprovedSpecs(request.fileSystem)
    : null;
  if (approvals !== null && approvals.ok === false) {
    const diagnostic = approvals.diagnostics[0]!;
    return contextLifecycleFailure(
      "context_manifest.invalid",
      diagnostic.path,
      diagnostic.message,
      diagnostic.remediation,
    );
  }
  let approvalRequired = false;
  const approvedSpecUpdates: ContextManifestEntry[] = [];
  const nextEntries: ContextManifestEntry[] = [];
  for (const entry of manifest.entries) {
    if (entry.source.type !== "project-path") {
      return contextLifecycleFailure(
        "context_manifest.source.unreadable",
        entry.source.value,
        "Only repository-path Context sources can be refreshed through the CLI.",
        "Restore the source as a project-path entry or remove it from the Manifest.",
      );
    }
    let content: string;
    try {
      content = await request.fileSystem.readRepositoryFile(entry.source.value);
    } catch {
      return contextLifecycleFailure(
        "context_manifest.stale",
        entry.source.value,
        "Context source is missing, unreadable, or unsafe.",
        "Restore the source before refreshing the Context Manifest.",
      );
    }
    const identity = hashTextContent(content);
    const approvedSpecChanged =
      entry.trust === "approved-spec" &&
      (!contentMatchesIdentity(content, entry.identity) ||
        (approvals !== null &&
          isApprovedSpec(approvals.approvals, entry.source.value, identity) === false));
    approvalRequired ||= approvedSpecChanged;
    const nextEntry = Object.freeze({
      ...entry,
      identity,
      ...(approvedSpecChanged && request.acceptRequiredApprovedSpecChanges
        ? { acceptedByEvent: request.event.eventId }
        : {}),
    });
    if (approvedSpecChanged && request.acceptRequiredApprovedSpecChanges) {
      approvedSpecUpdates.push(nextEntry);
    }
    nextEntries.push(nextEntry);
  }
  if (approvalRequired && !request.acceptRequiredApprovedSpecChanges) {
    return contextLifecycleFailure(
      "context_manifest.approval_required",
      manifest.manifestPath,
      "Refreshing changed Approved Spec content requires explicit approval.",
      "Review the changed Spec, then retry with explicit approval for this refresh.",
    );
  }
  const frozenEntries = Object.freeze(nextEntries);
  const refreshedContextIdentity = hashCanonicalJson(frozenEntries);
  const changed = recordContextManifestChange(loaded.state, {
    contractVersion: 1,
    taskId: request.taskId,
    expectedVersion: request.expectedVersion,
    phase: request.phase,
    manifestPath: manifest.manifestReference,
    manifestIdentity: refreshedContextIdentity,
    change: "refreshed",
    event: request.event,
  });
  if (!changed.ok) {
    return failure(changed.diagnostics);
  }
  let state = changed.state;
  if (
    loaded.state.projection.route === "build" &&
    loaded.state.projection.lifecycle === "active" &&
    loaded.state.projection.phase === "implement" &&
    !hasFrozenImplementContext(
      loaded.state,
      "context/implement.jsonl",
      refreshedContextIdentity,
    )
  ) {
    const replanned = transitionWorkflow(changed.state, {
      contractVersion: 1,
      taskId: request.taskId,
      expectedVersion: changed.state.projection.version,
      to: { lifecycle: "active", phase: "plan", step: "ready" },
      gates: [
        {
          gate: "replan",
          evidence: [
            {
              kind: "workflow",
              reference: `context/implement.jsonl#${refreshedContextIdentity}`,
            },
          ],
        },
      ],
      event: {
        eventId: `${request.event.eventId}-REPLAN`,
        actor: request.event.actor,
        reason: `${request.event.reason} Replan after Implement Context refresh.`,
        idempotencyKey: `${request.event.idempotencyKey}-REPLAN`,
        occurredAt: request.event.occurredAt,
      },
    });
    if (!replanned.ok) {
      return failure(replanned.diagnostics);
    }
    state = replanned.state;
  }
  const persisted = await persistContextManifestChange({
    fileSystem: request.fileSystem,
    paths,
    manifestPath: manifest.manifestPath,
    entries: frozenEntries,
    previousEventCount: loaded.state.events.length,
    state,
    persist: request.persist ?? true,
  });
  if (persisted !== null) {
    return persisted;
  }
  if (request.persist !== false) {
    for (const entry of approvedSpecUpdates) {
      const approval = await approveSpec(request.fileSystem, {
        path: entry.source.value,
        identity: entry.identity,
        approvedBy: "sayhi-context-refresh",
      });
      if (approval.ok === false) {
        const diagnostic = approval.diagnostics[0]!;
        return contextLifecycleFailure(
          "context_manifest.invalid",
          diagnostic.path,
          diagnostic.message,
          diagnostic.remediation,
        );
      }
    }
  }
  return Object.freeze({
    ok: true,
    contractVersion: TASK_LIFECYCLE_CONTRACT_VERSION,
    state,
    event: changed.event,
    entries: frozenEntries,
    planned: request.persist === false,
  });
}
async function freezeDurableContextManifestLocked(
  request: FreezeDurableContextManifestRequest,
  paths: TaskPaths,
): Promise<FreezeDurableContextManifestResult> {
  const loaded = await loadTask(request.fileSystem, request.taskId);
  if (!loaded.ok) {
    return loaded;
  }
  const manifest = await loadContextManifestForMutation(
    request.fileSystem,
    paths,
    loaded.state.projection,
    request.phase,
  );
  if (!manifest.ok) {
    return manifest;
  }
  for (const entry of manifest.entries) {
    if (!entry.required || entry.source.type !== "project-path") {
      continue;
    }
    let content: string;
    try {
      content = await request.fileSystem.readRepositoryFile(entry.source.value);
    } catch {
      return contextLifecycleFailure(
        "context_manifest.stale",
        entry.source.value,
        "Required Context Manifest content is missing.",
        "Restore the source or remove the Context Entry before freezing.",
      );
    }
    if (!contentMatchesIdentity(content, entry.identity)) {
      return contextLifecycleFailure(
        "context_manifest.stale",
        entry.source.value,
        "Required Context Manifest content no longer matches its identity.",
        "Refresh and approve the phase Manifest before freezing.",
      );
    }
  }
  const entries = Object.freeze(
    manifest.entries.map((entry) =>
      Object.freeze({ ...entry, acceptedByEvent: request.event.eventId }),
    ),
  );
  const changed = recordContextManifestChange(loaded.state, {
    contractVersion: 1,
    taskId: request.taskId,
    expectedVersion: request.expectedVersion,
    phase: request.phase,
    manifestPath: manifest.manifestReference,
    manifestIdentity: hashCanonicalJson(entries),
    change: "frozen",
    event: request.event,
  });
  if (!changed.ok) {
    return failure(changed.diagnostics);
  }
  const persisted = await persistContextManifestChange({
    fileSystem: request.fileSystem,
    paths,
    manifestPath: manifest.manifestPath,
    entries,
    previousEventCount: loaded.state.events.length,
    state: changed.state,
    persist: request.persist ?? true,
  });
  if (persisted !== null) {
    return persisted;
  }
  return Object.freeze({
    ok: true,
    contractVersion: TASK_LIFECYCLE_CONTRACT_VERSION,
    state: changed.state,
    event: changed.event,
    entries,
    planned: request.persist === false,
  });
}

async function removeDurableContextManifestEntryLocked(
  request: RemoveDurableContextManifestEntryRequest,
  paths: TaskPaths,
): Promise<RemoveDurableContextManifestEntryResult> {
  const loaded = await loadTask(request.fileSystem, request.taskId);
  if (!loaded.ok) {
    return loaded;
  }
  const manifest = await loadContextManifestForMutation(
    request.fileSystem,
    paths,
    loaded.state.projection,
    request.phase,
  );
  if (!manifest.ok) {
    return manifest;
  }
  if (!manifest.entries.some((entry) => entry.id === request.entryId)) {
    return contextLifecycleFailure(
      "context_manifest.entry.missing",
      request.entryId,
      "Context Manifest does not contain the requested Entry ID.",
      "List the Manifest entries and retry with an existing Entry ID.",
    );
  }
  const entries = Object.freeze(
    manifest.entries.filter((entry) => entry.id !== request.entryId),
  );
  const changed = recordContextManifestChange(loaded.state, {
    contractVersion: 1,
    taskId: request.taskId,
    expectedVersion: request.expectedVersion,
    phase: request.phase,
    manifestPath: manifest.manifestReference,
    manifestIdentity: hashCanonicalJson(entries),
    change: "removed",
    event: request.event,
  });
  if (!changed.ok) {
    return failure(changed.diagnostics);
  }
  const persisted = await persistContextManifestChange({
    fileSystem: request.fileSystem,
    paths,
    manifestPath: manifest.manifestPath,
    entries,
    previousEventCount: loaded.state.events.length,
    state: changed.state,
    persist: request.persist ?? true,
  });
  if (persisted !== null) {
    return persisted;
  }
  return Object.freeze({
    ok: true,
    contractVersion: TASK_LIFECYCLE_CONTRACT_VERSION,
    state: changed.state,
    event: changed.event,
    entries,
    planned: request.persist === false,
  });
}


interface LoadedContextManifest {
  readonly ok: true;
  readonly entries: readonly ContextManifestEntry[];
  readonly manifestPath: string;
  readonly manifestReference: string;
}

async function loadContextManifestForMutation(
  fileSystem: ContextManifestFileSystem,
  paths: TaskPaths,
  projection: TaskProjection,
  phase: WorkflowPhase,
  allowApprovalMismatch = false,
): Promise<LoadedContextManifest | TaskLifecycleFailure> {
  const manifestReference =
    projection.contexts[phase] ?? `context/${phase}.jsonl`;
  if (manifestReference !== `context/${phase}.jsonl`) {
    return contextLifecycleFailure(
      "context_manifest.invalid",
      manifestReference,
      "Context Manifest pointer does not match its Task Phase.",
      "Restore the Task-local context/<phase>.jsonl pointer before changing Context.",
    );
  }
  const manifestPath = `${paths.taskDirectory}/${manifestReference}`;
  try {
    const entry = await fileSystem.inspect(manifestPath);
    if (entry.kind === "missing") {
      return Object.freeze({
        ok: true,
        entries: Object.freeze([]),
        manifestPath,
        manifestReference,
      });
    }
    if (entry.kind !== "file") {
      return contextLifecycleFailure(
        "context_manifest.invalid",
        manifestPath,
        "Context Manifest path is not a regular file.",
        "Replace the unsafe path with the Task-local Context Manifest file.",
      );
    }
    const parsed = parseContextManifest(await fileSystem.readFile(manifestPath));
    if (!parsed.ok) {
      return contextLifecycleFailure(
        "context_manifest.invalid",
        manifestPath,
        parsed.diagnostics[0]!.message,
        parsed.diagnostics[0]!.remediation,
      );
    }
    const approvalDiagnostics = await approvedSpecBindingDiagnostics(
      fileSystem,
      parsed.entries,
    );
    if (approvalDiagnostics.length > 0 && !allowApprovalMismatch) {
      const diagnostic = approvalDiagnostics[0]!;
      return contextLifecycleFailure(
        "context_manifest.invalid",
        diagnostic.path,
        diagnostic.message,
        diagnostic.remediation,
      );
    }
    return Object.freeze({
      ok: true,
      entries: parsed.entries,
      manifestPath,
      manifestReference,
    });
  } catch {
    return ioFailure(manifestPath);
  }
}
async function approvedSpecBindingDiagnostics(
  fileSystem: ContextManifestFileSystem,
  entries: readonly ContextManifestEntry[],
): Promise<readonly ContextManifestDiagnostic[]> {
  const approvedEntries = entries.filter(
    (entry) => entry.trust === "approved-spec",
  );
  if (approvedEntries.length === 0) {
    return Object.freeze([]);
  }
  const approvals = await readApprovedSpecs(fileSystem);
  if (approvals.ok === false) {
    return Object.freeze(
      approvals.diagnostics.map((diagnostic) =>
        contextManifestDiagnostic(
          diagnostic.path,
          diagnostic.message,
          diagnostic.remediation,
        ),
      ),
    );
  }
  const diagnostics = approvedEntries.flatMap((entry) => {
    if (entry.source.type !== "project-path") {
      return [
        contextManifestDiagnostic(
          entry.id,
          "Approved Spec Context must reference a repository file.",
          "Replace the entry with an explicitly approved repository Spec.",
        ),
      ];
    }
    if (isApprovedSpec(approvals.approvals, entry.source.value, entry.identity)) {
      return [];
    }
    return [
      contextManifestDiagnostic(
        entry.source.value,
        "Approved Spec Context is not bound to an approved current content identity.",
        "Create the Spec through SayHi or explicitly refresh its changed content with approval.",
      ),
    ];
  });
  return Object.freeze(diagnostics);
}


interface PersistContextManifestChangeRequest {
  readonly fileSystem: ContextManifestFileSystem;
  readonly paths: TaskPaths;
  readonly manifestPath: string;
  readonly entries: readonly ContextManifestEntry[];
  readonly previousEventCount: number;
  readonly state: WorkflowState;
  readonly persist: boolean;
}

async function persistContextManifestChange(
  request: PersistContextManifestChangeRequest,
): Promise<TaskLifecycleFailure | null> {
  try {
    const contextDirectory = `${request.paths.taskDirectory}/context`;
    const directory = await request.fileSystem.inspect(contextDirectory);
    if (directory.kind === "missing") {
      if (request.persist) {
        await request.fileSystem.createDirectory(contextDirectory);
      }
    } else if (directory.kind !== "directory") {
      return contextLifecycleFailure(
        "context_manifest.invalid",
        contextDirectory,
        "Task Context directory is unavailable.",
        "Replace the unsafe path with a directory before changing Context.",
      );
    }
    if (request.persist === false) {
      return null;
    }
    for (const event of request.state.events.slice(request.previousEventCount)) {
      await request.fileSystem.appendFile(
        request.paths.eventsPath,
        serializeEvent(event),
      );
    }
    await request.fileSystem.writeFile(
      request.manifestPath,
      serializeContextManifest(request.entries),
    );
    if (request.state.events.length > request.previousEventCount) {
      await writeProjectionIfChanged(
        request.fileSystem,
        request.paths.projectionPath,
        request.state.projection,
      );
    }
    return null;
  } catch {
    return ioFailure(request.manifestPath);
  }
}


async function dispatchDurablePhaseExecutionLocked(
  request: DispatchDurablePhaseExecutionRequest,
  paths: TaskPaths,
): Promise<DispatchDurablePhaseExecutionResult> {
  const dispatch = request.execution.dispatch;
  const loaded = await loadTask(request.fileSystem, dispatch.taskId);
  if (!loaded.ok) {
    return loaded;
  }
  const plan = await loadBuildPlan(
    request.fileSystem,
    paths,
    dispatch.taskId,
    request.planIdentity,
  );
  if (!plan.ok) {
    return plan;
  }
  const bound = bindPhaseExecution(request.execution);
  if (!bound.ok) {
    return phaseExecutionFailure(bound.diagnostics);
  }
  if (plan.plan.contextManifestIdentity !== bound.binding.contextManifestIdentity) {
    return buildPlanInvalid(
      "$.execution.dispatch.contextManifestIdentity",
      "Phase Context Manifest does not match the approved Build Plan.",
      "Restore the frozen Plan Manifest or record and approve a new Build Plan before dispatch.",
    );
  }
  if (bound.binding.phase !== loaded.state.projection.phase) {
    return phaseExecutionPhaseInvalid(loaded.state.projection.phase);
  }
  const recorded = recordPhaseExecutionDispatch(loaded.state, {
    contractVersion: 1,
    taskId: dispatch.taskId,
    expectedVersion: dispatch.expectedTaskVersion,
    planIdentity: plan.plan.identity,
    binding: bound.binding,
    event: request.event,
  });
  if (!recorded.ok) {
    return failure(recorded.diagnostics);
  }
  const appended = recorded.state.events.length > loaded.state.events.length;
  const persisted = await persistPhaseExecutionEvent(
    request.fileSystem,
    loaded.eventsPath,
    loaded.projectionPath,
    recorded.state,
    recorded.event,
    appended,
  );
  if (persisted !== null) {
    return persisted;
  }
  return Object.freeze({
    ok: true,
    contractVersion: TASK_LIFECYCLE_CONTRACT_VERSION,
    state: recorded.state,
    plan: plan.plan,
    binding: bound.binding,
    event: recorded.event,
    appended,
  });
}

async function resumeDurablePhaseExecutionLocked(
  request: ResumeDurablePhaseExecutionRequest,
  paths: TaskPaths,
): Promise<ResumeDurablePhaseExecutionResult> {
  const loaded = await loadTask(request.fileSystem, request.taskId);
  if (!loaded.ok) {
    return loaded;
  }
  const dispatched = latestPhaseExecutionDispatch(
    loaded.state.events,
    loaded.state.projection.phase,
  );
  if (dispatched === undefined) {
    return phaseExecutionMissing(loaded.state.projection.phase);
  }
  const binding = parsePhaseExecutionBinding(dispatched.binding);
  if (binding === null) {
    return phaseExecutionBindingInvalid();
  }
  const acceptedResult = latestPhaseExecutionResult(
    loaded.state.events,
    binding.dispatchId,
    loaded.state.projection.phase,
  );
  if (acceptedResult !== undefined) {
    const validated = validatePhaseExecutionResult(
      acceptedResult.result,
      binding,
      "Accepted Phase execution result",
    );
    if (!validated.ok) {
      return validated;
    }
    const result = validated.result;
    return Object.freeze({
      ok: true,
      contractVersion: TASK_LIFECYCLE_CONTRACT_VERSION,
      status: "completed",
      state: loaded.state,
      binding,
      result,
    });
  }
  const plan = await loadBuildPlan(
    request.fileSystem,
    paths,
    request.taskId,
    dispatched.planIdentity,
  );
  if (!plan.ok) {
    return plan;
  }
  const authorized = authorizePhaseExecution({
    contractVersion: 1,
    binding,
    ...request.materials,
    capability: { kind: "repository", access: "read" },
  });
  if (!authorized.ok) {
    return phaseExecutionFailure(authorized.diagnostics);
  }
  return Object.freeze({
    ok: true,
    contractVersion: TASK_LIFECYCLE_CONTRACT_VERSION,
    status: "ready",
    state: loaded.state,
    plan: plan.plan,
    binding,
  });
}

async function recordDurablePhaseExecutionResultLocked(
  request: RecordDurablePhaseExecutionResultRequest,
  paths: TaskPaths,
): Promise<RecordDurablePhaseExecutionResultResult> {
  const loaded = await loadTask(request.fileSystem, request.taskId);
  if (!loaded.ok) {
    return loaded;
  }
  const dispatchId = phaseExecutionDispatchId(request.result);
  if (dispatchId === undefined) {
    return phaseExecutionResultInvalid("Phase execution result is invalid.");
  }
  const dispatched = phaseExecutionDispatchById(
    loaded.state.events,
    dispatchId,
    loaded.state.projection.phase,
  );
  if (dispatched === undefined) {
    return phaseExecutionResultInvalid(
      "Phase execution result has no durable dispatch binding.",
    );
  }
  const validated = validatePhaseExecutionResult(
    request.result,
    dispatched.binding,
    "Phase execution result",
  );
  if (!validated.ok) {
    return validated;
  }
  const result = validated.result;
  const existingResult = latestPhaseExecutionResult(
    loaded.state.events,
    result.dispatchId,
    loaded.state.projection.phase,
  );
  if (
    existingResult !== undefined &&
    existingResult.idempotencyKey !== request.event.idempotencyKey
  ) {
    return phaseExecutionResultInvalid(
      "Phase execution result was already accepted for this dispatch.",
    );
  }
  const recorded = recordPhaseExecutionResult(loaded.state, {
    contractVersion: 1,
    taskId: request.taskId,
    expectedVersion: loaded.state.projection.version,
    result,
    event: request.event,
  });
  if (!recorded.ok) {
    return failure(recorded.diagnostics);
  }
  const appended = recorded.state.events.length > loaded.state.events.length;
  const persisted = await persistPhaseExecutionEvent(
    request.fileSystem,
    loaded.eventsPath,
    loaded.projectionPath,
    recorded.state,
    recorded.event,
    appended,
  );
  if (persisted !== null) {
    return persisted;
  }
  return Object.freeze({
    ok: true,
    contractVersion: TASK_LIFECYCLE_CONTRACT_VERSION,
    state: recorded.state,
    event: recorded.event,
    result,
    appended,
  });
}

function validatePhaseExecutionResult(
  value: unknown,
  binding: PhaseExecutionBinding,
  label: string,
): Readonly<{ ok: true; result: AgentResultRecord }> | TaskLifecycleFailure {
  const result = parsePhaseExecutionResult(value);
  if (result === null) {
    return phaseExecutionResultInvalid(`${label} is invalid.`);
  }
  if (!phaseExecutionResultMatchesBinding(result, binding)) {
    return phaseExecutionResultInvalid(
      `${label} does not match its durable dispatch binding.`,
    );
  }
  return Object.freeze({ ok: true, result });
}

async function persistPhaseExecutionEvent(
  fileSystem: TaskLifecycleFileSystem,
  eventsPath: string,
  projectionPath: string,
  state: WorkflowState,
  event: PhaseExecutionDispatchedEvent | PhaseExecutionResultAcceptedEvent,
  appended: boolean,
): Promise<TaskLifecycleFailure | null> {
  if (!appended) {
    return null;
  }
  let activePath = eventsPath;
  try {
    await fileSystem.appendFile(eventsPath, serializeEvent(event));
    activePath = projectionPath;
    await writeProjectionIfChanged(fileSystem, projectionPath, state.projection);
    return null;
  } catch {
    return ioFailure(activePath);
  }
}

function currentPhaseEventStart(
  events: readonly WorkflowEvent[],
  phase: WorkflowPhase,
): number {
  for (let index = events.length - 1; index >= 0; index -= 1) {
    const event = events[index]!;
    if (
      event.type === "workflow_transitioned" &&
      event.from.phase !== phase &&
      event.to.phase === phase
    ) {
      return index + 1;
    }
  }
  return 0;
}

function latestPhaseExecutionDispatch(
  events: readonly WorkflowEvent[],
  phase: WorkflowPhase,
): PhaseExecutionDispatchedEvent | undefined {
  const start = currentPhaseEventStart(events, phase);
  for (let index = events.length - 1; index >= start; index -= 1) {
    const event = events[index]!;
    if (
      event.type === "phase_execution_dispatched" &&
      parsePhaseExecutionBinding(event.binding)?.phase === phase
    ) {
      return event;
    }
  }
  return undefined;
}

function latestPhaseExecutionResult(
  events: readonly WorkflowEvent[],
  dispatchId: string,
  phase: WorkflowPhase,
): PhaseExecutionResultAcceptedEvent | undefined {
  const start = currentPhaseEventStart(events, phase);
  for (let index = events.length - 1; index >= start; index -= 1) {
    const event = events[index]!;
    if (
      event.type === "phase_execution_result_accepted" &&
      phaseExecutionDispatchId(event.result) === dispatchId
    ) {
      return event;
    }
  }
  return undefined;
}

function phaseExecutionDispatchById(
  events: readonly WorkflowEvent[],
  dispatchId: string,
  phase: WorkflowPhase,
): Readonly<{
  event: PhaseExecutionDispatchedEvent;
  binding: PhaseExecutionBinding;
}> | undefined {
  const start = currentPhaseEventStart(events, phase);
  for (let index = events.length - 1; index >= start; index -= 1) {
    const event = events[index]!;
    if (event.type !== "phase_execution_dispatched") {
      continue;
    }
    const binding = parsePhaseExecutionBinding(event.binding);
    if (binding?.dispatchId === dispatchId && binding.phase === phase) {
      return Object.freeze({ event, binding });
    }
  }
  return undefined;
}

function phaseExecutionDispatchId(value: unknown): string | undefined {
  if (
    typeof value !== "object" ||
    value === null ||
    Array.isArray(value) ||
    !("dispatchId" in value)
  ) {
    return undefined;
  }
  const dispatchId = value.dispatchId;
  return typeof dispatchId === "string" && dispatchId.length > 0
    ? dispatchId
    : undefined;
}


async function recordDurableBuildPlanLocked(
  request: RecordDurableBuildPlanRequest,
  paths: TaskPaths,
): Promise<RecordDurableBuildPlanResult> {
  const loaded = await loadTask(request.fileSystem, request.taskId);
  if (!loaded.ok) {
    return loaded;
  }
  if (typeof request.content !== "string" || request.content.trim().length === 0) {
    return buildPlanInvalid(
      "$.content",
      "Build Plan content must be non-empty text.",
      "Provide the reviewable implementation Plan before requesting approval.",
    );
  }
  const priorRecord = loaded.state.events.find(
    (event): event is BuildPlanChangedEvent =>
      event.type === "build_plan_changed" &&
      event.change === "recorded" &&
      event.idempotencyKey === request.event.idempotencyKey,
  );
  if (priorRecord !== undefined) {
    const recordedPlan = await loadBuildPlan(
      request.fileSystem,
      paths,
      request.taskId,
      priorRecord.planIdentity,
    );
    if (!recordedPlan.ok) {
      return recordedPlan;
    }
    let retryPlan: DurableBuildPlan;
    try {
      retryPlan = createDurableBuildPlan({
        taskId: request.taskId,
        requirements: recordedPlan.plan.requirements,
        content: request.content,
        contextManifestPath: recordedPlan.plan.contextManifestPath,
        contextManifestIdentity: recordedPlan.plan.contextManifestIdentity,
        preparedBy: request.event.actor,
        preparedAt: request.event.occurredAt,
      });
    } catch {
      return buildPlanInvalid(
        "$.event",
        "Build Plan preparation metadata is invalid.",
        "Provide a valid actor and RFC 3339 preparation time.",
      );
    }
    const retried = recordBuildPlanChange(loaded.state, {
      contractVersion: 1,
      taskId: request.taskId,
      expectedVersion: request.expectedVersion,
      change: "recorded",
      planIdentity: retryPlan.identity,
      requirementsIdentity: retryPlan.requirementsIdentity,
      contextManifestPath: retryPlan.contextManifestPath,
      contextManifestIdentity: retryPlan.contextManifestIdentity,
      event: request.event,
    });
    if (!retried.ok) {
      return failure(retried.diagnostics);
    }
    return Object.freeze({
      ok: true,
      contractVersion: TASK_LIFECYCLE_CONTRACT_VERSION,
      state: retried.state,
      plan: recordedPlan.plan,
      event: retried.event,
      created: false,
      appended: false,
    });
  }
  const context = await inspectDurableContextManifest({
    fileSystem: request.fileSystem,
    taskId: request.taskId,
    phase: "implement",
  });
  if (!context.ok || context.state !== "valid") {
    return buildPlanContextFailure(context);
  }
  const contextManifestPath = loaded.state.projection.contexts.implement;
  const contextManifestIdentity = hashCanonicalJson(context.entries);
  if (
    contextManifestPath === undefined ||
    !hasFrozenImplementContext(
      loaded.state,
      contextManifestPath,
      contextManifestIdentity,
    )
  ) {
    return buildPlanContextFailure(context);
  }
  let plan: DurableBuildPlan;
  try {
    plan = createDurableBuildPlan({
      taskId: request.taskId,
      requirements: loaded.state.projection.intent,
      content: request.content,
      contextManifestPath,
      contextManifestIdentity,
      preparedBy: request.event.actor,
      preparedAt: request.event.occurredAt,
    });
    const validated = parseDurableBuildPlan(serializeDurableBuildPlan(plan));
    if (!validated.ok) {
      return buildPlanInvalid(
        "$.event",
        validated.message,
        "Provide complete, valid Plan metadata before recording the Plan.",
      );
    }
    plan = validated.plan;
  } catch {
    return buildPlanInvalid(
      "$.event",
      "Build Plan preparation metadata is invalid.",
      "Provide a valid actor and RFC 3339 preparation time.",
    );
  }
  const changed = recordBuildPlanChange(loaded.state, {
    contractVersion: 1,
    taskId: request.taskId,
    expectedVersion: request.expectedVersion,
    change: "recorded",
    planIdentity: plan.identity,
    requirementsIdentity: plan.requirementsIdentity,
    contextManifestPath: plan.contextManifestPath,
    contextManifestIdentity: plan.contextManifestIdentity,
    event: request.event,
  });
  if (!changed.ok) {
    return failure(changed.diagnostics);
  }
  const planPath = `${paths.plansDirectory}/${buildPlanFileName(plan.identity)}`;
  const appended = changed.state.events.length > loaded.state.events.length;
  let activePath = paths.plansDirectory;
  try {
    const directory = await request.fileSystem.inspect(paths.plansDirectory);
    if (directory.kind === "missing") {
      await request.fileSystem.createDirectory(paths.plansDirectory);
    } else if (directory.kind !== "directory") {
      return buildPlanInvalid(
        paths.plansDirectory,
        "Build Plan storage is not a directory.",
        "Restore the Task plans directory before recording a Plan.",
      );
    }
    activePath = planPath;
    const existing = await request.fileSystem.inspect(planPath);
    const created = existing.kind === "missing";
    if (created) {
      await request.fileSystem.writeFile(planPath, serializeDurableBuildPlan(plan));
    } else if (existing.kind !== "file") {
      return buildPlanInvalid(
        planPath,
        "Build Plan evidence path is not a regular file.",
        "Restore the hash-named Build Plan file before requesting approval.",
      );
    } else {
      const parsed = parseDurableBuildPlan(await request.fileSystem.readFile(planPath));
      if (!parsed.ok || stableJson(parsed.plan) !== stableJson(plan)) {
        return buildPlanInvalid(
          planPath,
          "Build Plan evidence does not match its hash-bound material.",
          "Use a new Plan or restore the existing immutable Plan evidence.",
        );
      }
    }
    if (appended) {
      activePath = loaded.eventsPath;
      await request.fileSystem.appendFile(
        loaded.eventsPath,
        serializeEvent(changed.event),
      );
      activePath = loaded.projectionPath;
      await writeProjectionIfChanged(
        request.fileSystem,
        loaded.projectionPath,
        changed.state.projection,
      );
    }
    return Object.freeze({
      ok: true,
      contractVersion: TASK_LIFECYCLE_CONTRACT_VERSION,
      state: changed.state,
      plan,
      event: changed.event,
      created,
      appended,
    });
  } catch {
    return ioFailure(activePath);
  }
}

async function decideDurableBuildPlanLocked(
  request: DecideDurableBuildPlanRequest,
  paths: TaskPaths,
): Promise<DecideDurableBuildPlanResult> {
  const loaded = await loadTask(request.fileSystem, request.taskId);
  if (!loaded.ok) {
    return loaded;
  }
  const plan = await loadBuildPlan(
    request.fileSystem,
    paths,
    request.taskId,
    request.planIdentity,
  );
  if (!plan.ok) {
    return plan;
  }
  if (
    plan.plan.requirementsIdentity !== hashCanonicalJson(loaded.state.projection.intent)
  ) {
    return buildPlanInvalid(
      paths.plansDirectory,
      "Build Plan requirements no longer match the Task intent.",
      "Record a new Plan against the current requirements before requesting approval.",
    );
  }
  if (
    plan.plan.contextManifestIdentity !== request.contextManifestIdentity ||
    plan.plan.contextManifestPath !== loaded.state.projection.contexts.implement
  ) {
    return buildPlanContextFailure(undefined);
  }
  const approvalTransition = buildPlanApprovalTransition(request, plan.plan);
  if (
    request.decision === "approved" &&
    loaded.state.events.some(
      (event) =>
        event.type === "workflow_transitioned" &&
        event.idempotencyKey === request.event.idempotencyKey,
    )
  ) {
    const retried = transitionWorkflow(loaded.state, approvalTransition);
    if (!retried.ok) {
      return failure(retried.diagnostics);
    }
    return Object.freeze({
      ok: true,
      contractVersion: TASK_LIFECYCLE_CONTRACT_VERSION,
      decision: "approved",
      state: retried.state,
      plan: plan.plan,
      event: retried.event,
      appended: false,
    });
  }
  if (request.event.actor.kind !== "user") {
    return buildPlanInvalid(
      "$.event.actor.kind",
      "Build Plan decisions must be attributable to a user.",
      "Record the human decision maker as the Event actor before deciding the Plan.",
    );
  }
  if (findBuildPlanChange(loaded.state, "recorded", plan.plan) === undefined) {
    return buildPlanInvalid(
      paths.plansDirectory,
      "Build Plan evidence has no accepted record Event.",
      "Record the immutable Plan through Core before deciding it.",
    );
  }
  const currentPlan = currentBuildPlanChange(loaded.state);
  const isRejectionRetry =
    request.decision === "rejected" &&
    findBuildPlanChange(loaded.state, "rejected", plan.plan)?.idempotencyKey ===
      request.event.idempotencyKey;
  if (
    !isRejectionRetry &&
    (currentPlan === undefined ||
      !matchesBuildPlanBinding(currentPlan, plan.plan) ||
      currentPlan.change !== "recorded")
  ) {
    return buildPlanRejected();
  }
  if (request.decision === "rejected") {
    const rejected = recordBuildPlanChange(loaded.state, {
      contractVersion: 1,
      taskId: request.taskId,
      expectedVersion: request.expectedVersion,
      change: "rejected",
      planIdentity: plan.plan.identity,
      requirementsIdentity: plan.plan.requirementsIdentity,
      contextManifestPath: plan.plan.contextManifestPath,
      contextManifestIdentity: plan.plan.contextManifestIdentity,
      event: request.event,
    });
    if (!rejected.ok) {
      return failure(rejected.diagnostics);
    }
    const appended = rejected.state.events.length > loaded.state.events.length;
    let activePath = loaded.eventsPath;
    try {
      if (appended) {
        await request.fileSystem.appendFile(
          loaded.eventsPath,
          serializeEvent(rejected.event),
        );
        activePath = loaded.projectionPath;
        await writeProjectionIfChanged(
          request.fileSystem,
          loaded.projectionPath,
          rejected.state.projection,
        );
      }
      return Object.freeze({
        ok: true,
        contractVersion: TASK_LIFECYCLE_CONTRACT_VERSION,
        decision: "rejected",
        state: rejected.state,
        plan: plan.plan,
        event: rejected.event,
        appended,
      });
    } catch {
      return ioFailure(activePath);
    }
  }
  if (!isCurrentBuildPlanRecord(loaded.state, plan.plan)) {
    return buildPlanRejected();
  }
  const context = await inspectDurableContextManifest({
    fileSystem: request.fileSystem,
    taskId: request.taskId,
    phase: "implement",
  });
  if (
    !context.ok ||
    context.state !== "valid" ||
    hashCanonicalJson(context.entries) !== plan.plan.contextManifestIdentity ||
    !hasFrozenImplementContext(
      loaded.state,
      plan.plan.contextManifestPath,
      plan.plan.contextManifestIdentity,
    )
  ) {
    return buildPlanContextFailure(context);
  }
  const transitioned = transitionWorkflow(loaded.state, approvalTransition);
  if (!transitioned.ok) {
    return failure(transitioned.diagnostics);
  }
  const appended = transitioned.state.events.length > loaded.state.events.length;
  let activePath = loaded.eventsPath;
  try {
    if (appended) {
      await request.fileSystem.appendFile(
        loaded.eventsPath,
        serializeEvent(transitioned.event),
      );
    }
    activePath = loaded.projectionPath;
    await writeProjectionIfChanged(
      request.fileSystem,
      loaded.projectionPath,
      transitioned.state.projection,
    );
    return Object.freeze({
      ok: true,
      contractVersion: TASK_LIFECYCLE_CONTRACT_VERSION,
      decision: "approved",
      state: transitioned.state,
      plan: plan.plan,
      event: transitioned.event,
      appended,
    });
  } catch {
    return ioFailure(activePath);
  }
}

async function loadBuildPlan(
  fileSystem: TaskLifecycleFileSystem,
  paths: TaskPaths,
  taskId: string,
  identity: unknown,
): Promise<Readonly<{ ok: true; plan: DurableBuildPlan }> | TaskLifecycleFailure> {
  if (!isContractIdentity(identity)) {
    return buildPlanInvalid(
      "$.planIdentity",
      "Build Plan identity is invalid.",
      "Use the exact Plan identity displayed when the Plan was recorded.",
    );
  }
  const path = `${paths.plansDirectory}/${buildPlanFileName(identity)}`;
  try {
    if ((await fileSystem.inspect(path)).kind !== "file") {
      return buildPlanMissing(path);
    }
    const parsed = parseDurableBuildPlan(await fileSystem.readFile(path));
    if (!parsed.ok || parsed.plan.taskId !== taskId || parsed.plan.identity !== identity) {
      return buildPlanInvalid(
        path,
        "Build Plan evidence is invalid or belongs to another Task.",
        "Restore the hash-bound Plan evidence recorded for this Task.",
      );
    }
    return Object.freeze({ ok: true, plan: parsed.plan });
  } catch {
    return ioFailure(path);
  }
}

function buildPlanApprovalTransition(
  request: DecideDurableBuildPlanRequest,
  plan: DurableBuildPlan,
): TransitionWorkflowRequest {
  return {
    contractVersion: 1,
    taskId: request.taskId,
    expectedVersion: request.expectedVersion,
    to: { lifecycle: "active", phase: "implement", step: "ready" },
    gates: [
      {
        gate: "plan",
        evidence: [
          {
            kind: "human-approval",
            reference: `plans/${buildPlanFileName(plan.identity)}`,
          },
          {
            kind: "human-approval",
            reference: `${plan.contextManifestPath}#${plan.contextManifestIdentity}`,
          },
        ],
      },
    ],
    event: request.event,
  };
}


function isBuildPlanTransition(
  state: WorkflowState,
  transition: TransitionWorkflowRequest,
): boolean {
  return (
    state.projection.route === "build" &&
    state.projection.lifecycle === "active" &&
    state.projection.phase === "plan" &&
    transition.to.lifecycle === "active" &&
    transition.to.phase === "implement"
  );
}


function hasFrozenImplementContext(
  state: WorkflowState,
  manifestPath: string,
  manifestIdentity: string,
): boolean {
  const event = currentImplementContextChange(state.events);
  return (
    event !== undefined &&
    event.change === "frozen" &&
    event.manifestPath === manifestPath &&
    event.manifestIdentity === manifestIdentity
  );
}


function matchesBuildPlanBinding(
  event: WorkflowEvent,
  plan: DurableBuildPlan,
): event is BuildPlanChangedEvent {
  return (
    event.type === "build_plan_changed" &&
    event.planIdentity === plan.identity &&
    event.requirementsIdentity === plan.requirementsIdentity &&
    event.contextManifestPath === plan.contextManifestPath &&
    event.contextManifestIdentity === plan.contextManifestIdentity
  );
}

function findBuildPlanChange(
  state: WorkflowState,
  change: "recorded" | "rejected",
  plan: DurableBuildPlan,
): BuildPlanChangedEvent | undefined {
  for (let index = state.events.length - 1; index >= 0; index -= 1) {
    const event = state.events[index]!;
    if (matchesBuildPlanBinding(event, plan) && event.change === change) {
      return event;
    }
  }
  return undefined;
}

function currentBuildPlanChange(
  state: WorkflowState,
): BuildPlanChangedEvent | undefined {
  for (let index = state.events.length - 1; index >= 0; index -= 1) {
    const event = state.events[index]!;
    if (event.type === "build_plan_changed") {
      return event;
    }
  }
  return undefined;
}

function isCurrentBuildPlanRecord(
  state: WorkflowState,
  plan: DurableBuildPlan,
): boolean {
  const currentPlan = currentBuildPlanChange(state);
  return (
    currentPlan !== undefined &&
    matchesBuildPlanBinding(currentPlan, plan) &&
    currentPlan.change === "recorded"
  );
}
async function resealBuildImplementationAfterContextDrift(
  fileSystem: TaskLifecycleFileSystem,
  paths: TaskPaths,
  state: WorkflowState,
): Promise<TaskLifecycleFailure | null> {
  if (
    state.projection.route !== "build" ||
    state.projection.lifecycle !== "active" ||
    state.projection.phase !== "implement"
  ) {
    return null;
  }
  const currentContext = currentImplementContextChange(state.events);
  if (
    typeof (fileSystem as Partial<ContextManifestFileSystem>)
      .readRepositoryFile !== "function"
  ) {
    return buildPlanContextFailure(undefined);
  }
  const contextFileSystem = fileSystem as ContextManifestFileSystem;
  const context = await inspectDurableContextManifest({
    fileSystem: contextFileSystem,
    taskId: state.projection.id,
    phase: "implement",
  });
  if (
    context.ok &&
    context.state === "valid" &&
    currentContext !== undefined &&
    currentContext.change === "frozen" &&
    hasFrozenImplementContext(
      state,
      "context/implement.jsonl",
      hashCanonicalJson(context.entries),
    )
  ) {
    return null;
  }
  const contextManifestIdentity =
    currentContext?.manifestIdentity ?? `sha256:${"0".repeat(64)}`;
  const replanned = transitionWorkflow(state, {
    contractVersion: 1,
    taskId: state.projection.id,
    expectedVersion: state.projection.version,
    to: { lifecycle: "active", phase: "plan", step: "ready" },
    gates: [
      {
        gate: "replan",
        evidence: [
          {
            kind: "workflow",
            reference: `context/implement.jsonl#${contextManifestIdentity}`,
          },
        ],
      },
    ],
    event: {
      eventId: `EVENT-${state.projection.id}-CONTEXT-DRIFT-${state.projection.version + 1}`,
      actor: {
        kind: "system",
        id: "sayhi-core",
        sessionRef: "context-drift",
      },
      reason: "Implement Context drift requires Build replanning.",
      idempotencyKey: `CONTEXT-DRIFT-${state.projection.id}-${state.projection.version}`,
      occurredAt: new Date().toISOString(),
    },
  });
  if (!replanned.ok) {
    return failure(replanned.diagnostics);
  }
  try {
    await fileSystem.appendFile(paths.eventsPath, serializeEvent(replanned.event));
    await writeProjectionIfChanged(
      fileSystem,
      paths.projectionPath,
      replanned.state.projection,
    );
  } catch {
    return ioFailure(paths.eventsPath);
  }
  return buildPlanContextFailure(context);
}


async function advanceDurableTaskLocked(
  request: AdvanceDurableTaskRequest,
  paths: TaskPaths,
): Promise<AdvanceDurableTaskResult> {
  const loaded = await loadTask(request.fileSystem, request.transition.taskId);
  if (!loaded.ok) {
    return loaded;
  }
  if (isBuildPlanTransition(loaded.state, request.transition)) {
    return buildPlanApprovalRequired();
  }
  const transitioned = transitionWorkflow(loaded.state, request.transition);
  if (!transitioned.ok) {
    return failure(transitioned.diagnostics);
  }
  if (transitioned.state.events.length === loaded.state.events.length) {
    return Object.freeze({
      ok: true,
      contractVersion: TASK_LIFECYCLE_CONTRACT_VERSION,
      state: transitioned.state,
      event: transitioned.event,
      appended: false,
    });
  }
  const resealed = await resealBuildImplementationAfterContextDrift(
    request.fileSystem,
    paths,
    loaded.state,
  );
  if (resealed !== null) {
    return resealed;
  }
  const graph = transitioned.event.initiativeGraph;
  let activePath = loaded.eventsPath;
  try {
    if (graph !== null) {
      activePath = paths.graphPath;
      const preflight = await preflightInitiativeGraphRecord(
        request.fileSystem,
        paths,
        loaded.state,
        graph,
      );
      if (preflight !== null) {
        return preflight;
      }
    }
    const appended = transitioned.state.events.length > loaded.state.events.length;
    activePath = loaded.eventsPath;
    if (appended) {
      await request.fileSystem.appendFile(
        loaded.eventsPath,
        serializeEvent(transitioned.event),
      );
    }
    if (graph !== null) {
      activePath = paths.graphPath;
      await writeInitiativeGraphIfChanged(
        request.fileSystem,
        paths.graphPath,
        graph,
      );
    }
    activePath = loaded.projectionPath;
    await writeProjectionIfChanged(
      request.fileSystem,
      loaded.projectionPath,
      transitioned.state.projection,
    );
    return Object.freeze({
      ok: true,
      contractVersion: TASK_LIFECYCLE_CONTRACT_VERSION,
      state: transitioned.state,
      event: transitioned.event,
      appended,
    });
  } catch {
    return ioFailure(activePath);
  }
}

async function escalateDurableQuickToBuildLocked(
  request: EscalateDurableQuickToBuildRequest,
  paths: TaskPaths,
): Promise<EscalateDurableQuickToBuildResult> {
  const loaded = await loadTask(request.fileSystem, request.escalation.taskId);
  if (!loaded.ok) {
    return loaded;
  }
  const escalated = escalateQuickToBuild(loaded.state, request.escalation);
  if (!escalated.ok) {
    return failure(escalated.diagnostics);
  }
  const appended = escalated.state.events.length > loaded.state.events.length;
  let activePath = loaded.eventsPath;
  try {
    if (appended) {
      await request.fileSystem.appendFile(
        loaded.eventsPath,
        serializeEvent(escalated.event),
      );
    }
    activePath = loaded.projectionPath;
    await writeProjectionIfChanged(
      request.fileSystem,
      loaded.projectionPath,
      escalated.state.projection,
    );
    return Object.freeze({
      ok: true,
      contractVersion: TASK_LIFECYCLE_CONTRACT_VERSION,
      state: escalated.state,
      event: escalated.event,
      appended,
    });
  } catch {
    return ioFailure(activePath);
  }
}

async function recoverDurableTaskLocked(
  request: RecoverDurableTaskRequest,
  paths: TaskPaths,
): Promise<RecoverDurableTaskResult> {
  const loaded = await loadTask(request.fileSystem, request.taskId);
  if (!loaded.ok) {
    return loaded;
  }
  let activePath = loaded.projectionPath;
  try {
    const projectionRecovered = await writeProjectionIfChanged(
      request.fileSystem,
      loaded.projectionPath,
      loaded.state.projection,
    );
    const graph = latestInitiativeGraph(loaded.state);
    let graphRecovered = false;
    if (graph !== null) {
      activePath = paths.graphPath;
      graphRecovered = await writeInitiativeGraphIfChanged(
        request.fileSystem,
        paths.graphPath,
        graph,
      );
    }
    activePath = paths.handoffPath;
    const handoff = await loadDurableTaskHandoff(
      request.fileSystem,
      paths.handoffPath,
      loaded.state,
    );
    if (!handoff.ok) {
      return handoff;
    }
    return Object.freeze({
      ok: true,
      contractVersion: TASK_LIFECYCLE_CONTRACT_VERSION,
      state: loaded.state,
      recovered: projectionRecovered || graphRecovered,
      handoff: handoff.value,
    });
  } catch {
    return ioFailure(activePath);
  }
}

async function createDurableTaskHandoffLocked(
  request: CreateDurableTaskHandoffRequest,
  paths: TaskPaths,
): Promise<CreateDurableTaskHandoffResult> {
  const loaded = await loadTask(request.fileSystem, request.taskId);
  if (!loaded.ok) {
    return loaded;
  }
  if (loaded.state.projection.version !== request.expectedVersion) {
    return failure([
      diagnostic(
        "workflow.version.stale",
        "$.expectedVersion",
        "The durable Task changed before its Handoff could be recorded.",
        "Reload the current Projection and retry with its version.",
      ),
    ]);
  }
  const invalid = validateHandoffInput(request);
  if (invalid !== null) {
    return invalid;
  }
  const handoff = Object.freeze({
    schemaVersion: 1 as const,
    taskId: loaded.state.projection.id,
    phase: loaded.state.projection.phase,
    step: loaded.state.projection.step,
    projectionVersion: loaded.state.projection.version,
    blockers: Object.freeze([...loaded.state.projection.blockers]),
    repositoryFingerprint: request.repositoryFingerprint,
    artifactReferences: Object.freeze([...request.artifactReferences]),
    createdAt: request.createdAt,
  });
  try {
    await request.fileSystem.writeFile(paths.handoffPath, serializeHandoff(handoff));
    return Object.freeze({
      ok: true,
      contractVersion: TASK_LIFECYCLE_CONTRACT_VERSION,
      handoff,
    });
  } catch {
    return ioFailure(paths.handoffPath);
  }
}

async function archiveDurableTaskLocked(
  request: ArchiveDurableTaskRequest,
  paths: TaskPaths,
): Promise<ArchiveDurableTaskResult> {
  if (
    request.transition.to.lifecycle !== "archived" ||
    request.transition.to.phase !== "finish"
  ) {
    return invalidTaskArchive(
      "$.transition.to",
      "Durable Task archiving only accepts the archived Finish transition.",
      "Use the completed Finish state and the archive transition before moving a Task.",
    );
  }

  let failurePath = TASK_ARCHIVE_DIRECTORY;
  try {
    const archiveRoot = await request.fileSystem.inspect(TASK_ARCHIVE_DIRECTORY);
    if (archiveRoot.kind !== "directory") {
      return invalidTaskArchive(
        TASK_ARCHIVE_DIRECTORY,
        "The durable Task archive location is missing or unsafe.",
        "Restore .sayhi/tasks/archive as a directory before retrying.",
      );
    }

    failurePath = paths.archiveTaskDirectory;
    const archivedDirectory = await request.fileSystem.inspect(
      paths.archiveTaskDirectory,
    );
    if (archivedDirectory.kind !== "missing") {
      if (archivedDirectory.kind !== "directory") {
        return invalidTaskArchive(
          paths.archiveTaskDirectory,
          "The archived Task location is not a real directory.",
          "Restore the archived Task directory before retrying.",
        );
      }
      const activeDirectory = await request.fileSystem.inspect(paths.taskDirectory);
      if (activeDirectory.kind !== "missing") {
        return invalidTaskArchive(
          paths.taskDirectory,
          "Active and archived Task directories both exist for this Task.",
          "Preserve both directories and resolve the duplicate Task state before retrying.",
        );
      }
      const archived = await loadTask(
        request.fileSystem,
        request.transition.taskId,
        paths.archiveTaskDirectory,
      );
      if (!archived.ok) {
        return archived;
      }
      if (archived.state.projection.lifecycle !== "archived") {
        return invalidTaskArchive(
          paths.archiveTaskDirectory,
          "The archived Task directory does not contain an archived Task.",
          "Restore the directory to the active Project Store Task path before retrying.",
        );
      }
      const repeated = validateRepeatedArchiveTransition(
        archived.state,
        request.transition,
      );
      if (!repeated.ok) {
        return repeated;
      }
      return Object.freeze({
        ok: true,
        contractVersion: TASK_LIFECYCLE_CONTRACT_VERSION,
        state: archived.state,
        moved: repeated.matchesAcceptedEvent,
      });
    }

    const loaded = await loadTask(request.fileSystem, request.transition.taskId);
    if (!loaded.ok) {
      return loaded;
    }
    let state = loaded.state;
    if (state.projection.lifecycle === "archived") {
      const repeated = validateRepeatedArchiveTransition(state, request.transition);
      if (!repeated.ok) {
        return repeated;
      }
      failurePath = loaded.projectionPath;
      await writeProjectionIfChanged(
        request.fileSystem,
        loaded.projectionPath,
        state.projection,
      );
    } else {
      const transitioned = transitionWorkflow(state, request.transition);
      if (!transitioned.ok) {
        return failure(transitioned.diagnostics);
      }
      failurePath = loaded.eventsPath;
      await request.fileSystem.appendFile(
        loaded.eventsPath,
        serializeEvent(transitioned.event),
      );
      state = transitioned.state;
      failurePath = loaded.projectionPath;
      await writeProjectionIfChanged(
        request.fileSystem,
        loaded.projectionPath,
        state.projection,
      );
    }

    failurePath = paths.taskDirectory;
    await request.fileSystem.moveDirectory(
      paths.taskDirectory,
      paths.archiveTaskDirectory,
    );
    return Object.freeze({
      ok: true,
      contractVersion: TASK_LIFECYCLE_CONTRACT_VERSION,
      state,
      moved: true,
    });
  } catch {
    return ioFailure(failurePath);
  }
}

function validateRepeatedArchiveTransition(
  state: WorkflowState,
  transition: TransitionWorkflowRequest,
):
  | Readonly<{ ok: true; matchesAcceptedEvent: boolean }>
  | TaskLifecycleFailure {
  if (
    !state.events.some(
      (event) => event.idempotencyKey === transition.event.idempotencyKey,
    )
  ) {
    return Object.freeze({ ok: true, matchesAcceptedEvent: false });
  }
  const retried = transitionWorkflow(state, transition);
  return retried.ok
    ? Object.freeze({ ok: true, matchesAcceptedEvent: true })
    : failure(retried.diagnostics);
}

async function adoptDurableTaskBaselineLocked(
  request: AdoptDurableTaskBaselineRequest,
  paths: TaskPaths,
): Promise<AdoptDurableTaskBaselineResult> {
  const loaded = await loadTask(request.fileSystem, request.taskId);
  if (!loaded.ok) {
    return loaded;
  }
  const baseline = validateBaselineRecord(request.baseline);
  if (!baseline.ok) {
    return baseline;
  }
  const baselineIdentity = hashCanonicalJson(baselineMaterial(baseline.baseline));
  const baselineCheck = await revalidateTaskBaseline(
    request.fileSystem,
    request.taskId,
    paths,
    loaded.state.projection.scope,
    baseline.baseline,
  );
  if (baselineCheck !== null) {
    return baselineCheck;
  }
  const existingAdoption = latestBaselineAdoption(loaded.state);
  if (
    existingAdoption !== null &&
    existingAdoption.baselineIdentity === baselineIdentity &&
    stableJson(existingAdoption.adopted) === stableJson(baseline.baseline.dirtyPaths)
  ) {
    return Object.freeze({
      ok: true,
      contractVersion: TASK_LIFECYCLE_CONTRACT_VERSION,
      state: loaded.state,
      event: existingAdoption,
      appended: false,
    });
  }


  const adopted = adoptWorkflowBaseline(loaded.state, {
    contractVersion: 1,
    taskId: request.taskId,
    expectedVersion: request.expectedVersion,
    baselineIdentity,
    adopted: baseline.baseline.dirtyPaths,
    event: request.event,
  });
  if (!adopted.ok) {
    return failure(adopted.diagnostics);
  }
  const baselinePath = taskBaselinePath(
    paths,
    loaded.state.projection.baselineRef,
  );
  const appended = adopted.state.events.length > loaded.state.events.length;
  let activePath = loaded.eventsPath;
  try {
    if (appended) {
      await request.fileSystem.appendFile(
        loaded.eventsPath,
        serializeEvent(adopted.event),
      );
    }
    activePath = baselinePath;
    await request.fileSystem.writeFile(
      baselinePath,
      `${JSON.stringify(baseline.baseline, null, 2)}\n`,
    );
    activePath = loaded.projectionPath;
    await writeProjectionIfChanged(
      request.fileSystem,
      loaded.projectionPath,
      adopted.state.projection,
    );
    return Object.freeze({
      ok: true,
      contractVersion: TASK_LIFECYCLE_CONTRACT_VERSION,
      state: adopted.state,
      event: adopted.event,
      appended,
    });
  } catch {
    return ioFailure(activePath);
  }
}

async function withDurableTaskWriterLocked<Value>(
  request: WithDurableTaskWriterRequest<Value>,
  paths: TaskPaths,
  writer: TaskWriter,
): Promise<WithDurableTaskWriterResult<Value>> {
  const loaded = await loadTask(request.fileSystem, request.taskId);
  if (!loaded.ok) {
    return loaded;
  }
  if (request.expectedVersion !== loaded.state.projection.version) {
    return failure([
      diagnostic(
        "workflow.version.stale",
        "$.expectedVersion",
        `Expected Task version ${request.expectedVersion} does not match current version ${loaded.state.projection.version}.`,
        "Reload the current Task before requesting the Writer.",
      ),
    ]);
  }
  if (loaded.state.projection.route === "build") {
    if (
      loaded.state.projection.lifecycle !== "active" ||
      loaded.state.projection.phase !== "implement"
    ) {
      return buildPlanApprovalRequired();
    }
    const resealed = await resealBuildImplementationAfterContextDrift(
      request.fileSystem,
      paths,
      loaded.state,
    );
    if (resealed !== null) {
      return resealed;
    }
  }
  const baselinePath = taskBaselinePath(
    paths,
    loaded.state.projection.baselineRef,
  );
  const baseline = await loadTaskBaseline(request.fileSystem, baselinePath);
  if (!baseline.ok) {
    return baseline;
  }
  const adoption = latestBaselineAdoption(loaded.state);
  if (adoption === null) {
    return missingBaseline();
  }
  if (
    adoption.baselineIdentity !== hashCanonicalJson(baselineMaterial(baseline.baseline)) ||
    stableJson(adoption.adopted) !== stableJson(baseline.baseline.dirtyPaths)
  ) {
    return baselineInvalid(
      baselinePath,
      "Baseline file does not match its accepted adoption Event.",
      "Restore the Event-bound Baseline before requesting the Writer.",
    );
  }
  const baselineCheck = await revalidateTaskBaseline(
    request.fileSystem,
    request.taskId,
    paths,
    loaded.state.projection.scope,
    baseline.baseline,
  );
  if (baselineCheck !== null) {
    return baselineCheck;
  }
  try {
    const value = await request.operation(
      new ScopedTaskWriterAdapter(writer, loaded.state.projection.scope),
    );
    const finalBaseline = await captureCurrentTaskBaseline(
      request.fileSystem,
      request.taskId,
      paths,
      loaded.state.projection.scope,
      baseline.baseline.adoptedPaths,
    );
    if (!finalBaseline.ok) {
      return finalBaseline;
    }
    return Object.freeze({
      ok: true,
      contractVersion: TASK_LIFECYCLE_CONTRACT_VERSION,
      value,
      finalBaseline: finalBaseline.baseline,
      changedPaths: changedBaselinePaths(
        baseline.baseline,
        finalBaseline.baseline,
      ),
    });
  } catch (error) {
    return error instanceof TaskWriterScopeError
      ? writerScopeFailure(error.path)
      : ioFailure(paths.taskDirectory);
  }
}

type PreparedDurableQuickResult = Readonly<{
  loaded: Extract<LoadTaskResult, Readonly<{ ok: true }>>;
  result: Readonly<
    Pick<
      DurableQuickResult,
      "schemaVersion" | "baselineBefore" | "baselineAfter" | "changedPaths" | "commit"
    >
  >;
}>;

async function prepareDurableQuickResult(
  request: RecordDurableQuickResultRequest,
  paths: TaskPaths,
  allowIdempotentCompletionRetry = false,
): Promise<
  | Readonly<{ ok: true; value: PreparedDurableQuickResult }>
  | TaskLifecycleFailure
> {
  const loaded = await loadTask(request.fileSystem, request.taskId);
  if (!loaded.ok) {
    return loaded;
  }
  if (
    !allowIdempotentCompletionRetry &&
    loaded.state.projection.version !== request.expectedVersion
  ) {
    return failure([
      diagnostic(
        "workflow.version.stale",
        "$.expectedVersion",
        "The durable Quick changed before its result could be recorded.",
        "Reload the current Quick Projection and retry completion.",
      ),
    ]);
  }
  if (loaded.state.projection.route !== "quick") {
    return quickResultInvalid(
      paths.quickResultPath,
      "Only Quick Tasks can record a Quick result.",
      "Use the Task lifecycle record for Build and Initiative results.",
    );
  }
  const baselinePath = taskBaselinePath(paths, loaded.state.projection.baselineRef);
  const baselineBefore = await loadTaskBaseline(request.fileSystem, baselinePath);
  if (!baselineBefore.ok) {
    return baselineBefore;
  }
  if (
    stableJson(baselineBefore.baseline.declaredScope) !==
      stableJson(loaded.state.projection.scope) ||
    !hasExactAdoption(baselineBefore.baseline) ||
    latestBaselineAdoption(loaded.state) === null
  ) {
    return quickResultInvalid(
      baselinePath,
      "Quick result recording requires an adopted Baseline for the declared scope.",
      "Capture and adopt the current Baseline before recording the changed Quick result.",
    );
  }
  const baselineAfter = validateBaselineRecord(request.baselineAfter, "$.baselineAfter");
  if (!baselineAfter.ok) {
    return baselineAfter;
  }
  if (
    stableJson(baselineAfter.baseline.declaredScope) !==
      stableJson(loaded.state.projection.scope) ||
    stableJson(baselineAfter.baseline.adoptedPaths) !==
      stableJson(baselineBefore.baseline.adoptedPaths)
  ) {
    return quickResultInvalid(
      "$.baselineAfter",
      "Quick result Baseline does not match the durable Quick scope.",
      "Record the Writer's final Baseline for this Quick without modifying its adopted paths.",
    );
  }
  const changedPaths = changedBaselinePaths(
    baselineBefore.baseline,
    baselineAfter.baseline,
  );
  if (
    changedPaths.length === 0 ||
    !sameStrings(request.changedPaths, changedPaths) ||
    !changedPaths.every((path) =>
      isWritableTaskPath(path, loaded.state.projection.scope.files),
    )
  ) {
    return quickResultInvalid(
      "$.changedPaths",
      "Quick result paths must be the non-empty scoped diff between its Baselines.",
      "Record the exact paths changed through the approved Quick Writer.",
    );
  }
  const current = await captureCurrentTaskBaseline(
    request.fileSystem,
    request.taskId,
    paths,
    loaded.state.projection.scope,
    baselineBefore.baseline.adoptedPaths,
  );
  if (!current.ok) {
    return current;
  }
  if (!sameBaselineMaterial(baselineAfter.baseline, current.baseline)) {
    return baselineDrift();
  }
  return Object.freeze({
    ok: true,
    value: Object.freeze({
      loaded,
      result: Object.freeze({
        schemaVersion: 1 as const,
        baselineBefore: baselineBefore.baseline,
        baselineAfter: baselineAfter.baseline,
        changedPaths,
        commit: null,
      }),
    }),
  });
}

async function recordDurableQuickResultLocked(
  request: RecordDurableQuickResultRequest,
  paths: TaskPaths,
): Promise<RecordDurableQuickResultResult> {
  const prepared = await prepareDurableQuickResult(request, paths);
  if (!prepared.ok) {
    return prepared;
  }
  if (
    prepared.value.loaded.state.projection.lifecycle !== "completed" ||
    prepared.value.loaded.state.projection.phase !== "finish"
  ) {
    return quickResultInvalid(
      paths.quickResultPath,
      "Quick results can be recorded only after the completed Finish transition.",
      "Complete the Quick through Finish before recording its durable result.",
    );
  }
  const result = Object.freeze({
    ...prepared.value.result,
    taskId: prepared.value.loaded.state.projection.id,
    projectionVersion: prepared.value.loaded.state.projection.version,
    workflow: prepared.value.loaded.state,
  });
  try {
    await request.fileSystem.writeFile(
      paths.quickResultPath,
      serializeDurableQuickResult(result),
    );
    return Object.freeze({
      ok: true,
      contractVersion: TASK_LIFECYCLE_CONTRACT_VERSION,
      result,
    });
  } catch {
    return ioFailure(paths.quickResultPath);
  }
}

async function completeDurableQuickResultLocked(
  request: CompleteDurableQuickResultRequest,
  paths: TaskPaths,
): Promise<CompleteDurableQuickResultResult> {
  if (
    request.transition.taskId !== request.taskId ||
    request.transition.expectedVersion !== request.expectedVersion ||
    request.transition.to.lifecycle !== "completed" ||
    request.transition.to.phase !== "finish"
  ) {
    return quickResultInvalid(
      "$.transition",
      "Quick completion requires the current completed Finish transition.",
      "Provide the accepted completed/finish transition for this Quick version.",
    );
  }
  const prepared = await prepareDurableQuickResult(request, paths, true);
  if (!prepared.ok) {
    return prepared;
  }
  const transitioned = transitionWorkflow(
    prepared.value.loaded.state,
    request.transition,
  );
  if (!transitioned.ok) {
    return failure(transitioned.diagnostics);
  }
  const result = Object.freeze({
    ...prepared.value.result,
    taskId: transitioned.state.projection.id,
    projectionVersion: transitioned.state.projection.version,
    workflow: transitioned.state,
  });
  const appended =
    transitioned.state.events.length > prepared.value.loaded.state.events.length;
  let activePath = prepared.value.loaded.eventsPath;
  try {
    if (appended) {
      await request.fileSystem.appendFile(
        prepared.value.loaded.eventsPath,
        serializeEvent(transitioned.event),
      );
    }
    activePath = prepared.value.loaded.projectionPath;
    await writeProjectionIfChanged(
      request.fileSystem,
      prepared.value.loaded.projectionPath,
      transitioned.state.projection,
    );
    activePath = paths.quickResultPath;
    await request.fileSystem.writeFile(
      paths.quickResultPath,
      serializeDurableQuickResult(result),
    );
    return Object.freeze({
      ok: true,
      contractVersion: TASK_LIFECYCLE_CONTRACT_VERSION,
      state: transitioned.state,
      event: transitioned.event,
      result,
    });
  } catch {
    return ioFailure(activePath);
  }
}
async function runWithTaskLock<Result>(
  fileSystem: TaskLifecycleFileSystem,
  lockPath: string,
  operation: () => Promise<Result>,
): Promise<Result | TaskLifecycleFailure> {
  try {
    return await fileSystem.withTaskMutationLock(lockPath, operation);
  } catch {
    return ioFailure(lockPath);
  }
}

function diagnosisFailure(
  diagnostics: readonly TaskLifecycleDiagnostic[],
): DiagnoseDurableTasksResult {
  return Object.freeze({
    ok: false,
    contractVersion: TASK_LIFECYCLE_CONTRACT_VERSION,
    state: "corrupt",
    diagnostics: Object.freeze([...diagnostics]),
  });
}

function ioDiagnostic(path: string): TaskLifecycleDiagnostic {
  return diagnostic(
    "task_lifecycle.io_failed",
    path,
    "The durable Task operation could not complete its filesystem access.",
    "Inspect the Project Store path and permissions, then retry diagnosis.",
  );
}
function contextLifecycleFailure(
  code: Extract<
    TaskLifecycleDiagnosticCode,
    | "context_manifest.missing"
    | "context_manifest.invalid"
    | "context_manifest.source.unreadable"
    | "context_manifest.source.duplicate"
    | "context_manifest.approval_required"
    | "context_manifest.entry.missing"
    | "context_manifest.stale"
  >,
  path: string,
  message: string,
  remediation: string,
): TaskLifecycleFailure {
  return failure([diagnostic(code, path, message, remediation)]);
}

function contextManifestDiagnostic(
  path: string,
  message: string,
  remediation: string,
): ContextManifestDiagnostic {
  return Object.freeze({ path, message, remediation });
}

function missingContextManifest(path: string): InspectDurableContextManifestResult {
  return Object.freeze({
    ok: false,
    contractVersion: TASK_LIFECYCLE_CONTRACT_VERSION,
    state: "missing",
    diagnostics: Object.freeze([
      contextManifestDiagnostic(
        path,
        "Context Manifest is missing.",
        "Add or restore the Context Manifest for this Task Phase.",
      ),
    ]),
  });
}

function invalidContextManifest(
  diagnostics: readonly ContextManifestDiagnostic[],
): InspectDurableContextManifestResult {
  return Object.freeze({
    ok: false,
    contractVersion: TASK_LIFECYCLE_CONTRACT_VERSION,
    state: "invalid",
    diagnostics: Object.freeze([...diagnostics]),
  });
}


async function loadTask(
  fileSystem: TaskLifecycleFileSystem,
  taskId: string,
  taskDirectory?: string,
): Promise<LoadTaskResult> {
  const paths = taskPaths(taskId);
  if (!paths.ok) {
    return paths;
  }
  const directoryPath = taskDirectory ?? paths.taskDirectory;
  const eventsPath = `${directoryPath}/events.jsonl`;
  const projectionPath = `${directoryPath}/task.json`;
  try {
    const taskDirectoryEntry = await fileSystem.inspect(directoryPath);
    if (taskDirectoryEntry.kind !== "directory") {
      return failure([
        diagnostic(
          "task_lifecycle.history.missing",
          directoryPath,
          "The durable Task directory is missing or unsafe.",
          "Restore the Task directory from the repository before retrying.",
        ),
      ]);
    }
    const eventsFile = await fileSystem.inspect(eventsPath);
    if (eventsFile.kind !== "file") {
      return failure([
        diagnostic(
          "task_lifecycle.history.missing",
          eventsPath,
          "The durable Workflow Event history is missing or unsafe.",
          "Restore the append-only events.jsonl file before retrying.",
        ),
      ]);
    }

    const parsed = parseEventHistory(
      eventsPath,
      await fileSystem.readFile(eventsPath),
    );
    if (!parsed.ok) {
      return parsed;
    }
    const replayed = replayWorkflowEvents(parsed.events);
    if (!replayed.ok) {
      return failure(
        replayed.diagnostics.map((item) =>
          prefixWorkflowDiagnostic(eventsPath, item),
        ),
      );
    }
    if (replayed.state.projection.id !== taskId) {
      return failure([
        diagnostic(
          "workflow.task.mismatch",
          `${eventsPath}$[0].taskId`,
          "Workflow Event history belongs to a different durable Task.",
          "Restore the Event history accepted for the requested Task id.",
        ),
      ]);
    }

    return Object.freeze({
      ok: true,
      state: replayed.state,
      eventsPath,
      projectionPath,
    });
  } catch {
    return ioFailure(eventsPath);
  }
}

function parseEventHistory(
  path: string,
  content: string,
): Readonly<{ ok: true; events: readonly unknown[] }> | TaskLifecycleFailure {
  const events: unknown[] = [];
  const lines = content.split("\n");
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index]!;
    if (line.trim().length === 0) {
      continue;
    }
    let value: unknown;
    try {
      value = JSON.parse(line);
    } catch {
      return failure([
        diagnostic(
          "task_lifecycle.history.invalid",
          `${path}:${index + 1}`,
          "Workflow Event history contains an incomplete or invalid JSON record.",
          "Restore the complete immutable Event line before retrying.",
        ),
      ]);
    }
    if (typeof value !== "object" || value === null || Array.isArray(value)) {
      return failure([
        diagnostic(
          "task_lifecycle.history.invalid",
          `${path}:${index + 1}`,
          "Workflow Event history line is not a JSON object.",
          "Restore a complete Workflow Event object on this line.",
        ),
      ]);
    }
    events.push(value);
  }
  return Object.freeze({ ok: true, events: Object.freeze(events) });
}

async function writeProjectionIfChanged(
  fileSystem: TaskLifecycleFileSystem,
  path: string,
  projection: TaskProjection,
): Promise<boolean> {
  return writeSnapshotIfChanged(fileSystem, path, serializeProjection(projection));
}

async function writeSnapshotIfChanged(
  fileSystem: TaskLifecycleFileSystem,
  path: string,
  expected: string,
): Promise<boolean> {
  const current = await fileSystem.inspect(path);
  if (current.kind === "file" && (await fileSystem.readFile(path)) === expected) {
    return false;
  }
  await fileSystem.writeFile(path, expected);
  return true;
}

type ValidatedBaselineResult =
  | Readonly<{
      ok: true;
      baseline: BaselineRecord;
      identity: `sha256:${string}`;
    }>
  | TaskLifecycleFailure;

async function loadTaskBaseline(
  fileSystem: TaskLifecycleFileSystem,
  path: string,
): Promise<ValidatedBaselineResult> {
  try {
    const entry = await fileSystem.inspect(path);
    if (entry.kind === "missing") {
      return missingBaseline();
    }
    if (entry.kind !== "file") {
      return baselineInvalid(
        path,
        "Baseline path is not a regular file.",
        "Restore the accepted Baseline JSON file before requesting the Writer.",
      );
    }
    let record: unknown;
    try {
      record = JSON.parse(await fileSystem.readFile(path));
    } catch {
      return baselineInvalid(
        path,
        "Baseline file is not valid JSON.",
        "Restore the accepted Baseline JSON file before requesting the Writer.",
      );
    }
    return validateBaselineRecord(record, path);
  } catch {
    return ioFailure(path);
  }
}
async function loadDurableQuickResult(
  fileSystem: TaskLifecycleFileSystem,
  path: string,
  state: WorkflowState,
): Promise<
  | Readonly<{ ok: true; value: DurableQuickResult }>
  | TaskLifecycleFailure
> {
  try {
    const entry = await fileSystem.inspect(path);
    if (entry.kind === "missing") {
      return quickResultMissing(path);
    }
    if (entry.kind !== "file") {
      return quickResultInvalid(
        path,
        "The durable Quick result is missing or unsafe.",
        "Restore quick.json as a regular file before retrying.",
      );
    }
    let value: unknown;
    try {
      value = JSON.parse(await fileSystem.readFile(path));
    } catch {
      return quickResultInvalid(
        path,
        "The durable Quick result is not valid JSON.",
        "Restore a complete quick.json file before retrying.",
      );
    }
    if (!isQuickResultRecord(value)) {
      return quickResultInvalid(
        path,
        "The durable Quick result is structurally invalid.",
        "Restore the Quick result recorded by Core before retrying.",
      );
    }
    if (
      value.schemaVersion !== 1 ||
      typeof value.taskId !== "string" ||
      typeof value.projectionVersion !== "number" ||
      !Array.isArray(value.changedPaths) ||
      value.commit !== null ||
      !("baselineBefore" in value) ||
      !("baselineAfter" in value) ||
      !("workflow" in value)
    ) {
      return quickResultInvalid(
        path,
        "The durable Quick result is structurally invalid.",
        "Restore the complete Quick result recorded by Core before retrying.",
      );
    }
    const baselineBefore = validateBaselineRecord(value.baselineBefore, `${path}.baselineBefore`);
    if (!baselineBefore.ok) {
      return baselineBefore;
    }
    const baselineAfter = validateBaselineRecord(value.baselineAfter, `${path}.baselineAfter`);
    if (!baselineAfter.ok) {
      return baselineAfter;
    }
    const changedPaths = changedBaselinePaths(
      baselineBefore.baseline,
      baselineAfter.baseline,
    );
    const projectionVersion =
      typeof value.projectionVersion === "number" ? value.projectionVersion : null;
    const workflow = replayQuickResultWorkflow(value.workflow, path, state);
    if (!workflow.ok) {
      return workflow;
    }
    if (
      value.schemaVersion !== 1 ||
      value.taskId !== state.projection.id ||
      projectionVersion === null ||
      !Number.isSafeInteger(projectionVersion) ||
      projectionVersion < 1 ||
      projectionVersion > state.projection.version ||
      workflow.state.projection.version !== projectionVersion ||
      value.commit !== null ||
      changedPaths.length === 0 ||
      !sameStrings(value.changedPaths, changedPaths) ||
      !changedPaths.every((path) =>
        isWritableTaskPath(path, state.projection.scope.files),
      )
    ) {
      return quickResultInvalid(
        path,
        "The durable Quick result does not match its Quick Task.",
        "Restore the Quick result recorded for this Task and its accepted scope.",
      );
    }
    return Object.freeze({
      ok: true,
      value: Object.freeze({
        schemaVersion: 1 as const,
        taskId: state.projection.id,
        projectionVersion,
        workflow: workflow.state,
        baselineBefore: baselineBefore.baseline,
        baselineAfter: baselineAfter.baseline,
        changedPaths: Object.freeze([...changedPaths]),
        commit: null,
      }),
    });
  } catch {
    return ioFailure(path);
  }
}
function replayQuickResultWorkflow(
  value: unknown,
  path: string,
  current: WorkflowState,
): Readonly<{ ok: true; state: WorkflowState }> | TaskLifecycleFailure {
  if (!isQuickResultRecord(value) || !Array.isArray(value.events)) {
    return quickResultInvalid(
      `${path}.workflow`,
      "The durable Quick result is missing its workflow audit.",
      "Restore the workflow Projection and Events recorded for this Quick.",
    );
  }
  const replayed = replayWorkflowEvents(value.events);
  if (!replayed.ok) {
    return quickResultInvalid(
      `${path}.workflow.events`,
      "The durable Quick workflow audit cannot be replayed.",
      "Restore the accepted Quick Events before retrying.",
    );
  }
  if (
    replayed.state.projection.lifecycle !== "completed" ||
    replayed.state.projection.phase !== "finish" ||
    replayed.state.projection.id !== current.projection.id ||
    !isWorkflowEventPrefix(replayed.state.events, current.events)
  ) {
    return quickResultInvalid(
      `${path}.workflow`,
      "The durable Quick workflow audit does not belong to this Task history.",
      "Restore the workflow snapshot recorded from this Quick Task.",
    );
  }
  return Object.freeze({ ok: true, state: replayed.state });
}

function validateBaselineRecord(
  record: unknown,
  path = "$.baseline",
): ValidatedBaselineResult {
  const validation = validateContractRecord({
    contractVersion: RECORD_CONTRACT_VERSION,
    kind: "baseline",
    record,
  });
  if (!validation.ok || validation.kind !== "baseline") {
    return baselineInvalid(
      path,
      "Baseline record is invalid.",
      "Capture a schema-valid Baseline before requesting a Writer.",
    );
  }
  return Object.freeze({
    ok: true,
    baseline: validation.record as BaselineRecord,
    identity: validation.identity,
  });
}

function taskBaselinePath(paths: TaskPaths, baselineRef: string): string {
  return `${paths.taskDirectory}/${baselineRef}`;
}

function latestBaselineAdoption(
  state: WorkflowState,
): BaselineAdoptedEvent | null {
  for (let index = state.events.length - 1; index >= 0; index -= 1) {
    const event = state.events[index]!;
    if (event.type === "baseline_adopted") {
      return event;
    }
  }
  return null;
}

function sameBaselineMaterial(
  expected: BaselineRecord,
  observed: BaselineRecord,
): boolean {
  return (
    stableJson(baselineMaterial(expected)) ===
    stableJson(baselineMaterial(observed))
  );
}

function baselineMaterial(baseline: BaselineRecord): Record<string, unknown> {
  return {
    schemaVersion: baseline.schemaVersion,
    repositoryRootIdentity: baseline.repositoryRootIdentity,
    head: baseline.head,
    indexDigest: baseline.indexDigest,
    trackedWorktreeDigest: baseline.trackedWorktreeDigest,
    untracked: baseline.untracked,
    submodulesDigest: baseline.submodulesDigest,
    dirtyPaths: baseline.dirtyPaths,
    adoptedPaths: baseline.adoptedPaths,
    declaredScope: baseline.declaredScope,
  };
}

function hasExactAdoption(baseline: BaselineRecord): boolean {
  if (baseline.adoptedPaths.length !== baseline.dirtyPaths.length) {
    return false;
  }
  const adoptedPaths = new Set(baseline.adoptedPaths);
  return (
    adoptedPaths.size === baseline.dirtyPaths.length &&
    baseline.dirtyPaths.every((change) => adoptedPaths.has(change.path))
  );
}

async function captureCurrentTaskBaseline(
  fileSystem: TaskBaselineFileSystem,
  taskId: string,
  paths: TaskPaths,
  scope: TaskScope,
  adoptedPaths: readonly string[],
): Promise<ValidatedBaselineResult> {
  try {
    const captured = await fileSystem.captureBaseline({
      taskId,
      declaredScope: scope,
      adoptedPaths,
    });
    return validateBaselineRecord(captured);
  } catch {
    return ioFailure(paths.taskDirectory);
  }
}

async function revalidateTaskBaseline(
  fileSystem: TaskBaselineFileSystem,
  taskId: string,
  paths: TaskPaths,
  scope: TaskScope,
  baseline: BaselineRecord,
): Promise<TaskLifecycleFailure | null> {
  if (stableJson(baseline.declaredScope) !== stableJson(scope)) {
    return baselineInvalid(
      "$.baseline.declaredScope",
      "Baseline scope does not match the durable Task scope.",
      "Capture a Baseline for this Task's declared scope before requesting the Writer.",
    );
  }
  if (!hasExactAdoption(baseline)) {
    return adoptionRequired();
  }
  const current = await captureCurrentTaskBaseline(
    fileSystem,
    taskId,
    paths,
    scope,
    baseline.adoptedPaths,
  );
  if (!current.ok) {
    return current;
  }
  return sameBaselineMaterial(baseline, current.baseline)
    ? null
    : baselineDrift();
}


function changedBaselinePaths(
  initial: BaselineRecord,
  final: BaselineRecord,
): readonly string[] {
  const initialIdentities = new Map(
    initial.dirtyPaths.map((change) => [change.path, change.identity]),
  );
  const finalIdentities = new Map(
    final.dirtyPaths.map((change) => [change.path, change.identity]),
  );
  const paths = new Set([...initialIdentities.keys(), ...finalIdentities.keys()]);
  return Object.freeze(
    [...paths]
      .filter((path) => initialIdentities.get(path) !== finalIdentities.get(path))
      .sort(),
  );


}
function isWorkflowEventPrefix(
  prefix: readonly WorkflowEvent[],
  current: readonly WorkflowEvent[],
): boolean {
  return (
    prefix.length <= current.length &&
    prefix.every((event, index) => stableJson(event) === stableJson(current[index]))
  );
}
class ScopedTaskWriterAdapter implements ScopedTaskWriter {
  readonly #writer: TaskWriter;
  readonly #scope: TaskScope;

  constructor(writer: TaskWriter, scope: TaskScope) {
    this.#writer = writer;
    this.#scope = scope;
  }

  assertWritablePath(path: string): void {
    if (!isWritableTaskPath(path, this.#scope.files)) {
      throw new TaskWriterScopeError(path);
    }
  }

  async writeFile(path: string, content: string): Promise<void> {
    this.assertWritablePath(path);
    await this.#writer.writeFile(path, content);
  }
}

class TaskWriterScopeError extends Error {
  readonly path: string;

  constructor(path: string) {
    super(`Task Writer cannot modify ${path}.`);
    this.path = path;
  }
}

function isWritableTaskPath(path: string, patterns: readonly string[]): boolean {
  return (
    isRepositoryRelativePath(path) &&
    patterns.some((pattern) => matchesRepositoryPattern(pattern, path))
  );
}

function matchesRepositoryPattern(pattern: string, path: string): boolean {
  let expression = "^";
  for (let index = 0; index < pattern.length; index += 1) {
    const character = pattern[index]!;
    if (character === "*") {
      if (pattern[index + 1] === "*") {
        expression += ".*";
        index += 1;
      } else {
        expression += "[^/]*";
      }
      continue;
    }
    expression += /[\\^$+?.()|{}\[\]]/u.test(character)
      ? `\\${character}`
      : character;
  }
  return new RegExp(`${expression}$`, "u").test(path);
}

function missingBaseline(): TaskLifecycleFailure {
  return failure([
    diagnostic(
      "task_lifecycle.baseline.missing",
      "baseline.json",
      "Task has no accepted Baseline for shared-checkout mutation.",
      "Capture and adopt the exact current Baseline before requesting the Writer.",
    ),
  ]);
}

function adoptionRequired(): TaskLifecycleFailure {
  return failure([
    diagnostic(
      "task_lifecycle.baseline.adoption_required",
      "$.baseline.adoptedPaths",
      "Every dirty path must be explicitly adopted before the Baseline can be accepted.",
      "Adopt the exact set of observed dirty paths and their diff identities.",
    ),
  ]);
}

function baselineDrift(): TaskLifecycleFailure {
  return failure([
    diagnostic(
      "task_lifecycle.baseline.drift",
      "baseline.json",
      "Repository state changed after the accepted Baseline.",
      "Inspect the drift, adopt a new exact Baseline if approved, then retry the Writer.",
    ),
  ]);
}

function baselineInvalid(
  path: string,
  message: string,
  remediation: string,
): TaskLifecycleFailure {
  return failure([
    diagnostic("task_lifecycle.baseline.invalid", path, message, remediation),
  ]);
}

function writerScopeFailure(path: string): TaskLifecycleFailure {
  return failure([
    diagnostic(
      "task_lifecycle.writer.scope",
      path,
      "Task Writer attempted to modify a path outside the declared Task scope.",
      "Restrict the mutation to a declared scope path or revise scope before adopting a new Baseline.",
    ),
  ]);
}

function phaseExecutionFailure(
  diagnostics: readonly {
    code: PhaseExecutionDiagnosticCode;
    path: string;
    message: string;
    remediation: string;
  }[],
): TaskLifecycleFailure {
  return failure(
    diagnostics.map((item) =>
      diagnostic(item.code, item.path, item.message, item.remediation),
    ),
  );
}

function phaseExecutionBindingInvalid(): TaskLifecycleFailure {
  return failure([
    diagnostic(
      "phase_execution.binding.invalid",
      "$.binding",
      "The durable Phase execution binding is invalid.",
      "Restore the accepted dispatch Event or dispatch the current Phase Agent again.",
    ),
  ]);
}

function phaseExecutionPhaseInvalid(phase: WorkflowPhase): TaskLifecycleFailure {
  return failure([
    diagnostic(
      "phase_execution.phase.invalid",
      "$.execution.dispatch.phase",
      "Phase execution dispatch does not match the active Workflow Phase.",
      `Dispatch the ${phase} Phase Agent for the current Build position.`,
    ),
  ]);
}

function phaseExecutionMissing(phase: WorkflowPhase): TaskLifecycleFailure {
  return failure([
    diagnostic(
      "phase_execution.missing",
      "$.phase",
      `The active ${phase} Phase has no durable execution dispatch to resume.`,
      "Dispatch the current Phase Agent through Core before resuming it in another session.",
    ),
  ]);
}

function phaseExecutionResultInvalid(message: string): TaskLifecycleFailure {
  return failure([
    diagnostic(
      "phase_execution.result.invalid",
      "$.result",
      message,
      "Provide the schema-valid Agent result that matches the accepted Phase dispatch.",
    ),
  ]);
}

function buildPlanMissing(path: string): TaskLifecycleFailure {
  return failure([
    diagnostic(
      "build_plan.missing",
      path,
      "The hash-bound Build Plan evidence is missing.",
      "Record the reviewable Plan before requesting approval.",
    ),
  ]);
}

function buildPlanInvalid(
  path: string,
  message: string,
  remediation: string,
): TaskLifecycleFailure {
  return failure([diagnostic("build_plan.invalid", path, message, remediation)]);
}

function buildPlanPhaseFailure(): TaskLifecycleFailure {
  return failure([
    diagnostic(
      "build_plan.phase.invalid",
      "$.phase",
      "Build Plan recording and approval require an active Build in Plan.",
      "Return the Task to Plan before recording or deciding its implementation Plan.",
    ),
  ]);
}

function buildPlanApprovalRequired(): TaskLifecycleFailure {
  return failure([
    diagnostic(
      "build_plan.approval_required",
      "$.to",
      "Implement is sealed until a human approves the hash-bound Build Plan.",
      "Record the Plan and approve its exact Plan and Context Manifest identities.",
    ),
  ]);
}

function buildPlanRejected(): TaskLifecycleFailure {
  return failure([
    diagnostic(
      "build_plan.rejected",
      "$.planIdentity",
      "Build Plan evidence was rejected and cannot enter Implement.",
      "Record a revised Build Plan before requesting approval.",
    ),
  ]);
}

function buildPlanContextFailure(
  context: InspectDurableContextManifestResult | undefined,
): TaskLifecycleFailure {
  const diagnosticItem = context?.diagnostics[0];
  return failure([
    diagnostic(
      "build_plan.context_stale",
      diagnosticItem?.path ?? "context/implement.jsonl",
      diagnosticItem?.message ?? "Build Plan Context Manifest does not match the requested approval.",
      diagnosticItem?.remediation ??
        "Refresh and freeze the Implement Context Manifest, then record and approve a new Plan.",
    ),
  ]);
}

function writerUnavailable(): TaskLifecycleFailure {
  return failure([
    diagnostic(
      "task_lifecycle.writer.unavailable",
      ".sayhi/.runtime/writer.lock",
      "Shared-checkout Writer authority could not be acquired.",
      "Wait for the current Writer to finish, then retry without bypassing the lock.",
    ),
  ]);
}


function taskPaths(taskId: unknown):
  | Readonly<{ ok: true } & TaskPaths>
  | TaskLifecycleFailure {
  if (typeof taskId !== "string" || !isPortableTaskId(taskId)) {
    return failure([
      diagnostic(
        "task_lifecycle.task_id.invalid",
        "$.taskId",
        "Task id cannot be represented as a portable Project Store directory name.",
        "Use a non-empty Task id without path separators, control characters, or reserved filename characters.",
      ),
    ]);
  }
  const taskDirectory = `${TASKS_DIRECTORY}/${taskId}`;
  return Object.freeze({
    ok: true,
    taskDirectory,
    archiveTaskDirectory: `${TASK_ARCHIVE_DIRECTORY}/${taskId}`,
    eventsPath: `${taskDirectory}/events.jsonl`,
    projectionPath: `${taskDirectory}/task.json`,
    graphPath: `${taskDirectory}/graph.json`,
    lockPath: `.sayhi/.runtime/task-${taskId}.lock`,
    handoffPath: `${taskDirectory}/handoff.json`,
    quickResultPath: `${taskDirectory}/${QUICK_RESULT_FILE_NAME}`,
    plansDirectory: `${taskDirectory}/plans`,
  });
}

function isPortableTaskId(value: string): boolean {
  return (
    value.trim().length > 0 &&
    value !== "." &&
    value !== ".." &&
    !/[<>:"/\\|?*\u0000-\u001f]/u.test(value) &&
    !/[. ]$/u.test(value)
  );
}

function serializeEvent(event: WorkflowEvent): string {
  return `${JSON.stringify(event)}\n`;
}

function serializeProjection(projection: TaskProjection): string {
  return `${JSON.stringify(projection, null, 2)}\n`;
}
function serializeInitiativeGraph(graph: DependencyGraph): string {
  return `${JSON.stringify(graph, null, 2)}\n`;
}


function serializeHandoff(handoff: DurableTaskHandoff): string {
  return `${JSON.stringify(handoff, null, 2)}\n`;
}
function serializeDurableQuickResult(result: DurableQuickResult): string {
  return `${JSON.stringify(result, null, 2)}\n`;
}

async function loadDurableTaskHandoff(
  fileSystem: TaskLifecycleFileSystem,
  path: string,
  state: WorkflowState,
): Promise<
  | Readonly<{ ok: true; value: DurableTaskHandoff | null }>
  | TaskLifecycleFailure
> {
  try {
    const entry = await fileSystem.inspect(path);
    if (entry.kind === "missing") {
      return Object.freeze({ ok: true, value: null });
    }
    if (entry.kind !== "file") {
      return invalidHandoff(
        path,
        "The durable Task Handoff is missing or unsafe.",
        "Restore handoff.json as a regular file or remove it before retrying.",
      );
    }
    return parseDurableTaskHandoff(path, await fileSystem.readFile(path), state);
  } catch {
    return ioFailure(path);
  }
}

function parseDurableTaskHandoff(
  path: string,
  content: string,
  state: WorkflowState,
): Readonly<{ ok: true; value: DurableTaskHandoff }> | TaskLifecycleFailure {
  let value: unknown;
  try {
    value = JSON.parse(content);
  } catch {
    return invalidHandoff(
      path,
      "The durable Task Handoff is not valid JSON.",
      "Restore a complete handoff.json file before retrying.",
    );
  }
  if (!isHandoffRecord(value)) {
    return invalidHandoff(
      path,
      "The durable Task Handoff does not match the recovered Task state.",
      "Record a new Handoff at the current durable Task version before retrying.",
    );
  }
  if (
    value.schemaVersion !== 1 ||
    value.taskId !== state.projection.id ||
    value.phase !== state.projection.phase ||
    value.step !== state.projection.step ||
    value.projectionVersion !== state.projection.version ||
    !sameStrings(value.blockers, state.projection.blockers) ||
    typeof value.repositoryFingerprint !== "string" ||
    value.repositoryFingerprint.trim().length === 0 ||
    !isNonEmptyStringArray(value.artifactReferences) ||
    !isRfc3339Timestamp(value.createdAt)
  ) {
    return invalidHandoff(
      path,
      "The durable Task Handoff does not match the recovered Task state.",
      "Record a new Handoff at the current durable Task version before retrying.",
    );
  }
  return Object.freeze({
    ok: true,
    value: Object.freeze({
      schemaVersion: 1 as const,
      taskId: state.projection.id,
      phase: state.projection.phase,
      step: state.projection.step,
      projectionVersion: state.projection.version,
      blockers: Object.freeze([...state.projection.blockers]),
      repositoryFingerprint: value.repositoryFingerprint,
      artifactReferences: Object.freeze([...value.artifactReferences]),
      createdAt: value.createdAt,
    }),
  });
}

function validateHandoffInput(
  request: CreateDurableTaskHandoffRequest,
): TaskLifecycleFailure | null {
  if (request.repositoryFingerprint.trim().length === 0) {
    return invalidHandoff(
      "$.repositoryFingerprint",
      "A Handoff requires the current repository fingerprint.",
      "Provide the fingerprint captured at the safe Handoff boundary.",
    );
  }
  if (!isNonEmptyStringArray(request.artifactReferences)) {
    return invalidHandoff(
      "$.artifactReferences",
      "A Handoff requires non-empty artifact references.",
      "Provide the Context, Evidence, or other durable artifact references needed to resume.",
    );
  }
  if (!isRfc3339Timestamp(request.createdAt)) {
    return invalidHandoff(
      "$.createdAt",
      "A Handoff requires an RFC 3339 UTC creation time.",
      "Record the Handoff with its UTC creation time.",
    );
  }
  return null;
}

function isHandoffRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
function isQuickResultRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function sameStrings(value: unknown, expected: readonly string[]): boolean {
  return (
    Array.isArray(value) &&
    value.length === expected.length &&
    value.every((item, index) => item === expected[index])
  );
}

function isNonEmptyStringArray(value: unknown): value is readonly string[] {
  return (
    Array.isArray(value) &&
    value.every((item) => typeof item === "string" && item.trim().length > 0)
  );
}

function isRfc3339Timestamp(value: unknown): value is string {
  return (
    typeof value === "string" &&
    /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z$/u.test(value) &&
    Number.isFinite(Date.parse(value))
  );
}

function invalidHandoff(
  path: string,
  message: string,
  remediation: string,
): TaskLifecycleFailure {
  return failure([
    diagnostic("task_lifecycle.handoff.invalid", path, message, remediation),
  ]);
}
function quickResultInvalid(
  path: string,
  message: string,
  remediation: string,
): TaskLifecycleFailure {
  return failure([
    diagnostic("task_lifecycle.quick_result.invalid", path, message, remediation),
  ]);
}
function quickResultMissing(path: string): TaskLifecycleFailure {
  return failure([
    diagnostic(
      "task_lifecycle.quick_result.missing",
      path,
      "The durable Quick result was not found.",
      "Complete the changed Quick before showing or archiving it.",
    ),
  ]);
}

function prefixWorkflowDiagnostic(
  path: string,
  item: WorkflowDiagnostic,
): TaskLifecycleDiagnostic {
  return Object.freeze({ ...item, path: `${path}${item.path}` });
}

function diagnostic(
  code: TaskLifecycleDiagnosticCode,
  path: string,
  message: string,
  remediation: string,
): TaskLifecycleDiagnostic {
  return Object.freeze({ code, path, message, remediation });
}

function failure(
  diagnostics: readonly TaskLifecycleDiagnostic[],
): TaskLifecycleFailure {
  return Object.freeze({
    ok: false,
    contractVersion: TASK_LIFECYCLE_CONTRACT_VERSION,
    diagnostics: Object.freeze([...diagnostics]),
  });
}

function invalidTaskArchive(
  path: string,
  message: string,
  remediation: string,
): TaskLifecycleFailure {
  return failure([
    diagnostic("task_lifecycle.store.invalid", path, message, remediation),
  ]);
}

function ioFailure(path: string): TaskLifecycleFailure {
  return failure([
    diagnostic(
      "task_lifecycle.io_failed",
      path,
      "The durable Task operation could not complete its filesystem access.",
      "Inspect the Project Store path and permissions, then recover from accepted Events before retrying.",
    ),
  ]);
}
