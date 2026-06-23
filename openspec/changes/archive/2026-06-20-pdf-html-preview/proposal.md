# Proposal: PDF HTML Preview in Right Column

## Intent

Replace the live extraction progress panel (right column) with an inline HTML report preview shown only after wizard completion. Right column starts empty (grey shell) and renders a styled HTML report + PDF download button when the wizard finishes.

## Scope

### In Scope
- Clear all wizard progress data flow (steps, sections, timer) into `ResultPanel`
- Remove progress-tracking state (`wizardSteps`, `wizardSections`, `wizardElapsed`, `wizardActive`) from `ChatPane`
- Add callback: wizard passes final `result` to right column on completion
- Rebuild `ResultPanel` to render inline HTML report from `result.reply` + `result.pdf_url`
- Add PDF download button to right column

### Out of Scope
- Wizard left-column behavior unchanged
- No pdf.js, react-pdf, or iframe — pure React + Tailwind
- No backend or SSE data shape changes

## Capabilities

### New Capabilities
- `inline-report-preview`: Right column renders `result.reply` as styled HTML preview matching PDF layout. Includes PDF download from `result.pdf_url`.

### Modified Capabilities
- `chat-frontend`: `ResultPanel` and `ChatPane` right-column integration change. No spec-level contract change — wizard requirements stay as-is.

## Approach

**Option A**. Keep `ResultPanel` shell, strip its content. `ChatPane` changes:
1. Remove `wizardSteps`/`wizardSections`/`wizardElapsed`/`wizardActive` state + `handleWizardProgress`
2. Add single nullable `wizardResult` state — set only on completion
3. Remove `onProgressChange` from `WizardOnboarding`
4. `ResultPanel` receives nullable `result`: empty state → grey shell placeholder; report state → styled HTML render of `result.reply` (via existing `renderMarkdown()`) + PDF download `<a>`

## Affected Areas

| Area | Impact | Change |
|------|--------|--------|
| `ResultPanel.jsx` | Modified | Render inline HTML preview + PDF download |
| `ChatPane.jsx` | Modified | Remove progress state, single `wizardResult` |
| `WizardOnboarding.jsx` | Minor | Remove `onProgressChange` prop |

## Risks

| Risk | Likelihood | Mitigation |
|------|------------|------------|
| Reply is plain text | Medium | Reuse `renderMarkdown()` from `ChatPane` |
| Preview ≠ PDF layout | Low | Preview approximates — PDF is canonical output |

## Rollback Plan

Revert `ChatPane.jsx`, `ResultPanel.jsx`, `WizardOnboarding.jsx`. Pure UI — no data loss or migration. One-commit revert.

## Dependencies

None. Pure React/Tailwind frontend change.

## Success Criteria

- [ ] Right column shows empty grey shell on load (no progress, sections, or timer)
- [ ] Wizard runs in left column exactly as before — same progress, steps, flow
- [ ] On completion, right column renders `result.reply` as styled HTML
- [ ] Right column shows PDF download button opening `result.pdf_url`
- [ ] No regressions in wizard flow or left-column behavior
