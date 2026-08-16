# Spec: give `sn script search` its own GraphQL Engine

Status: ready-for-agent

Grounded in `research-bookmarklet-search-core.md` in this directory, which reads
the browser tool the approach comes from against its own source and tests. The
three decisions worth their own record are ADR 0010 (Artifacts from the
Dictionary), ADR 0011 (the Engine is chosen, never detected) and ADR 0012 (the
Hit model and incomplete runs). Read those before changing anything here.

## Problem Statement

`sn script search` finds less code than the instance holds, and does not admit
it.

It asks ServiceNow's Code Search API, which searches only the Tables an
administrator put in the configured search group. Nothing tells the caller what
that set was, so an empty result reads as proof the code is not on the instance
when it may only be proof that nobody indexed the Table it lives in. A custom
Table, or an out-of-box Table belonging to a store application, is routinely
missing from it.

What comes back is also weaker than it looks. The API stems words and applies
synonyms, so some returned lines do not contain the search term at all. Each
Field match arrives as the lines the API chose, with no surrounding context, so
reading a match means opening the Record. And the flattened output drops the
`sys_id`, so a result cannot be turned back into a record link — a caller who
wants the Record has to go and search for it a second time, by name.

## Solution

`sn script search` gets a second Engine of its own.

The **GraphQL Engine** queries Artifacts directly, so the searched set is every
Table on the instance that holds code — discovered from the Dictionary rather
than taken from anybody's configuration — including custom Tables and store
Tables. Because a direct query returns the whole field value, the Engine gets
line numbers, context lines around each Matched line, and the ability to confirm
that the term really is in the text, all without a second round trip.

The **native Engine** stays exactly as it is today, for instances where GraphQL
is switched off. `--engine` picks between them and defaults to GraphQL; there is
no automatic detection (ADR 0011).

Results come back as a **Hit** per Record — carrying its `sys_id` — with **Field
matches** and their **Excerpts** beneath. When a run was only partly answered,
the Hits still go to stdout and the process exits 7 with the reasons on stderr,
so "found nothing" and "could not look everywhere" stop being the same answer
(ADR 0012).

## User Stories

1. As a coding agent, I want to search every Table on the instance that holds
   code, so that a Business Rule on a custom Table is as findable as one on
   `sys_script`.
2. As a coding agent, I want the searched set derived from the instance I am
   pointed at, so that a Table someone added last week is covered without anyone
   updating a catalogue.
3. As a developer, I want to search a Table that no administrator added to a
   search group, so that the tool's reach is not decided by instance
   configuration I cannot see.
4. As a coding agent, I want every returned line to actually contain my term, so
   that I do not chase matches that stemming invented.
5. As a developer, I want the lines around a Matched line, so that I can judge a
   match without opening the Record.
6. As a developer, I want each Excerpt line to carry the line number it has in
   the stored field, so that it lines up with the gutter in ServiceNow's script
   editor when I do open it.
7. As a coding agent, I want to know how many Matched lines an Excerpt held back,
   so that I can tell a field with one match from a field with forty.
8. As a coding agent, I want each Hit to carry its `sys_id`, so that I can turn a
   result into a record link or a follow-up `record update` without searching
   again.
9. As a coding agent, I want the two Field matches on one Record grouped under
   one Hit, so that I can see a Business Rule matched in both `script` and
   `condition` rather than reading two unrelated rows.
10. As a coding agent, I want to know when a search could not cover everything it
    meant to, so that I never report absence I did not verify.
11. As a coding agent, I want an exit code that distinguishes an incomplete
    search from partly failed writes, so that I can branch without parsing text.
12. As a coding agent, I want each counted failure to name what went wrong and to
    which Artifact, so that a number never arrives without something behind it.
13. As a developer, I want a completely successful search to say nothing extra,
    so that a warning on stderr still means something when it appears.
14. As a developer, I want to narrow a search to named Tables, so that I can look
    only where I already suspect.
15. As a developer, I want to narrow a search to named fields, so that I can find
    a term in a `condition` without wading through `script`.
16. As a developer, I want my search term treated as literal text, so that
    searching for a string that happens to contain a colon finds that string.
17. As a developer, I want to choose whether a multi-word term is one phrase, or
    words that must all appear, or words where any will do, so that I can widen a
    search that found nothing without retyping it.
18. As a developer, I want inactive Records excluded by default and includable on
    demand, so that a search reflects what the instance actually runs.
19. As a developer, I want to force the native Engine, so that an instance with
    GraphQL switched off is still searchable.
20. As a developer, I want a GraphQL failure to tell me the native Engine exists,
    so that I learn the way round in the same breath as the error.
21. As a developer, I want a human-readable format as well as JSON, so that I can
    read a search at the terminal.
22. As a maintainer, I want the ported search logic covered by the tests that
    already prove it, so that porting by hand cannot silently change behaviour.

## Implementation Decisions

### Engines and selection

- Two Engines. The GraphQL Engine is new; the native Engine is today's code path,
  untouched, with its output adapted into the Hit model.
- `--engine` is a choice of `graphql` or `native`, defaulting to `graphql`. There
  is no automatic mode and no capability probe. A GraphQL failure surfaces as an
  error naming `--engine native` (ADR 0011).
- Both Engines converge on the same Hit model. The native Engine simply carries
  less: no context lines, no confirmation that the term is present.
- Because ADR 0009 fixed the command surface at four groups and ten leaves, all
  of this arrives as flags on the existing `script search` leaf, not as new
  leaves.

### Artifact discovery

- Artifacts are derived from the Dictionary by field type, per ADR 0010. No
  curated Artifact map is vendored.
- The default is every Artifact discovered. `--table` narrows to named Tables,
  `--field` to named fields.
- One Dictionary read per run, uncached. Revisit only if measurement asks.

### Term and matching

- The term is literal. `table:` and `field:` style tokens are **not** lifted out
  of it — that is what the flags are for, and a code search must be able to find
  a string containing a colon.
- Match mode is a flag: phrase (default), all, or any. Phrase and all share the
  same AND join across words; only any differs.
- Matching is substring, case-insensitive, in every mode.
- The GraphQL Engine builds one Encoded Query per Artifact: a clause per word,
  OR-joined across that Artifact's code fields, AND-joined across words. Active
  filtering is added only where the Artifact declares an `active` field, and must
  be repeated into each alternative when the query expresses OR across words.
- After a response arrives, the Engine re-confirms per field which words are
  actually present, and only those drive the Excerpt. A field with no word
  present is not a Field match; a Record with no Field match is not a Hit.

### Excerpts

- An Excerpt is the Matched lines plus context lines around them, under a line
  budget, with line numbers as held in the stored field value.
- Matched lines take priority over context lines within that budget — a
  deliberate divergence from the source (ADR 0012).
- `matchedLineCount` and `omittedMatchedLines` travel with each Field match.
  `highlightRanges` does not.

### Output and failure

- stdout carries the Hit model as compact JSON, per ADR 0012. Shape, as the
  contract rather than as code:

  ```
  Hit          { sysId, name, table, fieldMatches[] }
  FieldMatch   { field, matchedLineCount, omittedMatchedLines, lines[] }
  Line         { lineNumber, content, matched }
  ```

- `--format text` prints the whole Excerpt, marking context lines apart from
  Matched lines. The old fixed cap of three lines per row goes: the line budget
  now lives in the Excerpt, not in the display.
- A partly answered run emits its Hits to stdout, then fails with a new tagged
  error at exit 7 carrying the failed and total counts, with the reasons on
  stderr as JSON. A fully successful run says nothing on stderr.
- GraphQL reports errors inside an `HTTP 200`. The command reads that array
  itself; the seam is not taught about GraphQL (see below). Every counted failure
  carries a reason, including an error that names no Artifact.
- An Artifact simply absent from an otherwise good batch response is unsearched
  but is not an error of its own, and earns a row only where nothing counted has
  already explained it.

### The seam and below

- Every call still goes through the one client seam (ADR 0001), unchanged. It
  already supports a method and a JSON body, which is all GraphQL needs.
- The seam keeps sole ownership of authentication: it pre-empts expiry and
  refreshes once on `401`. The source's "refused request" classification is
  therefore **not** ported, and that term does not enter the glossary — the
  concept already has an owner.
- Artifacts are batched ten per GraphQL document. Batches run concurrently at a
  low limit, starting at four; every request is a transaction attributable to the
  credential, so this is a number to calibrate against a real instance, not to
  settle on paper.
- A GraphQL validation error rejects the whole document before any of it runs, so
  a batch that returned data for nothing is re-asked one Artifact at a time. This
  is what makes per-Artifact attribution possible. A batch that answered for some
  of its Artifacts is not retried — those answers are real.
- Names touching ServiceNow stay snake_case; our own model is camelCase; flags
  are kebab-case (ADR 0004).

### Port strategy

- The pure search logic is ported by hand to TypeScript rather than vendored, and
  only the subset the GraphQL Engine needs: term parsing and match modes, query
  building and field selection, response processing, the Excerpt machinery,
  GraphQL error classification, and Dictionary field-type classification.
- Deliberately not ported: the native response processor (today's path already
  works), refused-request classification (the seam owns it), highlight ranges,
  owner resolution, added artifacts and their bundles, the instance blocklist,
  the capability and confirming probes, unverified artifacts, and cancellation.

## Testing Decisions

A good test here asserts external behaviour: given a term, flags, and a canned
instance response, what appears on stdout, what appears on stderr, and what the
process exits with. It does not reach for internals, and it never asserts on the
shape of a function's intermediate value.

Two seams, deliberately, and no more:

1. **The ported search module.** Its interface is the search semantics, so the
   browser tool's own suite is the specification for it. Those tests already use
   `node:test` and `node:assert` — the same runner this repo uses — so they come
   across near-verbatim, and they are the only thing that can catch a hand-port
   changing behaviour. Port the tests for a slice before porting the slice.
2. **The command, through a fake `SnClient` Layer.** The Layer records the
   requests it was given and returns canned responses, which covers the wiring
   the pure module cannot: that the right Encoded Query went out, that Artifacts
   were batched and retried as intended, that Hits reached stdout, and that a
   partly answered run still emitted its Hits before exiting 7.

Prior art: test doubles are Layers, never mocks; tests live under `tests/`
mirroring `src/`; `tests/cli/smoke.test.ts` is the existing example of driving a
leaf end to end.

One case deserves naming, because it is the whole point of exit 7: a run where
one Artifact fails and the rest succeed must put the successful Hits on stdout
**and** exit non-zero. The batch leaves already do this and are the pattern to
follow.

## Out of Scope

- Added artifacts, inherited-field discovery, and artifact bundles. A command
  line has flags and files; these mechanisms exist to move state between browser
  profiles.
- The instance blocklist and its consent gate. It guards a human clicking in a
  browser, and there is no modal here to ask in.
- The capability probe, the confirming probe, and unverified artifacts (ADR 0011).
- Owner resolution and the "used in Flow Designer Action" style labelling
  (ADR 0010).
- Highlight ranges (ADR 0012).
- Category labels and ordering. They group a sidebar.
- Caching the Dictionary read.
- Anything in the browser tool's user interface. It was never read for this work.

## Further Notes

The research in this directory cites the source line by line and ran the browser
tool's own suite green first, so the documented behaviour is the shipped
behaviour. Where it marks something **inference**, treat it as unverified.

A separate investigation into ServiceNow platform facts is outstanding and will
append an addendum to that research file: whether `/api/now/graphql` answers an
expired Bearer token with an honest `401` or an empty `HTTP 200`, whether
`sys_properties` is readable under `client_credentials`, the exact field set of a
native Code Search line match, and the real precedence of `^OR` and `^NQ` in an
Encoded Query. None of it blocks this spec — ADR 0011 removed the dependency on
the first question, and it stands as a recorded risk there. The last question is
worth reading before trusting the generated Encoded Query on a wide search.
