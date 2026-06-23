# Delta for chat-frontend — Wizard Onboarding

## ADDED Requirements

### Requirement: WizardOnboarding Component

A new `WizardOnboarding` component MUST replace the text-based empty state when no conversation messages exist. The component SHALL manage its own local state independent of the `useChat` hook.

#### Step 1 — CUIT input

The component MUST render a text input for CUIT entry. The input MUST validate that the value is exactly 11 digits before allowing the user to proceed. A "Continuar" button SHALL be enabled only when validation passes. On submit, the component SHALL call `POST /v1/chat/wizard` with `{"cuit": "<digits>"}`.

#### Step 2 — Task selection

Upon receiving `state: "awaiting_tasks"` from the backend, the component MUST display:
- The discovered client name (from `data`)
- Four toggle/checkbox options for task extraction: **Deuda real**, **Planes de pago**, **Registro tributario**, **Jurisdicciones IIBB**
- All options SHALL be enabled (checked) by default
- A "Generar reporte" button SHALL call `POST /v1/chat/wizard` with `{"cuit": "<...>", "tasks": {...}}`

#### Step 3 — Progress and result

Upon receiving SSE from `processing` state, the component MUST:
- Reuse the existing `ProgressMessage` component to display pipeline steps
- Render the final result (PDF link) from the `complete` SSE event

#### Scenario: Flujo completo del wizard

- GIVEN no messages exist in the conversation
- WHEN the page loads
- THEN `WizardOnboarding` is displayed with a CUIT input and "Continuar" button
- WHEN the user enters "20324837796" and clicks "Continuar"
- THEN `POST /v1/chat/wizard` is called with `{"cuit": "20324837796"}`
- WHEN the backend returns `state: "awaiting_tasks"`
- THEN the component shows client info and 4 checkboxes (all checked) with "Generar reporte"
- WHEN the user unchecks "IIBB" and clicks "Generar reporte"
- THEN `POST /v1/chat/wizard` is called with `{"cuit": "20324837796", "tasks": {"deuda": true, "facilidades": true, "registro": true, "iibb": false}}`
- AND SSE events are rendered via `ProgressMessage`
- WHEN the `complete` SSE event arrives with `pdf_url`
- THEN the component displays the PDF link

#### Scenario: CUIT inválido

- GIVEN the wizard is in Step 1
- WHEN the user types "123" (not 11 digits)
- THEN the "Continuar" button MUST remain disabled
- AND an inline validation error SHALL be shown

#### Scenario: Error en descubrimiento de cliente

- GIVEN the user entered a valid-format CUIT
- WHEN `POST /v1/chat/wizard` returns `state: "awaiting_cuit"` again (cliente no encontrado)
- THEN the component SHALL show the error message from `reply` and allow the user to retry

### Requirement: ChatPane Integration

`ChatPane.jsx` MUST render `WizardOnboarding` instead of the current dashed-border empty state when `messages.length === 0`.

#### Scenario: Empty conversation shows wizard

- GIVEN a conversation with `messages.length === 0`
- WHEN `ChatPane` renders
- THEN `WizardOnboarding` is rendered in place of the dashed-border empty state div

#### Scenario: Existing messages use normal flow

- GIVEN a conversation with existing messages
- WHEN `ChatPane` renders
- THEN messages and `Composer` are shown as before, with no wizard visible

#### Scenario: Text Composer remains accessible

- GIVEN the wizard is displayed (empty state)
- WHEN the user types directly in the Composer below instead of using the wizard
- THEN the message is sent via the normal `POST /v1/chat/message` flow

## MODIFIED Requirements

### Requirement: Conversation Persistence — Empty state

(Previously: showed dashed-border div with "No hay mensajes todavía. Empezá una conversación.")

The system MUST show `WizardOnboarding` in place of the generic empty state text when no conversations exist in `localStorage`.

#### Scenario: Empty state with wizard

- GIVEN no conversations in `localStorage`
- WHEN the page loads
- THEN the UI shows `WizardOnboarding` instead of the plain text empty-state prompt

## REMOVED Requirements

None.
