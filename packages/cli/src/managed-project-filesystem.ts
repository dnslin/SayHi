import {
  lstat,
  mkdir,
  open,
  readFile,
  realpath,
  rename,
  rm,
  type FileHandle,
} from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { basename, dirname, join, parse, relative, resolve } from "node:path";

import type {
  ManagedProjectFileSystem,
  ManagedProjectPathKind,
} from "@dnslin/sayhi-core";

export class NodeManagedProjectFileSystem
  implements ManagedProjectFileSystem
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
