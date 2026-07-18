import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { promisify } from "node:util";

import { NodeManagedProjectFileSystem, runCli, type CliJsonEnvelope } from "@dnslin/sayhi-cli";
import {
  advanceDurableTask,
  archiveDurableTask,
  coreContract,
  createDurableTask,
  InitiativeExecutionScheduler,
  inspectDurableInitiativeGraph,
  readDurableTask,
  recoverDurableTask,
  reviseDurableInitiativeGraph,
  readGateEvidenceKinds,
  type DependencyGraph,
  type StartWorkflowTaskRequest,
  type TransitionWorkflowRequest,
  type WorkflowPhase,
  type WorkflowRoute,
  type WorkflowState,
} from "@dnslin/sayhi-core";

import {
  completeDurableTask,
  createCompletedDurableTask,
  type TaskLifecycleFixture,
} from "./task-lifecycle-test-support.js";

const INITIATIVE_ID = "TASK-14-INITIATIVE";
const GRAPH_ID = "GRAPH-14";
const RECORDED_NODE_ID = "TASK-14-NODE-RECORDED";
const MISSING_NODE_ID = "TASK-14-NODE-MISSING";
const executeFile = promisify(execFile);

test("Core stores an Initiative graph and CLI inspection reports its dependencies and node status", async (t) => {
  const fixture = await createInitiativeGraphFixture(t);
  const writerLease = trackWriterLease(fixture.fileSystem);

  const { graphPath } = fixture;
  assert.deepEqual(JSON.parse(await readFile(graphPath, "utf8")), fixture.graph);

  const inspected = await inspectDurableInitiativeGraph({
    fileSystem: writerLease.fileSystem,
    initiativeTaskId: INITIATIVE_ID,
  });
  assert.equal(inspected.ok, true);
  if (!inspected.ok) {
    return;
  }
  assert.deepEqual(inspected.graph, fixture.graph);
  assert.equal(writerLease.acquired(), true);
  assert.deepEqual(inspected.nodes, [
    {
      taskId: RECORDED_NODE_ID,
      dependencies: [],
      status: {
        state: "recorded",
        lifecycle: "active",
        phase: "triage",
        step: "ready",
        version: 1,
      },
    },
    {
      taskId: MISSING_NODE_ID,
      dependencies: [
        {
          taskId: RECORDED_NODE_ID,
          type: "blocks",
          reason: "The recorded node must finish first.",
        },
      ],
      status: { state: "missing" },
    },
  ]);

  const shown = await runCli([
    "graph",
    "show",
    INITIATIVE_ID,
    "--cwd",
    fixture.repository,
    "--json",
  ]);
  assert.equal(shown.exitCode, 0);
  const envelope = JSON.parse(shown.stdout) as CliJsonEnvelope;
  assert.equal(envelope.operation, "graph.show");
  assert.deepEqual(envelope.result?.graph, fixture.graph);
  assert.deepEqual(envelope.result?.nodes, inspected.nodes);
});

test("Core derives the ready Initiative frontier from local durable Task state", async (t) => {
  const fixture = await createInitiativeGraphFixture(t);

  const derived = await coreContract.inspectDurableInitiativeReadiness({
    fileSystem: fixture.fileSystem,
    initiativeTaskId: INITIATIVE_ID,
  });
  assert.equal(derived.ok, true);
  if (!derived.ok) {
    return;
  }
  assert.deepEqual(
    derived.nodes.map((node) => ({
      taskId: node.taskId,
      readiness: node.readiness,
      blockerCodes: node.blockers.map((blocker) => blocker.code),
    })),
    [
      {
        taskId: RECORDED_NODE_ID,
        readiness: "ready",
        blockerCodes: [],
      },
      {
        taskId: MISSING_NODE_ID,
        readiness: "waiting",
        blockerCodes: [
          "initiative_readiness.task_missing",
          "initiative_readiness.dependency_incomplete",
        ],
      },
    ],
  );
  assert.deepEqual(derived.frontier, [RECORDED_NODE_ID]);

  const replayed = await coreContract.inspectDurableInitiativeReadiness({
    fileSystem: fixture.fileSystem,
    initiativeTaskId: INITIATIVE_ID,
  });
  assert.deepEqual(replayed, derived);

  const shown = await runCli([
    "graph",
    "ready",
    INITIATIVE_ID,
    "--cwd",
    fixture.repository,
    "--json",
  ]);
  assert.equal(shown.exitCode, 0);
  const envelope = JSON.parse(shown.stdout) as CliJsonEnvelope;
  assert.equal(envelope.operation, "graph.ready");
  assert.deepEqual(envelope.result?.frontier, derived.frontier);
  assert.deepEqual(envelope.result?.nodes, derived.nodes);
});

test("Core rejects Initiative readiness derived for a stale graph version", async (t) => {
  const fixture = await createInitiativeGraphFixture(t);
  const request = {
    fileSystem: fixture.fileSystem,
    initiativeTaskId: INITIATIVE_ID,
    expectedGraphVersion: fixture.graph.version + 1,
  };

  const derived = await coreContract.inspectDurableInitiativeReadiness(request);
  assert.equal(derived.ok, false);
  if (derived.ok) {
    return;
  }
  assert.equal(derived.diagnostics[0]?.code, "workflow.version.stale");
  assert.equal(derived.diagnostics[0]?.path, "$.expectedGraphVersion");

  const shown = await runCli([
    "graph",
    "ready",
    INITIATIVE_ID,
    "--expected-graph-version",
    String(fixture.graph.version + 1),
    "--cwd",
    fixture.repository,
    "--json",
  ]);
  assert.equal(
    (JSON.parse(shown.stdout) as CliJsonEnvelope).error?.code,
    "workflow.version.stale",
  );
});

test("Core holds a Node outside the frontier when its required triage Context is missing", async (t) => {
  const fixture = await createInitiativeGraphFixture(t);
  await rm(
    join(
      fixture.repository,
      ".sayhi",
      "tasks",
      RECORDED_NODE_ID,
      "context",
      "triage.jsonl",
    ),
  );

  const derived = await coreContract.inspectDurableInitiativeReadiness({
    fileSystem: fixture.fileSystem,
    initiativeTaskId: INITIATIVE_ID,
  });
  assert.equal(derived.ok, true);
  if (!derived.ok) {
    return;
  }
  assert.deepEqual(
    derived.nodes.map((node) => ({
      taskId: node.taskId,
      readiness: node.readiness,
      blockerCodes: node.blockers.map((blocker) => blocker.code),
    })),
    [
      {
        taskId: RECORDED_NODE_ID,
        readiness: "waiting",
        blockerCodes: ["initiative_readiness.task_context_invalid"],
      },
      {
        taskId: MISSING_NODE_ID,
        readiness: "waiting",
        blockerCodes: [
          "initiative_readiness.task_missing",
          "initiative_readiness.dependency_incomplete",
        ],
      },
    ],
  );
  assert.deepEqual(derived.frontier, []);
});

test("Core treats an archived completed Node Task as satisfying its blocking dependency", async (t) => {
  const fixture = await createInitiativeGraphFixture(t, "archived");

  const derived = await coreContract.inspectDurableInitiativeReadiness({
    fileSystem: fixture.fileSystem,
    initiativeTaskId: INITIATIVE_ID,
  });
  assert.equal(derived.ok, true);
  if (!derived.ok) {
    return;
  }
  assert.deepEqual(
    derived.nodes.map((node) => ({
      taskId: node.taskId,
      readiness: node.readiness,
      blockerCodes: node.blockers.map((blocker) => blocker.code),
    })),
    [
      {
        taskId: RECORDED_NODE_ID,
        readiness: "completed",
        blockerCodes: [],
      },
      {
        taskId: MISSING_NODE_ID,
        readiness: "waiting",
        blockerCodes: ["initiative_readiness.task_missing"],
      },
    ],
  );
});

test("Core records an approved Initiative graph revision without changing its durable node identities", async (t) => {
  const fixture = await createInitiativeGraphFixture(t);
  const before = await readDurableTask({
    fileSystem: fixture.fileSystem,
    taskId: INITIATIVE_ID,
  });
  assert.equal(before.ok, true);
  if (!before.ok) {
    return;
  }
  const event = revisionEvent("CORE-REVISED");
  const revision = revisedGraph(fixture.graph, event.eventId);
  const revised = await reviseDurableInitiativeGraph({
    fileSystem: fixture.fileSystem,
    taskId: INITIATIVE_ID,
    expectedVersion: before.state.projection.version,
    expectedGraphVersion: fixture.graph.version,
    graph: revision,
    event,
  });

  assert.equal(revised.ok, true);
  if (!revised.ok) {
    return;
  }
  assert.equal(revised.event.type, "initiative_graph_revised");
  assert.equal(revised.event.expectedGraphVersion, fixture.graph.version);
  assert.deepEqual(revised.event.initiativeGraph, revision);
  assert.equal(revised.state.projection.phase, "integrate");
  assert.deepEqual(
    revised.event.initiativeGraph.nodes.map((node) => node.taskId),
    fixture.graph.nodes.map((node) => node.taskId),
  );

  const { graphPath } = fixture;
  assert.deepEqual(JSON.parse(await readFile(graphPath, "utf8")), revision);
  await rm(graphPath);
  const recovered = await recoverDurableTask({
    fileSystem: fixture.fileSystem,
    taskId: INITIATIVE_ID,
  });
  assert.equal(recovered.ok, true);
  assert.deepEqual(JSON.parse(await readFile(graphPath, "utf8")), revision);
  await writeFile(graphPath, `${JSON.stringify(fixture.graph)}\n`, "utf8");
  const stale = await inspectDurableInitiativeGraph({
    fileSystem: fixture.fileSystem,
    initiativeTaskId: INITIATIVE_ID,
  });
  assert.equal(stale.ok, false);
  if (!stale.ok) {
    assert.equal(stale.diagnostics[0]?.code, "initiative_graph.record.stale");
  }
  const repaired = await recoverDurableTask({
    fileSystem: fixture.fileSystem,
    taskId: INITIATIVE_ID,
  });
  assert.equal(repaired.ok, true);
  const inspected = await inspectDurableInitiativeGraph({
    fileSystem: fixture.fileSystem,
    initiativeTaskId: INITIATIVE_ID,
  });
  assert.equal(inspected.ok, true);
  if (inspected.ok) {
    assert.deepEqual(inspected.graph, revision);
  }
});

test("Initiative graph revision acquires the shared Writer Lease", async (t) => {
  const fixture = await createInitiativeGraphFixture(t);
  const before = await readDurableTask({
    fileSystem: fixture.fileSystem,
    taskId: INITIATIVE_ID,
  });
  assert.equal(before.ok, true);
  if (!before.ok) {
    return;
  }
  const writerLease = trackWriterLease(fixture.fileSystem);
  const event = revisionEvent("WRITER-LEASE");
  const revised = await reviseDurableInitiativeGraph({
    fileSystem: writerLease.fileSystem,
    taskId: INITIATIVE_ID,
    expectedVersion: before.state.projection.version,
    expectedGraphVersion: fixture.graph.version,
    graph: revisedGraph(fixture.graph, event.eventId),
    event,
  });

  assert.equal(writerLease.acquired(), true);
  assert.equal(revised.ok, true);
});

test("Initiative graph revision repairs its Projection after a transient graph write failure", async (t) => {
  const fixture = await createInitiativeGraphFixture(t);
  const before = await readDurableTask({
    fileSystem: fixture.fileSystem,
    taskId: INITIATIVE_ID,
  });
  assert.equal(before.ok, true);
  if (!before.ok) {
    return;
  }
  const graphRecordPath = `.sayhi/tasks/${INITIATIVE_ID}/graph.json`;
  let failGraphWrite = true;
  const faultingFileSystem = new Proxy(fixture.fileSystem, {
    get(target, property, receiver) {
      if (property === "writeFile") {
        return async (path: string, content: string) => {
          if (path === graphRecordPath && failGraphWrite) {
            failGraphWrite = false;
            throw new Error("Injected Initiative graph write failure.");
          }
          await target.writeFile(path, content);
        };
      }
      const member = Reflect.get(target, property, receiver);
      return typeof member === "function" ? member.bind(target) : member;
    },
  });
  const event = revisionEvent("RECOVERED-WRITE");
  const revision = revisedGraph(fixture.graph, event.eventId);
  const revised = await reviseDurableInitiativeGraph({
    fileSystem: faultingFileSystem,
    taskId: INITIATIVE_ID,
    expectedVersion: before.state.projection.version,
    expectedGraphVersion: fixture.graph.version,
    graph: revision,
    event,
  });

  assert.equal(revised.ok, true);
  assert.deepEqual(
    JSON.parse(
      await readFile(join(fixture.repository, graphRecordPath), "utf8"),
    ),
    revision,
  );
  const inspected = await inspectDurableInitiativeGraph({
    fileSystem: fixture.fileSystem,
    initiativeTaskId: INITIATIVE_ID,
  });
  assert.equal(inspected.ok, true);
});

test("Core rejects unsafe and stale Initiative graph revisions without replacing the accepted graph", async (t) => {
  const fixture = await createInitiativeGraphFixture(t);
  const before = await readDurableTask({
    fileSystem: fixture.fileSystem,
    taskId: INITIATIVE_ID,
  });
  assert.equal(before.ok, true);
  if (!before.ok) {
    return;
  }
  const { graphPath } = fixture;
  const acceptedGraphText = await readFile(graphPath, "utf8");
  const cases = [
    {
      name: "cycle",
      graph: {
        ...revisedGraph(fixture.graph, "EVENT-14-CYCLE"),
        edges: [
          ...fixture.graph.edges,
          {
            from: MISSING_NODE_ID,
            to: RECORDED_NODE_ID,
            type: "blocks" as const,
            reason: "Would create a cycle.",
          },
        ],
      },
      expectedGraphVersion: fixture.graph.version,
      code: "dependency_graph.cycle.detected",
    },
    {
      name: "dangling-edge",
      graph: {
        ...revisedGraph(fixture.graph, "EVENT-14-DANGLING"),
        edges: [
          {
            from: RECORDED_NODE_ID,
            to: "TASK-14-NODE-UNKNOWN",
            type: "blocks" as const,
            reason: "References an unknown Build Task.",
          },
        ],
      },
      expectedGraphVersion: fixture.graph.version,
      code: "dependency_graph.edge.reference_missing",
    },
    {
      name: "node-identity-rewrite",
      graph: {
        ...revisedGraph(fixture.graph, "EVENT-14-REWRITE"),
        nodes: [fixture.graph.nodes[0]!],
        edges: [],
      },
      expectedGraphVersion: fixture.graph.version,
      code: "workflow.graph.invalid",
    },
    {
      name: "repair-bypass",
      graph: {
        ...revisedGraph(fixture.graph, "EVENT-14-REPAIR-BYPASS"),
        nodes: [
          ...fixture.graph.nodes,
          {
            taskId: "TASK-14-REPAIR-BYPASS",
            priority: 30,
            resources: { files: [], apis: [], schemas: [], locks: [] },
            repair: {
              failureKind: "acceptance-failed" as const,
              summary: "Bypasses durable Integration Repair creation.",
              evidence: [
                {
                  kind: "validation" as const,
                  reference: "evidence/repair-bypass.json",
                },
              ],
            },
            repairIntent: {
              goals: ["Repair the bypassed Integration failure."],
              nonGoals: [],
              acceptanceCriteria: ["The parent integration validation passes."],
            },
          },
        ],
        edges: [
          ...fixture.graph.edges,
          {
            from: RECORDED_NODE_ID,
            to: "TASK-14-REPAIR-BYPASS",
            type: "blocks" as const,
            reason: "The Repair must not bypass its completed Build predecessor.",
          },
        ],
      },
      expectedGraphVersion: fixture.graph.version,
      code: "workflow.graph.invalid",
    },
    {
      name: "stale-graph-version",
      graph: revisedGraph(fixture.graph, "EVENT-14-STALE"),
      expectedGraphVersion: fixture.graph.version + 1,
      code: "workflow.version.stale",
    },
  ] as const;

  for (const candidate of cases) {
    const rejected = await reviseDurableInitiativeGraph({
      fileSystem: fixture.fileSystem,
      taskId: INITIATIVE_ID,
      expectedVersion: before.state.projection.version,
      expectedGraphVersion: candidate.expectedGraphVersion,
      graph: candidate.graph,
      event: revisionEvent(candidate.name.toUpperCase()),
    });
    assert.equal(rejected.ok, false, candidate.name);
    if (!rejected.ok) {
      assert.equal(rejected.diagnostics[0]?.code, candidate.code, candidate.name);
    }
    assert.equal(await readFile(graphPath, "utf8"), acceptedGraphText, candidate.name);
    const after = await readDurableTask({
      fileSystem: fixture.fileSystem,
      taskId: INITIATIVE_ID,
    });
    assert.deepEqual(after, before, candidate.name);
  }
  const duplicateEvent = {
    ...revisionEvent("DUPLICATE-EVENT"),
    eventId: fixture.graph.updatedByEvent,
  };
  const duplicate = await reviseDurableInitiativeGraph({
    fileSystem: fixture.fileSystem,
    taskId: INITIATIVE_ID,
    expectedVersion: before.state.projection.version,
    expectedGraphVersion: fixture.graph.version,
    graph: revisedGraph(fixture.graph, duplicateEvent.eventId),
    event: duplicateEvent,
  });
  assert.equal(duplicate.ok, false);
  if (!duplicate.ok) {
    assert.equal(duplicate.diagnostics[0]?.code, "workflow.event.id_conflict");
  }
  assert.equal(await readFile(graphPath, "utf8"), acceptedGraphText);
});

test("CLI submits an approved Initiative graph revision through Core", async (t) => {
  const fixture = await createInitiativeGraphFixture(t);
  const before = await readDurableTask({
    fileSystem: fixture.fileSystem,
    taskId: INITIATIVE_ID,
  });
  assert.equal(before.ok, true);
  if (!before.ok) {
    return;
  }
  const event = revisionEvent("CLI-REVISED");
  const revision = revisedGraph(fixture.graph, event.eventId);
  await writeFile(
    join(fixture.repository, "revision.json"),
    `${JSON.stringify({
      taskId: INITIATIVE_ID,
      expectedVersion: before.state.projection.version,
      expectedGraphVersion: fixture.graph.version,
      graph: revision,
      event,
    })}\n`,
    "utf8",
  );

  const revised = await runCli([
    "graph",
    "revise",
    INITIATIVE_ID,
    "--from",
    "revision.json",
    "--apply",
    "--cwd",
    fixture.repository,
    "--json",
  ]);
  assert.equal(revised.exitCode, 0);
  const envelope = JSON.parse(revised.stdout) as CliJsonEnvelope;
  assert.equal(envelope.operation, "graph.revise");
  assert.deepEqual(envelope.result?.graph, revision);
  assert.equal(
    (envelope.result?.event as { type?: unknown } | undefined)?.type,
    "initiative_graph_revised",
  );
});

test("Task recovery rebuilds a missing Initiative graph record from accepted history", async (t) => {
  const fixture = await createInitiativeGraphFixture(t);
  const { graphPath } = fixture;
  await rm(graphPath);

  const recovered = await recoverDurableTask({
    fileSystem: fixture.fileSystem,
    taskId: INITIATIVE_ID,
  });
  assert.equal(recovered.ok, true);
  assert.deepEqual(JSON.parse(await readFile(graphPath, "utf8")), fixture.graph);
});

test("Task recovery replaces a corrupt Initiative graph projection from accepted history", async (t) => {
  const fixture = await createInitiativeGraphFixture(t);
  const { graphPath } = fixture;
  await writeFile(graphPath, "{", "utf8");

  const corrupt = await inspectDurableInitiativeGraph({
    fileSystem: fixture.fileSystem,
    initiativeTaskId: INITIATIVE_ID,
  });
  assert.equal(corrupt.ok, false);
  if (!corrupt.ok) {
    assert.equal(corrupt.diagnostics[0]?.code, "initiative_graph.record.invalid");
  }

  const recovered = await recoverDurableTask({
    fileSystem: fixture.fileSystem,
    taskId: INITIATIVE_ID,
  });
  assert.equal(recovered.ok, true);
  const restored = await inspectDurableInitiativeGraph({
    fileSystem: fixture.fileSystem,
    initiativeTaskId: INITIATIVE_ID,
  });
  assert.equal(restored.ok, true);
  if (restored.ok) {
    assert.deepEqual(restored.graph, fixture.graph);
  }
});

test("Graph inspection rejects invalid and incompatible records without changing Initiative state", async (t) => {
  const fixture = await createInitiativeGraphFixture(t);
  const { graphPath } = fixture;
  const before = await readDurableTask({
    fileSystem: fixture.fileSystem,
    taskId: INITIATIVE_ID,
  });
  assert.equal(before.ok, true);

  await writeFile(graphPath, "{", "utf8");
  const invalid = await inspectDurableInitiativeGraph({
    fileSystem: fixture.fileSystem,
    initiativeTaskId: INITIATIVE_ID,
  });
  assert.equal(invalid.ok, false);
  if (!invalid.ok) {
    assert.equal(invalid.diagnostics[0]?.code, "initiative_graph.record.invalid");
  }
  assert.equal(await readFile(graphPath, "utf8"), "{");

  await writeFile(
    graphPath,
    `${JSON.stringify({ ...fixture.graph, schemaVersion: 2 })}\n`,
    "utf8",
  );
  const incompatible = await inspectDurableInitiativeGraph({
    fileSystem: fixture.fileSystem,
    initiativeTaskId: INITIATIVE_ID,
  });
  assert.equal(incompatible.ok, false);
  if (!incompatible.ok) {
    assert.equal(
      incompatible.diagnostics[0]?.code,
      "dependency_graph.schema_version.unsupported",
    );
  }
  const shown = await runCli([
    "graph",
    "show",
    INITIATIVE_ID,
    "--cwd",
    fixture.repository,
    "--json",
  ]);
  assert.equal(shown.exitCode, 3);
  assert.equal(
    (JSON.parse(shown.stdout) as CliJsonEnvelope).error?.code,
    "dependency_graph.schema_version.unsupported",
  );
  await writeFile(
    graphPath,
    `${JSON.stringify({
      ...fixture.graph,
      updatedByEvent: "EVENT-14-NOT-ACCEPTED",
    })}\n`,
    "utf8",
  );
  const unbound = await inspectDurableInitiativeGraph({
    fileSystem: fixture.fileSystem,
    initiativeTaskId: INITIATIVE_ID,
  });
  assert.equal(unbound.ok, false);
  if (!unbound.ok) {
    assert.equal(unbound.diagnostics[0]?.code, "initiative_graph.event.mismatch");
  }
  const after = await readDurableTask({
    fileSystem: fixture.fileSystem,
    taskId: INITIATIVE_ID,
  });
  assert.deepEqual(after, before);
});

test("Integration creates a durable Repair node behind the Writer barrier and resumes scheduling", async (t) => {
  const scheduler = new InitiativeExecutionScheduler();
  const incompleteFixture = await createInitiativeGraphFixture(t);
  const incompleteParent = await readDurableTask({
    fileSystem: incompleteFixture.fileSystem,
    taskId: INITIATIVE_ID,
  });
  assert.equal(incompleteParent.ok, true);
  if (!incompleteParent.ok) {
    return;
  }
  const ineligible = await scheduler.integrate({
    fileSystem: incompleteFixture.fileSystem,
    initiativeTaskId: INITIATIVE_ID,
    expectedVersion: incompleteParent.state.projection.version,
    expectedGraphVersion: incompleteFixture.graph.version,
    event: revisionEvent("INTEGRATION-INCOMPLETE"),
    run: async () => {
      assert.fail("Integration must not run while durable Build nodes are incomplete.");
    },
  });
  assert.equal(ineligible.status, "waiting");
  if (ineligible.status === "waiting") {
    assert.deepEqual(ineligible.pendingTaskIds, [RECORDED_NODE_ID, MISSING_NODE_ID]);
  }

  const fixture = await createInitiativeGraphFixture(t, "completed");
  const parentBefore = await readDurableTask({
    fileSystem: fixture.fileSystem,
    taskId: INITIATIVE_ID,
  });
  assert.equal(parentBefore.ok, true);
  if (!parentBefore.ok) {
    return;
  }
  const event = revisionEvent("INTEGRATION-REPAIR");
  let releaseReader!: () => void;
  const readerReleased = new Promise<void>((resolve) => {
    releaseReader = resolve;
  });
  let signalReaderStarted!: () => void;
  const readerStarted = new Promise<void>((resolve) => {
    signalReaderStarted = resolve;
  });
  const reader = scheduler.barrier.runReadWave(
    async () => {
      signalReaderStarted();
      await readerReleased;
    },
    { kind: "read-wave-results", taskIds: ["TASK-14-READER"] },
    async () => undefined,
  );
  await readerStarted;

  const repairFixture = {
    taskId: "TASK-14-REPAIR",
    title: "Exercise TASK-14-REPAIR",
    goal: "Complete TASK-14-REPAIR",
    acceptanceCriterion: "TASK-14-REPAIR persists correctly",
    files: ["packages/core/**", "packages/cli/**"],
    eventNamespace: "14-REPAIR",
    sessionRef: "session-14",
  } as const;
  let integrationRan = false;
  const writerLease = trackWriterLease(fixture.fileSystem);
  const integration = scheduler.integrate({
    fileSystem: writerLease.fileSystem,
    initiativeTaskId: INITIATIVE_ID,
    expectedVersion: parentBefore.state.projection.version,
    expectedGraphVersion: fixture.graph.version,
    event,
    run: async () => {
      integrationRan = true;
      assert.deepEqual(scheduler.barrier.activeWriterOwner, {
        kind: "integration",
        initiativeTaskId: INITIATIVE_ID,
      });
      assert.equal(writerLease.acquired(), true);
      return {
        kind: "repair-required" as const,
        repairs: [
          {
            taskId: repairFixture.taskId,
            priority: 60,
            resources: {
              files: ["packages/core/**"],
              apis: ["InitiativeExecutionScheduler.integrate"],
              schemas: ["graph.json"],
              locks: [],
            },
            blockers: [RECORDED_NODE_ID, MISSING_NODE_ID],
            context: {
              failureKind: "acceptance-failed",
              summary: "Parent integration validation failed.",
              evidence: [
                {
                  kind: "validation",
                  reference: "evidence/integration-failure.json",
                },
              ],
            },
            intent: {
              goals: ["Repair the failed parent integration validation."],
              nonGoals: [],
              acceptanceCriteria: [
                "The parent integration validation passes with the repaired Build output.",
              ],
            },
          },
        ],
      };
    },
  });

  await Promise.resolve();
  assert.equal(integrationRan, false);
  releaseReader();
  await reader;

  const integrated = await integration;
  assert.equal(integrated.status, "repair-required");
  assert.equal(writerLease.acquired(), true);
  if (integrated.status !== "repair-required") {
    return;
  }
  const repairGraph = integrated.graph;
  assert.deepEqual(
    repairGraph.nodes.slice(0, fixture.graph.nodes.length),
    fixture.graph.nodes,
  );
  assert.deepEqual(repairGraph.nodes.at(-1), {
    taskId: repairFixture.taskId,
    priority: 60,
    resources: {
      files: ["packages/core/**"],
      apis: ["InitiativeExecutionScheduler.integrate"],
      schemas: ["graph.json"],
      locks: [],
    },
    repair: {
      failureKind: "acceptance-failed",
      summary: "Parent integration validation failed.",
      evidence: [
        {
          kind: "validation",
          reference: "evidence/integration-failure.json",
        },
      ],
    },
    repairIntent: {
      goals: ["Repair the failed parent integration validation."],
      nonGoals: [],
      acceptanceCriteria: [
        "The parent integration validation passes with the repaired Build output.",
      ],
    },
  });
  assert.deepEqual(
    repairGraph.edges.filter((edge) => edge.to === repairFixture.taskId),
    [
      {
        from: RECORDED_NODE_ID,
        to: repairFixture.taskId,
        type: "blocks",
        reason: "Parent integration validation failed.",
      },
      {
        from: MISSING_NODE_ID,
        to: repairFixture.taskId,
        type: "blocks",
        reason: "Parent integration validation failed.",
      },
    ],
  );

  const durable = await inspectDurableInitiativeGraph({
    fileSystem: fixture.fileSystem,
    initiativeTaskId: INITIATIVE_ID,
  });
  assert.equal(durable.ok, true);
  if (!durable.ok) {
    return;
  }
  assert.deepEqual(durable.graph, repairGraph);
  assert.deepEqual(
    JSON.parse(
      await readFile(
        join(
          fixture.repository,
          ".sayhi",
          ".runtime",
          "initiative-repair-operation.json",
        ),
        "utf8",
      ),
    ),
    {
      schemaVersion: 1,
      initiativeTaskId: INITIATIVE_ID,
      graphEventId: event.eventId,
      repairTaskIds: [repairFixture.taskId],
      state: "completed",
    },
  );
  const parentAfter = await readDurableTask({
    fileSystem: fixture.fileSystem,
    taskId: INITIATIVE_ID,
  });
  assert.equal(parentAfter.ok, true);
  if (!parentAfter.ok) {
    return;
  }
  assert.deepEqual(
    parentAfter.state.events.slice(0, parentBefore.state.events.length),
    parentBefore.state.events,
  );
  const repair = await readDurableTask({
    fileSystem: fixture.fileSystem,
    taskId: repairFixture.taskId,
  });
  assert.equal(repair.ok, true);
  if (!repair.ok) {
    return;
  }
  assert.equal(repair.state.projection.route, "build");
  assert.equal(repair.state.projection.parentTaskId, INITIATIVE_ID);
  assert.deepEqual(repair.state.projection.intent, {
    goals: ["Repair the failed parent integration validation."],
    nonGoals: [],
    acceptanceCriteria: [
      "The parent integration validation passes with the repaired Build output.",
    ],
  });
  await writeTriageContext(fixture.repository, repairFixture.taskId);

  const ready = await coreContract.inspectDurableInitiativeReadiness({
    fileSystem: fixture.fileSystem,
    initiativeTaskId: INITIATIVE_ID,
    expectedGraphVersion: repairGraph.version,
  });
  assert.equal(ready.ok, true);
  if (!ready.ok) {
    return;
  }
  assert.deepEqual(ready.frontier, [repairFixture.taskId]);
  const repairScheduled = await scheduler.run({
    readiness: ready,
    executions: [
      {
        taskId: repairFixture.taskId,
        repositoryAccess: "exclusive-write",
        run: async () => ({ kind: "succeeded" as const, value: undefined }),
        persist: async () => undefined,
      },
    ],
  });
  assert.equal(repairScheduled.status, "completed");

  const completedRepair = await completeDurableTask(
    fixture.fileSystem,
    repairFixture,
    repair.state,
    "2026-07-15T10:10:00Z",
  );
  assert.equal(completedRepair.projection.lifecycle, "completed");
  const archivedRepair = await archiveDurableTask({
    fileSystem: fixture.fileSystem,
    transition: {
      contractVersion: 1,
      taskId: repairFixture.taskId,
      expectedVersion: completedRepair.projection.version,
      to: { lifecycle: "archived", phase: "finish", step: "archived" },
      gates: [
        {
          gate: "archive",
          evidence: [
            { kind: "validation", reference: "evidence/repair-archived.json" },
          ],
        },
      ],
      event: revisionEvent("REPAIR-ARCHIVED"),
    },
  });
  assert.equal(archivedRepair.ok, true);
  if (!archivedRepair.ok) {
    return;
  }
  const recoveredArchivedRepair = await recoverDurableTask({
    fileSystem: fixture.fileSystem,
    taskId: INITIATIVE_ID,
  });
  assert.equal(recoveredArchivedRepair.ok, true);
  const activeArchivedRepair = await readDurableTask({
    fileSystem: fixture.fileSystem,
    taskId: repairFixture.taskId,
  });
  assert.equal(activeArchivedRepair.ok, false);
  const reentered = await scheduler.integrate({
    fileSystem: fixture.fileSystem,
    initiativeTaskId: INITIATIVE_ID,
    expectedVersion: parentAfter.state.projection.version,
    expectedGraphVersion: repairGraph.version,
    event: revisionEvent("INTEGRATION-PASSED"),
    run: async () => ({ kind: "accepted" as const }),
  });
  assert.equal(reentered.status, "completed");
});

test("Task recovery creates missing Repair children after an interrupted Integration", async (t) => {
  const fixture = await createInitiativeGraphFixture(t, "completed");
  const parent = await readDurableTask({
    fileSystem: fixture.fileSystem,
    taskId: INITIATIVE_ID,
  });
  assert.equal(parent.ok, true);
  if (!parent.ok) {
    return;
  }
  const repairTaskId = "TASK-14-RECOVERY-REPAIR";
  let failRepairCreation = true;
  const faultingFileSystem = new Proxy(fixture.fileSystem, {
    get(target, property, receiver) {
      if (property === "appendFile") {
        return async (path: string, content: string) => {
          if (
            failRepairCreation &&
            path === `.sayhi/tasks/${repairTaskId}/events.jsonl`
          ) {
            failRepairCreation = false;
            throw new Error("Injected Repair Task creation interruption.");
          }
          await target.appendFile(path, content);
        };
      }
      const member = Reflect.get(target, property, receiver);
      return typeof member === "function" ? member.bind(target) : member;
    },
  });
  const interrupted = await new InitiativeExecutionScheduler().integrate({
    fileSystem: faultingFileSystem,
    initiativeTaskId: INITIATIVE_ID,
    expectedVersion: parent.state.projection.version,
    expectedGraphVersion: fixture.graph.version,
    event: revisionEvent("RECOVERY-REPAIR"),
    run: async () => ({
      kind: "repair-required" as const,
      repairs: [
        {
          taskId: repairTaskId,
          priority: 60,
          resources: { files: [], apis: [], schemas: [], locks: [] },
          blockers: [RECORDED_NODE_ID],
          context: {
            failureKind: "conflict",
            summary: "Integration found incompatible generated output.",
            evidence: [
              {
                kind: "validation",
                reference: "evidence/integration-conflict.json",
              },
            ],
          },
          intent: {
            goals: ["Resolve the incompatible generated output."],
            nonGoals: [],
            acceptanceCriteria: ["Integration accepts the regenerated output."],
          },
        },
      ],
    }),
  });
  assert.equal(interrupted.status, "failed");
  const graph = await inspectDurableInitiativeGraph({
    fileSystem: fixture.fileSystem,
    initiativeTaskId: INITIATIVE_ID,
  });
  assert.equal(graph.ok, true);
  if (!graph.ok) {
    return;
  }
  assert.equal(graph.graph.nodes.at(-1)?.taskId, repairTaskId);

  const recovered = await recoverDurableTask({
    fileSystem: fixture.fileSystem,
    taskId: INITIATIVE_ID,
  });
  if (!recovered.ok) {
    assert.fail(recovered.diagnostics[0]?.message ?? "Repair recovery failed");
  }
  assert.equal(recovered.recovered, true);
  assert.equal(
    JSON.parse(
      await readFile(
        join(
          fixture.repository,
          ".sayhi",
          ".runtime",
          "initiative-repair-operation.json",
        ),
        "utf8",
      ),
    ).state,
    "completed",
  );
  const repair = await readDurableTask({
    fileSystem: fixture.fileSystem,
    taskId: repairTaskId,
  });
  assert.equal(repair.ok, true);
  if (repair.ok) {
    assert.equal(repair.state.projection.parentTaskId, INITIATIVE_ID);
  }
});

test("Task recovery rebuilds a Repair child Projection after its Event persists", async (t) => {
  const fixture = await createInitiativeGraphFixture(t, "completed");
  const parent = await readDurableTask({
    fileSystem: fixture.fileSystem,
    taskId: INITIATIVE_ID,
  });
  assert.equal(parent.ok, true);
  if (!parent.ok) {
    return;
  }
  const repairTaskId = "TASK-14-RECOVERY-PROJECTION";
  let failProjectionWrite = true;
  const faultingFileSystem = new Proxy(fixture.fileSystem, {
    get(target, property, receiver) {
      if (property === "writeFile") {
        return async (path: string, content: string) => {
          if (
            failProjectionWrite &&
            path === `.sayhi/tasks/${repairTaskId}/task.json`
          ) {
            failProjectionWrite = false;
            throw new Error("Injected Repair Projection write interruption.");
          }
          await target.writeFile(path, content);
        };
      }
      const member = Reflect.get(target, property, receiver);
      return typeof member === "function" ? member.bind(target) : member;
    },
  });
  const interrupted = await new InitiativeExecutionScheduler().integrate({
    fileSystem: faultingFileSystem,
    initiativeTaskId: INITIATIVE_ID,
    expectedVersion: parent.state.projection.version,
    expectedGraphVersion: fixture.graph.version,
    event: revisionEvent("RECOVERY-PROJECTION"),
    run: async () => ({
      kind: "repair-required" as const,
      repairs: [
        {
          taskId: repairTaskId,
          priority: 60,
          resources: { files: [], apis: [], schemas: [], locks: [] },
          blockers: [RECORDED_NODE_ID],
          context: {
            failureKind: "conflict",
            summary: "Integration found incompatible generated output.",
            evidence: [
              {
                kind: "validation",
                reference: "evidence/integration-conflict.json",
              },
            ],
          },
          intent: {
            goals: ["Resolve the incompatible generated output."],
            nonGoals: [],
            acceptanceCriteria: ["Integration accepts the regenerated output."],
          },
        },
      ],
    }),
  });
  assert.equal(interrupted.status, "failed");
  const projectionPath = join(
    fixture.repository,
    ".sayhi",
    "tasks",
    repairTaskId,
    "task.json",
  );
  await assert.rejects(readFile(projectionPath, "utf8"), { code: "ENOENT" });

  const recovered = await recoverDurableTask({
    fileSystem: fixture.fileSystem,
    taskId: INITIATIVE_ID,
  });
  assert.equal(recovered.ok, true);
  if (!recovered.ok) {
    return;
  }
  assert.equal(recovered.recovered, true);
  assert.equal(
    JSON.parse(await readFile(projectionPath, "utf8")).id,
    repairTaskId,
  );
});

test("Integration rejects an unrelated child Build at a Repair task identity", async (t) => {
  const fixture = await createInitiativeGraphFixture(t, "completed");
  const parent = await readDurableTask({
    fileSystem: fixture.fileSystem,
    taskId: INITIATIVE_ID,
  });
  assert.equal(parent.ok, true);
  if (!parent.ok) {
    return;
  }
  const repairTaskId = "TASK-14-REPAIR-IDENTITY";
  const unrelated = await createDurableTask({
    fileSystem: fixture.fileSystem,
    start: startRequest(
      repairTaskId,
      "build",
      null,
      "UNRELATED-REPAIR-IDENTITY",
      INITIATIVE_ID,
    ),
  });
  assert.equal(unrelated.ok, true);
  if (!unrelated.ok) {
    return;
  }

  const integration = await new InitiativeExecutionScheduler().integrate({
    fileSystem: fixture.fileSystem,
    initiativeTaskId: INITIATIVE_ID,
    expectedVersion: parent.state.projection.version,
    expectedGraphVersion: fixture.graph.version,
    event: revisionEvent("REPAIR-IDENTITY"),
    run: async () => ({
      kind: "repair-required" as const,
      repairs: [
        {
          taskId: repairTaskId,
          priority: 60,
          resources: { files: [], apis: [], schemas: [], locks: [] },
          blockers: [RECORDED_NODE_ID],
          context: {
            failureKind: "conflict",
            summary: "Integration found incompatible generated output.",
            evidence: [
              {
                kind: "validation",
                reference: "evidence/integration-conflict.json",
              },
            ],
          },
          intent: {
            goals: ["Resolve the incompatible generated output."],
            nonGoals: [],
            acceptanceCriteria: ["Integration accepts the regenerated output."],
          },
        },
      ],
    }),
  });
  assert.equal(integration.status, "failed");
});


test(
  "Initiative demo recovers its writer frontier, completes a Repair, and reaches terminal completion",
  async (t) => {
    const fixture = await createInitiativeGraphFixture(t);
    await initializeGitRepository(fixture.repository);
    const scheduler = new InitiativeExecutionScheduler();
    const readerTwoTaskId = "TASK-14-DEMO-READER-TWO";
    const writerOneTaskId = "TASK-14-DEMO-WRITER-ONE";
    const writerTwoTaskId = "TASK-14-DEMO-WRITER-TWO";
    type InitiativeDemoNode = TaskLifecycleFixture & Readonly<{ priority: number }>;
    const nodeFixtures = [
      {
        taskId: RECORDED_NODE_ID,
        title: `Exercise ${RECORDED_NODE_ID}`,
        goal: `Complete ${RECORDED_NODE_ID}`,
        acceptanceCriterion: `${RECORDED_NODE_ID} persists correctly`,
        files: ["packages/core/**"],
        eventNamespace: "14-DEMO-READER-ONE",
        sessionRef: "session-14-demo",
        priority: 50,
      },
      {
        taskId: readerTwoTaskId,
        title: `Exercise ${readerTwoTaskId}`,
        goal: `Complete ${readerTwoTaskId}`,
        acceptanceCriterion: `${readerTwoTaskId} persists correctly`,
        files: ["packages/testing/**"],
        eventNamespace: "14-DEMO-READER-TWO",
        sessionRef: "session-14-demo",
        priority: 40,
      },
      {
        taskId: writerOneTaskId,
        title: `Exercise ${writerOneTaskId}`,
        goal: `Complete ${writerOneTaskId}`,
        acceptanceCriterion: `${writerOneTaskId} persists correctly`,
        files: ["packages/core/**"],
        eventNamespace: "14-DEMO-WRITER-ONE",
        sessionRef: "session-14-demo",
        priority: 30,
      },
      {
        taskId: writerTwoTaskId,
        title: `Exercise ${writerTwoTaskId}`,
        goal: `Complete ${writerTwoTaskId}`,
        acceptanceCriterion: `${writerTwoTaskId} persists correctly`,
        files: ["packages/cli/**"],
        eventNamespace: "14-DEMO-WRITER-TWO",
        sessionRef: "session-14-demo",
        priority: 20,
      },
      {
        taskId: MISSING_NODE_ID,
        title: `Exercise ${MISSING_NODE_ID}`,
        goal: `Complete ${MISSING_NODE_ID}`,
        acceptanceCriterion: `${MISSING_NODE_ID} persists correctly`,
        files: ["packages/omp-plugin/**"],
        eventNamespace: "14-DEMO-BLOCKED",
        sessionRef: "session-14-demo",
        priority: 10,
      },
    ] as const satisfies readonly InitiativeDemoNode[];
    const fixturesByTaskId = new Map<string, TaskLifecycleFixture>(
      nodeFixtures.map((node) => [node.taskId, node] as const),
    );
    const activeStates = new Map<string, WorkflowState>();
    const nodeCommits = new Map<string, string>();
    const recorded = await readDurableTask({
      fileSystem: fixture.fileSystem,
      taskId: RECORDED_NODE_ID,
    });
    assert.equal(recorded.ok, true);
    if (!recorded.ok) {
      return;
    }
    activeStates.set(RECORDED_NODE_ID, recorded.state);

    for (const node of nodeFixtures.slice(1)) {
      const created = await createDurableTask({
        fileSystem: fixture.fileSystem,
        start: startRequest(node.taskId, "build", null, `${node.eventNamespace}-CREATED`),
      });
      assert.equal(created.ok, true);
      if (!created.ok) {
        return;
      }
      activeStates.set(node.taskId, created.state);
      if (node.taskId === MISSING_NODE_ID) {
        continue;
      }
      await writeTriageContext(fixture.repository, node.taskId);
    }

    const parentBeforeRevision = await readDurableTask({
      fileSystem: fixture.fileSystem,
      taskId: INITIATIVE_ID,
    });
    assert.equal(parentBeforeRevision.ok, true);
    if (!parentBeforeRevision.ok) {
      return;
    }
    const revisionEventMetadata = revisionEvent("DEMO-GRAPH");
    const graph = {
      ...fixture.graph,
      version: fixture.graph.version + 1,
      nodes: nodeFixtures.map((node) => ({
        taskId: node.taskId,
        priority: node.priority,
        resources: { files: node.files, apis: [], schemas: [], locks: [] },
      })),
      edges: [
        {
          from: RECORDED_NODE_ID,
          to: writerOneTaskId,
          type: "blocks" as const,
          reason: "Both research candidates must complete before the first code change.",
        },
        {
          from: readerTwoTaskId,
          to: writerOneTaskId,
          type: "blocks" as const,
          reason: "Both research candidates must complete before the first code change.",
        },
        {
          from: RECORDED_NODE_ID,
          to: writerTwoTaskId,
          type: "blocks" as const,
          reason: "Both research candidates must complete before the second code change.",
        },
        {
          from: readerTwoTaskId,
          to: writerTwoTaskId,
          type: "blocks" as const,
          reason: "Both research candidates must complete before the second code change.",
        },
      ],
      updatedByEvent: revisionEventMetadata.eventId,
    } as const satisfies DependencyGraph;
    const revised = await reviseDurableInitiativeGraph({
      fileSystem: fixture.fileSystem,
      taskId: INITIATIVE_ID,
      expectedVersion: parentBeforeRevision.state.projection.version,
      expectedGraphVersion: fixture.graph.version,
      graph,
      event: revisionEventMetadata,
    });
    assert.equal(revised.ok, true);
    if (!revised.ok) {
      return;
    }

    const initialReadiness = await coreContract.inspectDurableInitiativeReadiness({
      fileSystem: fixture.fileSystem,
      initiativeTaskId: INITIATIVE_ID,
      expectedGraphVersion: graph.version,
    });
    assert.equal(initialReadiness.ok, true);
    if (!initialReadiness.ok) {
      return;
    }
    assert.deepEqual(initialReadiness.frontier, [RECORDED_NODE_ID, readerTwoTaskId]);

    const completeNode = async (
      taskId: string,
      occurredAt: string,
      recordCommit = false,
    ) => {
      const node = fixturesByTaskId.get(taskId);
      const state = activeStates.get(taskId);
      assert.ok(node, `Missing fixture for ${taskId}.`);
      assert.ok(state, `Missing durable state for ${taskId}.`);
      activeStates.set(
        taskId,
        await completeDurableTask(fixture.fileSystem, node, state, occurredAt),
      );
      if (recordCommit) {
        const directory =
          taskId === writerTwoTaskId
            ? "packages/cli"
            : taskId === MISSING_NODE_ID
              ? "packages/omp-plugin"
              : "packages/core";
        nodeCommits.set(
          taskId,
          await recordNodeCommit(fixture.repository, taskId, directory),
        );
      }
    };
    const exclusiveWriteExecution = (
      taskId: string,
      occurredAt: string,
      run: () => Promise<Readonly<{ kind: "succeeded"; value: undefined }>> = async () =>
        Object.freeze({ kind: "succeeded" as const, value: undefined }),
    ) => ({
      taskId,
      repositoryAccess: "exclusive-write" as const,
      run,
      persist: async (outcome: { readonly kind: string }) => {
        assert.equal(outcome.kind, "succeeded");
        await completeNode(taskId, occurredAt, true);
      },
    });
    const repositoryFingerprint = await runGit(fixture.repository, "rev-parse", "HEAD");
    let activeReaders = 0;
    let completedReaders = 0;
    let signalReadersStarted!: () => void;
    const readersStarted = new Promise<void>((resolve) => {
      signalReadersStarted = resolve;
    });
    let releaseReaders!: () => void;
    const readersReleased = new Promise<void>((resolve) => {
      releaseReaders = resolve;
    });
    let signalReadPersistenceStarted!: () => void;
    const readPersistenceStarted = new Promise<void>((resolve) => {
      signalReadPersistenceStarted = resolve;
    });
    let releaseReadPersistence!: () => void;
    const readPersistenceReleased = new Promise<void>((resolve) => {
      releaseReadPersistence = resolve;
    });
    let persistedReadOutcomes = 0;
    const readExecution = (taskId: string) => ({
      taskId,
      repositoryAccess: "read-only" as const,
      run: async () => {
        activeReaders += 1;
        if (activeReaders === 2) {
          signalReadersStarted();
        }
        await readersReleased;
        activeReaders -= 1;
        completedReaders += 1;
        return {
          kind: "succeeded" as const,
          value: await runGit(fixture.repository, "rev-parse", "HEAD"),
        };
      },
      persist: async (outcome: { readonly kind: string }) => {
        assert.equal(outcome.kind, "succeeded");
        if (persistedReadOutcomes === 0) {
          signalReadPersistenceStarted();
          await readPersistenceReleased;
        }
        persistedReadOutcomes += 1;
        await completeNode(taskId, "2026-07-15T10:20:00Z");
      },
    });
    const scheduledReads = scheduler.run({
      readiness: initialReadiness,
      executions: [readExecution(RECORDED_NODE_ID), readExecution(readerTwoTaskId)],
    });
    await readersStarted;
    assert.equal(activeReaders, 2);
    assert.equal(scheduler.barrier.activeReadWaves, 1);
    assert.equal(scheduler.barrier.activeWriterOwner, null);
    let queuedWriterAcquired = false;
    const queuedWriter = scheduler.barrier.runWriter(
      { kind: "node", taskId: "TASK-14-DEMO-QUEUED-WRITER" },
      async () => {
        queuedWriterAcquired = true;
      },
    );
    await Promise.resolve();
    assert.equal(queuedWriterAcquired, false);
    releaseReaders();
    await readPersistenceStarted;
    await Promise.resolve();
    assert.equal(queuedWriterAcquired, false);
    releaseReadPersistence();
    const readResults = await scheduledReads;
    await queuedWriter;
    assert.equal(queuedWriterAcquired, true);
    assert.equal(readResults.status, "completed");
    if (readResults.status !== "completed") {
      return;
    }
    assert.deepEqual(
      readResults.results.map((result) => ({
        taskId: result.taskId,
        outcome: result.outcome,
      })),
      [
        {
          taskId: RECORDED_NODE_ID,
          outcome: { kind: "succeeded", value: repositoryFingerprint },
        },
        {
          taskId: readerTwoTaskId,
          outcome: { kind: "succeeded", value: repositoryFingerprint },
        },
      ],
    );
    assert.equal(completedReaders, 2);

    const writerFrontierBeforeRestart = await coreContract.inspectDurableInitiativeReadiness({
      fileSystem: fixture.fileSystem,
      initiativeTaskId: INITIATIVE_ID,
      expectedGraphVersion: graph.version,
    });
    assert.equal(writerFrontierBeforeRestart.ok, true);
    if (!writerFrontierBeforeRestart.ok) {
      return;
    }
    assert.deepEqual(writerFrontierBeforeRestart.frontier, [writerOneTaskId, writerTwoTaskId]);
    await rm(fixture.graphPath);
    const recovered = await recoverDurableTask({
      fileSystem: fixture.fileSystem,
      taskId: INITIATIVE_ID,
    });
    assert.equal(recovered.ok, true);
    const restartedScheduler = new InitiativeExecutionScheduler();
    assert.notEqual(restartedScheduler, scheduler);
    const writerFrontierAfterRestart = await coreContract.inspectDurableInitiativeReadiness({
      fileSystem: fixture.fileSystem,
      initiativeTaskId: INITIATIVE_ID,
      expectedGraphVersion: graph.version,
    });
    assert.equal(writerFrontierAfterRestart.ok, true);
    if (!writerFrontierAfterRestart.ok) {
      return;
    }
    assert.deepEqual(writerFrontierAfterRestart.frontier, writerFrontierBeforeRestart.frontier);
    const writerTwoSource = join(
      fixture.repository,
      "packages",
      "cli",
      `${writerTwoTaskId.toLowerCase()}.txt`,
    );
    await assert.rejects(readFile(writerTwoSource, "utf8"), { code: "ENOENT" });

    let activeWriters = 0;
    let maximumActiveWriters = 0;
    const writerOrder: string[] = [];
    let signalFirstWriterStarted!: () => void;
    const firstWriterStarted = new Promise<void>((resolve) => {
      signalFirstWriterStarted = resolve;
    });
    let releaseFirstWriter!: () => void;
    const firstWriterReleased = new Promise<void>((resolve) => {
      releaseFirstWriter = resolve;
    });
    const writeExecution = (taskId: string) =>
      exclusiveWriteExecution(taskId, "2026-07-15T10:30:00Z", async () => {
        assert.equal(completedReaders, 2);
        assert.deepEqual(restartedScheduler.barrier.activeWriterOwner, {
          kind: "node",
          taskId,
        });
        activeWriters += 1;
        maximumActiveWriters = Math.max(maximumActiveWriters, activeWriters);
        writerOrder.push(taskId);
        if (writerOrder.length === 1) {
          signalFirstWriterStarted();
          await firstWriterReleased;
        }
        activeWriters -= 1;
        return { kind: "succeeded" as const, value: undefined };
      });
    const scheduledWrites = restartedScheduler.run({
      readiness: writerFrontierAfterRestart,
      executions: [writeExecution(writerOneTaskId), writeExecution(writerTwoTaskId)],
    });
    await firstWriterStarted;
    await Promise.resolve();
    assert.deepEqual(writerOrder, [writerOneTaskId]);
    assert.deepEqual(restartedScheduler.barrier.activeWriterOwner, {
      kind: "node",
      taskId: writerOneTaskId,
    });
    assert.equal(nodeCommits.has(writerTwoTaskId), false);
    await assert.rejects(readFile(writerTwoSource, "utf8"), { code: "ENOENT" });
    let contendingWriterAcquired = false;
    const contendingWriter = restartedScheduler.barrier.runWriter(
      { kind: "node", taskId: writerTwoTaskId },
      async () => {
        contendingWriterAcquired = true;
        await assert.rejects(readFile(writerTwoSource, "utf8"), { code: "ENOENT" });
      },
    );
    await Promise.resolve();
    assert.equal(contendingWriterAcquired, false);
    let blockedReaderStarted = false;
    const blockedReader = restartedScheduler.barrier.runReadWave(
      async () => {
        blockedReaderStarted = true;
      },
      { kind: "read-wave-results", taskIds: ["TASK-14-DEMO-BLOCKED-READER"] },
      async () => undefined,
    );
    await Promise.resolve();
    assert.equal(blockedReaderStarted, false);
    releaseFirstWriter();
    await contendingWriter;
    assert.equal(contendingWriterAcquired, true);
    await blockedReader;
    assert.equal(blockedReaderStarted, true);
    const completedWrites = await scheduledWrites;
    assert.equal(completedWrites.status, "completed");
    assert.equal(maximumActiveWriters, 1);
    assert.deepEqual(writerOrder, [writerOneTaskId, writerTwoTaskId]);
    assert.equal(await readFile(writerTwoSource, "utf8"), `${writerTwoTaskId}\n`);

    await writeTriageContext(fixture.repository, MISSING_NODE_ID);
    const releasedBranch = await coreContract.inspectDurableInitiativeReadiness({
      fileSystem: fixture.fileSystem,
      initiativeTaskId: INITIATIVE_ID,
      expectedGraphVersion: graph.version,
    });
    assert.equal(releasedBranch.ok, true);
    if (!releasedBranch.ok) {
      return;
    }
    assert.deepEqual(releasedBranch.frontier, [MISSING_NODE_ID]);
    const branchResult = await restartedScheduler.run({
      readiness: releasedBranch,
      executions: [
        exclusiveWriteExecution(MISSING_NODE_ID, "2026-07-15T10:40:00Z"),
      ],
    });
    assert.equal(branchResult.status, "completed");
    const completedNodeEvents = new Map<string, WorkflowState["events"]>();
    for (const node of nodeFixtures) {
      const completedNode = await readDurableTask({
        fileSystem: fixture.fileSystem,
        taskId: node.taskId,
      });
      assert.equal(completedNode.ok, true);
      if (!completedNode.ok) {
        return;
      }
      completedNodeEvents.set(node.taskId, completedNode.state.events);
    }

    const parentBeforeIntegration = await readDurableTask({
      fileSystem: fixture.fileSystem,
      taskId: INITIATIVE_ID,
    });
    assert.equal(parentBeforeIntegration.ok, true);
    if (!parentBeforeIntegration.ok) {
      return;
    }
    const repairTaskId = "TASK-14-DEMO-REPAIR";
    const repairFixture = {
      taskId: repairTaskId,
      title: `Exercise ${repairTaskId}`,
      goal: "Repair the parent integration failure.",
      acceptanceCriterion: "The parent integration validation passes.",
      files: ["packages/core/**"],
      eventNamespace: "14-DEMO-REPAIR",
      sessionRef: "session-14-demo",
    } as const satisfies TaskLifecycleFixture;
    const integrationEvent = revisionEvent("DEMO-REPAIR");
    const failedIntegration = await restartedScheduler.integrate({
      fileSystem: fixture.fileSystem,
      initiativeTaskId: INITIATIVE_ID,
      expectedVersion: parentBeforeIntegration.state.projection.version,
      expectedGraphVersion: graph.version,
      event: integrationEvent,
      run: async () => ({
        kind: "repair-required" as const,
        repairs: [
          {
            taskId: repairTaskId,
            priority: 70,
            resources: {
              files: ["packages/core/**"],
              apis: ["InitiativeExecutionScheduler.integrate"],
              schemas: ["graph.json"],
              locks: [],
            },
            blockers: nodeFixtures.map((node) => node.taskId),
            context: {
              failureKind: "acceptance-failed" as const,
              summary: "Parent integration validation failed.",
              evidence: [
                { kind: "validation" as const, reference: "evidence/demo-integration.json" },
              ],
            },
            intent: {
              goals: ["Repair the parent integration failure."],
              nonGoals: [],
              acceptanceCriteria: ["The parent integration validation passes."],
            },
          },
        ],
      }),
    });
    assert.equal(failedIntegration.status, "repair-required");
    if (failedIntegration.status !== "repair-required") {
      return;
    }
    assert.deepEqual(failedIntegration.repairTaskIds, [repairTaskId]);
    assert.deepEqual(
      failedIntegration.graph.edges.filter((edge) => edge.to === repairTaskId),
      nodeFixtures.map((node) => ({
        from: node.taskId,
        to: repairTaskId,
        type: "blocks" as const,
        reason: "Parent integration validation failed.",
      })),
    );
    for (const [taskId, events] of completedNodeEvents) {
      const completedNode = await readDurableTask({
        fileSystem: fixture.fileSystem,
        taskId,
      });
      assert.equal(completedNode.ok, true);
      if (!completedNode.ok) {
        return;
      }
      assert.deepEqual(completedNode.state.events, events);
    }
    const repair = await readDurableTask({
      fileSystem: fixture.fileSystem,
      taskId: repairTaskId,
    });
    assert.equal(repair.ok, true);
    if (!repair.ok) {
      return;
    }
    fixturesByTaskId.set(repairTaskId, repairFixture);
    activeStates.set(repairTaskId, repair.state);
    await writeTriageContext(fixture.repository, repairTaskId);
    const dependentTaskId = "TASK-14-DEMO-REPAIR-DEPENDENT";
    const dependentFixture = {
      taskId: dependentTaskId,
      title: `Exercise ${dependentTaskId}`,
      goal: "Verify the Repair output in a dependent Build.",
      acceptanceCriterion: "The Repair-dependent Build completes after the Repair.",
      files: ["packages/core/**"],
      eventNamespace: "14-DEMO-REPAIR-DEPENDENT",
      sessionRef: "session-14-demo",
    } as const satisfies TaskLifecycleFixture;
    const dependent = await createDurableTask({
      fileSystem: fixture.fileSystem,
      start: startRequest(dependentTaskId, "build", null, "DEMO-DEPENDENT-CREATED"),
    });
    assert.equal(dependent.ok, true);
    if (!dependent.ok) {
      return;
    }
    fixturesByTaskId.set(dependentTaskId, dependentFixture);
    activeStates.set(dependentTaskId, dependent.state);
    await writeTriageContext(fixture.repository, dependentTaskId);
    const parentBeforeDependentRevision = await readDurableTask({
      fileSystem: fixture.fileSystem,
      taskId: INITIATIVE_ID,
    });
    assert.equal(parentBeforeDependentRevision.ok, true);
    if (!parentBeforeDependentRevision.ok) {
      return;
    }
    const dependentRevisionEvent = revisionEvent("DEMO-REPAIR-DEPENDENT");
    const graphWithDependent = {
      ...failedIntegration.graph,
      version: failedIntegration.graph.version + 1,
      nodes: [
        ...failedIntegration.graph.nodes,
        {
          taskId: dependentTaskId,
          priority: 60,
          resources: { files: ["packages/core/**"], apis: [], schemas: [], locks: [] },
        },
      ],
      edges: [
        ...failedIntegration.graph.edges,
        {
          from: repairTaskId,
          to: dependentTaskId,
          type: "blocks" as const,
          reason: "The dependent Build must wait for the Repair output.",
        },
      ],
      updatedByEvent: dependentRevisionEvent.eventId,
    } as const satisfies DependencyGraph;
    const dependentRevision = await reviseDurableInitiativeGraph({
      fileSystem: fixture.fileSystem,
      taskId: INITIATIVE_ID,
      expectedVersion: parentBeforeDependentRevision.state.projection.version,
      expectedGraphVersion: failedIntegration.graph.version,
      graph: graphWithDependent,
      event: dependentRevisionEvent,
    });
    assert.equal(dependentRevision.ok, true);
    if (!dependentRevision.ok) {
      return;
    }
    const repairReadiness = await coreContract.inspectDurableInitiativeReadiness({
      fileSystem: fixture.fileSystem,
      initiativeTaskId: INITIATIVE_ID,
      expectedGraphVersion: graphWithDependent.version,
    });
    assert.equal(repairReadiness.ok, true);
    if (!repairReadiness.ok) {
      return;
    }
    assert.deepEqual(repairReadiness.frontier, [repairTaskId]);
    const parentDuringRepair = await readDurableTask({
      fileSystem: fixture.fileSystem,
      taskId: INITIATIVE_ID,
    });
    assert.equal(parentDuringRepair.ok, true);
    if (!parentDuringRepair.ok) {
      return;
    }
    const integrationWhileRepairPending = await restartedScheduler.integrate({
      fileSystem: fixture.fileSystem,
      initiativeTaskId: INITIATIVE_ID,
      expectedVersion: parentDuringRepair.state.projection.version,
      expectedGraphVersion: graphWithDependent.version,
      event: revisionEvent("DEMO-REPAIR-PENDING"),
      run: async () => {
        assert.fail("Integration must wait until the Repair completes.");
      },
    });
    assert.equal(integrationWhileRepairPending.status, "waiting");
    if (integrationWhileRepairPending.status === "waiting") {
      assert.deepEqual(integrationWhileRepairPending.pendingTaskIds, [
        repairTaskId,
        dependentTaskId,
      ]);
    }
    const repairResult = await restartedScheduler.run({
      readiness: repairReadiness,
      executions: [
        exclusiveWriteExecution(repairTaskId, "2026-07-15T10:50:00Z"),
      ],
    });
    assert.equal(repairResult.status, "completed");
    const dependentReadiness = await coreContract.inspectDurableInitiativeReadiness({
      fileSystem: fixture.fileSystem,
      initiativeTaskId: INITIATIVE_ID,
      expectedGraphVersion: graphWithDependent.version,
    });
    assert.equal(dependentReadiness.ok, true);
    if (!dependentReadiness.ok) {
      return;
    }
    assert.deepEqual(dependentReadiness.frontier, [dependentTaskId]);
    const dependentResult = await restartedScheduler.run({
      readiness: dependentReadiness,
      executions: [
        exclusiveWriteExecution(dependentTaskId, "2026-07-15T10:55:00Z"),
      ],
    });
    assert.equal(dependentResult.status, "completed");

    const parentAfterRepair = await readDurableTask({
      fileSystem: fixture.fileSystem,
      taskId: INITIATIVE_ID,
    });
    assert.equal(parentAfterRepair.ok, true);
    if (!parentAfterRepair.ok) {
      return;
    }
    const reentered = await restartedScheduler.integrate({
      fileSystem: fixture.fileSystem,
      initiativeTaskId: INITIATIVE_ID,
      expectedVersion: parentAfterRepair.state.projection.version,
      expectedGraphVersion: graphWithDependent.version,
      event: revisionEvent("DEMO-INTEGRATION-PASSED"),
      run: async () => ({ kind: "accepted" as const }),
    });
    assert.equal(reentered.status, "completed");
    const parentBeforeFinish = await readDurableTask({
      fileSystem: fixture.fileSystem,
      taskId: INITIATIVE_ID,
    });
    assert.equal(parentBeforeFinish.ok, true);
    if (!parentBeforeFinish.ok) {
      return;
    }
    const completedReadiness = await coreContract.inspectDurableInitiativeReadiness({
      fileSystem: fixture.fileSystem,
      initiativeTaskId: INITIATIVE_ID,
      expectedGraphVersion: graphWithDependent.version,
    });
    assert.equal(completedReadiness.ok, true);
    if (!completedReadiness.ok) {
      return;
    }
    assert.deepEqual(completedReadiness.frontier, []);
    assert.equal(
      completedReadiness.nodes.every((node) => node.readiness === "completed"),
      true,
    );

    const finished = await advance(
      fixture.fileSystem,
      parentBeforeFinish.state,
      "finish",
      "DEMO-FINISH",
    );
    const terminalTransition = coreContract
      .readRouteDefinition("initiative")
      .transitions.find(
        (candidate) =>
          candidate.from.lifecycle === finished.projection.lifecycle &&
          candidate.from.phase === finished.projection.phase &&
          candidate.to.lifecycle === "completed" &&
          candidate.to.phase === "finish",
      );
    assert.ok(terminalTransition, "Missing Initiative terminal transition.");
    const nodeCommitTaskIds = [
      writerOneTaskId,
      writerTwoTaskId,
      MISSING_NODE_ID,
      repairTaskId,
      dependentTaskId,
    ];
    const nodeCommitEvidence = Object.freeze({
      schemaVersion: 1,
      nodes: Object.freeze(
        nodeCommitTaskIds.map((taskId) => {
          const commit = nodeCommits.get(taskId);
          assert.ok(commit, `Missing observed Git commit for ${taskId}.`);
          return Object.freeze({ taskId, commit });
        }),
      ),
    });
    await mkdir(
      join(fixture.repository, ".sayhi", "tasks", INITIATIVE_ID, "evidence"),
      { recursive: true },
    );
    await writeFile(
      join(
        fixture.repository,
        ".sayhi",
        "tasks",
        INITIATIVE_ID,
        "evidence",
        "node-commits.json",
      ),
      `${JSON.stringify(nodeCommitEvidence, null, 2)}\n`,
      "utf8",
    );
    const completed = await advanceDurableTask({
      fileSystem: fixture.fileSystem,
      transition: {
        contractVersion: 1,
        taskId: INITIATIVE_ID,
        expectedVersion: finished.projection.version,
        to: terminalTransition.to,
        gates: terminalTransition.requiredGates.map((gate) => ({
          gate,
          evidence: [
            {
              kind: readGateEvidenceKinds(gate)[0]!,
              reference:
                gate === "finish"
                  ? "evidence/node-commits.json"
                  : `evidence/DEMO-COMPLETED-${gate}.json`,
            },
          ],
        })),
        event: eventMetadata("DEMO-COMPLETED"),
      },
    });
    assert.equal(completed.ok, true);
    if (!completed.ok) {
      return;
    }
    assert.equal(completed.state.projection.lifecycle, "completed");
    assert.equal(completed.state.projection.phase, "finish");
    assert.deepEqual(
      JSON.parse(
        await readFile(
          join(
            fixture.repository,
            ".sayhi",
            "tasks",
            INITIATIVE_ID,
            "evidence",
            "node-commits.json",
          ),
          "utf8",
        ),
      ),
      nodeCommitEvidence,
    );
    const archived = await archiveDurableTask({
      fileSystem: fixture.fileSystem,
      transition: {
        contractVersion: 1,
        taskId: INITIATIVE_ID,
        expectedVersion: completed.state.projection.version,
        to: { lifecycle: "archived", phase: "finish", step: "archived" },
        gates: [
          {
            gate: "archive",
            evidence: [{ kind: "validation", reference: "evidence/node-commits.json" }],
          },
        ],
        event: eventMetadata("DEMO-ARCHIVED"),
      },
    });
    assert.equal(archived.ok, true);
    if (!archived.ok) {
      return;
    }
    assert.equal(archived.state.projection.lifecycle, "archived");
    assert.equal(archived.state.projection.phase, "finish");
  },
);

async function createInitiativeGraphFixture(
  t: test.TestContext,
  recordedNodeState: "active" | "archived" | "completed" = "active",
) {
  const repository = await mkdtemp(join(tmpdir(), "sayhi-initiative-graph-"));
  t.after(async () => rm(repository, { recursive: true, force: true }));
  await mkdir(join(repository, ".git"));
  assert.equal(
    (await runCli(["init", "--cwd", repository, "--json"])).exitCode,
    0,
  );
  const fileSystem = new NodeManagedProjectFileSystem(repository);

  if (recordedNodeState === "archived" || recordedNodeState === "completed") {
    const completed = await createCompletedDurableTask(
      fileSystem,
      {
        taskId: RECORDED_NODE_ID,
        title: `Exercise ${RECORDED_NODE_ID}`,
        goal: `Complete ${RECORDED_NODE_ID}`,
        acceptanceCriterion: `${RECORDED_NODE_ID} persists correctly`,
        files: ["packages/core/**", "packages/cli/**"],
        eventNamespace: "14-ARCHIVED",
        sessionRef: "session-14",
      },
      "2026-07-15T10:00:00Z",
      "2026-07-15T10:01:00Z",
    );
    if (recordedNodeState === "archived") {
      const archived = await archiveDurableTask({
        fileSystem,
        transition: {
          contractVersion: 1,
          taskId: RECORDED_NODE_ID,
          expectedVersion: completed.projection.version,
          to: { lifecycle: "archived", phase: "finish", step: "archived" },
          gates: [
            {
              gate: "archive",
              evidence: [
                { kind: "validation", reference: "evidence/node-archived.json" },
              ],
            },
          ],
          event: eventMetadata("NODE-ARCHIVED"),
        },
      });
      if (!archived.ok) {
        assert.fail(archived.diagnostics[0]?.message ?? "Node archive failed");
      }
    } else {
      await createCompletedDurableTask(
        fileSystem,
        {
          taskId: MISSING_NODE_ID,
          title: `Exercise ${MISSING_NODE_ID}`,
          goal: `Complete ${MISSING_NODE_ID}`,
          acceptanceCriterion: `${MISSING_NODE_ID} persists correctly`,
          files: ["packages/core/**", "packages/cli/**"],
          eventNamespace: "14-COMPLETED",
          sessionRef: "session-14",
        },
        "2026-07-15T10:00:00Z",
        "2026-07-15T10:01:00Z",
      );
    }
  } else {
    const recordedNode = await createDurableTask({
      fileSystem,
      start: startRequest(RECORDED_NODE_ID, "build", null, "NODE-CREATED"),
    });
    if (!recordedNode.ok) {
      assert.fail(recordedNode.diagnostics[0]?.message ?? "Node creation failed");
    }
    await writeTriageContext(repository, RECORDED_NODE_ID);
  }

  const created = await createDurableTask({
    fileSystem,
    start: startRequest(INITIATIVE_ID, "initiative", GRAPH_ID, "INITIATIVE-CREATED"),
  });
  if (!created.ok) {
    assert.fail(created.diagnostics[0]?.message ?? "Initiative creation failed");
  }

  let state = created.state;
  state = await advance(fileSystem, state, "explore", "EXPLORE");
  state = await advance(fileSystem, state, "plan", "PLAN");
  const graph = {
    schemaVersion: 1,
    id: GRAPH_ID,
    initiativeTaskId: INITIATIVE_ID,
    version: 1,
    nodes: [
      {
        taskId: RECORDED_NODE_ID,
        priority: 50,
        resources: { files: ["packages/core/**"], apis: [], schemas: [], locks: [] },
      },
      {
        taskId: MISSING_NODE_ID,
        priority: 40,
        resources: { files: [], apis: [], schemas: [], locks: [] },
      },
    ],
    edges: [
      {
        from: RECORDED_NODE_ID,
        to: MISSING_NODE_ID,
        type: "blocks",
        reason: "The recorded node must finish first.",
      },
    ],
    updatedByEvent: state.events[state.events.length - 1]!.eventId,
  } as const satisfies DependencyGraph;
  state = await advance(fileSystem, state, "integrate", "INTEGRATE", graph);
  assert.equal(state.projection.phase, "integrate");

  return Object.freeze({
    repository,
    fileSystem,
    graph,
    graphPath: join(
      repository,
      ".sayhi",
      "tasks",
      INITIATIVE_ID,
      "graph.json",
    ),
  });
}

async function writeTriageContext(repository: string, taskId: string): Promise<void> {
  await mkdir(join(repository, ".sayhi", "tasks", taskId, "context"), {
    recursive: true,
  });
  await writeFile(
    join(repository, ".sayhi", "tasks", taskId, "context", "triage.jsonl"),
    "",
    "utf8",
  );
}

async function initializeGitRepository(repository: string): Promise<void> {
  await rm(join(repository, ".git"), { recursive: true, force: true });
  await runGit(repository, "init", "--quiet");
  await runGit(repository, "config", "user.email", "sayhi-tests@example.test");
  await runGit(repository, "config", "user.name", "SayHi Tests");
  await writeFile(join(repository, "README.md"), "Initiative fixture\n", "utf8");
  await runGit(repository, "add", "README.md");
  await runGit(repository, "commit", "--quiet", "-m", "Initialize Initiative fixture");
}

async function recordNodeCommit(
  repository: string,
  taskId: string,
  directory: string,
): Promise<string> {
  const path = `${directory}/${taskId.toLowerCase()}.txt`;
  await mkdir(join(repository, directory), { recursive: true });
  await writeFile(join(repository, path), `${taskId}\n`, "utf8");
  await runGit(repository, "add", path);
  await runGit(repository, "commit", "--quiet", "-m", `Complete ${taskId}`);
  const commit = await runGit(repository, "rev-parse", "HEAD");
  assert.match(commit, /^[a-f0-9]{40}$/u);
  return commit;
}

async function runGit(repository: string, ...args: readonly string[]): Promise<string> {
  const result = await executeFile("git", args, { cwd: repository, windowsHide: true });
  return String(result.stdout).trim();
}

async function advance(
  fileSystem: NodeManagedProjectFileSystem,
  state: WorkflowState,
  phase: WorkflowPhase,
  suffix: string,
  initiativeGraph?: DependencyGraph,
): Promise<WorkflowState> {
  const result = await advanceDurableTask({
    fileSystem,
    transition: transitionRequest(state, phase, suffix, initiativeGraph),
  });
  if (!result.ok) {
    assert.fail(result.diagnostics[0]?.message ?? `Transition ${suffix} failed`);
  }
  return result.state;
}

function transitionRequest(
  state: WorkflowState,
  phase: WorkflowPhase,
  suffix: string,
  initiativeGraph?: DependencyGraph,
): TransitionWorkflowRequest {
  const transition = coreContract
    .readRouteDefinition(state.projection.route)
    .transitions.find(
      (candidate) =>
        candidate.from.lifecycle === state.projection.lifecycle &&
        candidate.from.phase === state.projection.phase &&
        candidate.to.lifecycle === "active" &&
        candidate.to.phase === phase,
    );
  assert.ok(transition, `Missing transition to ${phase}.`);
  return {
    contractVersion: 1,
    taskId: state.projection.id,
    expectedVersion: state.projection.version,
    to: transition.to,
    gates: transition.requiredGates.map((gate) => ({
      gate,
      evidence: [
        {
          kind: readGateEvidenceKinds(gate)[0]!,
          reference: `evidence/${suffix}-${gate}.json`,
        },
      ],
    })),
    ...(initiativeGraph === undefined ? {} : { initiativeGraph }),
    event: eventMetadata(suffix),
  };
}

function startRequest(
  taskId: string,
  route: Exclude<WorkflowRoute, "quick">,
  initiativeGraphId: string | null,
  suffix: string,
  parentTaskId: string | null = null,
): StartWorkflowTaskRequest {
  return {
    contractVersion: 1,
    task: {
      id: taskId,
      title: `Exercise ${taskId}`,
      route,
      parentTaskId,
      initiativeGraphId,
      intent: {
        goals: [`Complete ${taskId}`],
        nonGoals: [],
        acceptanceCriteria: [`${taskId} persists correctly`],
      },
      scope: {
        files: ["packages/core/**", "packages/cli/**"],
        apis: ["CoreContract"],
        schemas: ["events.jsonl", "task.json", "graph.json"],
        locks: [],
      },
      baselineRef: "baseline.json",
      contexts: route === "build" ? { triage: "context/triage.jsonl" } : {},
      policies: { commit: "never", push: "never", maxRepairAttempts: 2 },
    },
    routeGate: {
      gate: "route",
      evidence: [
        {
          kind: "human-approval",
          reference: `evidence/${suffix}-route.json`,
        },
      ],
    },
    event: eventMetadata(suffix),
  };
}

function eventMetadata(suffix: string) {
  return {
    eventId: `EVENT-14-${suffix}`,
    actor: { kind: "orchestrator" as const, id: "sayhi-test", sessionRef: "session-14" },
    reason: `Accept ${suffix}`,
    idempotencyKey: `IDEMPOTENCY-14-${suffix}`,
    occurredAt: "2026-07-15T10:00:00Z",
  };
}

function revisionEvent(suffix: string) {
  return {
    eventId: `EVENT-14-${suffix}`,
    actor: {
      kind: "user" as const,
      id: "initiative-owner",
      sessionRef: "initiative-approval-session",
    },
    reason: `Approve Initiative graph revision ${suffix}.`,
    idempotencyKey: `IDEMPOTENCY-14-${suffix}`,
    occurredAt: "2026-07-15T10:05:00Z",
  };
}

function revisedGraph(
  graph: DependencyGraph,
  updatedByEvent: string,
): DependencyGraph {
  const nodes = graph.nodes.map((node) =>
    node.taskId === MISSING_NODE_ID
      ? { ...node, priority: node.priority - 1 }
      : { ...node },
  );
  return {
    ...graph,
    version: graph.version + 1,
    nodes,
    edges: graph.edges.map((edge) => ({ ...edge })),
    updatedByEvent,
  };
}

function trackWriterLease(fileSystem: NodeManagedProjectFileSystem) {
  let acquired = false;
  return {
    fileSystem: new Proxy(fileSystem, {
      get(target, property, receiver) {
        if (property === "withWriterMutationLock") {
          return async <Result>(operation: () => Promise<Result>): Promise<Result> => {
            acquired = true;
            return target.withWriterMutationLock(operation);
          };
        }
        const member = Reflect.get(target, property, receiver);
        return typeof member === "function" ? member.bind(target) : member;
      },
    }),
    acquired: () => acquired,
  };
}
