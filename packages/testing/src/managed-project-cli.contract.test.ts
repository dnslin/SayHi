import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import {
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";
import test from "node:test";

import { runCli, type CliJsonEnvelope } from "@dnslin/sayhi-cli";


test("CLI initializes a Managed Project idempotently and doctor is read-only", async (t) => {
  const repository = await mkdtemp(join(tmpdir(), "sayhi-managed-project-"));
  t.after(async () => rm(repository, { recursive: true, force: true }));
  await mkdir(join(repository, ".git"));
  await writeFile(join(repository, "README.md"), "user-owned\r\n", "utf8");

  const initialization = await runCli([
    "--cwd",
    repository,
    "--json",
    "init",
  ]);

  assert.equal(initialization.exitCode, 0);
  assert.equal(initialization.stderr, "");
  const initializedEnvelope = JSON.parse(initialization.stdout) as CliJsonEnvelope;
  assert.equal(initializedEnvelope.ok, true);
  assert.equal(initializedEnvelope.operation, "project.init");
  assert.equal(initializedEnvelope.result?.state, "healthy");
  assert.equal(initializedEnvelope.result?.created, true);
  assert.deepEqual(initializedEnvelope.diagnostics, []);
  assert.equal(
    await readFile(join(repository, "README.md"), "utf8"),
    "user-owned\r\n",
  );

  const initializedSnapshot = await snapshotFiles(repository);
  const diagnosis = await runCli([
    "doctor",
    "--json",
    "--cwd",
    repository,
  ]);

  assert.equal(diagnosis.exitCode, 0);
  assert.equal(diagnosis.stderr, "");
  const diagnosedEnvelope = JSON.parse(diagnosis.stdout) as CliJsonEnvelope;
  assert.equal(diagnosedEnvelope.ok, true);
  assert.equal(diagnosedEnvelope.operation, "project.doctor");
  assert.equal(diagnosedEnvelope.result?.state, "healthy");
  assert.deepEqual(await snapshotFiles(repository), initializedSnapshot);

  const repeated = await runCli(["init", "--cwd", repository, "--json"]);
  assert.equal(repeated.exitCode, 0);
  const repeatedEnvelope = JSON.parse(repeated.stdout) as CliJsonEnvelope;
  assert.equal(repeatedEnvelope.result?.created, false);
  assert.deepEqual(await snapshotFiles(repository), initializedSnapshot);
});

test("CLI doctor maps missing Project Store state to exit code 6", async (t) => {
  const repository = await mkdtemp(join(tmpdir(), "sayhi-missing-project-"));
  t.after(async () => rm(repository, { recursive: true, force: true }));
  await mkdir(join(repository, ".git"));
  const before = await snapshotFiles(repository);

  const diagnosis = await runCli(["doctor", "--cwd", repository, "--json"]);

  assert.equal(diagnosis.exitCode, 6);
  assert.equal(diagnosis.stderr, "");
  const envelope = JSON.parse(diagnosis.stdout) as CliJsonEnvelope;
  assert.equal(envelope.ok, false);
  assert.equal(envelope.result?.state, "missing");
  assert.equal(envelope.error?.code, "managed_project.missing");
  assert.deepEqual(await snapshotFiles(repository), before);
});

test("CLI doctor maps incompatible Project Store state to exit code 7", async (t) => {
  const repository = await mkdtemp(join(tmpdir(), "sayhi-incompatible-project-"));
  t.after(async () => rm(repository, { recursive: true, force: true }));
  await mkdir(join(repository, ".git"));
  assert.equal(
    (await runCli(["init", "--cwd", repository, "--json"])).exitCode,
    0,
  );
  const manifestPath = join(repository, ".sayhi", "manifest.json");
  const manifest = JSON.parse(await readFile(manifestPath, "utf8")) as {
    installed: { core: string };
  };
  manifest.installed.core = "9.0.0";
  await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
  const before = await snapshotFiles(repository);

  const diagnosis = await runCli(["--json", "--cwd", repository, "doctor"]);

  assert.equal(diagnosis.exitCode, 7);
  const envelope = JSON.parse(diagnosis.stdout) as CliJsonEnvelope;
  assert.equal(envelope.result?.state, "incompatible");
  assert.equal(envelope.error?.code, "managed_project.incompatible");
  assert.deepEqual(await snapshotFiles(repository), before);
});

test("CLI doctor maps corrupt Project Store state to exit code 3", async (t) => {
  const repository = await mkdtemp(join(tmpdir(), "sayhi-corrupt-project-"));
  t.after(async () => rm(repository, { recursive: true, force: true }));
  await mkdir(join(repository, ".git"));
  assert.equal(
    (await runCli(["init", "--cwd", repository, "--json"])).exitCode,
    0,
  );
  await writeFile(
    join(repository, ".sayhi", ".gitignore"),
    "modified\n",
    "utf8",
  );
  const before = await snapshotFiles(repository);

  const diagnosis = await runCli(["doctor", "--json", "--cwd", repository]);

  assert.equal(diagnosis.exitCode, 3);
  const envelope = JSON.parse(diagnosis.stdout) as CliJsonEnvelope;
  assert.equal(envelope.result?.state, "corrupt");
  assert.equal(envelope.error?.code, "managed_project.file_modified");
  assert.deepEqual(await snapshotFiles(repository), before);
});

test("CLI dry-runs updates read-only and preserves modified Engine-owned files", async (t) => {
  const repository = await mkdtemp(join(tmpdir(), "sayhi-update-project-"));
  t.after(async () => rm(repository, { recursive: true, force: true }));
  await mkdir(join(repository, ".git"));
  assert.equal(
    (await runCli(["init", "--cwd", repository, "--json"])).exitCode,
    0,
  );
  const runtimeIgnorePath = join(repository, ".sayhi", ".gitignore");
  const ownershipPath = join(repository, ".sayhi", "managed-files.json");
  const manifestPath = join(repository, ".sayhi", "manifest.json");
  const legacyContent = "/.runtime/\n";
  const currentContent = "# SayHi local runtime state\n/.runtime/\n";
  await writeFile(runtimeIgnorePath, legacyContent, "utf8");
  const ownership = JSON.parse(await readFile(ownershipPath, "utf8")) as {
    files: Array<{
      path: string;
      installedBaseIdentity?: { digest: string };
      generatedSourceVersion: string;
    }>;
  };
  const runtimeRecord = ownership.files.find(
    (record) => record.path === ".sayhi/.gitignore",
  );
  assert.ok(runtimeRecord?.installedBaseIdentity);
  runtimeRecord.installedBaseIdentity.digest = createHash("sha256")
    .update(legacyContent)
    .digest("hex");
  runtimeRecord.generatedSourceVersion = "0.0.0";
  await writeFile(ownershipPath, `${JSON.stringify(ownership, null, 2)}\n`, "utf8");
  const manifest = JSON.parse(await readFile(manifestPath, "utf8")) as {
    installed: { templates: string };
  };
  manifest.installed.templates = "0.0.0";
  await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
  const legacySnapshot = await snapshotFiles(repository);

  const dryRun = await runCli([
    "update",
    "--dry-run",
    "--cwd",
    repository,
    "--json",
  ]);

  assert.equal(dryRun.exitCode, 0);
  const dryRunEnvelope = JSON.parse(dryRun.stdout) as CliJsonEnvelope;
  assert.equal(dryRunEnvelope.ok, true);
  assert.equal(dryRunEnvelope.operation, "project.update");
  assert.equal(dryRunEnvelope.result?.state, "planned");
  const actions = dryRunEnvelope.result?.actions as readonly {
    path: string;
    result: string;
  }[];
  assert.equal(
    actions.find((action) => action.path === ".sayhi/.gitignore")?.result,
    "update",
  );
  assert.deepEqual(await snapshotFiles(repository), legacySnapshot);

  const safeApply = await runCli([
    "update",
    "--apply",
    "--cwd",
    repository,
    "--json",
  ]);
  assert.equal(safeApply.exitCode, 0);
  assert.equal(await readFile(runtimeIgnorePath, "utf8"), currentContent);
  const updatedManifest = JSON.parse(await readFile(manifestPath, "utf8")) as {
    installed: { templates: string };
  };
  assert.equal(updatedManifest.installed.templates, "0.1.0");

  const localContent = `${currentContent}user-local-change\n`;
  await writeFile(runtimeIgnorePath, localContent, "utf8");
  const conflictApply = await runCli([
    "update",
    "--apply",
    "--cwd",
    repository,
    "--json",
  ]);

  assert.equal(conflictApply.exitCode, 4);
  const appliedEnvelope = JSON.parse(conflictApply.stdout) as CliJsonEnvelope;
  assert.equal(appliedEnvelope.ok, false);
  assert.equal(appliedEnvelope.operation, "project.update");
  assert.equal(appliedEnvelope.result?.state, "conflict");
  assert.equal(
    appliedEnvelope.diagnostics[0]?.code,
    "managed_project.file_modified",
  );
  assert.equal(await readFile(runtimeIgnorePath, "utf8"), localContent);
  const conflicted = await snapshotFiles(repository);
  assert.equal(
    [...conflicted.keys()].filter((path) =>
      path.startsWith(".sayhi/.runtime/conflicts/"),
    ).length,
    3,
  );
});

test("CLI dry-runs and applies uninstall without deleting User-owned content", async (t) => {
  const repository = await mkdtemp(join(tmpdir(), "sayhi-uninstall-project-"));
  t.after(async () => rm(repository, { recursive: true, force: true }));
  await mkdir(join(repository, ".git"));
  assert.equal(
    (await runCli(["init", "--cwd", repository, "--json"])).exitCode,
    0,
  );
  const userContent = "schemaVersion: 1\nuserSetting: keep\n";
  await writeFile(
    join(repository, ".sayhi", "config.yaml"),
    userContent,
    "utf8",
  );
  const before = await snapshotFiles(repository);

  const dryRun = await runCli([
    "uninstall",
    "--dry-run",
    "--cwd",
    repository,
    "--json",
  ]);

  assert.equal(dryRun.exitCode, 0);
  const dryRunEnvelope = JSON.parse(dryRun.stdout) as CliJsonEnvelope;
  assert.equal(dryRunEnvelope.ok, true);
  assert.equal(dryRunEnvelope.operation, "project.uninstall");
  assert.equal(dryRunEnvelope.result?.state, "planned");
  assert.deepEqual(await snapshotFiles(repository), before);

  const applied = await runCli([
    "uninstall",
    "--apply",
    "--cwd",
    repository,
    "--json",
  ]);

  assert.equal(applied.exitCode, 0);
  const appliedEnvelope = JSON.parse(applied.stdout) as CliJsonEnvelope;
  assert.equal(appliedEnvelope.ok, true);
  assert.equal(appliedEnvelope.operation, "project.uninstall");
  assert.equal(appliedEnvelope.result?.state, "applied");
  assert.equal(
    await readFile(join(repository, ".sayhi", "config.yaml"), "utf8"),
    userContent,
  );
  await assert.rejects(readFile(join(repository, ".sayhi", ".gitignore"), "utf8"));
  await assert.rejects(readFile(join(repository, ".sayhi", "manifest.json"), "utf8"));
  await assert.rejects(
    readFile(join(repository, ".sayhi", "managed-files.json"), "utf8"),
  );

  const diagnosis = await runCli(["doctor", "--cwd", repository, "--json"]);
  assert.equal(diagnosis.exitCode, 6);
  const diagnosisEnvelope = JSON.parse(diagnosis.stdout) as CliJsonEnvelope;
  assert.equal(diagnosisEnvelope.result?.state, "missing");

  const reinitialized = await runCli(["init", "--cwd", repository, "--json"]);
  assert.equal(reinitialized.exitCode, 0);
  assert.equal(
    await readFile(join(repository, ".sayhi", "config.yaml"), "utf8"),
    userContent,
  );
  const healthy = await runCli(["doctor", "--cwd", repository, "--json"]);
  assert.equal(healthy.exitCode, 0);
});

async function snapshotFiles(root: string): Promise<ReadonlyMap<string, string>> {
  const snapshot = new Map<string, string>();
  await collectFiles(root, root, snapshot);
  return snapshot;
}

async function collectFiles(
  root: string,
  directory: string,
  snapshot: Map<string, string>,
): Promise<void> {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    const relativePath = relative(root, path).replaceAll("\\", "/");
    if (entry.isDirectory()) {
      await collectFiles(root, path, snapshot);
    } else {
      const metadata = await lstat(path);
      assert.equal(metadata.isSymbolicLink(), false);
      snapshot.set(relativePath, await readFile(path, "base64"));
    }
  }
}
