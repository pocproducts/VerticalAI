# Proposal: Frontend Chat AI

## Intent

Conectar la UI de chat AI existente (v0 template con mock data) al backend fiscal-agent
para que los usuarios puedan consultar CUITs, deuda, facilidades, registro tributario,
calendario fiscal y generar reportes desde lenguaje natural — sin LLM externo.

## Scope

### In Scope
- Nuevo endpoint `POST /v1/chat/message` en el backend con intent router por regex
- Módulo `fiscal_agent/chat/` con intent router + response builder
- Frontend API client (`lib/api-client.js`) reemplazando `mockData.js`
- Frontend hook `useChat` para separar lógica de red de la UI
- Persistencia de conversaciones en LocalStorage
- Next.js `rewrites` para proxy API (evitar CORS)
- Docker Compose service para el frontend (puerto 3000)

### Out of Scope
- LLM / AI generation (queries estructuradas vía regex → endpoints existentes)
- TypeScript conversion de archivos `.jsx`
- User authentication / login system (API key fija vía proxy)
- WebSocket o streaming (síncrono en fase 1)
- Conversaciones persistentes en backend (LocalStorage en fase 1)

## Capabilities

### New
- `chat-backend`: Endpoint POST /v1/chat/message con intent routing + response builder
- `chat-frontend`: Chat UI conectada al backend con API client + persistence

### Modified
- `rest-api`: Nueva ruta /v1/chat/message en el spec

## Approach

### Backend

1. Crear `fiscal_agent/chat/__init__.py`, `intent_router.py`, `response_builder.py`
2. `intent_router.py`: regex mapping → detecta CUIT + intención (consulta, deuda, facilidades, calendario, reporte)
3. `response_builder.py`: toma datos estructurados (PadronA5Output, DeudaOutput, etc.) y genera texto en lenguaje natural
4. Crear `fiscal_agent/api/routes/chat.py` con `POST /v1/chat/message`
5. Handler ejecuta: parse intent → dispatch a función interna (reusa lógica de endpoints existentes) → formatea respuesta
6. Registra el router en `server.py`

### Frontend

7. Crear `lib/api-client.js` — fetch wrapper con auth header
8. Crear `hooks/useChat.js` — estado + llamadas a API + LocalStorage
9. Modificar `AIAssistantUI.jsx` — reemplazar setTimeout mock por useChat
10. `next.config.mjs` — agregar rewrites para `/api/*` → backend
11. `.env.local` — `NEXT_PUBLIC_API_URL`

### Infra

12. `docker-compose.yml` — agregar servicio frontend (puerto 3000, depends_on: fiscal-agent)

## Affected Areas

| Area | Impact | Description |
|------|--------|-------------|
| `fiscal_agent/chat/` | New | Módulo con intent_router.py + response_builder.py |
| `fiscal_agent/api/routes/chat.py` | New | POST /v1/chat/message endpoint |
| `fiscal_agent/api/server.py` | Modified | Registrar chat router |
| `frontend/chat/lib/api-client.js` | New | REST API client |
| `frontend/chat/hooks/useChat.js` | New | Chat state + API + persistence |
| `frontend/chat/components/AIAssistantUI.jsx` | Modified | Reemplazar mock data |
| `frontend/chat/next.config.mjs` | Modified | API rewrites |
| `frontend/chat/.env.local` | New | API URL + key |
| `docker-compose.yml` | Modified | Frontend service |

## Risks

| Risk | Likelihood | Mitigation |
|------|------------|------------|
| API key expuesta en bundle | Medium | Next.js rewrites proxy oculta la key del lado servidor |
| Regex matching frágil | Low | Suficiente para queries fiscales estructuradas con CUIT |
| LocalStorage loss | Low | Aceptable para Fase 1; export futuro |

## Rollback Plan

1. Eliminar `fiscal_agent/chat/` y `fiscal_agent/api/routes/chat.py`
2. Revertir `server.py` — sacar `chat.router`
3. Eliminar `frontend/chat/lib/` y `frontend/chat/hooks/`
4. Revertir `docker-compose.yml`
5. Revertir `next.config.mjs`

## Dependencies

- Endpoints REST existentes: taxpayer, extract, report, calendar, memory (reusados internamente)
- API key con scopes: `calendar:read`, `taxpayer:read`, `extract:read`, `memory:read`

## Success Criteria

- [ ] POST /v1/chat/message interpreta "consulta CUIT 20324837796" → devuelve datos del contribuyente
- [ ] POST /v1/chat/message interpreta "deuda de 20324837796" → devuelve resumen de deuda
- [ ] POST /v1/chat/message interpreta "calendario 202406 20324837796" → devuelve vencimientos
- [ ] POST /v1/chat/message interpreta "reporte completo 20324837796" → genera y devuelve reporte
- [ ] Frontend envía mensajes reales al backend y muestra respuestas
- [ ] Conversaciones persisten en LocalStorage al recargar página
- [ ] Frontend corre via `docker compose up` en puerto 3000
