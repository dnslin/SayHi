import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import {
  cp,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { promisify } from "node:util";
import { gunzipSync } from "node:zlib";

const execFileAsync = promisify(execFile);
const scriptPath = fileURLToPath(import.meta.url);
const repositoryRoot = resolve(dirname(scriptPath), "..");
const npmExecutable = process.platform === "win32" ? process.execPath : "npm";
const npmCliEntryPoint =
  process.env.npm_execpath ??
  join(dirname(process.execPath), "node_modules", "npm", "bin", "npm-cli.js");
const releasePackages = Object.freeze([
  Object.freeze({ name: "core", packageName: "@dnslin/sayhi-core" }),
  Object.freeze({ name: "cli", packageName: "@dnslin/sayhi-cli" }),
  Object.freeze({ name: "omp", packageName: "@dnslin/sayhi-omp" }),
]);
const testingPackage = "@sayhi/testing";
const milestoneGates = Object.freeze([0, 1, 2, 3, 4, 5]);
const trustedInstalledContractFiles = Object.freeze([
  "context-cli.contract.test.js",
  "context-manifest.contract.test.js",
  "execution.contract.test.js",
  "initiative-scheduler.contract.test.js",
  "managed-project-bin.contract.test.js",
  "managed-project-cli.contract.test.js",
  "omp.contract.test.js",
  "spec-context-cli.contract.test.js",
  "task-lifecycle-filesystem.contract.test.js",
  "task-lifecycle.contract.test.js",
  "workflow.contract.test.js",
]);

export function createReleaseEvidence(
  firstBuild,
  secondBuild,
  exitGates,
  installedAcceptance,
) {
  const first = normalizeBuild(firstBuild);
  const second = normalizeBuild(secondBuild);
  if (canonicalJson(first) !== canonicalJson(second)) {
    throw new Error("Locked release builds differ.");
  }
  const gates = normalizeExitGates(exitGates);
  return deepFreeze({
    schemaVersion: 1,
    source: first.source,
    dependencies: first.dependencies,
    release: first.release,
    artifacts: first.artifacts,
    exitGates: gates,
    installedAcceptance: normalizeInstalledAcceptance(installedAcceptance),
  });
}

export function verifyNodeToolchain(nodeEngine, node) {
  if (typeof nodeEngine !== "string") {
    throw new Error("Release package manifest must declare a Node engine.");
  }
  const required = /^>=(\d+)\.(\d+)\.(\d+)$/u.exec(nodeEngine);
  if (required === null) {
    throw new Error("Release Node engine must declare a minimum semantic version.");
  }
  const actual = /^v?(\d+)\.(\d+)\.(\d+)$/u.exec(node);
  if (actual === null) {
    throw new Error("Release candidate Node version is invalid.");
  }
  for (let index = 1; index <= 3; index += 1) {
    const requiredPart = Number.parseInt(required[index], 10);
    const actualPart = Number.parseInt(actual[index], 10);
    if (actualPart > requiredPart) {
      return node;
    }
    if (actualPart < requiredPart) {
      throw new Error(`Release candidate requires Node ${nodeEngine}; received ${node}.`);
    }
  }
  return node;
}

export function verifyNpmToolchain(packageManager, npm) {
  if (typeof packageManager !== "string") {
    throw new Error("Release package manifest must declare an npm packageManager.");
  }
  const match = /^npm@(\d+\.\d+\.\d+)$/u.exec(packageManager);
  if (match === null) {
    throw new Error("Release packageManager must declare an exact npm version.");
  }
  if (npm !== match[1]) {
    throw new Error(`Release candidate requires npm ${match[1]}; received ${npm}.`);
  }
  return npm;
}

export function verifyReleaseEvidence(evidence) {
  if (!isRecord(evidence)) {
    throw new Error("Release evidence must be an object.");
  }
  requireExactKeys(evidence, [
    "schemaVersion",
    "source",
    "dependencies",
    "release",
    "artifacts",
    "exitGates",
    "installedAcceptance",
  ], "Release evidence");
  if (evidence.schemaVersion !== 1) {
    throw new Error("Release evidence schemaVersion must be 1.");
  }
  const build = normalizeBuild({
    source: evidence.source,
    dependencies: evidence.dependencies,
    release: evidence.release,
    artifacts: evidence.artifacts,
  });
  return deepFreeze({
    schemaVersion: 1,
    ...build,
    exitGates: normalizeExitGates(evidence.exitGates),
    installedAcceptance: normalizeInstalledAcceptance(evidence.installedAcceptance),
  });
}

export async function verifyReleaseCandidateDirectory(inputDirectory) {
  const input = resolveRequiredDirectory(inputDirectory, "Release candidate input");
  const evidence = verifyReleaseEvidence(
    JSON.parse(await readFile(join(input, "release-evidence.json"), "utf8")),
  );
  const archivesDirectory = join(input, "artifacts");
  const expectedArchives = new Set(evidence.artifacts.map((artifact) => artifact.file));
  const archiveEntries = await readdir(archivesDirectory, { withFileTypes: true });
  const actualArchives = new Set();
  for (const entry of archiveEntries) {
    if (!entry.isFile() || !expectedArchives.has(entry.name)) {
      throw new Error(`Unexpected release candidate artifact: ${entry.name}`);
    }
    actualArchives.add(entry.name);
  }
  for (const file of expectedArchives) {
    if (!actualArchives.has(file)) {
      throw new Error(`Release candidate artifact is missing: ${file}`);
    }
  }
  for (const artifact of evidence.artifacts) {
    const archive = join(archivesDirectory, artifact.file);
    const details = await readArtifactDetails(archive);
    if (details.sha256 !== artifact.sha256) {
      throw new Error(`Archive SHA-256 differs for ${artifact.name}.`);
    }
    if (details.npmIntegrity !== artifact.npmIntegrity) {
      throw new Error(`npm integrity differs for ${artifact.name}.`);
    }
    if (details.packageManifestSha256 !== artifact.packageManifestSha256) {
      throw new Error(`package manifest SHA-256 differs for ${artifact.name}.`);
    }
    if (canonicalJson(details.inventory) !== canonicalJson(artifact.inventory)) {
      throw new Error(`package inventory differs for ${artifact.name}.`);
    }
  }

  const workspace = await mkdtemp(join(tmpdir(), "sayhi-release-verification-"));
  try {
    const installation = join(workspace, "installation");
    await installArtifactPackages(
      installation,
      evidence.artifacts.map((artifact) => join(archivesDirectory, artifact.file)),
    );
    const installedRelease = await readInstalledRelease(installation);
    const expectedRelease = {
      source: evidence.source,
      release: evidence.release,
    };
    if (canonicalJson(installedRelease) !== canonicalJson(expectedRelease)) {
      throw new Error(
        "Installed Core, CLI, and OMP metadata differs from release evidence.",
      );
    }
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }
  return evidence;
}

async function createReleaseCandidate(outputDirectory) {
  const output = resolve(outputDirectory);
  await assertCleanRepository(repositoryRoot);
  await assertAbsent(output, "Release candidate output");
  const revision = await runGit(repositoryRoot, ["rev-parse", "HEAD"]);
  const workspace = await mkdtemp(join(tmpdir(), "sayhi-release-candidate-"));
  try {
    const first = await buildCandidate(repositoryRoot, revision, join(workspace, "first"));
    const second = await buildCandidate(repositoryRoot, revision, join(workspace, "second"));
    const exitGates = await runFullV1Acceptance(first.checkout);
    const installedAcceptance = await runInstalledAcceptance(first);
    const evidence = createReleaseEvidence(
      first.evidence,
      second.evidence,
      exitGates,
      installedAcceptance,
    );

    await mkdir(join(output, "artifacts"), { recursive: true });
    await Promise.all(
      first.releaseArtifacts.map((artifact) =>
        cp(artifact.archive, join(output, "artifacts", artifact.evidence.file)),
      ),
    );
    await writeFile(
      join(output, "release-evidence.json"),
      `${JSON.stringify(evidence, null, 2)}\n`,
      "utf8",
    );
    await verifyReleaseCandidateDirectory(output);
    return evidence;
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }
}

async function verifiedToolchain(checkout) {
  const packageManifest = JSON.parse(await readFile(join(checkout, "package.json"), "utf8"));
  const manifest = isRecord(packageManifest) ? packageManifest : null;
  const engines = manifest !== null && isRecord(manifest.engines) ? manifest.engines : null;
  const npm = (await runNpm(checkout, ["--version"])).trim();
  return {
    node: verifyNodeToolchain(engines?.node, process.version),
    npm: verifyNpmToolchain(manifest?.packageManager, npm),
  };
}

async function buildCandidate(source, revision, workspace) {
  const checkout = join(workspace, "checkout");
  await runCommand("git", ["clone", "--quiet", "--no-local", source, checkout]);
  await runGit(checkout, ["checkout", "--quiet", "--detach", revision]);
  const toolchain = await verifiedToolchain(checkout);
  await runNpm(checkout, ["ci"]);
  await runNpm(checkout, ["run", "build"]);

  const artifactsDirectory = join(workspace, "artifacts");
  await mkdir(artifactsDirectory, { recursive: true });
  const releaseArtifacts = [];
  for (const descriptor of releasePackages) {
    releaseArtifacts.push(
      await packWorkspacePackage(checkout, artifactsDirectory, descriptor),
    );
  }
  const testingArtifact = await packWorkspacePackage(checkout, artifactsDirectory, {
    name: "testing",
    packageName: testingPackage,
  });

  const installation = join(workspace, "metadata-installation");
  await installArtifactPackages(installation, [
    ...releaseArtifacts.map((artifact) => artifact.archive),
    testingArtifact.archive,
  ]);
  const installedRelease = await readInstalledRelease(installation);
  const packageLockSha256 = await sha256File(join(checkout, "package-lock.json"));
  const sourceRevision = `git:${revision}`;
  if (installedRelease.source.revision !== sourceRevision) {
    throw new Error("Installed release provenance does not match the checked-out source revision.");
  }

  return {
    checkout,
    evidence: {
      source: installedRelease.source,
      dependencies: {
        packageLockSha256,
        node: toolchain.node,
        npm: toolchain.npm,
      },
      release: installedRelease.release,
      artifacts: releaseArtifacts.map((artifact) => artifact.evidence),
    },
    releaseArtifacts,
    testingArtifact,
  };
}

async function packWorkspacePackage(checkout, artifactsDirectory, descriptor) {
  const packed = JSON.parse(
    await runNpm(checkout, [
      "pack",
      `--workspace=${descriptor.packageName}`,
      "--json",
      "--pack-destination",
      artifactsDirectory,
    ]),
  );
  if (!Array.isArray(packed) || packed.length !== 1 || !isRecord(packed[0])) {
    throw new Error(`npm pack did not return one manifest for ${descriptor.packageName}.`);
  }
  const manifest = packed[0];
  const filename = readString(manifest.filename, `${descriptor.packageName} package filename`);
  if (filename !== basename(filename) || !filename.endsWith(".tgz")) {
    throw new Error(`npm pack returned an unsafe filename for ${descriptor.packageName}.`);
  }
  const archive = join(artifactsDirectory, filename);
  const details = await readArtifactDetails(archive);
  return {
    archive,
    evidence: {
      name: descriptor.name,
      packageName: descriptor.packageName,
      file: filename,
      sha256: details.sha256,
      npmIntegrity: details.npmIntegrity,
      packageManifestSha256: details.packageManifestSha256,
      inventory: details.inventory,
    },
  };
}

async function runInstalledAcceptance(candidate) {
  const installation = join(dirname(candidate.testingArtifact.archive), "acceptance-installation");
  await installArtifactPackages(installation, [
    ...candidate.releaseArtifacts.map((artifact) => artifact.archive),
    candidate.testingArtifact.archive,
  ]);
  const testDirectory = join(
    installation,
    "node_modules",
    "@sayhi",
    "testing",
    "dist",
  );
  const installedMatrix = await import(
    pathToFileURL(join(testDirectory, "installed-contract-matrix.js")).href,
  );
  const contractFiles = normalizeInstalledContractFiles(
    installedMatrix.INSTALLED_CONTRACT_FILES,
  );
  if (canonicalJson(contractFiles) !== canonicalJson(trustedInstalledContractFiles)) {
    throw new Error("Installed testing artifact contract matrix differs from the V1 matrix.");
  }
  const tests = contractFiles.map((file) => join(testDirectory, file));
  await runCommand(process.execPath, ["--test", ...tests], installation, {
    ...process.env,
    SAYHI_INSTALLED_CONTRACTS: "1",
  });
  return {
    command: "node --test installed @sayhi/testing contract matrix",
    contractFiles,
    status: "passed",
  };
}

function normalizeInstalledContractFiles(files) {
  if (!Array.isArray(files) || files.length === 0) {
    throw new Error("The installed testing artifact has no contract tests.");
  }
  const names = files.map((file) => {
    if (
      typeof file !== "string" ||
      !/^[A-Za-z0-9][A-Za-z0-9._-]*\.contract\.test\.js$/u.test(file)
    ) {
      throw new Error("The installed testing artifact has an unsafe contract test path.");
    }
    return file;
  });
  names.sort();
  if (new Set(names).size !== names.length) {
    throw new Error("The installed testing artifact repeats a contract test.");
  }
  return names;
}

async function installArtifactPackages(installation, archives) {
  await mkdir(installation, { recursive: true });
  await writeFile(
    join(installation, "package.json"),
    '{"name":"sayhi-release-candidate-verification","private":true,"type":"module"}\n',
    "utf8",
  );
  await runNpm(installation, [
    "install",
    "--offline",
    "--no-audit",
    "--no-fund",
    "--ignore-scripts",
    "--no-save",
    ...archives,
  ]);
}

async function readInstalledRelease(installation) {
  const core = await import(
    pathToFileURL(
      join(installation, "node_modules", "@dnslin", "sayhi-core", "dist", "index.js"),
    ).href,
  );
  const cli = await import(
    pathToFileURL(
      join(installation, "node_modules", "@dnslin", "sayhi-cli", "dist", "index.js"),
    ).href,
  );
  const omp = await import(
    pathToFileURL(
      join(installation, "node_modules", "@dnslin", "sayhi-omp", "dist", "index.js"),
    ).href,
  );
  const releaseArtifacts = omp.OMP_MARKETPLACE_METADATA?.releaseArtifacts;
  const verified = core.coreContract?.verifyTrustedCoordinatedReleaseArtifacts(
    releaseArtifacts,
  );
  if (!verified?.ok) {
    throw new Error("Installed release artifacts are not trusted by Core.");
  }
  if (
    canonicalJson(cli.CLI_RELEASE_ARTIFACT) !==
      canonicalJson(releaseArtifacts.artifacts.cli) ||
    canonicalJson(omp.OMP_RELEASE_ARTIFACT) !==
      canonicalJson(releaseArtifacts.artifacts.omp)
  ) {
    throw new Error("Installed CLI or OMP metadata differs from Core's release declaration.");
  }
  return {
    source: releaseArtifacts.artifacts.core.provenance,
    release: {
      integrity: releaseArtifacts.integrity,
      skillBundle: {
        lockIdentity: releaseArtifacts.artifacts.core.compatibility.skillLockDigest,
        lock: releaseArtifacts.skillBundle.lock,
        files: releaseArtifacts.skillBundle.files,
      },
      compatibility: releaseArtifacts.artifacts.core.compatibility,
    },
  };
}

async function runFullV1Acceptance(checkout) {
  await runNpm(checkout, ["test"]);
  return milestoneGates.map((milestone) => ({
    milestone,
    command: "npm test",
    status: "passed",
  }));
}

function normalizeBuild(build) {
  if (!isRecord(build)) {
    throw new Error("Release build evidence must be an object.");
  }
  requireExactKeys(build, ["source", "dependencies", "release", "artifacts"], "Release build evidence");
  return {
    source: normalizeSource(build.source),
    dependencies: normalizeDependencies(build.dependencies),
    release: normalizeRelease(build.release),
    artifacts: normalizeArtifacts(build.artifacts),
  };
}

function normalizeSource(source) {
  if (!isRecord(source)) {
    throw new Error("Release source must be an object.");
  }
  requireExactKeys(source, ["repository", "revision"], "Release source");
  const repository = readString(source.repository, "Release source repository");
  const revision = readString(source.revision, "Release source revision");
  if (!/^git:[0-9a-f]{40}$/u.test(revision)) {
    throw new Error("Release source revision must be a full Git revision.");
  }
  return { repository, revision };
}

function normalizeDependencies(dependencies) {
  if (!isRecord(dependencies)) {
    throw new Error("Release dependencies must be an object.");
  }
  requireExactKeys(
    dependencies,
    ["packageLockSha256", "node", "npm"],
    "Release dependencies",
  );
  const node = readString(dependencies.node, "Release Node version");
  const npm = readString(dependencies.npm, "Release npm version");
  if (!/^v\d+\.\d+\.\d+/u.test(node)) {
    throw new Error("Release Node version is invalid.");
  }
  if (!/^\d+\.\d+\.\d+/u.test(npm)) {
    throw new Error("Release npm version is invalid.");
  }
  return {
    packageLockSha256: readSha256(
      dependencies.packageLockSha256,
      "package-lock",
    ),
    node,
    npm,
  };
}

function normalizeRelease(release) {
  if (!isRecord(release)) {
    throw new Error("Release declaration must be an object.");
  }
  requireExactKeys(release, ["integrity", "skillBundle", "compatibility"], "Release declaration");
  const skillBundle = normalizeSkillBundle(release.skillBundle);
  const compatibility = normalizeCompatibility(release.compatibility);
  if (compatibility.skillLockDigest !== skillBundle.lockIdentity) {
    throw new Error("Release compatibility Skill Lock digest differs from its Skill Bundle.");
  }
  return {
    integrity: readSha256(release.integrity, "release"),
    skillBundle,
    compatibility,
  };
}

function normalizeSkillBundle(skillBundle) {
  if (!isRecord(skillBundle)) {
    throw new Error("Release Skill Bundle must be an object.");
  }
  requireExactKeys(skillBundle, ["lockIdentity", "lock", "files"], "Release Skill Bundle");
  if (!isRecord(skillBundle.lock) || !Array.isArray(skillBundle.files)) {
    throw new Error("Release Skill Bundle must contain a lock and complete file set.");
  }
  return {
    lockIdentity: readSha256(skillBundle.lockIdentity, "Skill Lock"),
    lock: cloneJson(skillBundle.lock, "Skill Lock"),
    files: cloneJson(skillBundle.files, "Skill Bundle files"),
  };
}

function normalizeCompatibility(compatibility) {
  if (!isRecord(compatibility)) {
    throw new Error("Release compatibility must be an object.");
  }
  requireExactKeys(
    compatibility,
    [
      "recordContract",
      "managedProjectContract",
      "projectSchema",
      "templates",
      "skillBundleContract",
      "skillLockDigest",
    ],
    "Release compatibility",
  );
  return {
    recordContract: readPositiveInteger(compatibility.recordContract, "record contract"),
    managedProjectContract: readPositiveInteger(
      compatibility.managedProjectContract,
      "Managed Project contract",
    ),
    projectSchema: readPositiveInteger(compatibility.projectSchema, "project schema"),
    templates: readString(compatibility.templates, "template version"),
    skillBundleContract: readPositiveInteger(
      compatibility.skillBundleContract,
      "Skill Bundle contract",
    ),
    skillLockDigest: readSha256(compatibility.skillLockDigest, "Skill Lock digest"),
  };
}

function normalizeArtifacts(artifacts) {
  if (!Array.isArray(artifacts) || artifacts.length !== releasePackages.length) {
    throw new Error("Release evidence must contain exactly Core, CLI, and OMP artifacts.");
  }
  const expected = new Map(releasePackages.map((artifact) => [artifact.name, artifact]));
  const normalized = artifacts.map((artifact) => {
    if (!isRecord(artifact)) {
      throw new Error("Release artifact evidence must be an object.");
    }
    requireExactKeys(
      artifact,
      [
        "name",
        "packageName",
        "file",
        "sha256",
        "npmIntegrity",
        "packageManifestSha256",
        "inventory",
      ],
      "Release artifact evidence",
    );
    const name = readString(artifact.name, "artifact name");
    const expectedArtifact = expected.get(name);
    if (expectedArtifact === undefined) {
      throw new Error(`Release artifact ${name} is not a coordinated artifact.`);
    }
    if (artifact.packageName !== expectedArtifact.packageName) {
      throw new Error(`Release artifact ${name} has an unexpected package name.`);
    }
    const file = readString(artifact.file, `${name} archive filename`);
    if (file !== basename(file) || !/^[A-Za-z0-9][A-Za-z0-9._-]*\.tgz$/u.test(file)) {
      throw new Error(`Release artifact ${name} archive filename is unsafe.`);
    }
    return {
      name,
      packageName: expectedArtifact.packageName,
      file,
      sha256: readSha256(artifact.sha256, `artifact ${name}`),
      npmIntegrity: readNpmIntegrity(artifact.npmIntegrity, `artifact ${name}`),
      packageManifestSha256: readSha256(
        artifact.packageManifestSha256,
        `${name} package manifest`,
      ),
      inventory: normalizeInventory(artifact.inventory),
    };
  });
  normalized.sort((left, right) => left.name.localeCompare(right.name));
  if (new Set(normalized.map((artifact) => artifact.name)).size !== releasePackages.length) {
    throw new Error("Release artifact evidence contains duplicate artifacts.");
  }
  return normalized;
}

function normalizeInventory(inventory) {
  if (!Array.isArray(inventory) || inventory.length === 0) {
    throw new Error("Release artifact inventory must be a non-empty array.");
  }
  const normalized = inventory.map((entry) => {
    if (!isRecord(entry)) {
      throw new Error("Release artifact inventory entry must be an object.");
    }
    requireExactKeys(entry, ["path", "size", "mode"], "Release artifact inventory entry");
    const path = readString(entry.path, "inventory path");
    if (!isSafeRelativePath(path)) {
      throw new Error("Release artifact inventory path is unsafe.");
    }
    return {
      path,
      size: readNonNegativeInteger(entry.size, "inventory size"),
      mode: readPositiveInteger(entry.mode, "inventory mode"),
    };
  });
  normalized.sort((left, right) => left.path.localeCompare(right.path));
  if (new Set(normalized.map((entry) => entry.path)).size !== normalized.length) {
    throw new Error("Release artifact inventory contains duplicate paths.");
  }
  return normalized;
}

function normalizeExitGates(exitGates) {
  if (!Array.isArray(exitGates)) {
    throw new Error("Release evidence must record Milestone Exit Gates as an array.");
  }
  const normalized = exitGates.map((gate) => {
    if (!isRecord(gate)) {
      throw new Error("Milestone Exit Gate evidence must be an object.");
    }
    requireExactKeys(gate, ["milestone", "command", "status"], "Milestone Exit Gate evidence");
    const milestone = gate.milestone;
    if (!Number.isInteger(milestone) || !milestoneGates.includes(milestone)) {
      throw new Error("Milestone Exit Gate evidence has an unknown milestone.");
    }
    if (gate.status !== "passed") {
      throw new Error(`Milestone ${milestone} Exit Gate did not pass.`);
    }
    return {
      milestone,
      command: readString(gate.command, `Milestone ${milestone} command`),
      status: "passed",
    };
  });
  normalized.sort((left, right) => left.milestone - right.milestone);
  for (const milestone of milestoneGates) {
    const matching = normalized.filter((gate) => gate.milestone === milestone);
    if (matching.length === 0) {
      throw new Error(`Release evidence is missing Milestone ${milestone} Exit Gate evidence.`);
    }
    if (matching.length > 1) {
      throw new Error(`Release evidence contains duplicate Milestone ${milestone} Exit Gate evidence.`);
    }
  }
  if (normalized.length !== milestoneGates.length) {
    throw new Error("Release evidence contains unexpected Milestone Exit Gate evidence.");
  }
  return normalized;
}

function normalizeInstalledAcceptance(installedAcceptance) {
  if (!isRecord(installedAcceptance)) {
    throw new Error("Installed acceptance evidence must be an object.");
  }
  requireExactKeys(
    installedAcceptance,
    ["command", "contractFiles", "status"],
    "Installed acceptance evidence",
  );
  if (installedAcceptance.status !== "passed") {
    throw new Error("Installed acceptance did not pass.");
  }
  const contractFiles = normalizeInstalledContractFiles(installedAcceptance.contractFiles);
  if (canonicalJson(contractFiles) !== canonicalJson(trustedInstalledContractFiles)) {
    throw new Error("Installed acceptance contract files differ from the trusted V1 matrix.");
  }
  return {
    command: readString(installedAcceptance.command, "installed acceptance command"),
    contractFiles,
    status: "passed",
  };
}

async function assertCleanRepository(root) {
  const status = await runGit(root, ["status", "--porcelain", "--untracked-files=all"]);
  if (status !== "") {
    throw new Error("Release candidate creation requires a clean Git worktree.");
  }
}

async function assertAbsent(path, description) {
  try {
    await stat(path);
  } catch (error) {
    if (error && typeof error === "object" && error.code === "ENOENT") {
      return;
    }
    throw error;
  }
  throw new Error(`${description} already exists: ${path}`);
}

function resolveRequiredDirectory(path, description) {
  if (typeof path !== "string" || path.length === 0) {
    throw new Error(`${description} is required.`);
  }
  return resolve(path);
}

async function runGit(cwd, arguments_) {
  return (await runCommand("git", arguments_, cwd)).trim();
}

async function runNpm(cwd, arguments_) {
  return runCommand(
    npmExecutable,
    process.platform === "win32" ? [npmCliEntryPoint, ...arguments_] : arguments_,
    cwd,
  );
}

async function runCommand(executable, arguments_, cwd = undefined, env = undefined) {
  try {
    const { stdout } = await execFileAsync(executable, arguments_, {
      cwd,
      env,
      encoding: "utf8",
      maxBuffer: 16 * 1024 * 1024,
      windowsHide: true,
    });
    return stdout;
  } catch (error) {
    const detail =
      error && typeof error === "object" && typeof error.stderr === "string"
        ? error.stderr.trim()
        : "";
    const command = [executable, ...arguments_].join(" ");
    throw new Error(detail === "" ? `Command failed: ${command}` : `${command}: ${detail}`);
  }
}

function sha256Content(content) {
  return `sha256:${createHash("sha256").update(content).digest("hex")}`;
}

function npmIntegrityContent(content) {
  return `sha512-${createHash("sha512").update(content).digest("base64")}`;
}

async function sha256File(path) {
  return sha256Content(await readFile(path));
}

async function readArtifactDetails(path) {
  const archive = await readFile(path);
  const contents = readPackageContents(archive);
  return {
    sha256: sha256Content(archive),
    npmIntegrity: npmIntegrityContent(archive),
    packageManifestSha256: sha256Content(contents.packageManifest),
    inventory: contents.inventory,
  };
}

function readPackageContents(archive) {
  const entries = readTarEntries(archive);
  const packageManifest = entries.find((entry) => entry.path === "package.json");
  if (packageManifest === undefined) {
    throw new Error("Release artifact archive does not contain package/package.json.");
  }
  return {
    packageManifest: packageManifest.content,
    inventory: entries
      .map(({ path, size, mode }) => ({ path, size, mode }))
      .sort((left, right) => left.path.localeCompare(right.path)),
  };
}

function readTarEntries(archive) {
  let tarball;
  try {
    tarball = gunzipSync(archive);
  } catch {
    throw new Error("Release artifact archive is not a valid gzip tarball.");
  }
  const entries = [];
  for (let offset = 0; offset + 512 <= tarball.length; ) {
    const header = tarball.subarray(offset, offset + 512);
    if (isZeroBlock(header)) {
      break;
    }
    const size = readTarEntrySize(header);
    const contentOffset = offset + 512;
    const contentEnd = contentOffset + size;
    if (contentEnd > tarball.length) {
      throw new Error("Release artifact tarball has a truncated entry.");
    }
    const packagePath = readTarPackagePath(readTarEntryPath(header));
    if (isRegularTarFile(header)) {
      if (packagePath === null) {
        throw new Error("Release artifact tarball has an invalid package entry type.");
      }
      entries.push({
        path: packagePath,
        size,
        mode: readTarEntryMode(header),
        content: tarball.subarray(contentOffset, contentEnd),
      });
    }
    offset = contentOffset + Math.ceil(size / 512) * 512;
  }
  return entries;
}

function isRegularTarFile(header) {
  return header[156] === 0 || header[156] === "0".charCodeAt(0);
}

function readTarPackagePath(path) {
  if (path === "package" || path === "package/") {
    return null;
  }
  if (!path.startsWith("package/") || !isSafeRelativePath(path.slice("package/".length))) {
    throw new Error("Release artifact tarball has an unsafe package entry path.");
  }
  return path.slice("package/".length);
}

function readTarEntryPath(header) {
  const name = readTarString(header, 0, 100);
  const prefix = readTarString(header, 345, 155);
  return prefix === "" ? name : `${prefix}/${name}`;
}

function readTarEntryMode(header) {
  const value = readTarString(header, 100, 8).trim();
  if (!/^[0-7]+$/u.test(value)) {
    throw new Error("Release artifact tarball has an invalid entry mode.");
  }
  return Number.parseInt(value, 8);
}

function readTarEntrySize(header) {
  const value = readTarString(header, 124, 12).trim();
  if (!/^[0-7]+$/u.test(value)) {
    throw new Error("Release artifact tarball has an invalid entry length.");
  }
  const size = Number.parseInt(value, 8);
  if (!Number.isSafeInteger(size)) {
    throw new Error("Release artifact tarball entry length is unsafe.");
  }
  return size;
}

function readTarString(buffer, offset, length) {
  const end = buffer.indexOf(0, offset);
  return buffer.toString("utf8", offset, end === -1 || end > offset + length ? offset + length : end);
}

function isZeroBlock(block) {
  for (const byte of block) {
    if (byte !== 0) {
      return false;
    }
  }
  return true;
}

function readSha256(value, description) {
  if (typeof value !== "string" || !/^sha256:[0-9a-f]{64}$/u.test(value)) {
    throw new Error(`Invalid ${description} SHA-256 identity.`);
  }
  return value;
}

function readNpmIntegrity(value, description) {
  if (
    typeof value !== "string" ||
    !/^sha(?:256|384|512)-[A-Za-z0-9+/]+={0,2}$/u.test(value)
  ) {
    throw new Error(`Invalid ${description} npm integrity.`);
  }
  return value;
}

function readString(value, description) {
  if (typeof value !== "string" || value.length === 0) {
    throw new Error(`${description} must be a non-empty string.`);
  }
  return value;
}

function readPositiveInteger(value, description) {
  if (!Number.isInteger(value) || value <= 0) {
    throw new Error(`${description} must be a positive integer.`);
  }
  return value;
}

function readNonNegativeInteger(value, description) {
  if (!Number.isInteger(value) || value < 0) {
    throw new Error(`${description} must be a non-negative integer.`);
  }
  return value;
}

function isSafeRelativePath(path) {
  return (
    path.length > 0 &&
    !path.startsWith("/") &&
    !path.startsWith("\\") &&
    !path.includes("\\") &&
    path.split("/").every((part) => part.length > 0 && part !== "." && part !== "..")
  );
}

function requireExactKeys(value, expected, description) {
  const actual = Object.keys(value).sort();
  const sortedExpected = [...expected].sort();
  if (
    actual.length !== sortedExpected.length ||
    actual.some((key, index) => key !== sortedExpected[index])
  ) {
    throw new Error(`${description} has unexpected fields.`);
  }
}

function cloneJson(value, description) {
  try {
    return JSON.parse(JSON.stringify(value));
  } catch {
    throw new Error(`${description} must be JSON-serializable.`);
  }
}

function canonicalJson(value) {
  if (Array.isArray(value)) {
    return `[${value.map((entry) => canonicalJson(entry)).join(",")}]`;
  }
  if (isRecord(value)) {
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

function deepFreeze(value) {
  if (Array.isArray(value)) {
    for (const entry of value) {
      deepFreeze(entry);
    }
  } else if (isRecord(value)) {
    for (const entry of Object.values(value)) {
      deepFreeze(entry);
    }
  }
  return Object.freeze(value);
}

function isRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

async function main() {
  const [command, ...arguments_] = process.argv.slice(2);
  if (command === "create") {
    const output = readOption(arguments_, "--output");
    const evidence = await createReleaseCandidate(output);
    process.stdout.write(
      `${JSON.stringify({ ok: true, integrity: evidence.release.integrity }, null, 2)}\n`,
    );
    return;
  }
  if (command === "verify") {
    const input = readOption(arguments_, "--input");
    const evidence = await verifyReleaseCandidateDirectory(input);
    process.stdout.write(
      `${JSON.stringify({ ok: true, integrity: evidence.release.integrity }, null, 2)}\n`,
    );
    return;
  }
  throw new Error(
    "Usage: release-candidate.mjs create --output <directory> | verify --input <directory>",
  );
}

function readOption(arguments_, name) {
  if (arguments_.length !== 2 || arguments_[0] !== name) {
    throw new Error(`Expected ${name} <directory>.`);
  }
  return resolveRequiredDirectory(arguments_[1], name);
}

if (process.argv[1] !== undefined && resolve(process.argv[1]) === scriptPath) {
  main().catch((error) => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  });
}
