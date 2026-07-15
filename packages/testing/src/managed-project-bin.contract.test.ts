import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";

import type { CliJsonEnvelope } from "@dnslin/sayhi-cli";

const executeFile = promisify(execFile);
const CLI_BINARY = fileURLToPath(
  new URL("../../cli/dist/bin.js", import.meta.url),
);

test("packaged CLI binary executes Managed Project lifecycle commands", async (t) => {
  const repository = await mkdtemp(join(tmpdir(), "sayhi-cli-binary-"));
  t.after(async () => rm(repository, { recursive: true, force: true }));
  await mkdir(join(repository, ".git"));

  const initialization = await executeFile(process.execPath, [
    CLI_BINARY,
    "init",
    "--cwd",
    repository,
    "--json",
  ]);
  assert.equal(initialization.stderr, "");
  const initialized = JSON.parse(initialization.stdout) as CliJsonEnvelope;
  assert.equal(initialized.ok, true);
  assert.equal(initialized.operation, "project.init");

  const diagnosis = await executeFile(process.execPath, [
    CLI_BINARY,
    "doctor",
    "--cwd",
    repository,
    "--json",
  ]);
  assert.equal(diagnosis.stderr, "");
  const diagnosed = JSON.parse(diagnosis.stdout) as CliJsonEnvelope;
  assert.equal(diagnosed.ok, true);
  assert.equal(diagnosed.result?.state, "healthy");

  const update = await executeFile(process.execPath, [
    CLI_BINARY,
    "update",
    "--dry-run",
    "--cwd",
    repository,
    "--json",
  ]);
  assert.equal(update.stderr, "");
  const updatePlan = JSON.parse(update.stdout) as CliJsonEnvelope;
  assert.equal(updatePlan.ok, true);
  assert.equal(updatePlan.operation, "project.update");
  assert.equal(updatePlan.result?.state, "planned");

  const userConfig = "schemaVersion: 1\nuserSetting: keep\n";
  await writeFile(
    join(repository, ".sayhi", "config.yaml"),
    userConfig,
    "utf8",
  );
  const uninstall = await executeFile(process.execPath, [
    CLI_BINARY,
    "uninstall",
    "--apply",
    "--cwd",
    repository,
    "--json",
  ]);
  assert.equal(uninstall.stderr, "");
  const uninstalled = JSON.parse(uninstall.stdout) as CliJsonEnvelope;
  assert.equal(uninstalled.ok, true);
  assert.equal(uninstalled.operation, "project.uninstall");
  assert.equal(uninstalled.result?.state, "applied");
  assert.equal(
    await readFile(join(repository, ".sayhi", "config.yaml"), "utf8"),
    userConfig,
  );
});
