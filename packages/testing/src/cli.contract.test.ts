import assert from "node:assert/strict";
import test from "node:test";

import {
  CLI_RELEASE_ARTIFACT,
  readCliBootstrapContract,
  validateCliContractRecord,
  validateCliDomainValue,
  validateCliDependencyGraph,
} from "@dnslin/sayhi-cli";
import {
  COORDINATED_RELEASE_ARTIFACTS,
  coreContract,
} from "@dnslin/sayhi-core";
import { readInstalledPackageJson } from "./package-test-support.js";

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

test("CLI exposes coordinated artifact metadata aligned with Core and package versions", async () => {
  assert.strictEqual(
    CLI_RELEASE_ARTIFACT,
    COORDINATED_RELEASE_ARTIFACTS.artifacts.cli,
  );
  assert.deepEqual(
    CLI_RELEASE_ARTIFACT.provenance,
    COORDINATED_RELEASE_ARTIFACTS.artifacts.core.provenance,
  );
  assert.deepEqual(
    CLI_RELEASE_ARTIFACT.compatibility,
    COORDINATED_RELEASE_ARTIFACTS.artifacts.omp.compatibility,
  );
  assert.match(CLI_RELEASE_ARTIFACT.integrity, /^sha256:/u);

  const [corePackage, cliPackage] = await Promise.all([
    readInstalledPackageJson("@dnslin/sayhi-core"),
    readInstalledPackageJson("@dnslin/sayhi-cli"),
  ]);
  assert.equal(corePackage.version, COORDINATED_RELEASE_ARTIFACTS.artifacts.core.version);
  assert.equal(cliPackage.version, CLI_RELEASE_ARTIFACT.version);
});

