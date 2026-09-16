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

import { Schema } from "effect";

const CLI = fileURLToPath(new URL("../../../src/cli.ts", import.meta.url));
const SHIPPED = fileURLToPath(new URL("../../../.cursor/rules/sn-cli.mdc", import.meta.url));
const parsePathOutput = Schema.decodeUnknownSync(
  Schema.fromJsonString(Schema.Struct({ path: Schema.String })),
);
const parseLocalError = Schema.decodeUnknownSync(
  Schema.fromJsonString(
    Schema.Struct({
      _tag: Schema.String,
      message: Schema.String,
      hint: Schema.optionalKey(Schema.String),
    }),
  ),
);

const spawn = (args: ReadonlyArray<string>, cwd: string) => {
  const { stdout, stderr, status } = spawnSync(process.execPath, [CLI, ...args], {
    encoding: "utf8",
    cwd,
  });
  return { stdout, stderr, code: status };
};

const initGit = (dir: string) => {
  const r = spawnSync("git", ["init"], { cwd: dir, encoding: "utf8" });
  assert.equal(r.status, 0, r.stderr);
};

const tempDir = (prefix: string) => realpathSync(mkdtempSync(join(tmpdir(), prefix)));

describe("rule install", () => {
  it("copies sn-cli.mdc into the git root .cursor/rules and prints path JSON", () => {
    const root = tempDir("sn-rule-git-");
    initGit(root);
    const nested = join(root, "packages", "app");
    mkdirSync(nested, { recursive: true });

    const { stdout, stderr, code } = spawn(["rule", "install"], nested);
    assert.equal(code, 0, stderr);
    assert.equal(stderr, "");
    const body = parsePathOutput(stdout);
    const expected = join(root, ".cursor", "rules", "sn-cli.mdc");
    assert.equal(body.path, expected);
    assert.equal(readFileSync(expected, "utf8"), readFileSync(SHIPPED, "utf8"));
  });

  it("accepts an explicit --platform cursor", () => {
    const root = tempDir("sn-rule-platform-");
    initGit(root);
    const { stdout, stderr, code } = spawn(["rule", "install", "--platform", "cursor"], root);
    assert.equal(code, 0, stderr);
    const body = parsePathOutput(stdout);
    assert.equal(body.path, join(root, ".cursor", "rules", "sn-cli.mdc"));
  });

  it("rejects an unknown --platform at flag parse", () => {
    const root = tempDir("sn-rule-badplat-");
    initGit(root);
    const { stdout, code } = spawn(["rule", "install", "--platform", "claude"], root);
    assert.notEqual(code, 0);
    assert.match(stdout, /choices:\s*cursor/);
    assert.doesNotMatch(stdout, /"path"/);
  });

  it("falls back to cwd with a stderr warning when not in a git repo", () => {
    const cwd = tempDir("sn-rule-nogit-");
    const { stdout, stderr, code } = spawn(["rule", "install"], cwd);
    assert.equal(code, 0, stderr);
    assert.match(stderr, /not a git repo; installing into cwd/);
    const body = parsePathOutput(stdout);
    const expected = join(cwd, ".cursor", "rules", "sn-cli.mdc");
    assert.equal(body.path, expected);
    assert.ok(existsSync(expected));
  });

  it("exits 8 with SnLocalError JSON on stderr when the rule already exists", () => {
    const root = tempDir("sn-rule-exists-");
    initGit(root);
    const destDir = join(root, ".cursor", "rules");
    mkdirSync(destDir, { recursive: true });
    const dest = join(destDir, "sn-cli.mdc");
    writeFileSync(dest, "keep-me\n");

    const { stdout, stderr, code } = spawn(["rule", "install"], root);
    assert.equal(code, 8);
    assert.equal(stdout, "");
    const err = parseLocalError(stderr);
    assert.equal(err._tag, "SnLocalError");
    assert.match(err.message, /already exists/);
    assert.equal(
      err.hint,
      "Run `sn rule install --platform cursor --force` to overwrite the existing Rule.",
    );
    assert.equal(readFileSync(dest, "utf8"), "keep-me\n");
  });

  it("overwrites an existing rule when --force is set", () => {
    const root = tempDir("sn-rule-force-");
    initGit(root);
    const destDir = join(root, ".cursor", "rules");
    mkdirSync(destDir, { recursive: true });
    const dest = join(destDir, "sn-cli.mdc");
    writeFileSync(dest, "old\n");

    const { stdout, stderr, code } = spawn(["rule", "install", "--force"], root);
    assert.equal(code, 0, stderr);
    const body = parsePathOutput(stdout);
    assert.equal(body.path, dest);
    assert.equal(readFileSync(dest, "utf8"), readFileSync(SHIPPED, "utf8"));
  });
});
