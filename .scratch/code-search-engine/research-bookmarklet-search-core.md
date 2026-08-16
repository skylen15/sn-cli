# Research: how the Code Search bookmarklet's search actually works

Status: findings
Date: 2026-08-16
Scope: the search **logic** and data model of `/Users/P026886/coding/snab-bookmarklets/code-search`, read as a candidate to port into `sn script search`. UI, DOM, rendering, CSS, sidebar, modal, results pane, clipboard, and bookmarklet injection are deliberately out of scope and are not described here.

Primary sources, in the order the brief set them:

1. `code-search/search-core.js` (1442 lines) — the UI-free core, and the authority for every behavioural claim below. Cited as `search-core.js:LINE`.
2. `code-search/search-core.test.mjs` (2518 lines) — cited as `search-core.test.mjs:LINE`.
3. `code-search/CONTEXT.md` — the glossary. Its terms are used verbatim throughout.
4. `code-search/README.md` and the ADRs under `docs/adr/` of that repo.
5. `code-search/artifact-map.json` — shape and size only.
6. `code-search/app.js` — consulted only where `search-core.js` leaves a question open, which is exactly one thing: the on-the-wire request shapes and the run loop that calls the core. Cited as `app.js:LINE`.

Anything not traceable to one of those is labelled **inference**.

## Summary

The bookmarklet is not a wrapper over ServiceNow Code Search. It is a **search engine of its own** that keeps Code Search as a fallback, and almost everything interesting lives on the side that is not Code Search.

The primary **Engine** is GraphQL: `POST /api/now/graphql`, querying tables directly, ten **Artifacts** per request, driven by a curated **Artifact map** of 451 tables and 862 code fields that the tool owns rather than the instance (`artifact-map.json`; `app.js:7`). Because that engine returns the **complete field value** for every code field it selects, the tool computes line numbers, chooses context lines, and verifies word matches itself, in pure code, with no extra round trip (ADR 0004). The native Engine — `GET /api/sn_codesearch/code_search/search` (`app.js:2589-2619`) — exists because GraphQL can be switched off per instance, and it is strictly the weaker of the two: it is bounded by the instance's configured search group `sn_codesearch.Studio Search Group` (`app.js:8`), so it cannot search an **Added artifact** at all, it returns only the lines it chose with no context, and its line text arrives HTML-escaped.

What the GraphQL engine buys over the native API, concretely: an artifact set the tool controls instead of an admin-configured search group; per-artifact and per-field targeting (`table:` / `field:` filters); `active=true` filtering; a per-artifact row limit; **Excerpt** context lines; owner resolution up a `parentChains` walk so a Flow-owned variable reports the Flow; literal substring semantics the tool can re-verify (the native API stems and applies synonyms, so it returns lines the term is not in); and honest per-artifact accounting.

The price is that GraphQL will not admit an unauthenticated session. It answers a lapsed session with `HTTP 200` and an empty result, indistinguishable from a term with no matches. Three mechanisms exist purely to contain that: a **Capability probe** that counts rows on `sys_properties` before the run (`search-core.js:765-790`), a **Confirming probe** after any run that saw an artifact return no rows (`search-core.js:885-894`), and the **Unverified artifact** concept that reports a dash rather than a zero when the confirmation comes back unauthenticated.

That containment machinery is the part of the design most worth understanding before porting, and also the part whose *reasoning* is most browser-specific — see section 9.

## Glossary pointer

`code-search/CONTEXT.md` is the shared language and this document uses it verbatim. The terms an `sn` reader needs:

| Term | Meaning (`CONTEXT.md`) |
| --- | --- |
| **Artifact** | A table *together with* the specific fields on it that hold code. Not "table". |
| **Artifact map** | The instance-agnostic curated catalogue of Artifacts, categories, and parent chains. |
| **Added artifact** | An Artifact a user adds for a code-bearing table the map does not carry. |
| **Inherited field** | A field an Added artifact can be searched on but does not declare — declared on a table it extends. |
| **Field index** | Artifact map as cached for one instance, merged with that host's Added artifacts. |
| **Engine** | The mechanism performing a search: **GraphQL engine** or **native engine**. |
| **Engine mode** | Which Engine a search uses: Auto (default), or a forced choice. |
| **Match mode** | How a term with whitespace becomes terms: **phrase** (default), **all**, **any**. |
| **Capability probe** | The one trivial GraphQL query run before a search in Auto or forced GraphQL mode. |
| **Refused request** | A request the instance answers `401`, on either Engine. |
| **Failure reason** | The short sentence recorded for each counted error, so a count never outruns its reasons. |
| **Lapsed session** | A session the instance stops authenticating mid-run. |
| **Confirming probe** | The Capability probe run a second time, at the end of a run that saw an empty Artifact. |
| **Unverified artifact** | An Artifact that returned no *rows* on a run the Confirming probe found lapsed. |
| **Search run** | One execution: term and options as they stood, over the selected Artifacts, by one Engine. |
| **Hit** | A matched *record*. The unit every count is in. |
| **Field match** | One code field of one Hit whose value contains the term. |
| **Excerpt** | The numbered lines shown for a Field match — matched lines plus context lines, capped. |
| **Matched line** | A line of an Excerpt that itself contains the term, as against a **context line**. |

Two vocabulary traps that matter when reading the source. First, "parent" means **owner** (the record that owns another) in `parentChains` / `parentRef` / `parentTerminalLabels`, and means **table inheritance** in the Inherited-field discovery path; `CONTEXT.md` (Inherited field) resolves the collision by naming the latter "inherited" and never "parent". Second, `sn`'s own `search_code` vocabulary ("group → hit → field → lineMatch", ADR 0003 of *this* repo) is the native API's shape, not the bookmarklet's; the bookmarklet's `Hit` is a record and its `Field match` is a field, which is a different nesting from the API's.

---

## 1. The two engines

### 1.1 What the core builds, and what it does not

`search-core.js` is pure: no DOM, no network (`README.md`, "Search-core contract"). It produces a **plan** per Artifact and consumes a **response** per Artifact. The HTTP is `app.js`'s.

`build(artifactMap, term, options)` (`search-core.js:205-262`) returns an object keyed by table name, each value `{ encodedQuery, fields, limit }` (`search-core.test.mjs:96-104`). That is the whole GraphQL-side contract from the core. It returns `{}` when the Artifact map has no `artifacts` object (`search-core.js:207-210`) or the term yields no words (`search-core.js:218-220`).

The pipeline inside `build`:

1. `minWordLength` normalised, default **2** (`search-core.js:16`, `:212-215`).
2. `matchMode` normalised, default **phrase** (`search-core.js:32-34`, `:216`).
3. `parseTerm` extracts filters and words (`search-core.js:217`; section 4).
4. Selected Artifacts: `options.selectedArtifacts` if an array, else `defaultArtifactNames(artifactMap)` (`search-core.js:222-225`).
5. `matchAll = matchMode !== 'any'` — so **phrase and all share the AND join**, and only `any` differs (`search-core.js:226`).
6. `activeOnly` defaults **true**: `safeOptions.activeOnly !== false` (`search-core.js:227`).
7. `limit` default **50** (`search-core.js:15`, `:228`).
8. Entries are filtered to the selection, then by `matchesTableFilter`, sorted by `artifactOrder`, and each contributes a plan unless `selectedFields` came back empty (`search-core.js:231-259`).

`active=true` is only added when the Artifact itself declares it: `activeOnly && artifact.hasActive` (`search-core.js:251`), verified at `search-core.test.mjs:268-286`.

`buildEncodedQuery(words, fields, matchAll, includeActive)` (`search-core.js:187-203`) is a ServiceNow encoded query, not GraphQL. One group per word, `field + 'LIKE' + word` OR-joined across fields with `^OR`; groups joined with `^` for AND and `^NQ` for OR:

- one word, active: `active=true^scriptLIKEneedle^ORconditionLIKEneedle` (`search-core.test.mjs:99`)
- match-all, no active: `scriptLIKEalpha^ORconditionLIKEalpha^scriptLIKEbeta^ORconditionLIKEbeta` (`search-core.test.mjs:204-206`)
- match-any, active: `active=true^...alpha^NQactive=true^...beta` — the `active=true` is **repeated into every `^NQ` clause**, because `^NQ` starts a fresh query (`search-core.js:200-202`, `search-core.test.mjs:222-224`)

### 1.2 GraphQL request shape

`search-core.js` does not build GraphQL. `app.js` does, from the plan:

```
query { GlideRecord_Query {
  sys_script(queryConditions: "active=true^scriptLIKEneedle", pagination: { limit: 50 }, omitCount: false) {
    _rowCount
    _results { sys_id { value } sys_name { value displayValue } sys_class_name { value } script { value displayValue } condition { value displayValue } }
  }
  ... up to ten such fragments ...
} }
```

Reconstructed from `buildFragment` (`app.js:2277-2296`), `graphqlFieldSelection` (`app.js:2250-2275`), and `executeBatch` (`app.js:2353-2364`). Points that matter:

- `sys_id`, `sys_name`, `sys_class_name` are always selected, before the code fields (`app.js:2270-2274`).
- Where the Artifact declares `parentRef`, its `tableField` and `sysIdField` are appended to the selection so owner resolution has something to walk (`app.js:2257-2264`).
- Every table name and field name is gated through `isGraphqlIdentifier` — `/^[_A-Za-z][_0-9A-Za-z]*$/` — and a table failing it produces no fragment at all (`app.js:2246-2248`, `:2278-2280`).
- `encodedQuery` is interpolated with `JSON.stringify`, so quoting is the only escaping (`app.js:2289`).
- `omitCount: false` is what makes `_rowCount` available; the core never reads it, but the run loop does (see section 3).
- Batch size is **10** Artifacts per request (`app.js:7`, `:2313`).
- Transport: `POST`, `credentials: 'same-origin'`, `X-UserToken: window.g_ck` (`app.js:2319-2334`, `:63-69`).

### 1.3 GraphQL response processing — `process`

`process(rawResponse, words, artifactMap)` (`search-core.js:544-635`):

- Requires an `artifacts` map and at least one non-empty string word, else `{}` (`search-core.js:546-557`).
- Iterates the response's own keys; a table absent from the Artifact map is skipped silently (`search-core.js:561-565`, `search-core.test.mjs:1255-1276`).
- Reads rows from `tableData._results`, defaulting to `[]` (`search-core.js:572-575`).
- Per row, per field: `fieldValue(record[field])` — prefers `.value`, falls back to `.displayValue`, tolerates raw scalars (`search-core.js:269-286`).
- **Re-verifies the words**: `matchingWordsInText(value, searchWords)` returns only the words actually present in *that field's* value, and only those are handed to `buildExcerpt` (`search-core.js:591-596`). A field with no word present contributes no Field match; a record with no Field match is not a Hit (`search-core.js:609-611`).
- Field selection during processing passes **no filters**: `selectedFields(artifact, [])` (`search-core.js:567`). So `process` will consider any curated code field present in the response, not only the ones a `field:` filter narrowed the query to. In practice the response only carries the queried fields, so the two agree — *inference*, from `graphqlFieldSelection` selecting `plan.fields` only (`app.js:2293`).
- Hit shape: `{ sysId, name, sysClassName, fieldMatches, owner? }` where `name` is `recordName` (`sys_name` → `name` → `sys_id` → `'(unnamed record)'`, `search-core.js:288-296`) and `sysClassName` falls back to the table name (`search-core.js:616`).
- Per Artifact: `{ hitCount, hits }`, and an Artifact with zero Hits is **omitted from the result entirely** (`search-core.js:626-631`).

Two consequences of the re-verification worth stating plainly. First, `process` requires only **one** word per field, even in match-all mode — the AND is enforced by the encoded query at the *record* level, so a record matching `alpha` in `script` and `beta` in `condition` is one Hit with two Field matches, each highlighting only its own word (*inference* from `search-core.js:591-594` read against `buildEncodedQuery`; no test asserts this case directly). Second, an Artifact can legitimately return rows and produce no Hits, which is precisely why the empty-Artifact rule in section 3 counts **rows** rather than Hits (`app.js:3235-3239`).

### 1.4 Native request shape

`GET /api/sn_codesearch/code_search/search` with five query parameters (`app.js:2589-2596`):

| Parameter | Value |
| --- | --- |
| `term` | `nativeTerm(words)` — not the raw user input (`search-core.js:915-924`) |
| `limit` | the plan's limit |
| `search_all_scopes` | hard-coded `true` |
| `search_group` | hard-coded `sn_codesearch.Studio Search Group` (`app.js:8`) |
| `table` | the single Artifact's table name |

So the native engine is dispatched **one Artifact per request**, and it is table-scoped, which is the verb `sn`'s ADR 0003 explicitly ruled out of scope for `search_code`. Transport is `GET`, `credentials: 'same-origin'`, `X-UserToken` (`app.js:2598-2612`).

### 1.5 Native response processing — `processNative`

`processNative(tableName, response, words)` (`search-core.js:641-747`) produces the **same** shape as `process`, so the rest of the tool never branches on Engine (`README.md`, `processNative` section).

- Normalises `response.result` to an array, accepting a bare object (`search-core.js:651-654`).
- Skips a payload whose `recordType` is set and does not equal the requested table; a payload with **no** `recordType` is accepted (`search-core.js:659-665`).
- Field name is the first truthy of `fieldLabel`, `field`, `fieldName`, `name` — so the label wins over the element name (`search-core.js:677-687`).
- Line content is `decodeHtmlEntities(lineMatch.escaped)`; the record name is `stripHtmlTags(record.name)` (`search-core.js:670-671`, `:693-695`).
- `lineNumber` is used when finite and `> 0`, floored; otherwise a **sequential 1-based index within the Field match** (`search-core.js:701-705`, `search-core.test.mjs:1996-2027`).
- Every line is `matched: true` unconditionally, and a line whose words cannot be located keeps an empty `highlightRanges` rather than being dropped — because dropping it would take its Field match, and possibly the whole Hit, with it (`search-core.js:696-709`, `search-core.test.mjs:2029-2070`).
- Hits are grouped by `sysId` across all payloads and all matches, in first-seen order, so two fields matching on one record is one Hit with two Field matches (`search-core.js:715-731`, `search-core.test.mjs:2105-2148`).
- `omittedMatchedLines` is always `0` and `matchedLineCount` is simply `lines.length` (`search-core.js:728-729`).
- `words` is required non-empty (`search-core.js:647-649`) but is used **only** for highlight ranges. Native Hits are never filtered by it.

### 1.6 What each Engine can do that the other cannot

GraphQL only:

- Search an Artifact set the tool owns, independent of an admin-configured search group (ADR 0002, opening paragraph).
- Search an **Added artifact** at all (ADR 0007, last consequence; `search-core.js:1366-1369`).
- Narrow to specific fields, and apply `active=true` and a per-Artifact row limit (`search-core.js:187-203`, `:251`).
- Context lines in an Excerpt, because it holds the full field value (ADR 0004).
- Resolve an owner (`search-core.js:484-542`; `processNative` "does not resolve owners", `README.md`).
- Literal, case-insensitive substring semantics the core re-verifies (`search-core.js:591`).

Native only:

- Run at all where GraphQL is disabled — the entire reason it exists (ADR 0002).
- Report a `401` honestly, so a Lapsed session needs no confirming (`search-core.js:881-884`).
- Match by **stemming and synonym**, finding lines the term is not literally in (`search-core.js:695-699`). This is a capability, not only a nuisance: it finds `run` from `running`. The tool keeps those lines unhighlighted.
- Supply `lineNumber` without the tool holding the field value.

---

## 2. Engine mode and the Capability probe

### 2.1 Normalisation

`normaliseEngineMode` (`search-core.js:824-829`): `'graphql'` and `'native'` pass; **everything else, including `''` and `undefined`, is `'auto'`** (`search-core.test.mjs:1616-1619`, `:1790-1799`).

`normaliseProbeStatus` (`search-core.js:831-836`): `'available'` and `'unauthenticated'` pass; everything else — including `null` — is `'unavailable'` (`search-core.test.mjs:1801-1811`).

### 2.2 `readProbe` — the three answers

`readProbe(httpStatus, payload)` (`search-core.js:765-790`), in evaluation order:

| Condition | Answer |
| --- | --- |
| `readRequestFailure(status)` is `unauthenticated`, i.e. status is `401` | `unauthenticated` |
| status outside `200..299` | `unavailable` |
| `payload.errors` is a non-empty array | `unavailable` |
| `payload.data.GlideRecord_Query` missing or not an object | `unavailable` |
| `sys_properties._rowCount` absent, `null`, or non-finite | `unavailable` |
| row count `> 0` | `available` |
| row count `=== 0` | `unauthenticated` |

Each row has a test: `search-core.test.mjs:1554-1608`. The probe query is `query { GlideRecord_Query { sys_properties(pagination: { limit: 1 }) { _rowCount } } }` (`app.js:2557-2560`).

The load-bearing fact is that **`sys_properties` is never empty on a live instance**, so a structurally valid zero count is the instance refusing an unauthenticated session rather than a fact about data (`search-core.js:758-764`; ADR 0002, second amendment). This exists because GraphQL, unlike the Table and `sn_codesearch` APIs, can answer an unauthenticated request with `HTTP 200` and a valid-but-empty body — read as availability, that made a Lapsed session look like a healthy GraphQL instance holding no matching code, and the tool blamed the term (ADR 0002).

The asymmetry in the unreadable cases is deliberate: a missing count is reported as **no GraphQL**, not as no session, because "no GraphQL" keeps the fallback open while "no session" refuses to search (`search-core.js:762-764`, `search-core.test.mjs:1599-1608`).

### 2.3 `resolveEngine` — the decision

`resolveEngine(mode, probeStatus)` (`search-core.js:846-867`) returns `{ engine, forced }` plus `reason` when `engine` is `null`:

| Mode | Probe | Result |
| --- | --- | --- |
| `native` | not consulted | `{ engine: 'native', forced: true }` |
| `auto` | `unauthenticated` | `{ engine: null, forced: false, reason: 'unauthenticated' }` |
| `auto` | `available` | `{ engine: 'graphql', forced: false }` |
| `auto` | `unavailable` | `{ engine: 'native', forced: false }` |
| `graphql` | `unauthenticated` | `{ engine: null, forced: true, reason: 'unauthenticated' }` |
| `graphql` | `available` | `{ engine: 'graphql', forced: true }` |
| `graphql` | `unavailable` | `{ engine: null, forced: true, reason: 'graphql-unavailable' }` |

Tests: `search-core.test.mjs:1682-1704`, `:1755-1788`.

**Only `unavailable` has a fallback.** `unauthenticated` has none because the native engine has no session either, so falling back would trade one empty answer for another (`search-core.js:854-857`; `CONTEXT.md`, Capability probe). And forced GraphQL on an instance without GraphQL is **refused rather than silently downgraded**, so the engine indicator stays trustworthy (`search-core.js:862-863`; ADR 0002 first amendment).

### 2.4 `requiresProbe`

`requiresProbe(mode)` (`search-core.js:871-876`) is **derived, not restated**: it is true exactly when `resolveEngine(mode, 'available').engine !== resolveEngine(mode, 'unavailable').engine`. True for `auto` and `graphql`, false for `native` (`search-core.test.mjs:1610-1619`). Forced native therefore never probes, and a dead session there surfaces as per-Artifact errors (ADR 0002 amendment).

One thing the core cannot express and `app.js` handles: an **aborted** probe must not read as "GraphQL unavailable", because that would dispatch a native search instead of stopping (`app.js:2578-2586`).

---

## 3. Session integrity

Four distinct mechanisms, and the distinctions between them are the point.

### 3.1 Refused request — `readRequestFailure`

`readRequestFailure(httpStatus)` (`search-core.js:752-756`) is two lines: `401` → `'unauthenticated'`, everything else → `'failed'`. `undefined` and `null` are `'failed'` (`search-core.test.mjs:1549-1552`).

The reasoning: a `401` from *any* API is a fact about the **session**, not about the Artifact being searched, so refusals are counted apart from Artifact failures (`search-core.js:749-751`; `CONTEXT.md`, Refused request). A failure that never reached a status — an abort, or the network — says nothing about the session, so guessing authentication would be an overreach (`search-core.test.mjs:1547-1548`). `readProbe` shares this rule, so `401` is understood in one place (`search-core.js:767`).

`app.js` acts on it by incrementing a separate `failures.unauthenticated` counter alongside the general count (`app.js:3391-3408`).

### 3.2 Lapsed session, and the case GraphQL hides

A **Lapsed session** is one the instance stops authenticating mid-run. GraphQL reports it two ways: as a Refused request, or — **with no error at all** — as a success carrying no rows, which is indistinguishable from an Artifact that simply has no matches (`CONTEXT.md`, Lapsed session). The Capability probe cannot catch this, because it answers once, before the run starts.

### 3.3 Confirming probe — `requiresSessionConfirmation`

`requiresSessionConfirmation(outcome)` (`search-core.js:885-894`) is true when **all three** hold:

1. `outcome.engine === 'graphql'`
2. `!outcome.cancelled`
3. `outcome.emptyArtifacts` is a non-empty array

Native runs are false, because there a lapse is an honest `401` that `readRequestFailure` already names (`search-core.js:881-884`, `search-core.test.mjs:1656-1664`). A cancelled run is false (`search-core.test.mjs:1666-1675`). An unreadable outcome is false (`search-core.test.mjs:1677-1680`).

The run's **hit total is deliberately not consulted**: a session can die partway through a run, leaving earlier Artifacts with real Hits, so a run that found 44 Hits and one empty Artifact still confirms (`search-core.js:878-881`, `search-core.test.mjs:1634-1645`).

`app.js` spends the probe and converts the answer: **only an outright `unauthenticated` counts**. An unreadable probe, a network error, or a cancel leaves the run reporting exactly what it saw (`app.js:3428-3443`).

### 3.4 The rule that makes an Artifact Unverified rather than zero-hits

This is the subtle one. An **Unverified artifact** is an Artifact that returned no **rows** on a run whose session the Confirming probe found lapsed (`CONTEXT.md`, Unverified artifact).

**Rows, not Hits, decide.** `app.js:3240-3250` collects `emptyArtifacts` by reading `data[tableName]._results` and pushing the table name when that array is absent or empty — *after* `process` has already run and produced a hit count for the same Artifact. The comment states the reasoning: the encoded query matches by substring and `process()` re-verifies the words, so an Artifact can legitimately return rows and no Hits — and rows prove a session that was alive when it answered (`app.js:3235-3239`). An Artifact with rows keeps its honest count even if that count is zero.

Two further specifics:

- An Artifact missing from the response entirely is **not** an empty Artifact; it is marked unavailable on a different path (`app.js:3251-3258`), and `hasArtifactData` is the discriminator (`app.js:3208-3215`).
- When a rejected batch is retried one Artifact at a time, the retries' empty Artifacts **join the run's**, because the lapse they may be hiding is the same one (`app.js:3606-3611`).
- A confirmed lapse leaves no way to tell which empty answers predated it, so **all** of them are reported as Unverified rather than only some (`CONTEXT.md`, Unverified artifact; `app.js:3436-3438`).

### 3.5 Unverified Added artifacts under native — `unsearchedAddedArtifacts`

A different absence with the same failure mode. `unsearchedAddedArtifacts(outcome)` (`search-core.js:1370-1389`) returns `[]` unless `outcome.engine === 'native'`, then filters `outcome.selectedTableNames` to those whose Artifact has `category === 'added'`.

The native engine is bounded by the instance's configured search group, so an Added artifact falls outside it and returns nothing. Naming the ones a native run selected — and saying nothing on a GraphQL run — is what stops that absence from reading as zero Hits (`search-core.js:1366-1369`, `search-core.test.mjs:1816-1882`). An Auto run that fell back to native is already resolved to `engine: 'native'`, so the one rule covers both without restating mode logic (`search-core.test.mjs:1886-1907`).

---

## 4. Term parsing and Match modes

### 4.1 `parseTerm`

`parseTerm(term, minWordLength, matchMode)` (`search-core.js:72-120`) returns `{ fieldFilters, tableFilters, words }`.

Tokenisation is `TOKEN_PATTERN = /"([^"]*)"|(\S+)/g` (`search-core.js:17`) — a double-quoted run, or a whitespace-free run. Each token is trimmed.

**Filters are recognised only on unquoted tokens** (`search-core.js:85`): `^table:(.+)$/i` and `^field:(.+)$/i`, value lower-cased (`search-core.js:88-100`). A quoted `"table:foo"` is a search word, not a filter — verified by probe: phrase mode yields `['alpha "table:foo" beta']`, match-all yields `['alpha','table:foo','beta']`.

Each recognised filter records a **span** via `spanWithSeparator` and is skipped as a word.

Non-filter tokens are kept as words only when `value.length >= minWordLength` (`search-core.js:103-105`).

### 4.2 The three Match modes

`normaliseMatchMode` (`search-core.js:32-34`): `'all'` and `'any'` pass, **everything else is `'phrase'`** (`search-core.test.mjs:232-247`).

- **phrase** (default). After the token loop, `words` is *discarded and replaced*: the filter spans are cut out of the original source, the remainder trimmed, `unwrapQuotedPhrase` applied, and the result becomes a single-element word list — or `[]` if shorter than `minWordLength` (`search-core.js:108-113`). So phrase mode searches **the term as typed, punctuation included** and quotes preserved. Probe: `say "hi" there` → `['say "hi" there']`. A pasted 17-word error message stays one word (`search-core.test.mjs:1312-1318`).
- **all** — split on whitespace, every word must appear; groups joined `^` (`search-core.test.mjs:195-212`).
- **any** — same split, one word is enough; groups joined `^NQ` (`search-core.test.mjs:214-230`).

An explicitly quoted phrase survives as **one word** in `all` and `any` (`search-core.test.mjs:249-266`: `a "two words" xyz` at `minWordLength: 3` → `['two words', 'xyz']`).

The rationale is recorded in the export block: matching is by substring with **no notion of a word boundary**, so a short word taken on its own matches inside unrelated code — `on` inside `condition`. Splitting is therefore the deliberate choice and holding the term together is the default (`search-core.js:1401-1404`; `README.md`, Search controls). Two tests make it concrete: a pasted message does not match a record that merely contains its words (`search-core.test.mjs:1352-1375`), and `tokenise('take action on')` in phrase mode matches nothing in `function onCondition(current) {` while `tokenise('on')` does (`search-core.test.mjs:1377-1395`).

### 4.3 `unwrapQuotedPhrase`

`search-core.js:67-70`: `^"([^"]*)"$` — a pair wrapping the **whole** term is stripped and the inside trimmed. `  "alpha beta"  ` → phrase `alpha beta` (`search-core.test.mjs:143-157`). `""` yields an empty phrase and therefore no words (probe). The reason: quoting is how the other modes keep words together, so a user who quotes out of habit gets the phrase they meant rather than one with quote characters in it (`search-core.js:64-66`).

### 4.4 `spanWithSeparator` and `removeSpans`

`spanWithSeparator(source, start, end)` (`search-core.js:39-52`) extends the span forward over trailing whitespace; **if the token runs to the end of the source**, it instead extends backward over leading whitespace. `removeSpans` (`search-core.js:54-62`) cuts spans back-to-front so earlier indexes stay valid.

The purpose is that lifting a filter token out of a phrase must not leave a gap the phrase would then search for literally (`search-core.js:36-38`). `alpha table:sys_script beta` → phrase `alpha beta` (`search-core.test.mjs:159-173`); two adjacent filter tokens likewise (`search-core.test.mjs:175-193`); a filter at the end also (probe: `alpha beta table:x` → `['alpha beta']`).

### 4.5 `minWordLength` and short words

Default **2** (`search-core.js:16`). `normalisePositiveInteger` (`search-core.js:122-128`) rejects non-finite and `<= 0` values back to the default and floors the rest — so `minWordLength: 0` behaves as `2` (probe) and `limit: 8.9` becomes `8` (`search-core.test.mjs:821-839`).

In `all` / `any`, a too-short word is silently dropped from the word list, leaving the others (`search-core.test.mjs:249-266`; probe `a bb ccc` at 3 → `['ccc']`). In phrase mode the test is on the whole phrase, so a one-character term yields no plan at all (`search-core.test.mjs:1320-1324`).

`build` returns `{}` for empty, too-short, and filter-only input (`search-core.test.mjs:304-308`).

### 4.6 `tokenise` and `nativeTerm`

`tokenise(term, options)` (`search-core.js:896-907`) is `parseTerm(...).words` under the same normalisation, so callers can pass **the same options object** to `build` and `tokenise` — words that disagree with the query would highlight the wrong thing (`README.md`, `tokenise`).

`nativeTerm(words)` (`search-core.js:915-924`) rejoins a word list into the single string the native API takes: non-empty strings only, any word containing whitespace re-quoted, and **quotes inside a quoted word deleted**. `['alpha','beta']` → `alpha beta`; `tokenise('alpha beta')` → `'"alpha beta"'`; `gs.addErrorMessage("Cannot approve")` → `'"gs.addErrorMessage(Cannot approve)"'` (`search-core.test.mjs:1326-1350`).

Two reasons, both recorded: the native API takes the term as typed, so the `table:`/`field:` tokens the core strips for itself would otherwise be searched for **literally**; and a phrase can now carry a quote of its own, which the API's syntax has no way to nest, so those are dropped rather than sent as a term its parser would read wrongly (`search-core.js:909-914`).

So per Engine the same parsed words become two different things: an **encoded query** for GraphQL, and **one re-quoted term string** for native.

---

## 5. Matching and Excerpts

### 5.1 Substring matching

`findMatchIndexes(haystackLower, needleLower)` (`search-core.js:298-310`) walks `indexOf`, advancing `from` by `Math.max(needleLower.length, 1)` — so matches are **non-overlapping**. Probe: `"aaaa"` against `"aa"` yields starts 0 and 2, which then merge into one range 0-4.

`matchingWordsInText(text, words)` (`search-core.js:380-385`) returns the subset of words present, case-insensitively. `lineContainsWords(line, words)` (`search-core.js:387-392`) is the any-word predicate used for line selection. Both lower-case both sides; **line content is never altered** (`search-core.test.mjs:1208-1249`).

`highlightRangesForLine(line, words)` (`search-core.js:316-346`) collects every word's every match as `{ start, end }`, sorts by start then end, then merges any range starting at or before the previous range's end. Ranges are half-open `[start, end)` offsets **within that line** (`README.md`, `process`).

### 5.2 Line numbering

`splitLines(text)` (`search-core.js:312-314`) splits on `/\r\n|\r|\n/` — `\r\n` is **one** break, and so is a lone `\r` (`search-core.test.mjs:1143-1206`). ADR 0004 names the consequence: without that, numbering drifts by one for every CRLF in a Windows-authored script.

`lineNumber` is `index + 1` of the line in the **full stored field value** (`search-core.js:453-456`), so it corresponds to the gutter in ServiceNow's script editor (`CONTEXT.md`, Excerpt). ADR 0004 justifies computing it rather than asking the API: GraphQL already returns the complete field text, so the numbering is arithmetic over text already paid for — no extra request and no extra payload.

### 5.3 Excerpt construction — `buildExcerpt`

Two constants, fixed in the core and **not** UI options (`search-core.js:264-267`; `README.md`):

- `CONTEXT_RADIUS = 1` — one context line either side of each Matched line
- `EXCERPT_LINE_CAP = 20` — total lines per Field match

`buildExcerpt(value, words)` (`search-core.js:408-469`):

1. Collect every line index containing any word — these are the **Matched lines** (`search-core.js:413-417`). No Matched line means `null`, which means no Field match (`search-core.js:418-420`).
2. Walk Matched lines in ascending order. For each, add it, then add `±1` (`search-core.js:424-438`).
3. `tryAddLineIndex(included, index, lineCount)` (`search-core.js:394-406`) refuses out-of-range indexes, treats an already-included index as success, and refuses once `included.size >= EXCERPT_LINE_CAP`. A refused **Matched** line breaks the loop; a refused context line is simply skipped.
4. `matchedIncluded` counts how many Matched lines made it in; `omittedMatchedLines = matchedIndexes.length - matchedIncluded` (`search-core.js:440-446`, `:466`).
5. Lines are emitted sorted ascending, each `{ lineNumber, content, matched, highlightRanges }`, with `highlightRanges` computed **only for Matched lines** (`search-core.js:447-462`).

`matchedLineCount` is the count of Matched lines in the **whole field value**, not in the Excerpt (`search-core.js:465`). Context lines are not counted in it.

The cap counts context lines too, and that has a non-obvious effect. With 25 consecutive Matched lines the Excerpt is lines 1-20, all `matched: true`, `matchedLineCount: 25`, `omittedMatchedLines: 5` (`search-core.test.mjs:1112-1141`). But with matches **spread out**, each window costs three lines: probe with 60 lines matching every fifth, `matchedLineCount: 12`, `omittedMatchedLines: 5`, 20 lines emitted of which only **7** are Matched lines, spanning line 4 to line 35. So a sparsely-matching field shows far fewer Matched lines than the cap suggests.

Other verified behaviours: overlapping context around adjacent Matched lines is deduplicated (`search-core.test.mjs:1024-1070`), and radius is clamped at the first and last line of the value (`search-core.test.mjs:1072-1110`).

ADR 0004 records the cap's purpose — without it a single large workflow script would flood the results — and accepts the Engine asymmetry rather than papering over it: **native Excerpts have no context lines**, because the API returns only the lines it chose.

### 5.4 HTML entity decoding and tag stripping — native only

`decodeHtmlEntities(value)` (`search-core.js:357-378`) handles named `&amp; &lt; &gt; &quot;` (`NAMED_HTML_ENTITIES`, `search-core.js:350-355`) plus **numeric character references**, decimal and hex, via `String.fromCodePoint` with `try/catch`. An unrecognised entity is returned verbatim. `&#39;` is decoded through the numeric path, not the named table — which is why the comment lists five entities but the table has four (`search-core.js:348-349`). Verified end to end: `a &amp; b &lt;c&gt; &quot;needle&quot; &#39;x&#39; &#x2F;y` → `a & b <c> "needle" 'x' /y` (`search-core.test.mjs:2072-2103`).

`stripHtmlTags(value)` (`search-core.js:637-639`) is `/<\/?[^>]+(>|$)/g` → `''`.

**Which data needs which:** both are applied only in `processNative`. Decoding is applied to `lineMatch.escaped` (`search-core.js:693-695`); tag-stripping is applied to `record.name` (`search-core.js:670-671`). The comment attributes the need to "ServiceNow's native Code Search escaper" (`search-core.js:348`).

Note the asymmetry: the line content is entity-decoded but **not** tag-stripped, and the record name is tag-stripped but **not** entity-decoded (`search-core.js:670`, `:693`). *Inference*: the API escapes line text and marks up names, so each gets the treatment its own field needs; nothing in the source states this, and no test covers a name carrying an entity or a line carrying a tag.

`process` (the GraphQL path) applies neither, because GraphQL returns the stored field value.

---

## 6. The Artifact map and the Field index

### 6.1 Shape and size of `artifact-map.json`

Five stable top-level properties (`README.md`, Artifact map schema), confirmed by inspection:

- `meta` — `schemaVersion`, `description`, `commonDefaultSource`, and `commonDefaultTables`: an **ordered array of 49 table names** selected by default.
- `categories` — **13** entries, each `{ id, label, order }`, ordered 1..13: `core-development`, `user-experiences`, `flow-automation`, `service-catalog`, `integration-data`, `notifications-content`, `testing-quality`, `analytics-reporting`, `discovery-operations`, `ai-search`, `platform-configuration`, `specialised-applications`, `other-platform`.
- `parentChains` — **16** keys, each `{ field, table }` naming one owner hop, with `null` marking a known terminal.
- `parentTerminalLabels` — **17** keys mapping a terminal table to a friendly label (`sys_hub_action_type_base` → `Used in Flow Designer Action`).
- `artifacts` — **451** entries keyed by ServiceNow table name.

Per Artifact: `label`, global `order`, `category` id, `commonDefault` boolean, `fields`, `hasActive`, and optionally `parentRef`. Each field is exactly `{ element, type }` where `type` is the raw ServiceNow `internal_type`. **862** fields total, distributed: `script` 250, `script_plain` 191, `json` 133, `translated_html` 72, `expression` 51, `json_translations` 33, `condition_string` 28, `script_server` 17, `xml` 16, `string` 15, `html` 15, `email_script` 14, `css` 13, `html_script` 5, `html_template` 5, `script_client` 2, `conditions` 1, `graphql_schema` 1. **289** Artifacts declare `hasActive`; **49** are `commonDefault`; exactly **one** (`sys_variable_value`) declares `parentRef`, as `{ tableField: 'document', sysIdField: 'document_key', label: 'Used by' }`.

The map carries **no record counts and no instance hostnames** — that is what makes it portable, and the repo's validator asserts it (ADR 0003; `README.md`). It was seeded by reading a third-party catalogue (SN Utils) which is separately licensed and deliberately **not vendored**, so the map is the sole authority rather than a derived copy (ADR 0006).

### 6.2 Selecting Artifacts for a Search run

`defaultArtifactNames(artifactMap)` (`search-core.js:130-139`): returns a copy of `meta.commonDefaultTables` when it is an array — **preserving its order** — otherwise filters `artifacts` by the `commonDefault` flag.

`artifactOrder(left, right)` (`search-core.js:141-153`): numeric `order` ascending, non-finite treated as `Number.MAX_SAFE_INTEGER`, ties broken by `localeCompare` on the table name.

`matchesTableFilter(tableName, filters)` (`search-core.js:155-164`): no filters means everything; otherwise **case-insensitive substring** on the table name, any filter matching. So `table:SYS_SCRIPT` selects `sys_script` but not `sys_ui_script` (`search-core.test.mjs:288-302`), while `table:script` would select both — substring, not exact match.

`selectedFields(artifact, filters)` (`search-core.js:166-185`): trims each `field.element`, matches filters by **case-insensitive substring** on the element name, deduplicates, preserves map order, drops empties. `field:COND` selects `condition` (`search-core.test.mjs:288-302`). An Artifact left with no fields contributes no plan (`search-core.js:243-245`, `search-core.test.mjs:310-317`).

### 6.3 Field-type rules

Two tables in the core (`search-core.js:1020-1041`):

- `CODE_FIELD_TYPES` — **17** types, pre-**ticked** on discovery: `script`, `script_plain`, `script_server`, `script_client`, `email_script`, `html_script`, `condition_string`, `conditions`, `expression`, `json`, `json_translations`, `xml`, `html`, `html_template`, `translated_html`, `css`, `graphql_schema`.
- `PLAIN_TEXT_FIELD_TYPES` — exactly **one**: `string`. Offered but **unticked**.

Anything else is not offered at all: references, GUIDs, date-times, integers, booleans, choices (`search-core.test.mjs:568-591`). The full 17-type list is asserted pre-ticked at `search-core.test.mjs:493-535`.

### 6.4 Added artifacts — `mergeAddedArtifacts`

`mergeAddedArtifacts(artifactMap, addedArtifacts)` (`search-core.js:935-1018`):

1. Deep-clones the source via `JSON.parse(JSON.stringify(...))` (`search-core.js:929-931`) and back-fills missing `artifacts`, `categories`, `meta`. The loaded map is never mutated (`search-core.test.mjs:349-365`).
2. Accepts entries with a non-empty trimmed `name` **not already in `merged.artifacts`** — so a curated Artifact is never overwritten (`search-core.js:957-970`, `search-core.test.mjs:413-430`). `label` defaults to the name; `fields` defaults to `[]`; `hasActive` must be strictly `true`.
3. Returns early if nothing was accepted, so no `Added` category appears (`search-core.js:972-974`).
4. Appends the `Added` category at `maxCategoryOrder + 1`, after every curated category (`search-core.js:976-995`, `search-core.test.mjs:367-383`).
5. Assigns each accepted Artifact `maxArtifactOrder + 1, +2, ...` so runtime orders never collide with curated ones (`search-core.js:983-989`, `:1001-1010`, `search-core.test.mjs:385-411`).
6. Sets `commonDefault: true` and appends the name to `meta.commonDefaultTables` — so an Added artifact is **selected by default** (`search-core.js:1006`, `:1011-1016`, `search-core.test.mjs:465-491`).

The design point recorded in the source: merge happens **before anything else reads the map**, so the query builder and result processor never need to know Added artifacts exist (`search-core.js:933-934`; ADR 0007).

Storage-side normalisation is separate. `normaliseAddedArtifact` (`search-core.js:1166-1201`) requires a name and an array of fields, keeps only fields with both `element` and `type`, and returns `null` if nothing survives. `normaliseInstanceState` (`search-core.js:1203-1222`) drops unknown keys entirely so a future shape cannot break today's readers (`search-core.js:1162-1165`, `search-core.test.mjs:2479-2518`).

Added artifacts resolve **no owner**, because a `parentRef` encodes curated knowledge and inferring it from the dictionary would be guesswork (ADR 0007).

### 6.5 Inherited-field discovery — `readDictionary`

`readDictionary(payload, subjectTable)` (`search-core.js:1075-1160`) classifies one `sys_dictionary` Table API payload into `{ label, fields, hasActive, found }`.

It accepts either `{ result: [...] }` or a bare array (`search-core.js:1076-1081`). Rows are partitioned by whether `row.name` equals the subject table; **subject rows are consumed first**, so the subject's declarations win when an element appears twice (`search-core.js:1092-1103`, `:1144-1147`, `search-core.test.mjs:756-789`).

Per row (`consumeRow`, `search-core.js:1105-1142`):

- A row with **no `element`** is a table label row. It sets `label` only when it is the subject's own — ancestors' labels would otherwise overwrite it when the payload spans a chain (`search-core.js:1111-1118`, `search-core.test.mjs:791-819`).
- `element === 'active'` sets `hasActive`, whether declared on the subject or an ancestor (`search-core.js:1120-1122`, `search-core.test.mjs:593-647`).
- Type decides: `selected` when in `CODE_FIELD_TYPES`, `offered` when also allowing `PLAIN_TEXT_FIELD_TYPES`. Not offered means not returned (`search-core.js:1128-1132`).
- Each kept field records `declaredOn` — the table that declared it — which is how an Inherited field is annotated (`search-core.js:1140`, `search-core.test.mjs:707-754`).

`found` is `rows.length > 0`, and the distinction is deliberate: an empty result means the named table is not on this instance; rows with nothing offerable mean the table exists but has nothing worth searching (`search-core.js:1156-1158`, `search-core.test.mjs:649-673`).

`dictionaryCell(value)` (`search-core.js:1043-1068`) reads a Table API cell that may be a scalar or an object, preferring `value`, then `display_value`, then `displayValue` — note **both** snake_case and camelCase spellings, because `sysparm_display_value=all` returns the former (`search-core.test.mjs:675-705`).

ADR 0009 records why discovery spans the chain: `sn_grc_indicator_template` inherits `script` from `sn_grc_base_indicator` and **neither table is curated**, so adding the child offered no code field at all. The failure being closed is "a user searches, finds nothing, and concludes the code is not there." The walk uses the documented Table API rather than GraphQL or `/api/now/ui/meta/{table}`, so adding a table works where the richer path does not (ADR 0007, ADR 0009).

### 6.6 Owner resolution

`resolveOwner(record, artifact, artifactMap, ownerRecords)` (`search-core.js:484-542`) is pure: `app.js` fetches the owner records and supplies them under `rawResponse._ownerRecords` (`app.js:2522-2555`).

- Requires the Artifact to declare `parentRef` and both `record[parentRef.tableField]` and `record[parentRef.sysIdField]` to be non-empty, else `null` (`search-core.js:485-495`).
- `mapMetadata(artifactMap, portableName, sourceName)` (`search-core.js:471-478`) reads `parentChains` / `parentTerminalLabels`, falling back to the underscored `_parentChains` / `_parentTerminalLabels` spellings — so both the portable map and the source-style map work (`search-core.test.mjs:1498-1533`).
- Walks up to **8 hops**, with a `visited` set keyed `table + '.' + sysId`; a repeat returns `null` rather than looping (`search-core.js:502-510`).
- **Class-aware**: the hop is looked up by the owner record's actual `sys_class_name` when `parentChains` has an entry for it, otherwise by the table it was fetched from. That is what lets `sys_hub_action_type_snapshot` hop via `parent_action` where its base class would not (`search-core.js:518-520`, `search-core.test.mjs:1430-1496`).
- No hop means terminal: label resolved `terminalLabels[sysClassName]` → `terminalLabels[table]` → `parentRef.label` → `'Used by'` (`search-core.js:521-531`).
- A missing owner record or a broken chain returns `null` and the Hit simply carries no `owner` (`search-core.js:514-516`, `search-core.test.mjs:1909-1928`).

`recordName(record)` (`search-core.js:288-296`) and `fieldValue(field)` (`search-core.js:269-286`) are the same readers used for Hits, so an owner's display name follows the same rules.

---

## 7. Error accounting

The organising rule, stated in `CONTEXT.md` (Failure reason): every counted error carries a reason, so **a count never outruns the reasons behind it**.

### 7.1 `readQueryErrors`

`readQueryErrors(payload, tableNames)` (`search-core.js:797-822`) maps `payload.errors` to `{ tableName, message }`:

- Non-array `errors` → `[]` (`search-core.js:798-801`, `search-core.test.mjs:1706-1710`).
- `message` is trimmed when a string, else `''`, and an empty message becomes the literal `'Unspecified GraphQL error'` (`search-core.js:806-819`).
- Attribution: walks `entry.path` and takes the **first** step that appears in `tableNames` (`search-core.js:811-815`). So `['GlideRecord_Query','sys_script','_results',0]` attributes to `sys_script` (`search-core.test.mjs:1712-1728`).
- An error naming **no searched Artifact** — including one naming a table that was not in this batch — gets `tableName: ''` and is kept unattributed rather than dropped or blamed on an arbitrary Artifact (`search-core.js:792-796`, `search-core.test.mjs:1730-1742`).
- Malformed entries — `{}`, whitespace-only messages, a bare string, `null` — are **all kept**, each as one `Unspecified GraphQL error`, because the count includes them either way and dropping one would leave a number with nothing behind it (`search-core.test.mjs:1744-1753`).

### 7.2 Failure reasons and how `app.js` counts

Three kinds of subject appear in the accounting (`README.md`, Results pane):

| Subject | Counted? | Path |
| --- | --- | --- |
| An Artifact whose request failed | yes | `recordFailedArtifact` (`app.js:3391-3408`) |
| A GraphQL `errors` entry, attributed or not | yes | `recordQueryErrors` (`app.js:3414-3419`) |
| An Artifact missing from an otherwise good batch response | **no** | `noteMissingArtifact` (`app.js:3384-3389`) |

`recordFailedArtifact` increments `failures.count`, records the Artifact as unsearched, attaches a reason, and separately increments `failures.unauthenticated` when `readRequestFailure` says the status was a Refused request (`app.js:3391-3408`).

`recordQueryErrors` counts an error entry **whether or not it names an Artifact** — the instance reported something wrong, and a run that hides it leaves the user with a number and nowhere to look (`app.js:3410-3419`).

`noteMissingArtifact` is the one that does **not** count: a table absent from an otherwise good batch is unsearched but is not an error of its own, so it earns a row only where nothing counted has already explained it (`app.js:3381-3389`).

### 7.3 The batch-rejection retry

Not core logic, but it is what makes per-Artifact attribution possible. A GraphQL validation error is raised against the **whole document before any of it runs**, so one table whose field the schema will not accept leaves the batch with no data for anything — a failed batch wearing an `HTTP 200` (`app.js:3217-3220`). `batchWasRejected` detects it as "no Artifact in this batch has data" (`app.js:3221-3225`), and the run re-asks **one Artifact at a time** so the Artifact at fault is counted and named on its own and the other nine are searched normally (`app.js:3584`, `:3645-3651`). A response that answered for *some* of its Artifacts is **not** retried: those answers are real (`README.md`, Results pane; ADR 0002 consequences — the retry stays on GraphQL and is not a native fallback).

---

## 8. Data model summary

The shapes that flow through the core. Both Engines converge on the same Hit shape.

**Plan** — one per Artifact, from `build` (`search-core.js:254-258`):

```
{ encodedQuery: string, fields: string[], limit: number }
```

**Per-Artifact result group** — from `process` or `processNative` (`search-core.js:627-630`, `:739-745`):

```
{ hitCount: number, hits: Hit[] }
```

An Artifact with zero Hits is absent from the object entirely.

**Hit** (`search-core.js:613-622`, `:717-722`):

| Field | Type | Notes |
| --- | --- | --- |
| `sysId` | string | `''` when absent |
| `name` | string | `recordName`; `'(unnamed record)'` fallback |
| `sysClassName` | string | falls back to the table name |
| `fieldMatches` | FieldMatch[] | at least one, by construction |
| `owner` | Owner \| absent | GraphQL only; **omitted**, not `null`, when unresolved |

**Field match** (`search-core.js:601-606`, `:726-731`):

| Field | Type | Notes |
| --- | --- | --- |
| `field` | string | GraphQL: the element name. Native: `fieldLabel` preferred |
| `matchedLineCount` | number | GraphQL: Matched lines in the **whole value**. Native: `lines.length` |
| `omittedMatchedLines` | number | GraphQL: `matchedLineCount - matchedIncluded`. Native: always `0` |
| `lines` | MatchedLine[] | the Excerpt |

**Excerpt** is `{ matchedLineCount, omittedMatchedLines, lines }` inside `buildExcerpt` (`search-core.js:464-468`) and is spread into the Field match by `process` — the core has no separate Excerpt object on the wire.

**Matched line** / context line (`search-core.js:454-461`, `:702-709`):

| Field | Type | Notes |
| --- | --- | --- |
| `lineNumber` | number | 1-based in the stored field value; native falls back to a sequential index |
| `content` | string | unaltered; native content is entity-decoded |
| `matched` | boolean | `false` marks a context line. Native lines are always `true` |
| `highlightRanges` | `{start,end}[]` | half-open, offsets **within this line**; `[]` on context lines and on unhighlightable native lines |

**Owner** (`search-core.js:521-530`):

```
{ label: string, name: string, table: string, sysClassName: string, sysId: string }
```

**Search run outcome** — the shape the core's decision functions read (`search-core.js:885-894`, `:1370-1389`):

| Field | Read by | Notes |
| --- | --- | --- |
| `engine` | both | `'graphql'` \| `'native'` |
| `cancelled` | `requiresSessionConfirmation` | truthy suppresses the Confirming probe |
| `emptyArtifacts` | `requiresSessionConfirmation` | table names whose response carried **no rows** |
| `selectedTableNames` | `unsearchedAddedArtifacts` | the run's selection |
| `artifactMap` | `unsearchedAddedArtifacts` | the merged map, for the `category` check |

**Engine decision** (`search-core.js:838-844`): `{ engine: 'graphql'|'native'|null, forced: boolean, reason?: 'unauthenticated'|'graphql-unavailable' }`.

---

## 9. Portability: what is browser/session-bound and what is not

This is the decision-relevant section. `sn` authenticates with OAuth Bearer tokens through one client seam (ADR 0001 of this repo), has no cookies, no `g_ck`, and no current tab. Some of the bookmarklet's reasoning survives that intact; some of it collapses.

### 9.1 Portable as-is — pure logic, no session premise

Everything in `search-core.js` is pure by construction (`README.md`, Search-core contract) and Node already imports it as CommonJS for its own tests. The logic that carries **no** session premise:

| Mechanism | Why it ports |
| --- | --- |
| `parseTerm`, `tokenise`, `normaliseMatchMode`, `spanWithSeparator`, `removeSpans`, `unwrapQuotedPhrase`, `minWordLength` | String handling only |
| `buildEncodedQuery`, `build`, `artifactOrder`, `matchesTableFilter`, `selectedFields`, `defaultArtifactNames` | Produce a plan; no transport |
| `nativeTerm` | Produces a term string |
| `findMatchIndexes`, `splitLines`, `lineContainsWords`, `matchingWordsInText`, `highlightRangesForLine`, `tryAddLineIndex`, `buildExcerpt` | Arithmetic over text |
| `decodeHtmlEntities`, `stripHtmlTags` | Pure string transforms |
| `process`, `processNative` | Pure response → Hit mapping |
| `resolveOwner` | Pure, given `_ownerRecords` |
| `readQueryErrors` | Pure classification |
| `readDictionary`, `dictionaryCell`, `CODE_FIELD_TYPES`, `PLAIN_TEXT_FIELD_TYPES` | Pure classification of a Table API payload |
| `mergeAddedArtifacts`, `normaliseAddedArtifact`, `normaliseInstanceState` | Pure map merging |
| The Artifact map itself | Explicitly instance-portable, no hostnames, no record counts (ADR 0003) |

`readRequestFailure` is pure and its rule holds under Bearer auth — a `401` is still a fact about the credential rather than the Artifact. What *changes* is the remedy: in the browser the user re-signs-in; under `sn` the client seam already refreshes on `401` and retries once (ADR 0001), and its amendment adds the conditional-retry and pre-flight-expiry rules. So the classification ports; the response to it is already owned elsewhere in `sn`.

### 9.2 Session-bound reasoning — collapses or changes meaning without a browser session

**The Capability probe's `sys_properties` row-count trick.** Its whole premise is that GraphQL answers an *unauthenticated cookie session* with `HTTP 200` and an empty result rather than a `401` (ADR 0002 second amendment; `search-core.js:758-764`). That is a statement about **session-based** ServiceNow auth. Whether `/api/now/graphql` behaves the same way for an expired or revoked **OAuth Bearer** token is not addressed by any source read here. If Bearer auth yields an honest `401`, then `readProbe`'s zero-count branch — and with it the Confirming probe and the entire Unverified-artifact concept — is machinery for a failure mode that does not occur. This is the single most important thing to settle before porting; it is listed as an open question.

**The Confirming probe and Unverified artifacts** (`search-core.js:885-894`; `app.js:3428-3443`) inherit that dependency wholly. Their justification is *only* the empty-`200` behaviour. If it does not occur under Bearer auth, they have nothing to detect.

**Transport headers.** `X-UserToken: window.g_ck` and `credentials: 'same-origin'` (`app.js:2319-2334`, `:2598-2605`) are the browser session made explicit. `sn` would send `Authorization: Bearer` instead, which the client seam already does (`src/servicenow/client.ts:92-97`).

**Instance base from the current tab.** `readContext` derives `instanceBase` from `window.location` (`app.js:63-69`), and ADR 0003 records that as deliberate. `sn` resolves the instance from Alias or `SN_INSTANCE_URL` (this repo's `AGENTS.md`, Auth and config) — different mechanism, same information, no obstacle.

**The instance blocklist** (`search-core.js:1346-1364`; ADR 0008 of that repo) is a per-browser consent gate on a per-host store, and its rationale is that a search generates transactions attributable to whoever ran it in that browser. Under `sn`, "whoever ran it" is a service credential, and there is no modal to ask in. This mechanism does not port; it is out of the search-logic scope in any case.

**Added-artifact state and the Field index cache** live in IndexedDB per host (`README.md`, Field-index cache; ADR 0007). The *concept* — a merged, per-instance Field index — is portable; the storage is not. Likewise the **artifact bundle** (`search-core.js:1234-1336`; ADR 0010) exists to move state between browser profiles over a chat message; on a CLI, a file already does that.

**Cancellation.** `outcome.cancelled` and the whole abort path assume a user pressing Stop with an `AbortSignal` (`app.js:2330-2332`, `:3282-3286`). A CLI has interruption, but the semantics differ.

### 9.3 Where the bookmarklet's approach pushes against `sn`'s recorded constraints

Stated as facts about the constraints, not as proposals.

- **ADR 0001 (this repo): one client seam, `request(path, params, options)`.** The GraphQL engine needs `POST` with a JSON body, which the seam already supports via `RequestOptions` (`src/servicenow/client.ts:18-25`, `:105-124`). So a GraphQL call fits the seam's shape. What does *not* fit as cleanly: GraphQL returns `HTTP 200` carrying an `errors` array, and the seam's error parsing is driven by **status** — non-2xx → `parseSnError` (`src/servicenow/client.ts:182-184`). A GraphQL error therefore arrives as a successful `unknown` payload, and `readQueryErrors` is the thing that reads it. That is a partial-failure model the seam does not currently express.
- **ADR 0007 (this repo): stdout is compact ServiceNow JSON, raw passthrough, no envelope; diagnostics and errors on stderr with classified exit codes.** The bookmarklet's output is emphatically **not** a raw ServiceNow response — `process` is a translation layer, and a deliberate one. Its run also produces things that are neither data nor a fatal error: counted failures with reasons, unattributed query errors, Unverified artifacts, Added artifacts the native engine could not search. ADR 0007's contract has one stdout stream for data and stderr for diagnostics; the bookmarklet's own README warns at length that a `hitCount` of 0 is not proof of absence and that the count needs the errors disclosure read alongside it (`README.md`, JSON export). Where a caller must distinguish "zero Hits" from "not verified", that distinction has to travel somewhere.
- **ADR 0009 (this repo): four groups, ten leaves, `script search` among them; flat aliases deliberately not kept.** The bookmarklet's surface would be several controls on one leaf — Match mode, Engine mode, active-only, limit, Artifact selection, `table:`/`field:` filters — rather than new leaves. Nothing in ADR 0009 forbids that; it is a statement about grouping, not flag count.
- **ADR 0003 (this repo)** records that `search_code` exposes **only the global `search` verb**, and that table-scoped search "which needs a `search_group` name" is explicitly out of scope. The bookmarklet's native path is exactly that excluded shape: per-table, with a hard-coded `search_group` (`app.js:2589-2596`).
- **`AGENTS.md` (this repo): snake_case at the seam, camelCase in pure TypeScript.** The bookmarklet already draws that line the same way — `sysparm`-adjacent and ServiceNow-facing names stay snake_case (`encodedQuery` values, `_results`, `sys_class_name`, `internal_type`), while its own model is camelCase (`fieldMatches`, `matchedLineCount`, `highlightRanges`). One wrinkle: `processNative`'s inputs are camelCase because the `sn_codesearch` API itself returns `sysId`, `lineMatches`, `lineNumber`, `recordType` (`search-core.js:668-705`) — the API is inconsistent with the rest of ServiceNow, not the core.
- **Tests are `node:test` + `node:assert` (this repo's `AGENTS.md`).** So is `search-core.test.mjs` (`search-core.test.mjs:1-4`). The 2518-line suite is directly readable as a specification.

---

## 10. Delta against `sn script search` today

`src/commands/script/search.ts` (157 lines) is a thin wrapper over the native API, and `docs/adr/0003-read-side-codesearch-and-table-config.md` records that as the deliberate scope. Concretely, against the bookmarklet:

**What the CLI has:** the global native `search` verb with `term`, `search_all_scopes` (default `true`), optional `current_app`, optional `limit` (`search.ts:81-101`); a `flatten` that collapses group → hit → field → lineMatch into **one row per Field match** `{ table, name, field, lineMatches[{line, context}], matchCount }` (`search.ts:38-58`); the same array/object normalisation of `result` the bookmarklet does (`search.ts:136-141`, cf. `search-core.js:651-654`); and a `text` format that prints the **first three** line matches per row (`search.ts:60-76`).

**What the CLI lacks:**

1. **The GraphQL engine entirely.** No `/api/now/graphql` path, no Artifact map, no direct table queries. Everything below follows from that.
2. **Engine mode, the Capability probe, `resolveEngine`, `requiresProbe`.** One engine, no choice, no probe.
3. **The Artifact map and Field index.** No curated catalogue of 451 Artifacts and 862 code fields; no categories; no `commonDefault` selection; no Artifact selection at all. The searched set is whatever the instance's search group contains.
4. **Added artifacts and Inherited-field discovery.** No `readDictionary`, no `mergeAddedArtifacts`, no per-instance additions.
5. **Match modes.** No phrase/all/any distinction. `term` is passed to the API verbatim (`search.ts:117`), so `table:`/`field:` tokens in a term would be searched for literally — the exact failure `nativeTerm` exists to prevent (`search-core.js:909-912`).
6. **`table:` / `field:` filters, `active=true` filtering, per-Artifact limits.** `--limit` is a single global API limit, not per Artifact.
7. **Excerpts with context lines.** The CLI keeps only the API's `line` and `context` (`search.ts:43-46`); there is no `CONTEXT_RADIUS`, no `EXCERPT_LINE_CAP`, no `omittedMatchedLines`. Its `text` format caps at three lines per row (`search.ts:67-72`) — a display choice, not the bookmarklet's line-budget model.
8. **Record-level grouping.** The CLI's row is a Field match; two fields matching on one record are **two rows** with no record identity linking them. The bookmarklet's `Hit` is the record, with `fieldMatches[]` beneath (`search-core.js:715-731`). The CLI also drops `sysId` — `flatten` keeps `hit.name` and `hit.className` but no identifier (`search.ts:47-53`), so a result cannot be turned into a record link.
9. **Highlight ranges.** No `highlightRanges`, and no word list to compute them from.
10. **HTML entity decoding and tag stripping.** `flatten` reads `lm.context` and comments that it "drops the HTML-escaped variants" (`search.ts:35-37`), so it takes an unescaped variant where one exists. It applies no `decodeHtmlEntities` and no `stripHtmlTags` to `hit.name`. *Inference*: whether that is equivalent depends on whether the API's `context` field is genuinely unescaped where `escaped` is escaped — the bookmarklet reads `lineMatch.escaped` and decodes it (`search-core.js:693-695`), and neither repo's sources describe a `context` field. This is an open question.
11. **Owner resolution.** No `parentRef`, no `parentChains`, no `Used in Flow Designer Action` labelling.
12. **Session-integrity accounting.** No Refused-request classification, no Confirming probe, no Unverified artifacts, no `unsearchedAddedArtifacts`. `sn` handles `401` at the seam by refresh-and-retry (ADR 0001), which is a different concern from telling the caller that an empty answer cannot be trusted.
13. **Error accounting.** No per-Artifact failure counting, no Failure reasons, no `readQueryErrors`. Errors are whatever the seam raises for the one request.
14. **Batching and per-Artifact retry.** One request, so nothing to batch and nothing to retry per Artifact.
15. **A zero-result caveat.** `asText` prints `"No results found."` (`search.ts:61-63`) and `emitJson` emits `[]`. The bookmarklet's README devotes a whole section to why that is not proof of absence.

---

## Open questions

Things this reading could not settle, listed so nobody mistakes them for settled.

1. **Does `/api/now/graphql` answer an expired or revoked OAuth Bearer token with `HTTP 200` and an empty result, the way it does an unauthenticated cookie session?** Nothing in `search-core.js`, the tests, `CONTEXT.md`, `README.md`, or ADR 0002 addresses Bearer auth at all — every statement is about a browser session. Section 9.2 explains why this single fact decides whether the Capability probe's row-count branch, the Confirming probe, and the Unverified-artifact concept have anything to detect under `sn`'s auth model.
2. **Is `sys_properties` readable under `client_credentials` with `web_service_access_only = true`?** The probe's premise is that the table is never empty on a live instance (`search-core.js:758-761`). A credential that can reach GraphQL but cannot read `sys_properties` would read as `unauthenticated` — a false accusation. No source read here covers it.
3. **Does the `sn_codesearch` response carry both `escaped` and `context` per line match, and if so how do they differ?** The bookmarklet reads `escaped` and entity-decodes it (`search-core.js:693-695`); `sn` reads `context` and states it drops the escaped variants (`search.ts:35-46`). Neither repo documents the field set. This decides whether the CLI's omission of `decodeHtmlEntities` is a gap or a non-issue.
4. **What exactly does the native API return for `name` — is it marked up, entity-escaped, or both?** `stripHtmlTags` is applied to it and `decodeHtmlEntities` is not (`search-core.js:670-671`), and no test exercises a name containing an entity. The asymmetry with line content looks intentional but is not stated.
5. **What ServiceNow's `^OR` / `^NQ` precedence actually is for `buildEncodedQuery`'s output.** The tests assert the *string* (`search-core.test.mjs:195-230`) and never the semantics. Whether `active=true^A^ORB^C^ORD` means `active AND (A OR B) AND (C OR D)` is a ServiceNow platform fact I did not verify against the `sn-docs` skill; the `active=true` repetition into every `^NQ` clause (`search-core.js:200-202`) is evidence the authors treated `^NQ` as starting a fresh query, but that is inference.
6. **Whether `process` requires all words per field in match-all mode.** Read literally it does not — `matchingWordsInText` returns any present subset (`search-core.js:591-594`) — so the AND is enforced only by the encoded query, at record level. No test covers a record matching different words in different fields, so this is inference from the code rather than confirmed intent.
7. **Why the excerpt cap counts context lines.** The probe in section 5.3 shows a sparsely-matching field surrendering Matched lines to context-line budget (12 Matched lines, only 7 shown, 5 reported omitted). ADR 0004 justifies *having* a cap but says nothing about the accounting, and no test covers the sparse case — only the dense one (`search-core.test.mjs:1112-1141`). Whether this is intended or merely unexamined is not recorded.
8. **Whether `omitCount: false` / `_rowCount` is load-bearing.** `app.js:2292` asks for it and `app.js:3247` reads `_results` rather than `_rowCount` to decide emptiness. Nothing states why the count is requested if the rows are what decide.
9. **How the 49 `commonDefaultTables` were chosen.** `meta.commonDefaultSource` names a provenance string in the map, but no ADR explains the selection criterion for the default set out of 451 Artifacts.
