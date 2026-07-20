import assert from "node:assert/strict";
import { Buffer } from "node:buffer";
import { createHash } from "node:crypto";
import test from "node:test";

import {
  COORDINATED_RELEASE_ARTIFACTS,
  createCoordinatedReleaseArtifacts,
  coreContract,
  applyManagedProjectPlan,
  MANAGED_PROJECT_RUNTIME_IGNORE_CONTENT,
  recoverManagedProjectOperation,
  planManagedProjectUninstall,
  planManagedProjectUpdate,
  type ManagedProjectMutationFileSystem,
} from "@dnslin/sayhi-core";
import {
  initializeManagedProjectWithTestReleaseArtifacts,
  TEST_SKILL_BUNDLE,
  TEST_SKILL_LOCK_DIGEST,
  TEST_RELEASE_ARTIFACTS,
  withTestReleaseArtifacts,
} from "./skill-bundle-test-support.js";

const INSTALLATION = {
  core: "0.0.0",
  cli: "0.0.0",
  ompPlugin: "0.0.0",
  projectSchema: 1,
  templates: "0.0.0",
  skillLockDigest: TEST_SKILL_LOCK_DIGEST,
} as const;

const NEXT_INSTALLATION = {
  ...INSTALLATION,
  templates: "1.0.0",
} as const;

const NEXT_RUNTIME_IGNORE_CONTENT =
  `${MANAGED_PROJECT_RUNTIME_IGNORE_CONTENT}/.cache/\n`;
const MODIFIED_RUNTIME_IGNORE_CONTENT =
  `${MANAGED_PROJECT_RUNTIME_IGNORE_CONTENT}user-local-change\n`;

const REQUIRED_DIRECTORIES = [
  ".sayhi",
  ".sayhi/spec",
  ".sayhi/tasks",
  ".sayhi/tasks/archive",
  ".sayhi/research",
  ".sayhi/workspace",
  ".sayhi/workflow",
  ".sayhi/overrides",
  ".sayhi/.runtime",

] as const;


function diagnoseProject(request: Record<string, unknown>) {
  return coreContract.diagnoseManagedProject(withTestReleaseArtifacts(request) as never);
}

class MemoryManagedProjectFileSystem implements ManagedProjectMutationFileSystem {
  readonly directories = new Set<string>();
  readonly files = new Map<string, string>();
  readonly symlinks = new Set<string>();
  readonly writes: string[] = [];
  #failOncePath: string | null = null;
  sharedWriterLockCalls = 0;

  failOnce(path: string): void {
    this.#failOncePath = path;
  }

  async inspect(path: string) {
    if (this.symlinks.has(path)) {
      return { kind: "symlink" as const };
    }
    if (this.directories.has(path)) {
      return { kind: "directory" as const };
    }
    if (this.files.has(path)) {
      return { kind: "file" as const };
    }
    return { kind: "missing" as const };
  }

  async readFile(path: string): Promise<string> {
    const content = this.files.get(path);
    if (content === undefined) {
      throw new Error(`Missing test file: ${path}`);
    }
    return content;
  }

  async createDirectory(path: string): Promise<void> {
    this.directories.add(path);
    this.writes.push(path);
  }

  async writeFile(path: string, content: string): Promise<void> {
    if (this.#failOncePath === path) {
      this.#failOncePath = null;
      throw new Error(`Injected write failure: ${path}`);
    }
    this.files.set(path, content);
    this.writes.push(path);
  }

  async removeFile(path: string): Promise<void> {
    this.files.delete(path);
    this.writes.push(path);
  }

  async withSharedCheckoutWriterLock<Result>(
    operation: () => Promise<Result>,
  ): Promise<Result> {
    this.sharedWriterLockCalls += 1;
    return operation();
  }
}

function addManagedCustomizableFile(
  fileSystem: MemoryManagedProjectFileSystem,
  path: string,
  baseContent: string,
  localContent: string,
  markerIds: readonly string[],
): void {
  fileSystem.files.set(path, localContent);
  const ownership = JSON.parse(
    fileSystem.files.get(".sayhi/managed-files.json")!,
  );
  ownership.files.push({
    schemaVersion: 1,
    path,
    ownershipClass: "managed-customizable",
    installedBaseIdentity: {
      algorithm: "sha256-lf-v1",
      digest: createHash("sha256").update(baseContent).digest("hex"),
    },
    generatedSourceVersion: "0.0.0",
    markerIds,
  });
  fileSystem.files.set(
    ".sayhi/managed-files.json",
    `${JSON.stringify(ownership, null, 2)}\n`,
  );
}

test("Core initializes the repository-owned Project Store and doctor reports it healthy", async () => {
  const fileSystem = new MemoryManagedProjectFileSystem();

  const initialization = await initializeManagedProjectWithTestReleaseArtifacts({
    fileSystem,
    projectId: "PROJECT-8",
    timestamp: "2026-07-14T08:00:00Z",
    installation: INSTALLATION,
  });

  assert.equal(initialization.ok, true);
  if (!initialization.ok) {
    return;
  }
  assert.equal(initialization.created, true);
  assert.equal(initialization.state, "healthy");
  assert.deepEqual([...fileSystem.directories].sort(), [...REQUIRED_DIRECTORIES].sort());
  assert.deepEqual([...fileSystem.files.keys()].sort(), [
    ".sayhi/.gitignore",
    ".sayhi/config.yaml",
    ".sayhi/managed-files.json",
    ".sayhi/manifest.json",
  ]);

  const diagnosis = await diagnoseProject({
    fileSystem,
    installation: INSTALLATION,
  });

  assert.deepEqual(diagnosis, {
    ok: true,
    contractVersion: 1,
    state: "healthy",
    diagnostics: [],
  });
});

test("Core rejects missing, modified, and substituted Skill bundles during initialization and diagnosis", async () => {
  const invalidBundles = [
    { name: "missing", files: TEST_SKILL_BUNDLE.files.slice(1) },
    {
      name: "modified",
      files: TEST_SKILL_BUNDLE.files.map((file, index) =>
        index === 0 ? { ...file, content: "modified skill\n" } : file,
      ),
    },
    {
      name: "substituted",
      files: TEST_SKILL_BUNDLE.files.map((file, index) =>
        index === 0 ? { ...file, path: "substituted/SKILL.md" } : file,
      ),
    },
  ] as const;

  for (const invalidBundle of invalidBundles) {
    const initializationFileSystem = new MemoryManagedProjectFileSystem();
    const initialization = await initializeManagedProjectWithTestReleaseArtifacts({
      fileSystem: initializationFileSystem,
      projectId: "PROJECT-35-INIT",
      timestamp: "2026-07-20T10:00:00Z",
      installation: INSTALLATION,
      skillBundle: { ...TEST_SKILL_BUNDLE, files: invalidBundle.files },
    } as never);
    assert.equal(initialization.ok, false, invalidBundle.name);
    if (!initialization.ok) {
      assert.equal(
        initialization.diagnostics[0]?.code,
        "managed_project.skill_bundle_invalid",
        invalidBundle.name,
      );
    }
    assert.deepEqual(initializationFileSystem.directories, new Set(), invalidBundle.name);
    assert.deepEqual(initializationFileSystem.files, new Map(), invalidBundle.name);

    const diagnosisFileSystem = new MemoryManagedProjectFileSystem();
    const initialized = await initializeManagedProjectWithTestReleaseArtifacts({
      fileSystem: diagnosisFileSystem,
      projectId: "PROJECT-35-DOCTOR",
      timestamp: "2026-07-20T10:00:00Z",
      installation: INSTALLATION,
      skillBundle: TEST_SKILL_BUNDLE,
    } as never);
    assert.equal(initialized.ok, true, invalidBundle.name);
    const diagnosis = await diagnoseProject({
      fileSystem: diagnosisFileSystem,
      installation: INSTALLATION,
      skillBundle: { ...TEST_SKILL_BUNDLE, files: invalidBundle.files },
    } as never);
    assert.equal(diagnosis.ok, false, invalidBundle.name);
    if (!diagnosis.ok) {
      assert.equal(
        diagnosis.diagnostics[0]?.code,
        "managed_project.skill_bundle_invalid",
        invalidBundle.name,
      );
    }
  }
});

test("Core canonicalizes coordinated release artifacts and detects integrity tampering", () => {
  const created = createCoordinatedReleaseArtifacts({
    skillBundle: TEST_SKILL_BUNDLE,
    compatibility: {
      templates: "0.0.0",
      skillBundleContract: 1,
      projectSchema: 1,
      managedProjectContract: 1,
      recordContract: 1,
    },
    versions: { omp: "0.0.0", cli: "0.0.0", core: "0.0.0" },
    provenance: {
      revision: "0.0.0-test",
      repository: "https://github.com/dnslin/SayHi",
    },
  });
  assert.equal(created.ok, true);
  if (!created.ok) {
    return;
  }
  assert.deepEqual(created.releaseArtifacts, TEST_RELEASE_ARTIFACTS);

  const verified = coreContract.verifyCoordinatedReleaseArtifacts(
    TEST_RELEASE_ARTIFACTS,
  );
  assert.equal(verified.ok, true);
  if (verified.ok) {
    assert.deepEqual(verified.releaseArtifacts, TEST_RELEASE_ARTIFACTS);
  }

  const mismatches = [
    Object.freeze({
      ...TEST_RELEASE_ARTIFACTS,
      artifacts: Object.freeze({
        ...TEST_RELEASE_ARTIFACTS.artifacts,
        core: Object.freeze({
          ...TEST_RELEASE_ARTIFACTS.artifacts.core,
          integrity: tamperedIntegrity(TEST_RELEASE_ARTIFACTS.artifacts.core.integrity),
        }),
      }),
    }),
    Object.freeze({
      ...TEST_RELEASE_ARTIFACTS,
      integrity: tamperedIntegrity(TEST_RELEASE_ARTIFACTS.integrity),
    }),
  ] as const;
  for (const mismatch of mismatches) {
    const result = coreContract.verifyCoordinatedReleaseArtifacts(mismatch);
    assert.equal(result.ok, false);
    if (!result.ok) {
      assert.equal(result.diagnostics[0]?.code, "release_artifacts.mismatch");
    }
  }
});

test("Core binds Managed Project installation to its compiled release artifacts", async () => {
  const forged = createCoordinatedReleaseArtifacts({
    provenance: {
      repository: "https://example.invalid/untrusted-release",
      revision: "forged-source-revision",
    },
    versions: { core: "0.0.0", cli: "0.0.0", omp: "0.0.0" },
    compatibility: {
      recordContract: 1,
      managedProjectContract: 1,
      projectSchema: 1,
      templates: "0.1.0",
      skillBundleContract: 1,
    },
    skillBundle: TEST_SKILL_BUNDLE,
  });
  assert.equal(forged.ok, true);
  if (!forged.ok) {
    return;
  }

  const fileSystem = new MemoryManagedProjectFileSystem();
  const initialized = await coreContract.initializeManagedProject({
    fileSystem,
    projectId: "PROJECT-36-FORGED",
    timestamp: "2026-07-20T10:00:00Z",
    releaseArtifacts: forged.releaseArtifacts,
  });
  assert.equal(initialized.ok, false);
  if (!initialized.ok) {
    assert.equal(
      initialized.diagnostics[0]?.code,
      "managed_project.release_artifacts_invalid",
    );
  }
  assert.deepEqual(fileSystem.directories, new Set());
  assert.deepEqual(fileSystem.files, new Map());
});

test("Core snapshots Skill Bundle bytes and pins production provenance", () => {
  const mutableSkillBundle = {
    lock: {
      ...TEST_SKILL_BUNDLE.lock,
      registry: { ...TEST_SKILL_BUNDLE.lock.registry },
    },
    files: TEST_SKILL_BUNDLE.files.map((file, index) => ({
      ...file,
      content:
        index === 0
          ? new Uint8Array(Buffer.from(file.content, "utf8"))
          : file.content,
    })),
  };
  const created = createCoordinatedReleaseArtifacts({
    provenance: TEST_RELEASE_ARTIFACTS.artifacts.core.provenance,
    versions: {
      core: TEST_RELEASE_ARTIFACTS.artifacts.core.version,
      cli: TEST_RELEASE_ARTIFACTS.artifacts.cli.version,
      omp: TEST_RELEASE_ARTIFACTS.artifacts.omp.version,
    },
    compatibility: TEST_RELEASE_ARTIFACTS.artifacts.core.compatibility,
    skillBundle: mutableSkillBundle,
  });
  assert.equal(created.ok, true);
  if (!created.ok) {
    return;
  }
  assert.equal(Object.isFrozen(created.releaseArtifacts.skillBundle), true);
  mutableSkillBundle.lock.registry.commit = "2".repeat(40);
  assert.equal(
    readRegistryCommit(created.releaseArtifacts.skillBundle.lock),
    "1".repeat(40),
  );
  const mutableContent = mutableSkillBundle.files[0]?.content;
  assert.ok(mutableContent instanceof Uint8Array);
  if (!(mutableContent instanceof Uint8Array)) {
    return;
  }
  mutableContent[0] = 0;
  const releasedContent = created.releaseArtifacts.skillBundle.files[0]?.content;
  assert.ok(releasedContent instanceof Uint8Array);
  if (releasedContent instanceof Uint8Array) {
    assert.equal(releasedContent[0], "implement skill\n".charCodeAt(0));
  }
  assert.match(
    COORDINATED_RELEASE_ARTIFACTS.artifacts.core.provenance.revision,
    /^git:[0-9a-f]{40}$/u,
  );
});

function tamperedIntegrity(identity: string): string {
  return `${identity.slice(0, -1)}${identity.endsWith("0") ? "1" : "0"}`;
}

function readRegistryCommit(lock: unknown): string | undefined {
  if (
    lock === null ||
    typeof lock !== "object" ||
    Array.isArray(lock) ||
    !("registry" in lock)
  ) {
    return undefined;
  }
  const { registry } = lock;
  if (
    registry === null ||
    typeof registry !== "object" ||
    Array.isArray(registry) ||
    !("commit" in registry) ||
    typeof registry.commit !== "string"
  ) {
    return undefined;
  }
  return registry.commit;
}

test("Core rejects incompatible coordinated release artifacts before installation writes", async () => {
  const incompatibleArtifacts = [
    {
      name: "Core",
      releaseArtifacts: Object.freeze({
        ...TEST_RELEASE_ARTIFACTS,
        artifacts: Object.freeze({
          ...TEST_RELEASE_ARTIFACTS.artifacts,
          core: Object.freeze({
            ...TEST_RELEASE_ARTIFACTS.artifacts.core,
            version: "9.0.0",
          }),
        }),
      }),
    },
    {
      name: "Source provenance",
      releaseArtifacts: Object.freeze({
        ...TEST_RELEASE_ARTIFACTS,
        artifacts: Object.freeze({
          ...TEST_RELEASE_ARTIFACTS.artifacts,
          core: Object.freeze({
            ...TEST_RELEASE_ARTIFACTS.artifacts.core,
            provenance: Object.freeze({
              ...TEST_RELEASE_ARTIFACTS.artifacts.core.provenance,
              revision: "other-source",
            }),
          }),
        }),
      }),
    },
    {
      name: "Contract version",
      releaseArtifacts: Object.freeze({
        ...TEST_RELEASE_ARTIFACTS,
        artifacts: Object.freeze({
          ...TEST_RELEASE_ARTIFACTS.artifacts,
          core: Object.freeze({
            ...TEST_RELEASE_ARTIFACTS.artifacts.core,
            compatibility: Object.freeze({
              ...TEST_RELEASE_ARTIFACTS.artifacts.core.compatibility,
              managedProjectContract: 2,
            }),
          }),
        }),
      }),
    },
    {
      name: "CLI",
      releaseArtifacts: Object.freeze({
        ...TEST_RELEASE_ARTIFACTS,
        artifacts: Object.freeze({
          ...TEST_RELEASE_ARTIFACTS.artifacts,
          cli: Object.freeze({
            ...TEST_RELEASE_ARTIFACTS.artifacts.cli,
            version: "9.0.0",
          }),
        }),
      }),
    },
    {
      name: "OMP",
      releaseArtifacts: Object.freeze({
        ...TEST_RELEASE_ARTIFACTS,
        artifacts: Object.freeze({
          ...TEST_RELEASE_ARTIFACTS.artifacts,
          omp: Object.freeze({
            ...TEST_RELEASE_ARTIFACTS.artifacts.omp,
            version: "9.0.0",
          }),
        }),
      }),
    },
    {
      name: "Skill bundle",
      releaseArtifacts: Object.freeze({
        ...TEST_RELEASE_ARTIFACTS,
        skillBundle: Object.freeze({
          ...TEST_SKILL_BUNDLE,
          lock: Object.freeze({
            ...TEST_SKILL_BUNDLE.lock,
            registry: Object.freeze({
              ...TEST_SKILL_BUNDLE.lock.registry,
              commit: "2".repeat(40),
            }),
          }),
        }),
      }),
    },
  ] as const;

  for (const incompatible of incompatibleArtifacts) {
    const initializationFileSystem = new MemoryManagedProjectFileSystem();
    const initialization = await coreContract.initializeManagedProject({
      fileSystem: initializationFileSystem,
      projectId: "PROJECT-36-INIT",
      timestamp: "2026-07-20T10:00:00Z",
      releaseArtifacts: incompatible.releaseArtifacts,
    } as never);
    assert.equal(initialization.ok, false, incompatible.name);
    if (!initialization.ok) {
      assert.equal(
        initialization.diagnostics[0]?.code,
        "managed_project.release_artifacts_invalid",
        incompatible.name,
      );
    }
    assert.deepEqual(initializationFileSystem.directories, new Set(), incompatible.name);
    assert.deepEqual(initializationFileSystem.files, new Map(), incompatible.name);

    const diagnosisFileSystem = new MemoryManagedProjectFileSystem();
    const initialized = await initializeManagedProjectWithTestReleaseArtifacts({
      fileSystem: diagnosisFileSystem,
      projectId: "PROJECT-36-DOCTOR",
      timestamp: "2026-07-20T10:00:00Z",
      installation: INSTALLATION,
    });
    assert.equal(initialized.ok, true, incompatible.name);
    diagnosisFileSystem.writes.length = 0;
    const diagnosis = await coreContract.diagnoseManagedProject({
      fileSystem: diagnosisFileSystem,
      releaseArtifacts: incompatible.releaseArtifacts,
    } as never);
    assert.equal(diagnosis.ok, false, incompatible.name);
    if (!diagnosis.ok) {
      assert.equal(
        diagnosis.diagnostics[0]?.code,
        "managed_project.release_artifacts_invalid",
        incompatible.name,
      );
    }
    assert.deepEqual(diagnosisFileSystem.writes, [], incompatible.name);
  }
});

test("Core initialization is byte-stable and never changes user-owned source content", async () => {
  const fileSystem = new MemoryManagedProjectFileSystem();
  fileSystem.files.set("README.md", "user bytes\r\nremain unchanged\r\n");

  const first = await initializeManagedProjectWithTestReleaseArtifacts({
    fileSystem,
    projectId: "PROJECT-8",
    timestamp: "2026-07-14T08:00:00Z",
    installation: INSTALLATION,
  });
  assert.equal(first.ok, true);
  const installedFiles = new Map(fileSystem.files);
  fileSystem.writes.length = 0;

  const repeated = await initializeManagedProjectWithTestReleaseArtifacts({
    fileSystem,
    projectId: "DIFFERENT-PROJECT-ID",
    timestamp: "2026-07-14T09:00:00Z",
    installation: INSTALLATION,
  });

  assert.deepEqual(repeated, {
    ok: true,
    contractVersion: 1,
    state: "healthy",
    created: false,
    paths: [],
    diagnostics: [],
  });
  assert.deepEqual(fileSystem.writes, []);
  assert.deepEqual(fileSystem.files, installedFiles);
  assert.equal(
    fileSystem.files.get("README.md"),
    "user bytes\r\nremain unchanged\r\n",
  );
});

test("Core updates unchanged Engine-owned files and retains User-owned bytes", async () => {
  const fileSystem = new MemoryManagedProjectFileSystem();
  await initializeManagedProjectWithTestReleaseArtifacts({
    fileSystem,
    projectId: "PROJECT-9-UPDATE",
    timestamp: "2026-07-14T08:00:00Z",
    installation: INSTALLATION,
  });
  fileSystem.files.set(".sayhi/config.yaml", "schemaVersion: 1\nuserSetting: keep\n");

  const planned = await planManagedProjectUpdate({
    fileSystem,
    installation: NEXT_INSTALLATION,
    files: [
      {
        path: ".sayhi/config.yaml",
        ownershipClass: "user-owned",
        installedContent: "schemaVersion: 1\n",
        incomingContent: "schemaVersion: 2\n",
        generatedSourceVersion: "1.0.0",
        markerIds: [],
      },
      {
        path: ".sayhi/.gitignore",
        ownershipClass: "engine-owned",
        installedContent: MANAGED_PROJECT_RUNTIME_IGNORE_CONTENT,
        incomingContent: NEXT_RUNTIME_IGNORE_CONTENT,
        generatedSourceVersion: "1.0.0",
        markerIds: [],
      },
    ],
  });

  assert.equal(planned.ok, true);
  if (!planned.ok) {
    return;
  }
  assert.deepEqual(
    planned.plan.actions.map(({ path, result }) => [path, result]),
    [
      [".sayhi/.gitignore", "update"],
      [".sayhi/config.yaml", "retain"],
    ],
  );

  const applied = await applyManagedProjectPlan({
    fileSystem,
    plan: planned.plan,
    timestamp: "2026-07-14T09:00:00Z",
  });

  assert.equal(applied.ok, true);
  assert.equal(applied.state, "applied");
  assert.equal(fileSystem.sharedWriterLockCalls, 1);
  assert.equal(
    fileSystem.files.get(".sayhi/.gitignore"),
    NEXT_RUNTIME_IGNORE_CONTENT,
  );
  assert.equal(
    fileSystem.files.get(".sayhi/config.yaml"),
    "schemaVersion: 1\nuserSetting: keep\n",
  );
  const manifest = JSON.parse(fileSystem.files.get(".sayhi/manifest.json")!);
  assert.deepEqual(manifest.installed, NEXT_INSTALLATION);
  assert.equal(manifest.updatedAt, "2026-07-14T09:00:00Z");
  const ownership = JSON.parse(
    fileSystem.files.get(".sayhi/managed-files.json")!,
  );
  assert.equal(
    ownership.files.find(({ path }: { path: string }) => path === ".sayhi/.gitignore")
      .installedBaseIdentity.digest,
    "553f2e49fea32f6b914b2a47b6fb5ac111bf953947333df27004896d3f3ce0d2",
  );
});

test("Core preserves all update variants when an Engine-owned file diverges", async () => {
  const fileSystem = new MemoryManagedProjectFileSystem();
  await initializeManagedProjectWithTestReleaseArtifacts({
    fileSystem,
    projectId: "PROJECT-9-CONFLICT",
    timestamp: "2026-07-14T08:00:00Z",
    installation: INSTALLATION,
  });
  const localContent = MODIFIED_RUNTIME_IGNORE_CONTENT;
  const incomingContent = NEXT_RUNTIME_IGNORE_CONTENT;
  fileSystem.files.set(".sayhi/.gitignore", localContent);

  const planned = await planManagedProjectUpdate({
    fileSystem,
    installation: NEXT_INSTALLATION,
    files: [
      {
        path: ".sayhi/config.yaml",
        ownershipClass: "user-owned",
        installedContent: "schemaVersion: 1\n",
        incomingContent: "schemaVersion: 2\n",
        generatedSourceVersion: "1.0.0",
        markerIds: [],
      },
      {
        path: ".sayhi/.gitignore",
        ownershipClass: "engine-owned",
        installedContent: MANAGED_PROJECT_RUNTIME_IGNORE_CONTENT,
        incomingContent,
        generatedSourceVersion: "1.0.0",
        markerIds: [],
      },
    ],
  });

  assert.equal(planned.ok, true);
  if (!planned.ok) {
    return;
  }
  const conflict = planned.plan.actions.find(
    ({ path }) => path === ".sayhi/.gitignore",
  );
  assert.equal(conflict?.result, "conflict");
  if (conflict?.result !== "conflict") {
    return;
  }

  const applied = await applyManagedProjectPlan({
    fileSystem,
    plan: planned.plan,
    timestamp: "2026-07-14T09:00:00Z",
  });

  assert.equal(applied.ok, false);
  assert.equal(applied.state, "conflict");
  assert.equal(fileSystem.files.get(".sayhi/.gitignore"), localContent);
  assert.equal(fileSystem.files.get(conflict.variants.local), localContent);
  assert.equal(
    fileSystem.files.get(conflict.variants.base),
    MANAGED_PROJECT_RUNTIME_IGNORE_CONTENT,
  );
  assert.equal(
    fileSystem.files.get(conflict.variants.incoming),
    incomingContent,
  );
  const manifest = JSON.parse(fileSystem.files.get(".sayhi/manifest.json")!);
  assert.deepEqual(manifest.installed, INSTALLATION);
  const ownership = JSON.parse(
    fileSystem.files.get(".sayhi/managed-files.json")!,
  );
  assert.equal(
    ownership.files.find(({ path }: { path: string }) => path === ".sayhi/.gitignore")
      .incomingUpdateIdentity.digest,
    "553f2e49fea32f6b914b2a47b6fb5ac111bf953947333df27004896d3f3ce0d2",
  );
});

test("Core uninstalls matching Engine-owned files and retains User-owned content", async () => {
  const fileSystem = new MemoryManagedProjectFileSystem();
  await initializeManagedProjectWithTestReleaseArtifacts({
    fileSystem,
    projectId: "PROJECT-9-UNINSTALL",
    timestamp: "2026-07-14T08:00:00Z",
    installation: INSTALLATION,
  });
  const userContent = "schemaVersion: 1\nuserSetting: keep\n";
  fileSystem.files.set(".sayhi/config.yaml", userContent);

  const planned = await planManagedProjectUninstall({
    fileSystem,
    files: [
      { path: ".sayhi/.gitignore", installedContent: MANAGED_PROJECT_RUNTIME_IGNORE_CONTENT },
      { path: ".sayhi/config.yaml", installedContent: "schemaVersion: 1\n" },
    ],
  });

  assert.equal(planned.ok, true);
  if (!planned.ok) {
    return;
  }
  assert.deepEqual(
    planned.plan.actions.map(({ path, result }) => [path, result]),
    [
      [".sayhi/.gitignore", "remove"],
      [".sayhi/config.yaml", "retain"],
    ],
  );

  const applied = await applyManagedProjectPlan({
    fileSystem,
    plan: planned.plan,
    timestamp: "2026-07-14T09:00:00Z",
  });

  assert.equal(applied.ok, true);
  assert.equal(applied.state, "applied");
  assert.equal(applied.operation, "uninstall");
  assert.equal(fileSystem.files.has(".sayhi/.gitignore"), false);
  assert.equal(fileSystem.files.get(".sayhi/config.yaml"), userContent);
  assert.equal(fileSystem.files.has(".sayhi/managed-files.json"), false);
  assert.equal(fileSystem.files.has(".sayhi/manifest.json"), false);
  const diagnosis = await diagnoseProject({
    fileSystem,
    installation: INSTALLATION,
  });
  assert.equal(diagnosis.state, "missing");
});

test("Core updates and uninstalls Managed Blocks without changing surrounding user bytes", async () => {
  const fileSystem = new MemoryManagedProjectFileSystem();
  await initializeManagedProjectWithTestReleaseArtifacts({
    fileSystem,
    projectId: "PROJECT-9-BLOCKS",
    timestamp: "2026-07-14T08:00:00Z",
    installation: INSTALLATION,
  });
  const path = ".sayhi/agents/project.md";
  const base = [
    "<!-- sayhi:managed:start agent-body -->",
    "old managed instructions",
    "<!-- sayhi:managed:end agent-body -->",
    "",
  ].join("\n");
  const incoming = [
    "<!-- sayhi:managed:start agent-body -->",
    "new managed instructions",
    "<!-- sayhi:managed:end agent-body -->",
    "",
  ].join("\n");
  const local = `user preface\n${base}user epilogue\n`;
  addManagedCustomizableFile(
    fileSystem,
    path,
    base,
    local,
    ["agent-body"],
  );

  const update = await planManagedProjectUpdate({
    fileSystem,
    installation: NEXT_INSTALLATION,
    files: [
      {
        path,
        ownershipClass: "managed-customizable",
        installedContent: base,
        incomingContent: incoming,
        generatedSourceVersion: "1.0.0",
        markerIds: ["agent-body"],
      },
    ],
  });
  assert.equal(update.ok, true);
  if (!update.ok) {
    return;
  }
  assert.equal(update.plan.actions[0]?.result, "update");
  const updated = await applyManagedProjectPlan({
    fileSystem,
    plan: update.plan,
    timestamp: "2026-07-14T09:00:00Z",
  });
  assert.equal(updated.ok, true);
  assert.equal(fileSystem.files.get(path), `user preface\n${incoming}user epilogue\n`);

  const uninstall = await planManagedProjectUninstall({
    fileSystem,
    files: [
      { path: ".sayhi/.gitignore", installedContent: MANAGED_PROJECT_RUNTIME_IGNORE_CONTENT },
      { path, installedContent: incoming },
    ],
  });
  assert.equal(uninstall.ok, true);
  if (!uninstall.ok) {
    return;
  }
  assert.equal(
    uninstall.plan.actions.find((action) => action.path === path)?.result,
    "update",
  );
  const uninstalled = await applyManagedProjectPlan({
    fileSystem,
    plan: uninstall.plan,
    timestamp: "2026-07-14T10:00:00Z",
  });
  assert.equal(uninstalled.ok, true);
  assert.equal(fileSystem.files.get(path), "user preface\nuser epilogue\n");
});

test("Core recovers a partially applied mixed-ownership update from its journal", async () => {
  const fileSystem = new MemoryManagedProjectFileSystem();
  await initializeManagedProjectWithTestReleaseArtifacts({
    fileSystem,
    projectId: "PROJECT-9-RECOVERY",
    timestamp: "2026-07-14T08:00:00Z",
    installation: INSTALLATION,
  });
  const path = ".sayhi/agents/project.md";
  const base = [
    "<!-- sayhi:managed:start agent-body -->",
    "old managed instructions",
    "<!-- sayhi:managed:end agent-body -->",
    "",
  ].join("\n");
  const incoming = base.replace("old managed", "new managed");
  const local = `user preface\n${base}user epilogue\n`;
  addManagedCustomizableFile(fileSystem, path, base, local, ["agent-body"]);
  const userConfig = "schemaVersion: 1\nuserSetting: keep\n";
  fileSystem.files.set(".sayhi/config.yaml", userConfig);

  const planned = await planManagedProjectUpdate({
    fileSystem,
    installation: NEXT_INSTALLATION,
    files: [
      {
        path: ".sayhi/.gitignore",
        ownershipClass: "engine-owned",
        installedContent: MANAGED_PROJECT_RUNTIME_IGNORE_CONTENT,
        incomingContent: NEXT_RUNTIME_IGNORE_CONTENT,
        generatedSourceVersion: "1.0.0",
        markerIds: [],
      },
      {
        path,
        ownershipClass: "managed-customizable",
        installedContent: base,
        incomingContent: incoming,
        generatedSourceVersion: "1.0.0",
        markerIds: ["agent-body"],
      },
      {
        path: ".sayhi/config.yaml",
        ownershipClass: "user-owned",
        installedContent: "schemaVersion: 1\n",
        incomingContent: "schemaVersion: 2\n",
        generatedSourceVersion: "1.0.0",
        markerIds: [],
      },
    ],
  });
  assert.equal(planned.ok, true);
  if (!planned.ok) {
    return;
  }

  fileSystem.failOnce(path);
  const interrupted = await applyManagedProjectPlan({
    fileSystem,
    plan: planned.plan,
    timestamp: "2026-07-14T09:00:00Z",
  });
  assert.equal(interrupted.ok, false);
  assert.equal(interrupted.state, "invalid");
  assert.equal(
    interrupted.diagnostics[0]?.code,
    "managed_project.io_failed",
  );
  assert.equal(
    fileSystem.files.get(".sayhi/.gitignore"),
    NEXT_RUNTIME_IGNORE_CONTENT,
  );
  assert.equal(fileSystem.files.get(path), local);
  assert.equal(
    fileSystem.files.has(".sayhi/.runtime/managed-operation.json"),
    true,
  );

  const recovered = await recoverManagedProjectOperation({ fileSystem });

  assert.equal(recovered.ok, true);
  assert.equal(recovered.state, "applied");
  assert.equal(fileSystem.files.get(path), `user preface\n${incoming}user epilogue\n`);
  assert.equal(fileSystem.files.get(".sayhi/config.yaml"), userConfig);
  assert.equal(
    fileSystem.files.has(".sayhi/.runtime/managed-operation.json"),
    false,
  );
  const diagnosis = await diagnoseProject({
    fileSystem,
    installation: NEXT_INSTALLATION,
  });
  assert.equal(diagnosis.state, "healthy");
});

test("Core conflicts on modified or ambiguous Managed Blocks", async () => {
  const path = ".sayhi/agents/project.md";
  const base = [
    "<!-- sayhi:managed:start agent-body -->",
    "managed instructions",
    "<!-- sayhi:managed:end agent-body -->",
    "",
  ].join("\n");
  const incoming = base.replace("managed instructions", "new instructions");
  const localCases = [
    base.replace("managed instructions", "user changed managed instructions"),
    `${base}${base}`,
  ];

  for (const localContent of localCases) {
    const fileSystem = new MemoryManagedProjectFileSystem();
    await initializeManagedProjectWithTestReleaseArtifacts({
      fileSystem,
      projectId: "PROJECT-9-BLOCK-CONFLICT",
      timestamp: "2026-07-14T08:00:00Z",
      installation: INSTALLATION,
    });
    addManagedCustomizableFile(
      fileSystem,
      path,
      base,
      localContent,
      ["agent-body"],
    );
    const planned = await planManagedProjectUpdate({
      fileSystem,
      installation: NEXT_INSTALLATION,
      files: [
        {
          path,
          ownershipClass: "managed-customizable",
          installedContent: base,
          incomingContent: incoming,
          generatedSourceVersion: "1.0.0",
          markerIds: ["agent-body"],
        },
      ],
    });
    assert.equal(planned.ok, true);
    if (!planned.ok) {
      continue;
    }
    const conflict = planned.plan.actions[0];
    assert.equal(conflict?.result, "conflict");
    if (conflict?.result !== "conflict") {
      continue;
    }

    const applied = await applyManagedProjectPlan({
      fileSystem,
      plan: planned.plan,
      timestamp: "2026-07-14T09:00:00Z",
    });

    assert.equal(applied.state, "conflict");
    assert.equal(fileSystem.files.get(path), localContent);
    assert.equal(fileSystem.files.get(conflict.variants.local), localContent);
    assert.equal(fileSystem.files.get(conflict.variants.base), base);
    assert.equal(fileSystem.files.get(conflict.variants.incoming), incoming);
  }
});

test("Core preserves a divergent Engine-owned file during uninstall", async () => {
  const fileSystem = new MemoryManagedProjectFileSystem();
  await initializeManagedProjectWithTestReleaseArtifacts({
    fileSystem,
    projectId: "PROJECT-9-UNINSTALL-CONFLICT",
    timestamp: "2026-07-14T08:00:00Z",
    installation: INSTALLATION,
  });
  const localContent = MODIFIED_RUNTIME_IGNORE_CONTENT;
  fileSystem.files.set(".sayhi/.gitignore", localContent);
  const planned = await planManagedProjectUninstall({
    fileSystem,
    files: [
      { path: ".sayhi/.gitignore", installedContent: MANAGED_PROJECT_RUNTIME_IGNORE_CONTENT },
      { path: ".sayhi/config.yaml", installedContent: "schemaVersion: 1\n" },
    ],
  });
  assert.equal(planned.ok, true);
  if (!planned.ok) {
    return;
  }
  const conflict = planned.plan.actions.find(
    (action) => action.path === ".sayhi/.gitignore",
  );
  assert.equal(conflict?.result, "conflict");
  if (conflict?.result !== "conflict") {
    return;
  }

  const applied = await applyManagedProjectPlan({
    fileSystem,
    plan: planned.plan,
    timestamp: "2026-07-14T09:00:00Z",
  });

  assert.equal(applied.state, "conflict");
  assert.equal(fileSystem.files.get(".sayhi/.gitignore"), localContent);
  assert.equal(fileSystem.files.get(conflict.variants.local), localContent);
  assert.equal(fileSystem.files.get(conflict.variants.base), MANAGED_PROJECT_RUNTIME_IGNORE_CONTENT);
  assert.equal(fileSystem.files.has(".sayhi/manifest.json"), true);
  assert.equal(fileSystem.files.has(".sayhi/managed-files.json"), true);
});

test("Core rejects stale plans before creating an operation journal", async () => {
  const fileSystem = new MemoryManagedProjectFileSystem();
  await initializeManagedProjectWithTestReleaseArtifacts({
    fileSystem,
    projectId: "PROJECT-9-STALE",
    timestamp: "2026-07-14T08:00:00Z",
    installation: INSTALLATION,
  });
  const planned = await planManagedProjectUpdate({
    fileSystem,
    installation: NEXT_INSTALLATION,
    files: [
      {
        path: ".sayhi/.gitignore",
        ownershipClass: "engine-owned",
        installedContent: MANAGED_PROJECT_RUNTIME_IGNORE_CONTENT,
        incomingContent: NEXT_RUNTIME_IGNORE_CONTENT,
        generatedSourceVersion: "1.0.0",
        markerIds: [],
      },
    ],
  });
  assert.equal(planned.ok, true);
  if (!planned.ok) {
    return;
  }
  fileSystem.files.set(".sayhi/.gitignore", "changed after planning\n");

  const applied = await applyManagedProjectPlan({
    fileSystem,
    plan: planned.plan,
    timestamp: "2026-07-14T09:00:00Z",
  });

  assert.equal(applied.state, "invalid");
  assert.equal(
    fileSystem.files.has(".sayhi/.runtime/managed-operation.json"),
    false,
  );
});

test("Core rejects an invalid apply timestamp before writing files or a journal", async () => {
  const fileSystem = new MemoryManagedProjectFileSystem();
  await initializeManagedProjectWithTestReleaseArtifacts({
    fileSystem,
    projectId: "PROJECT-9-INVALID-TIME",
    timestamp: "2026-07-14T08:00:00Z",
    installation: INSTALLATION,
  });
  const planned = await planManagedProjectUpdate({
    fileSystem,
    installation: NEXT_INSTALLATION,
    files: [
      {
        path: ".sayhi/.gitignore",
        ownershipClass: "engine-owned",
        installedContent: MANAGED_PROJECT_RUNTIME_IGNORE_CONTENT,
        incomingContent: NEXT_RUNTIME_IGNORE_CONTENT,
        generatedSourceVersion: "1.0.0",
        markerIds: [],
      },
    ],
  });
  assert.equal(planned.ok, true);
  if (!planned.ok) {
    return;
  }
  const before = new Map(fileSystem.files);

  const applied = await applyManagedProjectPlan({
    fileSystem,
    plan: planned.plan,
    timestamp: "not-a-timestamp",
  });

  assert.equal(applied.state, "invalid");
  assert.deepEqual(fileSystem.files, before);
});

test("Core retains a deleted User-owned path while mixed lifecycle actions continue", async () => {
  const fileSystem = new MemoryManagedProjectFileSystem();
  await initializeManagedProjectWithTestReleaseArtifacts({
    fileSystem,
    projectId: "PROJECT-9-DELETED-USER-FILE",
    timestamp: "2026-07-14T08:00:00Z",
    installation: INSTALLATION,
  });
  await fileSystem.removeFile(".sayhi/config.yaml");
  const incomingEngineContent = NEXT_RUNTIME_IGNORE_CONTENT;

  const update = await planManagedProjectUpdate({
    fileSystem,
    installation: NEXT_INSTALLATION,
    files: [
      {
        path: ".sayhi/config.yaml",
        ownershipClass: "user-owned",
        installedContent: "schemaVersion: 1\n",
        incomingContent: "schemaVersion: 2\n",
        generatedSourceVersion: "1.0.0",
        markerIds: [],
      },
      {
        path: ".sayhi/.gitignore",
        ownershipClass: "engine-owned",
        installedContent: MANAGED_PROJECT_RUNTIME_IGNORE_CONTENT,
        incomingContent: incomingEngineContent,
        generatedSourceVersion: "1.0.0",
        markerIds: [],
      },
    ],
  });
  assert.equal(update.ok, true);
  if (!update.ok) {
    return;
  }
  const updateRetention = update.plan.actions.find(
    (action) => action.path === ".sayhi/config.yaml",
  );
  assert.equal(updateRetention?.result, "retain");
  if (updateRetention?.result === "retain") {
    assert.equal(updateRetention.observedKind, "missing");
  }
  const updated = await applyManagedProjectPlan({
    fileSystem,
    plan: update.plan,
    timestamp: "2026-07-14T09:00:00Z",
  });
  assert.equal(updated.ok, true);
  assert.equal(fileSystem.files.has(".sayhi/config.yaml"), false);
  assert.equal(
    fileSystem.files.get(".sayhi/.gitignore"),
    incomingEngineContent,
  );

  const uninstall = await planManagedProjectUninstall({
    fileSystem,
    files: [
      { path: ".sayhi/.gitignore", installedContent: incomingEngineContent },
      { path: ".sayhi/config.yaml", installedContent: "schemaVersion: 1\n" },
    ],
  });
  assert.equal(uninstall.ok, true);
  if (!uninstall.ok) {
    return;
  }
  const uninstallRetention = uninstall.plan.actions.find(
    (action) => action.path === ".sayhi/config.yaml",
  );
  assert.equal(uninstallRetention?.result, "retain");
  if (uninstallRetention?.result === "retain") {
    assert.equal(uninstallRetention.observedKind, "missing");
  }
  const uninstalled = await applyManagedProjectPlan({
    fileSystem,
    plan: uninstall.plan,
    timestamp: "2026-07-14T10:00:00Z",
  });
  assert.equal(uninstalled.ok, true);
  assert.equal(fileSystem.files.has(".sayhi/config.yaml"), false);
});

test("Core doctor reports missing Project Store state without writing", async () => {
  const fileSystem = new MemoryManagedProjectFileSystem();

  const diagnosis = await diagnoseProject({
    fileSystem,
    installation: INSTALLATION,
  });

  assert.equal(diagnosis.ok, false);
  assert.equal(diagnosis.state, "missing");
  assert.equal(diagnosis.diagnostics[0]?.code, "managed_project.missing");
  assert.match(diagnosis.diagnostics[0]?.remediation ?? "", /sayhi init/u);
  assert.deepEqual(fileSystem.writes, []);
});

test("Core doctor reports incompatible schema and component versions without writing", async () => {
  const cases = [
    (manifest: Record<string, unknown>) => {
      manifest.schemaVersion = 2;
    },
    (manifest: Record<string, unknown>) => {
      const installed = manifest.installed as Record<string, unknown>;
      installed.core = "9.0.0";
    },
  ];

  for (const mutate of cases) {
    const fileSystem = new MemoryManagedProjectFileSystem();
    const initialized = await initializeManagedProjectWithTestReleaseArtifacts({
      fileSystem,
      projectId: "PROJECT-8",
      timestamp: "2026-07-14T08:00:00Z",
      installation: INSTALLATION,
    });
    assert.equal(initialized.ok, true);
    const manifest = JSON.parse(
      fileSystem.files.get(".sayhi/manifest.json") ?? "",
    ) as Record<string, unknown>;
    mutate(manifest);
    fileSystem.files.set(
      ".sayhi/manifest.json",
      `${JSON.stringify(manifest, null, 2)}\n`,
    );
    fileSystem.writes.length = 0;

    const diagnosis = await diagnoseProject({
      fileSystem,
      installation: INSTALLATION,
    });

    assert.equal(diagnosis.ok, false);
    assert.equal(diagnosis.state, "incompatible");
    assert.equal(
      diagnosis.diagnostics[0]?.code,
      "managed_project.incompatible",
    );
    assert.match(diagnosis.diagnostics[0]?.remediation ?? "", /compatible|migrate/u);
    assert.deepEqual(fileSystem.writes, []);
  }
});

test("Core doctor reports malformed and hash-diverged Project Stores as corrupt", async () => {
  const cases = [
    {
      mutate(fileSystem: MemoryManagedProjectFileSystem) {
        fileSystem.files.set(".sayhi/manifest.json", "{not-json");
      },
      code: "managed_project.corrupt",
    },
    {
      mutate(fileSystem: MemoryManagedProjectFileSystem) {
        fileSystem.files.set(
          ".sayhi/managed-files.json",
          '{"schemaVersion":1,"files":[null]}\n',
        );
      },
      code: "managed_project.corrupt",
    },
    {
      mutate(fileSystem: MemoryManagedProjectFileSystem) {
        fileSystem.files.set(".sayhi/.gitignore", "user changed this\n");
      },
      code: "managed_project.file_modified",
    },
    {
      mutate(fileSystem: MemoryManagedProjectFileSystem) {
        fileSystem.symlinks.add(".sayhi/config.yaml");
      },
      code: "managed_project.path_unsafe",
    },
  ] as const;

  for (const { mutate, code } of cases) {
    const fileSystem = new MemoryManagedProjectFileSystem();
    const initialized = await initializeManagedProjectWithTestReleaseArtifacts({
      fileSystem,
      projectId: "PROJECT-8",
      timestamp: "2026-07-14T08:00:00Z",
      installation: INSTALLATION,
    });
    assert.equal(initialized.ok, true);
    mutate(fileSystem);
    fileSystem.writes.length = 0;

    const diagnosis = await diagnoseProject({
      fileSystem,
      installation: INSTALLATION,
    });

    assert.equal(diagnosis.ok, false);
    assert.equal(diagnosis.state, "corrupt");
    assert.equal(diagnosis.diagnostics[0]?.code, code);
    assert.match(diagnosis.diagnostics[0]?.remediation ?? "", /\S/u);
    assert.deepEqual(fileSystem.writes, []);
  }
});
