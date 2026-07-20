import { spawn } from "node:child_process";
import { once } from "node:events";
import {
  link,
  lstat,
  mkdir,
  open,
  readFile,
  readlink,
  readdir,
  realpath,
  rename,
  rm,
  type FileHandle,
} from "node:fs/promises";
import { createHash, randomUUID } from "node:crypto";
import { basename, dirname, join, parse, relative, resolve, sep } from "node:path";
import { setTimeout as delay } from "node:timers/promises";

import type {
  BaselineRecord,
  ManagedProjectMutationFileSystem,
  ManagedProjectPathKind,
  TaskBaselineCaptureRequest,
  TaskBaselineFileSystem,
  TaskCommitPort,
  TaskCommitRepositoryState,
  TaskCommitRequest,
  TaskCommitResult,
  TaskWriter,
} from "@dnslin/sayhi-core";

const TASK_BASELINE_EXCLUDED_PREFIXES = [
  ".sayhi/tasks",
  ".sayhi/.runtime",
] as const;


export class NodeManagedProjectFileSystem
  implements ManagedProjectMutationFileSystem, TaskBaselineFileSystem, TaskCommitPort
{
  readonly #repositoryRoot: string;

  constructor(repositoryRoot: string) {
    this.#repositoryRoot = resolve(repositoryRoot);
  }

  async inspect(path: string): Promise<Readonly<{ kind: ManagedProjectPathKind }>> {
    return this.#inspectPath(this.#resolveManagedPath(path));
  }

  async inspectRepositoryPath(
    path: string,
  ): Promise<Readonly<{ kind: ManagedProjectPathKind }>> {
    const entry = await this.#inspectPath(this.#resolveRepositoryPath(path));
    if (entry.kind === "file") {
      await this.#resolveReadableRepositoryPath(path);
    }
    return entry;
  }

  async listDirectory(path: string) {
    const entries = await readdir(this.#resolveManagedPath(path), {
      withFileTypes: true,
    });
    return Object.freeze(
      entries
        .map((entry) => {
          const kind: ManagedProjectPathKind = entry.isSymbolicLink()
            ? "symlink"
            : entry.isFile()
              ? "file"
              : entry.isDirectory()
                ? "directory"
                : "other";
          return Object.freeze({ name: entry.name, kind });
        })
        .sort((left, right) => left.name.localeCompare(right.name)),
    );
  }

  async readFile(path: string): Promise<string> {
    return readFile(this.#resolveManagedPath(path), "utf8");
  }

  async readRepositoryFile(path: string): Promise<string> {
    return readFile(await this.#resolveReadableRepositoryPath(path), "utf8");
  }

  async createDirectory(path: string): Promise<void> {
    await mkdir(this.#resolveManagedPath(path));
  }

  async writeFile(path: string, content: string): Promise<void> {
    await writeAtomically(this.#resolveManagedPath(path), content);
  }

  async appendFile(path: string, content: string): Promise<void> {
    const handle = await open(this.#resolveManagedPath(path), "a");
    try {
      await handle.writeFile(content, "utf8");
      await handle.sync();
    } finally {
      await handle.close();
    }
  }

  async moveDirectory(source: string, target: string): Promise<void> {
    await rename(
      this.#resolveManagedPath(source),
      this.#resolveManagedPath(target),
    );
  }

  async withTaskMutationLock<Result>(
    path: string,
    operation: () => Promise<Result>,
  ): Promise<Result> {
    return runWithExclusiveLock(
      this.#resolveManagedPath(path),
      `Task mutation lock: ${path}`,
      operation,
    );
  }

  async captureBaseline(
    request: TaskBaselineCaptureRequest,
  ): Promise<BaselineRecord> {
    const excludedPrefixes = TASK_BASELINE_EXCLUDED_PREFIXES;
    const [
      repositoryRoot,
      head,
      stagedPaths,
      unstagedPaths,
      untrackedPaths,
      ignoredPaths,
      submodules,
    ] = await Promise.all([
      realpath(this.#repositoryRoot),
      readGitHead(this.#repositoryRoot),
      listGitPaths(this.#repositoryRoot, [
        "diff",
        "--cached",
        "--name-only",
        "-z",
        "--no-renames",
      ]),
      listGitPaths(this.#repositoryRoot, [
        "diff",
        "--name-only",
        "-z",
        "--no-renames",
      ]),
      listGitPaths(this.#repositoryRoot, [
        "ls-files",
        "--others",
        "--exclude-standard",
        "-z",
      ]),
      listGitPaths(this.#repositoryRoot, [
        "ls-files",
        "--others",
        "--ignored",
        "--exclude-standard",
        "-z",
      ]),
      runGit(this.#repositoryRoot, ["submodule", "status", "--recursive"]),
    ]);
    const allUntrackedPaths = uniquePaths([
      ...untrackedPaths,
      ...ignoredPaths,
    ]);
    const trackedPaths = uniquePaths([...stagedPaths, ...unstagedPaths]).filter(
      (path) => !isExcludedBaselinePath(path, excludedPrefixes),
    );
    const trackedChanges = await Promise.all(
      trackedPaths.map(async (path) => {
        const [indexDiff, worktreeDiff] = await Promise.all([
          runGit(this.#repositoryRoot, [
            "diff",
            "--cached",
            "--binary",
            "--no-ext-diff",
            "--no-renames",
            "--",
            path,
          ]),
          runGit(this.#repositoryRoot, [
            "diff",
            "--binary",
            "--no-ext-diff",
            "--no-renames",
            "--",
            path,
          ]),
        ]);
        return Object.freeze({ path, indexDiff, worktreeDiff });
      }),
    );
    const untracked = await Promise.all(
      allUntrackedPaths
        .filter((path) => !isExcludedBaselinePath(path, excludedPrefixes))
        .map(async (path) => {
          const content = await readBaselineFileBytes(
            this.#resolveRepositoryPath(path),
          );
          return Object.freeze({
            path,
            identity: Object.freeze({
              algorithm: "sha256-bytes-v1" as const,
              digest: digestBytes(content),
            }),
          });
        }),
    );
    const dirtyPaths = [
      ...trackedChanges.map((change) =>
        Object.freeze({
          path: change.path,
          identity: digestBuffers([
            Buffer.from("index\0"),
            change.indexDiff,
            Buffer.from("worktree\0"),
            change.worktreeDiff,
          ]),
        }),
      ),
      ...untracked.map((entry) =>
        Object.freeze({
          path: entry.path,
          identity: `sha256:${entry.identity.digest}` as const,
        }),
      ),
    ].sort((left, right) => left.path.localeCompare(right.path));
    return Object.freeze({
      schemaVersion: 1,
      capturedAt: new Date().toISOString(),
      repositoryRootIdentity: digestBytes(Buffer.from(repositoryRoot)),
      head,
      indexDigest: digestNamedBuffers(
        trackedChanges.map((change) => ({
          name: change.path,
          value: change.indexDiff,
        })),
      ),
      trackedWorktreeDigest: digestNamedBuffers(
        trackedChanges.map((change) => ({
          name: change.path,
          value: change.worktreeDiff,
        })),
      ),
      untracked: Object.freeze(untracked),
      submodulesDigest: digestBuffers([submodules]),
      dirtyPaths: Object.freeze(dirtyPaths),
      adoptedPaths: Object.freeze([...request.adoptedPaths]),
      declaredScope: Object.freeze({
        files: Object.freeze([...request.declaredScope.files]),
        apis: Object.freeze([...request.declaredScope.apis]),
        schemas: Object.freeze([...request.declaredScope.schemas]),
        locks: Object.freeze([...request.declaredScope.locks]),
      }),
    });
  }
  async inspectRepository(): Promise<TaskCommitRepositoryState> {
    const [head, stagedPaths] = await Promise.all([
      readGitHead(this.#repositoryRoot),
      listGitPaths(this.#repositoryRoot, [
        "diff",
        "--cached",
        "--name-only",
        "-z",
        "--no-renames",
      ]),
    ]);
    const filteredStagedPaths = Object.freeze(
      stagedPaths.filter((path) => !isTaskCommitExcludedPath(path)).sort(),
    );
    if (head === null) {
      return Object.freeze({
        head: null,
        headParent: null,
        headMessage: null,
        headPaths: Object.freeze([]),
        stagedPaths: filteredStagedPaths,
      });
    }
    const [headParent, headMessage, headPaths] = await Promise.all([
      readGitCommitParent(this.#repositoryRoot, head),
      readGitCommitMessage(this.#repositoryRoot, head),
      listGitPaths(this.#repositoryRoot, [
        "diff-tree",
        "--no-commit-id",
        "--name-only",
        "-r",
        "-z",
        head,
      ]),
    ]);
    return Object.freeze({
      head,
      headParent,
      headMessage,
      headPaths: Object.freeze([...headPaths].sort()),
      stagedPaths: filteredStagedPaths,
    });
  }

  async commit(request: TaskCommitRequest): Promise<TaskCommitResult> {
    const paths = Object.freeze([...new Set(request.paths)].sort());
    if (paths.length === 0) {
      throw new Error("Constrained Task commit requires at least one path.");
    }
    for (const path of paths) {
      this.#resolveRepositoryPath(path);
    }
    const head = await readGitHead(this.#repositoryRoot);
    if (head !== request.expectedHead) {
      throw new Error("Repository HEAD changed before constrained Task commit.");
    }
    const currentBaseline = await this.captureBaseline({
      taskId: "task-commit",
      declaredScope: request.expectedBaseline.declaredScope,
      adoptedPaths: request.expectedBaseline.adoptedPaths,
    });
    if (!sameBaselineMaterial(request.expectedBaseline, currentBaseline)) {
      throw new Error("Repository state changed before constrained Task commit.");
    }
    const stagedTaskPaths = await listGitPaths(this.#repositoryRoot, [
      "diff",
      "--cached",
      "--name-only",
      "-z",
      "--no-renames",
      "--",
      ...paths,
    ]);
    if (stagedTaskPaths.length > 0) {
      throw new Error("Task-owned paths already contain staged content.");
    }
    await runGit(this.#repositoryRoot, ["add", "--all", "--", ...paths]);
    await runGit(this.#repositoryRoot, [
      "commit",
      "--no-verify",
      "--only",
      "-m",
      request.message,
      "--",
      ...paths,
    ]);
    const commit = await readGitHead(this.#repositoryRoot);
    if (commit === null) {
      throw new Error("Constrained Task commit did not produce a Git HEAD.");
    }
    const parent = (await runGit(this.#repositoryRoot, ["rev-parse", `${commit}^`]))
      .toString("utf8")
      .trim();
    const committedPaths = await listGitPaths(this.#repositoryRoot, [
      "diff-tree",
      "--no-commit-id",
      "--name-only",
      "-r",
      "-z",
      commit,
    ]);
    const finalBaseline = await this.captureBaseline({
      taskId: "task-commit",
      declaredScope: request.expectedBaseline.declaredScope,
      adoptedPaths: request.expectedBaseline.adoptedPaths,
    });
    return Object.freeze({
      commit,
      parent: parent.length === 0 ? null : parent,
      paths: Object.freeze([...committedPaths].sort()),
      finalBaseline,
    });
  }


  async withWriterMutationLock<Result>(
    operation: (writer: TaskWriter) => Promise<Result>,
  ): Promise<Result> {
    const writer = Object.freeze({
      writeFile: (path: string, content: string) =>
        this.#writeRepositoryFile(path, content),
    });
    return runWithExclusiveLock(
      this.#resolveManagedPath(".sayhi/.runtime/writer.lock"),
      "shared-checkout Writer lock",
      async () => {
        await waitForReaderLeases(this.#readerLeasesDirectory());
        return operation(writer);
      },
    );
  }

  async withSharedCheckoutWriterLock<Result>(
    operation: () => Promise<Result>,
  ): Promise<Result> {
    return this.withWriterMutationLock(async () => operation());
  }
  async acquireSharedCheckoutReaderLease(
    lease: Readonly<{ dispatchId: string; token: string }>,
  ): Promise<void> {
    const directory = this.#readerLeasesDirectory();
    const marker = join(directory, readerLeaseFileName(lease.dispatchId));
    const writerLock = this.#resolveManagedPath(".sayhi/.runtime/writer.lock");
    const deadline = Date.now() + 5_000;
    await mkdir(directory, { recursive: true });
    for (;;) {
      if (await pathExists(writerLock)) {
        if (Date.now() >= deadline) {
          throw new Error("Timed out waiting for the shared-checkout Writer.");
        }
        await delay(10);
        continue;
      }
      await claimReaderLease(marker, lease.token);
      if (!(await pathExists(writerLock))) {
        return;
      }
      await this.releaseSharedCheckoutReaderLease(lease);
      if (Date.now() >= deadline) {
        throw new Error("Timed out waiting for the shared-checkout Writer.");
      }
      await delay(10);
    }
  }
  async acquireSharedCheckoutReaderLeaseFromWriter(
    lease: Readonly<{ dispatchId: string; token: string }>,
  ): Promise<void> {
    const directory = this.#readerLeasesDirectory();
    await mkdir(directory, { recursive: true });
    await claimReaderLease(
      join(directory, readerLeaseFileName(lease.dispatchId)),
      lease.token,
    );
  }

  async assertSharedCheckoutReaderLease(
    lease: Readonly<{ dispatchId: string; token: string }>,
  ): Promise<void> {
    const marker = join(this.#readerLeasesDirectory(), readerLeaseFileName(lease.dispatchId));
    let token: string;
    try {
      token = await readFile(marker, "utf8");
    } catch (error) {
      if (isNotFound(error)) {
        throw new Error("Shared-checkout Reader Lease is missing.");
      }
      throw error;
    }
    if (token !== lease.token) {
      throw new Error("Shared-checkout Reader Lease ownership changed.");
    }
  }


  async releaseSharedCheckoutReaderLease(
    lease: Readonly<{ dispatchId: string; token: string }>,
  ): Promise<void> {
    if (!(await this.releaseSharedCheckoutReaderLeaseIfPresent(lease))) {
      throw new Error("Shared-checkout Reader Lease is missing.");
    }
  }

  async releaseSharedCheckoutReaderLeaseIfPresent(
    lease: Readonly<{ dispatchId: string; token: string }>,
  ): Promise<boolean> {
    const marker = join(this.#readerLeasesDirectory(), readerLeaseFileName(lease.dispatchId));
    let token: string;
    try {
      token = await readFile(marker, "utf8");
    } catch (error) {
      if (isNotFound(error)) {
        return false;
      }
      throw error;
    }
    if (token !== lease.token) {
      throw new Error("Shared-checkout Reader Lease ownership changed.");
    }
    await rm(marker);
    return true;
  }

  async #inspectPath(target: string): Promise<Readonly<{ kind: ManagedProjectPathKind }>> {
    try {
      const entry = await lstat(target);
      if (entry.isSymbolicLink()) {
        return { kind: "symlink" };
      }
      if (entry.isFile()) {
        return { kind: "file" };
      }
      if (entry.isDirectory()) {
        return { kind: "directory" };
      }
      return { kind: "other" };
    } catch (error) {
      if (isNotFound(error)) {
        return { kind: "missing" };
      }
      throw error;
    }
  }

  #readerLeasesDirectory(): string {
    return this.#resolveManagedPath(".sayhi/.runtime/readers");
  }


  async #writeRepositoryFile(path: string, content: string): Promise<void> {
    await writeAtomically(
      await this.#resolveWritableRepositoryPath(path),
      content,
    );
  }



  async removeFile(path: string): Promise<void> {
    await rm(this.#resolveManagedPath(path), { force: true });
  }

  #resolveManagedPath(path: string): string {
    if (path !== ".sayhi" && !path.startsWith(".sayhi/")) {
      throw new Error("Managed Project filesystem paths must stay inside .sayhi/.");
    }
    if (path.includes("\\") || path.split("/").includes("..")) {
      throw new Error("Managed Project filesystem paths must be repository-relative.");
    }
    const target = resolve(this.#repositoryRoot, ...path.split("/"));
    const fromRoot = relative(this.#repositoryRoot, target);
    if (fromRoot.startsWith("..") || resolve(target) === this.#repositoryRoot) {
      throw new Error("Managed Project filesystem path escaped the repository.");
    }
    return target;
  }

  #resolveRepositoryPath(path: string): string {
    if (
      path.length === 0 ||
      path.includes("\\") ||
      path.split("/").includes("..") ||
      path === ".git" ||
      path.startsWith(".git/")
    ) {
      throw new Error("Repository Writer path must be repository-relative.");
    }
    const target = resolve(this.#repositoryRoot, ...path.split("/"));
    const fromRoot = relative(this.#repositoryRoot, target);
    if (
      fromRoot.length === 0 ||
      fromRoot === ".." ||
      fromRoot.startsWith(`..${sep}`)
    ) {
      throw new Error("Repository Writer path escaped the repository.");
    }
    return target;
  }

  async #resolveReadableRepositoryPath(path: string): Promise<string> {
    const requested = this.#resolveRepositoryPath(path);
    const [root, target] = await Promise.all([
      realpath(this.#repositoryRoot),
      realpath(requested),
    ]);
    const fromRoot = relative(root, target);
    if (
      fromRoot.length === 0 ||
      fromRoot === ".." ||
      fromRoot.startsWith(`..${sep}`) ||
      !(await lstat(target)).isFile()
    ) {
      throw new Error("Context source must be a regular file inside the repository.");
    }
    return target;
  }


  async #resolveWritableRepositoryPath(path: string): Promise<string> {
    const requested = this.#resolveRepositoryPath(path);
    const segments = relative(this.#repositoryRoot, requested)
      .split(sep)
      .filter((segment) => segment.length > 0);
    const fileName = segments[segments.length - 1]!;
    let directory = await realpath(this.#repositoryRoot);
    for (const segment of segments.slice(0, -1)) {
      directory = join(directory, segment);
      await ensureRealDirectory(directory);
    }
    const target = join(directory, fileName);
    try {
      if ((await lstat(target)).isSymbolicLink()) {
        throw new Error("Repository Writer cannot replace a symbolic link.");
      }
    } catch (error) {
      if (!isNotFound(error)) {
        throw error;
      }
    }
    return target;
  }
}

async function writeAtomically(target: string, content: string): Promise<void> {
  const temporary = join(
    dirname(target),
    `.${basename(target)}.${randomUUID()}.tmp`,
  );
  let handle: FileHandle | undefined;
  try {
    handle = await open(temporary, "wx");
    await handle.writeFile(content, "utf8");
    await handle.sync();
    await handle.close();
    handle = undefined;
    await rename(temporary, target);
  } catch (error) {
    await handle?.close().catch(() => undefined);
    await rm(temporary, { force: true }).catch(() => undefined);
    throw error;
  }
}

async function readBaselineFileBytes(path: string): Promise<Buffer> {
  const entry = await lstat(path);
  if (entry.isSymbolicLink()) {
    return Buffer.from(await readlink(path));
  }
  if (!entry.isFile()) {
    throw new Error("Baseline cannot capture a non-file untracked path.");
  }
  return readFile(path);
}

async function ensureRealDirectory(path: string): Promise<void> {
  try {
    const entry = await lstat(path);
    if (entry.isSymbolicLink() || !entry.isDirectory()) {
      throw new Error("Repository Writer path contains a symbolic or non-directory parent.");
    }
  } catch (error) {
    if (!isNotFound(error)) {
      throw error;
    }
    await mkdir(path);
    const created = await lstat(path);
    if (created.isSymbolicLink() || !created.isDirectory()) {
      throw new Error("Repository Writer path contains an unsafe parent.");
    }
  }
}

class GitCommandError extends Error {
  readonly exitCode: number | null;

  constructor(exitCode: number | null) {
    super("Git command failed while capturing a repository Baseline.");
    this.exitCode = exitCode;
  }
}

async function runGit(
  repositoryRoot: string,
  arguments_: readonly string[],
): Promise<Buffer> {
  const child = spawn("git", arguments_, {
    cwd: repositoryRoot,
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: true,
  });
  const output: Buffer[] = [];
  child.stdout.on("data", (chunk: Buffer) => output.push(chunk));
  child.stderr.resume();
  const [code] = await once(child, "close");
  if (code !== 0) {
    throw new GitCommandError(code);
  }
  return Buffer.concat(output);
}

async function readGitHead(repositoryRoot: string): Promise<string | null> {
  try {
    const head = (await runGit(repositoryRoot, [
      "rev-parse",
      "--verify",
      "HEAD",
    ]))
      .toString("utf8")
      .trim();
    return head.length === 0 ? null : head;
  } catch (error) {
    if (error instanceof GitCommandError && error.exitCode === 128) {
      return null;
    }
    throw error;
  }
}

async function readGitCommitParent(
  repositoryRoot: string,
  commit: string,
): Promise<string | null> {
  try {
    const parent = (await runGit(repositoryRoot, ["rev-parse", `${commit}^`]))
      .toString("utf8")
      .trim();
    return parent.length === 0 ? null : parent;
  } catch (error) {
    if (error instanceof GitCommandError && error.exitCode === 128) {
      return null;
    }
    throw error;
  }
}

async function readGitCommitMessage(
  repositoryRoot: string,
  commit: string,
): Promise<string> {
  return (await runGit(repositoryRoot, ["log", "-1", "--format=%B", commit]))
    .toString("utf8")
    .trimEnd();
}

async function listGitPaths(
  repositoryRoot: string,
  arguments_: readonly string[],
): Promise<readonly string[]> {
  const output = await runGit(repositoryRoot, arguments_);
  return Object.freeze(
    output
      .toString("utf8")
      .split("\0")
      .filter((path) => path.length > 0),
  );
}
function isTaskCommitExcludedPath(path: string): boolean {
  return isExcludedBaselinePath(path, TASK_BASELINE_EXCLUDED_PREFIXES);
}

function sameBaselineMaterial(
  expected: BaselineRecord,
  observed: BaselineRecord,
): boolean {
  const { capturedAt: expectedCapturedAt, ...expectedMaterial } = expected;
  const { capturedAt: observedCapturedAt, ...observedMaterial } = observed;
  void expectedCapturedAt;
  void observedCapturedAt;
  return JSON.stringify(expectedMaterial) === JSON.stringify(observedMaterial);
}


function uniquePaths(paths: readonly string[]): readonly string[] {
  const unique = new Set<string>();
  for (const path of paths) {
    unique.add(path);
  }
  return Object.freeze([...unique].sort());
}

function isExcludedBaselinePath(
  path: string,
  prefixes: readonly string[],
): boolean {
  return prefixes.some(
    (prefix) => path === prefix || path.startsWith(`${prefix}/`),
  );
}

function digestBytes(value: Uint8Array): string {
  return createHash("sha256").update(value).digest("hex");
}

function digestBuffers(values: readonly Uint8Array[]): `sha256:${string}` {
  const hash = createHash("sha256");
  for (const value of values) {
    hash.update(value);
  }
  return `sha256:${hash.digest("hex")}`;
}

function digestNamedBuffers(
  values: readonly Readonly<{ name: string; value: Uint8Array }>[],
): `sha256:${string}` {
  const hash = createHash("sha256");
  for (const value of values) {
    hash.update(value.name);
    hash.update("\0");
    hash.update(value.value);
    hash.update("\0");
  }
  return `sha256:${hash.digest("hex")}`;
}

function readerLeaseFileName(dispatchId: string): string {
  return createHash("sha256").update(dispatchId).digest("hex");
}

async function claimReaderLease(marker: string, token: string): Promise<void> {
  const temporary = `${marker}.${randomUUID()}.tmp`;
  let handle: FileHandle | undefined;
  try {
    handle = await open(temporary, "wx");
    await handle.writeFile(token, "utf8");
    await handle.sync();
    await handle.close();
    handle = undefined;
    try {
      await link(temporary, marker);
    } catch (error) {
      if (!hasErrorCode(error, "EEXIST")) {
        throw error;
      }
      if ((await readFile(marker, "utf8")) !== token) {
        throw new Error("Shared-checkout Reader Lease ownership changed.");
      }
    }
  } finally {
    await handle?.close();
    await rm(temporary, { force: true });
  }
}

async function pathExists(path: string): Promise<boolean> {
  try {
    await lstat(path);
    return true;
  } catch (error) {
    if (isNotFound(error)) {
      return false;
    }
    throw error;
  }
}

async function waitForReaderLeases(directory: string): Promise<void> {
  const deadline = Date.now() + 5_000;
  for (;;) {
    try {
      if ((await readdir(directory)).length === 0) {
        return;
      }
    } catch (error) {
      if (isNotFound(error)) {
        return;
      }
      throw error;
    }
    if (Date.now() >= deadline) {
      throw new Error("Timed out waiting for shared-checkout Readers.");
    }
    await delay(10);
  }
}

async function runWithExclusiveLock<Result>(
  target: string,
  description: string,
  operation: () => Promise<Result>,
): Promise<Result> {
  const deadline = Date.now() + 5_000;
  for (;;) {
    const owner = await tryCreateTaskLock(target);
    if (owner !== null) {
      try {
        return await operation();
      } finally {
        await releaseTaskLock(target, owner);
      }
    }
    if (Date.now() >= deadline) {
      throw new Error(`Timed out waiting for ${description}.`);
    }
    await delay(10);
  }
}

async function tryCreateTaskLock(target: string): Promise<string | null> {
  const owner = JSON.stringify({ pid: process.pid, token: randomUUID() });
  const temporary = `${target}.${randomUUID()}.tmp`;
  let handle: FileHandle | undefined;
  try {
    handle = await open(temporary, "wx");
    await handle.writeFile(owner, "utf8");
    await handle.sync();
    await handle.close();
    handle = undefined;
    try {
      await link(temporary, target);
      return owner;
    } catch (error) {
      if (hasErrorCode(error, "EEXIST")) {
        return null;
      }
      throw error;
    }
  } finally {
    await handle?.close().catch(() => undefined);
    await rm(temporary, { force: true }).catch(() => undefined);
  }
}

async function releaseTaskLock(target: string, owner: string): Promise<void> {
  if ((await readFile(target, "utf8")) !== owner) {
    throw new Error("Task mutation lock ownership changed before release.");
  }
  await rm(target);
}


function hasErrorCode(error: unknown, code: string): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    error.code === code
  );
}

export async function findGitRepositoryRoot(
  startPath: string,
): Promise<string | null> {
  let current = await realpath(resolve(startPath));
  for (;;) {
    try {
      const marker = await lstat(join(current, ".git"));
      if (!marker.isSymbolicLink() && (marker.isDirectory() || marker.isFile())) {
        return current;
      }
    } catch (error) {
      if (!isNotFound(error)) {
        throw error;
      }
    }

    const parent = dirname(current);
    if (parent === current || current === parse(current).root) {
      return null;
    }
    current = parent;
  }
}

function isNotFound(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    error.code === "ENOENT"
  );
}
