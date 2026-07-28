---
status: accepted
---

# Gate compatibility claims on exact evidence

Public peer ranges describe installable configurations, not configurations the
project has proved. A stable Compatibility Claim therefore names exact Tested
Lanes or Validation Combinations and fails closed when any applicable Release
Gate lacks a current passing Evidence Record. IWER establishes deterministic
browser and integration behavior but never substitutes for physical tracking,
optics, comfort, thermal, or frame evidence. Quest 3 and Quest 3S are independent
physical release targets; Quest 2 remains provisional until it passes the same
gates. Prereleases may expose incomplete combinations through the `next` tag,
provided they are labelled provisional rather than supported.

Evidence is invalidated by relevant change rather than by assumption: dependency
changes invalidate affected Tested Lanes; device OS or browser changes invalidate
that Validation Combination; behavior, presentation, offset, fixture, or
instrumentation changes invalidate the evidence they can affect. The Host
Application continues to own the XR session and render loop, so performance is
measured as package-attributable update and frame impact instead of an
application-wide frame-rate promise.

## Consequences

- `compatibility.json` must separate declared peer ranges, exact Tested Lanes,
  Compatibility Claims, and their Evidence Records.
- Stable publication remains blocked until Quest 3 and Quest 3S pass their
  independent hand and controller combinations.
- Quest 2, Quest Pro, and other WebXR runtimes cannot inherit support from
  another device or from standards compliance alone.
- A widened peer range or support claim requires new evidence; documentation
  cannot promote a provisional combination by wording alone.
