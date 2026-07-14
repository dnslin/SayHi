import {
  coreContract,
  type BootstrapContract,
  type DomainValidationResult,
  type DependencyGraphValidationResult,
  type ContractRecordValidationResult,
} from "@dnslin/sayhi-core";

export function readCliBootstrapContract(): BootstrapContract {
  return coreContract.readBootstrapContract();
}

export function validateCliDomainValue(
  request: unknown,
): DomainValidationResult {
  return coreContract.validateDomainValue(request);
}

export function validateCliContractRecord(
  request: unknown,
): ContractRecordValidationResult {
  return coreContract.validateContractRecord(request);
}

export function validateCliDependencyGraph(
  request: unknown,
): DependencyGraphValidationResult {
  return coreContract.validateDependencyGraph(request);
}
