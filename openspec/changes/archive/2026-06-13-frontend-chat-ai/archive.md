# Archive Report: frontend-chat-ai

**Archived**: 2026-06-13
**Change**: frontend-chat-ai
**Status**: ✅ Complete — all 15 tasks implemented, verified, and archived
**Verification**: PASS

## Summary

Conexión de la UI de chat AI existente (v0 template con mock data) al backend
fiscal-agent mediante un endpoint `POST /v1/chat/message` con intent routing
por regex, response builder en lenguaje natural, y frontend con API client,
useChat hook, persistencia LocalStorage y Docker Compose service.

## Capabilities Implemented

| Capability | Description | Status |
|------------|-------------|--------|
| `chat-backend` | `POST /v1/chat/message` con `IntentRouter.detect()` (CUIT regex + keyword intents), handlers internos reusando `consultar_cuit()`, `engine.get_vencimientos()`, `ComposioBrowser`, y `ResponseBuilder.format()` a lenguaje natural | ✅ |
| `chat-frontend` | API client (`lib/api-client.js`) → `POST /v1/chat/message`, `useChat` hook con loading/error/LocalStorage, Next.js rewrites proxy, Docker Compose service en puerto 3000 | ✅ |
| `rest-api` (modified) | Requirement 11 agregado: POST /v1/chat/message + escenarios | ✅ |

## Files Created

| File | Description |
|------|-------------|
| `fiscal_agent/chat/__init__.py` | `__all__` exports: `detect_intent`, `format_response` |
| `fiscal_agent/chat/intent_router.py` | `Intent` enum, `CUIT_REGEX`, `INTENT_MAP`, `detect(text) → (cuit, intent, params)` |
| `fiscal_agent/chat/response_builder.py` | `format_taxpayer()`, `format_deuda()`, `format_calendar()`, `format_facilidades()`, `format_registro()`, `format_reporte()` + `build_response(intent, data, error)` |
| `fiscal_agent/api/routes/chat.py` | `ChatRequest`/`ChatResponse` models, `POST /v1/chat/message`, handlers internos |
| `frontend/IdeaDashboardai-chatbot-interface-template/lib/api-client.js` | fetch wrapper con auth + timeout 20s |
| `frontend/IdeaDashboardai-chatbot-interface-template/hooks/useChat.js` | Chat state + API + LocalStorage persistence |
| `frontend/IdeaDashboardai-chatbot-interface-template/.env.local` | `NEXT_PUBLIC_API_URL=http://localhost:8000` |
| `frontend/IdeaDashboardai-chatbot-interface-template/Dockerfile` | Multi-stage Node.js build (deps, build, runner) |
| `fiscal_agent/tests/test_intent_router.py` | Parametrized tests: cada CUIT + intent + edge cases |
| `fiscal_agent/tests/test_response_builder.py` | Cada formatter con fixtures de modelos Pydantic |
| `fiscal_agent/tests/test_chat_api.py` | TestClient con POST /v1/chat/message, monkeypatch handlers |
| `openspec/specs/chat-backend/spec.md` | Main spec — Chat Backend (new domain) |
| `openspec/specs/chat-frontend/spec.md` | Main spec — Chat Frontend (updated with merged delta) |

## Files Modified

| File | Description |
|------|-------------|
| `fiscal_agent/api/server.py` | `app.include_router(chat.router, tags=['chat'])` |
| `frontend/IdeaDashboardai-chatbot-interface-template/components/AIAssistantUI.jsx` | Reemplazar setTimeout mock + mockData por useChat |
| `frontend/IdeaDashboardai-chatbot-interface-template/components/mockData.js` | `INITIAL_CONVERSATIONS` → `[]` (useChat carga de LS) |
| `frontend/IdeaDashboardai-chatbot-interface-template/next.config.mjs` | `async rewrites()` → source `/api/*` → backend |
| `docker-compose.yml` | Frontend service (puerto 3000, depends_on: fiscal-agent) |
| `openspec/specs/rest-api/spec.md` | Requirement 11 agregado: POST /v1/chat/message |
| `openspec/specs/chat-frontend/spec.md` | Merge delta: MODIFIED API Client + Conversation Persistence, ADDED useChat Hook + Environment Variables + Next.js API Rewrites, REMOVED Query Router |

## Architecture Decisions Applied

| AD | Decision |
|----|----------|
| AD 1 | Intent routing en backend (no frontend) — un solo endpoint reusable por CLI, MCP, otros frontends |
| AD 2 | Regex matching (fase 1) — queries fiscales estructuradas, cero latencia, sin dependencias externas |
| AD 3 | Síncrono (fase 1) — response builder genera texto corto <1KB, SSE innecesario |
| AD 4 | Next.js rewrites como proxy — oculta API key del bundle JS, evita CORS en backend |
| AD 5 | LocalStorage (fase 1) — sin sesiones de usuario ni auth, no hay tenant key |
| AD 6 | Formato `ChatResponse` propio (no UnifiedResponse) — `reply` + `actions_taken` no encajan en envelope genérico |

## Tests Added

| Test File | Scope |
|-----------|-------|
| `fiscal_agent/tests/test_intent_router.py` | `detect()` parametrized: cada combinación CUIT + intent + edge cases (sin CUIT, sin keywords, CUIT inválido, CUIT con guiones) |
| `fiscal_agent/tests/test_response_builder.py` | Cada formatter con fixtures de `PadronA5Output`, `DeudaOutput`, `RulesOutput`; escenarios: datos completos, parciales, error |
| `fiscal_agent/tests/test_chat_api.py` | `TestClient` con `POST /v1/chat/message`, monkeypatch handlers internos: consulta CUIT, deuda, calendario, facilidades, registro, reporte, sin CUIT, irreconocible, error backend |

## Specs Synced

| Domain | Action | Details |
|--------|--------|---------|
| `rest-api` | Updated | Requirement 11 (POST /v1/chat/message) agregado con tabla + 3 escenarios |
| `chat-backend` | Created | Main spec desde delta — 1 requirement, 9 scenarios (full spec copy) |
| `chat-frontend` | Updated | Delta merge: 2 MODIFIED, 3 ADDED, 1 REMOVED requirements |

## Delta Merge Summary

### rest-api (existing main spec)

Added Requirement 11 (POST /v1/chat/message) — new row in endpoints table,
requirement with 3 scenarios (happy path CUIT, happy path deuda, sin CUIT).
Exception to UnifiedResponse noted in Requirement 6 (cross-cutting).

### chat-backend (new domain)

Full spec copied to `openspec/specs/chat-backend/spec.md`. Defines
`POST /v1/chat/message` request/response format, intent routing table,
and 9 scenarios (consulta CUIT, deuda, calendario, facilidades, registro,
reporte, sin CUIT, irreconocible, error backend).

### chat-frontend (existing main spec)

- **MODIFIED API Client**: Changed from multi-endpoint keyword routing to
  single `POST /v1/chat/message`, timeout 15s → 20s, error handling from
  `UnifiedResponse.error` → surface error detail.
- **MODIFIED Conversation Persistence**: Changed from direct `setConversations`
  to useChat-based auto-save per message exchange.
- **ADDED useChat Hook**: Encapsulates send, history, loading/error state,
  LocalStorage persistence. 3 scenarios.
- **ADDED Environment Variables**: `NEXT_PUBLIC_API_URL`, `NEXT_PUBLIC_API_KEY`
  with defaults. 1 scenario.
- **ADDED Next.js API Rewrites**: `/api/*` → backend proxy. 1 scenario.
- **REMOVED Query Router**: Intent routing moves to chat-backend.

## Task Completion

| Phase | Tasks | Status |
|-------|-------|--------|
| Phase 1: Backend Chat Module | T-1 to T-5 | ✅ 5/5 |
| Phase 2: Frontend API Client | T-6 to T-10 | ✅ 5/5 |
| Phase 3: Infra + Docker | T-11 to T-12 | ✅ 2/2 |
| Phase 4: Tests | T-13 to T-15 | ✅ 3/3 |
| **Total** | **T-1 to T-15** | **✅ 15/15** |

## Archive Contents

```
openspec/changes/archive/2026-06-13-frontend-chat-ai/
├── proposal.md
├── design.md
├── tasks.md
├── archive.md
└── specs/
    ├── rest-api/
    │   └── spec.md          # Delta (ADDED Requirement 11)
    ├── chat-backend/
    │   └── spec.md          # Full spec
    └── chat-frontend/
        └── spec.md          # Delta (MODIFIED + ADDED + REMOVED)
```

## SDD Cycle Complete

The `frontend-chat-ai` change has been fully planned, proposed, specified,
designed, implemented, tested, verified, and archived.

## Próximos Pasos Sugeridos

1. **Auth scopes para chat**: Definir scope compuesto para `POST /v1/chat/message`
   (actualmente requiere `taxpayer:read` + `calendar:read` + `report:read` — ver
   Open Questions en design.md)
2. **SSE / streaming**: Agregar soporte SSE si se necesita mostrar progreso de
   pipeline o respuestas largas (diferido a fase 2)
3. **Persistencia backend**: Migrar conversaciones de LocalStorage a Redis/backend
   cuando se implemente auth de usuarios
4. **NLP/ML routing**: Si los patrones de query se vuelven demasiado complejos para
   regex, migrar a NLP ligero (mencionado en AD 2)
5. **TypeScript conversion**: Refactorizar archivos `.jsx` a TypeScript cuando el
   frontend madure
