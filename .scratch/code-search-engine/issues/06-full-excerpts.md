# 06 — Full Excerpts, with context lines

Status: done

## What to build

Make a match readable without opening the Record.

An **Excerpt** becomes the **Matched lines** plus the **context lines** around
them, under a line budget, every line still carrying the number it holds in the
stored field value so it lines up with the gutter in ServiceNow's script editor.
A context line is marked apart from a Matched line, in the JSON and in the text
format.

Each Field match reports `matchedLineCount` — how many lines in the whole field
value matched — and `omittedMatchedLines`, how many the budget held back. These
are the one thing a caller cannot recompute, which is why they travel.

**Matched lines take priority over context lines within the budget.** This is a
deliberate divergence from the source, whose cap counts context lines and so lets
a sparsely-matching field surrender Matched lines to decoration — a field with
twelve Matched lines showing only seven of them. No test in the source covers
that case, so fixing it breaks nothing that comes across. Record the divergence
where the next reader comparing the two codebases will find it, or they will
assume the port is wrong.

`--format text` prints the whole Excerpt; the old fixed cap of three lines per row
goes, because the budget now lives in the Excerpt rather than in the display.

Covers user stories 5, 6, 7, 21. Respects ADR 0012.

## Acceptance criteria

- [x] An Excerpt carries context lines around each Matched line, marked apart from Matched lines.
- [x] Every line carries the line number it holds in the stored field value.
- [x] `matchedLineCount` and `omittedMatchedLines` are reported per Field match.
- [x] A sparsely-matching field shows all its Matched lines, spending what is left of the budget on context — with a test covering the case the source does not.
- [x] Adjacent or overlapping match neighbourhoods do not produce duplicated lines.
- [x] `--format text` prints whole Excerpts and no longer caps at three lines per row.
- [x] Ported Excerpt tests pass, and the divergence from the source is recorded in the code where a reader comparing the two will see it.

## Blocked by

- 02 (GraphQL Engine against one named Artifact)
