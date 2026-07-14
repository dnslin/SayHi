import { coreContract, type BootstrapContract } from "@sayhi/core";

export function readOmpBootstrapContract(): BootstrapContract {
  return coreContract.readBootstrapContract();
}
