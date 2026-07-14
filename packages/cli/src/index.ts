import {
  coreContract,
  type BootstrapContract,
  type DomainValidationResult,
} from "@dnslin/sayhi-core";

export function readCliBootstrapContract(): BootstrapContract {
  return coreContract.readBootstrapContract();
}

export function validateCliDomainValue(
  request: unknown,
): DomainValidationResult {
  return coreContract.validateDomainValue(request);
}
