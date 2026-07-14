import assert from "node:assert/strict";
import test from "node:test";

import {
  readCliBootstrapContract,
  validateCliDomainValue,
} from "@dnslin/sayhi-cli";
import { coreContract } from "@dnslin/sayhi-core";

test("CLI reads the bootstrap contract from shared Core", () => {
  assert.strictEqual(
    readCliBootstrapContract(),
    coreContract.readBootstrapContract(),
  );
});

test("CLI exposes the same domain validation result as Core", () => {
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
    validateCliDomainValue(validRequest),
    coreContract.validateDomainValue(validRequest),
  );
  assert.deepEqual(
    validateCliDomainValue(invalidRequest),
    coreContract.validateDomainValue(invalidRequest),
  );
});
