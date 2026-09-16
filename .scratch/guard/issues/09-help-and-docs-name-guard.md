# 09 — Help and docs name the Guard

Status: done

Parent: [spec.md](../spec.md) · ADR 0015

## What to build

Operators and agents can discover that the Guard exists, is always on, and
where the policy is recorded: relevant `--help` text and a short docs pointer
to ADR 0015 / glossary terms — without changing the stdout JSON contract.

## Acceptance criteria

- [x] Relevant leaf or group `--help` text mentions the Guard (always on; Sensitive Tables / Sensitive References) at a level an agent can act on.
- [x] Docs point at ADR 0015 (and glossary terms) for the full policy.
- [x] stdout remains ServiceNow JSON only (ADR 0007); help/docs changes do not break that contract.
- [x] `rule install` help stays clear that it is local-only and outside the Guard.

## Blocked by

- 03 — T1 on remaining data leaves
- 04 — T2 reads on table query and schema Name-ok
- 05 — T2 writes and strip stdout
- 06 — `.sn-guard` project-narrow-only
- 07 — script run TTY-gate
- 08 — script search skips Sensitive Tables
