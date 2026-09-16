import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { SnAuthError, snErrorJson } from "#src/servicenow/errors.ts";

describe("ServiceNow error JSON", () => {
  it("includes an advisory hint only when the error provides one", () => {
    assert.deepEqual(
      JSON.parse(
        snErrorJson(
          new SnAuthError({
            message: 'Unknown Alias "dev".',
            hint: "Create the Alias with `sn auth add`.",
          }),
        ),
      ),
      {
        _tag: "SnAuthError",
        message: 'Unknown Alias "dev".',
        hint: "Create the Alias with `sn auth add`.",
      },
    );
    assert.deepEqual(JSON.parse(snErrorJson(new SnAuthError({ message: "Keychain failed." }))), {
      _tag: "SnAuthError",
      message: "Keychain failed.",
    });
  });
});
