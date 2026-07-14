import { validateDomainValue } from "./validation.js";

export {
  DOMAIN_VALIDATION_CONTRACT_VERSION,
  DURABLE_RECORD_SCHEMA_VERSION,
} from "./validation.js";
export type {
  ContentHash,
  ContentHashAlgorithm,
  DomainValidationFailure,
  DomainValidationKind,
  DomainValidationRequest,
  DomainValidationResult,
  DomainValidationSuccess,
  DurableRecordEnvelope,
  Identifier,
  Timestamp,
  ValidationDiagnostic,
  ValidationDiagnosticCode,
  Version,
} from "./validation.js";

export interface BootstrapContract {
  readonly product: "SayHi";
  readonly contractVersion: 1;
}

export interface CoreContract {
  readBootstrapContract(): BootstrapContract;
  readonly validateDomainValue: typeof validateDomainValue;
}

const bootstrapContract: BootstrapContract = Object.freeze({
  product: "SayHi",
  contractVersion: 1,
});

export const coreContract: CoreContract = Object.freeze({
  readBootstrapContract: () => bootstrapContract,
  validateDomainValue,
});
