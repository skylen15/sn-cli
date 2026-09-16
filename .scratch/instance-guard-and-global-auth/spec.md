Status: ready-for-agent

## Problem Statement

As a user of the globally installed `sn` CLI, I need confidence that it cannot
contact the enterprise production or UAT instances, regardless of which
credential Alias I select. The current project-level `.env` and
client-credentials model is a poor fit for a global developer tool, while the
Sensitive Table and Sensitive Reference Guard adds substantial complexity
without being needed once those enterprise instances are blocked as a whole.
Authentication setup also currently requires repository-specific commands
instead of being available through the global CLI.

## Solution

Make Now SDK OAuth Aliases in the machine keychain the only authentication
model. Add native `sn auth` commands for managing those Aliases, require
appropriate confirmation before using the SDK default, and enforce an always-on
Instance Guard before any network access to the two Blocked Instances. Remove
the superseded data-level Guard and all dotenv/client-credentials behavior while
retaining the independent interactive protection for Background Scripts.

## User Stories

1. As a developer, I want `sn` to reject the production hostname, so that I
   cannot accidentally run a CLI operation against production.
2. As a developer, I want `sn` to reject the UAT hostname, so that I cannot
   accidentally expose or modify UAT data.
3. As a security-conscious user, I want a Blocked Instance rejected before any
   OAuth request, token refresh, or ServiceNow request, so that the CLI makes no
   network contact with it.
4. As a user, I want hostname matching to ignore case, a trailing dot, scheme,
   port, path, and query, so that cosmetic URL differences cannot evade the
   Instance Guard.
5. As a user, I want only the two exact enterprise hostnames blocked, so that
   similarly named sibling and subdomain instances are not rejected.
6. As an operator, I want malformed instance URLs reported as authentication
   configuration errors, so that I can distinguish invalid input from policy
   denial.
7. As an automation author, I want Instance Guard denials to remain
   `SnGuardError` with exit code 9, so that existing error classification stays
   stable.
8. As a user, I want a Guard error to name the blocked hostname and state that
   no request was sent, so that the outcome is unambiguous.
9. As a user of an allowed development instance, I want to query any Table and
   Reference permitted by ServiceNow ACLs, so that the removed data Guard no
   longer hides legitimate development data.
10. As a developer, I want native code search available on allowed instances,
    so that the old Sensitive Table restriction no longer disables that Engine.
11. As a maintainer, I want writes on allowed development instances to use the
    payload and return the response without Sensitive Reference filtering, so
    that the CLI matches ServiceNow behavior.
12. As a maintainer, I want Background Scripts to retain their separate TTY
    confirmation, so that removing data filtering does not weaken
    remote-code-execution protection.
13. As a global CLI user, I want authentication independent of my working
    directory, so that moving between projects cannot silently change identity
    or instance.
14. As a global CLI user, I want Now SDK OAuth Aliases to be the sole credential
    source, so that authentication has one predictable model.
15. As a local user, I want credentials stored by the Now SDK in the machine
    keychain, so that secrets do not live in project dotenv files.
16. As a user, I want to select an Alias explicitly with `--alias`, so that the
    target identity is visible in the invocation.
17. As a user who explicitly supplies `--alias`, I want no default-Alias prompt,
    so that the command proceeds without redundant interaction.
18. As an interactive user who omits `--alias`, I want to see the SDK default
    Alias and hostname before confirming it, so that I know the target.
19. As an interactive user, I want only `y` or `yes` to accept the default
    Alias, so that Enter and other input cancel safely.
20. As an interactive user, I want `--yes` or `-y` to skip only the
    default-Alias confirmation, so that deliberate scripted TTY use remains
    possible.
21. As a Background Script operator, I want `--yes` to leave the independent
    Background Script confirmation intact, so that the two safeguards remain
    separate.
22. As a non-TTY caller of a Read-only CLI leaf, I want the SDK default used
    automatically when no Alias is explicit, so that agents can read and search
    without hanging.
23. As a non-TTY caller using the SDK default, I want the Alias and hostname
    announced on stderr, so that target selection is not silent and stdout
    remains machine-readable.
24. As a non-TTY caller of a mutating leaf, I want omission of `--alias` to fail
    even when `--yes` is present, so that mutation requires an explicit target.
25. As a user who rejects the default Alias prompt, I want the operation
    cancelled before network access with an authentication error and empty
    stdout, so that cancellation is safe and scriptable.
26. As a global CLI user, I want `sn auth add`, `list`, `use`, and `remove`, so
    that I can manage Aliases without entering the repository.
27. As a user of either CLI variant, I want the same `auth` group available, so
    that credential management does not depend on the ServiceNow command
    surface.
28. As a user adding an Alias, I want to provide an explicit HTTPS instance
    origin and Alias, so that the target and stored name are unambiguous.
29. As a user adding an Alias, I want credentials in the URL, non-root paths,
    queries, and fragments rejected, so that OAuth starts only from a canonical
    instance origin.
30. As a user adding an Alias, I want OAuth browser login supplied by the Now
    SDK, so that `sn` does not invent another authentication protocol.
31. As a user adding the first Alias, I want it to become the SDK default, so
    that the CLI is immediately usable.
32. As a user adding a later Alias, I want the existing default preserved, so
    that adding credentials does not silently change my target.
33. As a user attempting to add an existing Alias, I want a clear failure that
    guides me to remove it and retry, so that credentials are never overwritten
    accidentally.
34. As a user, I want `auth use` to set an existing allowed OAuth Alias as the
    default, so that I can deliberately change the fallback target.
35. As a user, I want `auth use` to reject missing, Basic, and Blocked Aliases,
    so that the default remains usable and policy-compliant.
36. As a user, I want `auth list` to show Alias, instance URL, default status,
    credential type, and blocked status without secrets, so that I can audit
    local configuration safely.
37. As a user with no credentials, I want `auth list` to return an empty JSON
    array successfully, so that absence is not treated as a failure.
38. As a user with a legacy Basic or Blocked Alias, I want it visible and
    removable, so that I can clean up the shared keychain.
39. As a user removing an Alias, I want no other Alias selected automatically,
    so that deletion cannot silently redirect later commands.
40. As a user starting browser authentication from an agent or task, I want
    `auth add` to work without a TTY while I complete the browser flow, so that
    setup is not tied to one launcher.
41. As an automation author, I want OAuth progress on stderr and only the final
    compact JSON result on stdout, so that authentication setup preserves the
    CLI output contract.
42. As a user who cancels or fails OAuth login, I want empty stdout and
    `SnAuthError` exit code 3, so that failure is classified consistently.
43. As a user of upstream `now-sdk auth`, I want its Aliases to remain
    compatible with `sn`, so that both tools can share the same keychain.
44. As a security-conscious user, I want every Alias checked when used even if
    it was created or made default outside `sn`, so that upstream tooling cannot
    bypass the Instance Guard.
45. As a user, I want help and local Rule installation available without Alias
    resolution or prompts, so that operations with no instance access remain
    independent of authentication.

## Implementation Decisions

- The Blocked Instance set is dynamically configured via `sn.config.json`
  (defaults to empty when omitted).
- Instance URL parsing produces a canonical lowercase hostname with any trailing
  dot removed. Matching uses the hostname rather than the full URL, so scheme,
  port, path, and query do not affect the decision.
- The policy protects against accidental configuration. DNS aliases, HTTP
  redirects from otherwise allowed hosts, hostile credential holders, and
  external use of the credentials are not security boundaries provided by this
  feature.
- `TokenSource` owns the Instance Guard for ServiceNow commands. It checks the
  locally loaded Alias before refresh and checks the resulting token again. Its
  postcondition is that it never returns a token for a Blocked Instance.
- `auth add` invokes the same Instance Guard directly on its parsed instance
  origin before starting OAuth.
- Now SDK OAuth Aliases are the only supported authentication source. Remove
  client-credentials token minting, dotenv walk-up discovery, project auth
  configuration, and the custom auth environment variables.
- Alias selection is explicit `--alias` followed by the confirmed/default policy;
  no environment variable participates in Alias selection.
- The CLI receives a global `--yes` flag with `-y` as its short alias. It skips
  only default-Alias confirmation and does not bypass Instance Guard or
  Background Script confirmation.
- Default-Alias behavior is driven by an explicit invocation classification,
  not by which CLI binary is running. Leaves admitted to the Read-only CLI are
  read-only for this policy even when invoked through the Full CLI.
- In a TTY, an instance-facing command without an explicit Alias prompts once
  with the default Alias and hostname. Rejection returns `SnAuthError` exit code
  3 before any network access.
- In a non-TTY, read-only leaves may use the SDK default after announcing Alias
  and hostname on stderr. Mutating leaves require explicit `--alias`;
  `--yes` is insufficient.
- `auth`, Rule installation, help, version, and parse-only paths do not perform
  default-Alias selection.
- Generalize the existing injectable confirmation adapter for both default-Alias
  confirmation and the retained Background Script gate. Keep the two decisions
  independent.
- Extend the existing Now SDK adapter rather than introducing another SDK seam.
  It gains OAuth login, default update, and credential removal operations while
  retaining credential fetch/store and token refresh.
- Native auth commands use the SDK's browser OAuth and keychain APIs; they do
  not implement OAuth, keychain storage, or invoke the upstream CLI as a
  subprocess.
- `auth add` accepts only an explicit HTTPS origin. A trailing slash is valid;
  embedded credentials, a non-root path, query, fragment, malformed URL, and
  non-HTTPS scheme are rejected before OAuth.
- `auth add` requires a non-empty Alias and does not overwrite an existing
  Alias. Its duplicate error names the Alias and instructs the user to run
  `sn auth remove <alias>` before retrying.
- The first stored Alias becomes default. Adding another Alias preserves the
  current default. `auth use` is the explicit operation for changing it.
- `auth use` validates that the Alias exists, is OAuth, and is not blocked before
  changing the default.
- `auth remove` removes exactly one Alias. Removing the default leaves no
  default, and subsequent implicit selection fails while listing available
  Aliases.
- `auth list` returns a secret-free compact JSON array with `alias`,
  `instanceUrl`, `isDefault`, `type`, and `blocked`. Legacy Basic and Blocked
  Aliases are included.
- OAuth instructions, progress, target announcements, prompts, diagnostics, and
  errors use stderr. Successful command results alone use stdout.
- Instance policy denial remains `SnGuardError` with public exit code 9.
  Malformed URL, unsupported credential type, missing Alias, user cancellation,
  OAuth failure, and keychain/authentication failures use `SnAuthError` with
  exit code 3 unless an existing local error classification is more specific.
- Remove Sensitive Table and Sensitive Reference exact/inheritance/dictionary
  checks, `.sn-guard`, query and field rejection, read omission, write-response
  stripping, Artifact exclusion, and the native Search Engine prohibition.
- Remove the extra Dictionary and inheritance requests that existed solely for
  the data-level Guard. ServiceNow ACLs govern data access on allowed instances.
- Preserve the separate TTY-only confirmation for Background Scripts. It
  remains impossible to bypass with `--yes`.
- Register `auth` in both the Read-only CLI and Full CLI. The globally linked
  Read-only CLI remains unable to mutate a ServiceNow instance; the Full CLI
  remains repository-only.
- Update root/group help, authentication documentation, Guard documentation,
  examples, output-contract wording, and maintainer guidance to the current
  Instance Guard and OAuth Alias model. Remove instructions for dotenv,
  client credentials, Sensitive Tables, and Sensitive References.
- Preserve compatibility with the Now SDK keychain format and upstream
  `now-sdk auth`; aliases created externally are still checked every time `sn`
  attempts to use them.

## Testing Decisions

- Tests assert observable policy, output, and network behavior rather than
  private helper calls. Counters and fake adapters prove that forbidden browser,
  refresh, token, and HTTP operations were never invoked.
- The highest Instance Guard seam is `TokenSource` supplied with the existing
  fake Now SDK adapter. Cover both pre-refresh rejection and post-refresh token
  validation, canonical hostname variants, allowed near-matches, malformed
  URLs, explicit Alias selection, and SDK default selection.
- Do not use command tests that replace the ServiceNow client to prove Instance
  Guard behavior; those stubs bypass `TokenSource`. Retain at most one
  client-wiring integration test where it provides additional confidence.
- Express the default-Alias decision matrix as pure policy and test all
  combinations of explicit Alias, TTY state, `--yes`, and read-only versus
  mutating classification.
- Test confirmation I/O through the generalized existing confirmation adapter.
  Verify prompt text includes Alias and hostname, only `y`/`yes` accepts,
  cancellation makes no network call, and `--yes` does not accept the Background
  Script gate.
- Add one representative read-only command integration test and one
  representative mutating command integration test to prove classification and
  flag plumbing. Do not duplicate the complete policy matrix across every leaf.
- Test auth command behavior through the command runner with a fake Now SDK
  adapter and captured output, following existing command and emitter test
  patterns. No test opens a browser or accesses the real keychain.
- Test every auth leaf's successful JSON shape and principal failures: invalid
  origin, duplicate Alias with remediation text, blocked add before OAuth,
  secret-free list including blocked/basic entries, valid and rejected `use`,
  and removal without default replacement.
- Retain entrypoint smoke tests for root help, command registration, global
  shared flags before and after subcommands, classified stderr errors, clean
  stdout, execution from unrelated directories, and symlink/global-install
  behavior.
- Repurpose or delete dotenv and client-credentials tests because those
  behaviors cease to exist.
- Repurpose or delete Sensitive Table/Reference Guard tests. Update existing
  table, record, batch, schema, config, and search tests to assert their direct
  ServiceNow requests without Guard-only Dictionary or inheritance stubs.
- Add regression coverage that an allowed instance can query a formerly
  Sensitive Table, include a formerly Sensitive Reference, write such a
  Reference, and select the native Search Engine.
- Keep existing Background Script confirmation tests, adapting only the shared
  confirmation adapter wiring where necessary.
- The repository's standard full check remains the acceptance command:
  type-check, formatting check, lint, and the complete `node:test` suite.

## Out of Scope

- Headless CI authentication, client credentials, Basic Auth, session-cookie
  authentication, and dotenv-based credential loading.
- A configurable Blocked Instance list or any option to disable the Instance
  Guard.
- Blocking DNS aliases, inspecting resolved IP addresses, or preventing an
  allowed origin from redirecting outside the configured hostname.
- Modifying, wrapping, or restricting the separately invoked upstream
  `now-sdk auth` command.
- Automatically migrating or deleting existing dotenv files, `.sn-guard`
  files, client secrets, Basic Aliases, or Blocked Aliases.
- Automatically choosing a replacement default when the current default Alias
  is removed.
- Making the Full CLI globally available or changing its human approval
  requirements for mutating operations.
- Bypassing or removing the Background Script TTY confirmation.
- Replacing the Now SDK's OAuth implementation or keychain format.

## Further Notes

- ADR 0017 defines the Instance Guard and supersedes ADR 0015.
- ADR 0018 defines OAuth-Alias-only authentication and supersedes ADR 0005.
- The existing unsupported Now SDK deep-import boundary remains governed by ADR
  0006; this feature expands the isolated adapter rather than scattering more
  deep imports.
- Exit code 9 remains stable under the output contract. The feature should not
  renumber any existing classified exit code.
- Removal of dotenv/client credentials and the data-level Guard changes public
  behavior and documentation. Release planning should treat those removals as
  breaking changes.
