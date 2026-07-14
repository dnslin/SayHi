import assert from "node:assert/strict";
import test from "node:test";

import { coreContract } from "@dnslin/sayhi-core";
import { readOmpBootstrapContract } from "@dnslin/sayhi-omp";

test("OMP reads the bootstrap contract from shared Core", () => {
  assert.strictEqual(
    readOmpBootstrapContract(),
    coreContract.readBootstrapContract(),
  );
});
