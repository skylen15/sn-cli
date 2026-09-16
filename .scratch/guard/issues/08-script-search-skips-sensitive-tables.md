# 08 — script search skips Sensitive Tables

Status: done

Parent: [spec.md](../spec.md) · ADR 0015

## What to build

`sn script search` must not treat a Sensitive Table (Exact+Ext, including
`.sn-guard` additions once 06 lands — use whatever policy loader exists when
this runs) as a searchable Artifact target. Code search is not a side door
into identity/HR Table contents. Redacting Sensitive names inside script
*source text* of Hits remains out of scope.

## Acceptance criteria

- [x] GraphQL and native Engines do not search Artifacts whose Table is Sensitive. (GraphQL leaves them out before HTTP; the native Engine is blocked outright — see Comments and ticket 10.)
- [x] A search that would otherwise include only Sensitive Artifacts does not fetch those Tables' records as search targets.
- [x] In-bounds Artifacts still search as today.
- [x] Tests prove Sensitive Tables are excluded from the searched set (Engine/Guard seam; no live instance required).

## Blocked by

- 02 — T1 Ext fail-closed

## Comments

The native Engine was covered here by dropping Sensitive Hits after Code Search
returned them, since its API takes no Table filter. Ticket 10 replaced that
fetch-then-drop with an outright Guard block on `--engine native`.
