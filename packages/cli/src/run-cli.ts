import { createHash, randomUUID } from "node:crypto";
import { homedir } from "node:os";
import { resolve } from "node:path";

import {
  coreContract,
  type ContractIdentity,
  type DiagnoseManagedProjectResult,
  type InitializeManagedProjectResult,
  type InstalledProjectVersions,
  type ManagedProjectDiagnostic,
} from "@dnslin/sayhi-core";

import {
  findGitRepositoryRoot,
  NodeManagedProjectFileSystem,
} from "./managed-project-filesystem.js";

const EMPTY_SKILL_LOCK_DIGEST = `sha256:${createHash("sha256")
  .update('{"skills":[]}')
  .digest("hex")}` as ContractIdentity;

export const CLI_MANAGED_PROJECT_INSTALLATION: InstalledProjectVersions =
  Object.freeze({
    core: "0.0.0",
    cli: "0.0.0",
    ompPlugin: "0.0.0",
    projectSchema: 1,
    templates: "0.0.0",
    skillLockDigest: EMPTY_SKILL_LOCK_DIGEST,
  });

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

type CliCommand = "init" | "doctor";

interface ParsedCliArguments {
  readonly ok: true;
  readonly command: CliCommand;
  readonly cwd: string;
  readonly json: boolean;
}

interface InvalidCliArguments {
  readonly ok: false;
  readonly message: string;
}

type CliArgumentResult = ParsedCliArguments | InvalidCliArguments;
type ManagedProjectOperationResult =
  | DiagnoseManagedProjectResult
  | InitializeManagedProjectResult;

export async function runCli(args: readonly string[]): Promise<CliRunResult> {
  const parsed = parseArguments(args);
  if (!parsed.ok) {
    return cliFailure(
      "cli.arguments",
      2,
      parsed.message,
      "Run sayhi init or sayhi doctor with an optional --cwd path.",
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
  const result =
    parsed.command === "init"
      ? await coreContract.initializeManagedProject({
          fileSystem,
          projectId: randomUUID(),
          timestamp: new Date().toISOString(),
          installation: CLI_MANAGED_PROJECT_INSTALLATION,
        })
      : await coreContract.diagnoseManagedProject({
          fileSystem,
          installation: CLI_MANAGED_PROJECT_INSTALLATION,
        });

  return renderManagedProjectResult(parsed.command, result, parsed.json);
}

function parseArguments(args: readonly string[]): CliArgumentResult {
  let command: CliCommand | undefined;
  let cwd = process.cwd();
  let json = false;

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
    if (argument === "--cwd") {
      const value = args[index + 1];
      if (value === undefined || value.startsWith("--")) {
        return { ok: false, message: "--cwd requires a path." };
      }
      cwd = value;
      index += 1;
      continue;
    }
    if (argument === "init" || argument === "doctor") {
      if (command !== undefined) {
        return { ok: false, message: "Specify exactly one command." };
      }
      command = argument;
      continue;
    }
    return { ok: false, message: `Unknown argument: ${String(argument)}` };
  }

  return command === undefined
    ? { ok: false, message: "A command is required." }
    : { ok: true, command, cwd, json };
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
    const message =
      command === "doctor"
        ? "SayHi Project Store is healthy.\n"
        : "created" in result && result.created
          ? "Initialized SayHi Project Store.\n"
          : "SayHi Project Store is already initialized.\n";
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

function managedProjectExitCode(result: ManagedProjectOperationResult): number {
  if (result.ok) {
    return 0;
  }
  if (result.diagnostics.some(({ code }) => code === "managed_project.io_failed")) {
    return 8;
  }
  switch (result.state) {
    case "missing":
      return 6;
    case "incompatible":
      return 7;
    case "corrupt":
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
  diagnostic: ManagedProjectDiagnostic | undefined,
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
