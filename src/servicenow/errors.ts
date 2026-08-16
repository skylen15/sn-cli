import { Runtime, Schema } from "effect";

/** Non-2xx ServiceNow response (or a transport failure mapped at the seam). */
export class SnRequestError extends Schema.TaggedError<SnRequestError>()(
  "SnRequestError",
  {
    message: Schema.String,
    detail: Schema.optionalKey(Schema.String),
    status: Schema.optionalKey(Schema.Number),
  },
) {
  readonly [Runtime.errorExitCode] = 4;
  // We render JSON on stderr via tapError; suppress runMain/tapCause pretty-print.
  readonly [Runtime.errorReported] = false;
}

/** Auth/token failures that mean the caller should re-authenticate. */
export class SnAuthError extends Schema.TaggedError<SnAuthError>()(
  "SnAuthError",
  {
    message: Schema.String,
  },
) {
  readonly [Runtime.errorExitCode] = 3;
  readonly [Runtime.errorReported] = false;
}

/** Batch run where some items succeeded and some failed. */
export class SnBatchPartialError extends Schema.TaggedError<SnBatchPartialError>()(
  "SnBatchPartialError",
  {
    message: Schema.String,
    failed: Schema.Number,
    total: Schema.Number,
  },
) {
  readonly [Runtime.errorExitCode] = 5;
  readonly [Runtime.errorReported] = false;
}

/** Batch run where every item failed. */
export class SnBatchFailedError extends Schema.TaggedError<SnBatchFailedError>()(
  "SnBatchFailedError",
  {
    message: Schema.String,
    failed: Schema.Number,
    total: Schema.Number,
  },
) {
  readonly [Runtime.errorExitCode] = 6;
  readonly [Runtime.errorReported] = false;
}

/** Search run that returned Hits but could not cover every Artifact (ADR 0012). */
export class SnSearchIncompleteError extends Schema.TaggedError<SnSearchIncompleteError>()(
  "SnSearchIncompleteError",
  {
    message: Schema.String,
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
export class SnLocalError extends Schema.TaggedError<SnLocalError>()(
  "SnLocalError",
  {
    message: Schema.String,
  },
) {
  readonly [Runtime.errorExitCode] = 8;
  readonly [Runtime.errorReported] = false;
}

export type SnError =
  | SnRequestError
  | SnAuthError
  | SnBatchPartialError
  | SnBatchFailedError
  | SnSearchIncompleteError
  | SnLocalError;

/** True when `u` is a tagged CLI error with a classified exit code. */
export const isSnError = (u: unknown): u is SnError =>
  Schema.is(SnRequestError)(u) ||
  Schema.is(SnAuthError)(u) ||
  Schema.is(SnBatchPartialError)(u) ||
  Schema.is(SnBatchFailedError)(u) ||
  Schema.is(SnSearchIncompleteError)(u) ||
  Schema.is(SnLocalError)(u);

/** Compact JSON for stderr (ADR 0007). */
export const snErrorJson = (error: SnError): string =>
  JSON.stringify({
    _tag: error._tag,
    message: error.message,
    ...(error._tag === "SnRequestError" && error.detail !== undefined
      ? { detail: error.detail }
      : {}),
    ...(error._tag === "SnRequestError" && error.status !== undefined
      ? { status: error.status }
      : {}),
    ...((error._tag === "SnBatchPartialError" ||
      error._tag === "SnBatchFailedError") && {
      failed: error.failed,
      total: error.total,
    }),
    ...(error._tag === "SnSearchIncompleteError" && {
      failed: error.failed,
      total: error.total,
      reasons: error.reasons,
      unsearched: error.unsearched,
    }),
  });
