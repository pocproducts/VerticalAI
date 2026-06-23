# Design: PDF HTML Preview in Right Column

## Technical Approach

Replace the live extraction progress panel (right column) with a report preview that appears **only after** wizard completion. Strip all progress-tracking state from `ChatPane`, remove the progress-propagation path from `WizardOnboarding`, and gut `ResultPanel` to render either an empty grey shell or a styled HTML preview of `result.reply` with PDF download.

No backend changes. No new dependencies. Pure React + Tailwind.

## Architecture Decisions

### Decision: Gut `ResultPanel` vs New Component

| Option | Tradeoff |
|--------|----------|
| Gut `ResultPanel`, keep name | Fewer files changed. Name misalignment ("Result" vs "Preview") but no external references to rename. |
| New `ReportPreview` component | Cleaner naming. More files touched, more imports to update. |

**Choice**: Gut `ResultPanel`. Change its props from progress data to nullable result. The component name is internal — no external API depends on it. Fewer files = less risk.

### Decision: `renderMarkdown()` Reuse

| Option | Tradeoff |
|--------|----------|
| Extract to `utils.js` | Clean import, single source of truth. One export added. |
| Duplicate in `ResultPanel` | 9 lines duplicated. Zero file coupling. |

**Choice**: Extract to `utils.js` (already exists, imported by ChatPane). Both consumers get the same function. Ponytail threshold: two consumers = extract.

### Decision: How Result Reaches Right Column

| Option | Tradeoff |
|--------|----------|
| ChatPane stores `wizardResult` state, set via `onWizardComplete` | Single source of truth. Matches React patterns. Already partially wired. |
| WizardOnboarding stores result, ref-read by ChatPane | Breaks unidirectional flow. More indirection. |

**Choice**: ChatPane owns a single `wizardResult` state (nullable). `onWizardComplete` callback sets it. ResultPanel reads it as prop. No intermediate progress state.

## Data Flow

```
WizardOnboarding ──onWizardComplete(result)──→ ChatPane
                                                  │
                                          wizardResult state
                                                  │
                                        wizardResult (prop)
                                                  │
                                            ResultPanel
                                         ┌──────────────────┐
                                         │ null → grey shell │
                                         │ {reply,pdf_url} → │
                                         │   styled HTML +   │
                                         │   PDF download    │
                                         └──────────────────┘
```

No progress data (steps, sections, timer) flows to the right column. Wizard own progress rendering stays in the left column.

## File Changes

| File | Action | Description |
|------|--------|-------------|
| `components/ChatPane.jsx` | Modify | Remove `wizardSteps`, `wizardSections`, `wizardElapsed`, `wizardActive` state + `handleWizardProgress`. Keep only `wizardResult`. Remove `onProgressChange` from WizardOnboarding. Pass single `result={wizardResult}` to ResultPanel. Import `renderMarkdown` from utils. |
| `components/ResultPanel.jsx` | Modify | Gut entirely. New signature: `({ result })`. Render grey placeholder when null. Render styled HTML from `result.reply` (via `renderMarkdown`) + PDF download `<a>` when non-null. |
| `components/WizardOnboarding.jsx` | Modify | Remove `onProgressChange` prop, `parseSections()`, and the `useEffect` that calls `onProgressChange`. Left-column behaviour unchanged. |
| `components/utils.js` | Modify | Export `renderMarkdown` function (moved from ChatPane). |

## Interfaces / Contracts

### New ResultPanel Props

```jsx
{
  /** Null before wizard completes, result object after */
  result: {
    reply: string       // Markdown-like text with **bold**, [links], \n
    pdf_url?: string    // Optional PDF download URL
  } | null
}
```

### Modified WizardOnboarding Props

```jsx
{
  onWizardComplete: (convId: string, reply: string) => void,
  // onProgressChange removed
}
```

## Testing Strategy

| Layer | What to Test | Approach |
|-------|-------------|----------|
| UI (manual) | Empty state | Load page. No wizard completed → grey shell visible. No steps/sections/timer. |
| UI (manual) | Report activation | Run wizard. On completion → right column shows HTML preview + PDF button. |
| UI (manual) | PDF download | Click button → opens pdf_url in new tab. No pdf_url → no button. |
| UI (manual) | Scroll behaviour | Long reply → right column scrolls independently of left column. |
| Regression | Wizard flow | Left-column wizard steps, progress, and completion work exactly as before. |

No automated frontend tests — project has `strict_tdd: false` and no frontend test runner configured.

## Migration / Rollout

No migration required. Pure UI change. Revert by reverting the three modified files.

## Open Questions

- None
