import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

const CLI = fileURLToPath(new URL("../../../src/cli.ts", import.meta.url));

const spawn = (args: ReadonlyArray<string>) => {
  const { stdout, stderr, status } = spawnSync(
    process.execPath,
    [CLI, ...args],
    { encoding: "utf8" },
  );
  return { stdout, stderr, code: status };
};

describe("rule group", () => {
  it("lists install in group help and replaces cursor in root help", () => {
    const group = spawn(["rule", "--help"]);
    assert.equal(group.code, 0);
    assert.match(group.stdout, /\binstall\b/);

    const root = spawn(["--help"]);
    assert.equal(root.code, 0);
    assert.match(root.stdout, /\brule\b/);
    assert.doesNotMatch(root.stdout, /\bcursor\b/);
  });

  it("rejects the removed cursor command", () => {
    const result = spawn(["cursor", "install-rule"]);
    assert.notEqual(result.code, 0);
  });
});
