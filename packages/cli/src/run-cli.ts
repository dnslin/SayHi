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
  type WorkflowEventMetadata,
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
type SpecSubcommand = "create" | "impacted" | "list" | "show" | "validate";

interface ParsedSpecArguments {
  readonly ok: true;
  readonly command: "spec";
  readonly subcommand: SpecSubcommand;
  readonly cwd: string;
  readonly json: boolean;
  readonly path?: string;
  readonly source?: string;
  readonly mode?: CliMutationMode;
}

type SpecArgumentResult = ParsedSpecArguments | InvalidCliArguments;
type ContextSubcommand = "add" | "freeze" | "list" | "refresh" | "remove" | "validate";
type ContextPhase =
  | "triage"
  | "explore"
  | "plan"
  | "implement"
  | "review"
  | "integrate"
  | "finish";

interface ParsedContextArguments {
  readonly ok: true;
  readonly command: "context";
  readonly subcommand: ContextSubcommand;
  readonly cwd: string;
  readonly json: boolean;
  readonly taskId: string;
  readonly phase?: ContextPhase;
  readonly source?: string;
  readonly entryId?: string;
  readonly mode?: CliMutationMode;
  readonly acceptRequiredApprovedSpecChanges?: boolean;
}

type ContextArgumentResult = ParsedContextArguments | InvalidCliArguments;
type GraphSubcommand = "show";
interface ParsedGraphArguments {
  readonly ok: true;
  readonly command: "graph";
  readonly subcommand: GraphSubcommand;
  readonly cwd: string;
  readonly json: boolean;
  readonly initiativeTaskId: string;
}
type GraphArgumentResult = ParsedGraphArguments | InvalidCliArguments;



type ManagedProjectOperationResult =
  | DiagnoseDurableTasksResult
  | DiagnoseManagedProjectResult
  | InitializeManagedProjectResult
  | PlanManagedProjectUpdateResult
  | PlanManagedProjectUninstallResult
  | ApplyManagedProjectPlanResult;

export async function runCli(args: readonly string[]): Promise<CliRunResult> {
  const spec = parseSpecArguments(args);
  if (spec !== null) {
    return spec.ok
      ? runSpecCli(spec)
      : cliFailure("spec", 2, spec.message, "Run sayhi spec list, show, validate, or create.", args.includes("--json"));
  }
  const context = parseContextArguments(args);
  if (context !== null) {
    return context.ok
      ? runContextCli(context)
      : cliFailure(
          "context",
          2,
          context.message,
          "Run sayhi context add, list, or validate.",
          args.includes("--json"),
        );
  }
  const graph = parseGraphArguments(args);
  if (graph !== null) {
    return graph.ok
      ? runGraphCli(graph)
      : cliFailure(
          "graph",
          2,
          graph.message,
          "Run sayhi graph show <initiative-id>.",
          args.includes("--json"),
        );
  }


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

  const repositoryRoot = await resolveCliRepositoryRoot(
    parsed.cwd,
    `project.${parsed.command}`,
    parsed.json,
  );
  if (typeof repositoryRoot !== "string") {
    return repositoryRoot;
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
async function runSpecCli(parsed: ParsedSpecArguments): Promise<CliRunResult> {
  const repositoryRoot = await resolveCliRepositoryRoot(
    parsed.cwd,
    `spec.${parsed.subcommand}`,
    parsed.json,
  );
  if (typeof repositoryRoot !== "string") {
    return repositoryRoot;
  }
  const fileSystem = new NodeManagedProjectFileSystem(repositoryRoot);
  switch (parsed.subcommand) {
    case "create": {
      const result = await coreContract.createSpec({
        fileSystem,
        path: parsed.path!,
        source: parsed.source!,
        persist: parsed.mode !== "dry-run",
      });
      return result.ok
        ? cliSuccess(
            "spec.create",
            Object.freeze({
              state: result.planned ? "planned" : "created",
              path: result.path,
              identity: result.identity,
            }),
            parsed.json,
          )
        : cliDomainFailure("spec.create", result.diagnostics[0], parsed.json);
    }
    case "list": {
      const result = await coreContract.listSpecs(fileSystem);
      return result.ok
        ? cliSuccess("spec.list", Object.freeze({ paths: result.paths }), parsed.json)
        : cliDomainFailure("spec.list", result.diagnostics[0], parsed.json);
    }
    case "show": {
      const result = await coreContract.readSpec({
        fileSystem,
        path: parsed.path!,
      });
      return result.ok
        ? cliSuccess(
            "spec.show",
            Object.freeze({
              path: result.path,
              content: result.content,
              identity: result.identity,
            }),
            parsed.json,
          )
        : cliDomainFailure("spec.show", result.diagnostics[0], parsed.json);
    }
    case "impacted": {
      const result = await coreContract.findImpactedSpecContexts({
        fileSystem,
        path: parsed.path!,
      });
      return result.ok
        ? cliSuccess(
            "spec.impacted",
            Object.freeze({ impacts: result.impacts }),
            parsed.json,
          )
        : cliDomainFailure("spec.impacted", result.diagnostics[0], parsed.json);
    }
    case "validate": {
      const result = await coreContract.validateSpecs({
        fileSystem,
        ...(parsed.path === undefined ? {} : { path: parsed.path }),
      });
      return result.ok
        ? cliSuccess(
            "spec.validate",
            Object.freeze({ state: result.state, paths: result.paths }),
            parsed.json,
          )
        : cliDomainFailure("spec.validate", result.diagnostics[0], parsed.json);
    }
  }
}
function createContextEvent(reason: string): WorkflowEventMetadata {
  return Object.freeze({
    eventId: randomUUID(),
    actor: Object.freeze({ kind: "user", id: "sayhi-cli", sessionRef: "cli" }),
    reason,
    idempotencyKey: randomUUID(),
    occurredAt: new Date().toISOString(),
  });
}

async function runContextCli(
  parsed: ParsedContextArguments,
): Promise<CliRunResult> {
  const repositoryRoot = await resolveCliRepositoryRoot(
    parsed.cwd,
    `context.${parsed.subcommand}`,
    parsed.json,
  );
  if (typeof repositoryRoot !== "string") {
    return repositoryRoot;
  }
  const fileSystem = new NodeManagedProjectFileSystem(repositoryRoot);
  const task = await coreContract.readDurableTask({
    fileSystem,
    taskId: parsed.taskId,
  });
  if (!task.ok) {
    return cliDomainFailure(
      `context.${parsed.subcommand}`,
      task.diagnostics[0],
      parsed.json,
    );
  }
  const phase = parsed.phase ?? task.state.projection.phase;
  switch (parsed.subcommand) {
    case "add": {
      const result = await coreContract.addDurableContextManifestEntry({
        fileSystem,
        taskId: parsed.taskId,
        expectedVersion: task.state.projection.version,
        phase,
        source: parsed.source!,
        event: createContextEvent("Added Context Manifest entry through the CLI."),
        persist: parsed.mode !== "dry-run",
      });
      return result.ok
        ? cliSuccess(
            "context.add",
            Object.freeze({
              state: result.planned ? "planned" : "added",
              taskId: parsed.taskId,
              phase,
              entry: result.entry,
              manifestIdentity: result.event.manifestIdentity,
            }),
            parsed.json,
          )
        : cliDomainFailure("context.add", result.diagnostics[0], parsed.json);
    }
    case "refresh": {
      const result = await coreContract.refreshDurableContextManifest({
        fileSystem,
        taskId: parsed.taskId,
        expectedVersion: task.state.projection.version,
        phase,
        acceptRequiredApprovedSpecChanges:
          parsed.acceptRequiredApprovedSpecChanges === true,
        event: createContextEvent("Refreshed Context Manifest through the CLI."),
        persist: parsed.mode !== "dry-run",
      });
      return result.ok
        ? cliSuccess(
            "context.refresh",
            Object.freeze({
              state: result.planned ? "planned" : "refreshed",
              taskId: parsed.taskId,
              phase,
              entries: result.entries,
              manifestIdentity: result.event.manifestIdentity,
            }),
            parsed.json,
          )
        : cliDomainFailure("context.refresh", result.diagnostics[0], parsed.json);
    }
    case "freeze": {
      const result = await coreContract.freezeDurableContextManifest({
        fileSystem,
        taskId: parsed.taskId,
        expectedVersion: task.state.projection.version,
        phase,
        event: createContextEvent("Froze Context Manifest through the CLI."),
        persist: parsed.mode !== "dry-run",
      });
      return result.ok
        ? cliSuccess(
            "context.freeze",
            Object.freeze({
              state: result.planned ? "planned" : "frozen",
              taskId: parsed.taskId,
              phase,
              entries: result.entries,
              manifestIdentity: result.event.manifestIdentity,
            }),
            parsed.json,
          )
        : cliDomainFailure("context.freeze", result.diagnostics[0], parsed.json);
    }
    case "remove": {
      const result = await coreContract.removeDurableContextManifestEntry({
        fileSystem,
        taskId: parsed.taskId,
        expectedVersion: task.state.projection.version,
        phase,
        entryId: parsed.entryId!,
        event: createContextEvent("Removed Context Manifest entry through the CLI."),
        persist: parsed.mode !== "dry-run",
      });
      return result.ok
        ? cliSuccess(
            "context.remove",
            Object.freeze({
              state: result.planned ? "planned" : "removed",
              taskId: parsed.taskId,
              phase,
              entries: result.entries,
              manifestIdentity: result.event.manifestIdentity,
            }),
            parsed.json,
          )
        : cliDomainFailure("context.remove", result.diagnostics[0], parsed.json);
    }
    case "list": {
      const result = await coreContract.inspectDurableContextManifest({
        fileSystem,
        taskId: parsed.taskId,
        phase,
      });
      return result.ok
        ? cliSuccess(
            "context.list",
            Object.freeze({
              taskId: parsed.taskId,
              phase,
              state: result.state,
              entries: result.entries,
              diagnostics: result.diagnostics,
            }),
            parsed.json,
          )
        : cliContextFailure("context.list", result.state, result.diagnostics[0], parsed.json);
    }
    case "validate": {
      const result = await coreContract.inspectDurableContextManifest({
        fileSystem,
        taskId: parsed.taskId,
        phase,
      });
      if (!result.ok) {
        return cliContextFailure(
          "context.validate",
          result.state,
          result.diagnostics[0],
          parsed.json,
        );
      }
      return result.state === "valid"
        ? cliSuccess(
            "context.validate",
            Object.freeze({
              taskId: parsed.taskId,
              phase,
              state: result.state,
            }),
            parsed.json,
          )
        : cliContextFailure(
            "context.validate",
            result.state,
            result.diagnostics[0],
            parsed.json,
          );
    }
  }
}


async function runGraphCli(parsed: ParsedGraphArguments): Promise<CliRunResult> {
  const repositoryRoot = await resolveCliRepositoryRoot(
    parsed.cwd,
    `graph.${parsed.subcommand}`,
    parsed.json,
  );
  if (typeof repositoryRoot !== "string") {
    return repositoryRoot;
  }
  const result = await coreContract.inspectDurableInitiativeGraph({
    fileSystem: new NodeManagedProjectFileSystem(repositoryRoot),
    initiativeTaskId: parsed.initiativeTaskId,
  });
  return result.ok
    ? cliSuccess(
        "graph.show",
        Object.freeze({ graph: result.graph, nodes: result.nodes }),
        parsed.json,
      )
    : cliDomainFailure("graph.show", result.diagnostics[0], parsed.json);
}

async function resolveCliRepositoryRoot(
  cwd: string,
  operation: string,
  json: boolean,
): Promise<string | CliRunResult> {
  let repositoryRoot: string | null;
  try {
    repositoryRoot = await findGitRepositoryRoot(cwd);
  } catch {
    return cliFailure(
      operation,
      8,
      "The target path could not be inspected.",
      "Check that --cwd exists and is readable, then retry.",
      json,
    );
  }
  if (repositoryRoot === null) {
    return cliFailure(
      operation,
      4,
      "No Git repository contains the target path.",
      "Run the command inside a Git repository or pass --cwd to one.",
      json,
    );
  }
  if (resolve(repositoryRoot) === resolve(homedir())) {
    return cliFailure(
      operation,
      4,
      "The user's home directory is an unsafe Managed Project target.",
      "Choose a dedicated Git repository instead of the home directory.",
      json,
    );
  }
  return repositoryRoot;
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

function isGlobalPresentationOption(argument: string): boolean {
  return (
    argument === "--no-color" ||
    argument === "--non-interactive" ||
    argument === "--verbose"
  );
}

function parseGraphArguments(args: readonly string[]): GraphArgumentResult | null {
  if (leadingCliCommand(args) !== "graph") {
    return null;
  }
  let cwd = process.cwd();
  let json = false;
  let graphCount = 0;
  const values: string[] = [];
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index]!;
    if (argument === "--json") {
      json = true;
      continue;
    }
    if (isGlobalPresentationOption(argument)) {
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
    if (argument === "graph") {
      graphCount += 1;
      continue;
    }
    if (argument.startsWith("--")) {
      return { ok: false, message: `Unknown argument: ${argument}` };
    }
    values.push(argument);
  }
  if (graphCount !== 1) {
    return { ok: false, message: "Specify exactly one graph command." };
  }
  const [subcommand, initiativeTaskId, extra] = values;
  if (subcommand !== "show") {
    return { ok: false, message: "Graph command is not supported." };
  }
  if (initiativeTaskId === undefined || extra !== undefined) {
    return { ok: false, message: "graph show requires exactly one Initiative id." };
  }
  return {
    ok: true,
    command: "graph",
    subcommand,
    cwd,
    json,
    initiativeTaskId,
  };
}

function parseArguments(args: readonly string[]): CliArgumentResult {
  let command: CliCommand | undefined;
  let cwd = process.cwd();
  let json = false;
  let modeFlag: "--check" | "--dry-run" | "--apply" | undefined;

  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index]!;
    if (argument === "--json") {
      json = true;
      continue;
    }
    if (isGlobalPresentationOption(argument)) {
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
function leadingCliCommand(args: readonly string[]): string | undefined {
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index]!;
    if (argument === "--cwd" || argument === "--from") {
      index += 1;
      continue;
    }
    if (!argument.startsWith("--")) {
      return argument;
    }
  }
  return undefined;
}

function parseSpecArguments(args: readonly string[]): SpecArgumentResult | null {
  if (leadingCliCommand(args) !== "spec") {
    return null;
  }
  let cwd = process.cwd();
  let json = false;
  let modeFlag: "--dry-run" | "--apply" | undefined;
  let source: string | undefined;
  let specCount = 0;
  const values: string[] = [];
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index]!;
    if (argument === "--json") {
      json = true;
      continue;
    }
    if (isGlobalPresentationOption(argument)) {
      continue;
    }
    if (argument === "--apply" || argument === "--dry-run") {
      if (modeFlag !== undefined) {
        return { ok: false, message: "Specify exactly one lifecycle mode." };
      }
      modeFlag = argument;
      continue;
    }
    if (argument === "--cwd" || argument === "--from") {
      const value = args[index + 1];
      if (value === undefined || value.startsWith("--")) {
        return { ok: false, message: `${argument} requires a path.` };
      }
      if (argument === "--cwd") {
        cwd = value;
      } else if (source !== undefined) {
        return { ok: false, message: "Specify --from exactly once." };
      } else {
        source = value;
      }
      index += 1;
      continue;
    }
    if (argument === "spec") {
      specCount += 1;
      continue;
    }
    if (argument.startsWith("--")) {
      return { ok: false, message: `Unknown argument: ${argument}` };
    }
    values.push(argument);
  }
  if (specCount !== 1) {
    return { ok: false, message: "Specify exactly one spec command." };
  }
  const [subcommand, path, extra] = values;
  if (
    subcommand !== "create" &&
    subcommand !== "impacted" &&
    subcommand !== "list" &&
    subcommand !== "show" &&
    subcommand !== "validate"
  ) {
    return { ok: false, message: "Spec command is not supported." };
  }
  if (subcommand === "create") {
    if (path === undefined || extra !== undefined || source === undefined) {
      return { ok: false, message: "spec create requires <path> and --from <source>." };
    }
    if (modeFlag === undefined) {
      return { ok: false, message: "spec create requires --dry-run or --apply." };
    }
    return {
      ok: true,
      command: "spec",
      subcommand,
      cwd,
      json,
      path,
      source,
      mode: modeFlag === "--apply" ? "apply" : "dry-run",
    };
  }
  if (modeFlag !== undefined || source !== undefined) {
    return { ok: false, message: `spec ${subcommand} is read-only.` };
  }
  if (
    ((subcommand === "show" || subcommand === "impacted") &&
      path === undefined) ||
    extra !== undefined
  ) {
    return { ok: false, message: `spec ${subcommand} requires exactly one path.` };
  }
  return {
    ok: true,
    command: "spec",
    subcommand,
    cwd,
    json,
    ...(path === undefined ? {} : { path }),
  };
}
function parseContextArguments(
  args: readonly string[],
): ContextArgumentResult | null {
  if (leadingCliCommand(args) !== "context") {
    return null;
  }
  let cwd = process.cwd();
  let json = false;
  let modeFlag: "--dry-run" | "--apply" | undefined;
  let contextCount = 0;
  let acceptRequiredApprovedSpecChanges = false;
  const values: string[] = [];
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index]!;
    if (argument === "--json") {
      json = true;
      continue;
    }
    if (isGlobalPresentationOption(argument)) {
      continue;
    }
    if (argument === "--apply" || argument === "--dry-run") {
      if (modeFlag !== undefined) {
        return { ok: false, message: "Specify exactly one lifecycle mode." };
      }
      modeFlag = argument;
      continue;
    }
    if (argument === "--accept-approved-spec-change") {
      acceptRequiredApprovedSpecChanges = true;
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
    if (argument === "context") {
      contextCount += 1;
      continue;
    }
    if (argument.startsWith("--")) {
      return { ok: false, message: `Unknown argument: ${argument}` };
    }
    values.push(argument);
  }
  if (contextCount !== 1) {
    return { ok: false, message: "Specify exactly one context command." };
  }
  const [subcommand, taskId, phase, source, extra] = values;
  if (
    subcommand !== "add" &&
    subcommand !== "freeze" &&
    subcommand !== "list" &&
    subcommand !== "refresh" &&
    subcommand !== "remove" &&
    subcommand !== "validate"
  ) {
    return { ok: false, message: "Context command is not supported." };
  }
  if (
    taskId === undefined ||
    (phase !== undefined && !isContextPhase(phase))
  ) {
    return { ok: false, message: "Context command requires <task-id> and a supported optional <phase>." };
  }
  if (subcommand === "add") {
    if (phase === undefined || source === undefined || extra !== undefined) {
      return { ok: false, message: "context add requires <phase> and <source>." };
    }
    if (modeFlag === undefined) {
      return { ok: false, message: "context add requires --dry-run or --apply." };
    }
    return {
      ok: true,
      command: "context",
      subcommand,
      cwd,
      json,
      taskId,
      phase,
      source,
      mode: modeFlag === "--apply" ? "apply" : "dry-run",
    };
  }
  if (subcommand === "refresh") {
    if (source !== undefined || extra !== undefined) {
      return { ok: false, message: "context refresh does not accept a source." };
    }
    if (modeFlag === undefined) {
      return { ok: false, message: "context refresh requires --dry-run or --apply." };
    }
    return {
      ok: true,
      command: "context",
      subcommand,
      cwd,
      json,
      taskId,
      ...(phase === undefined ? {} : { phase }),
      mode: modeFlag === "--apply" ? "apply" : "dry-run",
      ...(acceptRequiredApprovedSpecChanges
        ? { acceptRequiredApprovedSpecChanges: true }
        : {}),
    };
  }
  if (subcommand === "freeze") {
    if (phase === undefined || source !== undefined || extra !== undefined) {
      return { ok: false, message: "context freeze requires <phase> and no entry or source." };
    }
    if (modeFlag === undefined) {
      return { ok: false, message: "context freeze requires --dry-run or --apply." };
    }
    if (acceptRequiredApprovedSpecChanges) {
      return { ok: false, message: "context freeze does not accept approval flags." };
    }
    return {
      ok: true,
      command: "context",
      subcommand,
      cwd,
      json,
      taskId,
      phase,
      mode: modeFlag === "--apply" ? "apply" : "dry-run",
    };
  }
  if (subcommand === "remove") {
    if (phase === undefined || source === undefined || extra !== undefined) {
      return { ok: false, message: "context remove requires <phase> and <entry-id>." };
    }
    if (modeFlag === undefined) {
      return { ok: false, message: "context remove requires --dry-run or --apply." };
    }
    if (acceptRequiredApprovedSpecChanges) {
      return { ok: false, message: "context remove does not accept approval flags." };
    }
    return {
      ok: true,
      command: "context",
      subcommand,
      cwd,
      json,
      taskId,
      phase,
      entryId: source,
      mode: modeFlag === "--apply" ? "apply" : "dry-run",
    };
  }
  if (
    modeFlag !== undefined ||
    source !== undefined ||
    extra !== undefined ||
    acceptRequiredApprovedSpecChanges
  ) {
    return { ok: false, message: `context ${subcommand} is read-only.` };
  }
  return {
    ok: true,
    command: "context",
    subcommand,
    cwd,
    json,
    taskId,
    ...(phase === undefined ? {} : { phase }),
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

function cliSuccess(
  operation: string,
  result: Readonly<Record<string, unknown>>,
  json: boolean,
): CliRunResult {
  const envelope: CliJsonEnvelope = {
    ok: true,
    operation,
    result,
    warnings: Object.freeze([]),
    diagnostics: Object.freeze([]),
    version: cliJsonVersion(),
  };
  return json
    ? { exitCode: 0, stdout: `${JSON.stringify(envelope)}\n`, stderr: "" }
    : {
        exitCode: 0,
        stdout: `${operation} succeeded.\n${JSON.stringify(result, null, 2)}\n`,
        stderr: "",
      };
}

function cliDomainFailure(
  operation: string,
  diagnostic: CliJsonDiagnostic | undefined,
  json: boolean,
): CliRunResult {
  const error = diagnosticError(diagnostic);
  const envelope: CliJsonEnvelope = {
    ok: false,
    operation,
    error,
    warnings: Object.freeze([]),
    diagnostics: Object.freeze([error]),
    version: cliJsonVersion(),
  };
  return json
    ? { exitCode: 3, stdout: `${JSON.stringify(envelope)}\n`, stderr: "" }
    : {
        exitCode: 3,
        stdout: "",
        stderr: `${error.message}\nRemediation: ${error.remediation}\n`,
      };
}
function isContextPhase(value: unknown): value is ContextPhase {
  return (
    value === "triage" ||
    value === "explore" ||
    value === "plan" ||
    value === "implement" ||
    value === "review" ||
    value === "integrate" ||
    value === "finish"
  );
}

function cliContextFailure(
  operation: string,
  state: "missing" | "invalid" | "stale",
  diagnostic: Readonly<{ message: string; remediation: string }> | undefined,
  json: boolean,
): CliRunResult {
  return cliDomainFailure(
    operation,
    diagnostic === undefined
      ? undefined
      : Object.freeze({
          code: `context_manifest.${state}`,
          message: diagnostic.message,
          remediation: diagnostic.remediation,
        }),
    json,
  );
}

