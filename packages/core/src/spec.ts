import {
  hashTextContent,
  type ContextManifestDiagnostic,
} from "./context-manifest.js";
import {
  approveSpec,
  type SpecApprovalFileSystem,
} from "./spec-approval.js";
import type { ManagedProjectPathKind } from "./managed-project.js";
import { isRepositoryRelativePath } from "./repository-path.js";
import {
  inspectDurableContextManifest,
  readDurableTask,
  type ContextManifestFileSystem,
} from "./task-lifecycle.js";
import type { WorkflowPhase } from "./workflow.js";

export const SPEC_CONTRACT_VERSION = 1 as const;

const SPEC_DIRECTORY = ".sayhi/spec";

export interface SpecDirectoryEntry {
  readonly name: string;
  readonly kind: ManagedProjectPathKind;
}

export interface SpecFileSystem extends SpecApprovalFileSystem {
  listDirectory(path: string): Promise<readonly SpecDirectoryEntry[]>;
  readRepositoryFile(path: string): Promise<string>;
  withSharedCheckoutWriterLock<Result>(
    operation: () => Promise<Result>,
  ): Promise<Result>;
}
export interface SpecImpactFileSystem
  extends SpecFileSystem,
    ContextManifestFileSystem {}


export interface CreateSpecRequest {
  readonly fileSystem: SpecFileSystem;
  readonly path: string;
  readonly source: string;
  readonly persist?: boolean;
}

export interface ReadSpecRequest {
  readonly fileSystem: SpecFileSystem;
  readonly path: string;
}

export interface ValidateSpecsRequest {
  readonly fileSystem: SpecFileSystem;
  readonly path?: string;
}
export interface FindImpactedSpecContextsRequest {
  readonly fileSystem: SpecImpactFileSystem;
  readonly path: string;
}


export interface SpecDiagnostic extends ContextManifestDiagnostic {
  readonly code:
    | "spec.path.invalid"
    | "spec.source.unreadable"
    | "spec.content.invalid"
    | "spec.exists"
    | "spec.missing"
    | "spec.approval.invalid"
    | "spec.io_failed";
}

type SpecFailure = Readonly<{
  ok: false;
  contractVersion: typeof SPEC_CONTRACT_VERSION;
  diagnostics: readonly SpecDiagnostic[];
}>;

export type CreateSpecResult =
  | Readonly<{
      ok: true;
      contractVersion: typeof SPEC_CONTRACT_VERSION;
      path: string;
      identity: ReturnType<typeof hashTextContent>;
      planned: boolean;
    }>
  | SpecFailure;

export type ListSpecsResult =
  | Readonly<{
      ok: true;
      contractVersion: typeof SPEC_CONTRACT_VERSION;
      paths: readonly string[];
    }>
  | SpecFailure;

export type ReadSpecResult =
  | Readonly<{
      ok: true;
      contractVersion: typeof SPEC_CONTRACT_VERSION;
      path: string;
      content: string;
      identity: ReturnType<typeof hashTextContent>;
    }>
  | SpecFailure;

export type ValidateSpecsResult =
  | Readonly<{
      ok: true;
      contractVersion: typeof SPEC_CONTRACT_VERSION;
      state: "valid";
      paths: readonly string[];
      diagnostics: readonly SpecDiagnostic[];
    }>
  | Readonly<{
      ok: false;
      contractVersion: typeof SPEC_CONTRACT_VERSION;
      state: "invalid";
      diagnostics: readonly SpecDiagnostic[];
    }>;
export interface SpecContextImpact {
  readonly taskId: string;
  readonly phase: WorkflowPhase;
  readonly state: "valid" | "stale";
}

export type FindImpactedSpecContextsResult =
  | Readonly<{
      ok: true;
      contractVersion: typeof SPEC_CONTRACT_VERSION;
      impacts: readonly SpecContextImpact[];
    }>
  | SpecFailure;


export async function createSpec(
  request: CreateSpecRequest,
): Promise<CreateSpecResult> {
  const path = resolveSpecPath(request.path);
  if (!path.ok) {
    return path;
  }
  if (!isRepositoryRelativePath(request.source)) {
    return specFailure(
      "spec.path.invalid",
      request.source,
      "Spec source must be a repository-relative path.",
      "Use a normalized source path without absolute roots, backslashes, or '..' traversal.",
    );
  }
  try {
    return await request.fileSystem.withSharedCheckoutWriterLock(async () => {
      let content: string;
      try {
        content = await request.fileSystem.readRepositoryFile(request.source);
      } catch {
        return specFailure(
          "spec.source.unreadable",
          request.source,
          "Spec source is missing, unreadable, or unsafe.",
          "Restore a regular repository file at the requested source path.",
        );
      }
      if (content.trim().length === 0) {
        return specFailure(
          "spec.content.invalid",
          request.source,
          "Spec source must contain non-whitespace content.",
          "Add accepted specification content before creating the Spec.",
        );
      }
      const identity = hashTextContent(content);
      const existing = await request.fileSystem.inspect(path.path);
      if (existing.kind === "file") {
        const existingIdentity = hashTextContent(
          await request.fileSystem.readFile(path.path),
        );
        if (
          existingIdentity.algorithm !== identity.algorithm ||
          existingIdentity.digest.toLowerCase() !== identity.digest.toLowerCase()
        ) {
          return specFailure(
            "spec.exists",
            path.path,
            "A different Spec already exists at this path.",
            "Choose a new Spec path or update the User-owned Spec outside this create command.",
          );
        }
      } else if (existing.kind !== "missing") {
        return specFailure(
          "spec.exists",
          path.path,
          "A Spec path already exists and is not a regular file.",
          "Replace the unsafe path before creating the Spec.",
        );
      }
      const directory = path.path.slice(0, path.path.lastIndexOf("/"));
      const directoryFailure = await prepareSpecDirectories(
        request.fileSystem,
        directory,
        request.persist ?? true,
      );
      if (directoryFailure !== null) {
        return directoryFailure;
      }
      if (request.persist === false) {
        return Object.freeze({
          ok: true,
          contractVersion: SPEC_CONTRACT_VERSION,
          path: path.path,
          identity,
          planned: true,
        });
      }
      if (existing.kind === "missing") {
        await request.fileSystem.writeFile(path.path, content);
      }
      const approval = await approveSpec(request.fileSystem, {
        path: path.path,
        identity,
        approvedBy: "sayhi-spec-create",
      });
      if (approval.ok === false) {
        const diagnostic = approval.diagnostics[0]!;
        return specFailure(
          "spec.approval.invalid",
          diagnostic.path,
          diagnostic.message,
          diagnostic.remediation,
        );
      }
      return Object.freeze({
        ok: true,
        contractVersion: SPEC_CONTRACT_VERSION,
        path: path.path,
        identity,
        planned: false,
      });
    });
  } catch {
    return specFailure(
      "spec.io_failed",
      path.path,
      "Spec creation could not complete filesystem access.",
      "Inspect the Project Store path and permissions, then retry.",
    );
  }
}

export async function listSpecs(
  fileSystem: SpecFileSystem,
): Promise<ListSpecsResult> {
  try {
    const directory = await fileSystem.inspect(SPEC_DIRECTORY);
    if (directory.kind !== "directory") {
      return specFailure(
        "spec.missing",
        SPEC_DIRECTORY,
        "The Managed Project Spec directory is unavailable.",
        "Initialize or repair the Managed Project before inspecting Specs.",
      );
    }
    const paths = await collectSpecPaths(fileSystem, SPEC_DIRECTORY);
    return Object.freeze({
      ok: true,
      contractVersion: SPEC_CONTRACT_VERSION,
      paths: Object.freeze(paths),
    });
  } catch {
    return specFailure(
      "spec.io_failed",
      SPEC_DIRECTORY,
      "Specs could not be listed safely.",
      "Inspect the Project Store path and permissions, then retry.",
    );
  }
}

export async function readSpec(request: ReadSpecRequest): Promise<ReadSpecResult> {
  const path = resolveSpecPath(request.path);
  if (!path.ok) {
    return path;
  }
  try {
    if ((await request.fileSystem.inspect(path.path)).kind !== "file") {
      return specFailure(
        "spec.missing",
        path.path,
        "The requested Spec is missing or unsafe.",
        "Create or restore the User-owned Spec before inspecting it.",
      );
    }
    const content = await request.fileSystem.readFile(path.path);
    if (content.trim().length === 0) {
      return specFailure(
        "spec.content.invalid",
        path.path,
        "Spec content must not be empty.",
        "Add accepted specification content before using this Spec.",
      );
    }
    return Object.freeze({
      ok: true,
      contractVersion: SPEC_CONTRACT_VERSION,
      path: path.path,
      content,
      identity: hashTextContent(content),
    });
  } catch {
    return specFailure(
      "spec.io_failed",
      path.path,
      "Spec could not be inspected safely.",
      "Inspect the Project Store path and permissions, then retry.",
    );
  }
}

export async function validateSpecs(
  request: ValidateSpecsRequest,
): Promise<ValidateSpecsResult> {
  if (request.path !== undefined) {
    const spec = await readSpec({ fileSystem: request.fileSystem, path: request.path });
    return spec.ok
      ? Object.freeze({
          ok: true,
          contractVersion: SPEC_CONTRACT_VERSION,
          state: "valid",
          paths: Object.freeze([spec.path]),
          diagnostics: Object.freeze([]),
        })
      : Object.freeze({
          ok: false,
          contractVersion: SPEC_CONTRACT_VERSION,
          state: "invalid",
          diagnostics: spec.diagnostics,
        });
  }
  const listed = await listSpecs(request.fileSystem);
  if (!listed.ok) {
    return Object.freeze({
      ok: false,
      contractVersion: SPEC_CONTRACT_VERSION,
      state: "invalid",
      diagnostics: listed.diagnostics,
    });
  }
  for (const path of listed.paths) {
    const spec = await readSpec({ fileSystem: request.fileSystem, path });
    if (!spec.ok) {
      return Object.freeze({
        ok: false,
        contractVersion: SPEC_CONTRACT_VERSION,
        state: "invalid",
        diagnostics: spec.diagnostics,
      });
    }
  }
  return Object.freeze({
    ok: true,
    contractVersion: SPEC_CONTRACT_VERSION,
    state: "valid",
    paths: listed.paths,
    diagnostics: Object.freeze([]),
  });
}
export async function findImpactedSpecContexts(
  request: FindImpactedSpecContextsRequest,
): Promise<FindImpactedSpecContextsResult> {
  const spec = resolveSpecPath(request.path);
  if (!spec.ok) {
    return spec;
  }
  const tasksDirectory = ".sayhi/tasks";
  try {
    if ((await request.fileSystem.inspect(tasksDirectory)).kind !== "directory") {
      return specFailure(
        "spec.missing",
        tasksDirectory,
        "The Managed Project Tasks directory is unavailable.",
        "Initialize or repair the Managed Project before inspecting impacted Context.",
      );
    }
    const impacts: SpecContextImpact[] = [];
    for (const entry of await request.fileSystem.listDirectory(tasksDirectory)) {
      if (entry.name === "archive") {
        continue;
      }
      if (entry.kind !== "directory") {
        return specFailure(
          "spec.io_failed",
          `${tasksDirectory}/${entry.name}`,
          "Managed Project Tasks contains an unsafe entry.",
          "Repair the Tasks directory before inspecting impacted Context.",
        );
      }
      const task = await readDurableTask({
        fileSystem: request.fileSystem,
        taskId: entry.name,
      });
      if (!task.ok) {
        const diagnostic = task.diagnostics[0];
        return specFailure(
          "spec.io_failed",
          diagnostic?.path ?? `${tasksDirectory}/${entry.name}`,
          diagnostic?.message ?? "Durable Task could not be inspected.",
          diagnostic?.remediation ?? "Repair the Task before inspecting impacted Context.",
        );
      }
      for (const phaseName of Object.keys(task.state.projection.contexts)) {
        const phase = phaseName as WorkflowPhase;
        const manifest = await inspectDurableContextManifest({
          fileSystem: request.fileSystem,
          taskId: task.state.projection.id,
          phase,
        });
        if (!manifest.ok) {
          const diagnostic = manifest.diagnostics[0];
          return specFailure(
            "spec.io_failed",
            diagnostic?.path ?? `${tasksDirectory}/${entry.name}`,
            diagnostic?.message ?? "Context Manifest could not be inspected.",
            diagnostic?.remediation ?? "Repair the Context Manifest before inspecting Spec impact.",
          );
        }
        if (
          manifest.entries.some(
            (context) =>
              context.source.type === "project-path" &&
              context.source.value === spec.path,
          )
        ) {
          impacts.push(
            Object.freeze({
              taskId: task.state.projection.id,
              phase,
              state: manifest.state,
            }),
          );
        }
      }
    }
    return Object.freeze({
      ok: true,
      contractVersion: SPEC_CONTRACT_VERSION,
      impacts: Object.freeze(
        impacts.sort(
          (left, right) =>
            left.taskId.localeCompare(right.taskId) ||
            left.phase.localeCompare(right.phase),
        ),
      ),
    });
  } catch {
    return specFailure(
      "spec.io_failed",
      tasksDirectory,
      "Impacted Context could not be inspected safely.",
      "Inspect the Project Store path and permissions, then retry.",
    );
  }
}


async function collectSpecPaths(
  fileSystem: SpecFileSystem,
  directory: string,
): Promise<string[]> {
  const paths: string[] = [];
  for (const entry of await fileSystem.listDirectory(directory)) {
    const path = `${directory}/${entry.name}`;
    if (entry.kind === "directory") {
      paths.push(...(await collectSpecPaths(fileSystem, path)));
    } else if (entry.kind === "file") {
      if (path.endsWith(".md")) {
        paths.push(path);
      }
    } else {
      throw new Error("Spec directory contains an unsafe entry.");
    }
  }
  return paths.sort((left, right) => left.localeCompare(right));
}

async function prepareSpecDirectories(
  fileSystem: SpecFileSystem,
  path: string,
  persist: boolean,
): Promise<SpecFailure | null> {
  const segments = path.split("/");
  let current = segments[0]!;
  for (const segment of segments.slice(1)) {
    current = `${current}/${segment}`;
    const entry = await fileSystem.inspect(current);
    if (entry.kind === "missing") {
      if (persist) {
        await fileSystem.createDirectory(current);
      }
    } else if (entry.kind !== "directory") {
      return specFailure(
        "spec.path.invalid",
        current,
        "Spec path contains a non-directory parent.",
        "Replace the unsafe parent with a directory before creating the Spec.",
      );
    }
  }
  return null;
}

function resolveSpecPath(path: string): Readonly<{ ok: true; path: string }> | SpecFailure {
  const relative = path.startsWith(`${SPEC_DIRECTORY}/`)
    ? path.slice(SPEC_DIRECTORY.length + 1)
    : path;
  if (
    !isRepositoryRelativePath(relative) ||
    !relative.endsWith(".md") ||
    relative === ".md"
  ) {
    return specFailure(
      "spec.path.invalid",
      path,
      "Spec path must be a non-empty repository-relative Markdown path.",
      "Use a path such as api.md or backend/api-guidelines.md.",
    );
  }
  return Object.freeze({ ok: true, path: `${SPEC_DIRECTORY}/${relative}` });
}

function specFailure(
  code: SpecDiagnostic["code"],
  path: string,
  message: string,
  remediation: string,
): SpecFailure {
  return Object.freeze({
    ok: false,
    contractVersion: SPEC_CONTRACT_VERSION,
    diagnostics: Object.freeze([
      Object.freeze({ code, path, message, remediation }),
    ]),
  });
}
