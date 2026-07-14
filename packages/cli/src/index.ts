import { coreContract, type BootstrapContract } from "@dnslin/sayhi-core";

export function readCliBootstrapContract(): BootstrapContract {
  return coreContract.readBootstrapContract();
}
