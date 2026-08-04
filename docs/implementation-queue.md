# Implementation Queue

GitHub's native sub-issue and dependency relationships on
[Choose the implementation sequence and close remaining gaps](https://github.com/xleepy/wrist-menu/issues/11)
are the source of truth. Create a downstream issue worktree only after every
declared dependency has merged to `main`, and base it on that updated `main`.

## Active

- [#17 Controller Action Item tracer](https://github.com/xleepy/wrist-menu/issues/17)

## Dependency order

1. #16
2. #17
3. #18 and #19 in parallel after #17
4. #20 after #18 and #19
5. #21 after #18 and #20
6. #22 and #23 in parallel after #21
7. #24 after #23; it may overlap unfinished #22
8. #25 after #22 and #24
9. #26, then #27, then #28, then #29

## Blocked

| Issue | Blocked by |
| --- | --- |
| [#18 Host-controlled Menu Definition](https://github.com/xleepy/wrist-menu/issues/18) | #17 |
| [#19 Wrist anchoring and intentional reveal](https://github.com/xleepy/wrist-menu/issues/19) | #17 |
| [#20 Cross-input selection parity](https://github.com/xleepy/wrist-menu/issues/20) | #18, #19 |
| [#21 Reach presentation and continuous scrolling](https://github.com/xleepy/wrist-menu/issues/21) | #18, #20 |
| [#22 Theming and presentation replacement](https://github.com/xleepy/wrist-menu/issues/22) | #21 |
| [#23 Primitive Workshop happy path](https://github.com/xleepy/wrist-menu/issues/23) | #21 |
| [#24 Primitive Workshop failure and lifecycle matrix](https://github.com/xleepy/wrist-menu/issues/24) | #23 |
| [#25 Automated release evidence](https://github.com/xleepy/wrist-menu/issues/25) | #22, #24 |
| [#26 Candidate package and versioned documentation](https://github.com/xleepy/wrist-menu/issues/26) | #25 |
| [#27 Protected `next` candidate](https://github.com/xleepy/wrist-menu/issues/27) | #26 |
| [#28 Physical Quest validation matrix](https://github.com/xleepy/wrist-menu/issues/28) | #27 |
| [#29 Stable release readiness](https://github.com/xleepy/wrist-menu/issues/29) | #28 |

## External gates

- #23-#26 require the separate `xleepy/wrist-menu-example` repository.
- #27 requires npm scope control, protected publishing credentials, 2FA, and
  staged-package approval.
- #28 requires independent physical Quest 3 and Quest 3S validation.
- #29 requires the reviewed stable release and Example App deployment flow.
