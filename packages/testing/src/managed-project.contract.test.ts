import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";

import {
  applyManagedProjectPlan,
  diagnoseManagedProject,
  initializeManagedProject,
  MANAGED_PROJECT_RUNTIME_IGNORE_CONTENT,
  recoverManagedProjectOperation,
  planManagedProjectUninstall,
  planManagedProjectUpdate,
  type ManagedProjectMutationFileSystem,
} from "@dnslin/sayhi-core";

const INSTALLATION = {
  core: "0.0.0",
  cli: "0.0.0",
  ompPlugin: "0.0.0",
  projectSchema: 1,
  templates: "0.0.0",
  skillLockDigest: `sha256:${"a".repeat(64)}`,
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

class MemoryManagedProjectFileSystem implements ManagedProjectMutationFileSystem {
  readonly directories = new Set<string>();
  readonly files = new Map<string, string>();
  readonly symlinks = new Set<string>();
  readonly writes: string[] = [];
  #failOncePath: string | null = null;

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

  const initialization = await initializeManagedProject({
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

  const diagnosis = await diagnoseManagedProject({
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

test("Core initialization is byte-stable and never changes user-owned source content", async () => {
  const fileSystem = new MemoryManagedProjectFileSystem();
  fileSystem.files.set("README.md", "user bytes\r\nremain unchanged\r\n");

  const first = await initializeManagedProject({
    fileSystem,
    projectId: "PROJECT-8",
    timestamp: "2026-07-14T08:00:00Z",
    installation: INSTALLATION,
  });
  assert.equal(first.ok, true);
  const installedFiles = new Map(fileSystem.files);
  fileSystem.writes.length = 0;

  const repeated = await initializeManagedProject({
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
  await initializeManagedProject({
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
  await initializeManagedProject({
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
  await initializeManagedProject({
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
  const diagnosis = await diagnoseManagedProject({
    fileSystem,
    installation: INSTALLATION,
  });
  assert.equal(diagnosis.state, "missing");
});

test("Core updates and uninstalls Managed Blocks without changing surrounding user bytes", async () => {
  const fileSystem = new MemoryManagedProjectFileSystem();
  await initializeManagedProject({
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
  await initializeManagedProject({
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
  const diagnosis = await diagnoseManagedProject({
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
    await initializeManagedProject({
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
  await initializeManagedProject({
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
  await initializeManagedProject({
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
  await initializeManagedProject({
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
  await initializeManagedProject({
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

  const diagnosis = await diagnoseManagedProject({
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
    const initialized = await initializeManagedProject({
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

    const diagnosis = await diagnoseManagedProject({
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
    const initialized = await initializeManagedProject({
      fileSystem,
      projectId: "PROJECT-8",
      timestamp: "2026-07-14T08:00:00Z",
      installation: INSTALLATION,
    });
    assert.equal(initialized.ok, true);
    mutate(fileSystem);
    fileSystem.writes.length = 0;

    const diagnosis = await diagnoseManagedProject({
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
