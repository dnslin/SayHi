import {
  coreContract,
  type BootstrapContract,
  type DomainValidationResult,
  type DependencyGraphValidationResult,
  type ContractRecordValidationResult,
} from "@dnslin/sayhi-core";
export {
  CLI_RELEASE_ARTIFACT,
  CLI_MANAGED_PROJECT_INSTALLATION,
  runCli,
} from "./run-cli.js";
export type {
  CliJsonEnvelope,
  CliJsonDiagnostic,
  CliJsonError,
  CliJsonVersion,
  CliRunResult,
} from "./run-cli.js";
export { NodeManagedProjectFileSystem } from "./managed-project-filesystem.js";


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
