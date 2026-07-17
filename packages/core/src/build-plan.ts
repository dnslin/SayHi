import { hashTextContent } from "./context-manifest.js";
import {
  hashCanonicalJson,
  isContractIdentity,
  type ContractIdentity,
} from "./identity.js";
import { isRepositoryRelativePath } from "./repository-path.js";
import { isTimestamp, type ContentHash } from "./validation.js";
import type { TaskIntent, WorkflowActor } from "./workflow.js";

export const DURABLE_BUILD_PLAN_SCHEMA_VERSION = 1 as const;

export interface DurableBuildPlan {
  readonly schemaVersion: typeof DURABLE_BUILD_PLAN_SCHEMA_VERSION;
  readonly taskId: string;
  readonly requirements: TaskIntent;
  readonly requirementsIdentity: ContractIdentity;
  readonly content: string;
  readonly contentIdentity: ContentHash;
  readonly identity: ContractIdentity;
  readonly contextManifestPath: string;
  readonly contextManifestIdentity: ContractIdentity;
  readonly preparedBy: WorkflowActor;
  readonly preparedAt: string;
}

export type ParseDurableBuildPlanResult =
  | Readonly<{ ok: true; plan: DurableBuildPlan }>
  | Readonly<{ ok: false; message: string }>;

export function createDurableBuildPlan(input: {
  readonly taskId: string;
  readonly requirements: TaskIntent;
  readonly content: string;
  readonly contextManifestPath: string;
  readonly contextManifestIdentity: ContractIdentity;
  readonly preparedBy: WorkflowActor;
  readonly preparedAt: string;
}): DurableBuildPlan {
  const requirements = freezeRequirements(input.requirements);
  const requirementsIdentity = hashCanonicalJson(requirements);
  const content = input.content;
  const contentIdentity = hashTextContent(content);
  return Object.freeze({
    schemaVersion: DURABLE_BUILD_PLAN_SCHEMA_VERSION,
    taskId: input.taskId,
    requirements,
    requirementsIdentity,
    content,
    contentIdentity,
    identity: planIdentity({
      taskId: input.taskId,
      requirementsIdentity,
      contentIdentity,
      contextManifestPath: input.contextManifestPath,
      contextManifestIdentity: input.contextManifestIdentity,
    }),
    contextManifestPath: input.contextManifestPath,
    contextManifestIdentity: input.contextManifestIdentity,
    preparedBy: freezeActor(input.preparedBy),
    preparedAt: input.preparedAt,
  });
}

export function parseDurableBuildPlan(content: string): ParseDurableBuildPlanResult {
  let value: unknown;
  try {
    value = JSON.parse(content) as unknown;
  } catch {
    return invalid("Build Plan is not valid JSON.");
  }
  if (!isRecord(value)) {
    return invalid("Build Plan must be a JSON object.");
  }
  if (value.schemaVersion !== DURABLE_BUILD_PLAN_SCHEMA_VERSION) {
    return invalid("Build Plan schema version is unsupported.");
  }
  if (typeof value.taskId !== "string" || value.taskId.trim().length === 0) {
    return invalid("Build Plan taskId must be a non-empty string.");
  }
  if (!isTaskIntent(value.requirements)) {
    return invalid("Build Plan requirements are invalid.");
  }
  const requirements = freezeRequirements(value.requirements);
  if (
    !isContractIdentity(value.requirementsIdentity) ||
    value.requirementsIdentity !== hashCanonicalJson(requirements)
  ) {
    return invalid("Build Plan requirements identity does not match its requirements.");
  }
  if (typeof value.content !== "string" || value.content.trim().length === 0) {
    return invalid("Build Plan content must be non-empty text.");
  }
  const contentIdentity = hashTextContent(value.content);
  if (!sameContentHash(value.contentIdentity, contentIdentity)) {
    return invalid("Build Plan content identity does not match its content.");
  }
  if (
    typeof value.contextManifestPath !== "string" ||
    !isRepositoryRelativePath(value.contextManifestPath)
  ) {
    return invalid("Build Plan Context Manifest path is invalid.");
  }
  if (!isContractIdentity(value.contextManifestIdentity)) {
    return invalid("Build Plan Context Manifest identity is invalid.");
  }
  if (
    !isContractIdentity(value.identity) ||
    value.identity !==
      planIdentity({
        taskId: value.taskId,
        requirementsIdentity: value.requirementsIdentity,
        contentIdentity,
        contextManifestPath: value.contextManifestPath,
        contextManifestIdentity: value.contextManifestIdentity,
      })
  ) {
    return invalid("Build Plan identity does not match its bound material.");
  }
  if (!isWorkflowActor(value.preparedBy)) {
    return invalid("Build Plan preparer is invalid.");
  }
  if (typeof value.preparedAt !== "string" || !isTimestamp(value.preparedAt)) {
    return invalid("Build Plan preparation time is invalid.");
  }
  return Object.freeze({
    ok: true,
    plan: Object.freeze({
      schemaVersion: DURABLE_BUILD_PLAN_SCHEMA_VERSION,
      taskId: value.taskId,
      requirements,
      requirementsIdentity: value.requirementsIdentity,
      content: value.content,
      contentIdentity,
      identity: value.identity,
      contextManifestPath: value.contextManifestPath,
      contextManifestIdentity: value.contextManifestIdentity,
      preparedBy: freezeActor(value.preparedBy),
      preparedAt: value.preparedAt,
    }),
  });
}

export function serializeDurableBuildPlan(plan: DurableBuildPlan): string {
  return `${JSON.stringify(plan, null, 2)}\n`;
}

export function buildPlanFileName(identity: ContractIdentity): string {
  return `${identity.slice("sha256:".length)}.json`;
}

function planIdentity(value: {
  readonly taskId: string;
  readonly requirementsIdentity: ContractIdentity;
  readonly contentIdentity: ContentHash;
  readonly contextManifestPath: string;
  readonly contextManifestIdentity: ContractIdentity;
}): ContractIdentity {
  return hashCanonicalJson(value);
}

function sameContentHash(value: unknown, expected: ContentHash): boolean {
  return (
    isRecord(value) &&
    value.algorithm === expected.algorithm &&
    value.digest === expected.digest
  );
}

function freezeRequirements(requirements: TaskIntent): TaskIntent {
  return Object.freeze({
    goals: Object.freeze([...requirements.goals]),
    nonGoals: Object.freeze([...requirements.nonGoals]),
    acceptanceCriteria: Object.freeze([...requirements.acceptanceCriteria]),
  });
}

function freezeActor(actor: WorkflowActor): WorkflowActor {
  return Object.freeze({
    kind: actor.kind,
    id: actor.id,
    sessionRef: actor.sessionRef,
  });
}

function isTaskIntent(value: unknown): value is TaskIntent {
  if (!isRecord(value)) {
    return false;
  }
  return (
    isStringArray(value.goals) &&
    isStringArray(value.nonGoals) &&
    isStringArray(value.acceptanceCriteria)
  );
}

function isWorkflowActor(value: unknown): value is WorkflowActor {
  return (
    isRecord(value) &&
    (value.kind === "orchestrator" ||
      value.kind === "user" ||
      value.kind === "agent" ||
      value.kind === "system") &&
    typeof value.id === "string" &&
    value.id.trim().length > 0 &&
    typeof value.sessionRef === "string" &&
    value.sessionRef.trim().length > 0
  );
}

function isStringArray(value: unknown): value is readonly string[] {
  return (
    Array.isArray(value) &&
    value.every((item) => typeof item === "string" && item.trim().length > 0)
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function invalid(message: string): ParseDurableBuildPlanResult {
  return Object.freeze({ ok: false, message });
}
