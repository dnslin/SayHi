import {
  coreContract,
  type BootstrapContract,
  type DomainValidationResult,
  type DependencyGraphValidationResult,
  type ContractRecordValidationResult,
} from "@dnslin/sayhi-core";

export function readOmpBootstrapContract(): BootstrapContract {
  return coreContract.readBootstrapContract();
}

export function validateOmpDomainValue(
  request: unknown,
): DomainValidationResult {
  return coreContract.validateDomainValue(request);
}

export function validateOmpContractRecord(
  request: unknown,
): ContractRecordValidationResult {
  return coreContract.validateContractRecord(request);
}

export function validateOmpDependencyGraph(
  request: unknown,
): DependencyGraphValidationResult {
  return coreContract.validateDependencyGraph(request);
}
