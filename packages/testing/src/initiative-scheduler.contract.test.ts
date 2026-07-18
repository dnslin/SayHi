import assert from "node:assert/strict";
import test from "node:test";

import {
  InitiativeExecutionScheduler,
  type InitiativeNodeExecution,
  type InitiativeReadinessResult,
} from "@dnslin/sayhi-core";

test("Ready read-only Initiative nodes share a Read Wave before serialized Writer work", async () => {
  const scheduler = new InitiativeExecutionScheduler();
  const events: string[] = [];
  const readAStarted = deferred<void>();
  const readBStarted = deferred<void>();
  const writerAStarted = deferred<void>();
  const releaseReadA = deferred<void>();
  const releaseReadB = deferred<void>();
  const releaseWriterA = deferred<void>();
  let activeWriters = 0;
  let maxActiveWriters = 0;
  let writerBStarted = false;

  const schedule = scheduler.run({
    readiness: readyFrontier(
      "TASK-READ-A",
      "TASK-READ-B",
      "TASK-WRITE-A",
      "TASK-WRITE-B",
    ),
    executions: [
      readExecution("TASK-READ-A", readAStarted, releaseReadA, events),
      readExecution("TASK-READ-B", readBStarted, releaseReadB, events),
      {
        taskId: "TASK-WRITE-A",
        repositoryAccess: "exclusive-write",
        run: async () => {
          events.push("run:write-a");
          activeWriters += 1;
          maxActiveWriters = Math.max(maxActiveWriters, activeWriters);
          writerAStarted.resolve();
          await releaseWriterA.promise;
          activeWriters -= 1;
          return { kind: "succeeded", value: "write-a" };
        },
        persist: async (outcome) => {
          events.push(`persist:write-a:${outcome.kind}`);
        },
      },
      {
        taskId: "TASK-WRITE-B",
        repositoryAccess: "read-only-plus-exclusive-validation",
        run: async () => {
          writerBStarted = true;
          events.push("run:write-b");
          activeWriters += 1;
          maxActiveWriters = Math.max(maxActiveWriters, activeWriters);
          activeWriters -= 1;
          return { kind: "succeeded", value: "write-b" };
        },
        persist: async (outcome) => {
          events.push(`persist:write-b:${outcome.kind}`);
        },
      },
    ] satisfies readonly InitiativeNodeExecution<string>[],
  });

  await Promise.all([readAStarted.promise, readBStarted.promise]);
  assert.deepEqual(events, ["run:read-a", "run:read-b"]);

  releaseReadA.resolve();
  releaseReadB.resolve();
  await writerAStarted.promise;
  assert.deepEqual(events, [
    "run:read-a",
    "run:read-b",
    "persist:read-a:succeeded",
    "persist:read-b:succeeded",
    "run:write-a",
  ]);
  assert.equal(writerBStarted, false);
  assert.equal(maxActiveWriters, 1);

  releaseWriterA.resolve();
  const result = await schedule;

  assert.equal(result.status, "completed");
  assert.deepEqual(
    result.results.map((entry) => entry.taskId),
    ["TASK-READ-A", "TASK-READ-B", "TASK-WRITE-A", "TASK-WRITE-B"],
  );
  assert.equal(maxActiveWriters, 1);
});

test("Concurrent ready Build requests queue the second Writer before it edits", async () => {
  const scheduler = new InitiativeExecutionScheduler();
  const firstWriterStarted = deferred<void>();
  const releaseFirstWriter = deferred<void>();
  const events: string[] = [];
  let secondWriterStarted = false;
  let secondWriterPersisted = false;

  const first = scheduler.run({
    readiness: readyFrontier("TASK-CONTEND-FIRST"),
    executions: [
      {
        taskId: "TASK-CONTEND-FIRST",
        repositoryAccess: "exclusive-write",
        run: async () => {
          events.push("run:first");
          firstWriterStarted.resolve();
          await releaseFirstWriter.promise;
          return { kind: "succeeded", value: "first" };
        },
        persist: async (outcome) => {
          events.push(`persist:first:${outcome.kind}`);
        },
      },
    ] satisfies readonly InitiativeNodeExecution<string>[],
  });

  await firstWriterStarted.promise;
  const second = scheduler.run({
    readiness: readyFrontier("TASK-CONTEND-SECOND"),
    executions: [
      {
        taskId: "TASK-CONTEND-SECOND",
        repositoryAccess: "exclusive-write",
        run: async () => {
          secondWriterStarted = true;
          events.push("run:second");
          return { kind: "succeeded", value: "second" };
        },
        persist: async (outcome) => {
          secondWriterPersisted = true;
          events.push(`persist:second:${outcome.kind}`);
        },
      },
    ] satisfies readonly InitiativeNodeExecution<string>[],
  });

  await Promise.resolve();
  assert.equal(secondWriterStarted, false);
  assert.equal(secondWriterPersisted, false);
  releaseFirstWriter.resolve();

  const [firstResult, secondResult] = await Promise.all([first, second]);
  assert.equal(firstResult.status, "completed");
  assert.equal(secondResult.status, "completed");
  assert.deepEqual(events, [
    "run:first",
    "persist:first:succeeded",
    "run:second",
    "persist:second:succeeded",
  ]);
});

test("An active validation Writer denies a new Read Wave", async () => {
  const scheduler = new InitiativeExecutionScheduler();
  const validationStarted = deferred<void>();
  const releaseValidation = deferred<void>();
  const events: string[] = [];
  let readerStarted = false;

  const validation = scheduler.run({
    readiness: readyFrontier("TASK-VALIDATION"),
    executions: [
      {
        taskId: "TASK-VALIDATION",
        repositoryAccess: "read-only-plus-exclusive-validation",
        run: async () => {
          events.push("run:validation");
          validationStarted.resolve();
          await releaseValidation.promise;
          return { kind: "succeeded", value: "validation" };
        },
        persist: async (outcome) => {
          events.push(`persist:validation:${outcome.kind}`);
        },
      },
    ] satisfies readonly InitiativeNodeExecution<string>[],
  });

  await validationStarted.promise;
  const reader = scheduler.run({
    readiness: readyFrontier("TASK-READER-DENIED"),
    executions: [
      {
        taskId: "TASK-READER-DENIED",
        repositoryAccess: "read-only",
        run: async () => {
          readerStarted = true;
          events.push("run:reader");
          return { kind: "succeeded", value: "reader" };
        },
        persist: async (outcome) => {
          events.push(`persist:reader:${outcome.kind}`);
        },
      },
    ] satisfies readonly InitiativeNodeExecution<string>[],
  });

  await Promise.resolve();
  assert.equal(readerStarted, false);
  releaseValidation.resolve();

  const [validationResult, readerResult] = await Promise.all([validation, reader]);
  assert.equal(validationResult.status, "completed");
  assert.equal(readerResult.status, "completed");
  assert.deepEqual(events, [
    "run:validation",
    "persist:validation:succeeded",
    "run:reader",
    "persist:reader:succeeded",
  ]);
});

function readyFrontier(...taskIds: string[]): InitiativeReadinessResult {
  return {
    nodes: taskIds.map((taskId) => ({
      taskId,
      readiness: "ready",
      blockers: [],
    })),
    frontier: taskIds,
  };
}

function readExecution(
  taskId: "TASK-READ-A" | "TASK-READ-B",
  started: Deferred<void>,
  release: Deferred<void>,
  events: string[],
): InitiativeNodeExecution<string> {
  const suffix = taskId === "TASK-READ-A" ? "a" : "b";
  return {
    taskId,
    repositoryAccess: "read-only",
    run: async () => {
      events.push(`run:read-${suffix}`);
      started.resolve();
      await release.promise;
      return { kind: "succeeded", value: `read-${suffix}` };
    },
    persist: async (outcome) => {
      events.push(`persist:read-${suffix}:${outcome.kind}`);
    },
  };
}

interface Deferred<Value> {
  readonly promise: Promise<Value>;
  resolve(value: Value): void;
}

function deferred<Value>(): Deferred<Value> {
  let resolve: ((value: Value) => void) | undefined;
  const promise = new Promise<Value>((resolvePromise) => {
    resolve = resolvePromise;
  });
  return {
    promise,
    resolve(value) {
      resolve?.(value);
    },
  };
}

test("A failed Read Wave outcome is durable and blocks every Writer node", async () => {
  const scheduler = new InitiativeExecutionScheduler();
  const events: string[] = [];
  const readerFailure = new Error("Reader failed.");
  let writerStarted = false;

  const result = await scheduler.run({
    readiness: readyFrontier("TASK-READ-OK", "TASK-READ-FAIL", "TASK-WRITE"),
    executions: [
      {
        taskId: "TASK-READ-OK",
        repositoryAccess: "read-only",
        run: async () => ({ kind: "succeeded", value: "read-ok" }),
        persist: async (outcome) => {
          events.push(`persist:read-ok:${outcome.kind}`);
        },
      },
      {
        taskId: "TASK-READ-FAIL",
        repositoryAccess: "read-only",
        run: async () => ({ kind: "failed", error: readerFailure }),
        persist: async (outcome) => {
          events.push(`persist:read-fail:${outcome.kind}`);
        },
      },
      {
        taskId: "TASK-WRITE",
        repositoryAccess: "exclusive-write",
        run: async () => {
          writerStarted = true;
          return { kind: "succeeded", value: "write" };
        },
        persist: async () => {
          assert.fail("A Writer must not persist after a failed Read Wave.");
        },
      },
    ] satisfies readonly InitiativeNodeExecution<string>[],
  });

  assert.equal(result.status, "failed");
  if (result.status === "failed") {
    assert.equal(result.failure.taskId, "TASK-READ-FAIL");
    assert.equal(result.failure.error, readerFailure);
  }
  assert.deepEqual(events, [
    "persist:read-ok:succeeded",
    "persist:read-fail:failed",
  ]);
  assert.equal(writerStarted, false);
  assert.equal(scheduler.barrier.activeWriterOwner, null);
});

test("Cancellation after a Read Wave starts prevents Writer work and releases the barrier", async () => {
  const scheduler = new InitiativeExecutionScheduler();
  const controller = new AbortController();
  const readStarted = deferred<void>();
  let writerStarted = false;
  const events: string[] = [];

  const scheduled = scheduler.run({
    readiness: readyFrontier("TASK-READ-CANCEL", "TASK-WRITE-CANCEL"),
    signal: controller.signal,
    executions: [
      {
        taskId: "TASK-READ-CANCEL",
        repositoryAccess: "read-only",
        run: async (signal) => {
          readStarted.resolve();
          await new Promise<void>((resolve) => {
            signal?.addEventListener("abort", () => resolve(), { once: true });
          });
          return { kind: "cancelled" };
        },
        persist: async (outcome) => {
          events.push(`persist:read-cancel:${outcome.kind}`);
        },
      },
      {
        taskId: "TASK-WRITE-CANCEL",
        repositoryAccess: "exclusive-write",
        run: async () => {
          writerStarted = true;
          return { kind: "succeeded", value: "write" };
        },
        persist: async () => {
          assert.fail("A cancelled Read Wave must prevent Writer persistence.");
        },
      },
    ] satisfies readonly InitiativeNodeExecution<string>[],
  });

  await readStarted.promise;
  controller.abort();
  const result = await scheduled;

  assert.equal(result.status, "cancelled");
  assert.deepEqual(events, ["persist:read-cancel:cancelled"]);
  assert.equal(writerStarted, false);
  assert.equal(scheduler.barrier.activeReadWaves, 0);
  assert.equal(scheduler.barrier.activeWriterOwner, null);
});

test("A failed Writer releases the shared barrier before the next Writer acquires it", async () => {
  const scheduler = new InitiativeExecutionScheduler();
  const writerFailure = new Error("Writer failed.");
  const firstWriterStarted = deferred<void>();
  const releaseFailedWriter = deferred<void>();
  const events: string[] = [];
  let activeWriters = 0;
  let maxActiveWriters = 0;
  let nextWriterStarted = false;

  const failedWriter = scheduler.run({
    readiness: readyFrontier("TASK-WRITE-FAIL"),
    executions: [
      {
        taskId: "TASK-WRITE-FAIL",
        repositoryAccess: "exclusive-write",
        run: async () => {
          activeWriters += 1;
          maxActiveWriters = Math.max(maxActiveWriters, activeWriters);
          events.push("run:failed-writer");
          firstWriterStarted.resolve();
          await releaseFailedWriter.promise;
          activeWriters -= 1;
          return { kind: "failed", error: writerFailure };
        },
        persist: async (outcome) => {
          events.push(`persist:failed-writer:${outcome.kind}`);
        },
      },
    ] satisfies readonly InitiativeNodeExecution<string>[],
  });

  await firstWriterStarted.promise;
  const nextWriter = scheduler.run({
    readiness: readyFrontier("TASK-WRITE-NEXT"),
    executions: [
      {
        taskId: "TASK-WRITE-NEXT",
        repositoryAccess: "read-only-plus-exclusive-validation",
        run: async () => {
          nextWriterStarted = true;
          activeWriters += 1;
          maxActiveWriters = Math.max(maxActiveWriters, activeWriters);
          events.push("run:next-writer");
          activeWriters -= 1;
          return { kind: "succeeded", value: "next" };
        },
        persist: async (outcome) => {
          events.push(`persist:next-writer:${outcome.kind}`);
        },
      },
    ] satisfies readonly InitiativeNodeExecution<string>[],
  });

  await Promise.resolve();
  assert.equal(nextWriterStarted, false);
  releaseFailedWriter.resolve();

  const [failed, completed] = await Promise.all([failedWriter, nextWriter]);
  assert.equal(failed.status, "failed");
  assert.equal(completed.status, "completed");
  assert.deepEqual(events, [
    "run:failed-writer",
    "persist:failed-writer:failed",
    "run:next-writer",
    "persist:next-writer:succeeded",
  ]);
  assert.equal(maxActiveWriters, 1);
  assert.equal(scheduler.barrier.activeWriterOwner, null);
});

test("A queued Writer cannot overtake an unsettled Read Wave's durable results", async () => {
  const scheduler = new InitiativeExecutionScheduler();
  const readStarted = deferred<void>();
  const releaseRead = deferred<void>();
  const events: string[] = [];

  const readWave = scheduler.run({
    readiness: readyFrontier("TASK-READ-QUEUED"),
    executions: [
      {
        taskId: "TASK-READ-QUEUED",
        repositoryAccess: "read-only",
        run: async () => {
          events.push("run:read");
          readStarted.resolve();
          await releaseRead.promise;
          return { kind: "succeeded", value: "read" };
        },
        persist: async (outcome) => {
          events.push(`persist:read:${outcome.kind}`);
        },
      },
    ] satisfies readonly InitiativeNodeExecution<string>[],
  });

  await readStarted.promise;
  const writer = scheduler.run({
    readiness: readyFrontier("TASK-WRITE-QUEUED"),
    executions: [
      {
        taskId: "TASK-WRITE-QUEUED",
        repositoryAccess: "exclusive-write",
        run: async () => {
          events.push("run:writer");
          return { kind: "succeeded", value: "writer" };
        },
        persist: async (outcome) => {
          events.push(`persist:writer:${outcome.kind}`);
        },
      },
    ] satisfies readonly InitiativeNodeExecution<string>[],
  });

  releaseRead.resolve();
  const [readResult, writerResult] = await Promise.all([readWave, writer]);

  assert.equal(readResult.status, "completed");
  assert.equal(writerResult.status, "completed");
  assert.deepEqual(events, [
    "run:read",
    "persist:read:succeeded",
    "run:writer",
    "persist:writer:succeeded",
  ]);
});

test("A Read Wave continues persisting later outcomes after one persistence failure", async () => {
  const scheduler = new InitiativeExecutionScheduler();
  const persistenceFailure = new Error("First persistence failed.");
  const events: string[] = [];
  let writerStarted = false;

  const result = await scheduler.run({
    readiness: readyFrontier("TASK-READ-PERSIST-FAIL", "TASK-READ-PERSIST-LATER", "TASK-WRITE"),
    executions: [
      {
        taskId: "TASK-READ-PERSIST-FAIL",
        repositoryAccess: "read-only",
        run: async () => ({ kind: "succeeded", value: "first" }),
        persist: async () => {
          events.push("persist:first");
          throw persistenceFailure;
        },
      },
      {
        taskId: "TASK-READ-PERSIST-LATER",
        repositoryAccess: "read-only",
        run: async () => ({ kind: "succeeded", value: "later" }),
        persist: async () => {
          events.push("persist:later");
        },
      },
      {
        taskId: "TASK-WRITE",
        repositoryAccess: "exclusive-write",
        run: async () => {
          writerStarted = true;
          return { kind: "succeeded", value: "write" };
        },
        persist: async () => {
          assert.fail("A Reader persistence failure must block Writer work.");
        },
      },
    ] satisfies readonly InitiativeNodeExecution<string>[],
  });

  assert.equal(result.status, "failed");
  if (result.status === "failed") {
    assert.equal(result.failure.taskId, "TASK-READ-PERSIST-FAIL");
    assert.equal(result.failure.error, persistenceFailure);
  }
  assert.deepEqual(events, ["persist:first", "persist:later"]);
  assert.deepEqual(
    result.results.map((entry) => entry.taskId),
    ["TASK-READ-PERSIST-LATER"],
  );
  assert.equal(writerStarted, false);
  assert.equal(scheduler.barrier.activeWriterOwner, null);
});

test("Default Initiative schedulers share one Reader Writer barrier", async () => {
  const readerScheduler = new InitiativeExecutionScheduler();
  const writerScheduler = new InitiativeExecutionScheduler();
  const readerStarted = deferred<void>();
  const releaseReader = deferred<void>();
  let writerStarted = false;

  const reader = readerScheduler.barrier.runReadWave(
    async () => {
      readerStarted.resolve();
      await releaseReader.promise;
    },
    { kind: "read-wave-results", taskIds: ["TASK-SHARED-READER"] },
    async () => undefined,
  );
  await readerStarted.promise;
  const writer = writerScheduler.barrier.runWriter(
    { kind: "node", taskId: "TASK-SHARED-WRITER" },
    async () => {
      writerStarted = true;
    },
  );

  await Promise.resolve();
  assert.equal(writerStarted, false);
  releaseReader.resolve();
  await Promise.all([reader, writer]);
  assert.equal(writerStarted, true);
});
