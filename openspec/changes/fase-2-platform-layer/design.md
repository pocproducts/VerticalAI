# Design: Fase 2 — Platform Layer

## Technical Approach

Cuatro módulos nuevos + modificaciones mínimas a routes existentes. Los modelos tenant (`Developer`, `App`, `ApiKey`, `Plan`, `Scope`) ya viven en `fiscal_agent/models.py` — no se agregan tipos nuevos. La auth se resuelve vía FastAPI dependency injectable (`ScopeRequired`), el rate limiting como módulo funcional llamado desde un middleware ASGI, y el store como módulo con vars globales sin clase wrapper.

## Architecture Decisions

| Decision | Choice | Alternatives | Rationale |
|----------|--------|-------------|-----------|
| Store backend | In-memory `dict` module | SQLite, Redis, JSON file | Proposalscope explícitamente excluye BD. Seed regenerado en startup. F3 migra a Redis. |
| Auth mechanism | `HTTPBearer` + `ScopeRequired(scope)` dependency | ASGI middleware puro, decorator | Dependencies se componen con `Depends()`, son testables aisladamente, y `HTTPBearer` da zero‑boilerplate extraction. |
| Rate limit algorithm | Fixed window (60s / 86400s) | Sliding window, token bucket, leaky bucket | Simple, correcto para MVP. Todos los counters se resetear al reiniciar. F3 agrega Redis para sliding window. |
| API key transport | `Authorization: Bearer <key>` | `X-API-Key` header | Estándar industrial, compatible con OpenAPI docs auto‑auth. `HTTPBearer` lo resuelve sin boilerplate. |
| Seed strategy | `seed_defaults()` en startup | Script externo, lazy‑seed on first request | Garantiza que admin developer + Free plan existan siempre post‑restart. |
| Scope enforcement | FastAPI dependency por endpoint | Centralized middleware checking path | Cada endpoint declara su scope explícitamente. `health` queda público al no llevar `Depends()`. |

## Data Flow

```
                     ┌────────────────────────────────────────────┐
                     │            FastAPI Application             │
                     │                                            │
 Request ──►  server.py (router includes)                         │
                 │                                                │
           ┌─────┴─────┐                                         │
           │  health?   │──── Sí ──► handler (público)            │
           └─────┬─────┘                                         │
                 │ No                                            │
           ┌─────▼──────┐                                        │
           │  auth.py    │                                        │
           │  Bearer key?│──── No ──► 401                         │
           └─────┬───────┘                                       │
                 │ Sí                                            │
           ┌─────▼──────────┐                                    │
           │ store.resolve_ │──── Not found ──► 401              │
           │ api_key(key)   │                                    │
           └─────┬──────────┘                                    │
                 │ Found (populates request.state)               │
           ┌─────▼────────────────┐                              │
           │ rate_limiter.check() │──── Exceeded ──► 429         │
           └─────┬────────────────┘                              │
                 │ Under limit                                   │
           ┌─────▼──────────────┐                                │
           │ ScopeRequired()    │──── Missing scope ──► 403      │
           └─────┬──────────────┘                                │
                 │ Scope OK                                      │
           ┌─────▼────────────────┐                              │
           │ Route handler        │                              │
           │ → UnifiedResponse    │                              │
           └──────────────────────┘                              │
```

## File Changes

| File | Action | Description |
|------|--------|-------------|
| `fiscal_agent/api/store.py` | Create | In-memory store: dicts for developers, apps, api_keys, plans. `seed_defaults()`, `register_developer()`, `create_app()`, `create_api_key()`, `resolve_api_key()`, `list_developer_keys()`. |
| `fiscal_agent/api/auth.py` | Create | `HTTPBearer` security scheme + `ScopeRequired` FastAPI dependency class that extracts Bearer token, resolves via store, checks active + scope, and populates `request.state`. |
| `fiscal_agent/api/rate_limiter.py` | Create | Fixed-window limiter: `_windows[api_key_id] = {window_start, rpm_count, rpd_count}`. `check_rate_limit()` returns bool. ASGI middleware calls it per request. |
| `fiscal_agent/api/routes/admin.py` | Create | 5 endpoints: `POST /v1/admin/register`, `/apps`, `/keys`; `GET /v1/admin/keys`, `/admin/me`. Todos requieren scope `admin:write` o `admin:read`. |
| `fiscal_agent/api/server.py` | Modify | Import `seed_defaults`, call on startup event. Import and include admin router. Add rate‑limit ASGI middleware. |
| `fiscal_agent/api/routes/calendar.py` | Modify | Add `Depends(ScopeRequired(Scope.CALENDAR_READ))` to `POST /v1/calendar`. |
| `fiscal_agent/api/routes/report.py` | Modify | Add `Depends(ScopeRequired(Scope.TAXPAYER_READ))` to `GET /v1/taxpayer/{cuit}`. Add `Depends(ScopeRequired(Scope.REPORT_WRITE))` to `POST /v1/report`. |
| `fiscal_agent/api/routes/extract.py` | Modify | Add `Depends(ScopeRequired(Scope.TAXPAYER_READ))` to `POST /v1/extract`. |

## Interfaces / Contracts

```python
# store.py — API
def seed_defaults() -> None
def register_developer(name: str, email: str) -> Developer
def create_app(developer_id: str, name: str, environment: str) -> App
def create_api_key(app_id: str) -> tuple[ApiKey, str]  # (record, full_key)
def resolve_api_key(key: str) -> tuple[Developer, App, ApiKey, Plan] | None
def list_developer_keys(developer_id: str) -> list[ApiKey]

# auth.py — dependency
class ScopeRequired:
    def __init__(self, scope: Scope): ...
    async def __call__(self, request: Request, credentials: HTTPAuthorizationCredentials = Depends(security)) -> None

# rate_limiter.py — API
def check_rate_limit(api_key_id: str, plan: Plan) -> bool
```

`request.state` contract post‑auth: `.developer` (Developer), `.app` (App), `.api_key` (ApiKey), `.plan` (Plan).

## Testing Strategy

| Layer | What to Test | Approach |
|-------|-------------|----------|
| Unit | store operations (CRUD, resolve, duplicate email) | Plain pytest contra funciones del módulo |
| Unit | auth ScopeRequired (missing key, inactive, wrong scope) | Test `ScopeRequired.__call__` con `Request` mockeado |
| Unit | rate_limiter fixed‑window (under/over limit, window reset) | `time.time()` mock en `check_rate_limit()` |
| Unit | admin endpoints logic | Test store functions directamente |
| Integration | Full request flow (server startup → seed → auth → rate limit → route) | FastAPI `TestClient` con app real |

## Migration / Rollout

No migration required. Los endpoints Fase 1 existentes agregan `Depends(ScopeRequired(...))` — esto rompe compatibilidad con clients sin API key. **Breaking change coordinado**: clients deben actualizar a usar `Authorization: Bearer <key>` antes del deploy.

## Open Questions

Ninguna. Todos los modelos están definidos, el approach está mapeado spec‑por‑spec, y los patrones FastAPI están probados en el codebase existente.
