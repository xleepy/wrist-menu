# Wrist anchoring and reveal

The core receives only portable, current-frame poses. A tracked-hand
`WristSourceSample` contains its standard `wrist` joint pose. A controller
sample contains its grip pose; selection still uses a separate
`controller-target-ray` Target Observation. Poses are never reused for input
after their Frame Sample.

## Defaults

| Setting | Default |
| --- | ---: |
| Automatic enter angle | 35° |
| Hysteresis exit angle | 50° |
| Initial dwell | 300 ms |
| Reacquisition dwell | 200 ms |
| Non-interactive tracking grace | 250 ms |
| Ordinary show/hide transition | 150 ms |

Timers use absolute XR timestamps, so fixed and irregular frame schedules
produce the same result at the same sampled time. A missing current pose
cancels interaction immediately. The last transform may remain visible during
tracking grace, but Hit Regions and Scene Input Claims are inactive. Tracking
reacquisition, source-object replacement, visibility resumption, reference
space reset, recentering, reparenting, and session replacement require fresh
acquisition.

## Controller Wrist Proxies

The neutral fallback translates 90 mm along grip local `+Y`. The provisional
Quest 2 candidate A uses:

- left: translation `[0.02, 0.096, 0.008]` m and rotation `[0, 0, 8]`°;
- right: translation `[-0.02, 0.096, 0.008]` m and rotation `[0, 0, -8]`°.

Quest 2 selection requires the explicit `deviceTarget: "quest-2"`. The runtime
does not infer devices from overlapping input profile aliases. An explicit
`preset` takes precedence over the device target, and a concrete offset for the
active wrist takes precedence over both.
