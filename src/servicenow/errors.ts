import { Runtime, Schema } from "effect";

/** Non-2xx ServiceNow response (or a transport failure mapped at the seam). */
export class SnRequestError extends Schema.TaggedError<SnRequestError>()("SnRequestError", {
  message: Schema.String,
  hint: Schema.optionalKey(Schema.String),
  detail: Schema.optionalKey(Schema.String),
  status: Schema.optionalKey(Schema.Number),
}) {
  readonly [Runtime.errorExitCode] = 4;
  // We render JSON on stderr via tapError; suppress runMain/tapCause pretty-print.
  readonly [Runtime.errorReported] = false;
}

/** Auth/token failures that mean the caller should re-authenticate. */
export class SnAuthError extends Schema.TaggedError<SnAuthError>()("SnAuthError", {
  message: Schema.String,
  hint: Schema.optionalKey(Schema.String),
}) {
  readonly [Runtime.errorExitCode] = 3;
  readonly [Runtime.errorReported] = false;
}

/** Search run that returned Hits but could not cover every Artifact (ADR 0012). */
export class SnSearchIncompleteError extends Schema.TaggedError<SnSearchIncompleteError>()(
  "SnSearchIncompleteError",
  {
    message: Schema.String,
    hint: Schema.optionalKey(Schema.String),
    failed: Schema.Number,
    total: Schema.Number,
    reasons: Schema.Array(
      Schema.Struct({
        table: Schema.String,
        message: Schema.String,
      }),
    ),
    unsearched: Schema.Array(Schema.String),
  },
) {
  readonly [Runtime.errorExitCode] = 7;
  readonly [Runtime.errorReported] = false;
}

/** Local filesystem / tooling failure (not a ServiceNow HTTP error). */
export class SnLocalError extends Schema.TaggedError<SnLocalError>()("SnLocalError", {
  message: Schema.String,
  hint: Schema.optionalKey(Schema.String),
}) {
  readonly [Runtime.errorExitCode] = 8;
  readonly [Runtime.errorReported] = false;
}

/** Instance Guard denied a Blocked Instance (ADR 0017). */
export class SnGuardError extends Schema.TaggedError<SnGuardError>()("SnGuardError", {
  message: Schema.String,
  hint: Schema.optionalKey(Schema.String),
}) {
  readonly [Runtime.errorExitCode] = 9;
  readonly [Runtime.errorReported] = false;
}

export type SnError =
  | SnRequestError
  | SnAuthError
  | SnSearchIncompleteError
  | SnLocalError
  | SnGuardError;

/** True when `u` is a tagged CLI error with a classified exit code. */
export const isSnError = (u: unknown): u is SnError =>
  Schema.is(SnRequestError)(u) ||
  Schema.is(SnAuthError)(u) ||
  Schema.is(SnSearchIncompleteError)(u) ||
  Schema.is(SnLocalError)(u) ||
  Schema.is(SnGuardError)(u);

/** Compact JSON for stderr (ADR 0007). */
export const snErrorJson = (error: SnError): string => {
  interface ErrorJson {
    _tag: SnError["_tag"];
    message: string;
    hint?: string;
    detail?: string;
    status?: number;
    failed?: number;
    total?: number;
    reasons?: SnSearchIncompleteError["reasons"];
    unsearched?: SnSearchIncompleteError["unsearched"];
  }

  const json: ErrorJson = {
    _tag: error._tag,
    message: error.message,
  };
  if (error.hint !== undefined) {
    json.hint = error.hint;
  }
  if (error._tag === "SnRequestError") {
    if (error.detail !== undefined) {
      json.detail = error.detail;
    }
    if (error.status !== undefined) {
      json.status = error.status;
    }
  }
  if (error._tag === "SnSearchIncompleteError") {
    json.failed = error.failed;
    json.total = error.total;
    json.reasons = error.reasons;
    json.unsearched = error.unsearched;
  }
  return JSON.stringify(json);
};
