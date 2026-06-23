# Tasks: CLI-Style Wizard UI

## Review Workload Forecast

| Field | Value |
|-------|-------|
| Estimated changed lines | ~95–120 (additions + deletions) |
| 400-line budget risk | Low |
| Chained PRs recommended | No |
| Suggested split | Single PR |
| Delivery strategy | single-pr |

Decision needed before apply: No
Chained PRs recommended: No
Chain strategy: size-exception
400-line budget risk: Low

### Suggested Work Units

| Unit | Goal | Likely PR | Notes |
|------|------|-----------|-------|
| 1 | All 3 files — CLI rendering, wizardActive, email input | Single PR | Each touch same files; splitting would duplicate context |

## Phase 1: ProgressSteps CLI Format — WizardOnboarding.jsx

- [x] 1.1 Fix `stepStatus()`: add `msg.startsWith("✓")` → return `"done"` (alongside existing `✅` check)
- [x] 1.2 Create `renderMessage(msg)` function with ordered prefix matching:
      `───` → `<div className="text-center text-zinc-400/50">` dimmed centered text
      `🔗 Live:` → `<a href="..." target="_blank" rel="noopener noreferrer">` clickable link
      `✓` → `<span className="text-green-600">` green checkmark (timing suffixed as-is)
      fallback → plain `<span>` with leading `\u00a0\u00a0` indent preserved
- [x] 1.3 Update `ProgressSteps` rendering to call `renderMessage()` per step instead of raw `{msg}`
- [x] 1.4 Remove `hasInlineEmoji` check — `renderMessage` handles all patterns uniformly

## Phase 2: wizardActive Wiring

- [x] 2.1 Add `onProcessingChange?: (active: boolean) => void` prop to `WizardOnboarding`
- [x] 2.2 Fire `onProcessingChange(true)` when `step` transitions to `"processing"`, `onProcessingChange(false)` on `"complete"` or `"error"`
- [x] 2.3 Add `wizardActive` prop (boolean, default `false`) to `ResultPanel`
- [x] 2.4 Replace ResultPanel's two-state render with three-state:
      `!wizardActive && !result` → existing grey placeholder (unchanged)
      `wizardActive && !result` → "Previsualización se está generando..." + `<Loader2 className="animate-spin" />`
      `result exists` → existing report view, **except** remove the entire `{result.pdf_url && <a>Descargar PDF</a>}` block (lines 149–161)
- [x] 2.5 Add `wizardProcessing` state + `handleProcessingChange` callback in `ChatPane`, pass `wizardActive={wizardProcessing}` to `<ResultPanel>`

## Phase 3: Email Input Post-Completion — WizardOnboarding.jsx

- [x] 3.1 After `<WizardResult>` in the `complete` step, add email input section:
      Label "Enviar reporte por email"
      `<input type="email">` pre-filled from `clienteInfo?.email || ""`
      "Enviar" button
      Feedback text on send (success/error)
- [x] 3.2 Add `emailTo` state; remove `sendEmail` state and `send_email` from the wizard API payload in `handleGenerate`
- [x] 3.3 Remove `send_email` checkbox + `Mail` icon import from `WizardStepTasks.jsx`
