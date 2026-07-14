import {
  coreContract,
  type BootstrapContract,
  type DomainValidationResult,
} from "@dnslin/sayhi-core";

export function readOmpBootstrapContract(): BootstrapContract {
  return coreContract.readBootstrapContract();
}

export function validateOmpDomainValue(
  request: unknown,
): DomainValidationResult {
  return coreContract.validateDomainValue(request);
}
