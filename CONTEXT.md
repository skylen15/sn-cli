# ServiceNow CLI

The ubiquitous language for `sn`, which exposes ServiceNow data and operations
to a local command line — invoked by coding agents, and by hand. Terms here are
ServiceNow-domain concepts the commands speak in — not implementation details.

## Language

**Record**:
A single row in a ServiceNow table, identified by its `sys_id`.
_Avoid_: row, entry, document

**Table**:
A named ServiceNow data collection (e.g. `incident`, `sys_user`). Tables form
an inheritance chain — a table extends a parent, inheriting its columns.
_Avoid_: collection, entity

**sys_id**:
The 32-character unique identifier of a Record.
_Avoid_: id, key, guid

**Encoded Query**:
ServiceNow's string filter syntax (e.g. `active=true^priority=1`), passed as
`sysparm_query`. Sorting is expressed inside it via `ORDERBY`/`ORDERBYDESC` —
there is no separate sort parameter.
_Avoid_: filter string, where clause

**Display Value**:
The human-readable rendering of a field versus its raw stored value. Controlled
by `sysparm_display_value`: `false` returns raw values, `true` returns display
strings, `all` returns each field as a `{value, display_value}` object — so the
response field shape depends on this setting.
_Avoid_: label value, friendly value

**Dictionary**:
The metadata describing a table's columns, stored in the `sys_dictionary`
table — column name, type, label, mandatory, max length, default value, and
reference target. The source for schema discovery.
_Avoid_: schema table, metadata table

**Reference**:
A field whose value is the `sys_id` of a Record in another table (a foreign
key). Schema discovery resolves the referenced table for such fields.
_Avoid_: foreign key, link field

**Choice**:
A constrained set of allowed values for a field, stored in the `sys_choice`
table. Schema discovery returns the choice list for choice-typed columns.
_Avoid_: enum, dropdown, option set

**Script Record**:
A stored Record whose fields hold server-side code — Business Rules
(`sys_script`), Script Includes (`sys_script_include`), UI Actions
(`sys_ui_action`) and their kin. Persisted and searched; `sn` never executes
them.
_Avoid_: script, code record, custom code, Background Script

**Alias**:
A named ServiceNow authentication profile, carrying both the instance it points
at and the credentials to reach it. Since the Alias names the instance, choosing
an Alias is what decides which instance a command talks to. One Alias is the
default.
_Avoid_: profile, account, credential, connection, environment

**Artifact**:
A Table together with the specific fields on it that hold code. The unit a code
search covers or leaves out — a Table alone does not say which of its fields are
worth searching.
_Avoid_: table (a Table is only part of an Artifact), record type, code table

**Engine**:
The mechanism a code search runs on: the **GraphQL Engine**, which queries
Artifacts directly, or the **native Engine**, which asks ServiceNow's Code
Search API.
_Avoid_: backend, provider, mode

**Hit**:
A Record with at least one code field containing the search term. The unit every
code search count is in.
_Avoid_: match, result, record/field pair (ServiceNow's own Code Search response
nests something it calls a hit per _field_, which this is not)

**Field match**:
One code field of one Hit whose value contains the term. A Hit has one or more —
a Business Rule matching in both `script` and `condition` is one Hit with two
Field matches.
_Avoid_: field hit, match

**Excerpt**:
The numbered lines reported for a Field match: its Matched lines plus the
context lines around them. Line numbers are the ones the line holds in the
stored field value, so they line up with the gutter in ServiceNow's script
editor.
_Avoid_: snippet (a snippet is a character window with no line structure),
preview, code block

**Matched line**:
A line of an Excerpt that itself contains the term, as against a **context
line**, which is there only to make a neighbouring Matched line readable.
_Avoid_: hit line

**Rule**:
A project-scoped instruction file for a coding agent (here: the shipped
`sn-cli.mdc`), installed under a Platform’s rules directory.
_Avoid_: cursor rule, prompt, skill

**Platform**:
The agent/editor host whose on-disk layout receives a Rule. Today only
`cursor` (→ `.cursor/rules/`).
_Avoid_: IDE, editor, environment, target

**Blocked Instance**:
A ServiceNow instance that `sn` must not contact. Its hostname belongs to the
fixed set enforced by the Instance Guard.
_Avoid_: forbidden instance, sensitive instance, blocked URL

**Instance Guard**:
The always-on client-side policy that prevents `sn` from contacting a Blocked
Instance. It prevents accidental use and is not a substitute for instance ACLs.
_Avoid_: Guard, rule (a Rule is an agent instruction file), data filter

**Read-only CLI**:
The only distribution of `sn`. Its ServiceNow command surface cannot mutate an
instance. That is a client-side guardrail against accidental writes, not a
security boundary; authentication management and local-only operations such as
Rule installation remain in bounds. There is no maintainer write variant.
_Avoid_: Full CLI, restricted CLI, safe CLI, security mode, admin CLI, write mode
