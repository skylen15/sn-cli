import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

const CLI = fileURLToPath(new URL("../../../src/cli.ts", import.meta.url));

const spawn = (args: ReadonlyArray<string>, cwd: string) => {
  const { stdout, stderr, status } = spawnSync(
    process.execPath,
    [CLI, ...args],
    { encoding: "utf8", cwd },
  );
  return { stdout, stderr, code: status };
};

const initGit = (dir: string) => {
  const result = spawnSync("git", ["init"], { cwd: dir, encoding: "utf8" });
  assert.equal(result.status, 0, result.stderr);
};

const tempDir = (prefix: string) =>
  realpathSync(mkdtempSync(join(tmpdir(), prefix)));

describe("rule install", () => {
  it("installs the General rule by default at the Git root", () => {
    const root = tempDir("sn-rule-general-");
    initGit(root);
    const nested = join(root, "packages", "app");
    mkdirSync(nested, { recursive: true });

    const { stdout, stderr, code } = spawn(["rule", "install"], nested);

    assert.equal(code, 0, stderr);
    assert.equal(stderr, "");
    const expected = join(root, "AGENTS.md");
    assert.deepEqual(JSON.parse(stdout), { path: expected });
    const body = readFileSync(expected, "utf8");
    assert.match(body, /^<!-- sn-cli rule:start -->\n/);
    assert.match(body, /\n## Live ServiceNow via `sn` CLI\n/);
    assert.match(body, /<!-- sn-cli rule:end -->\n$/);
    assert.doesNotMatch(body, /required_permissions|alwaysApply/);
  });

  it("installs the Claude representation in CLAUDE.md", () => {
    const root = tempDir("sn-rule-claude-");
    initGit(root);

    const result = spawn(["rule", "install", "--platform", "claude"], root);

    assert.equal(result.code, 0, result.stderr);
    const expected = join(root, "CLAUDE.md");
    assert.deepEqual(JSON.parse(result.stdout), { path: expected });
    const body = readFileSync(expected, "utf8");
    assert.match(body, /^<!-- sn-cli rule:start -->/);
    assert.doesNotMatch(body, /required_permissions|alwaysApply/);
    assert.equal(existsSync(join(root, "AGENTS.md")), false);
  });

  it("installs the Cursor representation with platform-specific metadata", () => {
    const root = tempDir("sn-rule-cursor-");
    initGit(root);

    const result = spawn(["rule", "install", "--platform", "cursor"], root);

    assert.equal(result.code, 0, result.stderr);
    const expected = join(root, ".cursor", "rules", "sn-cli.mdc");
    assert.deepEqual(JSON.parse(result.stdout), { path: expected });
    const body = readFileSync(expected, "utf8");
    assert.match(body, /^---\ndescription:/);
    assert.match(body, /alwaysApply: true/);
    assert.match(body, /required_permissions: \["all"\]/);
    assert.match(body, /\n# Live ServiceNow via `sn` CLI\n/);
    assert.doesNotMatch(body, /sn-cli rule:start/);
  });

  it("is idempotent for Cursor and requires force when its rule differs", () => {
    const root = tempDir("sn-rule-cursor-collision-");
    initGit(root);
    const args = ["rule", "install", "--platform", "cursor"];
    const first = spawn(args, root);
    assert.equal(first.code, 0, first.stderr);
    const path = join(root, ".cursor", "rules", "sn-cli.mdc");
    const installed = readFileSync(path, "utf8");

    const identical = spawn(args, root);
    assert.equal(identical.code, 0, identical.stderr);
    assert.equal(readFileSync(path, "utf8"), installed);

    writeFileSync(path, "custom\n");
    const collision = spawn(args, root);
    assert.equal(collision.code, 8);
    assert.equal(readFileSync(path, "utf8"), "custom\n");

    const forced = spawn([...args, "--force"], root);
    assert.equal(forced.code, 0, forced.stderr);
    assert.equal(readFileSync(path, "utf8"), installed);
  });

  it("is an idempotent no-op when the installed rule is identical", () => {
    const root = tempDir("sn-rule-idempotent-");
    initGit(root);
    const first = spawn(["rule", "install"], root);
    assert.equal(first.code, 0, first.stderr);
    const path = join(root, "AGENTS.md");
    const body = readFileSync(path, "utf8");

    const second = spawn(["rule", "install"], root);

    assert.equal(second.code, 0, second.stderr);
    assert.deepEqual(JSON.parse(second.stdout), { path });
    assert.equal(readFileSync(path, "utf8"), body);
  });

  it("normalizes an identical managed file to one final newline", () => {
    const root = tempDir("sn-rule-final-newline-");
    initGit(root);
    const first = spawn(["rule", "install"], root);
    assert.equal(first.code, 0, first.stderr);
    const path = join(root, "AGENTS.md");
    writeFileSync(path, `${readFileSync(path, "utf8")}\n\n`);

    const second = spawn(["rule", "install"], root);

    assert.equal(second.code, 0, second.stderr);
    assert.match(readFileSync(path, "utf8"), /rule:end -->\n$/);
    assert.doesNotMatch(readFileSync(path, "utf8"), /rule:end -->\n\n/);
  });

  it("preserves project instructions and CRLF when appending", () => {
    const root = tempDir("sn-rule-existing-");
    initGit(root);
    const path = join(root, "AGENTS.md");
    writeFileSync(path, "# Project\r\n\r\nKeep this.\r\n\r\n");

    const result = spawn(["rule", "install"], root);

    assert.equal(result.code, 0, result.stderr);
    const body = readFileSync(path, "utf8");
    assert.ok(body.startsWith("# Project\r\n\r\nKeep this.\r\n\r\n"));
    assert.match(body, /<!-- sn-cli rule:start -->\r\n## Live ServiceNow/);
    assert.ok(body.endsWith("<!-- sn-cli rule:end -->\r\n"));
    assert.doesNotMatch(body, /(?<!\r)\n/);
  });

  it("rejects a different managed section without changing the file", () => {
    const root = tempDir("sn-rule-collision-");
    initGit(root);
    const path = join(root, "AGENTS.md");
    const original =
      "# Project\n\n<!-- sn-cli rule:start -->\nold\n<!-- sn-cli rule:end -->\n";
    writeFileSync(path, original);

    const result = spawn(["rule", "install"], root);

    assert.equal(result.code, 8);
    assert.equal(result.stdout, "");
    assert.equal(JSON.parse(result.stderr)._tag, "SnLocalError");
    assert.equal(readFileSync(path, "utf8"), original);
  });

  it("force replaces only a different managed section", () => {
    const root = tempDir("sn-rule-force-");
    initGit(root);
    const path = join(root, "AGENTS.md");
    writeFileSync(
      path,
      "# Project\n\n<!-- sn-cli rule:start -->\nold\n<!-- sn-cli rule:end -->\n\nFooter\n\n",
    );

    const result = spawn(["rule", "install", "--force"], root);

    assert.equal(result.code, 0, result.stderr);
    const body = readFileSync(path, "utf8");
    assert.match(body, /^# Project\n\n<!-- sn-cli rule:start -->/);
    assert.match(body, /<!-- sn-cli rule:end -->\n\nFooter\n$/);
    assert.doesNotMatch(body, /\nold\n/);
  });

  it("rejects malformed markers even with force and does not change the file", () => {
    const root = tempDir("sn-rule-malformed-");
    initGit(root);
    const path = join(root, "AGENTS.md");
    const original = "# Project\n\n<!-- sn-cli rule:start -->\nold\n";
    writeFileSync(path, original);

    const result = spawn(["rule", "install", "--force"], root);

    assert.equal(result.code, 8);
    assert.equal(JSON.parse(result.stderr)._tag, "SnLocalError");
    assert.equal(readFileSync(path, "utf8"), original);
  });

  it("falls back to cwd with a warning outside a Git worktree", () => {
    const cwd = tempDir("sn-rule-nogit-");

    const result = spawn(["rule", "install"], cwd);

    assert.equal(result.code, 0, result.stderr);
    assert.match(result.stderr, /not a git repo; installing into cwd/);
    assert.deepEqual(JSON.parse(result.stdout), {
      path: join(cwd, "AGENTS.md"),
    });
  });

  it("classifies local filesystem failures as SnLocalError", () => {
    const root = tempDir("sn-rule-filesystem-");
    initGit(root);
    mkdirSync(join(root, "AGENTS.md"));

    const result = spawn(["rule", "install"], root);

    assert.equal(result.code, 8);
    assert.equal(result.stdout, "");
    assert.equal(JSON.parse(result.stderr)._tag, "SnLocalError");
  });
});
