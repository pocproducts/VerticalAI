# Tasks: Chat UI Wizard

## Review Workload Forecast

| Field | Value |
|-------|-------|
| Estimated changed lines | 400–470 |
| 400-line budget risk | Medium |
| Chained PRs recommended | No |
| Suggested split | Single PR (2 work units, same PR) |
| Delivery strategy | single-pr |
| Chain strategy | size-exception |

Decision needed before apply: Yes
Chained PRs recommended: No
Chain strategy: size-exception
400-line budget risk: Medium

### Suggested Work Units

| Unit | Goal | Likely PR | Notes |
|------|------|-----------|-------|
| 1 | Backend wizard endpoint + tests | PR 1 | `chat.py`, Pydantic models, SSE state machine; base = main |
| 2 | Frontend WizardOnboarding + tests | PR 1 | Components, api-client, ChatPane wiring; same PR — no behavioral coupling |

## Phase 1: Backend — Wizard Endpoint

- [x] 1.1 Add `WizardRequest` and `WizardTasks` Pydantic models to `fiscal_agent/api/routes/chat.py` (extra='forbid', CUIT str, task bools default True except iibb=False)
- [x] 1.2 Add `POST /v1/chat/wizard` endpoint with multi-turn state machine: `awaiting_cuit` → `awaiting_tasks` → `processing` → `complete` (state determined by request content — stateless approach per simplified instructions)
- [ ] 1.3 Implement Redis state persistence under `tenant:{tid}:wizard:{cid}` with 3600s TTL; expired state resets to `awaiting_cuit` — **not implemented: stateless approach used per simplified instructions**
- [x] 1.4 Implement SSE generator for `processing` state: reuse `asyncio.Queue` + `_procesar_cliente_pipeline()` with dynamic `with_*` flags from request tasks
- [x] 1.5 Wire `_completar_cliente_desde_padron()` for auto-discovery in `awaiting_tasks` state; return `cliente` info in response `data`
- [x] 1.6 Return error state (`wizard_state {state: "error"}`) on invalid CUIT, undiscovered client, or pipeline failure

## Phase 2: Frontend — WizardOnboarding Components

- [x] 2.1 Create `frontend/.../components/WizardStepCuit.jsx` — CUIT input (11-digit validation), disabled "Continuar" until valid, inline error on invalid format
- [x] 2.2 Create `frontend/.../components/WizardStepTasks.jsx` — client name display, 4 checkboxes (deuda, facilidades, registro, iibb) all enabled by default, "Generar reporte" button
- [x] 2.3 Create `frontend/.../components/WizardResult.jsx` — PDF download link from `complete` event data
- [x] 2.4 Create `frontend/.../components/WizardOnboarding.jsx` — local state machine (`cuit → tasks → processing → complete`), fetch for discovery + SSE via `sendWizard()`, renders sub-steps, passes `onWizardComplete(convId, reply)` callback
- [x] 2.5 Add `apiClient.sendWizard()` to `frontend/.../lib/api-client.js` — SSE method returning `{promise, abort}`, mirrors `sendMessageStream` pattern with `{cuit, tasks, conversation_id}` body
- [x] 2.6 Modify `frontend/.../components/ChatPane.jsx` — render `WizardOnboarding` when `messages.length === 0` instead of dashed-border empty state div
- [x] 2.7 Add minimal `onWizardComplete` callback to `frontend/.../hooks/useChat.js` — inserts assistant message with result reply into current conversation

## Phase 3: Testing

- [ ] 3.1 Backend unit: validate `WizardRequest` and `WizardTasks` Pydantic models (CUIT null, task defaults, extra fields rejected)
- [ ] 3.2 Backend integration: httpx SSE client tests for state transitions — null→awaiting_cuit, cuit→awaiting_tasks, full→processing→complete
- [ ] 3.3 Backend integration: verify pipeline flags match selected tasks (subset: deuda+facilidades only)
- [ ] 3.4 Frontend: unit test `WizardStepCuit` validation (11 digits required, error shown, button disabled)
- [ ] 3.5 Frontend: unit test `WizardStepTasks` — all checked by default, toggle individual, "Generar reporte" fires callback with correct payload
- [ ] 3.6 E2E: verify `POST /v1/chat/message` and `/v1/chat/message/stream` unchanged after wizard addition

## Phase 4: Cleanup

- [x] 4.1 Remove dashed-border empty state div from `ChatPane.jsx` (replaced by WizardOnboarding)
