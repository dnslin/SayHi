import assert from "node:assert/strict";
import test from "node:test";

import { coreContract } from "@sayhi/core";

test("Core exposes the versioned SayHi bootstrap contract", () => {
  assert.deepEqual(coreContract.readBootstrapContract(), {
    product: "SayHi",
    contractVersion: 1,
  });
});
