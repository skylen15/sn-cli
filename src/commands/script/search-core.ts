/** Pure GraphQL Engine search logic, ported from the browser tool's search-core.
 * Ticket 06 slice: Excerpts with context lines under a matched-priority budget. */

import { Predicate, Schema } from "effect";

export interface Line {
  lineNumber: number;
  content: string;
  matched: boolean;
}

export interface FieldMatch {
  field: string;
  matchedLineCount: number;
  omittedMatchedLines: number;
  lines: Line[];
}

export interface Hit {
  sysId: string;
  name: string;
  table: string;
  fieldMatches: FieldMatch[];
}

/** A Table together with the code fields the Dictionary reports for it. */
export interface Artifact {
  table: string;
  fields: string[];
  hasActive: boolean;
}

/** Artifacts per GraphQL document (browser tool BATCH_SIZE). */
export const ARTIFACTS_PER_DOCUMENT = 10;

const DEFAULT_MIN_WORD_LENGTH = 2;
const TOKEN_PATTERN = /"([^"]*)"|(\S+)/g;

function isJsonObject(value: Schema.Json | undefined): value is Schema.JsonObject {
  return Predicate.isObject(value);
}

/** How a multi-word term becomes words: one phrase, every word, or any word. */
export type MatchMode = "phrase" | "all" | "any";

function normalisePositiveInteger(value: number | undefined, fallback: number): number {
  const number = Number(value);
  if (!Number.isFinite(number) || number <= 0) {
    return fallback;
  }
  return Math.floor(number);
}

function normaliseMatchMode(value: MatchMode | string | undefined): MatchMode {
  return value === "all" || value === "any" ? value : "phrase";
}

function unwrapQuotedPhrase(text: string): string {
  const quoted = /^"([^"]*)"$/.exec(text);
  const inner = quoted?.[1];
  return inner !== undefined ? inner.trim() : text;
}

/** Words from a search term. `table:` / `field:` stay literal (flags own filters). */
export function tokenise(
  term: string,
  options?: { minWordLength?: number; matchMode?: MatchMode | string },
): string[] {
  const minWordLength = normalisePositiveInteger(options?.minWordLength, DEFAULT_MIN_WORD_LENGTH);
  const matchMode = normaliseMatchMode(options?.matchMode);
  const source = term;

  if (matchMode === "phrase") {
    const phrase = unwrapQuotedPhrase(source.trim());
    return phrase.length >= minWordLength ? [phrase] : [];
  }

  const words: string[] = [];
  TOKEN_PATTERN.lastIndex = 0;
  for (const match of source.matchAll(TOKEN_PATTERN)) {
    const value = (match[1] ?? match[2] ?? "").trim();
    if (value.length >= minWordLength) {
      words.push(value);
    }
  }
  return words;
}

export interface EncodedQueryOptions {
  matchMode?: MatchMode | string;
  includeActive?: boolean;
}

/** Encoded Query: one LIKE group per word, OR across fields.
 * Groups AND-join (`^`) for phrase/all, OR-join (`^NQ`) for any.
 * `active=true` is prepended per group when includeActive — required for ^NQ
 * because that operator starts a fresh query. */
export function buildEncodedQuery(
  words: ReadonlyArray<string>,
  fields: ReadonlyArray<string>,
  options?: EncodedQueryOptions,
): string {
  const matchMode = normaliseMatchMode(options?.matchMode);
  const includeActive = options?.includeActive === true;
  const groups = words.map((word) => fields.map((field) => `${field}LIKE${word}`).join("^OR"));
  const joiner = matchMode === "any" ? "^NQ" : "^";
  if (!includeActive) {
    return groups.join(joiner);
  }
  return groups.map((group) => `active=true^${group}`).join(joiner);
}

function isGraphqlIdentifier(value: string): boolean {
  return /^[_A-Za-z][_0-9A-Za-z]*$/.test(value);
}

function graphqlFieldSelection(fields: ReadonlyArray<string>): string {
  const selected: string[] = [];
  for (const field of fields) {
    if (isGraphqlIdentifier(field) && !selected.includes(field)) {
      selected.push(field);
    }
  }
  return selected.map((field) => `${field} { value displayValue }`).join(" ");
}

/** One Artifact's GlideRecord_Query fragment, or "" when the Table is not a
 * GraphQL identifier. */
function buildGraphqlFragment(
  table: string,
  encodedQuery: string,
  fields: ReadonlyArray<string>,
  limit: number,
): string {
  if (!isGraphqlIdentifier(table)) {
    return "";
  }
  const searchFields = graphqlFieldSelection(fields);
  return (
    `${table}(queryConditions: ${JSON.stringify(encodedQuery)}, ` +
    `pagination: { limit: ${limit} }, omitCount: false) { _rowCount _results { ` +
    `sys_id { value } sys_name { value displayValue } sys_class_name { value } ` +
    `${searchFields} } }`
  );
}

/** One-Artifact GraphQL document for POST /api/now/graphql. */
export function buildGraphqlQuery(
  table: string,
  encodedQuery: string,
  fields: ReadonlyArray<string>,
  limit: number,
): string {
  const fragment = buildGraphqlFragment(table, encodedQuery, fields, limit);
  return fragment ? `query { GlideRecord_Query { ${fragment} } }` : "";
}

/** Multi-Artifact GraphQL document — join fragments under one GlideRecord_Query. */
export function buildGraphqlBatchQuery(
  artifacts: ReadonlyArray<{
    table: string;
    encodedQuery: string;
    fields: ReadonlyArray<string>;
    limit: number;
  }>,
): string {
  const fragments: string[] = [];
  for (const artifact of artifacts) {
    const fragment = buildGraphqlFragment(
      artifact.table,
      artifact.encodedQuery,
      artifact.fields,
      artifact.limit,
    );
    if (fragment) {
      fragments.push(fragment);
    }
  }
  return fragments.length > 0 ? `query { GlideRecord_Query { ${fragments.join(" ")} } }` : "";
}

/** Split items into fixed-size windows (last window may be shorter). */
export function chunk<T>(items: ReadonlyArray<T>, size: number): T[][] {
  const out: T[][] = [];
  const window = Math.max(1, Math.floor(size));
  for (let i = 0; i < items.length; i += window) {
    out.push(items.slice(i, i + window));
  }
  return out;
}

function fieldValue(field: Schema.Json | undefined): string {
  if (field === null || field === undefined) {
    return "";
  }
  if (Predicate.isString(field) || Predicate.isNumber(field) || Predicate.isBoolean(field)) {
    return String(field);
  }
  if (!isJsonObject(field)) {
    return "";
  }
  if (field.value !== undefined && field.value !== null && field.value !== "") {
    return String(field.value);
  }
  if (field.displayValue !== undefined && field.displayValue !== null) {
    return String(field.displayValue);
  }
  return "";
}

function recordName(record: Schema.JsonObject): string {
  return (
    fieldValue(record.sys_name) ||
    fieldValue(record.name) ||
    fieldValue(record.sys_id) ||
    "(unnamed record)"
  );
}

function splitLines(text: string): string[] {
  return String(text).split(/\r\n|\r|\n/);
}

function matchingWordsInText(text: string, words: ReadonlyArray<string>): string[] {
  const lower = text.toLowerCase();
  return words.filter((word) => word && lower.includes(String(word).toLowerCase()));
}

function lineContainsWords(line: string, words: ReadonlyArray<string>): boolean {
  const lower = line.toLowerCase();
  return words.some((word) => word && lower.includes(String(word).toLowerCase()));
}

/** One context line either side of each Matched line; twenty lines per Field match. */
const CONTEXT_RADIUS = 1;
const EXCERPT_LINE_CAP = 20;

function tryAddLineIndex(included: Set<number>, index: number, lineCount: number): boolean {
  if (index < 0 || index >= lineCount) {
    return false;
  }
  if (included.has(index)) {
    return true;
  }
  if (included.size >= EXCERPT_LINE_CAP) {
    return false;
  }
  included.add(index);
  return true;
}

/**
 * Matched lines plus context under EXCERPT_LINE_CAP.
 * Divergence from the source (ADR 0012): matched lines fill the budget first,
 * then context spends what is left. The source interleaves context into the
 * same cap, so a sparsely-matching field can surrender Matched lines to
 * decoration.
 */
function buildExcerpt(
  value: string,
  words: ReadonlyArray<string>,
): {
  matchedLineCount: number;
  omittedMatchedLines: number;
  lines: Line[];
} | null {
  const lines = splitLines(value);
  const matchedIndexes: number[] = [];
  for (let lineIndex = 0; lineIndex < lines.length; lineIndex += 1) {
    const content = lines[lineIndex];
    if (content !== undefined && lineContainsWords(content, words)) {
      matchedIndexes.push(lineIndex);
    }
  }
  if (matchedIndexes.length === 0) {
    return null;
  }

  const included = new Set<number>();
  for (const matchedIndex of matchedIndexes) {
    if (included.size >= EXCERPT_LINE_CAP) {
      break;
    }
    if (!tryAddLineIndex(included, matchedIndex, lines.length)) {
      break;
    }
  }

  for (const matchedIndex of matchedIndexes) {
    if (!included.has(matchedIndex)) {
      continue;
    }
    for (let distance = 1; distance <= CONTEXT_RADIUS; distance += 1) {
      tryAddLineIndex(included, matchedIndex - distance, lines.length);
      tryAddLineIndex(included, matchedIndex + distance, lines.length);
    }
  }

  let matchedIncluded = 0;
  for (const index of matchedIndexes) {
    if (included.has(index)) {
      matchedIncluded += 1;
    }
  }

  const matchedIndexSet = new Set(matchedIndexes);
  const excerptLines = [...included]
    .sort((left, right) => left - right)
    .map((index) => {
      const content = lines[index] ?? "";
      return {
        lineNumber: index + 1,
        content,
        matched: matchedIndexSet.has(index),
      };
    });

  return {
    matchedLineCount: matchedIndexes.length,
    omittedMatchedLines: matchedIndexes.length - matchedIncluded,
    lines: excerptLines,
  };
}

/** Re-confirm words in each field; Records with no Field match are not Hits. */
export function processHits(
  table: string,
  fields: ReadonlyArray<string>,
  words: ReadonlyArray<string>,
  tableData: Schema.Json,
): Hit[] {
  const searchWords = words.filter((word) => word.length > 0);
  if (!searchWords.length || !isJsonObject(tableData)) {
    return [];
  }

  const rows = Array.isArray(tableData._results) ? tableData._results : [];

  const hits: Hit[] = [];
  for (const record of rows) {
    if (!isJsonObject(record)) {
      continue;
    }
    const fieldMatches: FieldMatch[] = [];
    for (const field of fields) {
      const value = fieldValue(record[field]);
      if (!value) {
        continue;
      }
      const matched = matchingWordsInText(value, searchWords);
      if (!matched.length) {
        continue;
      }
      const excerpt = buildExcerpt(value, matched);
      if (!excerpt) {
        continue;
      }
      fieldMatches.push({
        field,
        matchedLineCount: excerpt.matchedLineCount,
        omittedMatchedLines: excerpt.omittedMatchedLines,
        lines: excerpt.lines,
      });
    }
    if (!fieldMatches.length) {
      continue;
    }
    hits.push({
      sysId: fieldValue(record.sys_id),
      name: recordName(record),
      table: fieldValue(record.sys_class_name) || table,
      fieldMatches,
    });
  }
  return hits;
}

/** Field types the GraphQL Engine searches by default (code-bearing). */
const CODE_FIELD_TYPES = {
  script: true,
  script_plain: true,
  script_server: true,
  script_client: true,
  email_script: true,
  html_script: true,
  condition_string: true,
  conditions: true,
  expression: true,
  json: true,
  json_translations: true,
  xml: true,
  html: true,
  html_template: true,
  translated_html: true,
  css: true,
  graphql_schema: true,
} as const;

/** Encoded Query fragment that selects every code-bearing Dictionary row,
 * plus `active` so Artifact discovery can set hasActive. `^NQ` starts a fresh
 * query so boolean `active` rows are not filtered by internal_typeIN. */
export function codeFieldDictionaryQuery(): string {
  return (
    `internal_typeIN${Object.keys(CODE_FIELD_TYPES).join(",")}` +
    "^elementISNOTEMPTY^NQelement=active^ORDERBYname,element"
  );
}

/** Plain-text types offered but not selected for automatic search. */
const PLAIN_TEXT_FIELD_TYPES = {
  string: true,
} as const;

export interface DictionaryField {
  element: string;
  type: string;
  label: string;
  selected: boolean;
  declaredOn: string;
}

export interface DictionaryRead {
  label: string;
  fields: DictionaryField[];
  hasActive: boolean;
  found: boolean;
}

/** Read a Table API cell that may be a scalar or `{ value, display_value }`. */
function dictionaryCell(value: Schema.Json | undefined): string {
  if (value === null || value === undefined) {
    return "";
  }
  if (Array.isArray(value)) {
    return "";
  }
  if (isJsonObject(value)) {
    if (value.value !== undefined && value.value !== null && value.value !== "") {
      return String(value.value);
    }
    if (
      value.display_value !== undefined &&
      value.display_value !== null &&
      value.display_value !== ""
    ) {
      return String(value.display_value);
    }
    if (
      value.displayValue !== undefined &&
      value.displayValue !== null &&
      value.displayValue !== ""
    ) {
      return String(value.displayValue);
    }
    return "";
  }
  return String(value);
}

function payloadRows(payload: Schema.Json | undefined): ReadonlyArray<Schema.Json> {
  if (Array.isArray(payload)) {
    return payload;
  }
  return isJsonObject(payload) && Array.isArray(payload.result) ? payload.result : [];
}

/** Classify a `sys_dictionary` Table API payload into code / plain-text fields.
 * Subject rows win over ancestors; `selected` means code-bearing. */
export function readDictionary(
  payload: Schema.Json | undefined,
  subjectTable: string,
): DictionaryRead {
  const rows = payloadRows(payload);
  const subject = subjectTable.trim();
  let label = "";
  const fields: DictionaryField[] = [];
  let hasActive = false;
  const seen = new Set<string>();
  const subjectRows: Schema.JsonObject[] = [];
  const ancestorRows: Schema.JsonObject[] = [];

  for (const row of rows) {
    if (!isJsonObject(row)) {
      continue;
    }
    const tableName = dictionaryCell(row.name).trim() || subject;
    if (subject && tableName === subject) {
      subjectRows.push(row);
    } else {
      ancestorRows.push(row);
    }
  }

  const consumeRow = (row: Schema.JsonObject) => {
    const element = dictionaryCell(row.element).trim();
    const type = dictionaryCell(row.internal_type).trim();
    const fieldLabel = dictionaryCell(row.column_label).trim();
    const declaredOn = dictionaryCell(row.name).trim() || subject;

    if (!element) {
      if (fieldLabel && (!subject || declaredOn === subject)) {
        label = fieldLabel;
      }
      return;
    }

    if (element === "active") {
      hasActive = true;
    }

    if (seen.has(element)) {
      return;
    }

    const selected = type in CODE_FIELD_TYPES;
    const offered = selected || type in PLAIN_TEXT_FIELD_TYPES;
    if (!offered) {
      return;
    }

    seen.add(element);
    fields.push({
      element,
      type,
      label: fieldLabel || element,
      selected,
      declaredOn: declaredOn || subject,
    });
  };

  for (const row of subjectRows) {
    consumeRow(row);
  }
  for (const row of ancestorRows) {
    consumeRow(row);
  }

  return {
    label: label || (rows.length > 0 ? subject : ""),
    fields,
    hasActive,
    found: rows.length > 0,
  };
}

/** Every Artifact the Dictionary payload reports: Tables with code fields,
 * ordered by Table name. Plain-text types are ignored; `active` sets hasActive. */
export function discoverArtifacts(payload: Schema.Json | undefined): Artifact[] {
  const rows = payloadRows(payload);

  const byTable = new Map<string, { fields: string[]; hasActive: boolean }>();
  for (const row of rows) {
    if (!isJsonObject(row)) {
      continue;
    }
    const table = dictionaryCell(row.name).trim();
    const element = dictionaryCell(row.element).trim();
    const type = dictionaryCell(row.internal_type).trim();
    if (!table || !element) {
      continue;
    }
    let entry = byTable.get(table);
    if (!entry) {
      entry = { fields: [], hasActive: false };
      byTable.set(table, entry);
    }
    if (element === "active") {
      entry.hasActive = true;
    }
    if (!(type in CODE_FIELD_TYPES)) {
      continue;
    }
    if (!entry.fields.includes(element)) {
      entry.fields.push(element);
    }
  }

  return [...byTable.entries()]
    .filter(([, entry]) => entry.fields.length > 0)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([table, entry]) => ({
      table,
      fields: entry.fields,
      hasActive: entry.hasActive,
    }));
}

/** One GraphQL error entry, attributed to an Artifact when `path` names one. */
export interface QueryError {
  tableName: string;
  message: string;
}

/** Map GraphQL `errors` into attributed Failure reasons. The seam is not taught
 * about GraphQL — the command reads this array itself (ADR 0012). */
export function readQueryErrors(
  payload: Schema.Json | undefined,
  tableNames: ReadonlyArray<string>,
): QueryError[] {
  const errors = isJsonObject(payload) ? payload.errors : undefined;
  if (!Array.isArray(errors)) {
    return [];
  }
  const searched = new Set(tableNames);
  const out: QueryError[] = [];
  for (const entry of errors) {
    const raw = isJsonObject(entry) ? entry : undefined;
    const trimmed = Predicate.isString(raw?.message) ? raw.message.trim() : "";
    const message = trimmed || "Unspecified GraphQL error";
    let tableName = "";
    const path = raw?.path;
    if (Array.isArray(path)) {
      for (const step of path) {
        if (Predicate.isString(step) && searched.has(step)) {
          tableName = step;
          break;
        }
      }
    }
    out.push({ tableName, message });
  }
  return out;
}

/** True when GlideRecord_Query carries an object for this Artifact (empty
 * `_results` still counts — rows prove the Artifact was answered). */
export function hasArtifactData(
  glide: Schema.JsonObject | null | undefined,
  table: string,
): boolean {
  const value = glide?.[table];
  return isJsonObject(value);
}

/** GlideRecord_Query map from a GraphQL payload, or undefined when absent. */
export function glideRecordQuery(payload: Schema.Json | undefined): Schema.JsonObject | undefined {
  if (!isJsonObject(payload) || !isJsonObject(payload.data)) {
    return undefined;
  }
  const glide = payload.data.GlideRecord_Query;
  return isJsonObject(glide) ? glide : undefined;
}

/** A validation error rejects the whole document before any of it runs — no
 * Artifact in the batch has data. */
export function batchWasRejected(
  payload: Schema.Json | undefined,
  tableNames: ReadonlyArray<string>,
): boolean {
  if (tableNames.length === 0) {
    return false;
  }
  const glide = glideRecordQuery(payload) ?? {};
  return tableNames.every((table) => !hasArtifactData(glide, table));
}
