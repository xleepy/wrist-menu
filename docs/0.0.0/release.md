# Candidate, release, and local override

## Build a reviewable candidate

Build and verify from the same clean committed checkout that produced the
passing automated Evidence Record:

```sh
npm run candidate:verify -- --evidence-bundle <path-to-passing-automated-release-record>
```

The command verifies the complete immutable Evidence Record before using it. It
then creates a digest-addressed ignored directory under `artifacts/candidates/`
containing:

- `package.tgz`, the exact publication-staged npm archive;
- `package/`, the extracted install source;
- `candidate.json`, with the package digest, exact source state, documentation
  digest, and evidence relationship;
- versioned documentation, the executable candidate-doc fixture, the validation
  protocol, and a complete copy of the exact automated record, all outside the
  package; and
- a byte manifest and checksum for the whole review bundle.

The npm archive contains only built runtime JavaScript, declarations,
`package.json`, `LICENSE`, `README.md`, and `compatibility.json`. Repository
source, tests, fixtures, examples, maps, and generated documentation sidecars
are rejected. `candidate.json.documentation.revision` is an exact commit only
for a clean worktree; a dirty build records `null` and `working-tree`. This
avoids embedding a fake future commit or a self-referential archive digest.

Evidence generation and candidate construction use the same staging function.
That function copies only the approved payload, rewrites the staged README's
repository-relative documentation links to exact GitHub URLs at the captured
source commit, and runs `npm pack` on those staged bytes. Consumer, IWER,
allocation, renderer, and Example Variant gates install that exact staged
archive. The archive itself is retained inside the immutable automated Evidence
Record.

Candidate construction independently stages the package again and requires its
SHA-256 to equal the digest recorded by the supplied Evidence Record. It also
requires the Evidence Record source and Example App revisions to equal the
candidate source commit. Any digest or revision mismatch fails closed before a
candidate bundle is written. `candidate:verify` reports
`appliesToCandidate: true` only after this exact handshake succeeds.

## Extracted-candidate consumers

Verification performs a frozen install of the candidate-doc fixture's peer
dependencies, installs only the generated `package/` extraction with npm local
links disabled, and runs:

1. hostile public imports and removed-alias checks;
2. TypeScript declaration compilation for core, Three, and React entry points;
3. the executable renderer-neutral documentation journey; and
4. stable Three session/reference-space handler identity checks.

It rejects a symlink, a workspace/source import, or an installed package whose
file manifest differs from the extraction.

## Restore the local override

After candidate execution, verification runs `npm ci` again from the unchanged
fixture lockfile. It proves `package.json` and `package-lock.json` are byte-for-
byte unchanged, the local candidate is absent, and the locked dependency tree
is valid. This is the supported local override cycle: frozen checkout, temporary
extracted candidate, then frozen checkout again.

## Publication policy

Do not publish a candidate whose exact automated record is missing, failed, or
applies to different bytes. Passing automated evidence does not complete the
stable release: current independent Quest 3 and Quest 3S physical records are
still required. A `next` prerelease may expose incomplete physical combinations
only when documentation and compatibility policy retain their provisional or
unverified status.

For a later release, build from the final clean commit, generate automated
evidence for the publication-staged digest, verify the exact candidate/evidence
handshake, run the required physical protocol, verify every immutable bundle,
then review the candidate package allowlist and documentation identity before
any registry action.
