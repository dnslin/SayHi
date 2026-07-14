import assert from "node:assert/strict";
import test from "node:test";

import { readCliBootstrapContract } from "@dnslin/sayhi-cli";
import { coreContract } from "@dnslin/sayhi-core";

test("CLI reads the bootstrap contract from shared Core", () => {
  assert.strictEqual(
    readCliBootstrapContract(),
    coreContract.readBootstrapContract(),
  );
});
