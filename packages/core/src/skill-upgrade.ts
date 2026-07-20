import {
  isContractIdentity,
  type ContractIdentity,
} from "./identity.js";
import type { LockedSkill, SkillLockFile, SkillLockRecord } from "./record-contracts.js";
import { verifySkillBundle } from "./skill-bundle.js";
import type { ContentHash } from "./validation.js";
import { isPhaseAgentRole, type PhaseAgentRole } from "./execution.js";

export const SKILL_UPGRADE_PROPOSAL_CONTRACT_VERSION = 1 as const;

export interface SkillUpgradeCapability {
  readonly agentRole: PhaseAgentRole;
  readonly agentContractIdentity: ContractIdentity;
  readonly skillName: string;
}

export interface SkillUpgradeTest {
  readonly skillName: string;
  readonly path: string;
}

export interface SkillUpgradeSidecarConstraint {
  readonly skillName: string;
  readonly compatibleSidecarIdentities: readonly ContractIdentity[];
}

export interface ProposeSkillUpgradesRequest {
  readonly lockedBundle: unknown;
  readonly availableBundle: unknown;
  readonly capabilities: readonly SkillUpgradeCapability[];
  readonly tests?: readonly SkillUpgradeTest[];
  readonly sidecarConstraints: readonly SkillUpgradeSidecarConstraint[];
}

export interface SkillUpgradeBundleIdentity {
  readonly registry: Readonly<{
    readonly repository: string;
    readonly commit: string;
  }>;
  readonly identity: ContractIdentity;
}

export interface SkillUpgradeFileIdentity {
  readonly path: string;
  readonly identity: ContentHash;
}

export interface SkillUpgradeSkill {
  readonly name: string;
  readonly path: string;
  readonly files: readonly SkillUpgradeFileIdentity[];
  readonly upstream: Readonly<{
    readonly repository: string;
    readonly commit: string;
    readonly path: string;
    readonly license: string;
  }>;
  readonly sidecarIdentity: ContractIdentity;
}

export type SkillUpgradeChangeKind = "added" | "removed" | "changed";
export type SkillUpgradeFileChangeKind = SkillUpgradeChangeKind | "renamed";

export interface SkillUpgradeFileText {
  readonly before: string | null;
  readonly after: string | null;
}

export interface SkillUpgradeFileChange {
  readonly kind: SkillUpgradeFileChangeKind;
  readonly path: string;
  readonly previousPath?: string;
  readonly before?: ContentHash;
  readonly after?: ContentHash;
  /** Normalized LF text for human review; null when the file is byte-only. */
  readonly text: SkillUpgradeFileText;
}

export interface SkillUpgradeSemanticComparison {
  readonly frontmatter: Readonly<{
    readonly before: string | null;
    readonly after: string | null;
    readonly changed: boolean;
  }>;
  readonly invocation: Readonly<{
    readonly before: readonly string[];
    readonly after: readonly string[];
    readonly changed: boolean;
  }>;
  readonly crossSkillReferences: Readonly<{
    readonly added: readonly string[];
    readonly removed: readonly string[];
  }>;
}

export interface SkillUpgradeLicenseNotice {
  readonly before: string | null;
  readonly after: string | null;
  readonly changed: boolean;
  readonly noticeChanged: boolean;
  /** The Skill Lock contains licenses, not notice text; a change requires inventory review. */
  readonly noticeReviewRequired: boolean;
}

export interface SkillUpgradeChange {
  readonly kind: SkillUpgradeChangeKind;
  readonly name: string;
  readonly before?: SkillUpgradeSkill;
  readonly after?: SkillUpgradeSkill;
  readonly files: readonly SkillUpgradeFileChange[];
  readonly semantic: SkillUpgradeSemanticComparison;
  readonly licenseNotice: SkillUpgradeLicenseNotice;
}

export interface SkillUpgradeReleaseImpact {
  readonly kind: "none" | "new-release";
  readonly reason: string;
}

export type SkillUpgradeCompatibilityFailureCode =
  | "skill_upgrade.registry_repository_changed"
  | "skill_upgrade.locked_skill_removed"
  | "skill_upgrade.sidecar_incompatible";

export interface SkillUpgradeCompatibilityFailure {
  readonly code: SkillUpgradeCompatibilityFailureCode;
  readonly skillName?: string;
  readonly message: string;
  readonly remediation: string;
}

export interface SkillUpgradeCompatibility {
  readonly compatible: boolean;
  readonly failures: readonly SkillUpgradeCompatibilityFailure[];
}

export interface SkillUpgradeProposal {
  readonly contractVersion: typeof SKILL_UPGRADE_PROPOSAL_CONTRACT_VERSION;
  readonly locked: SkillUpgradeBundleIdentity;
  readonly available: SkillUpgradeBundleIdentity;
  readonly changes: readonly SkillUpgradeChange[];
  readonly affectedCapabilities: readonly SkillUpgradeCapability[];
  readonly affectedTests: readonly SkillUpgradeTest[];
  readonly requiredSayHiVersion: SkillUpgradeReleaseImpact;
  readonly compatibility: SkillUpgradeCompatibility;
}

export type SkillUpgradeProposalDiagnosticCode =
  | "skill_upgrade.request_invalid"
  | "skill_upgrade.locked_bundle_invalid"
  | "skill_upgrade.available_bundle_invalid"
  | "skill_upgrade.capability_invalid"
  | "skill_upgrade.test_invalid"
  | "skill_upgrade.sidecar_constraint_invalid";

export interface SkillUpgradeProposalDiagnostic {
  readonly code: SkillUpgradeProposalDiagnosticCode;
  readonly path: string;
  readonly message: string;
  readonly remediation: string;
}

export type ProposeSkillUpgradesResult =
  | Readonly<{
      ok: true;
      contractVersion: typeof SKILL_UPGRADE_PROPOSAL_CONTRACT_VERSION;
      proposal: SkillUpgradeProposal;
    }>
  | Readonly<{
      ok: false;
      contractVersion: typeof SKILL_UPGRADE_PROPOSAL_CONTRACT_VERSION;
      diagnostics: readonly SkillUpgradeProposalDiagnostic[];
    }>;

export function proposeSkillUpgrades(request: unknown): ProposeSkillUpgradesResult {
  try {
    if (
      !isRecord(request) ||
      !Array.isArray(request.capabilities) ||
      !Array.isArray(request.sidecarConstraints) ||
      (request.tests !== undefined && !Array.isArray(request.tests))
    ) {
      return failure(
        "skill_upgrade.request_invalid",
        "$",
        "Skill upgrade proposal must contain two bundles, capabilities, optional tests, and sidecar constraints.",
        "Provide complete release and candidate bundles with declared Phase Agent Skill capabilities.",
      );
    }

    const locked = verifySkillBundle(request.lockedBundle);
    if (!locked.ok) {
      const diagnostic = locked.diagnostics[0]!;
      return failure(
        "skill_upgrade.locked_bundle_invalid",
        "$.lockedBundle",
        diagnostic.message,
        diagnostic.remediation,
      );
    }
    const available = verifySkillBundle(request.availableBundle);
    if (!available.ok) {
      const diagnostic = available.diagnostics[0]!;
      return failure(
        "skill_upgrade.available_bundle_invalid",
        "$.availableBundle",
        diagnostic.message,
        diagnostic.remediation,
      );
    }

    const lockedSkills = new Map(locked.lock.skills.map((skill) => [skill.name, skill]));
    const availableSkills = new Map(
      available.lock.skills.map((skill) => [skill.name, skill]),
    );
    const allSkillNames = new Set([...lockedSkills.keys(), ...availableSkills.keys()]);
    const capabilities = readCapabilities(request.capabilities, lockedSkills);
    if (!capabilities.ok) {
      return capabilities.failure;
    }
    const tests = readTests(request.tests ?? [], allSkillNames);
    if (!tests.ok) {
      return tests.failure;
    }
    const constraints = readSidecarConstraints(request.sidecarConstraints, lockedSkills);
    if (!constraints.ok) {
      return constraints.failure;
    }

    const comparison = Object.freeze({
      allSkillNames,
      lockedTextFiles: readNormalizedTextFiles(request.lockedBundle, locked.lock),
      availableTextFiles: readNormalizedTextFiles(request.availableBundle, available.lock),
    });
    const changes = compareSkills(lockedSkills, availableSkills, comparison);
    const affectedNames = new Set(changes.map((change) => change.name));
    const affectedCapabilities = Object.freeze(
      capabilities.capabilities
        .filter((capability) => affectedNames.has(capability.skillName))
        .map((capability) =>
          Object.freeze({
            agentRole: capability.agentRole,
            agentContractIdentity: capability.agentContractIdentity,
            skillName: capability.skillName,
          }),
        ),
    );
    const affectedTests = Object.freeze(
      tests.tests
        .filter((test) => affectedNames.has(test.skillName))
        .map((test) => Object.freeze({ skillName: test.skillName, path: test.path })),
    );
    const compatibility = checkCompatibility(
      locked.lock,
      available.lock,
      changes,
      constraints.constraints,
    );
    const requiredSayHiVersion = Object.freeze(
      sameContractIdentity(locked.lockIdentity, available.lockIdentity)
        ? { kind: "none" as const, reason: "Skill Lock identity unchanged." }
        : { kind: "new-release" as const, reason: "Skill Lock identity changed." },
    );

    return Object.freeze({
      ok: true,
      contractVersion: SKILL_UPGRADE_PROPOSAL_CONTRACT_VERSION,
      proposal: Object.freeze({
        contractVersion: SKILL_UPGRADE_PROPOSAL_CONTRACT_VERSION,
        locked: snapshotBundleIdentity(locked.lock, locked.lockIdentity),
        available: snapshotBundleIdentity(available.lock, available.lockIdentity),
        changes,
        affectedCapabilities,
        affectedTests,
        requiredSayHiVersion,
        compatibility,
      }),
    });
  } catch {
    return failure(
      "skill_upgrade.request_invalid",
      "$",
      "Skill upgrade proposal could not be read safely.",
      "Provide plain bundle and compatibility data without accessors or cycles.",
    );
  }
}

function readCapabilities(
  value: readonly unknown[],
  lockedSkills: ReadonlyMap<string, LockedSkill>,
):
  | Readonly<{ ok: true; capabilities: readonly SkillUpgradeCapability[] }>
  | Readonly<{ ok: false; failure: ProposeSkillUpgradesResult }> {
  const capabilities: SkillUpgradeCapability[] = [];
  for (let index = 0; index < value.length; index += 1) {
    const capability = value[index];
    const path = `$.capabilities[${index}]`;
    if (
      !isRecord(capability) ||
      !isPhaseAgentRole(capability.agentRole) ||
      !isContractIdentity(capability.agentContractIdentity) ||
      !isNonEmptyString(capability.skillName)
    ) {
      return Object.freeze({
        ok: false,
        failure: failure(
          "skill_upgrade.capability_invalid",
          path,
          "Skill upgrade capability must identify a Phase Agent contract and one Skill.",
          "Declare agentRole, agentContractIdentity, and skillName for each affected Skill capability.",
        ),
      });
    }
    if (!lockedSkills.has(capability.skillName)) {
      return Object.freeze({
        ok: false,
        failure: failure(
          "skill_upgrade.capability_invalid",
          `${path}.skillName`,
          "Skill upgrade capability must name a Skill in the locked bundle.",
          "Declare only Phase Agent Skill capabilities selected by the locked release.",
        ),
      });
    }
    capabilities.push(
      Object.freeze({
        agentRole: capability.agentRole,
        agentContractIdentity: capability.agentContractIdentity,
        skillName: capability.skillName,
      }),
    );
  }
  return Object.freeze({ ok: true, capabilities: Object.freeze(capabilities) });
}

function readTests(
  value: readonly unknown[],
  knownSkillNames: ReadonlySet<string>,
):
  | Readonly<{ ok: true; tests: readonly SkillUpgradeTest[] }>
  | Readonly<{ ok: false; failure: ProposeSkillUpgradesResult }> {
  const tests: SkillUpgradeTest[] = [];
  for (let index = 0; index < value.length; index += 1) {
    const test = value[index];
    const path = `$.tests[${index}]`;
    if (
      !isRecord(test) ||
      !isNonEmptyString(test.skillName) ||
      !isNonEmptyString(test.path) ||
      !knownSkillNames.has(test.skillName)
    ) {
      return Object.freeze({
        ok: false,
        failure: failure(
          "skill_upgrade.test_invalid",
          path,
          "Skill upgrade test must name one compared Skill and a test path.",
          "Declare only tests affected by a locked or candidate Skill.",
        ),
      });
    }
    tests.push(Object.freeze({ skillName: test.skillName, path: test.path }));
  }
  return Object.freeze({ ok: true, tests: Object.freeze(tests) });
}

function readSidecarConstraints(
  value: readonly unknown[],
  lockedSkills: ReadonlyMap<string, LockedSkill>,
):
  | Readonly<{
      ok: true;
      constraints: ReadonlyMap<string, readonly ContractIdentity[]>;
    }>
  | Readonly<{ ok: false; failure: ProposeSkillUpgradesResult }> {
  const constraints = new Map<string, readonly ContractIdentity[]>();
  for (let index = 0; index < value.length; index += 1) {
    const constraint = value[index];
    const path = `$.sidecarConstraints[${index}]`;
    if (
      !isRecord(constraint) ||
      !isNonEmptyString(constraint.skillName) ||
      !Array.isArray(constraint.compatibleSidecarIdentities) ||
      constraint.compatibleSidecarIdentities.length === 0 ||
      !lockedSkills.has(constraint.skillName) ||
      constraints.has(constraint.skillName)
    ) {
      return Object.freeze({
        ok: false,
        failure: failure(
          "skill_upgrade.sidecar_constraint_invalid",
          path,
          "Sidecar constraint must name one locked Skill and at least one replacement identity.",
          "Declare one non-empty compatibleSidecarIdentities list for each constrained locked Skill.",
        ),
      });
    }
    const identities = readCompatibleSidecarIdentities(
      constraint.compatibleSidecarIdentities,
      path,
    );
    if (!identities.ok) {
      return identities;
    }
    constraints.set(constraint.skillName, identities.identities);
  }
  return Object.freeze({ ok: true, constraints });
}

function readCompatibleSidecarIdentities(
  value: readonly unknown[],
  path: string,
):
  | Readonly<{ ok: true; identities: readonly ContractIdentity[] }>
  | Readonly<{ ok: false; failure: ProposeSkillUpgradesResult }> {
  const identities: ContractIdentity[] = [];
  for (let index = 0; index < value.length; index += 1) {
    const identity = value[index];
    if (!isContractIdentity(identity)) {
      return Object.freeze({
        ok: false,
        failure: failure(
          "skill_upgrade.sidecar_constraint_invalid",
          `${path}.compatibleSidecarIdentities[${index}]`,
          "Sidecar compatibility identity must be a SHA-256 contract identity.",
          "Use the candidate sidecar's exact SHA-256 identity.",
        ),
      });
    }
    identities.push(identity);
  }
  return Object.freeze({ ok: true, identities: Object.freeze(identities) });
}

function readNormalizedTextFiles(
  bundle: unknown,
  lock: SkillLockRecord,
): ReadonlyMap<string, string> {
  const textPaths = new Set(
    lock.skills.flatMap((skill) =>
      skill.files
        .filter((file) => file.sha256.algorithm === "sha256-lf-v1")
        .map((file) => `${skill.path}/${file.path}`),
    ),
  );
  const text = new Map<string, string>();
  if (!isRecord(bundle) || !Array.isArray(bundle.files)) {
    return text;
  }
  for (const file of bundle.files) {
    if (
      isRecord(file) &&
      typeof file.path === "string" &&
      (typeof file.content === "string" || file.content instanceof Uint8Array) &&
      textPaths.has(file.path)
    ) {
      const content =
        typeof file.content === "string" ? file.content : new TextDecoder().decode(file.content);
      text.set(file.path, content.replace(/\r\n?/gu, "\n"));
    }
  }
  return text;
}

interface SkillComparisonContext {
  readonly allSkillNames: ReadonlySet<string>;
  readonly lockedTextFiles: ReadonlyMap<string, string>;
  readonly availableTextFiles: ReadonlyMap<string, string>;
}

interface FileChangeDraft {
  readonly kind: SkillUpgradeFileChangeKind;
  readonly path: string;
  readonly previousPath?: string;
  readonly before?: SkillLockFile;
  readonly after?: SkillLockFile;
}

function compareSkills(
  lockedSkills: ReadonlyMap<string, LockedSkill>,
  availableSkills: ReadonlyMap<string, LockedSkill>,
  comparison: SkillComparisonContext,
): readonly SkillUpgradeChange[] {
  const names = new Set([...lockedSkills.keys(), ...availableSkills.keys()]);
  const changes: SkillUpgradeChange[] = [];
  for (const name of [...names].sort((left, right) => left.localeCompare(right))) {
    const locked = lockedSkills.get(name);
    const available = availableSkills.get(name);
    if (locked === undefined) {
      changes.push(snapshotSkillChange("added", name, undefined, available!, comparison));
      continue;
    }
    if (available === undefined) {
      changes.push(snapshotSkillChange("removed", name, locked, undefined, comparison));
      continue;
    }
    if (!sameSkill(locked, available)) {
      changes.push(snapshotSkillChange("changed", name, locked, available, comparison));
    }
  }
  return Object.freeze(changes);
}

function snapshotSkillChange(
  kind: SkillUpgradeChangeKind,
  name: string,
  locked: LockedSkill | undefined,
  available: LockedSkill | undefined,
  comparison: SkillComparisonContext,
): SkillUpgradeChange {
  const beforeSkill =
    locked === undefined ? undefined : snapshotSkill(locked);
  const afterSkill =
    available === undefined ? undefined : snapshotSkill(available);
  const beforeLicense = locked?.upstream.license ?? null;
  const afterLicense = available?.upstream.license ?? null;
  const licenseChanged = beforeLicense !== afterLicense;
  const files = compareFiles(locked, available, comparison);
  const noticeChanged = files.some(
    (file) =>
      /(?:^|\/)(?:LICENSE|NOTICE)(?:\.[^/]+)?$/iu.test(file.path) ||
      (file.previousPath !== undefined &&
        /(?:^|\/)(?:LICENSE|NOTICE)(?:\.[^/]+)?$/iu.test(file.previousPath)),
  );
  return Object.freeze({
    kind,
    name,
    ...(beforeSkill === undefined ? {} : { before: beforeSkill }),
    ...(afterSkill === undefined ? {} : { after: afterSkill }),
    files,
    semantic: compareSkillSemantics(locked, available, comparison),
    licenseNotice: Object.freeze({
      before: beforeLicense,
      after: afterLicense,
      changed: licenseChanged,
      noticeChanged,
      noticeReviewRequired: kind !== "changed" || licenseChanged || noticeChanged,
    }),
  });
}

function compareFiles(
  locked: LockedSkill | undefined,
  available: LockedSkill | undefined,
  comparison: SkillComparisonContext,
): readonly SkillUpgradeFileChange[] {
  const remainingLocked = new Map(locked?.files.map((file) => [file.path, file]) ?? []);
  const remainingAvailable = new Map(
    available?.files.map((file) => [file.path, file]) ?? [],
  );
  const drafts: FileChangeDraft[] = [];

  for (const path of [...remainingLocked.keys()].sort((left, right) => left.localeCompare(right))) {
    const before = remainingLocked.get(path)!;
    const after = remainingAvailable.get(path);
    if (after === undefined) {
      continue;
    }
    remainingLocked.delete(path);
    remainingAvailable.delete(path);
    if (
      before.sha256.algorithm !== after.sha256.algorithm ||
      before.sha256.digest.toLowerCase() !== after.sha256.digest.toLowerCase()
    ) {
      drafts.push({ kind: "changed", path, before, after });
    }
  }

  for (const previousPath of [...remainingLocked.keys()].sort((left, right) => left.localeCompare(right))) {
    const before = remainingLocked.get(previousPath)!;
    const path = [...remainingAvailable.keys()]
      .sort((left, right) => left.localeCompare(right))
      .find((candidate) => {
        const after = remainingAvailable.get(candidate)!;
        return (
          before.sha256.algorithm === after.sha256.algorithm &&
          before.sha256.digest.toLowerCase() === after.sha256.digest.toLowerCase()
        );
      });
    if (path === undefined) {
      continue;
    }
    const after = remainingAvailable.get(path)!;
    remainingLocked.delete(previousPath);
    remainingAvailable.delete(path);
    drafts.push({ kind: "renamed", path, previousPath, before, after });
  }

  for (const path of [...remainingLocked.keys()].sort((left, right) => left.localeCompare(right))) {
    drafts.push({ kind: "removed", path, before: remainingLocked.get(path)! });
  }
  for (const path of [...remainingAvailable.keys()].sort((left, right) => left.localeCompare(right))) {
    drafts.push({ kind: "added", path, after: remainingAvailable.get(path)! });
  }
  return Object.freeze(
    drafts.map((draft) => snapshotFileChange(draft, locked, available, comparison)),
  );
}

function snapshotFileChange(
  draft: FileChangeDraft,
  locked: LockedSkill | undefined,
  available: LockedSkill | undefined,
  comparison: SkillComparisonContext,
): SkillUpgradeFileChange {
  const beforeText =
    draft.before === undefined || locked === undefined
      ? null
      : comparison.lockedTextFiles.get(`${locked.path}/${draft.before.path}`) ?? null;
  const afterText =
    draft.after === undefined || available === undefined
      ? null
      : comparison.availableTextFiles.get(`${available.path}/${draft.after.path}`) ?? null;
  return Object.freeze({
    kind: draft.kind,
    path: draft.path,
    ...(draft.previousPath === undefined ? {} : { previousPath: draft.previousPath }),
    ...(draft.before === undefined ? {} : { before: snapshotContentHash(draft.before.sha256) }),
    ...(draft.after === undefined ? {} : { after: snapshotContentHash(draft.after.sha256) }),
    text: Object.freeze({ before: beforeText, after: afterText }),
  });
}

function compareSkillSemantics(
  locked: LockedSkill | undefined,
  available: LockedSkill | undefined,
  comparison: SkillComparisonContext,
): SkillUpgradeSemanticComparison {
  const beforeFrontmatter = frontmatterFor(locked, comparison.lockedTextFiles);
  const afterFrontmatter = frontmatterFor(available, comparison.availableTextFiles);
  const beforeInvocation = invocationLines(beforeFrontmatter);
  const afterInvocation = invocationLines(afterFrontmatter);
  const beforeReferences = crossSkillReferences(
    locked,
    comparison.allSkillNames,
    comparison.lockedTextFiles,
  );
  const afterReferences = crossSkillReferences(
    available,
    comparison.allSkillNames,
    comparison.availableTextFiles,
  );
  return Object.freeze({
    frontmatter: Object.freeze({
      before: beforeFrontmatter,
      after: afterFrontmatter,
      changed: beforeFrontmatter !== afterFrontmatter,
    }),
    invocation: Object.freeze({
      before: beforeInvocation,
      after: afterInvocation,
      changed:
        beforeInvocation.length !== afterInvocation.length ||
        beforeInvocation.some((line, index) => line !== afterInvocation[index]),
    }),
    crossSkillReferences: Object.freeze({
      added: Object.freeze(afterReferences.filter((name) => !beforeReferences.includes(name))),
      removed: Object.freeze(beforeReferences.filter((name) => !afterReferences.includes(name))),
    }),
  });
}

function frontmatterFor(
  skill: LockedSkill | undefined,
  textFiles: ReadonlyMap<string, string>,
): string | null {
  if (skill === undefined) {
    return null;
  }
  const text = textFiles.get(`${skill.path}/SKILL.md`);
  if (text === undefined || !text.startsWith("---\n")) {
    return null;
  }
  const terminated = text.indexOf("\n---\n", 4);
  if (terminated !== -1) {
    return text.slice(4, terminated);
  }
  return text.endsWith("\n---") ? text.slice(4, -4) : null;
}

function invocationLines(frontmatter: string | null): readonly string[] {
  if (frontmatter === null) {
    return Object.freeze([]);
  }
  return Object.freeze(
    frontmatter
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => /^(?:name|disable-model-invocation|user-invocable):/u.test(line))
      .sort((left, right) => left.localeCompare(right)),
  );
}

function crossSkillReferences(
  skill: LockedSkill | undefined,
  allSkillNames: ReadonlySet<string>,
  textFiles: ReadonlyMap<string, string>,
): readonly string[] {
  if (skill === undefined) {
    return Object.freeze([]);
  }
  const references = new Set<string>();
  for (const name of [...allSkillNames].sort((left, right) => left.localeCompare(right))) {
    if (name === skill.name) {
      continue;
    }
    const expression = new RegExp(
      `(?<![A-Za-z0-9_-])${name.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&")}(?![A-Za-z0-9_-])`,
      "u",
    );
    if (
      skill.files.some((file) =>
        expression.test(textFiles.get(`${skill.path}/${file.path}`) ?? ""),
      )
    ) {
      references.add(name);
    }
  }
  return Object.freeze([...references].sort((left, right) => left.localeCompare(right)));
}

function sameSkill(left: LockedSkill, right: LockedSkill): boolean {
  if (
    left.path !== right.path ||
    left.upstream.repository !== right.upstream.repository ||
    left.upstream.commit !== right.upstream.commit ||
    left.upstream.path !== right.upstream.path ||
    left.upstream.license !== right.upstream.license ||
    !sameContractIdentity(left.sidecarIdentity, right.sidecarIdentity) ||
    left.files.length !== right.files.length
  ) {
    return false;
  }
  const rightFiles = new Map(right.files.map((file) => [file.path, file]));
  return left.files.every((file) => {
    const matched = rightFiles.get(file.path);
    return (
      matched !== undefined &&
      file.sha256.algorithm === matched.sha256.algorithm &&
      file.sha256.digest.toLowerCase() === matched.sha256.digest.toLowerCase()
    );
  });
}

function checkCompatibility(
  locked: SkillLockRecord,
  available: SkillLockRecord,
  changes: readonly SkillUpgradeChange[],
  constraints: ReadonlyMap<string, readonly ContractIdentity[]>,
): SkillUpgradeCompatibility {
  const failures: SkillUpgradeCompatibilityFailure[] = [];
  if (locked.registry.repository !== available.registry.repository) {
    failures.push(
      Object.freeze({
        code: "skill_upgrade.registry_repository_changed",
        message: "Candidate Skill Bundle comes from a different Registry repository.",
        remediation: "Discover upgrades from the Registry repository pinned by the locked release.",
      }),
    );
  }
  for (const change of changes) {
    if (change.kind === "removed") {
      failures.push(
        Object.freeze({
          code: "skill_upgrade.locked_skill_removed",
          skillName: change.name,
          message: `Candidate Skill Bundle removes locked Skill ${change.name}.`,
          remediation: "Retain every locked Skill or prepare an explicit release migration before review.",
        }),
      );
      continue;
    }
    const compatibleSidecarIdentities = constraints.get(change.name);
    if (
      change.kind === "changed" &&
      change.before !== undefined &&
      change.after !== undefined &&
      !sameContractIdentity(change.before.sidecarIdentity, change.after.sidecarIdentity) &&
      !(compatibleSidecarIdentities?.some((identity) =>
        sameContractIdentity(identity, change.after!.sidecarIdentity),
      ) ?? false)
    ) {
      failures.push(
        Object.freeze({
          code: "skill_upgrade.sidecar_incompatible",
          skillName: change.name,
          message: `Candidate Skill ${change.name} has an unapproved sidecar identity.`,
          remediation: "Approve the exact replacement sidecar identity or update the affected Phase Agent contracts.",
        }),
      );
    }
  }
  return Object.freeze({
    compatible: failures.length === 0,
    failures: Object.freeze(failures),
  });
}

function snapshotBundleIdentity(
  lock: SkillLockRecord,
  identity: ContractIdentity,
): SkillUpgradeBundleIdentity {
  return Object.freeze({
    registry: Object.freeze({
      repository: lock.registry.repository,
      commit: lock.registry.commit,
    }),
    identity,
  });
}

function snapshotSkill(skill: LockedSkill): SkillUpgradeSkill {
  return Object.freeze({
    name: skill.name,
    path: skill.path,
    files: Object.freeze(
      skill.files.map((file) =>
        Object.freeze({ path: file.path, identity: snapshotContentHash(file.sha256) }),
      ),
    ),
    upstream: Object.freeze({
      repository: skill.upstream.repository,
      commit: skill.upstream.commit,
      path: skill.upstream.path,
      license: skill.upstream.license,
    }),
    sidecarIdentity: skill.sidecarIdentity,
  });
}

function snapshotContentHash(identity: ContentHash): ContentHash {
  return Object.freeze({ algorithm: identity.algorithm, digest: identity.digest });
}

function sameContractIdentity(left: ContractIdentity, right: ContractIdentity): boolean {
  return left.toLowerCase() === right.toLowerCase();
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.length > 0;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function failure(
  code: SkillUpgradeProposalDiagnosticCode,
  path: string,
  message: string,
  remediation: string,
): ProposeSkillUpgradesResult {
  return Object.freeze({
    ok: false,
    contractVersion: SKILL_UPGRADE_PROPOSAL_CONTRACT_VERSION,
    diagnostics: Object.freeze([Object.freeze({ code, path, message, remediation })]),
  });
}
