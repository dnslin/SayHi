export function escapeTrackerInlineText(value: string): string {
  return value
    .replace(/[\r\n]+/gu, " ")
    .replace(/<!--/gu, "&lt;!--")
    .replace(/-->/gu, "--&gt;")
    .replace(/`/gu, "\\`");
}

export function isCredentialFreeAbsoluteUri(value: unknown): value is string {
  if (typeof value !== "string") {
    return false;
  }
  try {
    const uri = new URL(value);
    return (
      (uri.protocol === "http:" || uri.protocol === "https:") &&
      uri.username.length === 0 &&
      uri.password.length === 0 &&
      uri.search.length === 0 &&
      uri.hash.length === 0
    );
  } catch {
    return false;
  }
}
