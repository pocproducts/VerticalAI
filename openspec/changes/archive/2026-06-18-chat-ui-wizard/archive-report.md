# Archive Report

**Change**: chat-ui-wizard
**Date**: 2026-06-18
**Mode**: openspec

## What Was Implemented

Replicated the interactive CLI wizard (`python -m fiscal_agent report`) in the chat UI. Guides the user through CUIT input → task selection → pipeline execution (SSE) → PDF result display, all within the empty-state area of the chat pane.

### Backend
- **`POST /v1/chat/wizard`** endpoint with multi-turn state machine (`awaiting_cuit` → `awaiting_tasks` → `processing` → `complete`)
- **Pydantic models**: `WizardTasks`, `WizardRequest`, `WizardResponse`
- **SSE streaming** for `processing` state, reusing `asyncio.Queue` + `_procesar_cliente_pipeline()` with dynamic task flags
- **`_descubrir_cliente_desde_padron()`** helper for auto-discovery in `awaiting_tasks` state
- **Admin route bugfix**: Fixed SyntaxError in `admin.py` (moved `req: Request` before optional body)

### Frontend
- **`WizardOnboarding.jsx`** — local state machine (`cuit → tasks → processing → complete`), manages its own fetch independently of `useChat`
- **`WizardStepCuit.jsx`** — CUIT input with 11-digit validation and inline error display
- **`WizardStepTasks.jsx`** — 4 checkboxes (deuda, facilidades, registro, iibb), all checked by default except iibb=false
- **`WizardResult.jsx`** — PDF download link from `complete` event
- **`apiClient.sendWizard()`** — SSE method returning `{promise, abort}`
- **`ChatPane.jsx`** — renders `WizardOnboarding` when `messages.length === 0` or no conversation exists
- **`useChat.js`** — `onWizardComplete` callback fixes conversation ID mismatch, creates conversation if needed
- **`AIAssistantUI.jsx`** — wires `onWizardComplete` to `ChatPane`

### Fixes Applied During Verification
1. **CRITICAL**: Conversation ID mismatch in `onWizardComplete` — now uses `selectedId` (frontend ID) instead of backend UUID. Creates conversation if none exists.
2. **Edge case**: Empty localStorage (no conversations) — `ChatPane` now renders wizard even when `conversation` is null.

## Specs Synced

| Domain | Action | Details |
|--------|--------|---------|
| `chat-backend` | Updated | Appended `POST /v1/chat/wizard` requirement with state machine, SSE format, state persistence, reuse of existing logic, and 5 scenarios (full flow, CUIT inválido, cliente no descubierto, estado expirado, endpoints intactos) |
| `chat-frontend` | Updated | Modified "Conversation Persistence — Empty state" scenario to show `WizardOnboarding`; appended `WizardOnboarding Component` requirement (3 steps + 3 scenarios) and `ChatPane Integration` requirement (3 scenarios) |

## Delta Sync Notes

- **wizard-backend.md** → `openspec/specs/chat-backend/spec.md`: Non-destructive append — added `POST /v1/chat/wizard` as a new requirement at end of file. All existing requirements and scenarios preserved intact.
- **wizard-onboarding.md** → `openspec/specs/chat-frontend/spec.md`: Non-destructive update — modified one scenario in existing "Conversation Persistence" requirement (empty state now shows WizardOnboarding) and appended two new requirements (WizardOnboarding Component, ChatPane Integration). All existing requirements preserved intact.

## Verification Summary

- **Tasks**: 14/17 complete (Phases 1-2 and Phase 4 cleanup done; Phase 3 testing skipped — known/intentional)
- **Spec scenarios**: All delta spec scenarios compliant
- **Verdict**: PASS WITH WARNINGS
- **Critical issues**: None (both CRITICAL findings fixed: conversation ID mismatch, empty localStorage edge case)
- **Warnings**:
  1. No dedicated pytest tests (Phase 3 tasks 3.1-3.6) — intentional per user decision
  2. Redis state persistence (task 1.3) not implemented — stateless approach per simplified instructions

## Open Items

**SUGGESTIONS** (from verify report):
1. Consider adding Redis state persistence when multi-user scale requires it
2. Consider adding testing coverage for wizard SSE endpoint and component validation
3. Empty localStorage edge case is now handled but could benefit from a unit test on `ChatPane` render logic

## Archive Contents

| Artifact | Status |
|----------|--------|
| `proposal.md` | ✅ |
| `design.md` | ✅ |
| `tasks.md` | ✅ |
| `specs/wizard-backend.md` | ✅ |
| `specs/wizard-onboarding.md` | ✅ |
| `archive-report.md` | ✅ |

## Engram Traceability

| Observation | ID | Topic Key |
|-------------|----|-----------|
| Apply Progress | #885 | `sdd/chat-ui-wizard/apply-progress` |
| Tasks | #884 | `sdd/chat-ui-wizard/tasks` |
| Bugfix: conversation ID mismatch | #887 | `bugfix/wizard-conversation-id` |
| Bugfix: empty localStorage | #888 | `bugfix/wizard-empty-conversation` |
| Session Summary (Apply) | #886 | `session_summary` |

## Source of Truth Updated

The following main specs now reflect the new wizard behavior:

- `openspec/specs/chat-backend/spec.md` — `POST /v1/chat/wizard` requirement appended (304 lines total)
- `openspec/specs/chat-frontend/spec.md` — Empty state scenario updated + WizardOnboarding + ChatPane Integration requirements appended (230 lines total)

## SDD Cycle Complete

The change has been fully planned, designed, implemented, verified, and archived. Ready for the next change.
