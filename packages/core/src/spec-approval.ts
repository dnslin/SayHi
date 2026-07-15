import {
  DOMAIN_VALIDATION_CONTRACT_VERSION,
  isIdentifier,
  validateDomainValue,
  type ContentHash,
} from "./validation.js";
import type { ManagedProjectFileSystem } from "./managed-project.js";
import { isRepositoryRelativePath } from "./repository-path.js";

export const SPEC_APPROVALS_PATH = ".sayhi/spec/approvals.json";

export interface ApprovedSpec {
  readonly path: string;
  readonly identity: ContentHash;
  readonly approvedBy: string;
}

export interface SpecApprovalFileSystem extends ManagedProjectFileSystem {}

export interface SpecApprovalDiagnostic {
  readonly path: string;
  readonly message: string;
  readonly remediation: string;
}

export type ReadApprovedSpecsResult =
  | Readonly<{ ok: true; approvals: readonly ApprovedSpec[] }>
  | Readonly<{ ok: false; diagnostics: readonly SpecApprovalDiagnostic[] }>;

export async function readApprovedSpecs(
  fileSystem: SpecApprovalFileSystem,
): Promise<ReadApprovedSpecsResult> {
  try {
    const entry = await fileSystem.inspect(SPEC_APPROVALS_PATH);
    if (entry.kind === "missing") {
      return Object.freeze({ ok: true, approvals: Object.freeze([]) });
    }
    if (entry.kind === "file") {
      return parseApprovedSpecs(await fileSystem.readFile(SPEC_APPROVALS_PATH));
    }
    return approvalFailure(
      "Spec approval registry is missing or unsafe.",
      "Restore the regular approvals.json file before assigning Approved Spec trust.",
    );
  } catch {
    return approvalFailure(
      "Spec approval registry could not be inspected safely.",
      "Inspect the Project Store path and permissions, then retry.",
    );
  }
}

export async function approveSpec(
  fileSystem: SpecApprovalFileSystem,
  approval: ApprovedSpec,
): Promise<ReadApprovedSpecsResult> {
  const current = await readApprovedSpecs(fileSystem);
  if (current.ok === false) {
    return current;
  }
  const validated = approvedSpec(approval);
  if (validated === null) {
    return approvalFailure(
      "Spec approval record is invalid.",
      "Provide a repository-relative path, content identity, and approval identifier.",
    );
  }
  const next = [
    ...current.approvals.filter((entry) => entry.path !== validated.path),
    validated,
  ].sort((left, right) => left.path.localeCompare(right.path));
  try {
    await fileSystem.writeFile(
      SPEC_APPROVALS_PATH,
      `${JSON.stringify({ schemaVersion: 1, approvals: next }, null, 2)}\n`,
    );
    return Object.freeze({ ok: true, approvals: Object.freeze(next) });
  } catch {
    return approvalFailure(
      "Spec approval registry could not be updated safely.",
      "Inspect the Project Store path and permissions, then retry approval.",
    );
  }
}

export function isApprovedSpec(
  approvals: readonly ApprovedSpec[],
  path: string,
  identity: ContentHash,
): boolean {
  return approvals.some(
    (approval) =>
      approval.path === path &&
      approval.identity.algorithm === identity.algorithm &&
      approval.identity.digest.toLowerCase() === identity.digest.toLowerCase(),
  );
}

function parseApprovedSpecs(content: string): ReadApprovedSpecsResult {
  try {
    const value = JSON.parse(content) as unknown;
    if (value === null || typeof value !== "object" || Array.isArray(value)) {
      return invalidRegistry();
    }
    const record = value as Record<string, unknown>;
    if (record.schemaVersion !== 1 || Array.isArray(record.approvals) === false) {
      return invalidRegistry();
    }
    const paths = new Set<string>();
    const approvals: ApprovedSpec[] = [];
    for (const candidate of record.approvals) {
      const approval = approvedSpec(candidate);
      if (approval === null || paths.has(approval.path)) {
        return invalidRegistry();
      }
      paths.add(approval.path);
      approvals.push(approval);
    }
    return Object.freeze({
      ok: true,
      approvals: Object.freeze(
        approvals.sort((left, right) => left.path.localeCompare(right.path)),
      ),
    });
  } catch {
    return invalidRegistry();
  }
}

function approvedSpec(value: unknown): ApprovedSpec | null {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  const record = value as Record<string, unknown>;
  if (
    typeof record.path !== "string" ||
    isRepositoryRelativePath(record.path) === false ||
    isIdentifier(record.approvedBy) === false ||
    validateDomainValue({
      contractVersion: DOMAIN_VALIDATION_CONTRACT_VERSION,
      kind: "contentHash",
      value: record.identity,
    }).ok === false
  ) {
    return null;
  }
  return Object.freeze({
    path: record.path,
    identity: Object.freeze({ ...(record.identity as ContentHash) }),
    approvedBy: record.approvedBy,
  });
}

function invalidRegistry(): Readonly<{
  ok: false;
  diagnostics: readonly SpecApprovalDiagnostic[];
}> {
  return approvalFailure(
    "Spec approval registry contains malformed or invalid content.",
    "Restore approvals.json with schemaVersion 1 and unique valid approval records.",
  );
}

function approvalFailure(
  message: string,
  remediation: string,
): Readonly<{ ok: false; diagnostics: readonly SpecApprovalDiagnostic[] }> {
  return Object.freeze({
    ok: false,
    diagnostics: Object.freeze([
      Object.freeze({ path: SPEC_APPROVALS_PATH, message, remediation }),
    ]),
  });
}
