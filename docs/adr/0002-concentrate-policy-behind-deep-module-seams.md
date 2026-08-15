---
status: accepted
---

# Concentrate policy behind deep module seams

The Wrist Menu Package has multiple Renderer Integrations, replaceable
presentation, and a fail-closed evidence pipeline. Duplicating scenario
sequencing, targetability rules, or Release Gate interpretation across those
adapters made behavior easy to drift and forced tests to depend on lower-level
implementation details. We therefore keep each policy in one deep module and
make renderer, process, filesystem, and publication code supply mechanics or
observations through narrow seams.

## Decision

- `journey-evidence.mjs` owns the ordered semantic and Scene Event Shield
  scenarios, timing, expected Wrist Menu Events, recovery rules, coverage
  assembly, verification, and final Tested Lane result. Three.js and React
  adapters expose only the primitive renderer mechanics needed to execute those
  workflows; they do not carry their own scenario matrices or branch on
  scenario identifiers.
- A Three.js presentation is created through one factory and exposes only its
  root, declared Hit Regions, Menu Viewport, `update`, and `dispose`. The managed
  Renderer Integration boundary validates declarations, derives Target
  Observations, and applies `PresentationModel.targetable`; tests observe that
  public factory/state seam instead of adding control methods to the default
  presentation implementation.
- `release-gate-evaluation.mjs` owns interpretation of retained reports into
  exact Tested Lane states and Release Gates, fail-closed gate assembly, both
  Evidence Record outcomes, and resolved Compatibility Claims. The evidence
  generator owns git, npm, process, filesystem, and publication adapters only.
  Consumer fixtures retain raw observations; unknown lanes, unavailable or
  malformed evidence, and unmapped gate states cannot be promoted to passing.

## Considered options

- Keep complete journeys in each Renderer Integration. This made each adapter
  locally readable but duplicated timelines, recovery behavior, and expected
  semantic outcomes across four Tested Lanes.
- Test and control the default presentation through implementation-specific
  mutation methods. This simplified narrow tests but created a second interface
  that custom presentations did not implement and allowed targetability policy
  to escape the Renderer Integration.
- Assemble Release Gates directly in the process orchestrator or trust verdicts
  emitted by consumer fixtures. This reduced indirection but mixed policy with
  I/O and weakened the boundary that must fail closed on incomplete evidence.

## Consequences

- A new Renderer Integration implements mechanics adapters and proves the same
  shared workflows rather than defining a parallel behavioral specification.
- A new presentation participates through the same factory contract as the
  default presentation; package-owned selection and targetability policy remain
  outside presentation implementations.
- A new Tested Lane or Release Gate must be mapped in the central evaluator and
  protocol. Raw fixtures may report observations but may not decide publication
  policy.
- Changes to these workflows, presentation declarations, or evaluators are
  evidence-relevant and invalidate affected Evidence Records according to
  ADR 0001.
