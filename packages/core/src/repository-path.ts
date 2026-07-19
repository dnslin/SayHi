export function isRepositoryRelativePath(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.length > 0 &&
    !value.startsWith("/") &&
    !value.includes("\\") &&
    !/^[A-Za-z]:\//u.test(value) &&
    !value.split("/").includes("..")
  );
}

export function canonicalRepositoryRelativePath(path: string): string {
  return path
    .split("/")
    .filter((segment) => segment.length > 0 && segment !== ".")
    .join("/");
}
