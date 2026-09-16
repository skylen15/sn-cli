import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

import { Schema } from "effect";

import pkgAlias from "#package.json" with { type: "json" };
import { sn } from "#src/root.ts";

const PackageMetadata = Schema.Struct({
  name: Schema.String,
  version: Schema.String,
});

const pkgOnDisk = Schema.decodeUnknownSync(Schema.fromJsonString(PackageMetadata))(
  readFileSync(fileURLToPath(new URL("../../package.json", import.meta.url)), "utf8"),
);

describe("package subpath imports", () => {
  it("resolves #package.json with a JSON import attribute", () => {
    assert.equal(pkgAlias.name, pkgOnDisk.name);
    assert.equal(pkgAlias.version, pkgOnDisk.version);
  });

  it("resolves #src/* to a source module", () => {
    assert.equal(sn.name, "sn");
  });
});
