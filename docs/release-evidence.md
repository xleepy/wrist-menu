# Release evidence automation

`compatibility.json` is the committed compatibility policy. It records the
declared peer ranges, exact dependency and IWER Tested Lanes, empty verified
claims, provisional physical rows, and invalidated-evidence ledger. The source
manifest deliberately contains no candidate commit or tarball digest: embedding
those values would make the candidate change while it was being identified.

Run `npm run evidence` only from a clean, committed worktree. The command:

1. builds, typechecks, tests, and verifies the package allowlist;
2. uses the publication staging path to copy the approved package payload,
   rewrite repository-relative README links to the exact source commit, run
   `npm pack`, retain that exact staged tarball, and install those exact bytes in
   every packed consumer and Example Variant lane;
3. runs the hostile-import, Three, React 18, React 19, React XR, four IWER,
   deterministic-boundary, allocation/resource, lifecycle, Scene Event Shield,
   Performance Baseline, and packed-example gates; and
4. writes a digest-addressed immutable Evidence Record, the exact staged
   candidate tarball, raw reports, checksum, and candidate-resolved compatibility
   view under the ignored `artifacts/release-evidence/` directory.

The staged candidate tarball lives inside the immutable record's `raw/` subtree,
so the Evidence Record byte manifest covers the exact package that its gates
installed. Consumer scripts accept an explicit candidate path and SHA only when
the bytes at that path hash to the supplied digest; normal non-evidence runs keep
the existing `npm pack` artifact fallback.

Before the Node allocation lane imports its packed candidate, automation
classifies every package-owned JavaScript allocation site represented by the
emitted package AST in that evidence copy. It also assigns exactly one
descriptor to every original `CallExpression` and `NewExpression`: exact
fixed-cardinality, proven allocation-free for this protocol, or guarded
unsupported. The versioned marker records the three catalogs, every classified
site and descriptor identity/reason, per-file AST-node, invocation, descriptor,
and site totals, plus source/instrumented digests. Generation and verification
both require the Call/New AST totals to equal their descriptor totals. Stable
site identifiers feed a preallocated counter and produce exact per-site counts
while the public Three integration processes 10,000 successive steady Frame
Samples. These totals describe the emitted candidate before instrumentation;
the versioned recorder and sentinel nodes injected into the evidence copy are
instrumentation-owned, not package-source sites.

The generator hashes the complete marker before starting the consumer and
passes that digest over a separate environment boundary. The digest, candidate
digest, marker name, and instrumentation identity are retained in a raw trust
report covered by the immutable Evidence Record. The consumer verifies that
trusted digest before parsing the marker. It then parses every transformed file
and requires exact sites to carry the exact runtime token, unsupported sites to
carry the distinct unsupported token, and allocation-free sites to carry no
recorder call. Every non-free marker site must have a matching transformed
token. A marker-only reclassification, repaired marker totals, changed code and
recomputed file digests, or a coherent marker/code rewrite therefore fails
closed unless it is the exact output bound before consumer execution by the
versioned instrumenter.

Exact sites are fixed-cardinality language-level package-source constructions:
object and array literals and ordinary function, arrow, class, and
regular-expression creation. Validated weights include constructor prototypes
and method closures. Function declarations are charged when the containing scope
executes, and class declarations are charged at declaration evaluation.
No `new` or call expression is generically assigned weight one. Dependency-owned
objects and engine-internal objects that are not language-level package-source
constructions are outside this package-owned count.

The allocation-free call registry is narrow and identity-based. It admits only
the resolved ordinary synchronous package helpers used by the steady-frame
path, preallocated WeakMap/WeakSet reads, and named XR host-boundary reads. Each
entry records its emitted module, exact callee identity, binding/receiver proof,
and reason. Package helper bodies are independently classified; objects returned
by the XR host are not package-source allocations.

Any construct whose package-source object cardinality cannot be proven uses an
execution-time sentinel. Rest arrays, destructuring and spread iteration,
object rest/spread, `for...of`, `arguments`, async/generator paths, dynamic
import, and tagged templates are guarded unsupported. More fundamentally, all
calls and constructions are default-deny: unknown, property, explicit iterator
or result, aliased, `globalThis`, Promise, callable-factory, dynamic or
variable-cardinality calls and every generic `new` execute their sentinel before
invocation unless the exact identity is in the allocation-free registry. This
includes `Object.getOwnPropertyNames`, `Reflect.ownKeys`, `Object.entries`,
`Array.from`, `matchAll`, typed-array construction/`from`/`subarray`, and a
generator invocation even when its iterator is never advanced. If a
guarded unsupported site executes inside the measured window, the exact report
is unavailable and the Release Gate fails; an unexecuted site does not taint a
different measured path. Shipped candidate bytes remain unchanged. Missing,
incompatible, partial-coverage, or digest-mismatched instrumentation fails
closed instead of falling back to Three resource deltas or heap sampling.

The record identity includes the candidate digest, source and in-repository
Example App commits, every participating lockfile, protocol, instrumentation,
baseline, Tested Lanes, Validation Combinations, gate results, resolved-policy
digest, and a byte manifest of every raw report, including the staged candidate
tarball. A rerun may reuse an identity only when every retained file is
byte-for-byte identical. Honest wall-clock and performance observations may
therefore produce a new content-addressed record for the same source commit.
Verify any retained bundle without rerunning its instrumentation with
`npm run evidence -- --verify <immutable-record-id>`.

Candidate construction uses the same staging function independently and accepts
only a passing automated Evidence Record from the same source commit. The newly
staged package SHA-256 must equal the Evidence Record's candidate SHA-256;
otherwise candidate generation fails closed. The generated evidence index and
`candidate.json` must both report `appliesToCandidate: true`.

Missing reports and unmeasurable requirements fail closed; the failed record is
retained and the command exits nonzero. Build, typecheck, test, package-allowlist,
or candidate-staging failure produces a `candidate-unavailable` record with the
available raw logs and no invented tarball digest. The normal clean task
preserves `artifacts/release-evidence/` while removing rebuildable package
archives, so a later run can verify rather than overwrite a record with the same
identity.

The Primitive Workshop remains in this repository for maintenance, but release
automation treats it as a public consumer: its frozen dependencies are installed
first, then the exact publication-staged candidate tarball is installed, and
both variants build only through package exports. It is not permitted to fall
back to `src/` imports or workspace linking in evidence runs.

Automated records contain no physical Validation Combination. Quest rows stay
provisional until the physical protocol is performed by named evaluators on
recorded device, OS, browser, wrist, input, variant, and refresh-rate
combinations. Automation never infers or promotes physical evidence from IWER.
