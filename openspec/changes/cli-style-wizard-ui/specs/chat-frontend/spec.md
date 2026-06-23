# Delta for chat-frontend

## ADDED Requirements

### Requirement: Email Input (WizardOnboarding)

After the wizard completes (step `complete`), the system MUST render an email input section before the "Generar otro reporte" reset button. The section SHALL display a label "Enviar reporte por email", a text input for the email address, and an "Enviar" button. The input SHALL default to the email from the wizard result if available.

#### Scenario: Complete step shows email input

- GIVEN the wizard reaches the `complete` step
- WHEN the complete step renders
- THEN an "Enviar reporte por email" label is displayed above an email text input
- AND an "Enviar" button is visible next to the input
- AND the "Generar otro reporte" button appears after the email section

#### Scenario: Pre-filled email from wizard result

- GIVEN the wizard result contains an email address
- WHEN the complete step renders
- THEN the email input is pre-filled with the wizard result email
- AND the user MAY modify the email before sending

### Requirement: ProgressSteps CLI Format

The `ProgressSteps` component MUST render wizard progress matching the backend CLI format. `stepStatus()` MUST recognize `✓` (U+2713) as "done" status (not only `✅`). All lines MUST use `font-mono` and preserve a leading two-space indent.

#### Scenario: Checkmark recognized as done

- GIVEN a step message starts with `✓`
- WHEN `stepStatus()` evaluates the message
- THEN the step is classified as "done"
- AND timing text (`⏱️ X.Xs | 👣 N steps`) renders as part of the same line

#### Scenario: Separator lines styled dimmed and centered

- GIVEN a step message matches `─── [N/M] taskname ───`
- WHEN `ProgressSteps` renders the line
- THEN it appears dimmed and centered (e.g., `text-zinc-400/50 text-center`)

#### Scenario: Live URL rendered as clickable link

- GIVEN a step message starts with `🔗 Live:`
- WHEN `ProgressSteps` renders the line
- THEN the URL is rendered as a clickable `<a>` link (blue, underlined, `target="_blank"`)

#### Scenario: Two-space indent preserved

- GIVEN any progress line
- WHEN `ProgressSteps` renders it
- THEN a leading two-space indent (`\u00a0\u00a0`) is preserved

### Requirement: ChatPane wizardActive Prop

`ChatPane.jsx` MUST pass a `wizardActive` boolean prop to `ResultPanel`. `wizardActive` SHALL be `true` when the wizard has started but not yet completed, derived from `isThinking || step === 'processing'`.

#### Scenario: Wizard active during processing

- GIVEN the wizard has started and is in `processing` state
- WHEN `ChatPane` renders `ResultPanel`
- THEN `wizardActive` is `true`

#### Scenario: Wizard inactive at rest or complete

- GIVEN the wizard has not started OR has completed
- WHEN `ChatPane` renders `ResultPanel`
- THEN `wizardActive` is `false`

## MODIFIED Requirements

### Requirement: WizardOnboarding Component

(Previously: Step 3 reused `ProgressMessage` and rendered a PDF link. Now renders `ProgressSteps` with CLI format fidelity and includes email input in the complete step.)

#### Step 1 — CUIT input

(Unchanged — same as existing spec)

#### Step 2 — Task selection

(Unchanged — same as existing spec)

#### Step 3 — Progress and result

Upon receiving SSE from `processing` state, the component MUST:
- Render pipeline steps via `ProgressSteps` with CLI format: `✓` checkmark recognized as done, `───` separators centered and dimmed, `🔗 Live:` URLs as clickable links, all lines in `font-mono` with two-space indent
- On the `complete` SSE event, display the final result
- After the complete step, render the email input section before the "Generar otro reporte" reset button

### Requirement: ChatPane Integration

`ChatPane.jsx` MUST render `WizardOnboarding` instead of the current dashed-border empty state when `messages.length === 0`. Additionally, ChatPane MUST pass `wizardActive` to `ResultPanel`.
(Previously: ChatPane rendered WizardOnboarding but did not pass wizard state to ResultPanel.)

#### Scenario: Empty conversation shows wizard

(Unchanged — same as existing spec)

#### Scenario: Existing messages use normal flow

(Unchanged — same as existing spec)

#### Scenario: Text Composer remains accessible

(Unchanged — same as existing spec)
