# Dropdown auto-hide scrollbar performance guard

## Lifecycle matrix

| Lifecycle | Behavior | Verdict |
| --- | --- | --- |
| Mount | Allocate one small mutable state object; no timer or external listener starts. | pass |
| Scroll burst | Reuse one hide timer, clearing and restarting it for the latest event. | pass |
| Quiet period | Remove the active class after 700ms and release the timer ID. | pass |
| Close / unmount | Clear the timer, remove the class, and release the element reference. | pass |
| Idle / hidden | No work runs without a scroll event; no poller, observer, worker, or subscription exists. | pass |
| Multiple dropdowns | State and timer ownership are per mounted renderer; cleanup is local. | pass |

## Resource findings

| Area | Finding | Verdict | Reason / mitigation |
| --- | --- | --- | --- |
| CPU | A scroll event performs one class add, at most one timer clear, and one timer schedule. | keep | Work is constant-time and occurs only during direct user scrolling. |
| Memory | One element reference and one timer ID are retained per active renderer. | keep | Both are released on timeout or unmount. |
| Rendering | Visibility changes use a class directly and do not schedule React state updates or component renders. | keep | Avoids high-frequency React reconciliation. |
| Cancellation | Component cleanup calls `disposeAutoHideScrollbar`. | keep | Unit and rendered-component tests assert zero timers after dispose/unmount. |

## Verdict

**Pass for lifecycle safety.** Manual WebKit visual verification is still required
for thumb appearance and gutter stability, but no retained background work remains
after the Dropdown closes.
