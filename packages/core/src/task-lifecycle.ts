import { hashCanonicalJson, stableJson } from "./identity.js";
import {
  RECORD_CONTRACT_VERSION,
  validateContractRecord,
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
  approveSpec,
  isApprovedSpec,
  readApprovedSpecs,
} from "./spec-approval.js";
import {
  adoptWorkflowBaseline,
  isRepositoryRelativePath,
  replayWorkflowEvents,
  startWorkflowTask,
  recordContextManifestChange,
  transitionWorkflow,
  type BaselineAdoptedEvent,
  type StartWorkflowTaskRequest,
  type ContextManifestChangedEvent,
  type TaskCreatedEvent,
  type TaskProjection,
  type TaskScope,
  type TransitionWorkflowRequest,
  type WorkflowDiagnostic,
  type WorkflowDiagnosticCode,
  type WorkflowEvent,
  type WorkflowEventMetadata,
  type WorkflowState,
  type WorkflowTransitionedEvent,
  type WorkflowPhase,
} from "./workflow.js";

export const TASK_LIFECYCLE_CONTRACT_VERSION = 1 as const;

const TASKS_DIRECTORY = ".sayhi/tasks";

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

export interface TaskBaselineFileSystem extends TaskLifecycleFileSystem {
  captureBaseline(request: TaskBaselineCaptureRequest): Promise<BaselineRecord>;
  withWriterMutationLock<Result>(
    operation: (writer: TaskWriter) => Promise<Result>,
  ): Promise<Result>;
}


export type TaskLifecycleDiagnosticCode =
  | WorkflowDiagnosticCode
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
  | "context_manifest.stale";

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

export interface RecoverDurableTaskRequest {
  readonly fileSystem: TaskLifecycleFileSystem;
  readonly taskId: string;
}
export interface ReadDurableTaskRequest {
  readonly fileSystem: TaskLifecycleFileSystem;
  readonly taskId: string;
}


export interface DiagnoseDurableTasksRequest {
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
  readonly operation: (writer: TaskWriter) => Promise<Value>;
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



export type RecoverDurableTaskResult =
  | Readonly<{
      ok: true;
      contractVersion: typeof TASK_LIFECYCLE_CONTRACT_VERSION;
      state: WorkflowState;
      recovered: boolean;
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
  readonly eventsPath: string;
  readonly projectionPath: string;
  readonly lockPath: string;
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
  const paths = taskPaths(request.transition.taskId);
  if (!paths.ok) {
    return paths;
  }
  return runWithTaskLock(request.fileSystem, paths.lockPath, () =>
    advanceDurableTaskLocked(request),
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
    recoverDurableTaskLocked(request),
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
    event: changed.event,
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
  const changed = recordContextManifestChange(loaded.state, {
    contractVersion: 1,
    taskId: request.taskId,
    expectedVersion: request.expectedVersion,
    phase: request.phase,
    manifestPath: manifest.manifestReference,
    manifestIdentity: hashCanonicalJson(frozenEntries),
    change: "refreshed",
    event: request.event,
  });
  if (!changed.ok) {
    return failure(changed.diagnostics);
  }
  const persisted = await persistContextManifestChange({
    fileSystem: request.fileSystem,
    paths,
    manifestPath: manifest.manifestPath,
    entries: frozenEntries,
    previousEventCount: loaded.state.events.length,
    state: changed.state,
    event: changed.event,
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
    state: changed.state,
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
    event: changed.event,
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
    event: changed.event,
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
  readonly event: ContextManifestChangedEvent;
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
    if (request.state.events.length > request.previousEventCount) {
      await request.fileSystem.appendFile(
        request.paths.eventsPath,
        serializeEvent(request.event),
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



async function advanceDurableTaskLocked(
  request: AdvanceDurableTaskRequest,
): Promise<AdvanceDurableTaskResult> {
  const loaded = await loadTask(request.fileSystem, request.transition.taskId);
  if (!loaded.ok) {
    return loaded;
  }
  const transitioned = transitionWorkflow(loaded.state, request.transition);
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
      state: transitioned.state,
      event: transitioned.event,
      appended,
    });
  } catch {
    return ioFailure(activePath);
  }
}

async function recoverDurableTaskLocked(
  request: RecoverDurableTaskRequest,
): Promise<RecoverDurableTaskResult> {
  const loaded = await loadTask(request.fileSystem, request.taskId);
  if (!loaded.ok) {
    return loaded;
  }
  try {
    const recovered = await writeProjectionIfChanged(
      request.fileSystem,
      loaded.projectionPath,
      loaded.state.projection,
    );
    return Object.freeze({
      ok: true,
      contractVersion: TASK_LIFECYCLE_CONTRACT_VERSION,
      state: loaded.state,
      recovered,
    });
  } catch {
    return ioFailure(loaded.projectionPath);
  }
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

  const adopted = adoptWorkflowBaseline(loaded.state, {
    contractVersion: 1,
    taskId: request.taskId,
    expectedVersion: request.expectedVersion,
    baselineIdentity: baseline.identity,
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
    adoption.baselineIdentity !== baseline.identity ||
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
      new ScopedTaskWriter(writer, loaded.state.projection.scope),
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
): Promise<LoadTaskResult> {
  const paths = taskPaths(taskId);
  if (!paths.ok) {
    return paths;
  }

  try {
    const taskDirectory = await fileSystem.inspect(paths.taskDirectory);
    if (taskDirectory.kind !== "directory") {
      return failure([
        diagnostic(
          "task_lifecycle.history.missing",
          paths.taskDirectory,
          "The durable Task directory is missing or unsafe.",
          "Restore the Task directory from the repository before retrying.",
        ),
      ]);
    }
    const eventsFile = await fileSystem.inspect(paths.eventsPath);
    if (eventsFile.kind !== "file") {
      return failure([
        diagnostic(
          "task_lifecycle.history.missing",
          paths.eventsPath,
          "The durable Workflow Event history is missing or unsafe.",
          "Restore the append-only events.jsonl file before retrying.",
        ),
      ]);
    }

    const parsed = parseEventHistory(
      paths.eventsPath,
      await fileSystem.readFile(paths.eventsPath),
    );
    if (!parsed.ok) {
      return parsed;
    }
    const replayed = replayWorkflowEvents(parsed.events);
    if (!replayed.ok) {
      return failure(
        replayed.diagnostics.map((item) =>
          prefixWorkflowDiagnostic(paths.eventsPath, item),
        ),
      );
    }
    if (replayed.state.projection.id !== taskId) {
      return failure([
        diagnostic(
          "workflow.task.mismatch",
          `${paths.eventsPath}$[0].taskId`,
          "Workflow Event history belongs to a different durable Task.",
          "Restore the Event history accepted for the requested Task id.",
        ),
      ]);
    }

    return Object.freeze({
      ok: true,
      state: replayed.state,
      eventsPath: paths.eventsPath,
      projectionPath: paths.projectionPath,
    });
  } catch {
    return ioFailure(paths.eventsPath);
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
  const expected = serializeProjection(projection);
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
class ScopedTaskWriter implements TaskWriter {
  readonly #writer: TaskWriter;
  readonly #scope: TaskScope;

  constructor(writer: TaskWriter, scope: TaskScope) {
    this.#writer = writer;
    this.#scope = scope;
  }

  async writeFile(path: string, content: string): Promise<void> {
    if (!isWritableTaskPath(path, this.#scope.files)) {
      throw new TaskWriterScopeError(path);
    }
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


function taskPaths(taskId: string):
  | Readonly<{ ok: true } & TaskPaths>
  | TaskLifecycleFailure {
  if (!isPortableTaskId(taskId)) {
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
    eventsPath: `${taskDirectory}/events.jsonl`,
    projectionPath: `${taskDirectory}/task.json`,
    lockPath: `.sayhi/.runtime/task-${taskId}.lock`,
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
