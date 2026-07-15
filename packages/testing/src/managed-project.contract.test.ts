import assert from "node:assert/strict";
import test from "node:test";

import {
  diagnoseManagedProject,
  initializeManagedProject,
  type ManagedProjectFileSystem,
} from "@dnslin/sayhi-core";

const INSTALLATION = {
  core: "0.0.0",
  cli: "0.0.0",
  ompPlugin: "0.0.0",
  projectSchema: 1,
  templates: "0.0.0",
  skillLockDigest: `sha256:${"a".repeat(64)}`,
} as const;

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

class MemoryManagedProjectFileSystem implements ManagedProjectFileSystem {
  readonly directories = new Set<string>();
  readonly files = new Map<string, string>();
  readonly symlinks = new Set<string>();
  readonly writes: string[] = [];

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
    this.files.set(path, content);
    this.writes.push(path);
  }
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
