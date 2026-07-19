# Physical HITL checklist

This checklist must be completed by a real headset wearer. An agent or deterministic trace cannot answer it.

## Immediate Quest 2 evidence lane

1. On Quest 2, enter the exact Horizon OS and Meta Quest Browser versions, then enter VR. Keep the resulting `XRInputSource.profiles` in the copied evidence.
2. For each menu wrist, run **Tracked hand: raw wrist joint** and **18 mm palm clearance**. Record pass/adjust/fail plus the wearer's own note for centering, clipping, reach, and accidental reveal.
3. For each menu wrist, run the default **Quest 2 Touch candidate A**. Use **Controller: neutral grip proxy** only as a debugging comparison. Tune the six fields only when an issue appears; record the adjusted concrete offset or a fail.
4. While visible, briefly occlude the tracked hand and separately move a controller out of tracking. Verify the cached panel is amber and non-interactive immediately, remains for at most the configured grace, then hides; reacquisition must require fresh dwell. Record each as pass/adjust/fail.
5. Switch hands ↔ controllers while the panel is active. Verify the old source cancels immediately and a replacement source cannot inherit interactivity. Press the opposite controller trigger once and record the reported haptic capability plus whether a pulse was actually felt.
6. Copy the evidence JSON and paste it into issue 12 when debugging or adjusting the default. This provisional device default does not by itself promise Quest 2 support.

## Remaining release-device lanes

Repeat steps 1–6 on Quest 3 and Quest 3S using the neutral controller proxy plus Touch Plus candidates A/B. The ticket can choose package defaults only after both release-device lanes include exact versions, actual profiles, both wrists, hands/controllers, degradation/replacement outcomes, and the wearer's explicit comfort verdict.

## Decision rule

- Quest 2 candidate A may remain a provisional, explicitly targeted device default while field feedback is collected.
- A cross-device or release-device default still needs matching comfortable concrete offsets and safe degradation behavior on Quest 3 and Quest 3S, with no handedness asymmetry left unexplained.
- A result that varies by actual `XRInputSource.profiles` may become a named profile preset.
- A result that varies by wearer, application ergonomics, or an unsupported profile remains a Host Application override.
- Missing or emulated poses never become interactive; a haptic claim requires both reported capability and a felt physical result.
