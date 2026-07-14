import assert from "node:assert/strict";
import test from "node:test";

import { coreContract } from "@dnslin/sayhi-core";

const validGraph = {
  schemaVersion: 1,
  id: "GRAPH-5",
  initiativeTaskId: "TASK-5",
  version: 4,
  nodes: [
    {
      taskId: "TASK-5-A",
      priority: 50,
      resources: {
        files: ["packages/core/**"],
        apis: ["CoreContract.validateDependencyGraph"],
        schemas: ["graph.json"],
        locks: ["package-lock.json"],
      },
    },
    {
      taskId: "TASK-5-B",
      priority: 40,
      resources: { files: [], apis: [], schemas: [], locks: [] },
    },
  ],
  edges: [
    {
      from: "TASK-5-A",
      to: "TASK-5-B",
      type: "blocks",
      reason: "Core contract precedes adapter exposure",
    },
  ],
  updatedByEvent: "EVENT-5",
} as const;

test("Core validates an acyclic Dependency Graph without losing durable identity or edges", () => {
  const result = coreContract.validateDependencyGraph({
    contractVersion: 1,
    graph: validGraph,
  });

  assert.equal(result.ok, true);
  if (!result.ok) {
    return;
  }

  assert.deepEqual(result.graph, validGraph);
  assert.notStrictEqual(result.graph, validGraph);
  assert.equal(result.graph.version, 4);
  assert.equal(result.graph.nodes[0]?.taskId, "TASK-5-A");
  assert.deepEqual(result.graph.edges, validGraph.edges);
  assert.ok(Object.isFrozen(result.graph));
  assert.ok(Object.isFrozen(result.graph.nodes));
  assert.ok(Object.isFrozen(result.graph.nodes[0]?.resources));
  assert.ok(Object.isFrozen(result.graph.edges));
});

test("Core rejects unsupported Dependency Graph contract and schema versions precisely", () => {
  assert.deepEqual(
    coreContract.validateDependencyGraph({ contractVersion: 2, graph: validGraph }),
    {
      ok: false,
      contractVersion: 1,
      diagnostics: [
        {
          code: "dependency_graph.contract_version.unsupported",
          path: "$.contractVersion",
          message: "Dependency Graph contract version 2 is unsupported.",
          remediation: "Use Dependency Graph contract version 1.",
        },
      ],
    },
  );

  assert.deepEqual(
    coreContract.validateDependencyGraph({
      contractVersion: 1,
      graph: { ...validGraph, schemaVersion: 2 },
    }),
    {
      ok: false,
      contractVersion: 1,
      diagnostics: [
        {
          code: "dependency_graph.schema_version.unsupported",
          path: "$.graph.schemaVersion",
          message: "Dependency Graph schema version 2 is unsupported.",
          remediation: "Use Dependency Graph schema version 1.",
        },
      ],
    },
  );
});

test("Core locates duplicate Dependency Graph node identities deterministically", () => {
  const result = coreContract.validateDependencyGraph({
    contractVersion: 1,
    graph: {
      ...validGraph,
      nodes: [validGraph.nodes[0], { ...validGraph.nodes[1], taskId: "TASK-5-A" }],
    },
  });

  assert.deepEqual(result, {
    ok: false,
    contractVersion: 1,
    diagnostics: [
      {
        code: "dependency_graph.node.duplicate",
        path: "$.graph.nodes[1].taskId",
        message: "Dependency Graph node taskId TASK-5-A is duplicated.",
        remediation: "Assign every Dependency Graph node a unique Build Task id.",
      },
    ],
  });
});

test("Core locates a Dependency Graph edge that references a missing node", () => {
  const result = coreContract.validateDependencyGraph({
    contractVersion: 1,
    graph: {
      ...validGraph,
      edges: [
        {
          ...validGraph.edges[0],
          to: "TASK-5-MISSING",
        },
      ],
    },
  });

  assert.deepEqual(result, {
    ok: false,
    contractVersion: 1,
    diagnostics: [
      {
        code: "dependency_graph.edge.reference_missing",
        path: "$.graph.edges[0].to",
        message: "Dependency Graph edge target TASK-5-MISSING is not a declared node.",
        remediation: "Reference a declared node taskId or add the missing Build node.",
      },
    ],
  });
});

test("Core reports the first deterministic node in a Dependency Graph cycle", () => {
  const result = coreContract.validateDependencyGraph({
    contractVersion: 1,
    graph: {
      ...validGraph,
      edges: [
        validGraph.edges[0],
        {
          from: "TASK-5-B",
          to: "TASK-5-A",
          type: "validates",
          reason: "Creates a cycle for the contract test",
        },
      ],
    },
  });

  assert.deepEqual(result, {
    ok: false,
    contractVersion: 1,
    diagnostics: [
      {
        code: "dependency_graph.cycle.detected",
        path: "$.graph.edges",
        message: "Dependency Graph contains a directed cycle through TASK-5-A.",
        remediation: "Remove or redirect an edge so dependency ordering is acyclic.",
      },
    ],
  });
});

test("Core rejects malformed Dependency Graph records at the exact unsafe field", () => {
  const cases = [
    [{ ...validGraph, id: "" }, "dependency_graph.graph.invalid", "$.graph.id"],
    [
      { ...validGraph, initiativeTaskId: "" },
      "dependency_graph.graph.invalid",
      "$.graph.initiativeTaskId",
    ],
    [
      { ...validGraph, initiativeTaskId: "TASK-5-A" },
      "dependency_graph.graph.invalid",
      "$.graph.nodes[0].taskId",
    ],
    [{ ...validGraph, version: 0 }, "dependency_graph.graph.invalid", "$.graph.version"],
    [{ ...validGraph, nodes: [] }, "dependency_graph.graph.invalid", "$.graph.nodes"],
    [
      {
        ...validGraph,
        nodes: [{ ...validGraph.nodes[0], priority: 1.5 }],
        edges: [],
      },
      "dependency_graph.graph.invalid",
      "$.graph.nodes[0].priority",
    ],
    [
      {
        ...validGraph,
        nodes: [
          {
            ...validGraph.nodes[0],
            resources: { ...validGraph.nodes[0].resources, files: ["../outside.ts"] },
          },
        ],
        edges: [],
      },
      "dependency_graph.graph.invalid",
      "$.graph.nodes[0].resources.files[0]",
    ],
    [
      {
        ...validGraph,
        nodes: [
          {
            ...validGraph.nodes[0],
            resources: { ...validGraph.nodes[0].resources, apis: [42] },
          },
        ],
        edges: [],
      },
      "dependency_graph.graph.invalid",
      "$.graph.nodes[0].resources.apis[0]",
    ],
    [
      { ...validGraph, updatedByEvent: "" },
      "dependency_graph.graph.invalid",
      "$.graph.updatedByEvent",
    ],
    [
      {
        ...validGraph,
        edges: [{ ...validGraph.edges[0], to: "TASK-5-A" }],
      },
      "dependency_graph.edge.invalid",
      "$.graph.edges[0]",
    ],
    [
      {
        ...validGraph,
        edges: [{ ...validGraph.edges[0], type: "after" }],
      },
      "dependency_graph.edge.invalid",
      "$.graph.edges[0].type",
    ],
    [
      {
        ...validGraph,
        edges: [{ ...validGraph.edges[0], reason: "  " }],
      },
      "dependency_graph.edge.invalid",
      "$.graph.edges[0].reason",
    ],
  ] as const;

  for (const [graph, code, path] of cases) {
    const result = coreContract.validateDependencyGraph({ contractVersion: 1, graph });
    assert.equal(result.ok, false, path);
    if (!result.ok) {
      assert.deepEqual(
        result.diagnostics.map((diagnostic) => ({
          code: diagnostic.code,
          path: diagnostic.path,
        })),
        [{ code, path }],
      );
      assert.match(result.diagnostics[0]?.message ?? "", /\S/u);
      assert.match(result.diagnostics[0]?.remediation ?? "", /\S/u);
    }
  }
});

test("Core safely rejects missing and unreadable Dependency Graph requests", () => {
  const missing = coreContract.validateDependencyGraph({ contractVersion: 1 });
  assert.equal(missing.ok, false);
  if (!missing.ok) {
    assert.equal(missing.diagnostics[0]?.code, "dependency_graph.request.invalid");
    assert.equal(missing.diagnostics[0]?.path, "$.graph");
  }

  const unreadable = Object.defineProperty({ contractVersion: 1 }, "graph", {
    get() {
      throw new Error("unreadable graph");
    },
  });
  assert.deepEqual(coreContract.validateDependencyGraph(unreadable), {
    ok: false,
    contractVersion: 1,
    diagnostics: [
      {
        code: "dependency_graph.request.invalid",
        path: "$",
        message: "Dependency Graph validation request could not be read safely.",
        remediation: "Provide a plain data object without accessors and retry.",
      },
    ],
  });
});
