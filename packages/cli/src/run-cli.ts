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
  type StartWorkflowTaskRequest,
  type TransitionWorkflowRequest,
  type BaselineRecord,
  type DurableQuickResult,
  type WorkflowState,
  type DependencyGraph,
  type TaskBaselineFileSystem,
} from "@dnslin/sayhi-core";

import {
  findGitRepositoryRoot,
  NodeManagedProjectFileSystem,
} from "./managed-project-filesystem.js";

import {
  NodeQuickAuditStore,
  QuickAuditStoreError,
} from "./quick-audit-store.js";

const EMPTY_SKILL_LOCK_DIGEST = `sha256:${createHash("sha256")
  .update('{"skills":[]}')
  .digest("hex")}` as ContractIdentity;

const LEGACY_RUNTIME_IGNORE_CONTENT = "/.runtime/\n";
const QUICK_RUNTIME_TASKS_DIRECTORY = ".sayhi/.runtime/quicks";
const QUICK_TASKS_DIRECTORY = ".sayhi/tasks";


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

type PlanSubcommand = "approve" | "record" | "reject";
interface ParsedPlanArguments {
  readonly ok: true;
  readonly command: "plan";
  readonly subcommand: PlanSubcommand;
  readonly cwd: string;
  readonly json: boolean;
  readonly taskId: string;
  readonly source: string;
}
type PlanArgumentResult = ParsedPlanArguments | InvalidCliArguments;

interface PlanRecordRequest {
  readonly taskId: string;
  readonly expectedVersion: number;
  readonly content: string;
  readonly event: WorkflowEventMetadata;
}
interface PlanDecisionRequest {
  readonly taskId: string;
  readonly expectedVersion: number;
  readonly planIdentity: string;
  readonly contextManifestIdentity: string;
  readonly event: WorkflowEventMetadata;
}
type TaskSubcommand =
  | "adopt"
  | "advance"
  | "archive"
  | "baseline"
  | "block"
  | "complete"
  | "commit"
  | "commit-plan"
  | "create"
  | "events"
  | "list"
  | "recover"
  | "show"
  | "unblock";
interface ParsedTaskArguments {
  readonly ok: true;
  readonly command: "task";
  readonly subcommand: TaskSubcommand;
  readonly cwd: string;
  readonly json: boolean;
  readonly mode?: "apply";
  readonly taskId?: string;
  readonly source?: string;
  readonly adoptedPaths?: readonly string[];
}
type TaskArgumentResult = ParsedTaskArguments | InvalidCliArguments;
type GraphSubcommand = "revise" | "show";
type GraphMutationMode = "plan" | "apply";
interface ParsedGraphArguments {
  readonly ok: true;
  readonly command: "graph";
  readonly subcommand: GraphSubcommand;
  readonly cwd: string;
  readonly json: boolean;
  readonly initiativeTaskId: string;
  readonly source?: string;
  readonly mode?: GraphMutationMode;
}
interface GraphRevisionRequest {
  readonly taskId: string;
  readonly expectedVersion: number;
  readonly expectedGraphVersion: number;
  readonly graph: DependencyGraph;
  readonly event: WorkflowEventMetadata;
}
type GraphArgumentResult = ParsedGraphArguments | InvalidCliArguments;

type QuickSubcommand = "archive" | "complete" | "show";
interface ParsedQuickArguments {
  readonly ok: true;
  readonly command: "quick";
  readonly subcommand: QuickSubcommand;
  readonly cwd: string;
  readonly json: boolean;
  readonly taskId?: string;
  readonly source?: string;
}
type QuickArgumentResult = ParsedQuickArguments | InvalidCliArguments;

type QuickOutcome = "no-change" | "changed";
const NO_CHANGE_QUICK_OUTCOME: QuickOutcome = "no-change";
const CHANGED_QUICK_OUTCOME: QuickOutcome = "changed";



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
  const plan = parsePlanArguments(args);
  if (plan !== null) {
    return plan.ok
      ? runPlanCli(plan)
      : cliFailure(
          "plan",
          2,
          plan.message,
          "Run sayhi plan record, approve, or reject <task-id> --from <request.json>.",
          args.includes("--json"),
        );
  }
  const task = parseTaskArguments(args);
  if (task !== null) {
    return task.ok
      ? runTaskCli(task)
      : cliFailure(
          "task",
          2,
          task.message,
          "Run sayhi task create --from <request.json> or task show <task-id>.",
          args.includes("--json"),
        );
  }
  const quick = parseQuickArguments(args);
  if (quick !== null) {
    return quick.ok
      ? runQuickCli(quick)
      : cliFailure(
          "quick",
          2,
          quick.message,
          "Run sayhi quick complete --from <request.json>, show <task-id>, or archive <task-id> --from <transition.json>.",
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
        "Run sayhi graph show <initiative-id> or graph revise <initiative-id> --from <request.json> --plan|--apply.",
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

async function runPlanCli(parsed: ParsedPlanArguments): Promise<CliRunResult> {
  const operation = `plan.${parsed.subcommand}`;
  const repositoryRoot = await resolveCliRepositoryRoot(
    parsed.cwd,
    operation,
    parsed.json,
  );
  if (typeof repositoryRoot !== "string") {
    return repositoryRoot;
  }
  const fileSystem = new NodeManagedProjectFileSystem(repositoryRoot);
  const request = await readTaskJsonRequest(
    fileSystem,
    parsed.source,
    operation,
    parsed.json,
  );
  if (!request.ok) {
    return request.result;
  }
  const taskIdFailure = taskRequestIdFailure(
    request.value,
    parsed.taskId,
    operation,
    parsed.json,
  );
  if (taskIdFailure !== undefined) {
    return taskIdFailure;
  }
  if (parsed.subcommand === "record") {
    const record = parsePlanRecordRequest(request.value);
    if (record === null) {
      return taskRequestFailure(
        operation,
        "Plan record request requires expectedVersion, content, and Event metadata.",
        parsed.json,
      );
    }
    const result = await coreContract.recordDurableBuildPlan({
      fileSystem,
      taskId: record.taskId,
      expectedVersion: record.expectedVersion,
      content: record.content,
      event: record.event,
    });
    return result.ok
      ? cliSuccess(
          operation,
          Object.freeze({
            taskId: record.taskId,
            projection: result.state.projection,
            plan: result.plan,
            created: result.created,
            event: result.event,
            appended: result.appended,
          }),
          parsed.json,
        )
      : cliDomainFailure(operation, result.diagnostics[0], parsed.json);
  }
  const decision = parsePlanDecisionRequest(request.value);
  if (decision === null) {
    return taskRequestFailure(
      operation,
      "Plan decision request requires expectedVersion, Plan and Context Manifest identities, and Event metadata.",
      parsed.json,
    );
  }
  const result = await coreContract.decideDurableBuildPlan({
    fileSystem,
    taskId: decision.taskId,
    expectedVersion: decision.expectedVersion,
    decision: parsed.subcommand === "approve" ? "approved" : "rejected",
    planIdentity: decision.planIdentity,
    contextManifestIdentity: decision.contextManifestIdentity,
    event: decision.event,
  });
  return result.ok
    ? cliSuccess(
        operation,
        Object.freeze({
          taskId: decision.taskId,
          decision: result.decision,
          projection: result.state.projection,
          plan: result.plan,
          event: result.event,
          appended: result.appended,
        }),
        parsed.json,
      )
    : cliDomainFailure(operation, result.diagnostics[0], parsed.json);
}


async function runQuickCli(parsed: ParsedQuickArguments): Promise<CliRunResult> {
  const operation = `quick.${parsed.subcommand}`;
  const repositoryRoot = await resolveCliRepositoryRoot(
    parsed.cwd,
    operation,
    parsed.json,
  );
  if (typeof repositoryRoot !== "string") {
    return repositoryRoot;
  }
  const fileSystem = new NodeManagedProjectFileSystem(repositoryRoot);
  switch (parsed.subcommand) {
    case "complete":
      return completeQuick(fileSystem, repositoryRoot, parsed);
    case "show":
      return showQuick(fileSystem, repositoryRoot, parsed);
    case "archive":
      return archiveQuick(fileSystem, repositoryRoot, parsed);
  }
}
type QuickAuditStoreOpen =
  | Readonly<{ ok: true; value: NodeQuickAuditStore }>
  | Readonly<{ ok: false; result: CliRunResult }>;

async function openQuickAuditStore(
  repositoryRoot: string,
  operation: string,
  json: boolean,
): Promise<QuickAuditStoreOpen> {
  try {
    return Object.freeze({
      ok: true as const,
      value: await NodeQuickAuditStore.open(repositoryRoot),
    });
  } catch (error) {
    return Object.freeze({
      ok: false as const,
      result: cliQuickAuditFailure(operation, error, json),
    });
  }
}


async function completeQuick(
  fileSystem: NodeManagedProjectFileSystem,
  repositoryRoot: string,
  parsed: ParsedQuickArguments,
): Promise<CliRunResult> {
  const operation = "quick.complete";
  const request = await readTaskJsonRequest(
    fileSystem,
    parsed.source!,
    operation,
    parsed.json,
  );
  if (!request.ok) {
    return request.result;
  }
  if (
    request.value.writes !== undefined &&
    (!Array.isArray(request.value.writes) || request.value.writes.length > 0)
  ) {
    return completeChangedQuick(fileSystem, request.value, parsed);
  }
  const auditStore = await openQuickAuditStore(repositoryRoot, operation, parsed.json);
  return auditStore.ok
    ? completeNoChangeQuick(fileSystem, auditStore.value, parsed, request.value)
    : auditStore.result;
}

async function completeNoChangeQuick(
  fileSystem: NodeManagedProjectFileSystem,
  auditStore: NodeQuickAuditStore,
  parsed: ParsedQuickArguments,
  request: Readonly<Record<string, unknown>>,
): Promise<CliRunResult> {
  const operation = "quick.complete";
  const completion = parseQuickCompletionRequest(request);
  if (completion === null) {
    return cliDomainFailure(
      operation,
      Object.freeze({
        code: "quick.request.invalid",
        message: "Quick completion requires a start request and transition array.",
        remediation: "Provide a Core StartWorkflowTaskRequest and every accepted Quick transition.",
      }),
      parsed.json,
    );
  }
  const { start: startValue, transitions: transitionsValue } = completion;
  const created = coreContract.startWorkflowTask(startValue);
  if (!created.ok) {
    return cliDomainFailure(operation, created.diagnostics[0], parsed.json);
  }
  if (created.state.projection.route !== "quick") {
    return cliDomainFailure(
      operation,
      Object.freeze({
        code: "quick.route.invalid",
        message: "No-change completion accepts only Quick Tasks.",
        remediation: "Provide a StartWorkflowTaskRequest whose Task Route is quick.",
      }),
      parsed.json,
    );
  }
  let baselineBefore: BaselineRecord;
  try {
    baselineBefore = await captureQuickBaseline(fileSystem, created.state);
  } catch {
    return quickBaselineFailure(operation, parsed.json);
  }
  const completed = replayQuickTransitions(created.state, transitionsValue);
  if (!completed.ok) {
    return cliDomainFailure(operation, completed.diagnostic, parsed.json);
  }
  const state = completed.state;
  if (
    state.projection.lifecycle !== "completed" ||
    state.projection.phase !== "finish"
  ) {
    return cliDomainFailure(
      operation,
      Object.freeze({
        code: "quick.completion.incomplete",
        message: "Quick completion must end at completed/finish.",
        remediation: "Supply every permitted Quick transition through the Finish Gate.",
      }),
      parsed.json,
    );
  }
  let baselineAfter: BaselineRecord;
  try {
    baselineAfter = await captureQuickBaseline(fileSystem, state);
  } catch {
    return quickBaselineFailure(operation, parsed.json);
  }
  if (!sameBaseline(baselineBefore, baselineAfter)) {
    return cliDomainFailure(
      operation,
      Object.freeze({
        code: "quick.no_change.baseline_changed",
        message: "Quick completion changed the repository Baseline.",
        remediation: "Escalate the work to a changing Quick or Build instead of recording no change.",
      }),
      parsed.json,
    );
  }
  try {
    await auditStore.create(
      state.projection.id,
      Object.freeze({
        schemaVersion: 1,
        outcome: NO_CHANGE_QUICK_OUTCOME,
        baselineBefore,
        baselineAfter,
        state,
      }),
    );
  } catch (error) {
    return cliQuickAuditFailure(operation, error, parsed.json);
  }
  const persisted = await recoverQuickAudit(
    auditStore,
    state.projection.id,
    operation,
    parsed.json,
  );
  return persisted.ok
    ? cliSuccess(
        operation,
        Object.freeze({
          taskId: persisted.state.projection.id,
          projection: persisted.state.projection,
          events: persisted.state.events,
          outcome: persisted.outcome,
        }),
        parsed.json,
      )
    : persisted.result;
}
function replayQuickTransitions(
  initialState: WorkflowState,
  transitions: readonly TransitionWorkflowRequest[],
) {
  let state = initialState;
  for (const transition of transitions) {
    const advanced = coreContract.transitionWorkflow(state, transition);
    if (!advanced.ok) {
      return Object.freeze({ ok: false as const, diagnostic: advanced.diagnostics[0] });
    }
    state = advanced.state;
  }
  return Object.freeze({ ok: true as const, state });
}
interface QuickCompletionRequest {
  readonly start: StartWorkflowTaskRequest;
  readonly transitions: readonly TransitionWorkflowRequest[];
}

function parseQuickCompletionRequest(
  request: Readonly<Record<string, unknown>>,
): QuickCompletionRequest | null {
  return isStartWorkflowTaskRequestCandidate(request.start) &&
    Array.isArray(request.transitions) &&
    request.transitions.every(isTransitionWorkflowRequestCandidate)
    ? Object.freeze({ start: request.start, transitions: request.transitions })
    : null;
}
type QuickRuntimeFileSystemOpen =
  | Readonly<{ ok: true; value: TaskBaselineFileSystem }>
  | Readonly<{ ok: false; result: CliRunResult }>;

async function openQuickRuntimeFileSystem(
  fileSystem: NodeManagedProjectFileSystem,
  operation: string,
  json: boolean,
): Promise<QuickRuntimeFileSystemOpen> {
  try {
    const runtimeTasks = await fileSystem.inspect(QUICK_RUNTIME_TASKS_DIRECTORY);
    if (runtimeTasks.kind === "missing") {
      await fileSystem.createDirectory(QUICK_RUNTIME_TASKS_DIRECTORY);
    } else if (runtimeTasks.kind !== "directory") {
      return Object.freeze({
        ok: false as const,
        result: cliDomainFailure(
          operation,
          Object.freeze({
            code: "quick.runtime.invalid",
            message: "Quick runtime task storage is unavailable.",
            remediation: "Restore .sayhi/.runtime/quicks as a directory and retry.",
          }),
          json,
        ),
      });
    }
  } catch {
    return Object.freeze({
      ok: false as const,
      result: cliDomainFailure(
        operation,
        Object.freeze({
          code: "quick.runtime.unavailable",
          message: "Quick runtime task storage could not be prepared.",
          remediation: "Repair the local .sayhi runtime directory and retry.",
        }),
        json,
      ),
    });
  }
  const runtimeFileSystem: TaskBaselineFileSystem = Object.freeze({
    inspect: (path: string) => fileSystem.inspect(runtimeQuickTaskPath(path)),
    listDirectory: (path: string) => fileSystem.listDirectory(runtimeQuickTaskPath(path)),
    readFile: (path: string) => fileSystem.readFile(runtimeQuickTaskPath(path)),
    createDirectory: (path: string) => fileSystem.createDirectory(runtimeQuickTaskPath(path)),
    writeFile: (path: string, content: string) =>
      fileSystem.writeFile(runtimeQuickTaskPath(path), content),
    appendFile: (path: string, content: string) =>
      fileSystem.appendFile(runtimeQuickTaskPath(path), content),
    withTaskMutationLock: fileSystem.withTaskMutationLock.bind(fileSystem),
    captureBaseline: fileSystem.captureBaseline.bind(fileSystem),
    withWriterMutationLock: fileSystem.withWriterMutationLock.bind(fileSystem),
  });
  return Object.freeze({ ok: true as const, value: runtimeFileSystem });
}

function runtimeQuickTaskPath(path: string): string {
  return path === QUICK_TASKS_DIRECTORY
    ? QUICK_RUNTIME_TASKS_DIRECTORY
    : path.startsWith(`${QUICK_TASKS_DIRECTORY}/`)
      ? `${QUICK_RUNTIME_TASKS_DIRECTORY}/${path.slice(QUICK_TASKS_DIRECTORY.length + 1)}`
      : path;
}

async function promoteQuickRuntimeTask(
  fileSystem: NodeManagedProjectFileSystem,
  taskId: string,
): Promise<void> {
  await fileSystem.withTaskMutationLock(`.sayhi/.runtime/task-${taskId}.lock`, () =>
    fileSystem.moveDirectory(
      `${QUICK_RUNTIME_TASKS_DIRECTORY}/${taskId}`,
      `${QUICK_TASKS_DIRECTORY}/${taskId}`,
    ),
  );
}


interface ChangedQuickWork {
  readonly baselineAfter: BaselineRecord;
  readonly changedPaths: readonly string[];
}
type ChangedQuickImplementation =
  | Readonly<{
      ok: true;
      state: WorkflowState;
      work: ChangedQuickWork;
    }>
  | Readonly<{ ok: false; result: CliRunResult }>;
type ChangedQuickExecution =
  | Readonly<{
      ok: true;
      state: WorkflowState;
      result: DurableQuickResult;
    }>
  | Readonly<{ ok: false; result: CliRunResult }>;
async function completeChangedQuick(
  fileSystem: NodeManagedProjectFileSystem,
  request: Readonly<Record<string, unknown>>,
  parsed: ParsedQuickArguments,
): Promise<CliRunResult> {
  const operation = "quick.complete";
  const completion = parseQuickCompletionRequest(request);
  const writesValue = request.writes;
  if (completion === null || !isQuickWriteArray(writesValue)) {
    return cliDomainFailure(
      operation,
      Object.freeze({
        code: "quick.request.invalid",
        message: "Changed Quick completion requires a start request, transitions, and file writes.",
        remediation: "Provide Core Quick transitions and non-empty scoped writes with string paths and content.",
      }),
      parsed.json,
    );
  }
  const { start: startValue, transitions: transitionsValue } = completion;
  const virtualCreated = coreContract.startWorkflowTask(startValue);
  if (!virtualCreated.ok) {
    return cliDomainFailure(operation, virtualCreated.diagnostics[0], parsed.json);
  }
  if (virtualCreated.state.projection.route !== "quick") {
    return cliDomainFailure(
      operation,
      Object.freeze({
        code: "quick.route.invalid",
        message: "Changed completion accepts only Quick Tasks.",
        remediation: "Provide a StartWorkflowTaskRequest whose Task Route is quick.",
      }),
      parsed.json,
    );
  }
  const completed = replayQuickTransitions(virtualCreated.state, transitionsValue);
  if (!completed.ok) {
    return cliDomainFailure(operation, completed.diagnostic, parsed.json);
  }
  const virtualState = completed.state;
  if (
    virtualState.projection.lifecycle !== "completed" ||
    virtualState.projection.phase !== "finish"
  ) {
    return cliDomainFailure(
      operation,
      Object.freeze({
        code: "quick.completion.incomplete",
        message: "Changed Quick completion must end at completed/finish.",
        remediation: "Supply every permitted Quick transition through the Finish Gate.",
      }),
      parsed.json,
    );
  }
  const runtime = await openQuickRuntimeFileSystem(fileSystem, operation, parsed.json);
  if (!runtime.ok) {
    return runtime.result;
  }
  const runtimeFileSystem = runtime.value;
  const created = await coreContract.createDurableTask({
    fileSystem: runtimeFileSystem,
    start: startValue,
  });
  let initialState: WorkflowState;
  if (created.ok) {
    initialState = created.state;
  } else {
    if (created.diagnostics[0]?.code !== "task_lifecycle.task.exists") {
      return cliDomainFailure(operation, created.diagnostics[0], parsed.json);
    }
    const existing = await coreContract.readDurableTask({
      fileSystem: runtimeFileSystem,
      taskId: virtualCreated.state.projection.id,
    });
    if (!existing.ok) {
      return cliDomainFailure(operation, existing.diagnostics[0], parsed.json);
    }
    if (
      existing.state.projection.route !== "quick" ||
      existing.state.events[0]?.eventId !== virtualCreated.state.events[0]?.eventId ||
      existing.state.projection.lifecycle !== "active" ||
      (existing.state.projection.phase !== "triage" &&
        existing.state.projection.phase !== "implement")
    ) {
      return cliDomainFailure(
        operation,
        Object.freeze({
          code: "quick.recovery.invalid",
          message: "The existing Task cannot resume this changed Quick completion.",
          remediation: "Inspect the existing Quick Task and provide its original completion request while it is active.",
        }),
        parsed.json,
      );
    }
    initialState = existing.state;
  }
  const [implementationTransition, ...finishTransitions] = transitionsValue;
  if (implementationTransition === undefined) {
    return cliDomainFailure(
      operation,
      Object.freeze({
        code: "quick.completion.incomplete",
        message: "Changed Quick completion requires an Implement transition.",
        remediation: "Supply every permitted Quick transition through the Finish Gate.",
      }),
      parsed.json,
    );
  }
  const implemented = await enterChangedQuickImplementation(
    runtimeFileSystem,
    initialState,
    implementationTransition,
    writesValue,
    parsed.json,
  );
  if (!implemented.ok) {
    return implemented.result;
  }
  const finished = await finishChangedQuick(
    runtimeFileSystem,
    implemented.state,
    implemented.work,
    finishTransitions,
    parsed.json,
  );
  if (!finished.ok) {
    return finished.result;
  }
  try {
    await promoteQuickRuntimeTask(fileSystem, finished.state.projection.id);
  } catch {
    return cliDomainFailure(
      operation,
      Object.freeze({
        code: "quick.runtime.promote_failed",
        message: "The completed Quick Record could not enter the Project Store.",
        remediation: "Retry the same Quick completion after repairing local runtime storage.",
      }),
      parsed.json,
    );
  }
  return cliSuccess(
    operation,
    Object.freeze({
      taskId: finished.state.projection.id,
      projection: finished.state.projection,
      events: finished.state.events,
      outcome: CHANGED_QUICK_OUTCOME,
      changedPaths: finished.result.changedPaths,
      commit: finished.result.commit,
    }),
    parsed.json,
  );
}

async function enterChangedQuickImplementation(
  fileSystem: TaskBaselineFileSystem,
  state: WorkflowState,
  transition: TransitionWorkflowRequest,
  writes: readonly QuickWrite[],
  json: boolean,
): Promise<ChangedQuickImplementation> {
  const operation = "quick.complete";
  let implementingState: WorkflowState;
  if (
    state.projection.lifecycle === "active" &&
    state.projection.phase === "implement"
  ) {
    implementingState = state;
  } else {
    const implementing = await coreContract.advanceDurableTask({
      fileSystem,
      transition: Object.freeze({ ...transition, expectedVersion: state.projection.version }),
    });
    if (!implementing.ok) {
      return Object.freeze({
        ok: false,
        result: cliDomainFailure(operation, implementing.diagnostics[0], json),
      });
    }
    implementingState = implementing.state;
  }
  let writerState = implementingState;
  if (!writerState.events.some((event) => event.type === "baseline_adopted")) {
    let baseline: BaselineRecord;
    try {
      baseline = await captureQuickBaseline(fileSystem, writerState);
    } catch {
      return Object.freeze({ ok: false, result: quickBaselineFailure(operation, json) });
    }
    const adopted = await coreContract.adoptDurableTaskBaseline({
      fileSystem,
      taskId: writerState.projection.id,
      expectedVersion: writerState.projection.version,
      baseline,
      event: createCliTaskEvent("Adopted the changing Quick Baseline."),
    });
    if (!adopted.ok) {
      return Object.freeze({
        ok: false,
        result: cliDomainFailure(operation, adopted.diagnostics[0], json),
      });
    }
    writerState = adopted.state;
  }
  const written = await coreContract.withDurableTaskWriter({
    fileSystem,
    taskId: writerState.projection.id,
    expectedVersion: writerState.projection.version,
    operation: async (writer) => {
      for (const write of writes) {
        writer.assertWritablePath(write.path);
      }
      for (const write of writes) {
        await writer.writeFile(write.path, write.content);
      }
    },
  });
  if (!written.ok) {
    return Object.freeze({
      ok: false,
      result: cliDomainFailure(operation, written.diagnostics[0], json),
    });
  }
  return Object.freeze({
    ok: true,
    state: writerState,
    work: Object.freeze({
      baselineAfter: written.finalBaseline,
      changedPaths: written.changedPaths,
    }),
  });
}

async function finishChangedQuick(
  fileSystem: TaskBaselineFileSystem,
  initialState: WorkflowState,
  initialWork: ChangedQuickWork,
  transitions: readonly TransitionWorkflowRequest[],
  json: boolean,
): Promise<ChangedQuickExecution> {
  const operation = "quick.complete";
  let state = initialState;
  let result: DurableQuickResult | null = null;
  for (const transition of transitions) {
    if (transition.to.lifecycle === "completed") {
      const completed = await coreContract.completeDurableQuickResult({
        fileSystem,
        taskId: state.projection.id,
        expectedVersion: state.projection.version,
        transition: Object.freeze({
          ...transition,
          expectedVersion: state.projection.version,
        }),
        baselineAfter: initialWork.baselineAfter,
        changedPaths: initialWork.changedPaths,
      });
      if (!completed.ok) {
        return Object.freeze({
          ok: false,
          result: cliDomainFailure(operation, completed.diagnostics[0], json),
        });
      }
      state = completed.state;
      result = completed.result;
      continue;
    }
    const advanced = await coreContract.advanceDurableTask({
      fileSystem,
      transition: Object.freeze({ ...transition, expectedVersion: state.projection.version }),
    });
    if (!advanced.ok) {
      return Object.freeze({
        ok: false,
        result: cliDomainFailure(operation, advanced.diagnostics[0], json),
      });
    }
    state = advanced.state;
  }
  return result === null
    ? Object.freeze({
        ok: false as const,
        result: cliDomainFailure(
          operation,
          Object.freeze({
            code: "quick.completion.incomplete",
            message: "Changed Quick completion requires a completed Finish transition.",
            remediation: "Supply every permitted Quick transition through the Finish Gate.",
          }),
          json,
        ),
      })
    : Object.freeze({ ok: true as const, state, result });
}

async function archiveNoChangeQuick(
  fileSystem: NodeManagedProjectFileSystem,
  auditStore: NodeQuickAuditStore,
  parsed: ParsedQuickArguments,
): Promise<CliRunResult> {
  const operation = "quick.archive";
  const request = await readTaskJsonRequest(
    fileSystem,
    parsed.source!,
    operation,
    parsed.json,
  );
  if (!request.ok) {
    return request.result;
  }
  if (!isTransitionWorkflowRequestCandidate(request.value)) {
    return cliDomainFailure(
      operation,
      Object.freeze({
        code: "quick.request.invalid",
        message: "Quick archive requires a Core transition request.",
        remediation: "Provide a TransitionWorkflowRequest to archive the completed Quick.",
      }),
      parsed.json,
    );
  }
  const transition = request.value;
  const recovered = await recoverQuickAudit(
    auditStore,
    parsed.taskId!,
    operation,
    parsed.json,
  );
  if (!recovered.ok) {
    return recovered.result;
  }
  let moved: boolean;
  try {
    if (recovered.archived) {
      if (recovered.location === "archive") {
        return cliDomainFailure(
          operation,
          Object.freeze({
            code: "quick.archive.completed",
            message: "Quick audit is already archived.",
            remediation: "Inspect the archived Quick with sayhi quick show.",
          }),
          parsed.json,
        );
      }
      await auditStore.finalizeArchive(parsed.taskId!);
      moved = false;
    } else {
      const archived = coreContract.transitionWorkflow(recovered.state, transition);
      if (!archived.ok) {
        return cliDomainFailure(operation, archived.diagnostics[0], parsed.json);
      }
      await auditStore.archive(
        parsed.taskId!,
        Object.freeze({ ...recovered.record, state: archived.state }),
      );
      moved = true;
    }
  } catch (error) {
    return cliQuickAuditFailure(operation, error, parsed.json);
  }
  const persisted = await recoverQuickAudit(
    auditStore,
    parsed.taskId!,
    operation,
    parsed.json,
  );
  return persisted.ok
    ? cliSuccess(
        operation,
        Object.freeze({
          taskId: persisted.state.projection.id,
          projection: persisted.state.projection,
          events: persisted.state.events,
          outcome: persisted.outcome,
          moved,
        }),
        parsed.json,
      )
    : persisted.result;
}
async function showQuick(
  fileSystem: NodeManagedProjectFileSystem,
  repositoryRoot: string,
  parsed: ParsedQuickArguments,
): Promise<CliRunResult> {
  const operation = "quick.show";
  const changed = await readChangedQuick(
    fileSystem,
    parsed.taskId!,
    operation,
    parsed.json,
  );
  if (changed.kind === "failure") {
    return changed.result;
  }
  if (changed.kind === "found") {
    return cliSuccess(
      operation,
      Object.freeze({
        taskId: changed.value.state.projection.id,
        projection: changed.value.state.projection,
        events: changed.value.state.events,
        outcome: CHANGED_QUICK_OUTCOME,
        changedPaths: changed.value.result.changedPaths,
        commit: changed.value.result.commit,
        archived: changed.value.location === "archive",
      }),
      parsed.json,
    );
  }
  const auditStore = await openQuickAuditStore(repositoryRoot, operation, parsed.json);
  if (!auditStore.ok) {
    return auditStore.result;
  }
  const recovered = await recoverQuickAudit(
    auditStore.value,
    parsed.taskId!,
    operation,
    parsed.json,
  );
  return recovered.ok
    ? cliSuccess(
        operation,
        Object.freeze({
          taskId: recovered.state.projection.id,
          projection: recovered.state.projection,
          events: recovered.state.events,
          outcome: recovered.outcome,
          archived: recovered.archived,
        }),
        parsed.json,
      )
    : recovered.result;
}

async function archiveQuick(
  fileSystem: NodeManagedProjectFileSystem,
  repositoryRoot: string,
  parsed: ParsedQuickArguments,
): Promise<CliRunResult> {
  const operation = "quick.archive";
  const changed = await readChangedQuick(
    fileSystem,
    parsed.taskId!,
    operation,
    parsed.json,
  );
  if (changed.kind === "failure") {
    return changed.result;
  }
  if (changed.kind === "found") {
    if (changed.value.location === "archive") {
      return cliDomainFailure(
        operation,
        Object.freeze({
          code: "quick.archive.completed",
          message: "Quick record is already archived.",
          remediation: "Inspect the archived Quick with sayhi quick show.",
        }),
        parsed.json,
      );
    }
    const request = await readTaskJsonRequest(
      fileSystem,
      parsed.source!,
      operation,
      parsed.json,
    );
    if (!request.ok) {
      return request.result;
    }
    if (!isTransitionWorkflowRequestCandidate(request.value)) {
      return cliDomainFailure(
        operation,
        Object.freeze({
          code: "quick.request.invalid",
          message: "Quick archive requires a Core transition request.",
          remediation: "Provide a TransitionWorkflowRequest to archive the completed Quick.",
        }),
        parsed.json,
      );
    }
    const archived = await coreContract.archiveDurableTask({
      fileSystem,
      transition: Object.freeze({
        ...request.value,
        expectedVersion: changed.value.state.projection.version,
      }),
    });
    return archived.ok
      ? cliSuccess(
          operation,
          Object.freeze({
            taskId: archived.state.projection.id,
            projection: archived.state.projection,
            outcome: CHANGED_QUICK_OUTCOME,
            changedPaths: changed.value.result.changedPaths,
            commit: changed.value.result.commit,
            moved: archived.moved,
          }),
          parsed.json,
        )
      : cliDomainFailure(operation, archived.diagnostics[0], parsed.json);
  }
  const auditStore = await openQuickAuditStore(repositoryRoot, operation, parsed.json);
  return auditStore.ok
    ? archiveNoChangeQuick(fileSystem, auditStore.value, parsed)
    : auditStore.result;
}

type RecoveredChangedQuick = Readonly<{
  state: WorkflowState;
  result: DurableQuickResult;
  location: "active" | "archive";
}>;
type ChangedQuickRead =
  | Readonly<{ kind: "found"; value: RecoveredChangedQuick }>
  | Readonly<{ kind: "absent" }>
  | Readonly<{ kind: "failure"; result: CliRunResult }>;

async function readChangedQuick(
  fileSystem: NodeManagedProjectFileSystem,
  taskId: string,
  operation: string,
  json: boolean,
): Promise<ChangedQuickRead> {
  const taskStore = await fileSystem.inspect(".sayhi/tasks");
  if (taskStore.kind === "missing") {
    return Object.freeze({ kind: "absent" as const });
  }
  for (const location of ["active", "archive"] as const) {
    const recovered = await coreContract.readDurableQuickResult({
      fileSystem,
      taskId,
      location,
    });
    if (recovered.ok) {
      return Object.freeze({
        kind: "found" as const,
        value: Object.freeze({
          state: recovered.state,
          result: recovered.result,
          location,
        }),
      });
    }
    const code = recovered.diagnostics[0]?.code;
    if (
      code !== "task_lifecycle.history.missing" &&
      code !== "task_lifecycle.quick_result.missing"
    ) {
      return Object.freeze({
        kind: "failure" as const,
        result: cliDomainFailure(operation, recovered.diagnostics[0], json),
      });
    }
  }
  return Object.freeze({ kind: "absent" as const });
}

type RecoveredQuickAudit =
  | Readonly<{
      ok: true;
      record: Record<string, unknown>;
      state: WorkflowState;
      location: "active" | "archive";
      outcome: QuickOutcome;
      archived: boolean;
    }>
  | Readonly<{ ok: false; result: CliRunResult }>;

async function recoverQuickAudit(
  auditStore: NodeQuickAuditStore,
  taskId: string,
  operation: string,
  json: boolean,
): Promise<RecoveredQuickAudit> {
  let stored;
  try {
    stored = await auditStore.read(taskId);
  } catch (error) {
    return Object.freeze({ ok: false, result: cliQuickAuditFailure(operation, error, json) });
  }
  if (
    !isRecord(stored.value) ||
    stored.value.schemaVersion !== 1 ||
    !("state" in stored.value) ||
    !isRecord(stored.value.state) ||
    !("events" in stored.value.state) ||
    !Array.isArray(stored.value.state.events) ||
    stored.value.outcome !== NO_CHANGE_QUICK_OUTCOME
  ) {
    return Object.freeze({
      ok: false,
      result: cliDomainFailure(
        operation,
        Object.freeze({
          code: "quick.audit.invalid",
          message: "Quick audit record is structurally invalid.",
          remediation: "Restore the complete external Quick audit record before retrying.",
        }),
        json,
      ),
    });
  }
  const replayed = coreContract.replayWorkflowEvents(stored.value.state.events);
  if (!replayed.ok) {
    return Object.freeze({
      ok: false,
      result: cliDomainFailure(operation, replayed.diagnostics[0], json),
    });
  }
  if (replayed.state.projection.id !== taskId) {
    return Object.freeze({
      ok: false,
      result: cliDomainFailure(
        operation,
        Object.freeze({
          code: "quick.audit.task_id_mismatch",
          message: "Quick audit identity does not match the requested Task.",
          remediation: "Use the Quick Task id stored in the audit record.",
        }),
        json,
      ),
    });
  }
  return Object.freeze({
    ok: true,
    record: stored.value,
    state: replayed.state,
    location: stored.location,
    outcome: NO_CHANGE_QUICK_OUTCOME,
    archived:
      stored.location === "archive" || replayed.state.projection.lifecycle === "archived",
  });
}

async function captureQuickBaseline(
  fileSystem: TaskBaselineFileSystem,
  state: WorkflowState,
): Promise<BaselineRecord> {
  return fileSystem.captureBaseline({
    taskId: state.projection.id,
    declaredScope: state.projection.scope,
    adoptedPaths: [],
  });
}

function sameBaseline(left: BaselineRecord, right: BaselineRecord): boolean {
  return (
    left.repositoryRootIdentity === right.repositoryRootIdentity &&
    left.head === right.head &&
    left.indexDigest === right.indexDigest &&
    left.trackedWorktreeDigest === right.trackedWorktreeDigest &&
    left.submodulesDigest === right.submodulesDigest &&
    JSON.stringify(left.untracked) === JSON.stringify(right.untracked) &&
    JSON.stringify(left.dirtyPaths) === JSON.stringify(right.dirtyPaths) &&
    JSON.stringify(left.adoptedPaths) === JSON.stringify(right.adoptedPaths) &&
    JSON.stringify(left.declaredScope) === JSON.stringify(right.declaredScope)
  );
}

function quickBaselineFailure(operation: string, json: boolean): CliRunResult {
  return cliDomainFailure(
    operation,
    Object.freeze({
      code: "quick.baseline.unavailable",
      message: "Quick Baseline could not be captured from the repository.",
      remediation: "Repair the repository state and retry no-change completion.",
    }),
    json,
  );
}

function isStartWorkflowTaskRequestCandidate(
  value: unknown,
): value is StartWorkflowTaskRequest {
  return isRecord(value) && "task" in value && "event" in value;
}

function isTransitionWorkflowRequestCandidate(
  value: unknown,
): value is TransitionWorkflowRequest {
  return (
    isRecord(value) &&
    "taskId" in value &&
    "expectedVersion" in value &&
    "to" in value &&
    "gates" in value &&
    "event" in value
  );
}
interface QuickWrite {
  readonly path: string;
  readonly content: string;
}

function isQuickWriteArray(value: unknown): value is readonly QuickWrite[] {
  return (
    Array.isArray(value) &&
    value.length > 0 &&
    value.every(
      (write) =>
        isRecord(write) &&
        typeof write.path === "string" &&
        typeof write.content === "string",
    )
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

async function runTaskCli(parsed: ParsedTaskArguments): Promise<CliRunResult> {
  const repositoryRoot = await resolveCliRepositoryRoot(
    parsed.cwd,
    `task.${parsed.subcommand}`,
    parsed.json,
  );
  if (typeof repositoryRoot !== "string") {
    return repositoryRoot;
  }
  const fileSystem = new NodeManagedProjectFileSystem(repositoryRoot);
  const projectDiagnosis = await coreContract.diagnoseManagedProject({
    fileSystem,
    installation: CLI_MANAGED_PROJECT_INSTALLATION,
  });
  if (!projectDiagnosis.ok) {
    return cliProjectDiagnosisFailure(
      `task.${parsed.subcommand}`,
      projectDiagnosis,
      parsed.json,
    );
  }
  switch (parsed.subcommand) {
    case "create": {
      const request = await readTaskJsonRequest(
        fileSystem,
        parsed.source!,
        "task.create",
        parsed.json,
      );
      if (!request.ok) {
        return request.result;
      }
      const result = await coreContract.createDurableTask({
        fileSystem,
        start: request.value as unknown as StartWorkflowTaskRequest,
      });
      return result.ok
        ? cliSuccess(
            "task.create",
            Object.freeze({
              taskId: result.state.projection.id,
              projection: result.state.projection,
              event: result.event,
            }),
            parsed.json,
          )
        : cliDomainFailure("task.create", result.diagnostics[0], parsed.json);
    }
    case "advance":
      return runTaskTransition(fileSystem, parsed, "task.advance");
    case "block":
      return runTaskTransition(fileSystem, parsed, "task.block", "blocked");
    case "unblock":
      return runTaskTransition(fileSystem, parsed, "task.unblock", "active");
    case "complete":
      return runTaskTransition(fileSystem, parsed, "task.complete", "completed");
    case "recover": {
      const result = await coreContract.recoverDurableTask({
        fileSystem,
        taskId: parsed.taskId!,
      });
      return result.ok
        ? cliSuccess(
            "task.recover",
            Object.freeze({
              taskId: result.state.projection.id,
              projection: result.state.projection,
              recovered: result.recovered,
              handoff: result.handoff,
            }),
            parsed.json,
          )
        : cliDomainFailure("task.recover", result.diagnostics[0], parsed.json);
    }
    case "archive": {
      const request = await readTaskJsonRequest(
        fileSystem,
        parsed.source!,
        "task.archive",
        parsed.json,
      );
      if (!request.ok) {
        return request.result;
      }
      const taskIdFailure = taskRequestIdFailure(
        request.value,
        parsed.taskId!,
        "task.archive",
        parsed.json,
      );
      if (taskIdFailure !== undefined) {
        return taskIdFailure;
      }
      const result = await coreContract.archiveDurableTask({
        fileSystem,
        transition: request.value as unknown as TransitionWorkflowRequest,
      });
      return result.ok
        ? cliSuccess(
            "task.archive",
            Object.freeze({
              taskId: result.state.projection.id,
              projection: result.state.projection,
              moved: result.moved,
            }),
            parsed.json,
          )
        : cliDomainFailure("task.archive", result.diagnostics[0], parsed.json);
    }
    case "commit-plan": {
      const result = await coreContract.planDurableTaskCommit({
        fileSystem,
        git: fileSystem,
        taskId: parsed.taskId!,
      });
      if (!result.ok) {
        return cliDomainFailure("task.commit-plan", result.diagnostics[0], parsed.json);
      }
      const { baseline: _baseline, ...plan } = result.plan;
      return cliSuccess("task.commit-plan", Object.freeze(plan), parsed.json);
    }
    case "commit": {
      const result = await coreContract.finishDurableTaskCommit({
        fileSystem,
        git: fileSystem,
        taskId: parsed.taskId!,
        event: createCliTaskEvent("Finish accepted Build with constrained Task commit."),
      });
      return result.ok
        ? cliSuccess(
            "task.commit",
            Object.freeze({
              taskId: result.state.projection.id,
              commit: result.commit.commit,
              projection: result.state.projection,
              archived: result.archived,
            }),
            parsed.json,
          )
        : cliDomainFailure("task.commit", result.diagnostics[0], parsed.json);
    }
    case "baseline": {
      const captured = await captureTaskBaseline(
        fileSystem,
        parsed.taskId!,
        [],
        "task.baseline",
        parsed.json,
      );
      return captured.ok
        ? cliSuccess(
            "task.baseline",
            Object.freeze({ taskId: parsed.taskId, baseline: captured.baseline }),
            parsed.json,
          )
        : captured.result;
    }
    case "adopt": {
      const captured = await captureTaskBaseline(
        fileSystem,
        parsed.taskId!,
        parsed.adoptedPaths!,
        "task.adopt",
        parsed.json,
      );
      if (!captured.ok) {
        return captured.result;
      }
      const result = await coreContract.adoptDurableTaskBaseline({
        fileSystem,
        taskId: parsed.taskId!,
        expectedVersion: captured.state.projection.version,
        baseline: captured.baseline,
        event: createCliTaskEvent("Adopted dirty Baseline through the CLI."),
      });
      return result.ok
        ? cliSuccess(
            "task.adopt",
            Object.freeze({
              taskId: result.state.projection.id,
              projection: result.state.projection,
              event: result.event,
              appended: result.appended,
            }),
            parsed.json,
          )
        : cliDomainFailure("task.adopt", result.diagnostics[0], parsed.json);
    }
    case "list": {
      const result = await coreContract.listDurableTasks({ fileSystem });
      return result.ok
        ? cliSuccess("task.list", Object.freeze({ taskIds: result.taskIds }), parsed.json)
        : cliDomainFailure("task.list", result.diagnostics[0], parsed.json);
    }
    case "events": {
      const result = await coreContract.readDurableTask({
        fileSystem,
        taskId: parsed.taskId!,
      });
      return result.ok
        ? cliSuccess(
            "task.events",
            Object.freeze({ taskId: result.state.projection.id, events: result.state.events }),
            parsed.json,
          )
        : cliDomainFailure("task.events", result.diagnostics[0], parsed.json);
    }
    case "show": {
      const result = await coreContract.readDurableTask({
        fileSystem,
        taskId: parsed.taskId!,
      });
      return result.ok
        ? cliSuccess(
            "task.show",
            Object.freeze({
              taskId: result.state.projection.id,
              projection: result.state.projection,
              events: result.state.events,
            }),
            parsed.json,
          )
        : cliDomainFailure("task.show", result.diagnostics[0], parsed.json);
    }
  }
}

async function runTaskTransition(
  fileSystem: NodeManagedProjectFileSystem,
  parsed: ParsedTaskArguments,
  operation: "task.advance" | "task.block" | "task.unblock" | "task.complete",
  expectedLifecycle?: "active" | "blocked" | "completed",
): Promise<CliRunResult> {
  const request = await readTaskJsonRequest(
    fileSystem,
    parsed.source!,
    operation,
    parsed.json,
  );
  if (!request.ok) {
    return request.result;
  }
  const taskIdFailure = taskRequestIdFailure(
    request.value,
    parsed.taskId!,
    operation,
    parsed.json,
  );
  if (taskIdFailure !== undefined) {
    return taskIdFailure;
  }
  if (expectedLifecycle !== undefined) {
    const target = request.value.to;
    if (
      typeof target !== "object" ||
      target === null ||
      Array.isArray(target) ||
      (target as Record<string, unknown>).lifecycle !== expectedLifecycle
    ) {
      return cliDomainFailure(
        operation,
        Object.freeze({
          code: "task.transition.target.invalid",
          message: `${operation} requires a transition to ${expectedLifecycle}.`,
          remediation: "Submit a Transition request whose target lifecycle matches the command.",
        }),
        parsed.json,
      );
    }
  }
  const result = await coreContract.advanceDurableTask({
    fileSystem,
    transition: request.value as unknown as TransitionWorkflowRequest,
  });
  return result.ok
    ? cliSuccess(
        operation,
        Object.freeze({
          taskId: result.state.projection.id,
          projection: result.state.projection,
          event: result.event,
          appended: result.appended,
        }),
        parsed.json,
      )
    : cliDomainFailure(operation, result.diagnostics[0], parsed.json);
}

function taskRequestIdFailure(
  request: Readonly<Record<string, unknown>>,
  expectedTaskId: string,
  operation: string,
  json: boolean,
): CliRunResult | undefined {
  const requestTaskId = request.taskId;
  if (typeof requestTaskId === "string" && requestTaskId === expectedTaskId) {
    return undefined;
  }
  return cliDomainFailure(
    operation,
    Object.freeze({
      code: "task.request.task_id_mismatch",
      message: "The Task id in the request does not match the command Task id.",
      remediation: "Use the same Task id in the command and transition request.",
    }),
    json,
  );
}

type CapturedTaskBaselineResult =
  | Readonly<{ ok: true; state: WorkflowState; baseline: BaselineRecord }>
  | Readonly<{ ok: false; result: CliRunResult }>;

async function captureTaskBaseline(
  fileSystem: NodeManagedProjectFileSystem,
  taskId: string,
  adoptedPaths: readonly string[],
  operation: string,
  json: boolean,
): Promise<CapturedTaskBaselineResult> {
  const task = await coreContract.readDurableTask({ fileSystem, taskId });
  if (!task.ok) {
    return Object.freeze({
      ok: false,
      result: cliDomainFailure(operation, task.diagnostics[0], json),
    });
  }
  try {
    const baseline = await fileSystem.captureBaseline({
      taskId,
      declaredScope: task.state.projection.scope,
      adoptedPaths,
    });
    return Object.freeze({ ok: true, state: task.state, baseline });
  } catch {
    return Object.freeze({
      ok: false,
      result: cliDomainFailure(
        operation,
        Object.freeze({
          code: "task.baseline.unavailable",
          message: "Task Baseline could not be captured from the repository.",
          remediation: "Repair the repository state and retry Baseline inspection.",
        }),
        json,
      ),
    });
  }
}

function createCliTaskEvent(reason: string): WorkflowEventMetadata {
  return Object.freeze({
    eventId: randomUUID(),
    actor: Object.freeze({ kind: "user", id: "sayhi-cli", sessionRef: "cli" }),
    reason,
    idempotencyKey: randomUUID(),
    occurredAt: new Date().toISOString(),
  });
}

async function runGraphCli(parsed: ParsedGraphArguments): Promise<CliRunResult> {
  const operation = `graph.${parsed.subcommand}`;
  const repositoryRoot = await resolveCliRepositoryRoot(
    parsed.cwd,
    operation,
    parsed.json,
  );
  if (typeof repositoryRoot !== "string") {
    return repositoryRoot;
  }
  const fileSystem = new NodeManagedProjectFileSystem(repositoryRoot);
  if (parsed.subcommand === "show") {
    const result = await coreContract.inspectDurableInitiativeGraph({
      fileSystem,
      initiativeTaskId: parsed.initiativeTaskId,
    });
    return result.ok
      ? cliSuccess(
          operation,
          Object.freeze({ graph: result.graph, nodes: result.nodes }),
          parsed.json,
        )
      : cliDomainFailure(operation, result.diagnostics[0], parsed.json);
  }
  const request = await readTaskJsonRequest(
    fileSystem,
    parsed.source!,
    operation,
    parsed.json,
  );
  if (!request.ok) {
    return request.result;
  }
  const taskIdFailure = taskRequestIdFailure(
    request.value,
    parsed.initiativeTaskId,
    operation,
    parsed.json,
  );
  if (taskIdFailure !== undefined) {
    return taskIdFailure;
  }
  const revision = parseGraphRevisionRequest(request.value);
  if (revision === null) {
    return taskRequestFailure(
      operation,
      "Initiative graph revision requires Task and graph versions, graph material, and Event metadata.",
      parsed.json,
    );
  }
  if (parsed.mode === "plan") {
    const task = await coreContract.readDurableTask({
      fileSystem,
      taskId: revision.taskId,
    });
    if (!task.ok) {
      return cliDomainFailure(operation, task.diagnostics[0], parsed.json);
    }
    const planned = coreContract.reviseInitiativeGraph(task.state, {
      contractVersion: 1,
      ...revision,
    });
    return planned.ok
      ? cliSuccess(
          operation,
          Object.freeze({
            graph: planned.event.initiativeGraph,
            event: planned.event,
            projection: planned.state.projection,
            planned: true,
          }),
          parsed.json,
        )
      : cliDomainFailure(operation, planned.diagnostics[0], parsed.json);
  }
  const revised = await coreContract.reviseDurableInitiativeGraph({
    fileSystem,
    ...revision,
  });
  return revised.ok
    ? cliSuccess(
        operation,
        Object.freeze({
          graph: revised.event.initiativeGraph,
          event: revised.event,
          projection: revised.state.projection,
          appended: revised.appended,
        }),
        parsed.json,
      )
    : cliDomainFailure(operation, revised.diagnostics[0], parsed.json);
}

type TaskJsonRequestResult =
  | Readonly<{ ok: true; value: Record<string, unknown> }>
  | Readonly<{ ok: false; result: CliRunResult }>;

async function readTaskJsonRequest(
  fileSystem: NodeManagedProjectFileSystem,
  source: string,
  operation: string,
  json: boolean,
): Promise<TaskJsonRequestResult> {
  let sourceText: string;
  try {
    sourceText = await fileSystem.readRepositoryFile(source);
  } catch {
    return Object.freeze({
      ok: false,
      result: cliDomainFailure(
        operation,
        Object.freeze({
          code: "task_lifecycle.io_failed",
          message: "Task request could not be read from the repository.",
          remediation: "Restore the request file and retry.",
        }),
        json,
      ),
    });
  }
  try {
    const value: unknown = JSON.parse(sourceText);
    return typeof value === "object" && value !== null && !Array.isArray(value)
      ? Object.freeze({ ok: true, value: value as Record<string, unknown> })
      : Object.freeze({
          ok: false,
          result: taskRequestFailure(operation, "Task request must be a JSON object.", json),
        });
  } catch {
    return Object.freeze({
      ok: false,
      result: taskRequestFailure(
        operation,
        "Task request could not be read as JSON from the repository.",
        json,
      ),
    });
  }
}

function taskRequestFailure(
  operation: string,
  message: string,
  json: boolean,
): CliRunResult {
  return cliDomainFailure(
    operation,
    Object.freeze({
      code: "task.request.invalid",
      message,
      remediation: "Provide a regular JSON request file inside the repository.",
    }),
    json,
  );
}

function parsePlanRecordRequest(value: Record<string, unknown>): PlanRecordRequest | null {
  return (
    typeof value.taskId === "string" &&
    typeof value.expectedVersion === "number" &&
    Number.isSafeInteger(value.expectedVersion) &&
    typeof value.content === "string" &&
    isWorkflowEventMetadata(value.event)
  )
    ? Object.freeze({
        taskId: value.taskId,
        expectedVersion: value.expectedVersion,
        content: value.content,
        event: value.event,
      })
    : null;
}

function parsePlanDecisionRequest(
  value: Record<string, unknown>,
): PlanDecisionRequest | null {
  return (
    typeof value.taskId === "string" &&
    typeof value.expectedVersion === "number" &&
    Number.isSafeInteger(value.expectedVersion) &&
    typeof value.planIdentity === "string" &&
    typeof value.contextManifestIdentity === "string" &&
    isWorkflowEventMetadata(value.event)
  )
    ? Object.freeze({
        taskId: value.taskId,
        expectedVersion: value.expectedVersion,
        planIdentity: value.planIdentity,
        contextManifestIdentity: value.contextManifestIdentity,
        event: value.event,
      })
    : null;
}
function parseGraphRevisionRequest(
  value: Record<string, unknown>,
): GraphRevisionRequest | null {
  return (
    typeof value.taskId === "string" &&
    typeof value.expectedVersion === "number" &&
    Number.isSafeInteger(value.expectedVersion) &&
    typeof value.expectedGraphVersion === "number" &&
    Number.isSafeInteger(value.expectedGraphVersion) &&
    isRecord(value.graph) &&
    isWorkflowEventMetadata(value.event)
  )
    ? Object.freeze({
        taskId: value.taskId,
        expectedVersion: value.expectedVersion,
        expectedGraphVersion: value.expectedGraphVersion,
        graph: value.graph as unknown as DependencyGraph,
        event: value.event,
      })
    : null;
}

function isWorkflowEventMetadata(value: unknown): value is WorkflowEventMetadata {
  return (
    isRecord(value) &&
    typeof value.eventId === "string" &&
    typeof value.reason === "string" &&
    typeof value.idempotencyKey === "string" &&
    typeof value.occurredAt === "string" &&
    isRecord(value.actor) &&
    (value.actor.kind === "agent" ||
      value.actor.kind === "orchestrator" ||
      value.actor.kind === "system" ||
      value.actor.kind === "user") &&
    typeof value.actor.id === "string" &&
    typeof value.actor.sessionRef === "string"
  );
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

function parseQuickArguments(args: readonly string[]): QuickArgumentResult | null {
  if (leadingCliCommand(args) !== "quick") {
    return null;
  }
  let cwd = process.cwd();
  let json = false;
  let source: string | undefined;
  let quickCount = 0;
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
    if (argument === "quick") {
      quickCount += 1;
      continue;
    }
    if (argument.startsWith("--")) {
      return { ok: false, message: `Unknown argument: ${argument}` };
    }
    values.push(argument);
  }
  if (quickCount !== 1) {
    return { ok: false, message: "Specify exactly one quick command." };
  }
  const [subcommand, taskId, ...tail] = values;
  if (subcommand !== "archive" && subcommand !== "complete" && subcommand !== "show") {
    return { ok: false, message: "Quick command is not supported." };
  }
  if (subcommand === "complete") {
    return taskId === undefined && tail.length === 0 && source !== undefined
      ? { ok: true, command: "quick", subcommand, cwd, json, source }
      : { ok: false, message: "quick complete requires only --from <request.json>." };
  }
  if (taskId === undefined || tail.length > 0) {
    return { ok: false, message: `quick ${subcommand} requires one Task id.` };
  }
  if (subcommand === "show") {
    return source === undefined
      ? { ok: true, command: "quick", subcommand, cwd, json, taskId }
      : { ok: false, message: "quick show is read-only." };
  }
  return source !== undefined
    ? { ok: true, command: "quick", subcommand, cwd, json, taskId, source }
    : { ok: false, message: "quick archive requires --from <transition.json>." };
}

function parseTaskArguments(args: readonly string[]): TaskArgumentResult | null {
  if (leadingCliCommand(args) !== "task") {
    return null;
  }
  let cwd = process.cwd();
  let json = false;
  let mode: "apply" | undefined;
  let source: string | undefined;
  let taskCount = 0;
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
    if (argument === "--apply") {
      if (mode !== undefined) {
        return { ok: false, message: "Specify --apply at most once." };
      }
      mode = "apply";
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
    if (argument === "task") {
      taskCount += 1;
      continue;
    }
    if (argument.startsWith("--")) {
      return { ok: false, message: `Unknown argument: ${argument}` };
    }
    values.push(argument);
  }
  if (taskCount !== 1) {
    return { ok: false, message: "Specify exactly one task command." };
  }
  const [subcommand, taskId, ...tail] = values;
  if (
    subcommand !== "adopt" &&
    subcommand !== "advance" &&
    subcommand !== "archive" &&
    subcommand !== "baseline" &&
    subcommand !== "block" &&
    subcommand !== "complete" &&
    subcommand !== "commit" &&
    subcommand !== "commit-plan" &&
    subcommand !== "create" &&
    subcommand !== "events" &&
    subcommand !== "list" &&
    subcommand !== "recover" &&
    subcommand !== "show" &&
    subcommand !== "unblock"
  ) {
    return { ok: false, message: "Task command is not supported." };
  }
  if (subcommand === "create") {
    if (taskId !== undefined || tail.length > 0 || source === undefined || mode !== undefined) {
      return { ok: false, message: "task create requires only --from <request.json>." };
    }
    return { ok: true, command: "task", subcommand, cwd, json, source };
  }
  if (subcommand === "list") {
    return taskId === undefined && source === undefined && mode === undefined
      ? { ok: true, command: "task", subcommand, cwd, json }
      : { ok: false, message: "task list is read-only." };
  }
  if (taskId === undefined) {
    return { ok: false, message: `task ${subcommand} requires one Task id.` };
  }
  if (subcommand === "adopt") {
    return source === undefined && mode === undefined && tail.length > 0
      ? {
          ok: true,
          command: "task",
          subcommand,
          cwd,
          json,
          taskId,
          adoptedPaths: Object.freeze([...tail]),
        }
      : { ok: false, message: "task adopt requires one or more repository paths." };
  }
  if (subcommand === "show" || subcommand === "events" || subcommand === "baseline" || subcommand === "commit-plan") {
    return source === undefined && mode === undefined && tail.length === 0
      ? { ok: true, command: "task", subcommand, cwd, json, taskId }
      : { ok: false, message: `task ${subcommand} is read-only.` };
  }
  if (subcommand === "commit") {
    return source === undefined && mode === undefined && tail.length === 0
      ? { ok: true, command: "task", subcommand, cwd, json, taskId }
      : { ok: false, message: "task commit does not accept a request source." };
  }
  if (subcommand === "recover") {
    return source === undefined && mode === "apply" && tail.length === 0
      ? { ok: true, command: "task", subcommand, cwd, json, taskId, mode }
      : { ok: false, message: "task recover requires --apply and no request source." };
  }
  return source !== undefined && mode === undefined && tail.length === 0
    ? { ok: true, command: "task", subcommand, cwd, json, taskId, source }
    : { ok: false, message: `task ${subcommand} requires --from <request.json>.` };
}

function parseGraphArguments(args: readonly string[]): GraphArgumentResult | null {
  if (leadingCliCommand(args) !== "graph") {
    return null;
  }
  let cwd = process.cwd();
  let json = false;
  let source: string | undefined;
  let mode: GraphMutationMode | undefined;
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
    if (argument === "--plan" || argument === "--apply") {
      if (mode !== undefined) {
        return { ok: false, message: "Specify --plan or --apply exactly once." };
      }
      mode = argument === "--plan" ? "plan" : "apply";
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
  const [subcommand, initiativeTaskId, ...tail] = values;
  if (subcommand === "show") {
    return initiativeTaskId !== undefined &&
      tail.length === 0 &&
      source === undefined &&
      mode === undefined
      ? { ok: true, command: "graph", subcommand, cwd, json, initiativeTaskId }
      : { ok: false, message: "graph show requires exactly one Initiative id." };
  }
  if (subcommand === "revise") {
    return initiativeTaskId !== undefined &&
      tail.length === 0 &&
      source !== undefined &&
      mode !== undefined
      ? {
          ok: true,
          command: "graph",
          subcommand,
          cwd,
          json,
          initiativeTaskId,
          source,
          mode,
        }
      : {
          ok: false,
          message:
            "graph revise requires one Initiative id, --from <request.json>, and --plan or --apply.",
        };
  }
  return { ok: false, message: "Graph command is not supported." };
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

function parsePlanArguments(args: readonly string[]): PlanArgumentResult | null {
  if (leadingCliCommand(args) !== "plan") {
    return null;
  }
  let cwd = process.cwd();
  let json = false;
  let source: string | undefined;
  let planCount = 0;
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
    if (argument === "plan") {
      planCount += 1;
      continue;
    }
    if (argument.startsWith("--")) {
      return { ok: false, message: `Unknown argument: ${argument}` };
    }
    values.push(argument);
  }
  if (planCount !== 1) {
    return { ok: false, message: "Specify exactly one plan command." };
  }
  const [subcommand, taskId, extra] = values;
  if (subcommand !== "record" && subcommand !== "approve" && subcommand !== "reject") {
    return { ok: false, message: "Plan command is not supported." };
  }
  if (taskId === undefined || extra !== undefined || source === undefined) {
    return {
      ok: false,
      message: `plan ${subcommand} requires <task-id> and --from <request.json>.`,
    };
  }
  return { ok: true, command: "plan", subcommand, cwd, json, taskId, source };
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

function cliProjectDiagnosisFailure(
  operation: string,
  result: DiagnoseManagedProjectResult,
  json: boolean,
): CliRunResult {
  return cliDiagnosticFailure(
    operation,
    managedProjectExitCode(result),
    result.diagnostics[0],
    json,
  );
}

function cliQuickAuditFailure(
  operation: string,
  error: unknown,
  json: boolean,
): CliRunResult {
  if (!(error instanceof QuickAuditStoreError)) {
    return cliDiagnosticFailure(
      operation,
      8,
      Object.freeze({
        code: "quick.audit.io_failed",
        message: "Quick audit runtime storage failed unexpectedly.",
        remediation: "Inspect the external Quick audit runtime directory and retry.",
      }),
      json,
    );
  }
  const exitCode =
    error.code === "io_failed" ? 8 : error.code === "exists" || error.code === "unsafe_root" ? 4 : 3;
  return cliDiagnosticFailure(
    operation,
    exitCode,
    Object.freeze({
      code: `quick.audit.${error.code}`,
      message: error.message,
      remediation:
        error.code === "unsafe_root"
          ? "Set SAYHI_QUICK_AUDIT_DIR to a directory outside the repository."
          : "Inspect the external Quick audit runtime directory and retry.",
    }),
    json,
  );
}

function cliDomainFailure(
  operation: string,
  diagnostic: CliJsonDiagnostic | undefined,
  json: boolean,
): CliRunResult {
  const exitCode =
    diagnostic?.code === "task_lifecycle.io_failed"
      ? 8
      : diagnostic?.code === "workflow.gate.unmet" ||
          diagnostic?.code === "workflow.gate.evidence_invalid"
        ? 5
        : 3;
  return cliDiagnosticFailure(operation, exitCode, diagnostic, json);
}

function cliDiagnosticFailure(
  operation: string,
  exitCode: number,
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
    ? { exitCode, stdout: `${JSON.stringify(envelope)}\n`, stderr: "" }
    : {
        exitCode,
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

