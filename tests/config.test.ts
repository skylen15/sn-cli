import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";

import { getBlockedInstances, loadConfig } from "#src/config.ts";

describe("sn.config.json configuration", () => {
  it("defaults to empty list when config file is absent", () => {
    const dir = mkdtempSync(join(tmpdir(), "sn-test-config-absent-"));
    try {
      const config = loadConfig(dir);
      assert.deepEqual(config.blockedInstances, []);
      const blocked = getBlockedInstances(dir);
      assert.equal(blocked.size, 0);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("loads and canonicalizes blocked instances from sn.config.json", () => {
    const dir = mkdtempSync(join(tmpdir(), "sn-test-config-present-"));
    try {
      writeFileSync(
        join(dir, "sn.config.json"),
        JSON.stringify({
          blockedInstances: ["BLOCKED.service-now.com.", "prod.example.com", 123, null],
        }),
        "utf8",
      );
      const config = loadConfig(dir);
      assert.deepEqual(config.blockedInstances, ["blocked.service-now.com", "prod.example.com"]);
      const blocked = getBlockedInstances(dir);
      assert.equal(blocked.has("blocked.service-now.com"), true);
      assert.equal(blocked.has("prod.example.com"), true);
      assert.equal(blocked.has("allowed.service-now.com"), false);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("gracefully falls back to default when config is invalid JSON", () => {
    const dir = mkdtempSync(join(tmpdir(), "sn-test-config-invalid-"));
    try {
      writeFileSync(join(dir, "sn.config.json"), "{ invalid json", "utf8");
      const config = loadConfig(dir);
      assert.deepEqual(config.blockedInstances, []);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
