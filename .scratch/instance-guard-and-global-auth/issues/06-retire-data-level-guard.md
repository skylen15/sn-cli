# 06 — Retire the data-level Guard

**What to build:** On every allowed instance, remove the superseded Sensitive
Table and Sensitive Reference restrictions so ServiceNow ACLs alone govern
which data the CLI may read or write, while retaining the separate Background
Script safeguard.

**Blocked by:** 02 — Safe SDK default selection

**Status:** done

- [x] Formerly Sensitive Tables can be queried, inspected, configured, searched,
      created, updated, and deleted wherever the command surface and ServiceNow
      ACLs otherwise permit.
- [x] Formerly Sensitive References may appear in fields, Encoded Queries,
      dot-walks, payloads, and responses without client-side omission,
      rejection, or stripping.
- [x] Table operations no longer make Dictionary or inheritance requests solely
      for Guard decisions.
- [x] `.sn-guard` discovery, parsing, shipped table sets, inheritance
      fail-closed behavior, and response stripping are removed.
- [x] Script search no longer excludes Sensitive Artifacts, and the native
      Search Engine is no longer blocked for data-Guard reasons.
- [x] The Background Script TTY confirmation remains behaviorally unchanged and
      independent from default-Alias confirmation.
- [x] Existing command tests are simplified to direct ServiceNow behavior, and
      regression tests demonstrate formerly blocked read, Reference, write, and
      native-search scenarios on an allowed instance.
