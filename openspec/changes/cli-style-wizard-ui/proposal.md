# Proposal: CLI-Style Wizard UI

## Intent

The left-column wizard progress output doesn't match the backend CLI format — `✓` (checkmark) isn't recognized as "done", task separators (`─── [1/4] full ───`) have no special styling, and `🔗 Live:` URLs are plain text. The right-column "Descargar PDF" button is no longer needed since the HTML preview IS the report. An email input field is needed after wizard completion.

## Scope

### In Scope
- Fix `stepStatus()` to recognize `✓`, `▶`, `🔗`, `───` message types from CLI
- Add dimmed/centered styling for `───` task separator lines
- Render `🔗 Live:` URLs as clickable `<a>` links
- Preserve leading two-space indentation for CLI fidelity
- Remove "Descargar PDF" button from ResultPanel
- Add "Previsualización se está generando..." state during wizard processing
- Add email input field at end of wizard (before reset)
- Pass `wizardActive` flag from ChatPane to ResultPanel

### Out of Scope
- No backend changes (CLI output format, SSE messages, pipeline)
- No spec-level contract changes for wizard task selection or CUIT input flows
- No changes to the chat message pipeline or conversation storage

## Capabilities

### New Capabilities
None — pure UI rendering change, no new feature boundaries.

### Modified Capabilities
- `inline-report-preview`: Remove PDF download button requirement. Add "generating" loading state. Requirement "PDF Download" and "Loading State" change — download button removed entirely.
- `chat-frontend`: `WizardOnboarding` progress rendering changes and email input field. `ResultPanel` visual state changes.

## Approach

**A.** Fix `WizardOnboarding.jsx` `stepStatus()`: add `✓` → "done", `▶` → "in_progress", detect `───` and `🔗 Live:` via prefix checks.

**B.** Update `ProgressSteps` rendering: apply `text-zinc-400/50 text-center` for `───` lines, wrap `🔗 Live:` URLs in `<a>` with `target="_blank"`, replace spinner width placeholder with proper two-space (`\u00a0\u00a0`) indentation for all lines.

**C.** `ResultPanel.jsx`: remove `<a>` download button block. Add `wizardActive` prop — when `true` + no result, show "Previsualización se está generando..." instead of grey placeholder. When result exists, render HTML preview without download button.

**D.** `ChatPane.jsx`: expose `isThinking || step === 'processing'` as `wizardActive` boolean, pass to `ResultPanel`.

**E.** `WizardOnboarding.jsx`: in the `complete` step, add email `<input>` field with a "Enviar por email" button before the "Nuevo reporte" reset button.

## Affected Areas

| Area | Impact | Description |
|------|--------|-------------|
| `WizardOnboarding.jsx` | Modified | `stepStatus()`, `ProgressSteps` rendering, email input in complete step |
| `ResultPanel.jsx` | Modified | Remove download button, add generating state, accept `wizardActive` prop |
| `ChatPane.jsx` | Modified | Pass `wizardActive` to ResultPanel |

## Risks

| Risk | Likelihood | Mitigation |
|------|------------|------------|
| Email input has no backend handler yet | Low | Input is cosmetic-only for now — no API call wired |
| Removing download button surprises users | Low | HTML preview IS the report; PDF download via email flow replaces it |

## Rollback Plan

Revert the 3 frontend files. Pure UI change — no data loss, no migration. Single-commit revert.

## Dependencies

None. Pure React/Tailwind frontend change on 3 files.

## Success Criteria

- [ ] `✓ task completada` messages render as "done" (no spinner, dimmed color)
- [ ] `─── [1/4] full ───` lines render dimmed and centered
- [ ] `🔗 Live: https://...` renders as a clickable link
- [ ] All progress lines preserve leading two-space indent
- [ ] Right column shows "Previsualización se está generando..." during processing
- [ ] Right column shows full HTML preview on completion (no download button)
- [ ] Email input field appears after wizard complete step
