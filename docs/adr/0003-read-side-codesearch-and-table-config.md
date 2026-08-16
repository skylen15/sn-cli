# Read-side context tools: search_code and get_table_config

Two read-only tools help an agent understand an instance before changing it:
`search_code` ("where does this code live?") and `get_table_config` ("what is
configured on this table?"). Both ride ADR 0001's JSON `request()` seam — no new
HTTP path, no `try/catch`, no new config. This records the non-obvious shape
decisions.

## search_code wraps the Code Search REST API and flattens it

`GET /api/sn_codesearch/code_search/search` is the same endpoint the Studio Code
Search UI calls (grounded in the `now-sdk-ext-core` `CodeSearch` reference,
owner-supplied; the platform docs only describe the UI). It returns a deep
`group -> hit -> field -> lineMatch` tree.

- We expose **only the global `search` verb** (term + `search_all_scopes` /
  `current_app` / `limit`). The search-group/table-management verbs and
  table-scoped search (which needs a `search_group` name) are out of scope —
  "verify where code exists" is global. (YAGNI; add later if needed.)
- We **flatten** to one row per field match `{table, name, field,
lineMatches[{line, context}], matchCount}`, dropping the HTML-escaped variants
  and labels. The API sometimes collapses `result` to a single object instead of
  an array, so we normalise to an array first.
- A `format` input (`json` default, `text`) lets the **calling agent** decide
  when it wants a human summary vs. structured rows.

## get_table_config is a curated metadata fan-out, not a `.config` call

The instance's `<table>.config` view is the UI page
`personalize_all.do?sysparm_rules_table=<table>`. There is **no JSON endpoint**
for it, and that UI page is unusable for this server's hardened auth path
(`client_credentials` with `web_service_access_only = true` — see ADR 0002: such
a user gets the SPA shell, not UI pages). So the tool **reconstructs the view
over the Table API** instead.

- **Curated category map.** Each behaviour type lives in its own metadata table
  and references its target table through a _different_ column — `sys_script`
  `.collection`, `sys_script_client`/`sys_ui_policy`/`sys_ui_action`/`wf_workflow`
  `.table`, `sys_data_policy2.model_table`, `sysevent_email_action.collection`,
  `sys_security_acl.name`. There is no single field to key off, so the map is
  explicit. Dictionary columns are deliberately excluded — `get_table_schema`
  owns them (no overlap).
- **Inheritance, tagged.** Parent-table rules fire on the child, so the tool
  walks the `super_class` chain (shared `inheritanceChain` helper, also used by
  `get_table_schema`) and queries `<link>IN<chain>`. Every record is tagged with
  the `source_table` it came from.
- **ACLs are the one irregular link.** Record ACLs are named `<table>`, field
  ACLs `<table>.<field>`, so they match `name=<t>^ORnameSTARTSWITH<t>.` per chain
  table, and `source_table` is derived from the name prefix. `name` is kept in
  the output (it carries the field suffix); for every other category the
  redundant link column is dropped.
- **Full code by default.** You cannot understand behaviour from metadata alone,
  so the script/condition bodies are included. The size lever is the optional
  `categories` filter plus the inherent table scope — not truncation. (ponytail:
  one request per category at `sysparm_limit=10000`; upgrade path is pagination.)
- **Flow Designer is a documented gap.** `sys_hub_flow` does not store its
  trigger table on the flow, and the two clean resolutions —
  `sn_flow.AssociatedFlows.getFlows()` via a background script, or the
  `personalize_all.do` UI — are both blocked under `web_service_only`. Classic
  Workflows (`wf_workflow.table`) are included now; Flow Designer is the upgrade
  path when running under a session (now-sdk) auth.

## Consequences

- No new HTTP path, dependency, or config; both tools are `readOnly` /
  `openWorld` and go through `client.request()` only.
- The category map is the maintenance surface for `get_table_config`: adding a
  behaviour type = one entry; an irregular link = a `buildQuery`/`sourceTable`
  override (as ACLs already do).
