import { contentMatchesIdentity } from "./context-manifest.js";
import {
  RECORD_CONTRACT_VERSION,
  validateContractRecord,
  type InstalledProjectVersions,
  type LockedSkill,
  type SkillLockFile,
  type SkillLockRecord,
} from "./record-contracts.js";
import {
  canonicalRepositoryRelativePath,
  isRepositoryRelativePath,
} from "./repository-path.js";
import type { ContractIdentity } from "./identity.js";
import type { ContentHash } from "./validation.js";

export const SKILL_BUNDLE_CONTRACT_VERSION = 1 as const;

export interface SkillBundleFile {
  readonly path: string;
  readonly content: string | Uint8Array;
}

export interface SkillBundle {
  readonly lock: unknown;
  readonly files: readonly SkillBundleFile[];
}

export type SkillBundleDiagnosticCode =
  | "skill_bundle.request_invalid"
  | "skill_bundle.lock_invalid"
  | "skill_bundle.skill_entry_missing"
  | "skill_bundle.file_invalid"
  | "skill_bundle.file_duplicate"
  | "skill_bundle.file_missing"
  | "skill_bundle.file_modified"
  | "skill_bundle.file_unexpected"
  | "skill_bundle.installation_mismatch";

export interface SkillBundleDiagnostic {
  readonly code: SkillBundleDiagnosticCode;
  readonly path: string;
  readonly message: string;
  readonly remediation: string;
}

export interface VerifiedSkillBundleSkill {
  readonly name: string;
  readonly skillFile: Readonly<{
    readonly path: string;
    readonly identity: ContentHash;
    readonly content: string | Uint8Array;
  }>;
}

export type VerifySkillBundleResult =
  | Readonly<{
      ok: true;
      contractVersion: typeof SKILL_BUNDLE_CONTRACT_VERSION;
      lock: SkillLockRecord;
      lockIdentity: ContractIdentity;
      skills: readonly VerifiedSkillBundleSkill[];
    }>
  | Readonly<{
      ok: false;
      contractVersion: typeof SKILL_BUNDLE_CONTRACT_VERSION;
      diagnostics: readonly SkillBundleDiagnostic[];
    }>;

export interface VerifySkillBundleInstallationRequest {
  readonly bundle: unknown;
  readonly installation: InstalledProjectVersions;
}

export type VerifySkillBundleInstallationResult =
  | Readonly<{
      ok: true;
      contractVersion: typeof SKILL_BUNDLE_CONTRACT_VERSION;
      lockIdentity: ContractIdentity;
    }>
  | Readonly<{
      ok: false;
      contractVersion: typeof SKILL_BUNDLE_CONTRACT_VERSION;
      diagnostics: readonly SkillBundleDiagnostic[];
    }>;

export function verifySkillBundle(bundle: unknown): VerifySkillBundleResult {
  try {
    if (!isRecord(bundle) || !Array.isArray(bundle.files)) {
      return failure(
        "skill_bundle.request_invalid",
        "$",
        "Skill Bundle must contain a lock and complete file list.",
        "Provide the release Skill Lock and every bundled file as plain data.",
      );
    }

    const validation = validateContractRecord({
      contractVersion: RECORD_CONTRACT_VERSION,
      kind: "skillLock",
      record: bundle.lock,
    });
    if (!validation.ok) {
      const diagnostic = validation.diagnostics[0]!;
      return failure(
        "skill_bundle.lock_invalid",
        `$.lock${diagnostic.path.slice("$.record".length)}`,
        "Skill Bundle Lock does not satisfy the durable Skill Lock contract.",
        diagnostic.remediation,
      );
    }

    const lock = validation.record as SkillLockRecord;
    const expected = expectedFiles(lock);
    if (!expected.ok) {
      return expected;
    }

    const actual = actualFiles(bundle.files);
    if (!actual.ok) {
      return actual;
    }

    for (const [path, expectedFile] of expected.files) {
      const file = actual.files.get(path);
      if (file === undefined) {
        return failure(
          "skill_bundle.file_missing",
          "$.files",
          `Locked Skill file ${path} is missing from the release bundle.`,
          "Restore every file recorded by the release Skill Lock before installation or Task resume.",
        );
      }
      if (!contentMatchesIdentity(file.content, expectedFile.identity)) {
        return failure(
          "skill_bundle.file_modified",
          `$.files[${file.index}].content`,
          `Locked Skill file ${path} does not match its content identity.`,
          "Restore the exact locked Skill bytes before installation or Task resume.",
        );
      }
    }

    for (const [path, file] of actual.files) {
      if (!expected.files.has(path)) {
        return failure(
          "skill_bundle.file_unexpected",
          `$.files[${file.index}].path`,
          `Release bundle contains unexpected Skill file ${path}.`,
          "Remove files not recorded by the release Skill Lock.",
        );
      }
    }

    const skills = expected.skills.map((skill) => {
      const file = actual.files.get(skill.skillFile.path)!;
      return Object.freeze({
        name: skill.name,
        skillFile: Object.freeze({
          path: skill.skillFile.path,
          identity: Object.freeze({ ...skill.skillFile.identity }),
          content: file.content,
        }),
      });
    });
    return Object.freeze({
      ok: true,
      contractVersion: SKILL_BUNDLE_CONTRACT_VERSION,
      lock,
      lockIdentity: validation.identity,
      skills: Object.freeze(skills),
    });
  } catch {
    return failure(
      "skill_bundle.request_invalid",
      "$",
      "Skill Bundle could not be read safely.",
      "Provide plain release lock and file data without accessors or cycles.",
    );
  }
}

export function verifySkillBundleInstallation(
  request: unknown,
): VerifySkillBundleInstallationResult {
  try {
    if (!isRecord(request)) {
      return failure(
        "skill_bundle.request_invalid",
        "$",
        "Skill Bundle installation verification must be a readable object.",
        "Provide the release installation identity and complete Skill Bundle.",
      );
    }
    const verified = verifySkillBundle(request.bundle);
    if (!verified.ok) {
      return verified;
    }
    if (
      !isRecord(request.installation) ||
      typeof request.installation.skillLockDigest !== "string" ||
      request.installation.skillLockDigest.toLowerCase() !== verified.lockIdentity
    ) {
      return failure(
        "skill_bundle.installation_mismatch",
        "$.installation.skillLockDigest",
        "Installed Skill Lock identity does not match the verified release bundle.",
        "Install the release bundle that matches the Project Manifest or run an approved update.",
      );
    }
    return Object.freeze({
      ok: true,
      contractVersion: SKILL_BUNDLE_CONTRACT_VERSION,
      lockIdentity: verified.lockIdentity,
    });
  } catch {
    return failure(
      "skill_bundle.request_invalid",
      "$",
      "Skill Bundle installation verification could not be read safely.",
      "Provide plain release installation and Skill Bundle data without accessors or cycles.",
    );
  }
}

type ExpectedFile = Readonly<{
  identity: ContentHash;
}>;
type ExpectedSkill = Readonly<{
  name: string;
  skillFile: Readonly<{
    path: string;
    identity: ContentHash;
  }>;
}>;
type ExpectedFilesResult =
  | Readonly<{
      ok: true;
      files: ReadonlyMap<string, ExpectedFile>;
      skills: readonly ExpectedSkill[];
    }>
  | Extract<VerifySkillBundleResult, { ok: false }>;

function expectedFiles(lock: SkillLockRecord): ExpectedFilesResult {
  const files = new Map<string, ExpectedFile>();
  const skills: ExpectedSkill[] = [];
  for (let skillIndex = 0; skillIndex < lock.skills.length; skillIndex += 1) {
    const skill = lock.skills[skillIndex]!;
    const skillFiles = expectedSkillFiles(skill, skillIndex, files);
    if (!skillFiles.ok) {
      return skillFiles;
    }
    skills.push(skillFiles.skill);
  }
  return Object.freeze({ ok: true, files, skills: Object.freeze(skills) });
}

function expectedSkillFiles(
  skill: LockedSkill,
  skillIndex: number,
  files: Map<string, ExpectedFile>,
):
  | Readonly<{ ok: true; skill: ExpectedSkill }>
  | Extract<VerifySkillBundleResult, { ok: false }> {
  let skillFile: Readonly<{ path: string; identity: ContentHash }> | null = null;
  for (const file of skill.files) {
    const path = joinedFilePath(skill.path, file);
    if (path === null) {
      return failure(
        "skill_bundle.lock_invalid",
        `$.lock.skills[${skillIndex}]`,
        "Skill Bundle Lock contains a non-canonical bundled file path.",
        "Use normalized repository-relative Skill and file paths.",
      );
    }
    if (files.has(path)) {
      return failure(
        "skill_bundle.lock_invalid",
        `$.lock.skills[${skillIndex}].files`,
        `Skill Bundle Lock assigns ${path} to more than one Skill.`,
        "Keep each released Skill file in exactly one locked Skill entry.",
      );
    }
    const identity = Object.freeze({ ...file.sha256 });
    files.set(path, Object.freeze({ identity }));
    if (file.path === "SKILL.md") {
      skillFile = Object.freeze({ path, identity });
    }
  }
  if (skillFile === null) {
    return failure(
      "skill_bundle.skill_entry_missing",
      `$.lock.skills[${skillIndex}].files`,
      `Locked Skill ${skill.name} has no SKILL.md entry point.`,
      "Record the Skill entry point and its content identity in the release Skill Lock.",
    );
  }
  return Object.freeze({
    ok: true,
    skill: Object.freeze({ name: skill.name, skillFile }),
  });
}

function actualFiles(
  candidates: readonly unknown[],
):
  | Readonly<{
      ok: true;
      files: ReadonlyMap<
        string,
        Readonly<{ index: number; content: string | Uint8Array }>
      >;
    }>
  | Extract<VerifySkillBundleResult, { ok: false }> {
  const files = new Map<
    string,
    Readonly<{ index: number; content: string | Uint8Array }>
  >();
  for (let index = 0; index < candidates.length; index += 1) {
    const candidate = candidates[index];
    if (!isRecord(candidate) || !isCanonicalRelativePath(candidate.path)) {
      return failure(
        "skill_bundle.file_invalid",
        `$.files[${index}].path`,
        "Skill Bundle file path must be a normalized repository-relative path.",
        "Provide a non-empty slash-separated path without dot segments or traversal.",
      );
    }
    if (
      typeof candidate.content !== "string" &&
      !(candidate.content instanceof Uint8Array)
    ) {
      return failure(
        "skill_bundle.file_invalid",
        `$.files[${index}].content`,
        "Skill Bundle file content must be text or exact bytes.",
        "Provide the packaged file content as a string or Uint8Array.",
      );
    }
    if (files.has(candidate.path)) {
      return failure(
        "skill_bundle.file_duplicate",
        `$.files[${index}].path`,
        `Skill Bundle contains ${candidate.path} more than once.`,
        "Provide each packaged Skill file exactly once.",
      );
    }
    files.set(
      candidate.path,
      Object.freeze({ index, content: candidate.content }),
    );
  }
  return Object.freeze({ ok: true, files });
}

function joinedFilePath(skillPath: string, file: SkillLockFile): string | null {
  const path = `${skillPath}/${file.path}`;
  return isCanonicalRelativePath(path) ? path : null;
}

function isCanonicalRelativePath(value: unknown): value is string {
  return (
    isRepositoryRelativePath(value) && canonicalRepositoryRelativePath(value) === value
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function failure(
  code: SkillBundleDiagnosticCode,
  path: string,
  message: string,
  remediation: string,
): Extract<VerifySkillBundleResult, { ok: false }> {
  return Object.freeze({
    ok: false,
    contractVersion: SKILL_BUNDLE_CONTRACT_VERSION,
    diagnostics: Object.freeze([
      Object.freeze({ code, path, message, remediation }),
    ]),
  });
}
