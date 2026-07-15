import { stableJson } from "./identity.js";
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
  adoptWorkflowBaseline,
  isRepositoryRelativePath,
  replayWorkflowEvents,
  startWorkflowTask,
  transitionWorkflow,
  type BaselineAdoptedEvent,
  type StartWorkflowTaskRequest,
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
  | "task_lifecycle.writer.unavailable";

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
