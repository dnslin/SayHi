import { coreContract, type BootstrapContract } from "@sayhi/core";

export function readCliBootstrapContract(): BootstrapContract {
  return coreContract.readBootstrapContract();
}
