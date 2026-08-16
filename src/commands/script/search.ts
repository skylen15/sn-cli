import { Effect, Option } from "effect";
import { Argument, Command, Flag } from "effect/unstable/cli";

import { sn } from "#src/root.ts";
import { emitJson, emitText } from "#src/emit.ts";
import { AliasFlag } from "#src/servicenow/auth.ts";
import { SnClient } from "#src/servicenow/client.ts";
import {
  SnRequestError,
  SnSearchIncompleteError,
} from "#src/servicenow/errors.ts";
import { inheritanceChain } from "#src/servicenow/inheritance.ts";
import {
  ARTIFACTS_PER_DOCUMENT,
  batchWasRejected,
  buildEncodedQuery,
  buildGraphqlBatchQuery,
  chunk,
  codeFieldDictionaryQuery,
  discoverArtifacts,
  glideRecordQuery,
  hasArtifactData,
  processHits,
  readDictionary,
  readQueryErrors,
  tokenise,
  type Artifact,
  type Hit,
  type MatchMode,
} from "#src/commands/script/search-core.ts";

interface ApiLineMatch {
  line?: number;
  context?: string;
}
interface ApiFieldMatch {
  field?: string;
  lineMatches?: ApiLineMatch[];
}
interface ApiHit {
  sysId?: string;
  name?: string;
  className?: string;
  matches?: ApiFieldMatch[];
}
interface ApiRecordTypeResult {
  recordType?: string;
  hits?: ApiHit[];
}

/** Map the API's group → hit → field → lineMatch nesting into our Hit model.
 * Keeps Field matches under their Record (with sysId); does not flatten to
 * one row per field. */
function toHits(groups: ApiRecordTypeResult[]): Hit[] {
  const out: Hit[] = [];
  for (const group of groups) {
    for (const hit of group.hits ?? []) {
      const fieldMatches: Hit["fieldMatches"] = [];
      for (const match of hit.matches ?? []) {
        // ponytail: native Engine has no context lines — every API lineMatch is
        // a Matched line; matched stays true and omittedMatchedLines stays 0
        // (GraphQL Excerpts hold lines back via search-core buildExcerpt).
        const lines = (match.lineMatches ?? []).map((lm) => ({
          lineNumber: lm.line ?? 0,
          content: lm.context ?? "",
          matched: true,
        }));
        fieldMatches.push({
          field: match.field ?? "",
          matchedLineCount: lines.length,
          omittedMatchedLines: 0,
          lines,
        });
      }
      // A Record with no Field match is not a Hit (CONTEXT.md / ADR 0012).
      if (fieldMatches.length === 0) {
        continue;
      }
      out.push({
        sysId: hit.sysId ?? "",
        name: hit.name ?? "",
        table: hit.className || group.recordType || "",
        fieldMatches,
      });
    }
  }
  return out;
}

function asText(hits: Hit[]): string {
  if (hits.length === 0) {
    return "No results found.";
  }
  const lines: string[] = [
    `Found ${hits.length} hit${hits.length === 1 ? "" : "s"}:`,
    "",
  ];
  for (const hit of hits) {
    lines.push(`${hit.table} > ${hit.name} (${hit.sysId})`);
    for (const fm of hit.fieldMatches) {
      lines.push(`  ${fm.field} (${fm.matchedLineCount})`);
      for (const lm of fm.lines) {
        // Matched lines use ':'; context lines use '-' (grep/ripgrep convention).
        const marker = lm.matched ? ":" : "-";
        lines.push(
          `    ${lm.lineNumber > 0 ? `L${lm.lineNumber}${marker} ` : ""}${lm.content}`,
        );
      }
    }
    lines.push("");
  }
  return lines.join("\n");
}

const DEFAULT_LIMIT = 50;

/** Concurrent GraphQL documents. Calibrate against a real instance if it objects. */
const GRAPHQL_DOCUMENT_CONCURRENCY = 4;

const searchNative = Effect.fn("script.search.native")(function* (
  term: string,
  searchAllScopes: boolean,
  currentApp: Option.Option<string>,
  limit: Option.Option<number>,
) {
  const params: Record<string, string> = {
    term,
    search_all_scopes: String(searchAllScopes),
  };
  if (Option.isSome(currentApp)) {
    params.current_app = currentApp.value;
  }
  if (Option.isSome(limit)) {
    params.limit = String(limit.value);
  }

  const { alias } = yield* sn;
  const client = yield* SnClient;
  const data = yield* client
    .request("/api/sn_codesearch/code_search/search", params)
    .pipe(Effect.provideService(AliasFlag, alias));

  // The API returns an array of groups, but collapses to a single object
  // when the result set is narrow — normalise to an array before mapping.
  // SAFETY: Code Search wraps groups in `{ result }`; we only read `.result`.
  const result = (data as { result?: unknown } | null)?.result;
  // SAFETY: after normalisation, each element is a group with optional
  // hits/matches; toHits defaults missing fields.
  const groups = (
    Array.isArray(result) ? result : result ? [result] : []
  ) as ApiRecordTypeResult[];
  return toHits(groups);
});

/** Artifact for a named Table: Dictionary classification over the inheritance
 * chain (ADR 0010). Plain-text types are offered but not selected. */
const resolveArtifact = Effect.fn("script.search.resolveArtifact")(function* (
  table: string,
) {
  const { alias } = yield* sn;
  const client = yield* SnClient;
  const withAlias = <A, E, R>(effect: Effect.Effect<A, E, R>) =>
    effect.pipe(Effect.provideService(AliasFlag, alias));

  const chain = yield* withAlias(inheritanceChain(table));
  // ponytail: one Dictionary page per run (limit 1000), matching the browser
  // tool. Ceiling: a table whose chain exceeds 1000 dictionary rows truncates
  // silently. Upgrade path: paginate if a real Artifact ever hits the cap.
  const payload = yield* withAlias(
    client.request("/api/now/table/sys_dictionary", {
      sysparm_query: `nameIN${chain.join(",")}^ORDERBYelement`,
      sysparm_fields: "name,element,column_label,internal_type",
      sysparm_display_value: "all",
      sysparm_limit: "1000",
    }),
  );
  const read = readDictionary(payload, table);
  const fields = read.fields
    .filter((field) => field.selected)
    .map((field) => field.element);
  return {
    table,
    fields,
    hasActive: read.hasActive,
    found: read.found,
  } as const;
});

/** Every Artifact on the instance: one Dictionary read of code-bearing rows. */
const discoverAllArtifacts = Effect.fn("script.search.discoverAllArtifacts")(
  function* () {
    const { alias } = yield* sn;
    const client = yield* SnClient;
    // ponytail: one Dictionary page (limit 10000). Ceiling: an instance with
    // more code-bearing dictionary rows truncates silently. Upgrade path:
    // paginate when measurement shows a real instance hitting the cap.
    const payload = yield* client
      .request("/api/now/table/sys_dictionary", {
        sysparm_query: codeFieldDictionaryQuery(),
        sysparm_fields: "name,element,column_label,internal_type",
        sysparm_display_value: "all",
        sysparm_limit: "10000",
      })
      .pipe(Effect.provideService(AliasFlag, alias));
    return discoverArtifacts(payload);
  },
);

type FailureReason = { table: string; message: string };

type BatchAccount = {
  _tag: "accounted";
  hits: Hit[];
  reasons: FailureReason[];
  unsearched: string[];
};

type BatchOutcome = BatchAccount | { _tag: "rejected" };

/** Attribute GraphQL errors and note Artifacts absent from an otherwise good
 * batch. A fully rejected multi-Artifact batch is not accounted here — the
 * caller re-asks one Artifact at a time instead. */
function accountGraphqlBatch(
  artifacts: ReadonlyArray<Artifact>,
  words: ReadonlyArray<string>,
  payload: unknown,
): BatchOutcome {
  const tables = artifacts.map((artifact) => artifact.table);
  if (batchWasRejected(payload, tables) && artifacts.length > 1) {
    return { _tag: "rejected" };
  }

  const queryErrors = readQueryErrors(payload, tables);
  const reasons = queryErrors.map((error) => ({
    table: error.tableName,
    message: error.message,
  }));
  const explained = new Set(
    queryErrors
      .map((error) => error.tableName)
      .filter((table) => table.length > 0),
  );
  const glide = glideRecordQuery(payload) ?? {};
  const hits: Hit[] = [];
  const unsearched: string[] = [];
  for (const artifact of artifacts) {
    if (hasArtifactData(glide, artifact.table)) {
      hits.push(
        ...processHits(
          artifact.table,
          artifact.fields,
          words,
          glide[artifact.table],
        ),
      );
    } else if (!explained.has(artifact.table)) {
      unsearched.push(artifact.table);
    }
  }
  return { _tag: "accounted", hits, reasons, unsearched };
}

const searchGraphqlBatch = Effect.fn("script.search.graphql.batch")(function* (
  words: ReadonlyArray<string>,
  artifacts: ReadonlyArray<Artifact>,
  limit: number,
  options: { matchMode: MatchMode; activeOnly: boolean },
) {
  const planned = artifacts.map((artifact) => ({
    table: artifact.table,
    encodedQuery: buildEncodedQuery(words, artifact.fields, {
      matchMode: options.matchMode,
      includeActive: options.activeOnly && artifact.hasActive,
    }),
    fields: artifact.fields,
    limit,
  }));
  const query = buildGraphqlBatchQuery(planned);
  if (!query) {
    // A named Artifact that is not a GraphQL identifier is a caller error;
    // Dictionary-discovered Artifacts that fail the same check are unsearched.
    const only = artifacts[0];
    if (artifacts.length === 1 && only) {
      return yield* new SnRequestError({
        message: `--table must be a GraphQL identifier (got ${JSON.stringify(only.table)})`,
      });
    }
    return {
      _tag: "accounted" as const,
      hits: [] as Hit[],
      reasons: [] as FailureReason[],
      unsearched: artifacts.map((artifact) => artifact.table),
    };
  }

  const { alias } = yield* sn;
  const client = yield* SnClient;
  const data = yield* client
    .request("/api/now/graphql", undefined, {
      method: "POST",
      body: { query },
    })
    .pipe(
      Effect.provideService(AliasFlag, alias),
      // ADR 0011: GraphQL fails loudly; name the way round, never fall back.
      // ponytail: rebuild SnRequestError field-by-field. Ceiling: a new optional
      // key on SnRequestError is dropped until this site is updated.
      Effect.mapError((error) =>
        error._tag === "SnRequestError"
          ? new SnRequestError({
              message: `${error.message} If GraphQL is unavailable on this instance, retry with --engine native.`,
              ...(error.detail !== undefined ? { detail: error.detail } : {}),
              ...(error.status !== undefined ? { status: error.status } : {}),
            })
          : error,
      ),
    );

  return accountGraphqlBatch(artifacts, words, data);
});

type GraphqlSearch = {
  hits: Hit[];
  reasons: FailureReason[];
  unsearched: string[];
  total: number;
};

const searchGraphql = Effect.fn("script.search.graphql")(function* (
  term: string,
  artifacts: ReadonlyArray<Artifact>,
  limit: number,
  matchMode: MatchMode,
  activeOnly: boolean,
) {
  const words = tokenise(term, { matchMode });
  if (words.length === 0 || artifacts.length === 0) {
    return {
      hits: [] as Hit[],
      reasons: [] as FailureReason[],
      unsearched: [] as string[],
      total: artifacts.length,
    } satisfies GraphqlSearch;
  }

  const options = { matchMode, activeOnly };
  const batches = chunk(artifacts, ARTIFACTS_PER_DOCUMENT);
  const reasons: FailureReason[] = [];
  const unsearched: string[] = [];
  const hits: Hit[] = [];

  const runBatch = (batch: ReadonlyArray<Artifact>) =>
    searchGraphqlBatch(words, batch, limit, options);

  const batchOutcomes = yield* Effect.forEach(batches, runBatch, {
    concurrency: GRAPHQL_DOCUMENT_CONCURRENCY,
  });

  for (let i = 0; i < batches.length; i += 1) {
    const batch = batches[i]!;
    const outcome = batchOutcomes[i]!;
    if (outcome._tag === "rejected") {
      // One Artifact at a time so the Artifact at fault is named on its own.
      const alone = yield* Effect.forEach(
        batch,
        (artifact) => runBatch([artifact]),
        { concurrency: 1 },
      );
      for (const one of alone) {
        // Solo batches never reject (only length > 1 can); they account.
        if (one._tag === "rejected") {
          continue;
        }
        hits.push(...one.hits);
        reasons.push(...one.reasons);
        unsearched.push(...one.unsearched);
      }
      continue;
    }
    hits.push(...outcome.hits);
    reasons.push(...outcome.reasons);
    unsearched.push(...outcome.unsearched);
  }

  return {
    hits,
    reasons,
    unsearched,
    total: artifacts.length,
  } satisfies GraphqlSearch;
});

const search = Command.make(
  "search",
  {
    term: Argument.string("term").pipe(
      Argument.withDescription("The code snippet / term to search for"),
    ),
    engine: Flag.choice("engine", ["graphql", "native"]).pipe(
      Flag.withDefault("graphql" as const),
      Flag.withDescription(
        "Search Engine: 'graphql' (default) queries Artifacts; 'native' uses Code Search (for instances with GraphQL off).",
      ),
    ),
    table: Flag.optional(
      Flag.string("table").pipe(
        Flag.withDescription(
          "Table name of the Artifact to search (GraphQL Engine). When omitted, every Artifact the Dictionary reports is searched.",
        ),
      ),
    ),
    field: Flag.optional(
      Flag.string("field").pipe(
        Flag.withDescription(
          "Code field to search (GraphQL Engine). When omitted, every code field the Dictionary reports is searched.",
        ),
      ),
    ),
    matchMode: Flag.choice("match-mode", ["phrase", "all", "any"]).pipe(
      Flag.withDefault("phrase" as const),
      Flag.withDescription(
        "How a multi-word term matches (GraphQL Engine): 'phrase' (default) keeps it one literal string; 'all' requires every word; 'any' requires one.",
      ),
    ),
    includeInactive: Flag.boolean("include-inactive").pipe(
      Flag.withDefault(false),
      Flag.withDescription(
        "Include inactive Records (GraphQL Engine). Defaults to false — Artifacts that declare an active field are filtered to active=true.",
      ),
    ),
    searchAllScopes: Flag.boolean("search-all-scopes").pipe(
      Flag.withDefault(true),
      Flag.withDescription(
        "Native Engine only: when false, limits results to current-app's scope. Defaults to all scopes.",
      ),
    ),
    currentApp: Flag.optional(
      Flag.string("current-app").pipe(
        Flag.withDescription(
          "Native Engine only: application scope (e.g. 'x_myapp') to limit results to. Only effective when --search-all-scopes is false.",
        ),
      ),
    ),
    limit: Flag.optional(
      Flag.integer("limit").pipe(
        Flag.withDescription("Maximum number of results to return"),
      ),
    ),
    format: Flag.choice("format", ["json", "text"]).pipe(
      Flag.withDefault("json" as const),
      Flag.withDescription(
        "Output shape: 'json' returns Hit records with Field matches and Excerpts; 'text' returns a human-readable summary",
      ),
    ),
  },
  Effect.fn("script.search")(function* ({
    term,
    engine,
    table,
    field,
    matchMode,
    includeInactive,
    searchAllScopes,
    currentApp,
    limit,
    format,
  }) {
    let hits: Hit[];
    let incomplete:
      | {
          failed: number;
          total: number;
          reasons: FailureReason[];
          unsearched: string[];
        }
      | undefined;
    if (engine === "graphql") {
      let artifacts: Artifact[];
      if (Option.isSome(table)) {
        const resolved = yield* resolveArtifact(table.value);
        if (Option.isSome(field)) {
          artifacts = [
            {
              table: resolved.table,
              fields: [field.value],
              hasActive: resolved.hasActive,
            },
          ];
        } else if (resolved.fields.length === 0) {
          return yield* new SnRequestError({
            message: resolved.found
              ? `Table ${JSON.stringify(table.value)} has no code fields in the Dictionary`
              : `Table ${JSON.stringify(table.value)} was not found in the Dictionary`,
          });
        } else {
          artifacts = [
            {
              table: resolved.table,
              fields: resolved.fields,
              hasActive: resolved.hasActive,
            },
          ];
        }
      } else {
        artifacts = yield* discoverAllArtifacts();
        if (Option.isSome(field)) {
          const named = field.value;
          artifacts = artifacts
            .filter((artifact) => artifact.fields.includes(named))
            .map((artifact) => ({
              table: artifact.table,
              fields: [named],
              hasActive: artifact.hasActive,
            }));
        }
      }
      const outcome = yield* searchGraphql(
        term,
        artifacts,
        Option.isSome(limit) ? limit.value : DEFAULT_LIMIT,
        matchMode,
        !includeInactive,
      );
      hits = outcome.hits;
      if (outcome.reasons.length > 0 || outcome.unsearched.length > 0) {
        incomplete = {
          failed: outcome.reasons.length,
          total: outcome.total,
          reasons: outcome.reasons,
          unsearched: outcome.unsearched,
        };
      }
    } else {
      hits = yield* searchNative(term, searchAllScopes, currentApp, limit);
    }

    if (format === "text") {
      yield* emitText(asText(hits));
    } else {
      yield* emitJson(hits);
    }

    if (incomplete) {
      const { failed, total, reasons, unsearched } = incomplete;
      return yield* new SnSearchIncompleteError({
        message:
          failed > 0
            ? `${failed} search failure${failed === 1 ? "" : "s"} across ${total} artifacts`
            : `${unsearched.length} of ${total} artifacts unsearched`,
        failed,
        total,
        reasons,
        unsearched,
      });
    }
  }),
).pipe(
  Command.withDescription(
    "Find where a code snippet exists across the instance. Defaults to the GraphQL Engine; use --engine native for Code Search.",
  ),
);

export { search };
