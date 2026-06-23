# Design: CLI-Style Wizard UI

## Technical Approach

Three React components modified in-place (WizardOnboarding, ResultPanel, ChatPane). No new files, no new dependencies, no backend changes. ProgressSteps switches from plain-text rendering to pattern-matched JSX. Email input deferred to post-completion. ResultPanel gets a three-state render (empty / generating / report).

## Architecture Decisions

### Decision: wizardActive via onProcessingChange callback

| Option | Tradeoff |
|--------|----------|
| Derive from `wizardSteps.length > 0 && wizardResult === null` | wizardSteps only set at completion — never true during processing |
| Add `onProcessingChange` prop to WizardOnboarding | **Chosen.** Explicit, minimal coupling, one `useState` in ChatPane |
| Expose `step` via imperative handle | Adds ref complexity, no benefit over callback |

**Choice**: `onProcessingChange(active: boolean)` fired when step transitions to/from `"processing"`. ChatPane tracks `wizardProcessing` and passes `wizardActive={wizardProcessing}` to ResultPanel.

### Decision: Pattern-matched message rendering

**Choice**: Single `renderMessage(msg)` function checking prefixes in order: `───` → `text-zinc-400 text-center`, `🔗 Live:` → clickable `<a>`, `✓` → `text-green-600`. All lines preserve leading two-space indent via `\u00a0\u00a0`.

**Rationale**: 4 ordered prefix checks beat a regex state machine. Each returns a fragment with the right className.

### Decision: Email input deferred to post-completion

**Choice**: Email input section renders after `WizardResult` in the `complete` step. Pre-filled from `clienteInfo?.email` if available. "Enviar" button calls API endpoint (`v1/chat/wizard` with `send_email` + email address). The `send_email` checkbox removed from WizardStepTasks; `send_email` removed from wizard API request payload.

**Rationale**: User explicitly asked to ask at the end. Matches real UX flow: see result first, then decide where to send.

### Decision: ResultPanel three-state rendering

**Choice**: Single conditional in the returned JSX:
- `!wizardActive && !result` → grey placeholder (existing)
- `wizardActive && !result` → "Previsualización se está generando..." + spinner
- `result exists` → report sections, PDF link block **removed**

**Rationale**: Three branches, one file, no abstraction.

## Data Flow

```
WizardOnboarding
  step: cuit → tasks → processing → complete
  │
  ├─ onProcessingChange(true)   when step = "processing"
  ├─ onProcessingChange(false)  when step = "complete" | "error"
  └─ onWizardComplete(result)   (existing)

ChatPane (tracks state):
  wizardProcessing ← onProcessingChange
  wizardResult     ← onWizardComplete

  ResultPanel:
    wizardActive={wizardProcessing}
    result={wizardResult}
    ...existing props...
```

## File Changes

| File | Action | Description |
|------|--------|-------------|
| `components/WizardOnboarding.jsx` | Modify | Add `✓` check to stepStatus(). Replace ProgressSteps text rendering with `renderMessage()`. Add `onProcessingChange` prop, fire on step transitions. Add email input section in complete step. Remove `send_email` from wizard API payload. |
| `components/WizardOnboarding.jsx` | Modify | Remove `sendEmail` state (no longer set from WizardStepTasks). Add `emailTo` state for input tracking. |
| `components/WizardResult.jsx` | Modify | Accept optional `onSendEmail(email)` + `emailStatus` props. Render email input section with label, input, button, and feedback. |
| `components/ResultPanel.jsx` | Modify | Accept `wizardActive` prop. Add generating-state render. Remove entire `{result.pdf_url && <a>Descargar PDF</a>}` block. |
| `components/ChatPane.jsx` | Modify | Add `wizardProcessing` state. Add `onProcessingChange` handler → set/unset. Pass `wizardActive={wizardProcessing}` to ResultPanel. |
| `components/WizardStepTasks.jsx` | Modify | Remove `send_email` checkbox and `Mail` icon import. |

## Interfaces / Contracts

```jsx
// NEW / CHANGED props:

WizardOnboarding:
  onWizardComplete: fn (existing)
  onProcessingChange?: (active: boolean) => void   // NEW

WizardResult:
  reply: string, pdfUrl?: string, onStartNew?: fn  // existing
  emailDefault?: string                             // NEW
  onSendEmail?: (email: string) => Promise<void>    // NEW
  emailStatus?: 'idle' | 'sending' | 'sent' | 'error' // NEW

ResultPanel:
  result, elapsedMs, stepsCount, steps               // existing
  wizardActive?: boolean                              // NEW
```

## Testing Strategy

| Layer | What | How |
|-------|------|-----|
| Unit | stepStatus() ✓ recognition | Add `"✓ done"` → returns `"done"` |
| Visual | ProgressSteps 4 patterns | Render fixture: `─── [1/4] full ───`, `🔗 Live: url`, `✓ done ⏱️ 1.2s`, plain text |
| Visual | ResultPanel 3 states | (false, null) → placeholder, (true, null) → generating, (false, result) → report |
| Integration | ChatPane wizardActive wiring | Mount ChatPane with mock WizardOnboarding, fire onProcessingChange, verify ResultPanel prop |
| Visual | Email input section | Render complete step, verify input + button + feedback render |

## Migration / Rollout

No migration. Feature-flag not needed — pure UI, self-contained in 3 files.

## Open Questions

- [ ] Confirm the API endpoint for post-completion email send: reuse `v1/chat/wizard` with `send_email`+`email` fields, or a dedicated endpoint?
- [ ] `clienteInfo` — does response include an `email` field to pre-fill? If not, input starts empty.
