# Tasks: Fase 2 — Platform Layer

## Review Workload Forecast

| Field | Value |
|-------|-------|
| Estimated changed lines | ~300-400 |
| 400-line budget risk | Medium |
| Chained PRs recommended | No |
| Suggested split | single PR |
| Delivery strategy | single-pr |
| Chain strategy | size-exception |

Decision needed before apply: No
Chained PRs recommended: No
Chain strategy: size-exception
400-line budget risk: Medium

### Suggested Work Units

| Unit | Goal | Likely PR | Notes |
|------|------|-----------|-------|
| 1 | In-memory store + seed | PR 1 | Base para auth y rate limiter |
| 2 | Auth middleware (ScopeRequired) | PR 1 | Depende de store |
| 3 | Rate limiter | PR 1 | Depende de store (Plan) |
| 4 | Admin endpoints | PR 1 | Dependen de store + auth |
| 5 | Wire en server.py + routes | PR 1 | Integración final |

## Phase 1: Data Store

- [x] 1.1 Crear `fiscal_agent/api/store.py` — dicts globales: `_developers`, `_apps`, `_api_keys`, `_plans`, `_key_hash`
- [x] 1.2 Implementar `seed_defaults()` — Plan Free (10 RPM, 100 RPD, scopes básicos), Developer admin, App admin, ApiKey admin
- [x] 1.3 Implementar `register_developer()`, `create_app()`, `create_api_key()`, `resolve_api_key()`, `list_developer_keys()`

## Phase 2: Auth Middleware

- [x] 2.1 Crear `fiscal_agent/api/auth.py` — `ScopeRequired` depende de `HTTPBearer`, valida Bearer token contra store
- [x] 2.2 Implementar resolución vía `store.resolve_api_key()` — pobla `request.state` con Developer, App, ApiKey, Plan
- [x] 2.3 Implementar verificación `api_key.is_active` + `scope in api_key.scopes`
- [x] 2.4 Manejar errores: 401 `UNAUTHORIZED`, 403 `API_KEY_INACTIVE`, 403 `INSUFFICIENT_SCOPE`

## Phase 3: Rate Limiter

- [x] 3.1 Crear `fiscal_agent/api/rate_limiter.py` — fixed-window con dict `_windows[api_key_id]`
- [x] 3.2 Implementar `check_rate_limit(api_key_id, plan)` — ventanas de 60s (RPM) y 86400s (RPD)
- [x] 3.3 Implementar headers: `Retry-After`, `X-RateLimit-Limit`, `X-RateLimit-Remaining`
- [x] 3.4 Manejar error 429 `RATE_LIMIT_EXCEEDED` con `UnifiedResponse`

## Phase 4: Admin Endpoints

- [x] 4.1 Crear `fiscal_agent/api/routes/admin.py` — `POST /v1/admin/register` (scope `admin:write`)
- [x] 4.2 Implementar `POST /v1/admin/apps` — crea App para developer autenticado
- [x] 4.3 Implementar `POST /v1/admin/keys` — genera API key, devuelve full key una sola vez
- [x] 4.4 Implementar `GET /v1/admin/keys` (solo `key_preview`) y `GET /v1/admin/me`

## Phase 5: Wire Everything

- [x] 5.1 Modificar `fiscal_agent/api/server.py` — llamar `seed_defaults()` en startup, incluir admin router, agregar ASGI rate-limit middleware
- [x] 5.2 Agregar `Depends(ScopeRequired(Scope.CALENDAR_READ))` a `POST /v1/calendar`
- [x] 5.3 Agregar `Depends(ScopeRequired(Scope.TAXPAYER_READ))` a `GET /v1/taxpayer/{cuit}` y `Depends(ScopeRequired(Scope.REPORT_WRITE))` a `POST /v1/report`
- [x] 5.4 Agregar `Depends(ScopeRequired(Scope.TAXPAYER_READ))` a `POST /v1/extract`
- [x] 5.5 `GET /v1/health` queda público (sin `Depends(ScopeRequired(...))`)
