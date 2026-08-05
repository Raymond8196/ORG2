# Test Cases: Dropdown auto-hiding scrollbar

## Preconditions

- Open a Select/Dropdown with enough options to overflow vertically.
- Test with a mouse wheel or trackpad in both light and dark appearance.

## Happy Path

| #   | Steps                                            | Expected Result                                                        |
| --- | ------------------------------------------------ | ---------------------------------------------------------------------- |
| 1   | Open the overflowing dropdown without scrolling. | The scrollbar gutter is stable and the thumb is hidden.                |
| 2   | Scroll the option list.                          | The scrollbar thumb appears immediately and the list scrolls normally. |
| 3   | Stop scrolling.                                  | The thumb hides after 700ms without changing the dropdown width.       |

## Edge Cases

| #   | Scenario                   | Steps                                           | Expected Result                                                                              |
| --- | -------------------------- | ----------------------------------------------- | -------------------------------------------------------------------------------------------- |
| 1   | Rapid repeated scrolling   | Scroll repeatedly with gaps shorter than 700ms. | A single hide timer is restarted and the thumb remains visible until the final quiet period. |
| 2   | Menu closes while visible  | Scroll, then close the dropdown immediately.    | The timer is cancelled and no retained listener or timer remains.                            |
| 3   | Empty or short option list | Open a dropdown that does not overflow.         | No scrollbar thumb appears and option behavior is unchanged.                                 |

## Error / Degraded States

| #   | Scenario               | Steps                                      | Expected Result                                                           |
| --- | ---------------------- | ------------------------------------------ | ------------------------------------------------------------------------- |
| 1   | Reduced motion enabled | Enable reduced motion and scroll the list. | The visibility behavior remains usable; no layout movement is introduced. |

## Accessibility

- [ ] Keyboard navigation and selection behavior are unchanged.
- [ ] Screen-reader option names and selection state are unchanged.
- [ ] Focus remains on the dropdown trigger/listbox while scrolling.

## Acceptance Criteria

- [ ] The scrollbar thumb is transparent before the first scroll event.
- [ ] The thumb is visible during active scrolling.
- [ ] Continued scrolling restarts one bounded 700ms hide timer.
- [ ] Closing/unmounting the dropdown clears the timer.
- [ ] Showing or hiding the thumb causes no layout shift.
