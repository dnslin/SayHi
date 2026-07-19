import { hashTextContent } from "./context-manifest.js";
import type { ContentHash } from "./validation.js";
import type { WorkflowState } from "./workflow.js";

export const MARKDOWN_TRACKER_CONTRACT_VERSION = 1 as const;

const ENTRIES_START = "<!-- sayhi-tracker:entries -->";
const ENTRIES_END = "<!-- /sayhi-tracker:entries -->";

export interface MarkdownTrackerEntry {
  readonly taskId: string;
  readonly base: string;
  readonly baseIdentity: ContentHash;
  readonly authorityIdentity: ContentHash;
}

export interface MarkdownTrackerSnapshot {
  readonly schemaVersion: typeof MARKDOWN_TRACKER_CONTRACT_VERSION;
  readonly markdown: string;
  readonly entries: readonly MarkdownTrackerEntry[];
}

export interface MarkdownTrackerStore {
  readMarkdownTracker(): Promise<MarkdownTrackerSnapshot>;
  writeMarkdownTracker(snapshot: MarkdownTrackerSnapshot): Promise<void>;
}

export interface ProjectMarkdownTrackerRequest {
  readonly store: MarkdownTrackerStore;
  readonly state: WorkflowState;
}

export interface ProjectDeletedMarkdownTrackerTaskRequest {
  readonly store: MarkdownTrackerStore;
  readonly state: WorkflowState;
  readonly deletedAt: string;
}

export interface MarkdownTrackerConflict {
  readonly taskId: string;
  readonly base: string;
  readonly observed: string | null;
  readonly incoming: string | null;
  readonly snapshotIdentity: ContentHash;
}

export type ProjectMarkdownTrackerResult =
  | Readonly<{
      readonly disposition: "created" | "updated" | "unchanged";
      readonly snapshot: MarkdownTrackerSnapshot;
    }>
  | Readonly<{
      readonly disposition: "reconciliation-required";
      readonly conflict: MarkdownTrackerConflict;
    }>;

export type MarkdownTrackerConflictResolution = "use-local" | "keep-observed";

export interface ResolveMarkdownTrackerConflictRequest {
  readonly store: MarkdownTrackerStore;
  readonly conflict: MarkdownTrackerConflict;
  readonly resolution: MarkdownTrackerConflictResolution;
}

export type ResolveMarkdownTrackerConflictResult =
  | Readonly<{
      readonly disposition: "resolved";
      readonly snapshot: MarkdownTrackerSnapshot;
    }>
  | Readonly<{
      readonly disposition: "reconciliation-required";
      readonly conflict: MarkdownTrackerConflict;
    }>;

type MarkdownTrackerSubject =
  | Readonly<{ readonly kind: "task"; readonly state: WorkflowState }>
  | Readonly<{
      readonly kind: "deleted";
      readonly state: WorkflowState;
      readonly deletedAt: string;
    }>;

type ParsedTrackerDocument =
  | Readonly<{
      readonly ok: true;
      readonly prefix: string;
      readonly suffix: string;
      readonly content: string;
      readonly hasUntrackedContent: boolean;
      readonly blocks: ReadonlyMap<string, string>;
    }>
  | Readonly<{ readonly ok: false }>;

export async function projectMarkdownTracker(
  request: ProjectMarkdownTrackerRequest,
): Promise<ProjectMarkdownTrackerResult> {
  return projectSubject(request.store, Object.freeze({ kind: "task", state: request.state }));
}

export async function projectDeletedMarkdownTrackerTask(
  request: ProjectDeletedMarkdownTrackerTaskRequest,
): Promise<ProjectMarkdownTrackerResult> {
  return projectSubject(
    request.store,
    Object.freeze({
      kind: "deleted",
      state: request.state,
      deletedAt: request.deletedAt,
    }),
  );
}

export async function resolveMarkdownTrackerConflict(
  request: ResolveMarkdownTrackerConflictRequest,
): Promise<ResolveMarkdownTrackerConflictResult> {
  const snapshot = freezeSnapshot(await request.store.readMarkdownTracker());
  const currentSnapshotIdentity = snapshotIdentity(snapshot);
  if (
    currentSnapshotIdentity.algorithm !== request.conflict.snapshotIdentity.algorithm ||
    currentSnapshotIdentity.digest !== request.conflict.snapshotIdentity.digest
  ) {
    return currentReconciliationRequired(snapshot, request.conflict);
  }

  const parsed = parseTrackerDocument(snapshot);
  if (!parsed.ok) {
    return currentReconciliationRequired(snapshot, request.conflict);
  }
  const entry = entryFor(snapshot, request.conflict.taskId);
  const incoming = request.conflict.incoming;
  const expectedContent = renderTrackerEntryContent(snapshot.entries);
  const observed = parsed.hasUntrackedContent
    ? parsed.content
    : entry === undefined
      ? readBlock(parsed.content, request.conflict.taskId)
      : (parsed.blocks.get(request.conflict.taskId) ?? null);
  const incomingBlock = incoming === null ? null : readBlock(incoming, request.conflict.taskId);
  const isTrackedConflict =
    !parsed.hasUntrackedContent &&
    entry !== undefined &&
    observed === request.conflict.observed &&
    entry.base === request.conflict.base;
  const isAdoptableUntrackedConflict =
    entry === undefined &&
    request.conflict.base.length === 0 &&
    observed === request.conflict.observed &&
    observed !== null &&
    parsed.content.trim() === observed;
  const isRootContentConflict =
    parsed.hasUntrackedContent &&
    request.conflict.base === expectedContent &&
    request.conflict.observed === parsed.content &&
    incomingBlock !== null;
  if (request.resolution === "use-local" && incoming === null) {
    return currentReconciliationRequired(snapshot, request.conflict);
  }
  if (!isTrackedConflict && !isAdoptableUntrackedConflict && !isRootContentConflict) {
    return currentReconciliationRequired(snapshot, request.conflict);
  }
  if (
    request.resolution === "keep-observed" &&
    (observed === null || isRootContentConflict)
  ) {
    return currentReconciliationRequired(snapshot, request.conflict);
  }

  const rendered = isRootContentConflict
    ? incomingBlock!
    : request.resolution === "use-local"
      ? incoming!
      : observed!;
  const replacement = freezeEntry({
    taskId: request.conflict.taskId,
    base: rendered,
    baseIdentity: hashTextContent(rendered),
    authorityIdentity:
      incoming === null
        ? (entry?.authorityIdentity ?? hashTextContent(rendered))
        : hashTextContent(isRootContentConflict ? incomingBlock! : incoming),
  });
  const updated = replaceEntry(snapshot, replacement, parsed);
  await request.store.writeMarkdownTracker(updated);
  return Object.freeze({ disposition: "resolved", snapshot: updated });
}

function currentReconciliationRequired(
  snapshot: MarkdownTrackerSnapshot,
  conflict: MarkdownTrackerConflict,
): Readonly<{
  readonly disposition: "reconciliation-required";
  readonly conflict: MarkdownTrackerConflict;
}> {
  return Object.freeze({
    disposition: "reconciliation-required",
    conflict: conflictForCurrentSnapshot(snapshot, conflict),
  });
}

async function projectSubject(
  store: MarkdownTrackerStore,
  subject: MarkdownTrackerSubject,
): Promise<ProjectMarkdownTrackerResult> {
  const snapshot = freezeSnapshot(await store.readMarkdownTracker());
  const incoming = renderSubject(subject);
  const taskId = subject.state.projection.id;
  const parsed = parseTrackerDocument(snapshot);
  const authorityIdentity = hashTextContent(incoming);
  const incomingEntry = freezeEntry({
    taskId,
    base: incoming,
    baseIdentity: hashTextContent(incoming),
    authorityIdentity,
  });
  if (!parsed.ok) {
    return reconciliationRequired(
      snapshot,
      taskId,
      entryFor(snapshot, taskId)?.base ?? renderTrackerEntryContent(snapshot.entries),
      snapshot.markdown,
      incoming,
    );
  }
  if (parsed.hasUntrackedContent) {
    return reconciliationRequired(
      snapshot,
      taskId,
      renderTrackerEntryContent(snapshot.entries),
      parsed.content,
      renderTrackerEntryContent(
        sortTrackerEntries(
          snapshot.entries.filter((entry) => entry.taskId !== taskId).concat(incomingEntry),
        ),
      ),
    );
  }

  const divergent = firstDivergentEntry(snapshot, parsed);
  if (divergent !== undefined) {
    return reconciliationRequired(
      snapshot,
      divergent.entry.taskId,
      divergent.entry.base,
      divergent.observed,
      divergent.entry.taskId === taskId ? incoming : null,
    );
  }

  const existing = entryFor(snapshot, taskId);
  if (existing === undefined) {
    const created = replaceEntry(
      snapshot,
      incomingEntry,
      parsed,
    );
    await store.writeMarkdownTracker(created);
    return Object.freeze({ disposition: "created", snapshot: created });
  }

  const observed = parsed.blocks.get(taskId) ?? null;
  if (observed !== existing.base) {
    return reconciliationRequired(snapshot, taskId, existing.base, observed, incoming);
  }
  if (
    existing.authorityIdentity.algorithm === authorityIdentity.algorithm &&
    existing.authorityIdentity.digest === authorityIdentity.digest
  ) {
    return Object.freeze({ disposition: "unchanged", snapshot });
  }

  const updated = replaceEntry(
    snapshot,
    incomingEntry,
    parsed,
  );
  await store.writeMarkdownTracker(updated);
  return Object.freeze({ disposition: "updated", snapshot: updated });
}

function renderSubject(subject: MarkdownTrackerSubject): string {
  if (subject.kind === "deleted") {
    const { projection } = subject.state;
    return [
      taskMarkerStart(projection.id),
      `## ${inline(projection.id)} — Deleted`,
      "- Lifecycle: `deleted`",
      `- Last local lifecycle: \`${projection.lifecycle}\``,
      `- Deleted: \`${inline(subject.deletedAt)}\``,
      taskMarkerEnd(projection.id),
    ].join("\n");
  }

  const { projection } = subject.state;
  const lines = [
    taskMarkerStart(projection.id),
    `## ${inline(projection.id)} — ${inline(projection.title)}`,
    `- Route: \`${projection.route}\``,
    `- Lifecycle: \`${projection.lifecycle}\``,
    `- Phase: \`${projection.phase}\``,
    `- Step: \`${inline(projection.step)}\``,
    `- Version: ${projection.version}`,
    `- Updated: \`${inline(projection.updatedAt)}\``,
  ];
  if (projection.lifecycle === "blocked") {
    lines.push("- Blockers:");
    for (const blocker of projection.blockers) {
      lines.push(`  - ${inline(blocker)}`);
    }
  }
  lines.push(taskMarkerEnd(projection.id));
  return lines.join("\n");
}

function parseTrackerDocument(snapshot: MarkdownTrackerSnapshot): ParsedTrackerDocument {
  const markdown = snapshot.markdown;
  const starts = indexesOf(markdown, ENTRIES_START);
  const ends = indexesOf(markdown, ENTRIES_END);
  if (starts.length === 0 && ends.length === 0) {
    return Object.freeze({
      ok: true,
      prefix: markdown,
      suffix: "",
      content: "",
      hasUntrackedContent: false,
      blocks: new Map(),
    });
  }
  if (starts.length !== 1 || ends.length !== 1 || ends[0]! <= starts[0]!) {
    return Object.freeze({ ok: false });
  }

  const start = starts[0]!;
  const end = ends[0]!;
  const contentStart = start + ENTRIES_START.length;
  const content = markdown.slice(contentStart, end).replace(/^\n|\n$/gu, "");
  const blocks = new Map<string, string>();
  for (const entry of snapshot.entries) {
    const block = readBlock(content, entry.taskId);
    if (block === null || blocks.has(entry.taskId)) {
      return Object.freeze({ ok: false });
    }
    blocks.set(entry.taskId, block);
  }
  const hasUntrackedContent =
    content !==
    snapshot.entries
      .map((entry) => blocks.get(entry.taskId)!)
      .join("\n\n");
  return Object.freeze({
    ok: true,
    prefix: markdown.slice(0, start),
    suffix: markdown.slice(end + ENTRIES_END.length),
    content,
    blocks,
    hasUntrackedContent,
  });
}

function replaceEntry(
  snapshot: MarkdownTrackerSnapshot,
  replacement: MarkdownTrackerEntry,
  parsed: Extract<ParsedTrackerDocument, { readonly ok: true }>,
): MarkdownTrackerSnapshot {
  const entries = sortTrackerEntries(
    snapshot.entries.filter((entry) => entry.taskId !== replacement.taskId).concat(replacement),
  );
  const content = renderTrackerEntryContent(entries);
  const root = `${ENTRIES_START}\n${content}\n${ENTRIES_END}`;
  const markdown =
    snapshot.entries.length === 0 && parsed.prefix === snapshot.markdown
      ? `${snapshot.markdown.length === 0 ? "# SayHi Tracker\n\n" : `${snapshot.markdown.replace(/\n*$/u, "")}\n\n`}${root}\n`
      : `${parsed.prefix}${root}${parsed.suffix}`;
  return freezeSnapshot({
    schemaVersion: MARKDOWN_TRACKER_CONTRACT_VERSION,
    markdown,
    entries,
  });
}

function firstDivergentEntry(
  snapshot: MarkdownTrackerSnapshot,
  parsed: Extract<ParsedTrackerDocument, { readonly ok: true }>,
): Readonly<{ readonly entry: MarkdownTrackerEntry; readonly observed: string | null }> | undefined {
  for (const entry of snapshot.entries) {
    const observed = parsed.blocks.get(entry.taskId) ?? null;
    if (observed !== entry.base) {
      return Object.freeze({ entry, observed });
    }
  }
  return undefined;
}

function reconciliationRequired(
  snapshot: MarkdownTrackerSnapshot,
  taskId: string,
  base: string,
  observed: string | null,
  incoming: string | null,
): Readonly<{ readonly disposition: "reconciliation-required"; readonly conflict: MarkdownTrackerConflict }> {
  return Object.freeze({
    disposition: "reconciliation-required",
    conflict: Object.freeze({
      taskId,
      base,
      observed,
      incoming,
      snapshotIdentity: snapshotIdentity(snapshot),
    }),
  });
}

function conflictForCurrentSnapshot(
  snapshot: MarkdownTrackerSnapshot,
  conflict: MarkdownTrackerConflict,
): MarkdownTrackerConflict {
  const parsed = parseTrackerDocument(snapshot);
  const entry = entryFor(snapshot, conflict.taskId);
  const expectedContent = renderTrackerEntryContent(snapshot.entries);
  const observed = !parsed.ok
    ? snapshot.markdown
    : parsed.hasUntrackedContent
      ? parsed.content
      : entry === undefined
        ? readBlock(parsed.content, conflict.taskId)
        : (parsed.blocks.get(conflict.taskId) ?? null);
  const base = parsed.ok && parsed.hasUntrackedContent ? expectedContent : (entry?.base ?? conflict.base);
  return Object.freeze({
    taskId: conflict.taskId,
    base,
    observed,
    incoming: conflict.incoming,
    snapshotIdentity: snapshotIdentity(snapshot),
  });
}

function readBlock(content: string, taskId: string): string | null {
  const startMarker = taskMarkerStart(taskId);
  const endMarker = taskMarkerEnd(taskId);
  const starts = indexesOf(content, startMarker);
  const ends = indexesOf(content, endMarker);
  if (starts.length !== 1 || ends.length !== 1 || ends[0]! <= starts[0]!) {
    return null;
  }
  return content.slice(starts[0]!, ends[0]! + endMarker.length);
}

function entryFor(
  snapshot: MarkdownTrackerSnapshot,
  taskId: string,
): MarkdownTrackerEntry | undefined {
  return snapshot.entries.find((entry) => entry.taskId === taskId);
}

function renderTrackerEntryContent(entries: readonly MarkdownTrackerEntry[]): string {
  return entries.map((entry) => entry.base).join("\n\n");
}

function sortTrackerEntries(
  entries: readonly MarkdownTrackerEntry[],
): readonly MarkdownTrackerEntry[] {
  return [...entries].sort((left, right) =>
    left.taskId < right.taskId ? -1 : left.taskId > right.taskId ? 1 : 0,
  );
}


function taskMarkerStart(taskId: string): string {
  return `<!-- sayhi-tracker:task ${encodeURIComponent(taskId)} -->`;
}

function taskMarkerEnd(taskId: string): string {
  return `<!-- /sayhi-tracker:task ${encodeURIComponent(taskId)} -->`;
}

function inline(value: string): string {
  return value
    .replace(/[\r\n]+/gu, " ")
    .replace(/<!--/gu, "&lt;!--")
    .replace(/-->/gu, "--&gt;")
    .replace(/`/gu, "\\`");
}

function indexesOf(value: string, search: string): readonly number[] {
  const indexes: number[] = [];
  let index = value.indexOf(search);
  while (index !== -1) {
    indexes.push(index);
    index = value.indexOf(search, index + search.length);
  }
  return indexes;
}

function freezeSnapshot(snapshot: MarkdownTrackerSnapshot): MarkdownTrackerSnapshot {
  return Object.freeze({
    schemaVersion: MARKDOWN_TRACKER_CONTRACT_VERSION,
    markdown: snapshot.markdown.replace(/\r\n?/gu, "\n"),
    entries: Object.freeze(sortTrackerEntries(snapshot.entries.map(freezeEntry))),
  });
}

function freezeEntry(entry: MarkdownTrackerEntry): MarkdownTrackerEntry {
  return Object.freeze({
    taskId: entry.taskId,
    base: entry.base.replace(/\r\n?/gu, "\n"),
    baseIdentity: Object.freeze({ ...entry.baseIdentity }),
    authorityIdentity: Object.freeze({ ...entry.authorityIdentity }),
  });
}

function snapshotIdentity(snapshot: MarkdownTrackerSnapshot): ContentHash {
  return hashTextContent(
    JSON.stringify({
      schemaVersion: snapshot.schemaVersion,
      markdown: snapshot.markdown,
      entries: snapshot.entries.map((entry) => ({
        taskId: entry.taskId,
        base: entry.base,
        baseIdentity: entry.baseIdentity,
        authorityIdentity: entry.authorityIdentity,
      })),
    }),
  );
}

