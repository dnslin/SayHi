import type { AgentRepositoryAccess } from "./execution.js";
import type { InitiativeReadinessResult } from "./initiative-readiness.js";

export type InitiativeNodeExecutionOutcome<Value> =
  | Readonly<{ kind: "succeeded"; value: Value }>
  | Readonly<{ kind: "failed"; error: unknown }>
  | Readonly<{ kind: "cancelled" }>;

export interface InitiativeNodeExecution<Value> {
  readonly taskId: string;
  readonly repositoryAccess: AgentRepositoryAccess;
  readonly run: (
    signal: AbortSignal | undefined,
  ) => Promise<InitiativeNodeExecutionOutcome<Value>>;
  readonly persist: (
    outcome: InitiativeNodeExecutionOutcome<Value>,
  ) => Promise<void>;
}

export interface InitiativeScheduleRequest<Value> {
  readonly readiness: InitiativeReadinessResult;
  readonly executions: readonly InitiativeNodeExecution<Value>[];
  readonly signal?: AbortSignal;
}

export interface InitiativeNodeExecutionResult<Value> {
  readonly taskId: string;
  readonly outcome: InitiativeNodeExecutionOutcome<Value>;
}

export interface InitiativeScheduleFailure {
  readonly taskId: string;
  readonly error: unknown;
}

export type InitiativeScheduleResult<Value> =
  | Readonly<{
      status: "completed";
      results: readonly InitiativeNodeExecutionResult<Value>[];
    }>
  | Readonly<{
      status: "failed";
      results: readonly InitiativeNodeExecutionResult<Value>[];
      failure: InitiativeScheduleFailure;
    }>
  | Readonly<{
      status: "cancelled";
      results: readonly InitiativeNodeExecutionResult<Value>[];
    }>;

export type InitiativeWriterOwner =
  | Readonly<{
      kind: "read-wave-results";
      taskIds: readonly string[];
    }>
  | Readonly<{
      kind: "node";
      taskId: string;
    }>;

export class InitiativeReadWriteBarrier {
  #activeReadWaves = 0;
  #activeWriterOwner: InitiativeWriterOwner | null = null;
  #pendingReadWaveWrites = 0;
  #waitingWriters = 0;
  #waiters = new Set<() => void>();

  get activeReadWaves(): number {
    return this.#activeReadWaves;
  }

  get activeWriterOwner(): InitiativeWriterOwner | null {
    return this.#activeWriterOwner;
  }

  async runReadWave<ReadValue, PersistedValue>(
    operation: () => Promise<ReadValue>,
    owner: InitiativeWriterOwner,
    persist: (value: ReadValue) => Promise<PersistedValue>,
  ): Promise<PersistedValue> {
    await this.#waitUntil(
      () =>
        this.#activeWriterOwner === null &&
        this.#pendingReadWaveWrites === 0 &&
        this.#waitingWriters === 0,
    );
    this.#activeReadWaves += 1;
    let value: ReadValue;
    try {
      value = await operation();
    } catch (error) {
      this.#activeReadWaves -= 1;
      this.#notify();
      throw error;
    }

    this.#pendingReadWaveWrites += 1;
    this.#activeReadWaves -= 1;
    this.#notify();
    await this.#waitUntil(
      () => this.#activeWriterOwner === null && this.#activeReadWaves === 0,
    );
    this.#pendingReadWaveWrites -= 1;
    this.#activeWriterOwner = owner;
    try {
      return await persist(value);
    } finally {
      this.#activeWriterOwner = null;
      this.#notify();
    }
  }

  async runWriter<Value>(
    owner: InitiativeWriterOwner,
    operation: () => Promise<Value>,
  ): Promise<Value> {
    this.#waitingWriters += 1;
    await this.#waitUntil(
      () =>
        this.#activeWriterOwner === null &&
        this.#activeReadWaves === 0 &&
        this.#pendingReadWaveWrites === 0,
    );
    this.#waitingWriters -= 1;
    this.#activeWriterOwner = owner;
    try {
      return await operation();
    } finally {
      this.#activeWriterOwner = null;
      this.#notify();
    }
  }

  async #waitUntil(condition: () => boolean): Promise<void> {
    while (!condition()) {
      await new Promise<void>((resolve) => this.#waiters.add(resolve));
    }
  }

  #notify(): void {
    const waiters = this.#waiters;
    this.#waiters = new Set();
    for (const resolve of waiters) {
      resolve();
    }
  }
}

export class InitiativeExecutionScheduler {
  readonly barrier: InitiativeReadWriteBarrier;

  constructor(barrier = new InitiativeReadWriteBarrier()) {
    this.barrier = barrier;
  }

  async run<Value>(
    request: InitiativeScheduleRequest<Value>,
  ): Promise<InitiativeScheduleResult<Value>> {
    const executions = orderedReadyExecutions(request);
    if (isAborted(request.signal)) {
      return cancelled([]);
    }

    const readers = executions.filter(
      (execution) => execution.repositoryAccess === "read-only",
    );
    const writers = executions.filter(
      (execution) => execution.repositoryAccess !== "read-only",
    );
    let readOutcomes: readonly CompletedNode<Value>[] = [];
    const persistedReads: ReadPersistenceResult<Value> =
      readers.length === 0
        ? Object.freeze({ ok: true, results: [] })
        : await this.barrier.runReadWave(
            async () => {
              readOutcomes = await Promise.all(
                readers.map((execution) => runExecution(execution, request.signal)),
              );
              return readOutcomes;
            },
            Object.freeze({
              kind: "read-wave-results",
              taskIds: Object.freeze(readers.map((execution) => execution.taskId)),
            }),
            (outcomes) => this.#persistReadWave(outcomes),
          );
    if (!persistedReads.ok) {
      return failed(persistedReads.results, persistedReads.failure);
    }
    if (isAborted(request.signal) || hasCancelledOutcome(readOutcomes)) {
      return cancelled(persistedReads.results);
    }
    const readFailure = firstFailure(readOutcomes);
    if (readFailure !== undefined) {
      return failed(persistedReads.results, readFailure);
    }

    const results = [...persistedReads.results];
    for (const execution of writers) {
      const writer = await this.barrier.runWriter(
        Object.freeze({ kind: "node", taskId: execution.taskId }),
        async () => {
          if (isAborted(request.signal)) {
            return Object.freeze({ kind: "cancelled-before-run" } as const);
          }
          const outcome = await runExecution(execution, request.signal);
          try {
            await execution.persist(outcome.outcome);
          } catch (error) {
            return Object.freeze({
              kind: "persist-failed",
              result: outcome,
              failure: Object.freeze({ taskId: execution.taskId, error }),
            } as const);
          }
          return Object.freeze({ kind: "persisted", result: outcome } as const);
        },
      );
      if (writer.kind === "cancelled-before-run") {
        return cancelled(results);
      }
      if (writer.kind === "persist-failed") {
        return failed(results, writer.failure);
      }
      results.push(writer.result);
      if (writer.result.outcome.kind === "cancelled") {
        return cancelled(results);
      }
      if (writer.result.outcome.kind === "failed") {
        return failed(
          results,
          Object.freeze({
            taskId: writer.result.taskId,
            error: writer.result.outcome.error,
          }),
        );
      }
    }
    return completed(results);
  }

  async #persistReadWave<Value>(
    outcomes: readonly CompletedNode<Value>[],
  ): Promise<ReadPersistenceResult<Value>> {
    const results: InitiativeNodeExecutionResult<Value>[] = [];
    let failure: InitiativeScheduleFailure | undefined;
    for (const outcome of outcomes) {
      try {
        await outcome.execution.persist(outcome.outcome);
        results.push(toResult(outcome));
      } catch (error) {
        failure ??= Object.freeze({ taskId: outcome.taskId, error });
      }
    }
    return failure === undefined
      ? Object.freeze({ ok: true, results: Object.freeze(results) })
      : Object.freeze({ ok: false, results: Object.freeze(results), failure });
  }
}

interface CompletedNode<Value> {
  readonly taskId: string;
  readonly execution: InitiativeNodeExecution<Value>;
  readonly outcome: InitiativeNodeExecutionOutcome<Value>;
}

type ReadPersistenceResult<Value> =
  | Readonly<{
      ok: true;
      results: readonly InitiativeNodeExecutionResult<Value>[];
    }>
  | Readonly<{
      ok: false;
      results: readonly InitiativeNodeExecutionResult<Value>[];
      failure: InitiativeScheduleFailure;
    }>;

function orderedReadyExecutions<Value>(
  request: InitiativeScheduleRequest<Value>,
): readonly InitiativeNodeExecution<Value>[] {
  const readyTaskIds = request.readiness.frontier;
  const readyNodes = new Map(
    request.readiness.nodes
      .filter((node) => node.readiness === "ready")
      .map((node) => [node.taskId, node]),
  );
  if (
    readyTaskIds.length !== readyNodes.size ||
    readyTaskIds.some((taskId) => !readyNodes.has(taskId))
  ) {
    throw new TypeError(
      "Initiative readiness frontier must contain each ready Task exactly once.",
    );
  }
  const executions = new Map<string, InitiativeNodeExecution<Value>>();
  for (const execution of request.executions) {
    if (executions.has(execution.taskId)) {
      throw new TypeError(`Initiative execution for ${execution.taskId} is duplicated.`);
    }
    if (!isRepositoryAccess(execution.repositoryAccess)) {
      throw new TypeError(
        `Initiative execution ${execution.taskId} has unsupported repository access.`,
      );
    }
    executions.set(execution.taskId, execution);
  }
  if (executions.size !== readyTaskIds.length) {
    throw new TypeError(
      "Initiative executions must cover the ready frontier exactly once.",
    );
  }
  return Object.freeze(
    readyTaskIds.map((taskId) => {
      const execution = executions.get(taskId);
      if (execution === undefined) {
        throw new TypeError(`Initiative execution for ready Task ${taskId} is missing.`);
      }
      return execution;
    }),
  );
}

function isRepositoryAccess(value: unknown): value is AgentRepositoryAccess {
  return (
    value === "read-only" ||
    value === "exclusive-write" ||
    value === "read-only-plus-exclusive-validation"
  );
}

function isAborted(signal: AbortSignal | undefined): boolean {
  return signal?.aborted ?? false;
}

async function runExecution<Value>(
  execution: InitiativeNodeExecution<Value>,
  signal: AbortSignal | undefined,
): Promise<CompletedNode<Value>> {
  if (isAborted(signal)) {
    return Object.freeze({
      taskId: execution.taskId,
      execution,
      outcome: Object.freeze({ kind: "cancelled" }),
    });
  }
  try {
    const outcome = await execution.run(signal);
    if (!isExecutionOutcome(outcome)) {
      return Object.freeze({
        taskId: execution.taskId,
        execution,
        outcome: Object.freeze({
          kind: "failed",
          error: new TypeError(
            `Initiative execution ${execution.taskId} returned an invalid outcome.`,
          ),
        }),
      });
    }
    return Object.freeze({ taskId: execution.taskId, execution, outcome });
  } catch (error) {
    return Object.freeze({
      taskId: execution.taskId,
      execution,
      outcome: Object.freeze({ kind: "failed", error } as const),
    });
  }
}

function isExecutionOutcome<Value>(
  outcome: unknown,
): outcome is InitiativeNodeExecutionOutcome<Value> {
  return (
    typeof outcome === "object" &&
    outcome !== null &&
    "kind" in outcome &&
    ((outcome as { kind?: unknown }).kind === "succeeded" ||
      (outcome as { kind?: unknown }).kind === "failed" ||
      (outcome as { kind?: unknown }).kind === "cancelled")
  );
}

function toResult<Value>(
  outcome: CompletedNode<Value>,
): InitiativeNodeExecutionResult<Value> {
  return Object.freeze({ taskId: outcome.taskId, outcome: outcome.outcome });
}

function hasCancelledOutcome<Value>(
  outcomes: readonly CompletedNode<Value>[],
): boolean {
  return outcomes.some((outcome) => outcome.outcome.kind === "cancelled");
}

function firstFailure<Value>(
  outcomes: readonly CompletedNode<Value>[],
): InitiativeScheduleFailure | undefined {
  const failedOutcome = outcomes.find((outcome) => outcome.outcome.kind === "failed");
  return failedOutcome?.outcome.kind === "failed"
    ? Object.freeze({
        taskId: failedOutcome.taskId,
        error: failedOutcome.outcome.error,
      })
    : undefined;
}

function completed<Value>(
  results: readonly InitiativeNodeExecutionResult<Value>[],
): InitiativeScheduleResult<Value> {
  return Object.freeze({ status: "completed", results: Object.freeze([...results]) });
}

function failed<Value>(
  results: readonly InitiativeNodeExecutionResult<Value>[],
  failure: InitiativeScheduleFailure,
): InitiativeScheduleResult<Value> {
  return Object.freeze({
    status: "failed",
    results: Object.freeze([...results]),
    failure,
  });
}

function cancelled<Value>(
  results: readonly InitiativeNodeExecutionResult<Value>[],
): InitiativeScheduleResult<Value> {
  return Object.freeze({ status: "cancelled", results: Object.freeze([...results]) });
}
