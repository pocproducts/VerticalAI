# Proposal: Fase 2 — Platform Layer

## Intent

Construir capa de plataforma sobre API existente: auth por API key, scopes, rate limiting, admin endpoints. Convierte API de abierta a plataforma con tenants (Feature02).

## Scope

### In Scope
- API Key auth middleware — valida `X-API-Key`, resuelve Developer+App+Plan+Scopes
- Scope enforcement — dependency `require_scope()` por endpoint
- Rate limiting in-memory — fixed window por API key, configurable desde Plan
- Admin endpoints: `POST /v1/admin/register`, `POST /v1/admin/apps`, `POST /v1/admin/keys`, `GET /v1/admin/keys`, `GET /v1/admin/me`
- Error codes: 401, 403, 429 con headers estándar
- In-memory store con seed data (developers, apps, keys, plans)

### Out of Scope
BD persistente, UI web, dashboard, billing, MCP Server (F3), tests

## Capabilities

### New
- `api-auth`: API key auth middleware + scope enforcement
- `rate-limiting`: Rate limiting in-memory por API key y plan
- `admin-api`: Admin endpoints para developers (register, apps, keys, me)

### Modified
- `rest-api`: Endpoints existentes requieren auth + scope verification

## Approach

1. `fiscal_agent/api/store.py` — in-memory store + seed
2. `fiscal_agent/api/auth.py` — middleware API key + `require_scope()` dependency
3. `fiscal_agent/api/rate_limiter.py` — ASGI middleware fixed-window
4. `fiscal_agent/api/routes/admin.py` — 5 admin endpoints
5. `fiscal_agent/api/server.py` — registrar middleware + seed
6. Routes calendar/report/extract — agregar `require_scope()`

## Affected Areas

| Area | Impact |
|------|--------|
| `fiscal_agent/api/auth.py` | New |
| `fiscal_agent/api/rate_limiter.py` | New |
| `fiscal_agent/api/store.py` | New |
| `fiscal_agent/api/routes/admin.py` | New |
| `fiscal_agent/api/server.py` | Modified |
| `fiscal_agent/api/routes/calendar.py` | Modified |
| `fiscal_agent/api/routes/report.py` | Modified |
| `fiscal_agent/api/routes/extract.py` | Modified |

## Risks

| Risk | Likelihood | Mitigation |
|------|------------|------------|
| In-memory store perdido al reiniciar | High | Seed recreado. BD en fase posterior |
| Rate limiter no escala horizontal | Medium | Aceptado para MVP. Redis en F3 |

## Rollback Plan

1. Revertir `server.py` a versión sin middleware
2. Remover `auth.py`, `rate_limiter.py`, `store.py`, `routes/admin.py`
3. Restaurar routes originales (sin `require_scope()`)
4. Verificar endpoints existentes sin auth

## Dependencies

- Modelos tenant en `fiscal_agent/models.py` (Fase 0)
- `openspec/specs/tenant-identity/spec.md` — contrato de datos
- `openspec/specs/rest-api/spec.md` — endpoints a modificar

## Success Criteria

- [ ] Endpoint sin API key → 401
- [ ] API key sin scope → 403
- [ ] API key + scope correcto → 200
- [ ] Exceder rate limit → 429 con `X-RateLimit-*` headers
- [ ] Admin endpoints funcionales: register, app, key gen, list, me
- [ ] Endpoints Fase 1 operan con auth opcional en modo development
