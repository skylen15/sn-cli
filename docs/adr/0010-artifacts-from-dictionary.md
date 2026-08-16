---
status: accepted
---

# Artifacts come from `sys_dictionary`, not a vendored catalogue

A code search has to know which Tables hold code and in which fields — the
Artifact. The browser tool this approach is ported from carries a curated
Artifact map: 451 Tables, 862 code fields, 178KB of JSON, seeded from a
third-party catalogue it does not itself vendor. We derive the same information
from `sys_dictionary` by field type instead, because that is true of the instance
being searched rather than of a snapshot someone took: custom Tables are covered
for free, and the set cannot go stale.

## Considered Options

Vendoring the curated map was the obvious path and is why this is written down.
It buys a known-good set with no discovery read, but it also imports data whose
provenance we cannot see, freezes it at the moment we copied it, and silently
misses every custom Table on the instance — which for a tool whose whole job is
finding code is the wrong failure.

## Consequences

- **No owner resolution.** The curated map's `parentChains` is what lets the
  browser tool report the Flow that owns a matched variable. It is curated data
  and cannot be derived from the dictionary, so nothing labels a Hit with its
  owner.
- **No category labels or ordering.** These exist to group a sidebar and have no
  meaning on a command line.
- **No curated default subset.** The browser tool searches 49 Artifacts by
  default; the criterion behind that selection is unrecorded even there. Rather
  than invent one, the default is every Artifact the dictionary reports, because
  a command line has no window to keep responsive and `--table` is right there
  for narrowing.
- One dictionary read per run, uncached. A cache is a store with an invalidation
  problem attached; add it if measurement asks for it, not before.
