import assert from "node:assert/strict";
import test from "node:test";

import {
  readCliBootstrapContract,
  validateCliContractRecord,
  validateCliDomainValue,
  validateCliDependencyGraph,
} from "@dnslin/sayhi-cli";
import { coreContract } from "@dnslin/sayhi-core";

test("CLI reads the bootstrap contract from shared Core", () => {
  assert.strictEqual(
    readCliBootstrapContract(),
    coreContract.readBootstrapContract(),
  );
});

test("CLI exposes the same domain validation result as Core", () => {
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
    validateCliDomainValue(validRequest),
    coreContract.validateDomainValue(validRequest),
  );
  assert.deepEqual(
    validateCliDomainValue(invalidRequest),
    coreContract.validateDomainValue(invalidRequest),
  );
});

test("CLI exposes the same contract record validation result as Core", () => {
  const request = {
    contractVersion: 1,
    kind: "managedFile",
    record: {
      schemaVersion: 1,
      path: ".sayhi/spec/project.md",
      ownershipClass: "user-owned",
      generatedSourceVersion: "1.0.0",
      markerIds: [],
    },
  };

  assert.deepEqual(
    validateCliContractRecord(request),
    coreContract.validateContractRecord(request),
  );
});

test("CLI exposes the same Dependency Graph validation result as Core", () => {
  const validRequest = {
    contractVersion: 1,
    graph: {
      schemaVersion: 1,
      id: "GRAPH-CLI",
      initiativeTaskId: "TASK-CLI",
      version: 1,
      nodes: [
        {
          taskId: "TASK-CLI-NODE",
          priority: 1,
          resources: { files: [], apis: [], schemas: [], locks: [] },
        },
      ],
      edges: [],
      updatedByEvent: "EVENT-CLI",
    },
  };
  const invalidRequest = {
    ...validRequest,
    graph: { ...validRequest.graph, schemaVersion: 2 },
  };

  assert.deepEqual(
    validateCliDependencyGraph(validRequest),
    coreContract.validateDependencyGraph(validRequest),
  );
  assert.deepEqual(
    validateCliDependencyGraph(invalidRequest),
    coreContract.validateDependencyGraph(invalidRequest),
  );
});
