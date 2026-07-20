import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  COORDINATED_RELEASE_ARTIFACTS,
  coreContract,
} from "@dnslin/sayhi-core";
import {
  OMP_MARKETPLACE_METADATA,
  OMP_RELEASE_ARTIFACT,
  readOmpBootstrapContract,
  validateOmpContractRecord,
  validateOmpDomainValue,
  validateOmpDependencyGraph,
}
from "@dnslin/sayhi-omp";
import { readInstalledPackageJson } from "./package-test-support.js";

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

test("OMP exposes the same contract record validation result as Core", () => {
  const request = {
    contractVersion: 1,
    kind: "managedFile",
    record: {
      schemaVersion: 1,
      path: ".sayhi/agents/project.md",
      ownershipClass: "user-owned",
      generatedSourceVersion: "1.0.0",
      markerIds: [],
    },
  };

  assert.deepEqual(
    validateOmpContractRecord(request),
    coreContract.validateContractRecord(request),
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

test("OMP exposes coordinated artifact metadata aligned with Core and package version", async () => {
  assert.strictEqual(
    OMP_RELEASE_ARTIFACT,
    COORDINATED_RELEASE_ARTIFACTS.artifacts.omp,
  );
  assert.deepEqual(
    OMP_RELEASE_ARTIFACT.provenance,
    COORDINATED_RELEASE_ARTIFACTS.artifacts.core.provenance,
  );
  assert.deepEqual(
    OMP_RELEASE_ARTIFACT.compatibility,
    COORDINATED_RELEASE_ARTIFACTS.artifacts.cli.compatibility,
  );
  assert.match(OMP_RELEASE_ARTIFACT.integrity, /^sha256:/u);

  const ompPackage = await readInstalledPackageJson("@dnslin/sayhi-omp");
  assert.equal(ompPackage.version, OMP_RELEASE_ARTIFACT.version);
});

test("OMP publishes Marketplace metadata bound to the coordinated release", () => {
  assert.strictEqual(
    OMP_MARKETPLACE_METADATA.releaseArtifacts,
    COORDINATED_RELEASE_ARTIFACTS,
  );
  assert.deepEqual(OMP_MARKETPLACE_METADATA.entryPoints, {
    core: { package: "@dnslin/sayhi-core", export: "." },
    cli: { package: "@dnslin/sayhi-cli", executable: "sayhi", export: "." },
    omp: { package: "@dnslin/sayhi-omp", export: "." },
  });
  assert.deepEqual(OMP_MARKETPLACE_METADATA.requirements, {
    node: ">=22.17.0",
    npm: ">=10.9.2",
  });
  assert.deepEqual(OMP_MARKETPLACE_METADATA.capabilities, {
    commands: [],
    agents: [],
    hooks: [],
    mcpServers: [],
    lspServers: [],
  });
});

test(
  "OMP Marketplace catalog names the packaged artifact without unavailable capabilities",
  { skip: process.env.SAYHI_INSTALLED_CONTRACTS === "1" },
  async () => {
    const catalog = JSON.parse(
      await readFile(
        new URL("../../../.omp-plugin/marketplace.json", import.meta.url),
        "utf8",
      ),
    ) as {
      readonly name: string;
      readonly owner: Readonly<{ readonly name: string }>;
      readonly metadata: Readonly<Record<string, unknown>>;
      readonly plugins: readonly Readonly<{
        readonly name: string;
        readonly source: string;
        readonly commands: readonly string[];
        readonly agents: readonly string[];
        readonly hooks: readonly string[];
        readonly mcpServers: readonly string[];
        readonly lspServers: readonly string[];
      }>[];
    };
    assert.equal(catalog.name, "sayhi");
    assert.equal(catalog.owner.name, "dnslin");
    assert.equal("version" in catalog.metadata, false);
    assert.equal(catalog.plugins.length, 1);

    const plugin = catalog.plugins[0]!;
    assert.equal(plugin.name, "sayhi");
    assert.equal(plugin.source, "./packages/omp-plugin");
    assert.equal("version" in plugin, false);
    assert.deepEqual(
      {
        commands: plugin.commands,
        agents: plugin.agents,
        hooks: plugin.hooks,
        mcpServers: plugin.mcpServers,
        lspServers: plugin.lspServers,
      },
      OMP_MARKETPLACE_METADATA.capabilities,
    );
  },
);

