import assert from "node:assert/strict";
import test from "node:test";

import { coreContract } from "@sayhi/core";
import { readOmpBootstrapContract } from "@sayhi/omp-plugin";

test("OMP reads the bootstrap contract from shared Core", () => {
  assert.strictEqual(
    readOmpBootstrapContract(),
    coreContract.readBootstrapContract(),
  );
});
