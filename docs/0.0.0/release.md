# Candidate, release, and local override

## Build a reviewable candidate

Build and verify from a committed checkout after `npm run check`:

```sh
npm run candidate:verify -- --evidence-bundle <path-to-automated-release-d5827ff6fbbe7c67>
```

The command verifies the complete immutable predecessor Evidence Record before
using it. It then creates a digest-addressed ignored directory under
`artifacts/candidates/` containing:

- `package.tgz`, the npm archive;
- `package/`, the extracted install source;
- `candidate.json`, with the package digest, exact source state, documentation
  digest, and non-promotional evidence relationship;
- versioned documentation, the executable candidate-doc fixture, the validation
  protocol, and a complete copy of the predecessor record, all outside the
  package; and
- a byte manifest and checksum for the whole review bundle.

The npm archive contains only built runtime JavaScript, declarations,
`package.json`, `LICENSE`, `README.md`, and `compatibility.json`. Repository
source, tests, fixtures, examples, maps, and generated documentation sidecars
are rejected. `candidate.json.documentation.revision` is an exact commit only
for a clean worktree; a dirty build records `null` and `working-tree`. This
avoids embedding a fake future commit or a self-referential archive digest.

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

Do not publish this candidate under a stable tag. The exact predecessor record
failed and current candidate bytes need their own complete Evidence Record.
Stable publication also requires current independent Quest 3 and Quest 3S
physical records. A `next` prerelease may expose incomplete combinations only
when documentation and compatibility policy retain their provisional or
unverified status.

For a later release, build from the final clean commit, generate new automated
evidence for that exact digest, run the required physical protocol, verify every
immutable bundle, then review the candidate package allowlist and documentation
identity before any registry action.
