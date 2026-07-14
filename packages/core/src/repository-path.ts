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
