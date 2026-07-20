import {
  hashCanonicalJson,
  type ContractIdentity,
} from "./identity.js";
import {
  RECORD_CONTRACT_VERSION,
  type InstalledProjectVersions,
} from "./record-contracts.js";
import {
  SKILL_BUNDLE_CONTRACT_VERSION,
  verifySkillBundle,
  type SkillBundle,
  type SkillBundleFile,
} from "./skill-bundle.js";
import { RELEASE_SOURCE_PROVENANCE } from "./release-provenance.generated.js";

export const RELEASE_ARTIFACT_CONTRACT_VERSION = 1 as const;
export const MANAGED_PROJECT_CONTRACT_VERSION = 1 as const;
export const PROJECT_STORE_SCHEMA_VERSION = 1 as const;

export type ReleaseArtifactName = "core" | "cli" | "omp";

export interface ReleaseArtifactProvenance {
  readonly repository: string;
  readonly revision: string;
}

export interface ReleaseArtifactCompatibilityInput {
  readonly recordContract: number;
  readonly managedProjectContract: number;
  readonly projectSchema: number;
  readonly templates: string;
  readonly skillBundleContract: number;
}

export interface ReleaseArtifactCompatibility
  extends ReleaseArtifactCompatibilityInput {
  readonly skillLockDigest: ContractIdentity;
}

export interface ReleaseArtifactVersions {
  readonly core: string;
  readonly cli: string;
  readonly omp: string;
}

export interface ReleaseArtifactMetadata {
  readonly name: ReleaseArtifactName;
  readonly version: string;
  readonly provenance: ReleaseArtifactProvenance;
  readonly compatibility: ReleaseArtifactCompatibility;
  /** SHA-256 identity of the immutable metadata fields above. */
  readonly integrity: ContractIdentity;
}

export interface CoordinatedReleaseArtifacts {
  readonly contractVersion: typeof RELEASE_ARTIFACT_CONTRACT_VERSION;
  readonly artifacts: Readonly<{
    readonly core: ReleaseArtifactMetadata;
    readonly cli: ReleaseArtifactMetadata;
    readonly omp: ReleaseArtifactMetadata;
  }>;
  readonly skillBundle: SkillBundle;
  /** SHA-256 identity of all artifact identities and the verified Skill Lock. */
  readonly integrity: ContractIdentity;
}

export interface CreateCoordinatedReleaseArtifactsRequest {
  readonly provenance: ReleaseArtifactProvenance;
  readonly versions: ReleaseArtifactVersions;
  readonly compatibility: ReleaseArtifactCompatibilityInput;
  readonly skillBundle: SkillBundle;
}

export type CoordinatedReleaseArtifactsDiagnosticCode =
  | "release_artifacts.request_invalid"
  | "release_artifacts.skill_bundle_invalid"
  | "release_artifacts.mismatch";

export interface CoordinatedReleaseArtifactsDiagnostic {
  readonly code: CoordinatedReleaseArtifactsDiagnosticCode;
  readonly path: string;
  readonly message: string;
  readonly remediation: string;
}

export type CreateCoordinatedReleaseArtifactsResult =
  | Readonly<{
      ok: true;
      contractVersion: typeof RELEASE_ARTIFACT_CONTRACT_VERSION;
      releaseArtifacts: CoordinatedReleaseArtifacts;
    }>
  | Readonly<{
      ok: false;
      contractVersion: typeof RELEASE_ARTIFACT_CONTRACT_VERSION;
      diagnostics: readonly CoordinatedReleaseArtifactsDiagnostic[];
    }>;

export type VerifyCoordinatedReleaseArtifactsResult =
  CreateCoordinatedReleaseArtifactsResult;

export function createCoordinatedReleaseArtifacts(
  request: unknown,
): CreateCoordinatedReleaseArtifactsResult {
  try {
    if (!isRecord(request)) {
      return invalidRequest("$", "Coordinated release artifacts must be a readable object.");
    }
    const provenance = readProvenance(request.provenance);
    if (provenance === null) {
      return invalidRequest(
        "$.provenance",
        "Release provenance must declare a repository and revision.",
      );
    }
    const versions = readVersions(request.versions);
    if (versions === null) {
      return invalidRequest(
        "$.versions",
        "Release versions must declare non-empty Core, CLI, and OMP versions.",
      );
    }
    const compatibility = readCompatibilityInput(request.compatibility);
    if (compatibility === null) {
      return invalidRequest(
        "$.compatibility",
        "Release compatibility must declare supported contract versions and template version.",
      );
    }
    if (
      compatibility.recordContract !== RECORD_CONTRACT_VERSION ||
      compatibility.managedProjectContract !== MANAGED_PROJECT_CONTRACT_VERSION ||
      compatibility.projectSchema !== PROJECT_STORE_SCHEMA_VERSION ||
      compatibility.skillBundleContract !== SKILL_BUNDLE_CONTRACT_VERSION
    ) {
      return invalidRequest(
        "$.compatibility",
        "Release compatibility must declare the contract versions supported by this Core.",
      );
    }

    const bundle = verifySkillBundle(request.skillBundle);
    if (!bundle.ok) {
      const diagnostic = bundle.diagnostics[0]!;
      return failure(
        "release_artifacts.skill_bundle_invalid",
        "$.skillBundle",
        diagnostic.message,
        diagnostic.remediation,
      );
    }
    if (!isSkillBundle(request.skillBundle)) {
      return invalidRequest(
        "$.skillBundle",
        "Release Skill Bundle must retain its verified lock and file collection.",
      );
    }

    const verifiedProvenance = Object.freeze({ ...provenance });
    const verifiedCompatibility = Object.freeze({
      ...compatibility,
      skillLockDigest: bundle.lockIdentity,
    });
    const artifacts = Object.freeze({
      core: createArtifact(
        "core",
        versions.core,
        verifiedProvenance,
        verifiedCompatibility,
      ),
      cli: createArtifact(
        "cli",
        versions.cli,
        verifiedProvenance,
        verifiedCompatibility,
      ),
      omp: createArtifact(
        "omp",
        versions.omp,
        verifiedProvenance,
        verifiedCompatibility,
      ),
    });
    const integrity = hashCanonicalJson({
      contractVersion: RELEASE_ARTIFACT_CONTRACT_VERSION,
      core: artifacts.core.integrity,
      cli: artifacts.cli.integrity,
      omp: artifacts.omp.integrity,
      skillLockDigest: bundle.lockIdentity,
    });
    return Object.freeze({
      ok: true,
      contractVersion: RELEASE_ARTIFACT_CONTRACT_VERSION,
      releaseArtifacts: Object.freeze({
        contractVersion: RELEASE_ARTIFACT_CONTRACT_VERSION,
        artifacts,
        skillBundle: snapshotSkillBundle(request.skillBundle),
        integrity,
      }),
    });
  } catch {
    return invalidRequest(
      "$",
      "Coordinated release artifacts could not be read safely.",
    );
  }
}

export function verifyCoordinatedReleaseArtifacts(
  request: unknown,
): VerifyCoordinatedReleaseArtifactsResult {
  try {
    if (!isRecord(request) || !isRecord(request.artifacts)) {
      return invalidRequest(
        "$",
        "Coordinated release artifacts must include Core, CLI, and OMP metadata.",
      );
    }
    const actualArtifacts = request.artifacts;
    if (
      !isRecord(actualArtifacts.core) ||
      !isRecord(actualArtifacts.cli) ||
      !isRecord(actualArtifacts.omp)
    ) {
      return invalidRequest(
        "$.artifacts",
        "Coordinated release artifacts must include readable Core, CLI, and OMP metadata.",
      );
    }

    const expected = createCoordinatedReleaseArtifacts({
      provenance: actualArtifacts.core.provenance,
      versions: {
        core: actualArtifacts.core.version,
        cli: actualArtifacts.cli.version,
        omp: actualArtifacts.omp.version,
      },
      compatibility: actualArtifacts.core.compatibility,
      skillBundle: request.skillBundle,
    });
    if (!expected.ok) {
      return expected;
    }
    const expectedArtifacts = expected.releaseArtifacts;
    if (
      request.contractVersion !== RELEASE_ARTIFACT_CONTRACT_VERSION ||
      request.integrity !== expectedArtifacts.integrity ||
      !sameArtifact(actualArtifacts.core, expectedArtifacts.artifacts.core) ||
      !sameArtifact(actualArtifacts.cli, expectedArtifacts.artifacts.cli) ||
      !sameArtifact(actualArtifacts.omp, expectedArtifacts.artifacts.omp)
    ) {
      return failure(
        "release_artifacts.mismatch",
        "$.artifacts",
        "Core, CLI, OMP, and Skill Bundle metadata do not describe one coordinated release.",
        "Install artifacts built from one release declaration and its exact locked Skill Bundle.",
      );
    }
    return expected;
  } catch {
    return invalidRequest(
      "$",
      "Coordinated release artifacts could not be verified safely.",
    );
  }
}

export function verifyTrustedCoordinatedReleaseArtifacts(
  request: unknown,
  trustedReleaseArtifacts: unknown = COORDINATED_RELEASE_ARTIFACTS,
): VerifyCoordinatedReleaseArtifactsResult {
  const actual = verifyCoordinatedReleaseArtifacts(request);
  if (!actual.ok) {
    return actual;
  }
  const trusted = verifyCoordinatedReleaseArtifacts(trustedReleaseArtifacts);
  if (!trusted.ok) {
    return trusted;
  }
  if (!sameReleaseArtifacts(actual.releaseArtifacts, trusted.releaseArtifacts)) {
    return failure(
      "release_artifacts.mismatch",
      "$.artifacts",
      "Release artifacts do not match the trusted compiled release declaration.",
      "Install the Core, CLI, OMP, and Skill Bundle artifacts released together.",
    );
  }
  return actual;
}

export function installedProjectVersionsForReleaseArtifacts(
  releaseArtifacts: CoordinatedReleaseArtifacts,
): InstalledProjectVersions {
  const { artifacts } = releaseArtifacts;
  const compatibility = artifacts.core.compatibility;
  return Object.freeze({
    core: artifacts.core.version,
    cli: artifacts.cli.version,
    ompPlugin: artifacts.omp.version,
    projectSchema: compatibility.projectSchema,
    templates: compatibility.templates,
    skillLockDigest: compatibility.skillLockDigest,
  });
}

const declaredReleaseArtifacts = createCoordinatedReleaseArtifacts({
  provenance: RELEASE_SOURCE_PROVENANCE,
  versions: {
    core: "0.0.0",
    cli: "0.0.0",
    omp: "0.0.0",
  },
  compatibility: {
    recordContract: RECORD_CONTRACT_VERSION,
    managedProjectContract: MANAGED_PROJECT_CONTRACT_VERSION,
    projectSchema: PROJECT_STORE_SCHEMA_VERSION,
    templates: "0.1.0",
    skillBundleContract: SKILL_BUNDLE_CONTRACT_VERSION,
  },
  skillBundle: Object.freeze({
    lock: Object.freeze({
      schemaVersion: 1,
      registry: Object.freeze({
        repository: "https://github.com/dnslin/skills",
        commit: "bb158aeaf770fc0a0c93bb2a28fb922404508667",
      }),
      skills: Object.freeze([]),
    }),
    files: Object.freeze([]),
  }),
});
if (!declaredReleaseArtifacts.ok) {
  throw new Error("The declared SayHi release artifacts are invalid.");
}

export const COORDINATED_RELEASE_ARTIFACTS =
  declaredReleaseArtifacts.releaseArtifacts;

function sameReleaseArtifacts(
  actual: CoordinatedReleaseArtifacts,
  expected: CoordinatedReleaseArtifacts,
): boolean {
  return (
    actual.contractVersion === expected.contractVersion &&
    actual.integrity === expected.integrity &&
    sameArtifact(actual.artifacts.core, expected.artifacts.core) &&
    sameArtifact(actual.artifacts.cli, expected.artifacts.cli) &&
    sameArtifact(actual.artifacts.omp, expected.artifacts.omp)
  );
}

function createArtifact(
  name: ReleaseArtifactName,
  version: string,
  provenance: ReleaseArtifactProvenance,
  compatibility: ReleaseArtifactCompatibility,
): ReleaseArtifactMetadata {
  return Object.freeze({
    name,
    version,
    provenance,
    compatibility,
    integrity: hashCanonicalJson({ name, version, provenance, compatibility }),
  });
}

function sameArtifact(
  actual: unknown,
  expected: ReleaseArtifactMetadata,
): boolean {
  return (
    isRecord(actual) &&
    actual.name === expected.name &&
    actual.version === expected.version &&
    actual.integrity === expected.integrity &&
    sameProvenance(actual.provenance, expected.provenance) &&
    sameCompatibility(actual.compatibility, expected.compatibility)
  );
}

function sameProvenance(
  actual: unknown,
  expected: ReleaseArtifactProvenance,
): boolean {
  return (
    isRecord(actual) &&
    actual.repository === expected.repository &&
    actual.revision === expected.revision
  );
}

function sameCompatibility(
  actual: unknown,
  expected: ReleaseArtifactCompatibility,
): boolean {
  return (
    isRecord(actual) &&
    actual.recordContract === expected.recordContract &&
    actual.managedProjectContract === expected.managedProjectContract &&
    actual.projectSchema === expected.projectSchema &&
    actual.templates === expected.templates &&
    actual.skillBundleContract === expected.skillBundleContract &&
    actual.skillLockDigest === expected.skillLockDigest
  );
}

function readProvenance(value: unknown): ReleaseArtifactProvenance | null {
  if (!isRecord(value) || !isNonEmptyString(value.repository) || !isNonEmptyString(value.revision)) {
    return null;
  }
  return { repository: value.repository, revision: value.revision };
}

function readVersions(value: unknown): ReleaseArtifactVersions | null {
  if (
    !isRecord(value) ||
    !isNonEmptyString(value.core) ||
    !isNonEmptyString(value.cli) ||
    !isNonEmptyString(value.omp)
  ) {
    return null;
  }
  return { core: value.core, cli: value.cli, omp: value.omp };
}

function readCompatibilityInput(
  value: unknown,
): ReleaseArtifactCompatibilityInput | null {
  if (
    !isRecord(value) ||
    !isPositiveInteger(value.recordContract) ||
    !isPositiveInteger(value.managedProjectContract) ||
    !isPositiveInteger(value.projectSchema) ||
    !isNonEmptyString(value.templates) ||
    !isPositiveInteger(value.skillBundleContract)
  ) {
    return null;
  }
  return {
    recordContract: value.recordContract,
    managedProjectContract: value.managedProjectContract,
    projectSchema: value.projectSchema,
    templates: value.templates,
    skillBundleContract: value.skillBundleContract,
  };
}

function snapshotSkillBundle(bundle: SkillBundle): SkillBundle {
  const lock = deepFreeze(structuredClone(bundle.lock));
  const files = Object.freeze(bundle.files.map(snapshotSkillBundleFile));
  return Object.freeze({
    get lock(): unknown {
      return lock;
    },
    get files(): readonly SkillBundleFile[] {
      return Object.freeze(files.map(copySkillBundleFile));
    },
  });
}

function snapshotSkillBundleFile(file: SkillBundleFile): SkillBundleFile {
  return Object.freeze({ path: file.path, content: copySkillBundleContent(file.content) });
}

function copySkillBundleFile(file: SkillBundleFile): SkillBundleFile {
  return Object.freeze({ path: file.path, content: copySkillBundleContent(file.content) });
}

function copySkillBundleContent(content: string | Uint8Array): string | Uint8Array {
  return typeof content === "string" ? content : new Uint8Array(content);
}

function deepFreeze(value: unknown): unknown {
  if (ArrayBuffer.isView(value) || value === null || typeof value !== "object") {
    return value;
  }
  if (Array.isArray(value)) {
    for (const entry of value) {
      deepFreeze(entry);
    }
  } else {
    for (const entry of Object.values(value)) {
      deepFreeze(entry);
    }
  }
  return Object.freeze(value);
}

function isSkillBundle(value: unknown): value is SkillBundle {
  return isRecord(value) && "lock" in value && Array.isArray(value.files);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function isPositiveInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0;
}

function invalidRequest(
  path: string,
  message: string,
): Extract<CreateCoordinatedReleaseArtifactsResult, { ok: false }> {
  return failure("release_artifacts.request_invalid", path, message, "Provide complete immutable release metadata.");
}

function failure(
  code: CoordinatedReleaseArtifactsDiagnosticCode,
  path: string,
  message: string,
  remediation: string,
): Extract<CreateCoordinatedReleaseArtifactsResult, { ok: false }> {
  return Object.freeze({
    ok: false,
    contractVersion: RELEASE_ARTIFACT_CONTRACT_VERSION,
    diagnostics: Object.freeze([
      Object.freeze({ code, path, message, remediation }),
    ]),
  });
}
