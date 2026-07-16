import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { NodeManagedProjectFileSystem, runCli, type CliJsonEnvelope } from "@dnslin/sayhi-cli";
import {
  advanceDurableTask,
  coreContract,
  createDurableTask,
  inspectDurableInitiativeGraph,
  readDurableTask,
  recoverDurableTask,
  readGateEvidenceKinds,
  type DependencyGraph,
  type StartWorkflowTaskRequest,
  type TransitionWorkflowRequest,
  type WorkflowPhase,
  type WorkflowRoute,
  type WorkflowState,
} from "@dnslin/sayhi-core";

const INITIATIVE_ID = "TASK-14-INITIATIVE";
const GRAPH_ID = "GRAPH-14";
const RECORDED_NODE_ID = "TASK-14-NODE-RECORDED";
const MISSING_NODE_ID = "TASK-14-NODE-MISSING";

test("Core stores an Initiative graph and CLI inspection reports its dependencies and node status", async (t) => {
  const fixture = await createInitiativeGraphFixture(t);

  const graphPath = join(
    fixture.repository,
    ".sayhi",
    "tasks",
    INITIATIVE_ID,
    "graph.json",
  );
  assert.deepEqual(JSON.parse(await readFile(graphPath, "utf8")), fixture.graph);

  const inspected = await inspectDurableInitiativeGraph({
    fileSystem: fixture.fileSystem,
    initiativeTaskId: INITIATIVE_ID,
  });
  assert.equal(inspected.ok, true);
  if (!inspected.ok) {
    return;
  }
  assert.deepEqual(inspected.graph, fixture.graph);
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

test("Task recovery rebuilds a missing Initiative graph record from accepted history", async (t) => {
  const fixture = await createInitiativeGraphFixture(t);
  const graphPath = join(
    fixture.repository,
    ".sayhi",
    "tasks",
    INITIATIVE_ID,
    "graph.json",
  );
  await rm(graphPath);

  const recovered = await recoverDurableTask({
    fileSystem: fixture.fileSystem,
    taskId: INITIATIVE_ID,
  });
  assert.equal(recovered.ok, true);
  assert.deepEqual(JSON.parse(await readFile(graphPath, "utf8")), fixture.graph);
});

test("Graph inspection rejects invalid and incompatible records without changing Initiative state", async (t) => {
  const fixture = await createInitiativeGraphFixture(t);
  const graphPath = join(
    fixture.repository,
    ".sayhi",
    "tasks",
    INITIATIVE_ID,
    "graph.json",
  );
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

async function createInitiativeGraphFixture(t: test.TestContext) {
  const repository = await mkdtemp(join(tmpdir(), "sayhi-initiative-graph-"));
  t.after(async () => rm(repository, { recursive: true, force: true }));
  await mkdir(join(repository, ".git"));
  assert.equal(
    (await runCli(["init", "--cwd", repository, "--json"])).exitCode,
    0,
  );
  const fileSystem = new NodeManagedProjectFileSystem(repository);

  const recordedNode = await createDurableTask({
    fileSystem,
    start: startRequest(RECORDED_NODE_ID, "build", null, "NODE-CREATED"),
  });
  if (!recordedNode.ok) {
    assert.fail(recordedNode.diagnostics[0]?.message ?? "Node creation failed");
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

  return Object.freeze({ repository, fileSystem, graph });
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
): StartWorkflowTaskRequest {
  return {
    contractVersion: 1,
    task: {
      id: taskId,
      title: `Exercise ${taskId}`,
      route,
      parentTaskId: null,
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
      contexts: {},
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
