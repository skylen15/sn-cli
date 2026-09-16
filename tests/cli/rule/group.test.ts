import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

const CLI = fileURLToPath(new URL("../../../src/cli.ts", import.meta.url));

const spawn = (args: ReadonlyArray<string>) => {
  const { stdout, stderr, status } = spawnSync(process.execPath, [CLI, ...args], {
    encoding: "utf8",
  });
  return { stdout, stderr, code: status };
};

describe("rule group", () => {
  it("prints the group's help and exits 0 when invoked with no leaf", () => {
    const { stdout, code } = spawn(["rule"]);
    assert.equal(code, 0);
    assert.match(stdout, /USAGE/);
    assert.match(stdout, /sn rule/);
  });

  it("lists install in group help and rule in root help", () => {
    const group = spawn(["rule", "--help"]);
    assert.equal(group.code, 0);
    assert.match(group.stdout, /\binstall\b/);

    const root = spawn(["--help"]);
    assert.equal(root.code, 0);
    assert.match(root.stdout, /\brule\b/);
    assert.doesNotMatch(root.stdout, /\bcursor\b/);
  });
});
