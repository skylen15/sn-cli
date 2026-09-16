---
status: accepted
---

# Read-only CLI is the only distribution

`sn` has no maintainer-only write variant: the repository removes Record and
Batch mutations and Background Script execution because retaining a source-only
escape hatch still makes accidental instance changes and remote code execution
too easy. Authentication management and local-only Rule installation remain in
scope, while ServiceNow ACLs remain the actual security boundary. This
supersedes ADRs 0002, 0009, and 0016.
