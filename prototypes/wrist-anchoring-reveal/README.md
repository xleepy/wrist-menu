# THROWAWAY PROTOTYPE: wrist anchoring and intentional reveal

This terminal lab asks whether one explicit state model can make wrist-menu reveal behavior understandable across tracked hands, approximate controller wrists, noisy facing samples, tracking loss, WebXR visibility changes, and Host Application visibility overrides. It is intentionally cheap and disposable: use it to find surprising transitions and tune hypotheses, then carry only validated decisions into production code.

The numbers in this prototype are **illustrative starting values, not Wrist Menu Package defaults**. Every uncertain angle and timer is adjustable while the lab runs.

Run it from the repository root:

```powershell
node prototypes/wrist-anchoring-reveal/cli.mjs
```

The app redraws the complete relevant state after every key. Press `1`-`4` to load one of these named scenario queues, then press `n` to apply its next sample/event:

- `accidental-flicker`: noisy samples repeatedly cross the enter angle without satisfying dwell;
- `intentional-reveal`: a stable palm-facing sample enters, becomes visible, then crosses the exit angle;
- `brief-occlusion`: a visible menu loses tracking, holds a non-interactive transform briefly, and requires fresh dwell after reacquisition;
- `forced-visibility`: a low-confidence controller cannot auto-reveal, while Host Application overrides and session visibility still take precedence.

For a non-interactive transition trace (useful for quick verification):

```powershell
node prototypes/wrist-anchoring-reveal/cli.mjs --trace intentional-reveal
```

Files:

- `state-machine.mjs` is the pure, portable reducer. It has no terminal or other I/O.
- `scenario-presets.mjs` contains disposable event queues.
- `cli.mjs` is the throwaway terminal shell.
