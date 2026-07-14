import assert from "node:assert/strict";
import test from "node:test";

import { readCliBootstrapContract } from "@sayhi/cli";
import { coreContract } from "@sayhi/core";

test("CLI reads the bootstrap contract from shared Core", () => {
  assert.strictEqual(
    readCliBootstrapContract(),
    coreContract.readBootstrapContract(),
  );
});
