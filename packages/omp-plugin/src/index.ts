import {
  coreContract,
  type BootstrapContract,
  type DomainValidationResult,
  type DependencyGraphValidationResult,
} from "@dnslin/sayhi-core";

export function readOmpBootstrapContract(): BootstrapContract {
  return coreContract.readBootstrapContract();
}

export function validateOmpDomainValue(
  request: unknown,
): DomainValidationResult {
  return coreContract.validateDomainValue(request);
}

export function validateOmpDependencyGraph(
  request: unknown,
): DependencyGraphValidationResult {
  return coreContract.validateDependencyGraph(request);
}
