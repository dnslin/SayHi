# Issue 26 — Parallel Read-Wave Scheduler

## Scope

Implement the Initiative execution coordinator in Core. It consumes the ready frontier produced by issue #25, runs every ready `read-only` node concurrently, persists every completed read outcome, then admits `exclusive-write` and `read-only-plus-exclusive-validation` nodes one at a time. One scheduler/barrier instance is shared by one checkout.

## Public seam

`InitiativeExecutionScheduler.run()` is the Core application-service seam. Its request carries the authoritative `InitiativeReadinessResult`, one execution/persistence pair per ready Task, and an optional `AbortSignal`. `InitiativeReadWriteBarrier` exposes the shared barrier for callers that coordinate more than one scheduler.

The scheduler, not the caller, determines a node's lane from its capability-sealed `AgentRepositoryAccess`:

- `read-only` nodes form one parallel **Read Wave**;
- `exclusive-write` and `read-only-plus-exclusive-validation` nodes use the **Writer barrier**.

Each `persist()` invocation is the Orchestrator's durable-result acknowledgement. Reader persistence happens only after its entire Read Wave settles and under the Writer barrier; execution of a writer node and persistence of its outcome share one Writer acquisition. Therefore no reader observes persistence or writer mutation, and a following writer starts only after the Read Wave results are durable.

## Failure and cancellation rules

- Reader outcomes are all persisted, including failures and cancellations. A failed or cancelled Read Wave prevents every writer from starting.
- A persistence failure prevents every later writer from starting.
- A writer outcome is persisted before the barrier releases; failed or cancelled writers prevent later writers.
- The barrier releases its owner in `finally`, tracks no owner after a terminal result, and blocks new readers once a writer is waiting. This prevents overlapping writers and writer starvation.

## Test plan

Contract tests exercise the public scheduler seam with controlled promises:

1. two ready read-only nodes begin before either completes, their outcomes are persisted before an independent writer begins, and writers execute in frontier order;
2. a reader failure is persisted and prevents all writers;
3. cancellation after reader start prevents writers and leaves no active checkout owner;
4. a failed writer releases the shared barrier, allowing a later schedule to acquire it without overlap.

No Task schema, Workflow Event, CLI command, or OMP adapter changes are required: readiness is already durable and this service delegates durable result recording to the existing Orchestrator callback.
