import { hashCanonicalJson, type ContractIdentity } from "./identity.js";

export interface KnowledgeCandidateContent {
  readonly type: string;
  readonly statement: string;
  readonly scope: readonly string[];
  readonly confidence: string;
  readonly proposedAction: string;
  readonly target: string;
}

/**
 * Stable identity for the proposed knowledge itself. Provenance and human
 * review remain outside this material so independently observed duplicates
 * can be detected without conflating their Evidence.
 */
export function hashKnowledgeCandidateContent(
  candidate: KnowledgeCandidateContent,
): ContractIdentity {
  return hashCanonicalJson({
    type: candidate.type,
    statement: candidate.statement,
    scope: candidate.scope,
    confidence: candidate.confidence,
    proposedAction: candidate.proposedAction,
    target: candidate.target,
  });
}
