# Compatibility and exact evidence

Peer ranges are installation contracts, not Compatibility Claims. The
candidate declares Three.js `>=0.185.1 <0.186.0`, React
`>=18 <19.3`, and React Three Fiber `>=8.18.0 <10`.

The policy names these exact automated Tested Lanes: Three.js `0.185.1`, React
`18.3.1` with R3F `8.18.0`, React `19.2.7` with R3F `9.6.1`, React XR
`6.6.30`, and IWER `2.3.0` for vanilla/React with hands/controllers. They remain
`unverified` in the committed policy because the exact record below failed its
complete release gate. Passing individual lanes must not be promoted to a
general or stable claim.

Quest 3, Quest 3S, and Quest 2 rows are **provisional**. Quest Pro and other
WebXR devices are unverified. Automated and IWER results contain no physical
Validation Combination and cannot prove tracking, optics, comfort, thermal, or
device performance.

## Exact Example App revision

The predecessor evidence evaluated Primitive Workshop at commit
[`6d57b41b3f28a981f2c88e9f7c3cd5dd0a8d7c91`](https://github.com/xleepy/wrist-menu/tree/6d57b41b3f28a981f2c88e9f7c3cd5dd0a8d7c91/examples/primitive-workshop).
It consumed the packed package through public exports. This exact link does not
claim that later documentation or candidate bytes were evaluated.

## `automated-release-d5827ff6fbbe7c67`

The exact predecessor Evidence Record is
[`automated-release-d5827ff6fbbe7c67`](../evidence/automated-release-d5827ff6fbbe7c67/evidence-record.json),
source/example commit
`6d57b41b3f28a981f2c88e9f7c3cd5dd0a8d7c91`, candidate SHA-256
`eef2c2de4a8c25a0226d5067a3735beeb177816c84a5265caf37a861adeff21d`.
Its immutable verdict is **failed**:

- exact JavaScript object-allocation instrumentation was unavailable;
- an identical Frame Sample observed 68 instrumented property writes;
- construction observed no required atlas texture or upload version; and
- the React Example Variant exposed no direct package-update/renderer counters.

The record did pass its deterministic, import, exact consumer, React XR, IWER,
lifecycle, Scene Event Shield, and packed-example gates. Those partial results
do not change the failed overall verdict and promote no provisional device row.

That link resolves inside the generated candidate documentation bundle, which
copies the complete verified immutable record to
`documentation/evidence/automated-release-d5827ff6fbbe7c67/` and writes
`documentation/evidence-index.json`. That index identifies current candidate
bytes separately and sets `appliesToCandidate` and
`compatibilityClaimsPromoted` honestly. A changed package digest or source
commit cannot inherit this predecessor record.
