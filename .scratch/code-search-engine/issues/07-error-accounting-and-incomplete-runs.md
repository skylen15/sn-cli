# 07 — Error accounting, and admitting an incomplete run

Status: done

## What to build

Stop "found nothing" and "could not look everywhere" being the same answer.

GraphQL reports errors inside an `HTTP 200`, so a successful seam call can still
be a partial failure. The command reads that error array itself — the seam is not
taught about GraphQL. Every counted failure carries a **reason** saying what went
wrong and to whom, including an error that names no Artifact, which is kept
unattributed rather than blamed on an arbitrary one. A count must never outrun the
reasons behind it.

An Artifact simply absent from an otherwise good batch response is unsearched but
is not an error of its own, and earns a row only where nothing counted has already
explained it.

When a run was only partly answered, the Hits still go to **stdout first**, then
the process fails with a new tagged error at **exit 7** carrying the failed and
total counts, with the reasons on stderr as JSON. `batch update` and `batch delete`
already do exactly this and are the pattern to follow. Exit 7 is distinct from the
batch codes so a caller can tell an incomplete search from partly failed writes.
A fully successful run says nothing on stderr — a caveat printed every time is a
caveat nobody reads.

One more mechanism belongs here: a GraphQL validation error is raised against the
whole document before any of it runs, so one Artifact with a bad field leaves the
batch with no data for anything — a failed batch wearing an `HTTP 200`. Detect
that as "no Artifact in this batch has data", then re-ask one Artifact at a time,
so the Artifact at fault is named on its own and the other nine are searched
normally. A response that answered for *some* of its Artifacts is not retried:
those answers are real.

Covers user stories 10, 11, 12, 13. Respects ADR 0012.

## Acceptance criteria

- [x] A run where one Artifact fails and the rest succeed emits its Hits on stdout **and** exits 7.
- [x] Exit 7 is distinct from the batch exit codes, and no existing code is renumbered.
- [x] The stderr payload is JSON carrying the failed and total counts and the reasons.
- [x] Every counted failure carries a reason; a GraphQL error naming no Artifact is kept unattributed rather than assigned to one.
- [x] A malformed or empty error entry still produces one counted failure with a reason rather than being dropped.
- [x] An Artifact missing from an otherwise good batch is reported as unsearched but is not counted as an error.
- [x] A batch that returned data for nothing is re-asked one Artifact at a time, and the failing Artifact is named on its own.
- [x] A batch that answered for some of its Artifacts is not retried.
- [x] A fully successful run writes nothing to stderr and exits zero.

## Blocked by

- 04 (search every Artifact on the instance)
