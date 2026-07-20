import { createHash } from "node:crypto";

import {
  RECORD_CONTRACT_VERSION,
  validateContractRecord,
  type InstalledProjectVersions,
  type ManagedFileRecord,
  type ProjectManifestRecord,
} from "./record-contracts.js";
import { hasUnambiguousManagedBlocks } from "./managed-blocks.js";
import {
  installedProjectVersionsForReleaseArtifacts,
  MANAGED_PROJECT_CONTRACT_VERSION,
  verifyCoordinatedReleaseArtifacts,
  type CoordinatedReleaseArtifacts,
} from "./release-artifacts.js";

export { MANAGED_PROJECT_CONTRACT_VERSION } from "./release-artifacts.js";

export const MANAGED_PROJECT_REQUIRED_DIRECTORIES = Object.freeze([
  ".sayhi",
  ".sayhi/spec",
  ".sayhi/tasks",
  ".sayhi/tasks/archive",
  ".sayhi/research",
  ".sayhi/workspace",
  ".sayhi/workflow",
  ".sayhi/overrides",
  ".sayhi/.runtime",
] as const);

const PROJECT_MANIFEST_PATH = ".sayhi/manifest.json";
const OWNERSHIP_MANIFEST_PATH = ".sayhi/managed-files.json";
export const MANAGED_PROJECT_CONFIG_PATH = ".sayhi/config.yaml";
export const MANAGED_PROJECT_RUNTIME_IGNORE_PATH = ".sayhi/.gitignore";
export const MANAGED_PROJECT_CONFIG_CONTENT = "schemaVersion: 1\n";
export const MANAGED_PROJECT_RUNTIME_IGNORE_CONTENT =
  "# SayHi local runtime state\n/.runtime/\n";

export type ManagedProjectState =
  | "healthy"
  | "missing"
  | "incompatible"
  | "corrupt";

export type ManagedProjectPathKind =
  | "missing"
  | "file"
  | "directory"
  | "symlink"
  | "other";

export interface ManagedProjectFileSystem {
  inspect(path: string): Promise<Readonly<{ kind: ManagedProjectPathKind }>>;
  readFile(path: string): Promise<string>;
  createDirectory(path: string): Promise<void>;
  /** Atomically replaces the managed file with UTF-8 content. */
  writeFile(path: string, content: string): Promise<void>;
}

export type ManagedProjectDiagnosticCode =
  | "managed_project.missing"
  | "managed_project.incompatible"
  | "managed_project.corrupt"
  | "managed_project.path_unsafe"
  | "managed_project.file_missing"
  | "managed_project.skill_bundle_invalid"
  | "managed_project.release_artifacts_invalid"
  | "managed_project.file_modified"
  | "managed_project.io_failed";

export interface ManagedProjectDiagnostic {
  readonly code: ManagedProjectDiagnosticCode;
  readonly path: string;
  readonly message: string;
  readonly remediation: string;
}

export interface DiagnoseManagedProjectRequest {
  readonly fileSystem: ManagedProjectFileSystem;
  readonly releaseArtifacts: CoordinatedReleaseArtifacts;
}

type ManagedProjectFailure<
  State extends Exclude<ManagedProjectState, "healthy">,
> = Readonly<{
  ok: false;
  contractVersion: typeof MANAGED_PROJECT_CONTRACT_VERSION;
  state: State;
  diagnostics: readonly ManagedProjectDiagnostic[];
}>;

export type DiagnoseManagedProjectResult =
  | Readonly<{
      ok: true;
      contractVersion: typeof MANAGED_PROJECT_CONTRACT_VERSION;
      state: "healthy";
      diagnostics: readonly [];
    }>
  | ManagedProjectFailure<Exclude<ManagedProjectState, "healthy">>;

export interface InitializeManagedProjectRequest
  extends DiagnoseManagedProjectRequest {
  readonly projectId: string;
  readonly timestamp: string;
}

export type InitializeManagedProjectResult =
  | Readonly<{
      ok: true;
      contractVersion: typeof MANAGED_PROJECT_CONTRACT_VERSION;
      state: "healthy";
      created: boolean;
      paths: readonly string[];
      diagnostics: readonly [];
    }>
  | ManagedProjectFailure<Exclude<ManagedProjectState, "healthy">>;

interface OwnershipManifest {
  readonly schemaVersion: 1;
  readonly files: readonly ManagedFileRecord[];
}

type VerifiedReleaseInstallation =
  | Readonly<{ ok: true; installation: InstalledProjectVersions }>
  | Readonly<{ ok: false; failure: ManagedProjectFailure<"corrupt"> }>;

export async function initializeManagedProject(
  request: InitializeManagedProjectRequest,
): Promise<InitializeManagedProjectResult> {
  const release = verifiedReleaseInstallation(request);
  if (!release.ok) {
    return initializationFailure(release.failure);
  }
  try {
    const store = await request.fileSystem.inspect(".sayhi");
    if (store.kind === "directory") {
      const diagnosis = await diagnoseManagedProject(request);
      if (diagnosis.ok) {
        return Object.freeze({
          ...diagnosis,
          created: false,
          paths: Object.freeze([]),
        });
      }
      if (diagnosis.state !== "missing") {
        return initializationFailure(diagnosis);
      }
    } else if (store.kind !== "missing") {
      return initializationFailure(
        corrupt(
          "managed_project.path_unsafe",
          ".sayhi",
          "The Project Store path is not a real directory.",
          "Replace the file, symlink, or special entry with a directory owned by this repository.",
        ),
      );
    }

    const generated = buildGeneratedProject(request, release.installation);
    if (!generated.ok) {
      return initializationFailure(generated);
    }

    const paths: string[] = [];
    for (const path of MANAGED_PROJECT_REQUIRED_DIRECTORIES) {
      const entry = await request.fileSystem.inspect(path);
      if (entry.kind === "missing") {
        await request.fileSystem.createDirectory(path);
        paths.push(path);
      } else if (entry.kind !== "directory") {
        return initializationFailure(invalidRequiredDirectory(path, entry.kind));
      }
    }
    for (const [path, content] of generated.files) {
      const entry = await request.fileSystem.inspect(path);
      if (entry.kind === "missing") {
        await request.fileSystem.writeFile(path, content);
        paths.push(path);
        continue;
      }
      if (entry.kind !== "file") {
        return initializationFailure(invalidRequiredFile(path, entry.kind));
      }
      if (path === MANAGED_PROJECT_CONFIG_PATH) {
        continue;
      }
      if ((await request.fileSystem.readFile(path)) !== content) {
        return initializationFailure(
          corrupt(
            "managed_project.file_modified",
            path,
            "An existing generated Project Store file differs from the installation content.",
            "Preserve the existing file and resolve it before initializing SayHi again.",
          ),
        );
      }
    }

    const diagnosis = await diagnoseManagedProject(request);
    if (!diagnosis.ok) {
      return initializationFailure(diagnosis);
    }
    return Object.freeze({
      ...diagnosis,
      created: true,
      paths: Object.freeze(paths),
    });
  } catch {
    return initializationFailure(
      corrupt(
        "managed_project.io_failed",
        ".sayhi",
        "The Project Store could not be initialized through the filesystem adapter.",
        "Check repository permissions and path safety, then retry initialization.",
      ),
    );
  }
}

export async function diagnoseManagedProject(
  request: DiagnoseManagedProjectRequest,
): Promise<DiagnoseManagedProjectResult> {
  const release = verifiedReleaseInstallation(request);
  if (!release.ok) {
    return release.failure;
  }
  const installation = release.installation;
  try {
    const store = await request.fileSystem.inspect(".sayhi");
    if (store.kind === "missing") {
      return failure(
        "missing",
        diagnostic(
          "managed_project.missing",
          ".sayhi",
          "This repository does not contain a SayHi Project Store.",
          "Run sayhi init for this repository.",
        ),
      );
    }
    if (store.kind !== "directory") {
      return corrupt(
        "managed_project.path_unsafe",
        ".sayhi",
        "The Project Store path is not a real directory.",
        "Replace the file, symlink, or special entry with a directory owned by this repository.",
      );
    }

    const manifestEntry = await request.fileSystem.inspect(PROJECT_MANIFEST_PATH);
    if (manifestEntry.kind === "missing") {
      const ownershipEntry = await request.fileSystem.inspect(
        OWNERSHIP_MANIFEST_PATH,
      );
      if (ownershipEntry.kind === "missing") {
        return failure(
          "missing",
          diagnostic(
            "managed_project.missing",
            PROJECT_MANIFEST_PATH,
            "This repository does not contain an installed SayHi Project Store.",
            "Run sayhi init for this repository.",
          ),
        );
      }
    }
    if (manifestEntry.kind !== "file") {
      return invalidRequiredFile(PROJECT_MANIFEST_PATH, manifestEntry.kind);
    }
    const manifestJson = parseJson(
      await request.fileSystem.readFile(PROJECT_MANIFEST_PATH),
    );
    if (manifestJson === INVALID_JSON) {
      return corrupt(
        "managed_project.corrupt",
        PROJECT_MANIFEST_PATH,
        "The project manifest is not valid JSON.",
        "Restore the manifest from version control or reinitialize an empty Project Store.",
      );
    }
    const manifestValidation = validateContractRecord({
      contractVersion: RECORD_CONTRACT_VERSION,
      kind: "projectManifest",
      record: manifestJson,
    });
    if (!manifestValidation.ok) {
      const unsupportedSchema = manifestValidation.diagnostics.some(
        ({ code }) => code === "record_contract.schema_version.unsupported",
      );
      return unsupportedSchema
        ? incompatible(PROJECT_MANIFEST_PATH)
        : corrupt(
            "managed_project.corrupt",
            PROJECT_MANIFEST_PATH,
            "The project manifest does not satisfy the SayHi manifest contract.",
            "Restore a valid manifest from version control or reinitialize an empty Project Store.",
          );
    }
    const manifest = manifestValidation.record as ProjectManifestRecord;
    if (!sameInstallation(manifest.installed, installation)) {
      return incompatible(PROJECT_MANIFEST_PATH);
    }
    if (manifest.ownershipManifest !== OWNERSHIP_MANIFEST_PATH) {
      return corrupt(
        "managed_project.path_unsafe",
        `${PROJECT_MANIFEST_PATH}#ownershipManifest`,
        "The manifest points outside the installed ownership manifest location.",
        `Set ownershipManifest to ${OWNERSHIP_MANIFEST_PATH}.`,
      );
    }

    for (const path of MANAGED_PROJECT_REQUIRED_DIRECTORIES) {
      const entry = await request.fileSystem.inspect(path);
      if (entry.kind !== "directory") {
        return invalidRequiredDirectory(path, entry.kind);
      }
    }

    const ownershipEntry = await request.fileSystem.inspect(
      OWNERSHIP_MANIFEST_PATH,
    );
    if (ownershipEntry.kind !== "file") {
      return invalidRequiredFile(OWNERSHIP_MANIFEST_PATH, ownershipEntry.kind);
    }
    const ownershipJson = parseJson(
      await request.fileSystem.readFile(OWNERSHIP_MANIFEST_PATH),
    );
    if (!isOwnershipManifest(ownershipJson)) {
      return corrupt(
        "managed_project.corrupt",
        OWNERSHIP_MANIFEST_PATH,
        "The managed-file ownership manifest is malformed.",
        "Restore the ownership manifest from version control or reinitialize an empty Project Store.",
      );
    }

    const recordedPaths = new Set<string>();
    for (const record of ownershipJson.files) {
      const validation = validateContractRecord({
        contractVersion: RECORD_CONTRACT_VERSION,
        kind: "managedFile",
        record,
      });
      if (!validation.ok || !record.path.startsWith(".sayhi/")) {
        return corrupt(
          "managed_project.corrupt",
          OWNERSHIP_MANIFEST_PATH,
          "The ownership manifest contains an invalid managed-file record.",
          "Restore records with repository-owned paths and valid ownership metadata.",
        );
      }
      if (recordedPaths.has(record.path)) {
        return corrupt(
          "managed_project.corrupt",
          OWNERSHIP_MANIFEST_PATH,
          `The ownership manifest records ${record.path} more than once.`,
          "Keep exactly one ownership record for each managed path.",
        );
      }
      recordedPaths.add(record.path);

      const entry = await request.fileSystem.inspect(record.path);
      if (entry.kind !== "file") {
        return invalidRequiredFile(record.path, entry.kind);
      }
      if (record.ownershipClass === "engine-owned") {
        const content = await request.fileSystem.readFile(record.path);
        const expected = record.installedBaseIdentity;
        if (
          expected === undefined ||
          expected.algorithm !== "sha256-lf-v1" ||
          expected.digest.toLowerCase() !== hashLf(content)
        ) {
          return corrupt(
            "managed_project.file_modified",
            record.path,
            "An Engine-owned managed file differs from its installed base identity.",
            "Restore the installed content or create a conflict-aware update plan.",
          );
        }
      } else if (
        record.ownershipClass === "managed-customizable" &&
        record.markerIds.length > 0
      ) {
        const content = await request.fileSystem.readFile(record.path);
        if (!hasUnambiguousManagedBlocks(content, record.markerIds)) {
          return corrupt(
            "managed_project.file_modified",
            record.path,
            "A Managed-customizable file has missing, duplicated, or overlapping Managed Blocks.",
            "Restore unambiguous Managed Block markers or resolve the file through an update plan.",
          );
        }
      }
    }

    for (const path of [MANAGED_PROJECT_CONFIG_PATH, MANAGED_PROJECT_RUNTIME_IGNORE_PATH]) {
      if (!recordedPaths.has(path)) {
        return corrupt(
          "managed_project.corrupt",
          OWNERSHIP_MANIFEST_PATH,
          `The ownership manifest does not record ${path}.`,
          `Add a valid ownership record for ${path}.`,
        );
      }
    }

    return healthyDiagnosis();
  } catch {
    return corrupt(
      "managed_project.io_failed",
      ".sayhi",
      "The Project Store could not be read through the filesystem adapter.",
      "Check repository permissions and path safety, then run sayhi doctor again.",
    );
  }
}

function buildGeneratedProject(
  request: InitializeManagedProjectRequest,
  installation: InstalledProjectVersions,
):
  | Readonly<{ ok: true; files: ReadonlyMap<string, string> }>
  | ManagedProjectFailure<"corrupt"> {
  const managedFiles: readonly ManagedFileRecord[] = Object.freeze([
    Object.freeze({
      schemaVersion: 1,
      path: MANAGED_PROJECT_CONFIG_PATH,
      ownershipClass: "user-owned",
      generatedSourceVersion: installation.templates,
      markerIds: Object.freeze([]),
    }),
    Object.freeze({
      schemaVersion: 1,
      path: MANAGED_PROJECT_RUNTIME_IGNORE_PATH,
      ownershipClass: "engine-owned",
      installedBaseIdentity: Object.freeze({
        algorithm: "sha256-lf-v1",
        digest: hashLf(MANAGED_PROJECT_RUNTIME_IGNORE_CONTENT),
      }),
      generatedSourceVersion: installation.templates,
      markerIds: Object.freeze([]),
    }),
  ]);
  const ownershipManifest: OwnershipManifest = Object.freeze({
    schemaVersion: 1,
    files: managedFiles,
  });
  const manifest: ProjectManifestRecord = Object.freeze({
    schemaVersion: 1,
    projectId: request.projectId,
    installed: installation,
    initializedAt: request.timestamp,
    updatedAt: request.timestamp,
    ownershipManifest: OWNERSHIP_MANIFEST_PATH,
  });
  const validation = validateContractRecord({
    contractVersion: RECORD_CONTRACT_VERSION,
    kind: "projectManifest",
    record: manifest,
  });
  if (!validation.ok) {
    return corrupt(
      "managed_project.corrupt",
      PROJECT_MANIFEST_PATH,
      "Initialization inputs cannot produce a valid project manifest.",
      "Provide a non-empty project ID, a UTC timestamp, and valid installed versions.",
    );
  }

  return Object.freeze({
    ok: true,
    files: new Map([
      [MANAGED_PROJECT_CONFIG_PATH, MANAGED_PROJECT_CONFIG_CONTENT],
      [MANAGED_PROJECT_RUNTIME_IGNORE_PATH, MANAGED_PROJECT_RUNTIME_IGNORE_CONTENT],
      [OWNERSHIP_MANIFEST_PATH, prettyJson(ownershipManifest)],
      [PROJECT_MANIFEST_PATH, prettyJson(manifest)],
    ]),
  });
}

function sameInstallation(
  actual: InstalledProjectVersions,
  expected: InstalledProjectVersions,
): boolean {
  return (
    actual.core === expected.core &&
    actual.cli === expected.cli &&
    actual.ompPlugin === expected.ompPlugin &&
    actual.projectSchema === expected.projectSchema &&
    actual.templates === expected.templates &&
    actual.skillLockDigest.toLowerCase() ===
      expected.skillLockDigest.toLowerCase()
  );
}

function verifiedReleaseInstallation(
  request: DiagnoseManagedProjectRequest,
): VerifiedReleaseInstallation {
  const verification = verifyCoordinatedReleaseArtifacts(request.releaseArtifacts);
  if (!verification.ok) {
    const diagnostic = verification.diagnostics[0]!;
    const code =
      diagnostic.code === "release_artifacts.skill_bundle_invalid"
        ? "managed_project.skill_bundle_invalid"
        : "managed_project.release_artifacts_invalid";
    return Object.freeze({
      ok: false,
      failure: corrupt(
        code,
        `${PROJECT_MANIFEST_PATH}#installed.skillLockDigest`,
        diagnostic.message,
        diagnostic.remediation,
      ),
    });
  }
  return Object.freeze({
    ok: true,
    installation: installedProjectVersionsForReleaseArtifacts(
      verification.releaseArtifacts,
    ),
  });
}

function isOwnershipManifest(value: unknown): value is OwnershipManifest {
  return (
    typeof value === "object" &&
    value !== null &&
    !Array.isArray(value) &&
    (value as { schemaVersion?: unknown }).schemaVersion === 1 &&
    Array.isArray((value as { files?: unknown }).files)
  );
}

function invalidRequiredDirectory(
  path: string,
  kind: ManagedProjectPathKind,
): ManagedProjectFailure<"corrupt"> {
  return corrupt(
    kind === "symlink"
      ? "managed_project.path_unsafe"
      : "managed_project.file_missing",
    path,
    `Required Project Store directory ${path} is ${kind}.`,
    `Restore ${path} as a real directory inside the repository.`,
  );
}

function invalidRequiredFile(
  path: string,
  kind: ManagedProjectPathKind,
): ManagedProjectFailure<"corrupt"> {
  return corrupt(
    kind === "symlink"
      ? "managed_project.path_unsafe"
      : "managed_project.file_missing",
    path,
    `Required Project Store file ${path} is ${kind}.`,
    `Restore ${path} as a regular file from version control.`,
  );
}

function incompatible(path: string): ManagedProjectFailure<"incompatible"> {
  return failure(
    "incompatible",
    diagnostic(
      "managed_project.incompatible",
      path,
      "The installed Project Store schema or component versions are incompatible with this SayHi installation.",
      "Use a compatible SayHi release or a future sayhi migrate plan.",
    ),
  );
}

function corrupt(
  code: ManagedProjectDiagnosticCode,
  path: string,
  message: string,
  remediation: string,
): ManagedProjectFailure<"corrupt"> {
  return failure("corrupt", diagnostic(code, path, message, remediation));
}

function failure<State extends Exclude<ManagedProjectState, "healthy">>(
  state: State,
  item: ManagedProjectDiagnostic,
): ManagedProjectFailure<State> {
  return Object.freeze({
    ok: false,
    contractVersion: MANAGED_PROJECT_CONTRACT_VERSION,
    state,
    diagnostics: Object.freeze([item]),
  });
}

function healthyDiagnosis(): Extract<DiagnoseManagedProjectResult, { ok: true }> {
  return Object.freeze({
    ok: true,
    contractVersion: MANAGED_PROJECT_CONTRACT_VERSION,
    state: "healthy",
    diagnostics: Object.freeze([]) as readonly [],
  });
}

function diagnostic(
  code: ManagedProjectDiagnosticCode,
  path: string,
  message: string,
  remediation: string,
): ManagedProjectDiagnostic {
  return Object.freeze({ code, path, message, remediation });
}

function initializationFailure(
  diagnosis: ManagedProjectFailure<Exclude<ManagedProjectState, "healthy">>,
): InitializeManagedProjectResult {
  return diagnosis;
}

const INVALID_JSON = Symbol("invalid-json");

function parseJson(source: string): unknown | typeof INVALID_JSON {
  try {
    return JSON.parse(source) as unknown;
  } catch {
    return INVALID_JSON;
  }
}

function hashLf(content: string): string {
  return createHash("sha256")
    .update(content.replaceAll("\r\n", "\n").replaceAll("\r", "\n"), "utf8")
    .digest("hex");
}

function prettyJson(value: unknown): string {
  return `${JSON.stringify(value, null, 2)}\n`;
}
