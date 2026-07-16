import { createHash, randomUUID } from "node:crypto";
import {
  link,
  lstat,
  mkdir,
  open,
  readFile,
  realpath,
  rename,
  rm,
  type FileHandle,
} from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";

export const QUICK_AUDIT_RUNTIME_DIRECTORY_ENV = "SAYHI_QUICK_AUDIT_DIR";

export type QuickAuditLocation = "active" | "archive";

export interface StoredQuickAudit {
  readonly value: unknown;
  readonly location: QuickAuditLocation;
}

export class QuickAuditStoreError extends Error {
  readonly code: "exists" | "io_failed" | "missing" | "unsafe_root";

  constructor(
    code: "exists" | "io_failed" | "missing" | "unsafe_root",
    message: string,
  ) {
    super(message);
    this.code = code;
  }
}

export class NodeQuickAuditStore {
  readonly #activeDirectory: string;
  readonly #archiveDirectory: string;

  private constructor(activeDirectory: string, archiveDirectory: string) {
    this.#activeDirectory = activeDirectory;
    this.#archiveDirectory = archiveDirectory;
  }

  static async open(repositoryRoot: string): Promise<NodeQuickAuditStore> {
    const configuredRoot = process.env[QUICK_AUDIT_RUNTIME_DIRECTORY_ENV];
    const configuredAuditRoot = resolve(
      configuredRoot === undefined || configuredRoot.length === 0
        ? join(homedir(), ".sayhi", "runtime")
        : configuredRoot,
    );
    try {
      const auditRoot = await resolveExternalAuditRoot(
        configuredAuditRoot,
        repositoryRoot,
      );
      const auditDirectory = await resolveExternalAuditRoot(
        join(auditRoot, "quick", quickAuditDirectoryKey(repositoryRoot)),
        repositoryRoot,
      );
      const [activeDirectory, archiveDirectory] = await Promise.all([
        resolveExternalAuditRoot(join(auditDirectory, "active"), repositoryRoot),
        resolveExternalAuditRoot(join(auditDirectory, "archive"), repositoryRoot),
      ]);
      return new NodeQuickAuditStore(activeDirectory, archiveDirectory);
    } catch (error) {
      if (error instanceof QuickAuditStoreError) {
        throw error;
      }
      throw new QuickAuditStoreError(
        "io_failed",
        "Quick audit runtime storage could not be created.",
      );
    }
  }


  async create(taskId: string, value: unknown): Promise<void> {
    const fileName = quickAuditFileName(taskId);
    const active = join(this.#activeDirectory, fileName);
    const archive = join(this.#archiveDirectory, fileName);
    if (
      (await inspectPath(active)) !== "missing" ||
      (await inspectPath(archive)) !== "missing"
    ) {
      throw new QuickAuditStoreError(
        "exists",
        "A Quick audit already exists for this Task.",
      );
    }
    await writeNewJson(active, value);
  }

  async read(taskId: string): Promise<StoredQuickAudit> {
    const fileName = quickAuditFileName(taskId);
    const archive = join(this.#archiveDirectory, fileName);
    if ((await inspectPath(archive)) === "file") {
      return { value: await readJson(archive), location: "archive" };
    }
    const active = join(this.#activeDirectory, fileName);
    if ((await inspectPath(active)) === "file") {
      return { value: await readJson(active), location: "active" };
    }
    throw new QuickAuditStoreError("missing", "Quick audit was not found.");
  }

  async archive(taskId: string, value: unknown): Promise<void> {
    const fileName = quickAuditFileName(taskId);
    const active = join(this.#activeDirectory, fileName);
    if ((await inspectPath(active)) !== "file") {
      throw new QuickAuditStoreError("missing", "Active Quick audit was not found.");
    }
    const archive = join(this.#archiveDirectory, fileName);
    if ((await inspectPath(archive)) !== "missing") {
      throw new QuickAuditStoreError(
        "exists",
        "An archived Quick audit already exists for this Task.",
      );
    }
    await replaceJson(active, value);
    await this.finalizeArchive(taskId);
  }

  async finalizeArchive(taskId: string): Promise<void> {
    const fileName = quickAuditFileName(taskId);
    const active = join(this.#activeDirectory, fileName);
    if ((await inspectPath(active)) !== "file") {
      throw new QuickAuditStoreError("missing", "Active Quick audit was not found.");
    }
    const archive = join(this.#archiveDirectory, fileName);
    if ((await inspectPath(archive)) !== "missing") {
      throw new QuickAuditStoreError(
        "exists",
        "An archived Quick audit already exists for this Task.",
      );
    }
    try {
      await mkdir(this.#archiveDirectory, { recursive: true });
      await rename(active, archive);
    } catch {
      throw new QuickAuditStoreError(
        "io_failed",
        "Quick audit archive could not move the archived record.",
      );
    }
  }
}

function quickAuditDirectoryKey(repositoryRoot: string): string {
  return createHash("sha256").update(resolve(repositoryRoot)).digest("hex");
}

function quickAuditFileName(taskId: string): string {
  return `${createHash("sha256").update(taskId).digest("hex")}.json`;
}

async function resolveExternalAuditRoot(
  auditRoot: string,
  repositoryRoot: string,
): Promise<string> {
  const repository = await realpath(repositoryRoot);
  const existingParent = await nearestExistingDirectory(auditRoot);
  const parent = await realpath(existingParent);
  const remaining = relative(existingParent, auditRoot)
    .split(sep)
    .filter((segment) => segment.length > 0);
  const candidate = resolve(parent, ...remaining);
  if (isInsideRepository(candidate, repository)) {
    throw new QuickAuditStoreError(
      "unsafe_root",
      "Quick audit runtime storage must remain outside the repository.",
    );
  }
  await mkdir(candidate, { recursive: true });
  const resolvedRoot = await realpath(candidate);
  if (isInsideRepository(resolvedRoot, repository)) {
    throw new QuickAuditStoreError(
      "unsafe_root",
      "Quick audit runtime storage must remain outside the repository.",
    );
  }
  return resolvedRoot;
}

async function nearestExistingDirectory(path: string): Promise<string> {
  let candidate = path;
  for (;;) {
    try {
      const resolved = await realpath(candidate);
      if (!(await lstat(resolved)).isDirectory()) {
        throw new QuickAuditStoreError(
          "io_failed",
          "Quick audit runtime root must be a directory.",
        );
      }
      return candidate;
    } catch (error) {
      if (!hasErrorCode(error, "ENOENT")) {
        throw error;
      }
      const parent = dirname(candidate);
      if (parent === candidate) {
        throw new QuickAuditStoreError(
          "io_failed",
          "Quick audit runtime root could not be resolved.",
        );
      }
      candidate = parent;
    }
  }
}

function isInsideRepository(path: string, repositoryRoot: string): boolean {
  const relativePath = relative(resolve(repositoryRoot), resolve(path));
  return (
    relativePath.length === 0 ||
    (!isAbsolute(relativePath) &&
      relativePath !== ".." &&
      !relativePath.startsWith(`..${sep}`))
  );
}

async function inspectPath(path: string): Promise<"file" | "missing" | "other"> {
  try {
    const entry = await lstat(path);
    return entry.isFile() ? "file" : "other";
  } catch (error) {
    if (hasErrorCode(error, "ENOENT")) {
      return "missing";
    }
    throw new QuickAuditStoreError(
      "io_failed",
      "Quick audit runtime storage could not be inspected.",
    );
  }
}

async function readJson(path: string): Promise<unknown> {
  try {
    return JSON.parse(await readFile(path, "utf8")) as unknown;
  } catch {
    throw new QuickAuditStoreError(
      "io_failed",
      "Quick audit runtime storage could not be read.",
    );
  }
}

async function writeNewJson(path: string, value: unknown): Promise<void> {
  const content = `${JSON.stringify(value)}\n`;
  const temporary = join(dirname(path), `.${randomUUID()}.tmp`);
  let handle: FileHandle | undefined;
  try {
    await mkdir(dirname(path), { recursive: true });
    handle = await open(temporary, "wx");
    await handle.writeFile(content, "utf8");
    await handle.sync();
    await handle.close();
    handle = undefined;
    await link(temporary, path);
  } catch (error) {
    if (hasErrorCode(error, "EEXIST")) {
      throw new QuickAuditStoreError(
        "exists",
        "A Quick audit already exists for this Task.",
      );
    }
    if (error instanceof QuickAuditStoreError) {
      throw error;
    }
    throw new QuickAuditStoreError(
      "io_failed",
      "Quick audit runtime storage could not be written.",
    );
  } finally {
    await handle?.close().catch(() => undefined);
    await rm(temporary, { force: true }).catch(() => undefined);
  }
}

async function replaceJson(path: string, value: unknown): Promise<void> {
  const content = `${JSON.stringify(value)}\n`;
  const temporary = join(dirname(path), `.${randomUUID()}.tmp`);
  let handle: FileHandle | undefined;
  try {
    handle = await open(temporary, "wx");
    await handle.writeFile(content, "utf8");
    await handle.sync();
    await handle.close();
    handle = undefined;
    await rename(temporary, path);
  } catch {
    throw new QuickAuditStoreError(
      "io_failed",
      "Quick audit runtime storage could not replace the active record.",
    );
  } finally {
    await handle?.close().catch(() => undefined);
    await rm(temporary, { force: true }).catch(() => undefined);
  }
}

function hasErrorCode(error: unknown, code: string): boolean {
  return (
    error !== null &&
    typeof error === "object" &&
    "code" in error &&
    error.code === code
  );
}
