import { readFile } from "node:fs/promises";

export async function readInstalledPackageJson(
  packageSpecifier: string,
): Promise<{ version: unknown }> {
  return JSON.parse(
    await readFile(
      new URL("../package.json", import.meta.resolve(packageSpecifier)),
      "utf8",
    ),
  ) as { version: unknown };
}
