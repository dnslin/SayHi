import { coreContract, type BootstrapContract } from "@dnslin/sayhi-core";

export function readOmpBootstrapContract(): BootstrapContract {
  return coreContract.readBootstrapContract();
}
