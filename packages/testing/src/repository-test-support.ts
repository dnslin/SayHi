import { readdirSync, readFileSync } from "node:fs";
import { extname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

export const REPOSITORY_ROOT = fileURLToPath(
  new URL("../../../", import.meta.url),
);

const IGNORED_DIRECTORY_NAMES = new Set([".git", "dist", "node_modules"]);
const TEXT_FILE_EXTENSIONS = new Set([
  ".cjs",
  ".css",
  ".html",
  ".py",
  ".sh",
  ".toml",
  ".xml",
  ".js",
  ".json",
  ".jsx",
  ".md",
  ".mjs",
  ".ts",
  ".tsx",
  ".txt",
  ".yaml",
  ".yml",
]);

export interface RepositoryTextSource {
  readonly path: string;
  readonly source: string;
}

export function readRepositoryFile(relativePath: string): string {
  return readFileSync(join(REPOSITORY_ROOT, relativePath), "utf8");
}

export function collectTextSources(
  directory: string,
): readonly RepositoryTextSource[] {
  const sources: RepositoryTextSource[] = [];
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory() && !IGNORED_DIRECTORY_NAMES.has(entry.name)) {
      sources.push(...collectTextSources(path));
    } else if (entry.isFile() && isTextFile(entry.name)) {
      sources.push({
        path: relative(REPOSITORY_ROOT, path).replaceAll("\\", "/"),
        source: readFileSync(path, "utf8"),
      });
    }
  }
  return sources;
}

function isTextFile(name: string): boolean {
  return (
    TEXT_FILE_EXTENSIONS.has(extname(name)) ||
    name === "LICENSE" ||
    name === ".gitignore"
  );
}
