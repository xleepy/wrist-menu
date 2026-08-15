# Release evidence automation

`compatibility.json` is the committed compatibility policy. It records the
declared peer ranges, exact dependency and IWER Tested Lanes, empty verified
claims, provisional physical rows, and invalidated-evidence ledger. The source
manifest deliberately contains no candidate commit or tarball digest: embedding
those values would make the candidate change while it was being identified.

Run `npm run evidence` only from a clean, committed worktree. The command:

1. builds, typechecks, tests, and packs the candidate;
2. hashes the tarball and installs a digest-named copy after each fixture's
   frozen dependency install, preventing a lockfile or npm cache from silently
   substituting an older tarball at the same file path;
3. runs the hostile-import, Three, React 18, React 19, React XR, four IWER,
   deterministic-boundary, allocation/resource, lifecycle, Scene Event Shield,
   Performance Baseline, and packed-example gates;
4. writes a digest-addressed immutable Evidence Record, raw reports, checksum,
   and candidate-resolved compatibility view under the ignored
   `artifacts/release-evidence/` directory.

The record identity includes the candidate digest, source and in-repository
Example App commits, every participating lockfile, protocol, instrumentation,
baseline, Tested Lanes, Validation Combinations, gate results, resolved-policy
digest, and a byte manifest of every raw report. A rerun may reuse an identity
only when every retained file is byte-for-byte identical. Honest wall-clock and
performance observations may therefore produce a new content-addressed record
for the same source commit. Verify any retained bundle without rerunning its
instrumentation with
`npm run evidence -- --verify <immutable-record-id>`.

Missing reports and unmeasurable requirements fail closed; the failed record is
retained and the command exits nonzero. Build, typecheck, test, pack, or
candidate-digest failure produces a `candidate-unavailable` record with the
available raw logs and no invented tarball digest.
The normal clean task preserves `artifacts/release-evidence/` while removing
rebuildable package archives, so a later run can verify rather than overwrite a
record with the same identity.

The Primitive Workshop remains in this repository for maintenance, but release
automation treats it as a public consumer: its frozen dependencies are installed
first, then the exact digest-named candidate tarball is installed, and both
variants build only through package exports. It is not permitted to fall back to
`src/` imports or workspace linking in evidence runs.

Automated records contain no physical Validation Combination. Quest rows stay
provisional until the physical protocol is performed by named evaluators on
recorded device, OS, browser, wrist, input, variant, and refresh-rate
combinations. Automation never infers or promotes physical evidence from IWER.
