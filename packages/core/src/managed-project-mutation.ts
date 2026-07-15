import { createHash } from "node:crypto";

import {
  removeManagedBlocks,
  replaceManagedBlocks,
} from "./managed-blocks.js";

import {
  RECORD_CONTRACT_VERSION,
  validateContractRecord,
  type InstalledProjectVersions,
  type ManagedFileOwnershipClass,
  type ManagedFileRecord,
  type ProjectManifestRecord,
} from "./record-contracts.js";
import type {
  ManagedProjectDiagnostic,
  ManagedProjectFileSystem,
  ManagedProjectPathKind,
} from "./managed-project.js";
import { validateDomainValue, type ContentHash } from "./validation.js";

const PROJECT_MANIFEST_PATH = ".sayhi/manifest.json";
const OWNERSHIP_MANIFEST_PATH = ".sayhi/managed-files.json";
export const MANAGED_PROJECT_OPERATION_JOURNAL_PATH =
  ".sayhi/.runtime/managed-operation.json";

export interface ManagedProjectMutationFileSystem
  extends ManagedProjectFileSystem {
  removeFile(path: string): Promise<void>;
  withSharedCheckoutWriterLock<Result>(
    operation: () => Promise<Result>,
  ): Promise<Result>;
}

export interface ManagedProjectUpdateFile {
  readonly path: string;
  readonly ownershipClass: ManagedFileOwnershipClass;
  readonly installedContent: string;
  readonly installedAlternatives?: readonly string[];
  readonly incomingContent: string;
  readonly generatedSourceVersion: string;
  readonly markerIds: readonly string[];
  readonly localOverrideSource?: string;
}

export interface PlanManagedProjectUpdateRequest {
  readonly fileSystem: ManagedProjectFileSystem;
  readonly installation: InstalledProjectVersions;
  readonly files: readonly ManagedProjectUpdateFile[];
}

export interface ManagedProjectInstalledFile {
  readonly path: string;
  readonly installedContent: string;
  readonly installedAlternatives?: readonly string[];
}

export interface PlanManagedProjectUninstallRequest {
  readonly fileSystem: ManagedProjectFileSystem;
  readonly files: readonly ManagedProjectInstalledFile[];
}

export interface ManagedProjectConflictVariants {
  readonly local: string;
  readonly base: string;
  readonly incoming: string;
}

export interface ManagedProjectUninstallConflictVariants {
  readonly local: string;
  readonly base: string;
}

interface ManagedProjectActionBase {
  readonly path: string;
  readonly record: ManagedFileRecord;
}

interface ExistingManagedProjectActionBase extends ManagedProjectActionBase {
  readonly expectedLocalIdentity: ContentHash;
}

type ManagedProjectRetentionAction = Readonly<
  ManagedProjectActionBase & {
    readonly result: "retain";
    readonly observedKind: ManagedProjectPathKind;
  }
>;

export type ManagedProjectUpdateAction =
  | ManagedProjectRetentionAction
  | Readonly<
      ExistingManagedProjectActionBase & {
        readonly result: "update";
        readonly content: string;
      }
    >
  | Readonly<
      ExistingManagedProjectActionBase & {
        readonly result: "conflict";
        readonly variants: ManagedProjectConflictVariants;
        readonly localContent: string;
        readonly baseContent: string;
        readonly incomingContent: string;
      }
    >;

export type ManagedProjectUninstallAction =
  | ManagedProjectRetentionAction
  | Readonly<
      ExistingManagedProjectActionBase & { readonly result: "remove" }
    >
  | Readonly<
      ExistingManagedProjectActionBase & {
        readonly result: "update";
        readonly content: string;
      }
    >
  | Readonly<
      ExistingManagedProjectActionBase & {
        readonly result: "conflict";
        readonly variants: ManagedProjectUninstallConflictVariants;
        readonly localContent: string;
        readonly baseContent: string;
      }
    >;

export interface ManagedProjectUpdatePlan {
  readonly operation: "update";
  readonly operationId: string;
  readonly installation: InstalledProjectVersions;
  readonly projectManifest: ProjectManifestRecord;
  readonly currentRecords: readonly ManagedFileRecord[];
  readonly actions: readonly ManagedProjectUpdateAction[];
  readonly hasConflicts: boolean;
}

export interface ManagedProjectUninstallPlan {
  readonly operation: "uninstall";
  readonly operationId: string;
  readonly projectManifest: ProjectManifestRecord;
  readonly currentRecords: readonly ManagedFileRecord[];
  readonly actions: readonly ManagedProjectUninstallAction[];
  readonly hasConflicts: boolean;
}

export type ManagedProjectMutationPlan =
  | ManagedProjectUpdatePlan
  | ManagedProjectUninstallPlan;

type ManagedProjectMutationFailure = Readonly<{
  ok: false;
  contractVersion: 1;
  state: "invalid";
  diagnostics: readonly ManagedProjectDiagnostic[];
}>;

export type PlanManagedProjectUpdateResult =
  | Readonly<{
      ok: true;
      contractVersion: 1;
      state: "planned";
      plan: ManagedProjectUpdatePlan;
      diagnostics: readonly [];
    }>
  | ManagedProjectMutationFailure;

export type PlanManagedProjectUninstallResult =
  | Readonly<{
      ok: true;
      contractVersion: 1;
      state: "planned";
      plan: ManagedProjectUninstallPlan;
      diagnostics: readonly [];
    }>
  | ManagedProjectMutationFailure;

export interface ApplyManagedProjectPlanRequest {
  readonly fileSystem: ManagedProjectMutationFileSystem;
  readonly plan: ManagedProjectMutationPlan;
  readonly timestamp: string;
}

export interface RecoverManagedProjectOperationRequest {
  readonly fileSystem: ManagedProjectMutationFileSystem;
}

interface ManagedProjectOperationJournal {
  readonly schemaVersion: 1;
  readonly timestamp: string;
  readonly plan: ManagedProjectMutationPlan;
}

export type ApplyManagedProjectPlanResult =
  | Readonly<{
      ok: true;
      contractVersion: 1;
      state: "applied";
      operation: "update" | "uninstall";
      results: readonly (
        | ManagedProjectUpdateAction
        | ManagedProjectUninstallAction
      )[];
      diagnostics: readonly [];
    }>
  | Readonly<{
      ok: false;
      contractVersion: 1;
      state: "conflict";
      operation: "update" | "uninstall";
      results: readonly (
        | ManagedProjectUpdateAction
        | ManagedProjectUninstallAction
      )[];
      diagnostics: readonly ManagedProjectDiagnostic[];
    }>
  | ManagedProjectMutationFailure;

interface OwnershipManifest {
  readonly schemaVersion: 1;
  readonly files: readonly ManagedFileRecord[];
}

export async function planManagedProjectUpdate(
  request: PlanManagedProjectUpdateRequest,
): Promise<PlanManagedProjectUpdateResult> {
  try {
    const projectManifest = await readProjectManifest(request.fileSystem);
    const currentRecords = await readOwnershipManifest(request.fileSystem);
    if (projectManifest === null || currentRecords === null) {
      return invalidProjectStore();
    }

    const recordsByPath = new Map(
      currentRecords.map((record) => [record.path, record]),
    );
    const operationId = mutationId(
      projectManifest,
      request.installation,
      request.files,
    );
    const actions: ManagedProjectUpdateAction[] = [];
    for (const file of [...request.files].sort((left, right) =>
      left.path.localeCompare(right.path),
    )) {
      const current = recordsByPath.get(file.path);
      if (
        current === undefined ||
        current.ownershipClass !== file.ownershipClass
      ) {
        return invalidMutation(
          file.path,
          "The incoming managed file does not match its ownership record.",
          "Keep managed paths and Ownership Classes stable during this update.",
        );
      }

      const entry = await request.fileSystem.inspect(file.path);
      if (file.ownershipClass === "user-owned") {
        actions.push(
          Object.freeze({
            path: file.path,
            result: "retain",
            observedKind: entry.kind,
            record: current,
          }),
        );
        continue;
      }
      if (entry.kind !== "file") {
        return invalidMutation(
          file.path,
          "A generated managed file is unavailable for update planning.",
          "Restore the recorded generated file or resolve its ownership conflict.",
        );
      }
      const localContent = await request.fileSystem.readFile(file.path);
      const expectedLocalIdentity = contentIdentity(localContent);

      const installedContent = matchingInstalledContent(
        current,
        file.installedContent,
        file.installedAlternatives,
      );
      if (installedContent === null) {
        return invalidMutation(
          file.path,
          "No supplied installed template matches the recorded base identity.",
          "Include the historical template selected by the ownership manifest hash.",
        );
      }
      const installedIdentity = contentIdentity(installedContent);
      const record = buildIncomingRecord(file);
      const validation = validateContractRecord({
        contractVersion: RECORD_CONTRACT_VERSION,
        kind: "managedFile",
        record,
      });
      if (!validation.ok) {
        return invalidMutation(
          file.path,
          "The incoming managed-file record is invalid.",
          "Provide a valid repository path, ownership class, template version, and content.",
        );
      }
      if (file.ownershipClass === "managed-customizable") {
        if (!sameStrings(current.markerIds, file.markerIds)) {
          return invalidMutation(
            file.path,
            "Managed Block marker IDs changed across the update.",
            "Migrate marker IDs explicitly before updating managed content.",
          );
        }
        const mergedContent = replaceManagedBlocks(
          localContent,
          installedContent,
          file.incomingContent,
          file.markerIds,
        );
        if (mergedContent !== null) {
          actions.push(
            Object.freeze({
              path: file.path,
              result: "update",
              expectedLocalIdentity,
              content: mergedContent,
              record,
            }),
          );
          continue;
        }
      } else if (sameIdentity(expectedLocalIdentity, installedIdentity)) {
        actions.push(
          Object.freeze({
            path: file.path,
            result: "update",
            expectedLocalIdentity,
            content: file.incomingContent,
            record,
          }),
        );
        continue;
      }

      const pendingRecord = Object.freeze({
        ...current,
        incomingUpdateIdentity: contentIdentity(file.incomingContent),
      });
      actions.push(
        Object.freeze({
          path: file.path,
          result: "conflict",
          expectedLocalIdentity,
          record: pendingRecord,
          variants: conflictVariantPaths(operationId, file.path),
          localContent,
          baseContent: installedContent,
          incomingContent: file.incomingContent,
        }),
      );
    }

    const plan: ManagedProjectUpdatePlan = Object.freeze({
      operation: "update",
      operationId,
      installation: request.installation,
      projectManifest,
      currentRecords: Object.freeze([...currentRecords]),
      actions: Object.freeze(actions),
      hasConflicts: actions.some(({ result }) => result === "conflict"),
    });
    return Object.freeze({
      ok: true,
      contractVersion: 1,
      state: "planned",
      plan,
      diagnostics: Object.freeze([]) as readonly [],
    });
  } catch {
    return invalidProjectStore();
  }
}

export async function planManagedProjectUninstall(
  request: PlanManagedProjectUninstallRequest,
): Promise<PlanManagedProjectUninstallResult> {
  try {
    const projectManifest = await readProjectManifest(request.fileSystem);
    const currentRecords = await readOwnershipManifest(request.fileSystem);
    if (projectManifest === null || currentRecords === null) {
      return invalidProjectStore();
    }

    const installedByPath = new Map(
      request.files.map((file) => [file.path, file]),
    );
    const operationId = uninstallMutationId(projectManifest, request.files);
    const actions: ManagedProjectUninstallAction[] = [];
    for (const record of [...currentRecords].sort((left, right) =>
      left.path.localeCompare(right.path),
    )) {
      const entry = await request.fileSystem.inspect(record.path);
      if (record.ownershipClass === "user-owned") {
        actions.push(
          Object.freeze({
            path: record.path,
            result: "retain",
            observedKind: entry.kind,
            record,
          }),
        );
        continue;
      }
      if (entry.kind !== "file") {
        return invalidMutation(
          record.path,
          "A generated managed file is unavailable for uninstall planning.",
          "Restore the recorded generated file or resolve its ownership conflict.",
        );
      }
      const localContent = await request.fileSystem.readFile(record.path);
      const expectedLocalIdentity = contentIdentity(localContent);

      const installedFile = installedByPath.get(record.path);
      if (installedFile === undefined) {
        return invalidMutation(
          record.path,
          "The installed template required for uninstall is unavailable.",
          "Use the template version named by the ownership manifest.",
        );
      }
      const installedContent = matchingInstalledContent(
        record,
        installedFile.installedContent,
        installedFile.installedAlternatives,
      );
      if (installedContent === null) {
        return invalidMutation(
          record.path,
          "No supplied installed template matches the recorded base identity.",
          "Include the historical template selected by the ownership manifest hash.",
        );
      }
      const installedIdentity = contentIdentity(installedContent);
      if (record.ownershipClass === "managed-customizable") {
        const retainedContent = removeManagedBlocks(
          localContent,
          installedContent,
          record.markerIds,
        );
        if (retainedContent !== null) {
          actions.push(
            Object.freeze({
              path: record.path,
              result: retainedContent.length === 0 ? "remove" : "update",
              expectedLocalIdentity,
              ...(retainedContent.length === 0
                ? {}
                : { content: retainedContent }),
              record,
            }) as ManagedProjectUninstallAction,
          );
          continue;
        }
      } else if (sameIdentity(expectedLocalIdentity, installedIdentity)) {
        actions.push(
          Object.freeze({
            path: record.path,
            result: "remove",
            expectedLocalIdentity,
            record,
          }),
        );
        continue;
      }

      actions.push(
        Object.freeze({
          path: record.path,
          result: "conflict",
          expectedLocalIdentity,
          record,
          variants: uninstallConflictVariantPaths(operationId, record.path),
          localContent,
          baseContent: installedContent,
        }),
      );
    }

    const plan: ManagedProjectUninstallPlan = Object.freeze({
      operation: "uninstall",
      operationId,
      projectManifest,
      currentRecords: Object.freeze([...currentRecords]),
      actions: Object.freeze(actions),
      hasConflicts: actions.some(({ result }) => result === "conflict"),
    });
    return Object.freeze({
      ok: true,
      contractVersion: 1,
      state: "planned",
      plan,
      diagnostics: Object.freeze([]) as readonly [],
    });
  } catch {
    return invalidProjectStore();
  }
}

export async function applyManagedProjectPlan(
  request: ApplyManagedProjectPlanRequest,
): Promise<ApplyManagedProjectPlanResult> {
  try {
    return await request.fileSystem.withSharedCheckoutWriterLock(() =>
      applyManagedProjectPlanLocked(request),
    );
  } catch {
    return operationIoFailure();
  }
}

async function applyManagedProjectPlanLocked(
  request: ApplyManagedProjectPlanRequest,
): Promise<ApplyManagedProjectPlanResult> {
  const journal: ManagedProjectOperationJournal = Object.freeze({
    schemaVersion: 1,
    timestamp: request.timestamp,
    plan: request.plan,
  });
  if (!isManagedProjectOperationJournal(journal)) {
    return invalidMutation(
      MANAGED_PROJECT_OPERATION_JOURNAL_PATH,
      "The managed-file plan or operation timestamp is invalid.",
      "Create a fresh plan and use a valid UTC timestamp.",
    );
  }
  const journalEntry = await request.fileSystem.inspect(
    MANAGED_PROJECT_OPERATION_JOURNAL_PATH,
  );
  if (journalEntry.kind !== "missing") {
    return invalidMutation(
      MANAGED_PROJECT_OPERATION_JOURNAL_PATH,
      "A managed-file operation already requires recovery.",
      "Recover the recorded operation before creating another plan.",
    );
  }
  const preflight = await validatePlanSnapshot(request.fileSystem, request.plan);
  if (preflight !== null) {
    return preflight;
  }
  await request.fileSystem.writeFile(
    MANAGED_PROJECT_OPERATION_JOURNAL_PATH,
    prettyJson(journal),
  );
  return finishManagedProjectOperation(request.fileSystem, journal);
}


export async function recoverManagedProjectOperation(
  request: RecoverManagedProjectOperationRequest,
): Promise<ApplyManagedProjectPlanResult> {
  try {
    return await request.fileSystem.withSharedCheckoutWriterLock(() =>
      recoverManagedProjectOperationLocked(request),
    );
  } catch {
    return operationIoFailure();
  }
}

async function recoverManagedProjectOperationLocked(
  request: RecoverManagedProjectOperationRequest,
): Promise<ApplyManagedProjectPlanResult> {
  const entry = await request.fileSystem.inspect(
    MANAGED_PROJECT_OPERATION_JOURNAL_PATH,
  );
  if (entry.kind !== "file") {
    return invalidMutation(
      MANAGED_PROJECT_OPERATION_JOURNAL_PATH,
      "No recoverable managed-file operation journal exists.",
      "Create and apply a new update or uninstall plan.",
    );
  }
  const parsed: unknown = JSON.parse(
    await request.fileSystem.readFile(MANAGED_PROJECT_OPERATION_JOURNAL_PATH),
  );
  if (!isManagedProjectOperationJournal(parsed)) {
    return invalidMutation(
      MANAGED_PROJECT_OPERATION_JOURNAL_PATH,
      "The managed-file operation journal is invalid or unsafe.",
      "Restore the journal from a trusted operation or resolve it manually.",
    );
  }
  return finishManagedProjectOperation(request.fileSystem, parsed);
}


async function finishManagedProjectOperation(
  fileSystem: ManagedProjectMutationFileSystem,
  journal: ManagedProjectOperationJournal,
): Promise<ApplyManagedProjectPlanResult> {
  const result =
    journal.plan.operation === "update"
      ? await applyManagedProjectUpdate(
          fileSystem,
          journal.plan,
          journal.timestamp,
        )
      : await applyManagedProjectUninstall(
          fileSystem,
          journal.plan,
          journal.timestamp,
        );
  if (result.state === "applied" || result.state === "conflict") {
    await fileSystem.removeFile(MANAGED_PROJECT_OPERATION_JOURNAL_PATH);
  }
  return result;
}

async function validatePlanSnapshot(
  fileSystem: ManagedProjectMutationFileSystem,
  plan: ManagedProjectMutationPlan,
): Promise<ManagedProjectMutationFailure | null> {
  for (const action of plan.actions) {
    if (action.result === "retain") {
      continue;
    }
    const entry = await fileSystem.inspect(action.path);
    if (entry.kind !== "file") {
      return stalePlan(action.path);
    }
    const localContent = await fileSystem.readFile(action.path);
    if (!sameIdentity(contentIdentity(localContent), action.expectedLocalIdentity)) {
      return stalePlan(action.path);
    }
  }
  return null;
}

function operationIoFailure(): ManagedProjectMutationFailure {
  return mutationFailure(
    "managed_project.io_failed",
    ".sayhi",
    "The managed-file operation could not be applied through the filesystem adapter.",
    "Check repository permissions, then recover the recorded operation.",
  );
}

type ManagedProjectMutationAction =
  | ManagedProjectUpdateAction
  | ManagedProjectUninstallAction;

type ManagedProjectActionState =
  | "retain"
  | "expected"
  | "completed"
  | "stale";

async function observeManagedProjectAction(
  fileSystem: ManagedProjectMutationFileSystem,
  action: ManagedProjectMutationAction,
): Promise<ManagedProjectActionState> {
  if (action.result === "retain") {
    return "retain";
  }
  const entry = await fileSystem.inspect(action.path);
  if (action.result === "remove" && entry.kind === "missing") {
    return "completed";
  }
  if (entry.kind !== "file") {
    return "stale";
  }
  const localIdentity = contentIdentity(
    await fileSystem.readFile(action.path),
  );
  if (sameIdentity(localIdentity, action.expectedLocalIdentity)) {
    return "expected";
  }
  return action.result === "update" &&
    sameIdentity(localIdentity, contentIdentity(action.content))
    ? "completed"
    : "stale";
}

async function applyManagedProjectUpdate(
  fileSystem: ManagedProjectMutationFileSystem,
  plan: ManagedProjectUpdatePlan,
  timestamp: string,
): Promise<ApplyManagedProjectPlanResult> {
  const recordsByPath = new Map(
    plan.currentRecords.map((record) => [record.path, record]),
  );
  for (const action of plan.actions) {
    const state = await observeManagedProjectAction(fileSystem, action);
    if (state === "retain") {
      continue;
    }
    if (state === "stale") {
      return stalePlan(action.path);
    }
    if (action.result === "update") {
      if (state === "expected") {
        await fileSystem.writeFile(action.path, action.content);
      }
      recordsByPath.set(action.path, action.record);
    } else if (action.result === "conflict") {
      await writeConflictVariants(fileSystem, action);
      recordsByPath.set(action.path, action.record);
    }
  }

  await writeOwnershipManifest(fileSystem, recordsByPath.values());
  const projectManifest: ProjectManifestRecord = Object.freeze({
    ...plan.projectManifest,
    installed: plan.hasConflicts
      ? plan.projectManifest.installed
      : plan.installation,
    updatedAt: timestamp,
  });
  const invalidManifest = validateMutationManifest(projectManifest);
  if (invalidManifest !== null) {
    return invalidManifest;
  }
  await fileSystem.writeFile(PROJECT_MANIFEST_PATH, prettyJson(projectManifest));

  if (plan.hasConflicts) {
    return conflictResult("update", plan.actions);
  }
  return appliedResult("update", plan.actions);
}

async function applyManagedProjectUninstall(
  fileSystem: ManagedProjectMutationFileSystem,
  plan: ManagedProjectUninstallPlan,
  timestamp: string,
): Promise<ApplyManagedProjectPlanResult> {
  const recordsByPath = new Map(
    plan.currentRecords.map((record) => [record.path, record]),
  );
  for (const action of plan.actions) {
    const state = await observeManagedProjectAction(fileSystem, action);
    if (state === "retain") {
      continue;
    }
    if (state === "stale") {
      return stalePlan(action.path);
    }
    if (action.result === "remove") {
      if (state === "expected") {
        await fileSystem.removeFile(action.path);
      }
      recordsByPath.delete(action.path);
    } else if (action.result === "update") {
      if (state === "expected") {
        await fileSystem.writeFile(action.path, action.content);
      }
      recordsByPath.delete(action.path);
    } else if (action.result === "conflict") {
      await writeConflictVariants(fileSystem, action);
    }
  }

  if (plan.hasConflicts) {
    await writeOwnershipManifest(fileSystem, recordsByPath.values());
    const projectManifest: ProjectManifestRecord = Object.freeze({
      ...plan.projectManifest,
      updatedAt: timestamp,
    });
    const invalidManifest = validateMutationManifest(projectManifest);
    if (invalidManifest !== null) {
      return invalidManifest;
    }
    await fileSystem.writeFile(PROJECT_MANIFEST_PATH, prettyJson(projectManifest));
    return conflictResult("uninstall", plan.actions);
  }

  await fileSystem.removeFile(PROJECT_MANIFEST_PATH);
  await fileSystem.removeFile(OWNERSHIP_MANIFEST_PATH);
  return appliedResult("uninstall", plan.actions);
}

async function writeOwnershipManifest(
  fileSystem: ManagedProjectMutationFileSystem,
  records: Iterable<ManagedFileRecord>,
): Promise<void> {
  const ownershipManifest: OwnershipManifest = Object.freeze({
    schemaVersion: 1,
    files: Object.freeze(
      [...records].sort((left, right) => left.path.localeCompare(right.path)),
    ),
  });
  await fileSystem.writeFile(
    OWNERSHIP_MANIFEST_PATH,
    prettyJson(ownershipManifest),
  );
}

function validateMutationManifest(
  projectManifest: ProjectManifestRecord,
): ManagedProjectMutationFailure | null {
  const validation = validateContractRecord({
    contractVersion: RECORD_CONTRACT_VERSION,
    kind: "projectManifest",
    record: projectManifest,
  });
  return validation.ok
    ? null
    : invalidMutation(
        PROJECT_MANIFEST_PATH,
        "The operation timestamp or target installation is invalid.",
        "Use a UTC timestamp and valid installed component versions.",
      );
}

function stalePlan(path: string): ManagedProjectMutationFailure {
  return invalidMutation(
    path,
    "The managed file changed after its plan was created.",
    "Create a fresh managed-file plan before applying changes.",
  );
}

function appliedResult(
  operation: "update" | "uninstall",
  results: readonly (ManagedProjectUpdateAction | ManagedProjectUninstallAction)[],
): ApplyManagedProjectPlanResult {
  return Object.freeze({
    ok: true,
    contractVersion: 1,
    state: "applied",
    operation,
    results,
    diagnostics: Object.freeze([]) as readonly [],
  });
}

function conflictResult(
  operation: "update" | "uninstall",
  results: readonly (ManagedProjectUpdateAction | ManagedProjectUninstallAction)[],
): ApplyManagedProjectPlanResult {
  const diagnostics = Object.freeze(
    results
      .filter((action) => action.result === "conflict")
      .map((action) =>
        Object.freeze({
          code: "managed_project.file_modified" as const,
          path: action.path,
          message: "The managed file has local changes and was not overwritten.",
          remediation: `Resolve the preserved variants under ${action.variants.local}.`,
        }),
      ),
  );
  return Object.freeze({
    ok: false,
    contractVersion: 1,
    state: "conflict",
    operation,
    results,
    diagnostics,
  });
}

type ManagedProjectConflictAction =
  | Extract<ManagedProjectUpdateAction, { result: "conflict" }>
  | Extract<ManagedProjectUninstallAction, { result: "conflict" }>;

async function writeConflictVariants(
  fileSystem: ManagedProjectMutationFileSystem,
  action: ManagedProjectConflictAction,
): Promise<void> {
  await ensureDirectory(fileSystem, ".sayhi/.runtime/conflicts");
  await ensureDirectory(
    fileSystem,
    `.sayhi/.runtime/conflicts/${conflictOperationDirectory(action.variants.local)}`,
  );
  await fileSystem.writeFile(action.variants.local, action.localContent);
  await fileSystem.writeFile(action.variants.base, action.baseContent);
  if ("incomingContent" in action) {
    await fileSystem.writeFile(action.variants.incoming, action.incomingContent);
  }
}

async function ensureDirectory(
  fileSystem: ManagedProjectMutationFileSystem,
  path: string,
): Promise<void> {
  const entry = await fileSystem.inspect(path);
  if (entry.kind === "missing") {
    await fileSystem.createDirectory(path);
    return;
  }
  if (entry.kind !== "directory") {
    throw new Error(`Unsafe managed directory: ${path}`);
  }
}

function mutationId(
  projectManifest: ProjectManifestRecord,
  installation: InstalledProjectVersions,
  files: readonly ManagedProjectUpdateFile[],
): string {
  const identity = JSON.stringify({
    projectId: projectManifest.projectId,
    installed: projectManifest.installed,
    installation,
    files: [...files].sort((left, right) => left.path.localeCompare(right.path)),
  });
  return createHash("sha256").update(identity).digest("hex").slice(0, 24);
}

function uninstallMutationId(
  projectManifest: ProjectManifestRecord,
  files: readonly ManagedProjectInstalledFile[],
): string {
  const identity = JSON.stringify({
    operation: "uninstall",
    projectId: projectManifest.projectId,
    installed: projectManifest.installed,
    files: [...files].sort((left, right) => left.path.localeCompare(right.path)),
  });
  return createHash("sha256").update(identity).digest("hex").slice(0, 24);
}

function conflictVariantPaths(
  operationId: string,
  path: string,
): ManagedProjectConflictVariants {
  const pathId = createHash("sha256").update(path).digest("hex").slice(0, 16);
  const stem = `.sayhi/.runtime/conflicts/${operationId}/${pathId}`;
  return Object.freeze({
    local: `${stem}.local`,
    base: `${stem}.base`,
    incoming: `${stem}.incoming`,
  });
}

function conflictOperationDirectory(path: string): string {
  return path.split("/")[3]!;
}

function matchingInstalledContent(
  record: ManagedFileRecord,
  installedContent: string,
  alternatives: readonly string[] | undefined,
): string | null {
  for (const candidate of [installedContent, ...(alternatives ?? [])]) {
    if (sameIdentity(record.installedBaseIdentity, contentIdentity(candidate))) {
      return candidate;
    }
  }
  return null;
}

async function readProjectManifest(
  fileSystem: ManagedProjectFileSystem,
): Promise<ProjectManifestRecord | null> {
  const parsed = JSON.parse(await fileSystem.readFile(PROJECT_MANIFEST_PATH));
  const validation = validateContractRecord({
    contractVersion: RECORD_CONTRACT_VERSION,
    kind: "projectManifest",
    record: parsed,
  });
  return validation.ok ? (validation.record as ProjectManifestRecord) : null;
}

function uninstallConflictVariantPaths(
  operationId: string,
  path: string,
): ManagedProjectUninstallConflictVariants {
  const paths = conflictVariantPaths(operationId, path);
  return Object.freeze({ local: paths.local, base: paths.base });
}

async function readOwnershipManifest(
  fileSystem: ManagedProjectFileSystem,
): Promise<readonly ManagedFileRecord[] | null> {
  const parsed: unknown = JSON.parse(
    await fileSystem.readFile(OWNERSHIP_MANIFEST_PATH),
  );
  if (!isOwnershipManifest(parsed)) {
    return null;
  }
  for (const record of parsed.files) {
    const validation = validateContractRecord({
      contractVersion: RECORD_CONTRACT_VERSION,
      kind: "managedFile",
      record,
    });
    if (!validation.ok) {
      return null;
    }
  }
  return parsed.files;
}

function buildIncomingRecord(
  file: ManagedProjectUpdateFile,
): ManagedFileRecord {
  return Object.freeze({
    schemaVersion: 1,
    path: file.path,
    ownershipClass: file.ownershipClass,
    installedBaseIdentity: contentIdentity(file.incomingContent),
    generatedSourceVersion: file.generatedSourceVersion,
    markerIds: Object.freeze([...file.markerIds]),
    ...(file.localOverrideSource === undefined
      ? {}
      : { localOverrideSource: file.localOverrideSource }),
  });
}


function sameStrings(left: readonly string[], right: readonly string[]): boolean {
  return (
    left.length === right.length &&
    left.every((value, index) => value === right[index])
  );
}


function contentIdentity(content: string): ContentHash {
  return Object.freeze({
    algorithm: "sha256-lf-v1",
    digest: createHash("sha256")
      .update(content.replaceAll("\r\n", "\n").replaceAll("\r", "\n"), "utf8")
      .digest("hex"),
  });
}

function sameIdentity(
  left: ContentHash | undefined,
  right: ContentHash,
): boolean {
  return (
    left?.algorithm === right.algorithm &&
    left.digest.toLowerCase() === right.digest.toLowerCase()
  );
}

function isManagedProjectOperationJournal(
  value: unknown,
): value is ManagedProjectOperationJournal {
  if (!isRecordValue(value) || value.schemaVersion !== 1) {
    return false;
  }
  if (
    typeof value.timestamp !== "string" ||
    !validateDomainValue({
      contractVersion: 1,
      kind: "timestamp",
      value: value.timestamp,
    }).ok
  ) {
    return false;
  }
  return isManagedProjectMutationPlan(value.plan, value.timestamp);
}

function isManagedProjectMutationPlan(
  value: unknown,
  timestamp: string,
): value is ManagedProjectMutationPlan {
  if (
    !isRecordValue(value) ||
    (value.operation !== "update" && value.operation !== "uninstall") ||
    typeof value.operationId !== "string" ||
    !/^[a-f0-9]{24}$/u.test(value.operationId) ||
    typeof value.hasConflicts !== "boolean" ||
    !Array.isArray(value.currentRecords) ||
    !Array.isArray(value.actions)
  ) {
    return false;
  }
  const manifestValidation = validateContractRecord({
    contractVersion: RECORD_CONTRACT_VERSION,
    kind: "projectManifest",
    record: value.projectManifest,
  });
  if (!manifestValidation.ok) {
    return false;
  }
  const projectManifest = manifestValidation.record as ProjectManifestRecord;
  const targetManifest = {
    ...projectManifest,
    ...(value.operation === "update" ? { installed: value.installation } : {}),
    updatedAt: timestamp,
  };
  if (
    !validateContractRecord({
      contractVersion: RECORD_CONTRACT_VERSION,
      kind: "projectManifest",
      record: targetManifest,
    }).ok
  ) {
    return false;
  }

  const currentPaths = new Set<string>();
  for (const record of value.currentRecords) {
    if (!isManagedFileRecord(record) || currentPaths.has(record.path)) {
      return false;
    }
    currentPaths.add(record.path);
  }
  const actionPaths = new Set<string>();
  for (const action of value.actions) {
    if (
      !isJournalAction(
        action,
        value.operation,
        value.operationId,
        currentPaths,
      ) ||
      actionPaths.has(action.path)
    ) {
      return false;
    }
    actionPaths.add(action.path);
  }
  return (
    value.hasConflicts ===
    value.actions.some(
      (action) => isRecordValue(action) && action.result === "conflict",
    )
  );
}

function isJournalAction(
  value: unknown,
  operation: "update" | "uninstall",
  operationId: string,
  currentPaths: ReadonlySet<string>,
): value is ManagedProjectUpdateAction | ManagedProjectUninstallAction {
  if (
    !isRecordValue(value) ||
    typeof value.path !== "string" ||
    !currentPaths.has(value.path) ||
    !isManagedFileRecord(value.record) ||
    value.record.path !== value.path
  ) {
    return false;
  }
  if (value.result === "retain") {
    return isManagedProjectPathKind(value.observedKind);
  }
  if (!isContentIdentity(value.expectedLocalIdentity)) {
    return false;
  }
  if (value.result === "update") {
    return typeof value.content === "string";
  }
  if (operation === "uninstall" && value.result === "remove") {
    return true;
  }
  if (value.result !== "conflict") {
    return false;
  }
  if (
    typeof value.localContent !== "string" ||
    typeof value.baseContent !== "string" ||
    !isConflictVariants(value.variants, operationId, operation === "update")
  ) {
    return false;
  }
  return operation === "uninstall" || typeof value.incomingContent === "string";
}

function isManagedProjectPathKind(
  value: unknown,
): value is ManagedProjectPathKind {
  return (
    value === "missing" ||
    value === "file" ||
    value === "directory" ||
    value === "symlink" ||
    value === "other"
  );
}

function isManagedFileRecord(value: unknown): value is ManagedFileRecord {
  return (
    isRecordValue(value) &&
    typeof value.path === "string" &&
    value.path.startsWith(".sayhi/") &&
    validateContractRecord({
      contractVersion: RECORD_CONTRACT_VERSION,
      kind: "managedFile",
      record: value,
    }).ok
  );
}

function isContentIdentity(value: unknown): value is ContentHash {
  return (
    isRecordValue(value) &&
    validateDomainValue({
      contractVersion: 1,
      kind: "contentHash",
      value: value as ContentHash,
    }).ok
  );
}

function isConflictVariants(
  value: unknown,
  operationId: string,
  requireIncoming: boolean,
): boolean {
  if (!isRecordValue(value)) {
    return false;
  }
  const paths = requireIncoming
    ? [value.local, value.base, value.incoming]
    : [value.local, value.base];
  const prefix = `.sayhi/.runtime/conflicts/${operationId}/`;
  return paths.every((path) => {
    if (typeof path !== "string" || !path.startsWith(prefix)) {
      return false;
    }
    const suffix = path.slice(prefix.length);
    return (
      suffix.length > 0 &&
      suffix !== "." &&
      suffix !== ".." &&
      !suffix.includes("/") &&
      !suffix.includes("\\")
    );
  });
}

function isRecordValue(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isOwnershipManifest(value: unknown): value is OwnershipManifest {
  return (
    typeof value === "object" &&
    value !== null &&
    (value as { schemaVersion?: unknown }).schemaVersion === 1 &&
    Array.isArray((value as { files?: unknown }).files)
  );
}

function invalidProjectStore(): ManagedProjectMutationFailure {
  return invalidMutation(
    ".sayhi",
    "The Project Store cannot be used to plan a managed-file update.",
    "Run sayhi doctor and repair the reported Project Store error first.",
  );
}

function invalidMutation(
  path: string,
  message: string,
  remediation: string,
): ManagedProjectMutationFailure {
  return mutationFailure("managed_project.corrupt", path, message, remediation);
}

function mutationFailure(
  code: ManagedProjectDiagnostic["code"],
  path: string,
  message: string,
  remediation: string,
): ManagedProjectMutationFailure {
  return Object.freeze({
    ok: false,
    contractVersion: 1,
    state: "invalid",
    diagnostics: Object.freeze([
      Object.freeze({ code, path, message, remediation }),
    ]),
  });
}

function prettyJson(value: unknown): string {
  return `${JSON.stringify(value, null, 2)}\n`;
}
