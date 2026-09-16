import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

const INSTALL_SH = fileURLToPath(new URL("../../install.sh", import.meta.url));

const runInstall = (installDir: string) => {
  const { stdout, stderr, status } = spawnSync("bash", [INSTALL_SH], {
    encoding: "utf8",
    env: { ...process.env, SN_INSTALL_DIR: installDir },
  });
  return { stdout, stderr, code: status };
};

const git = (cwd: string, args: ReadonlyArray<string>) => {
  const { status, stderr } = spawnSync("git", args, {
    cwd,
    encoding: "utf8",
  });
  assert.equal(status, 0, stderr);
};

describe("install.sh", () => {
  it("fails when SN_INSTALL_DIR is not a git repo", (t) => {
    if (process.platform === "win32") {
      t.skip("install.sh requires POSIX bash environment");
      return;
    }
    const dir = mkdtempSync(join(tmpdir(), "sn-install-nogit-"));
    try {
      const { code, stderr } = runInstall(dir);
      assert.notEqual(code, 0);
      assert.match(stderr, /not a git/i);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("fails when origin is not the sn-cli remote", (t) => {
    if (process.platform === "win32") {
      t.skip("install.sh requires POSIX bash environment");
      return;
    }
    const dir = mkdtempSync(join(tmpdir(), "sn-install-wrong-"));
    try {
      git(dir, ["init"]);
      git(dir, ["remote", "add", "origin", "git@example.com:other/repo.git"]);
      const { code, stderr } = runInstall(dir);
      assert.notEqual(code, 0);
      assert.match(stderr, /remote/i);
      assert.match(stderr, /skylen15\/sn-cli/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
