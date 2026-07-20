import {
  coreContract,
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

export function withTestSkillBundle<Request extends Record<string, unknown>>(
  request: Request,
): Request & Readonly<{ skillBundle: SkillBundle }> {
  return { skillBundle: TEST_SKILL_BUNDLE, ...request };
}

export function initializeManagedProjectWithTestSkillBundle(
  request: Record<string, unknown>,
) {
  return coreContract.initializeManagedProject(withTestSkillBundle(request) as never);
}
