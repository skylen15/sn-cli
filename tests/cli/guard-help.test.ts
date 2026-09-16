import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

const CLI = fileURLToPath(new URL("../../src/cli.ts", import.meta.url));

const spawn = (args: ReadonlyArray<string>) => {
  const { stdout, stderr, status } = spawnSync(process.execPath, [CLI, ...args], {
    encoding: "utf8",
  });
  return { stdout, stderr, code: status };
};

describe("Instance Guard in --help", () => {
  it("states that the default CLI does not change ServiceNow", () => {
    const { stdout, code } = spawn(["--help"]);
    assert.equal(code, 0);
    assert.match(stdout, /does not change ServiceNow/i);
    assert.doesNotMatch(stdout, /Full CLI|sn:full/);
  });

  it("describes the always-on Instance Guard and Blocked Instances", () => {
    const { stdout, code } = spawn(["--help"]);
    assert.equal(code, 0);
    assert.match(stdout, /Instance Guard/);
    assert.match(stdout, /always-on/i);
    assert.match(stdout, /production and UAT Blocked Instances/);
    assert.match(stdout, /before network access/);
    assert.doesNotMatch(stdout, /Sensitive Tables|Sensitive References|ADR 0015/);
  });

  it("mentions the Instance Guard on each instance-facing group help", () => {
    for (const group of ["table", "script"] as const) {
      const { stdout, code } = spawn([group, "--help"]);
      assert.equal(code, 0, `${group} --help exits 0`);
      assert.match(stdout, /Instance Guard/, `${group} --help names Guard`);
      assert.match(stdout, /always-on/i, `${group} --help says always on`);
      assert.match(stdout, /production and UAT/i);
    }
  });

  it("keeps rule install local-only and outside the Instance Guard", () => {
    const group = spawn(["rule", "--help"]);
    assert.equal(group.code, 0);
    assert.match(group.stdout, /local filesystem only/i);
    assert.match(group.stdout, /outside the Instance Guard/i);

    const leaf = spawn(["rule", "install", "--help"]);
    assert.equal(leaf.code, 0);
    assert.match(leaf.stdout, /local/i);
    assert.match(leaf.stdout, /outside the Instance Guard/i);
  });
});
