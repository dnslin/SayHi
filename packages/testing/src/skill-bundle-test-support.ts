import {
  coreContract,
  createCoordinatedReleaseArtifacts,
  type SkillBundle,
  type SkillMaterial,
} from "@dnslin/sayhi-core";

export const IMPLEMENTATION_SKILL_MATERIALS = [
  {
    name: "implement",
    identity: {
      algorithm: "sha256-lf-v1",
      digest: "918901d60ffbd690430096b5aa9e9b1c68ad82e8f5287e58dea1924002cf8543",
    },
    content: "implement skill\n",
  },
  {
    name: "tdd",
    identity: {
      algorithm: "sha256-lf-v1",
      digest: "ddf8a3f4287831a447c0b4e2c506026a849b77036f67c659275025d130f5040d",
    },
    content: "tdd skill\n",
  },
] as const satisfies readonly SkillMaterial[];

export const TEST_SKILL_BUNDLE = {
  lock: {
    schemaVersion: 1,
    registry: {
      repository: "https://github.com/dnslin/skills",
      commit: "1".repeat(40),
    },
    skills: IMPLEMENTATION_SKILL_MATERIALS.map((skill, index) => ({
      name: skill.name,
      path: skill.name,
      files: [{ path: "SKILL.md", sha256: skill.identity }],
      upstream: {
        repository: "https://github.com/mattpocock/skills",
        commit: String(index + 1).repeat(40),
        path: `skills/engineering/${skill.name}`,
        license: "MIT",
      },
      sidecarIdentity: `sha256:${String.fromCharCode(97 + index).repeat(64)}`,
    })),
  },
  files: IMPLEMENTATION_SKILL_MATERIALS.map((skill) => ({
    path: `${skill.name}/SKILL.md`,
    content: skill.content,
  })),
} satisfies SkillBundle;

const verifiedTestSkillBundle = coreContract.verifySkillBundle(TEST_SKILL_BUNDLE);
if (!verifiedTestSkillBundle.ok) {
  throw new Error("Test Skill Bundle does not satisfy the durable Skill Lock contract.");
}

export const TEST_SKILL_LOCK_DIGEST = verifiedTestSkillBundle.lockIdentity;

export const TEST_RELEASE_ARTIFACTS = testReleaseArtifactsFor({
  core: "0.0.0",
  cli: "0.0.0",
  ompPlugin: "0.0.0",
  projectSchema: 1,
  templates: "0.0.0",
});

export function withTestReleaseArtifacts<Request extends Record<string, unknown>>(
  request: Request,
): Request &
  Readonly<{
    releaseArtifacts: unknown;
    trustedReleaseArtifacts: unknown;
  }> {
  const trustedReleaseArtifacts =
    request.trustedReleaseArtifacts ??
    testReleaseArtifactsFor(request.installation);
  const releaseArtifacts =
    request.releaseArtifacts ??
    Object.freeze({
      ...trustedReleaseArtifacts,
      skillBundle: request.skillBundle ?? TEST_SKILL_BUNDLE,
    });
  return { ...request, releaseArtifacts, trustedReleaseArtifacts };
}

export function initializeManagedProjectWithTestReleaseArtifacts(
  request: Record<string, unknown>,
) {
  return coreContract.initializeManagedProject(
    withTestReleaseArtifacts(request) as never,
  );
}

function testReleaseArtifactsFor(installation: unknown) {
  const versions = isRecord(installation) ? installation : {};
  const testReleaseArtifacts = createCoordinatedReleaseArtifacts({
    provenance: {
      repository: "https://github.com/dnslin/SayHi",
      revision: "0.0.0-test",
    },
    versions: {
      core: stringValue(versions.core, "0.0.0"),
      cli: stringValue(versions.cli, "0.0.0"),
      omp: stringValue(versions.ompPlugin, "0.0.0"),
    },
    compatibility: {
      recordContract: 1,
      managedProjectContract: 1,
      projectSchema: positiveIntegerValue(versions.projectSchema, 1),
      templates: stringValue(versions.templates, "0.0.0"),
      skillBundleContract: 1,
    },
    skillBundle: TEST_SKILL_BUNDLE,
  });
  if (!testReleaseArtifacts.ok) {
    throw new Error("Test release artifacts cannot be constructed.");
  }
  return testReleaseArtifacts.releaseArtifacts;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function stringValue(value: unknown, fallback: string): string {
  return typeof value === "string" && value.length > 0 ? value : fallback;
}

function positiveIntegerValue(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0
    ? value
    : fallback;
}

