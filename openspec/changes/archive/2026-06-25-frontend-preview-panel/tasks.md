# Tasks: Frontend Preview Panel

## Review Workload Forecast

| Field | Value |
|-------|-------|
| Estimated changed lines | ~65 |
| 400-line budget risk | Low |
| Chained PRs recommended | No |
| Suggested split | Single PR |
| Delivery strategy | single-pr |

Decision needed before apply: No
Chained PRs recommended: No
400-line budget risk: Low

## Phase 1: State Wiring

- [x] 1.1 `hooks/useChat.js`: Add `latestResult` + `latestPipelineSteps` state. Clear on sendMessage start, set from response on SSE complete, clear on abort/error. Export both.
- [x] 1.2 `hooks/useChat.js`: On SSE progress, also track latestPipelineSteps via stepsRef so the final snapshot is available.

## Phase 2: Prop Plumbing

- [x] 2.1 `components/AIAssistantUI.jsx`: Destructure `latestResult` + `latestPipelineSteps` from useChat, pass to `<ChatPane>`.
- [x] 2.2 `components/ChatPane.jsx`: Accept new props. When direct extraction is active (has pipeline steps or loading), merge into ResultPanel data alongside wizard state. Direct takes priority.
