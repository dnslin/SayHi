import assert from "node:assert/strict";
import test from "node:test";

import { coreContract } from "@dnslin/sayhi-core";
import {
  readOmpBootstrapContract,
  validateOmpDomainValue,
  validateOmpDependencyGraph,
} from "@dnslin/sayhi-omp";

test("OMP reads the bootstrap contract from shared Core", () => {
  assert.strictEqual(
    readOmpBootstrapContract(),
    coreContract.readBootstrapContract(),
  );
});

test("OMP exposes the same domain validation result as Core", () => {
  const validRequest = {
    contractVersion: 1,
    kind: "recordEnvelope",
    value: { schemaVersion: 1, id: "TASK-42", futureField: true },
  };
  const invalidRequest = {
    contractVersion: 1,
    kind: "timestamp",
    value: "2026-07-14T00:00:00+00:00",
  };

  assert.deepEqual(
    validateOmpDomainValue(validRequest),
    coreContract.validateDomainValue(validRequest),
  );
  assert.deepEqual(
    validateOmpDomainValue(invalidRequest),
    coreContract.validateDomainValue(invalidRequest),
  );
});

test("OMP exposes the same Dependency Graph validation result as Core", () => {
  const graph = {
    schemaVersion: 1,
    id: "GRAPH-OMP",
    initiativeTaskId: "TASK-OMP",
    version: 3,
    nodes: [
      {
        taskId: "TASK-OMP-A",
        priority: 2,
        resources: { files: [], apis: [], schemas: [], locks: [] },
      },
      {
        taskId: "TASK-OMP-B",
        priority: 1,
        resources: { files: [], apis: [], schemas: [], locks: [] },
      },
    ],
    edges: [
      { from: "TASK-OMP-A", to: "TASK-OMP-B", type: "blocks", reason: "a" },
    ],
    updatedByEvent: "EVENT-OMP",
  };
  const validRequest = { contractVersion: 1, graph };
  const invalidRequest = {
    contractVersion: 1,
    graph: {
      ...graph,
      edges: [
        ...graph.edges,
        { from: "TASK-OMP-B", to: "TASK-OMP-A", type: "blocks", reason: "b" },
      ],
    },
  };

  assert.deepEqual(
    validateOmpDependencyGraph(validRequest),
    coreContract.validateDependencyGraph(validRequest),
  );
  assert.deepEqual(
    validateOmpDependencyGraph(invalidRequest),
    coreContract.validateDependencyGraph(invalidRequest),
  );
});
