# Compatibility and exact evidence

Peer ranges are installation contracts, not Compatibility Claims. The
candidate declares Three.js `>=0.185.1 <0.186.0`, React
`>=18 <19.3`, and React Three Fiber `>=8.18.0 <10`.

The policy names these exact automated Tested Lanes: Three.js `0.185.1`, React
`18.3.1` with R3F `8.18.0`, React `19.2.7` with R3F `9.6.1`, React XR
`6.6.30`, and IWER `2.3.0` for vanilla/React with hands/controllers. Automated
lane evidence is attached to the review candidate only when every required
automated Release Gate passes for the exact staged package bytes.

Quest 3, Quest 3S, and Quest 2 rows are **provisional**. Quest Pro and other
WebXR devices are unverified. Automated and IWER results contain no physical
Validation Combination and cannot prove tracking, optics, comfort, thermal, or
device performance.

## Exact candidate evidence

The generated candidate bundle writes an
[`evidence-index.json`](../evidence-index.json) beside this versioned
documentation. That index identifies the exact candidate SHA-256, source commit,
Example App revision, immutable automated Evidence Record, and whether that
record applies to the candidate byte-for-byte.

Candidate verification accepts only a passing automated Evidence Record whose
source revision matches the candidate source commit and whose candidate SHA-256
matches the tarball produced by the publication staging path. A digest or source
mismatch fails closed before the candidate bundle can be accepted.

The complete immutable record is copied to the generated bundle at the path
reported by `evidence-index.json`. The index must report
`appliesToCandidate: true`; candidate verification rejects any other value.

Passing automated evidence still promotes no physical Validation Combination.
Stable compatibility claims remain gated on the independent Quest validation
and stable-release requirements described by the validation policy.

## Prior failed evidence

The earlier automated Evidence Record
`automated-release-d5827ff6fbbe7c67` — source and Example App commit
`6d57b41b3f28a981f2c88e9f7c3cd5dd0a8d7c91`, candidate SHA-256
`eef2c2de4a8c25a0226d5067a3735beeb177816c84a5265caf37a861adeff21d` — holds an
immutable **failed** verdict: exact JavaScript object-allocation
instrumentation was unavailable, an identical Frame Sample observed 68
instrumented property writes, construction observed no required atlas texture
or upload version, and the React Example Variant exposed no direct
package-update/renderer counters. Its deterministic, import, exact consumer,
React XR, IWER, lifecycle, Scene Event Shield, and packed-example gates passed,
but partial results do not change the failed overall verdict. That record
predates the exact candidate handshake: it applies to no current candidate
bytes and promotes no claim.
