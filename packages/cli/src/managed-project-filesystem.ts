import {
  link,
  lstat,
  mkdir,
  open,
  readFile,
  readdir,
  realpath,
  rename,
  rm,
  type FileHandle,
} from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { basename, dirname, join, parse, relative, resolve } from "node:path";
import { setTimeout as delay } from "node:timers/promises";

import type {
  ManagedProjectMutationFileSystem,
  ManagedProjectPathKind,
  TaskLifecycleFileSystem,
} from "@dnslin/sayhi-core";

export class NodeManagedProjectFileSystem
  implements ManagedProjectMutationFileSystem, TaskLifecycleFileSystem
{
  readonly #repositoryRoot: string;

  constructor(repositoryRoot: string) {
    this.#repositoryRoot = resolve(repositoryRoot);
  }

  async inspect(path: string): Promise<Readonly<{ kind: ManagedProjectPathKind }>> {
    const target = this.#resolveManagedPath(path);
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

  async createDirectory(path: string): Promise<void> {
    await mkdir(this.#resolveManagedPath(path));
  }

  async writeFile(path: string, content: string): Promise<void> {
    const target = this.#resolveManagedPath(path);
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

  async appendFile(path: string, content: string): Promise<void> {
    const handle = await open(this.#resolveManagedPath(path), "a");
    try {
      await handle.writeFile(content, "utf8");
      await handle.sync();
    } finally {
      await handle.close();
    }
  }

  async withTaskMutationLock<Result>(
    path: string,
    operation: () => Promise<Result>,
  ): Promise<Result> {
    const target = this.#resolveManagedPath(path);
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
      if (await clearDeadTaskLock(target)) {
        continue;
      }
      if (Date.now() >= deadline) {
        throw new Error(`Timed out waiting for Task mutation lock: ${path}`);
      }
      await delay(10);
    }
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

async function clearDeadTaskLock(target: string): Promise<boolean> {
  let owner: string;
  try {
    owner = await readFile(target, "utf8");
  } catch (error) {
    if (isNotFound(error)) {
      return true;
    }
    throw error;
  }
  const ownerPid = readLockOwnerPid(owner);
  if (ownerPid === null || isProcessAlive(ownerPid)) {
    return false;
  }

  const stale = `${target}.${randomUUID()}.stale`;
  try {
    await rename(target, stale);
  } catch (error) {
    if (isNotFound(error)) {
      return true;
    }
    throw error;
  }
  await rm(stale, { force: true });
  return true;
}

function readLockOwnerPid(content: string): number | null {
  let value: unknown;
  try {
    value = JSON.parse(content);
  } catch {
    return null;
  }
  if (
    typeof value !== "object" ||
    value === null ||
    !("pid" in value) ||
    typeof value.pid !== "number" ||
    !Number.isSafeInteger(value.pid) ||
    value.pid < 1
  ) {
    return null;
  }
  return value.pid;
}

function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    if (hasErrorCode(error, "ESRCH")) {
      return false;
    }
    if (hasErrorCode(error, "EPERM")) {
      return true;
    }
    throw error;
  }
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
