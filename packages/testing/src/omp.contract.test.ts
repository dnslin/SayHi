import assert from "node:assert/strict";
import test from "node:test";

import { coreContract } from "@dnslin/sayhi-core";
import {
  readOmpBootstrapContract,
  validateOmpDomainValue,
} from "@dnslin/sayhi-omp";

test("OMP reads the bootstrap contract from shared Core", () => {
  assert.strictEqual(
    readOmpBootstrapContract(),
    coreContract.readBootstrapContract(),
  );
});

test("OMP exposes the same domain validation result as Core", () => {
  const validRequest = {
    contractVersion: 1,
    kind: "recordEnvelope",
    value: { schemaVersion: 1, id: "TASK-42", futureField: true },
  };
  const invalidRequest = {
    contractVersion: 1,
    kind: "timestamp",
    value: "2026-07-14T00:00:00+00:00",
  };

  assert.deepEqual(
    validateOmpDomainValue(validRequest),
    coreContract.validateDomainValue(validRequest),
  );
  assert.deepEqual(
    validateOmpDomainValue(invalidRequest),
    coreContract.validateDomainValue(invalidRequest),
  );
});
