import { createHash, randomUUID } from "node:crypto";
import { homedir } from "node:os";
import { resolve } from "node:path";

import {
  applyManagedProjectPlan,
  coreContract,
  MANAGED_PROJECT_CONFIG_CONTENT,
  MANAGED_PROJECT_CONFIG_PATH,
  MANAGED_PROJECT_OPERATION_JOURNAL_PATH,
  MANAGED_PROJECT_RUNTIME_IGNORE_CONTENT,
  MANAGED_PROJECT_RUNTIME_IGNORE_PATH,
  planManagedProjectUninstall,
  planManagedProjectUpdate,
  recoverManagedProjectOperation,
  type ApplyManagedProjectPlanResult,
  type ContractIdentity,
  type DiagnoseManagedProjectResult,
  type DiagnoseDurableTasksResult,
  type InitializeManagedProjectResult,
  type InstalledProjectVersions,
  type ManagedProjectInstalledFile,
  type ManagedProjectUpdateFile,
  type PlanManagedProjectUninstallResult,
  type PlanManagedProjectUpdateResult,
} from "@dnslin/sayhi-core";

import {
  findGitRepositoryRoot,
  NodeManagedProjectFileSystem,
} from "./managed-project-filesystem.js";

const EMPTY_SKILL_LOCK_DIGEST = `sha256:${createHash("sha256")
  .update('{"skills":[]}')
  .digest("hex")}` as ContractIdentity;

const LEGACY_RUNTIME_IGNORE_CONTENT = "/.runtime/\n";

export const CLI_MANAGED_PROJECT_INSTALLATION: InstalledProjectVersions =
  Object.freeze({
    core: "0.0.0",
    cli: "0.0.0",
    ompPlugin: "0.0.0",
    projectSchema: 1,
    templates: "0.1.0",
    skillLockDigest: EMPTY_SKILL_LOCK_DIGEST,
  });

const CLI_MANAGED_PROJECT_UPDATE_FILES = Object.freeze([
  Object.freeze({
    path: MANAGED_PROJECT_CONFIG_PATH,
    ownershipClass: "user-owned",
    installedContent: MANAGED_PROJECT_CONFIG_CONTENT,
    incomingContent: MANAGED_PROJECT_CONFIG_CONTENT,
    generatedSourceVersion: CLI_MANAGED_PROJECT_INSTALLATION.templates,
    markerIds: Object.freeze([]),
  }),
  Object.freeze({
    path: MANAGED_PROJECT_RUNTIME_IGNORE_PATH,
    ownershipClass: "engine-owned",
    installedContent: MANAGED_PROJECT_RUNTIME_IGNORE_CONTENT,
    installedAlternatives: Object.freeze([LEGACY_RUNTIME_IGNORE_CONTENT]),
    incomingContent: MANAGED_PROJECT_RUNTIME_IGNORE_CONTENT,
    generatedSourceVersion: CLI_MANAGED_PROJECT_INSTALLATION.templates,
    markerIds: Object.freeze([]),
  }),
]) satisfies readonly ManagedProjectUpdateFile[];

const CLI_MANAGED_PROJECT_INSTALLED_FILES = Object.freeze([
  Object.freeze({
    path: MANAGED_PROJECT_CONFIG_PATH,
    installedContent: MANAGED_PROJECT_CONFIG_CONTENT,
  }),
  Object.freeze({
    path: MANAGED_PROJECT_RUNTIME_IGNORE_PATH,
    installedContent: MANAGED_PROJECT_RUNTIME_IGNORE_CONTENT,
    installedAlternatives: Object.freeze([LEGACY_RUNTIME_IGNORE_CONTENT]),
  }),
]) satisfies readonly ManagedProjectInstalledFile[];

export interface CliRunResult {
  readonly exitCode: number;
  readonly stdout: string;
  readonly stderr: string;
}

export interface CliJsonVersion {
  readonly cli: string;
  readonly core: string;
  readonly schema: number;
}

export interface CliJsonDiagnostic {
  readonly code: string;
  readonly path?: string;
  readonly message: string;
  readonly remediation: string;
}

export interface CliJsonError extends CliJsonDiagnostic {}

export interface CliJsonEnvelope {
  readonly ok: boolean;
  readonly operation: string;
  readonly result?: Readonly<Record<string, unknown>>;
  readonly error?: CliJsonError;
  readonly warnings: readonly string[];
  readonly diagnostics: readonly CliJsonDiagnostic[];
  readonly version: CliJsonVersion;
}

type CliCommand = "init" | "doctor" | "update" | "uninstall";
type CliMutationCommand = "update" | "uninstall";
type CliMutationMode = "dry-run" | "apply";

interface ParsedCliArguments {
  readonly ok: true;
  readonly command: CliCommand;
  readonly cwd: string;
  readonly json: boolean;
  readonly mode?: CliMutationMode;
}

interface InvalidCliArguments {
  readonly ok: false;
  readonly message: string;
}

type CliArgumentResult = ParsedCliArguments | InvalidCliArguments;
type ManagedProjectOperationResult =
  | DiagnoseDurableTasksResult
  | DiagnoseManagedProjectResult
  | InitializeManagedProjectResult
  | PlanManagedProjectUpdateResult
  | PlanManagedProjectUninstallResult
  | ApplyManagedProjectPlanResult;

export async function runCli(args: readonly string[]): Promise<CliRunResult> {
  const parsed = parseArguments(args);
  if (!parsed.ok) {
    return cliFailure(
      "cli.arguments",
      2,
      parsed.message,
      "Run sayhi init, doctor, update --dry-run|--apply, or uninstall --dry-run|--apply.",
      args.includes("--json"),
    );
  }

  let repositoryRoot: string | null;
  try {
    repositoryRoot = await findGitRepositoryRoot(parsed.cwd);
  } catch {
    return cliFailure(
      `project.${parsed.command}`,
      8,
      "The target path could not be inspected.",
      "Check that --cwd exists and is readable, then retry.",
      parsed.json,
    );
  }
  if (repositoryRoot === null) {
    return cliFailure(
      `project.${parsed.command}`,
      4,
      "No Git repository contains the target path.",
      "Run the command inside a Git repository or pass --cwd to one.",
      parsed.json,
    );
  }
  if (resolve(repositoryRoot) === resolve(homedir())) {
    return cliFailure(
      `project.${parsed.command}`,
      4,
      "The user's home directory is an unsafe Managed Project target.",
      "Choose a dedicated Git repository instead of the home directory.",
      parsed.json,
    );
  }

  const fileSystem = new NodeManagedProjectFileSystem(repositoryRoot);
  const timestamp = new Date().toISOString();
  let result: ManagedProjectOperationResult;
  switch (parsed.command) {
    case "init":
      result = await coreContract.initializeManagedProject({
        fileSystem,
        projectId: randomUUID(),
        timestamp,
        installation: CLI_MANAGED_PROJECT_INSTALLATION,
      });
      break;
    case "doctor": {
      const projectDiagnosis = await coreContract.diagnoseManagedProject({
        fileSystem,
        installation: CLI_MANAGED_PROJECT_INSTALLATION,
      });
      result = projectDiagnosis.ok
        ? await coreContract.diagnoseDurableTasks({ fileSystem })
        : projectDiagnosis;
      break;
    }
    case "update":
    case "uninstall":
      result = await executeCliMutation(
        fileSystem,
        parsed.command,
        parsed.mode ?? "dry-run",
        timestamp,
      );
      break;
  }
  return renderManagedProjectResult(parsed.command, result, parsed.json);
}

async function executeCliMutation(
  fileSystem: NodeManagedProjectFileSystem,
  command: CliMutationCommand,
  mode: CliMutationMode,
  timestamp: string,
): Promise<ManagedProjectOperationResult> {
  const recovery = await recoverPendingOperation(fileSystem, mode);
  if (recovery !== null) {
    return recovery;
  }
  const planned =
    command === "update"
      ? await planManagedProjectUpdate({
          fileSystem,
          installation: CLI_MANAGED_PROJECT_INSTALLATION,
          files: CLI_MANAGED_PROJECT_UPDATE_FILES,
        })
      : await planManagedProjectUninstall({
          fileSystem,
          files: CLI_MANAGED_PROJECT_INSTALLED_FILES,
        });
  return mode === "apply" && planned.ok
    ? applyManagedProjectPlan({ fileSystem, plan: planned.plan, timestamp })
    : planned;
}

async function recoverPendingOperation(
  fileSystem: NodeManagedProjectFileSystem,
  mode: CliMutationMode,
): Promise<ApplyManagedProjectPlanResult | null> {
  if (mode !== "apply") {
    return null;
  }
  const journal = await fileSystem.inspect(MANAGED_PROJECT_OPERATION_JOURNAL_PATH);
  return journal.kind === "missing"
    ? null
    : recoverManagedProjectOperation({ fileSystem });
}

function parseArguments(args: readonly string[]): CliArgumentResult {
  let command: CliCommand | undefined;
  let cwd = process.cwd();
  let json = false;
  let modeFlag: "--check" | "--dry-run" | "--apply" | undefined;

  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    if (argument === "--json") {
      json = true;
      continue;
    }
    if (
      argument === "--no-color" ||
      argument === "--non-interactive" ||
      argument === "--verbose"
    ) {
      continue;
    }
    if (
      argument === "--check" ||
      argument === "--dry-run" ||
      argument === "--apply"
    ) {
      if (modeFlag !== undefined) {
        return { ok: false, message: "Specify exactly one lifecycle mode." };
      }
      modeFlag = argument;
      continue;
    }
    if (argument === "--cwd") {
      const value = args[index + 1];
      if (value === undefined || value.startsWith("--")) {
        return { ok: false, message: "--cwd requires a path." };
      }
      cwd = value;
      index += 1;
      continue;
    }
    if (
      argument === "init" ||
      argument === "doctor" ||
      argument === "update" ||
      argument === "uninstall"
    ) {
      if (command !== undefined) {
        return { ok: false, message: "Specify exactly one command." };
      }
      command = argument;
      continue;
    }
    return { ok: false, message: `Unknown argument: ${String(argument)}` };
  }

  if (command === undefined) {
    return { ok: false, message: "A command is required." };
  }
  if (command === "init" || command === "doctor") {
    return modeFlag === undefined
      ? { ok: true, command, cwd, json }
      : { ok: false, message: `${command} does not accept a lifecycle mode.` };
  }
  if (modeFlag === undefined) {
    return { ok: false, message: `${command} requires --dry-run or --apply.` };
  }
  if (command === "uninstall" && modeFlag === "--check") {
    return { ok: false, message: "uninstall does not accept --check." };
  }
  return {
    ok: true,
    command,
    cwd,
    json,
    mode: modeFlag === "--apply" ? "apply" : "dry-run",
  };
}

function renderManagedProjectResult(
  command: CliCommand,
  result: ManagedProjectOperationResult,
  json: boolean,
): CliRunResult {
  const operation = `project.${command}`;
  const exitCode = managedProjectExitCode(result);
  const resultRecord: Record<string, unknown> = { state: result.state };
  if ("created" in result) {
    resultRecord.created = result.created;
    if (result.ok) {
      resultRecord.paths = result.paths;
    }
  }
  if ("plan" in result && result.ok) {
    resultRecord.hasConflicts = result.plan.hasConflicts;
    resultRecord.actions = summarizeActions(result.plan.actions);
  }
  if ("results" in result) {
    resultRecord.actions = summarizeActions(result.results);
  }
  if ("taskCount" in result) {
    resultRecord.taskCount = result.taskCount;
  }

  const envelope: CliJsonEnvelope = {
    ok: result.ok,
    operation,
    result: Object.freeze(resultRecord),
    ...(result.ok
      ? {}
      : { error: diagnosticError(result.diagnostics[0]) }),
    warnings: Object.freeze([]),
    diagnostics: result.diagnostics,
    version: cliJsonVersion(),
  };
  if (json) {
    return {
      exitCode,
      stdout: `${JSON.stringify(envelope)}\n`,
      stderr: "",
    };
  }
  if (result.ok) {
    let message: string;
    if (command === "doctor") {
      message = "SayHi Project Store is healthy.\n";
    } else if (command === "init") {
      message =
        "created" in result && result.created
          ? "Initialized SayHi Project Store.\n"
          : "SayHi Project Store is already initialized.\n";
    } else {
      message =
        result.state === "planned"
          ? `Planned SayHi project ${command}.\n`
          : `Applied SayHi project ${command}.\n`;
    }
    return { exitCode, stdout: message, stderr: "" };
  }

  const first = result.diagnostics[0];
  return {
    exitCode,
    stdout: "",
    stderr:
      first === undefined
        ? "Managed Project operation failed.\n"
        : `${first.message}\nRemediation: ${first.remediation}\n`,
  };
}

function summarizeActions(
  actions: readonly Readonly<{
    path: string;
    result: string;
    observedKind?: string;
    variants?: Readonly<{ local: string; base: string; incoming?: string }>;
  }>[],
): readonly Readonly<Record<string, unknown>>[] {
  return Object.freeze(
    actions.map((action) =>
      Object.freeze({
        path: action.path,
        result: action.result,
        ...(action.observedKind === undefined
          ? {}
          : { observedKind: action.observedKind }),
        ...(action.variants === undefined
          ? {}
          : { variants: action.variants }),
      }),
    ),
  );
}

function managedProjectExitCode(result: ManagedProjectOperationResult): number {
  if (result.ok) {
    return 0;
  }
  if (
    result.diagnostics.some(
      ({ code }) =>
        code === "managed_project.io_failed" || code === "task_lifecycle.io_failed",
    )
  ) {
    return 8;
  }
  switch (result.state) {
    case "conflict":
      return 4;
    case "missing":
      return 6;
    case "incompatible":
      return 7;
    case "corrupt":
    case "invalid":
      return 3;
  }
}

function cliFailure(
  operation: string,
  exitCode: number,
  message: string,
  remediation: string,
  json: boolean,
): CliRunResult {
  const error = Object.freeze({
    code: exitCode === 2 ? "cli.arguments.invalid" : "repository.unavailable",
    message,
    remediation,
  });
  if (json) {
    const envelope: CliJsonEnvelope = {
      ok: false,
      operation,
      error,
      warnings: Object.freeze([]),
      diagnostics: Object.freeze([error]),
      version: cliJsonVersion(),
    };
    return {
      exitCode,
      stdout: `${JSON.stringify(envelope)}\n`,
      stderr: "",
    };
  }
  return {
    exitCode,
    stdout: "",
    stderr: `${message}\nRemediation: ${remediation}\n`,
  };
}

function diagnosticError(
  diagnostic: CliJsonDiagnostic | undefined,
): CliJsonError {
  return diagnostic === undefined
    ? Object.freeze({
        code: "managed_project.failed",
        message: "Managed Project operation failed.",
        remediation: "Run sayhi doctor for actionable diagnostics.",
      })
    : Object.freeze({
        code: diagnostic.code,
        message: diagnostic.message,
        remediation: diagnostic.remediation,
      });
}

function cliJsonVersion(): CliJsonVersion {
  return Object.freeze({
    cli: CLI_MANAGED_PROJECT_INSTALLATION.cli,
    core: CLI_MANAGED_PROJECT_INSTALLATION.core,
    schema: CLI_MANAGED_PROJECT_INSTALLATION.projectSchema,
  });
}
