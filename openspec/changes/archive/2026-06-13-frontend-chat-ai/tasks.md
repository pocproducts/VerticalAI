# Tasks: Frontend Chat AI

## Review Workload Forecast

| Field | Value |
|-------|-------|
| Estimated changed lines | ~650-720 |
| 400-line budget risk | High |
| Chained PRs recommended | Yes |
| Suggested split | PR 1 (Phase 1) → PR 2 (Phase 4) + PR 3 (Phase 2 + 3) |
| Delivery strategy | ask-on-risk |
| Chain strategy | stacked-to-main |

Decision needed before apply: Yes
Chained PRs recommended: Yes
Chain strategy: stacked-to-main
400-line budget risk: High

### Suggested Work Units

| Unit | Goal | Likely PR | Notes |
|------|------|-----------|-------|
| 1 | Backend chat module + route (Phase 1) | PR 1 | Base: main. ~282 lines. Verifiable via curl sin frontend |
| 2 | Backend tests (Phase 4) | PR 2 | Base: main (after PR 1). ~210 lines. Tests Phase 1 endpoint |
| 3 | Frontend + Docker (Phase 2 + 3) | PR 3 | Base: main (after PR 1). ~197 lines. Depende de endpoint real |

## Phase 1: Backend Chat Module

- [x] T-1: Crear `fiscal_agent/chat/__init__.py` — `__all__` con `detect_intent`, `format_response`
- [x] T-2: Crear `fiscal_agent/chat/intent_router.py` — `Intent` enum, `CUIT_REGEX`, `INTENT_MAP`, `detect(text) → (cuit, intent, params)`
- [x] T-3: Crear `fiscal_agent/chat/response_builder.py` — `format_taxpayer()`, `format_deuda()`, `format_calendar()`, `format_facilidades()`, `format_registro()`, `format_reporte()` + `build_response(intent, data, error)`
- [x] T-4: Crear `fiscal_agent/api/routes/chat.py` — `ChatRequest`/`ChatResponse` models, `POST /v1/chat/message`, handlers internos que reusan `get_ta()`, `consultar_cuit()`, `engine.get_vencimientos()`, `ComposioBrowser`
- [x] T-5: Modificar `fiscal_agent/api/server.py` — `app.include_router(chat.router, tags=['chat'])`

## Phase 2: Frontend API Client

- [x] T-6: Crear `frontend/IdeaDashboardai-chatbot-interface-template/lib/api-client.js` — fetch wrapper con `NEXT_PUBLIC_API_URL` + `Authorization` header + timeout 20s + manejo de error
- [x] T-7: Crear `frontend/IdeaDashboardai-chatbot-interface-template/hooks/useChat.js` — `messages[]`, `loading`, `error`, `conversationId`, `sendMessage()`, `loadHistory()`, `newConversation()`, auto-save a LocalStorage tras cada exchange
- [x] T-8: Modificar `components/AIAssistantUI.jsx` — reemplazar `setTimeout` mock + `mockData.js` import por `useChat`, eliminar `INITIAL_CONVERSATIONS` mock
- [x] T-9: Modificar `next.config.mjs` — agregar `async rewrites()` → `source: '/api/:path*'`, `destination: 'http://fiscal-agent:8000/:path*'`
- [x] T-10: Crear `.env.local` — `NEXT_PUBLIC_API_URL=http://localhost:8000`

## Phase 3: Infra + Docker

- [x] T-11: Modificar `docker-compose.yml` — agregar servicio `frontend`: puerto 3000, `depends_on: fiscal-agent`, build context `frontend/IdeaDashboardai-chatbot-interface-template`, env vars
- [x] T-12: Crear `Dockerfile` en `frontend/IdeaDashboardai-chatbot-interface-template/` — multi-stage Node.js build (deps, build, runner con `next start`)

## Phase 4: Tests

- [x] T-13: Crear `fiscal_agent/tests/test_intent_router.py` — `pytest.mark.parametrize` con cada combinación CUIT + intent + edge cases (sin CUIT, sin keywords, CUIT inválido, CUIT con guiones)
- [x] T-14: Crear `fiscal_agent/tests/test_response_builder.py` — cada formatter con fixtures de `PadronA5Output`, `DeudaOutput`, `RulesOutput`; escenarios: datos completos, datos parciales, error
- [x] T-15: Crear `fiscal_agent/tests/test_chat_api.py` — `TestClient` con `POST /v1/chat/message`, monkeypatch handlers internos, verificar spec scenarios: consulta CUIT, deuda, calendario, facilidades, registro, reporte, sin CUIT, irreconocible, error backend
