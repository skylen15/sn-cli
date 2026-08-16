# 08 — Break the version and record the decisions

Status: done

## What to build

The paperwork that makes the break legible: a major version that signals it, two
ADRs that explain it, and agent-facing documentation that describes the surface
that now exists rather than the one that used to.

The version goes to 2.0.0. Retired flat names were not kept as aliases, so an
operator or agent holding an old invocation needs the version alone to tell them
their calls are no longer valid.

A new ADR records the grouped surface: the four groups and why those four, the
decision to keep batch distinct from record, the decision to let one group name
span two glossary terms, noun leaves over hyphenated verbs, and the clean break
over retained aliases. ADR 0008 is amended rather than superseded, because the
subpath-import mechanism is a direct consequence of the no-build constraint it
already records — the amendment should state plainly why compiler path mapping
cannot work here, so nobody later "fixes" it into something that type-checks and
then fails at runtime.

The command-surface section of the agent-facing project documentation currently
describes ten flat kebab-case subcommands. An agent reading it today would emit
dead invocations, so it is rewritten to describe the groups.

The glossary needs no work in this ticket — the Script Record term and the
sharpened Background Script entry were written during design.

Covers user stories 13, 23, 24, 25 and 26. Amends ADR 0008.

## Acceptance criteria

- [x] The package version is 2.0.0 and the entrypoint reports it.
- [x] A new ADR records the grouped surface, the alternatives weighed, and the
      break.
- [x] ADR 0008 is amended with the subpath-import mechanism and an explicit
      statement of why compiler path mapping cannot work without a build step.
- [x] The command-surface section of the agent-facing documentation describes
      the four groups and their leaves, with no reference to the retired flat
      names.
- [x] A test asserts the root help lists exactly the four groups.
- [x] The knowledge graph is refreshed.
- [x] `pnpm check` passes.

## Blocked by

- 04, 05, 06, 07 (the surface must be final before it is documented)

## Comments

**Done.** Version 2.0.0; ADR 0009 records the grouped surface; ADR 0008
amended for subpath imports; `AGENTS.md` command surface rewritten; smoke test
asserts exactly the four root groups.
