interface ManagedBlockRange {
  readonly start: number;
  readonly end: number;
  readonly content: string;
}

export function hasUnambiguousManagedBlocks(
  content: string,
  markerIds: readonly string[],
): boolean {
  if (markerIds.length === 0) {
    return false;
  }
  const blocks = markerIds.map((markerId) => findManagedBlock(content, markerId));
  return (
    blocks.every((block): block is ManagedBlockRange => block !== null) &&
    !hasOverlappingBlocks(blocks)
  );
}

export function replaceManagedBlocks(
  localContent: string,
  baseContent: string,
  incomingContent: string,
  markerIds: readonly string[],
): string | null {
  if (markerIds.length === 0) {
    return null;
  }
  const localBlocks: ManagedBlockRange[] = [];
  const baseBlocks: ManagedBlockRange[] = [];
  const incomingBlocks: ManagedBlockRange[] = [];
  for (const markerId of markerIds) {
    const local = findManagedBlock(localContent, markerId);
    const base = findManagedBlock(baseContent, markerId);
    const incoming = findManagedBlock(incomingContent, markerId);
    if (
      local === null ||
      base === null ||
      incoming === null ||
      normalizeLf(local.content) !== normalizeLf(base.content)
    ) {
      return null;
    }
    localBlocks.push(local);
    baseBlocks.push(base);
    incomingBlocks.push(incoming);
  }
  if (
    hasOverlappingBlocks(localBlocks) ||
    hasOverlappingBlocks(baseBlocks) ||
    hasOverlappingBlocks(incomingBlocks)
  ) {
    return null;
  }

  return applyBlockReplacements(
    localContent,
    localBlocks.map((local, index) => ({
      ...local,
      replacement: incomingBlocks[index]!.content,
    })),
  );
}

export function removeManagedBlocks(
  localContent: string,
  baseContent: string,
  markerIds: readonly string[],
): string | null {
  if (markerIds.length === 0) {
    return null;
  }
  const localBlocks: ManagedBlockRange[] = [];
  const baseBlocks: ManagedBlockRange[] = [];
  for (const markerId of markerIds) {
    const local = findManagedBlock(localContent, markerId);
    const base = findManagedBlock(baseContent, markerId);
    if (
      local === null ||
      base === null ||
      normalizeLf(local.content) !== normalizeLf(base.content)
    ) {
      return null;
    }
    localBlocks.push(local);
    baseBlocks.push(base);
  }
  if (hasOverlappingBlocks(localBlocks) || hasOverlappingBlocks(baseBlocks)) {
    return null;
  }
  return applyBlockReplacements(
    localContent,
    localBlocks.map((block) => ({ ...block, replacement: "" })),
  );
}

function findManagedBlock(
  content: string,
  markerId: string,
): ManagedBlockRange | null {
  const startMarker = `<!-- sayhi:managed:start ${markerId} -->`;
  const endMarker = `<!-- sayhi:managed:end ${markerId} -->`;
  const start = content.indexOf(startMarker);
  if (
    start < 0 ||
    content.indexOf(startMarker, start + startMarker.length) >= 0 ||
    !isLineBoundaryBefore(content, start) ||
    !isLineBoundaryAfter(content, start + startMarker.length)
  ) {
    return null;
  }
  const endMarkerStart = content.indexOf(endMarker);
  if (
    endMarkerStart <= start ||
    content.indexOf(endMarker, endMarkerStart + endMarker.length) >= 0 ||
    !isLineBoundaryBefore(content, endMarkerStart) ||
    !isLineBoundaryAfter(content, endMarkerStart + endMarker.length)
  ) {
    return null;
  }
  let end = endMarkerStart + endMarker.length;
  if (content.slice(end, end + 2) === "\r\n") {
    end += 2;
  } else if (content[end] === "\n" || content[end] === "\r") {
    end += 1;
  }
  return Object.freeze({ start, end, content: content.slice(start, end) });
}

function isLineBoundaryBefore(content: string, index: number): boolean {
  return index === 0 || content[index - 1] === "\n" || content[index - 1] === "\r";
}

function isLineBoundaryAfter(content: string, index: number): boolean {
  return index === content.length || content[index] === "\n" || content[index] === "\r";
}

function hasOverlappingBlocks(blocks: readonly ManagedBlockRange[]): boolean {
  const ordered = [...blocks].sort((left, right) => left.start - right.start);
  return ordered.some(
    (block, index) => index > 0 && ordered[index - 1]!.end > block.start,
  );
}

function applyBlockReplacements(
  content: string,
  replacements: readonly (ManagedBlockRange & { readonly replacement: string })[],
): string {
  let result = content;
  for (const replacement of [...replacements].sort(
    (left, right) => right.start - left.start,
  )) {
    result =
      result.slice(0, replacement.start) +
      replacement.replacement +
      result.slice(replacement.end);
  }
  return result;
}

function normalizeLf(content: string): string {
  return content.replaceAll("\r\n", "\n").replaceAll("\r", "\n");
}
