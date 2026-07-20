import {
  COORDINATED_RELEASE_ARTIFACTS,
  coreContract,
  type BootstrapContract,
  type DomainValidationResult,
  type DependencyGraphValidationResult,
  type ContractRecordValidationResult,
} from "@dnslin/sayhi-core";

export const OMP_RELEASE_ARTIFACT =
  COORDINATED_RELEASE_ARTIFACTS.artifacts.omp;

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
