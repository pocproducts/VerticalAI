# Tasks: PDF HTML Preview in Right Column

## Review Workload Forecast

| Field | Value |
|-------|-------|
| Estimated changed lines | 150–250 |
| 400-line budget risk | Low |
| Chained PRs recommended | No |
| Suggested split | Single PR |
| Delivery strategy | single-pr |
| Chain strategy | pending |

Decision needed before apply: Yes
Chained PRs recommended: No
Chain strategy: pending
400-line budget risk: Low

### Suggested Work Units

| Unit | Goal | Likely PR | Notes |
|------|------|-----------|-------|
| 1 | Full change | PR 1 | All phases — 4 files, no backend, React + Tailwind only |

## Phase 1: Foundation

- [x] 1.1 Extract `renderMarkdown()` from `ChatPane.jsx` into `components/utils.js` — export as named function
- [x] 1.2 Update `ChatPane.jsx` import to consume `renderMarkdown` from `utils.js` instead of local definition

## Phase 2: Core Implementation

- [x] 2.1 Rewrite `ResultPanel.jsx` — accept `{ result }` prop. Null → grey placeholder with icon + "Completá el wizard para ver el reporte". Non-null → styled HTML of `result.reply` via `renderMarkdown` + overflow-y scroll. Remove all progress/sections/timer rendering.
- [x] 2.2 Add PDF download button to `ResultPanel.jsx` — visible only when `result.pdf_url` is truthy, opens in new tab
- [x] 2.3 Remove `wizardSteps`, `wizardSections`, `wizardElapsed`, `wizardActive` state + `handleWizardProgress` callback from `ChatPane.jsx`. Add single nullable `wizardResult` state.
- [x] 2.4 Wire completion flow in `ChatPane.jsx` — on wizard completion, set `wizardResult` and pass `result={wizardResult}` to `ResultPanel`

## Phase 3: Cleanup & Verification

- [x] 3.1 Update `WizardOnboarding.jsx` — remove `onProgressChange` prop, `parseSections()` function, and the `useEffect` that calls `onProgressChange`
- [x] 3.2 Manual verify: load page with no wizard → grey shell, no progress data. Run wizard full cycle → HTML preview + PDF button appear. Verify left-column wizard flow unchanged.
