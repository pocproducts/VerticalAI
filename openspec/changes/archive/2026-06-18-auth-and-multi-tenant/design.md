# Design: Auth + Hardening + Multi-tenant

> Phase 1 hardening + ADR-002 Sprint 2 — single PR.
> Builds on existing `RedisStore`, `check_rate_limit()`, and the tenant-identity
> model layer defined in `openspec/specs/tenant-identity/spec.md`.

---

## 1. Architecture Overview

### 1.1 Components and Their Connections

```
┌─────────────────────────────────────────────────────────────────────────┐
│                           FastAPI Application                           │
│                                                                         │
│  ┌─────────────────┐    ┌──────────────┐    ┌───────────────────────┐  │
│  │  RequestMetrics  │───▶│ AuthMiddleware│───▶│ TenantContextMiddleware│  │
│  │  (existing)      │    │  (new)       │    │  (new)                │  │
│  └─────────────────┘    └──────┬───────┘    └─────────┬─────────────┘  │
│                                │                      │                 │
│  ┌──────────────────┐          │                      │                 │
│  │ RateLimitMiddleware│◀────────┘──────────────────────┘                 │
│  │ (new)            │                                                    │
│  └────────┬─────────┘                                                    │
│           │                                                              │
│  ┌────────▼─────────┐    ┌────────────────┐    ┌──────────────────┐     │
│  │   Route Handler  │───▶│  RedisStore    │───▶│    TenantStore   │     │
│  │  (existing)      │    │  (existing)    │    │    (new in       │     │
│  └──────────────────┘    │  + methods     │    │     store.py)    │     │
│                          └────────┬───────┘    └────────┬─────────┘     │
│                                   │                     │               │
│                          ┌────────▼─────────────────────▼────────┐      │
│                          │           Redis (shared)              │      │
│                          │  tenant:keyhash:{hash}                │      │
│                          │  tenant:apikey:{id}                   │      │
│                          │  tenant:app:{id}                      │      │
│                          │  tenant:developer:{id}                │      │
│                          │  tenant:plan:{id}                     │      │
│                          │  tenant:tenant:{id}  ← NEW            │      │
│                          │  ratelimit:{key}:minute               │      │
│                          │  ratelimit:{key}:day                  │      │
│                          └───────────────────────────────────────┘      │
│                                                                         │
│  ┌──────────────────────────────────────────────────────────────┐      │
│  │  ComposioBrowser (updated — optional tenant param)           │      │
│  │  Uses tenant.cuit / tenant.clave_fiscal when tenant provided  │      │
│  └──────────────────────────────────────────────────────────────┘      │
└─────────────────────────────────────────────────────────────────────────┘
```

### 1.2 Data Flow Summary

```
Client → CORS → Metrics → Auth (401/403) → TenantContext → RateLimit (429) → Route
                                                                                │
         ◄──── UnifiedResponse JSON ───────────────────────────────────────────┘
```

Every request flows through the middleware chain in **fixed order**:

1. **CORSMiddleware** (Starlette) — validates origin against `CORS_ORIGINS`
2. **RequestMetricsMiddleware** (existing) — records count/latency per endpoint
3. **AuthMiddleware** (new) — extracts Bearer token, resolves full entity chain,
   injects `request.state.{developer, app, api_key, plan, tenant}`, returns 401/403
   before any handler runs
4. **TenantContextMiddleware** (new) — reads `api_key.tenant_id`, fetches `Tenant`
   from `TenantStore`, injects `request.state.tenant`
5. **RateLimitMiddleware** (new) — reads `plan` from state, calls
   `check_rate_limit()`, returns 429 with headers if exceeded
6. **Route handler** — receives populated `request.state`, executes business logic

---

## 2. Middleware Chain — Detailed Order

### 2.1 Chain Order (definitive)

```
  Order │ Middleware              │ Key Responsibility
  ──────┼─────────────────────────┼──────────────────────────────────────────
    1   │ CORSMiddleware          │ Validate origin, add CORS headers
    2   │ RequestMetricsMiddleware│ Record count/latency per endpoint
    3   │ AuthMiddleware          │ Extract Bearer → SHA-256 → Redis lookup
        │                         │ → resolve key→app→dev→plan → inject state
    4   │ TenantContextMiddleware  │ Read api_key.tenant_id → fetch Tenant
        │                         │ → inject request.state.tenant
    5   │ RateLimitMiddleware     │ Call check_rate_limit() → 429 or pass
    6   │ Route Handler           │ Use request.state.{developer, app,
        │                         │   api_key, plan, tenant}
```

**Rationale**:
- Auth MUST run before TenantContext (needs `api_key.tenant_id`)
- Auth MUST run before RateLimit (needs `plan` for limits)
- Metrics MUST run first (captures ALL requests including 401s)
- CORS MUST run before everything (otherwise preflight fails)
- TenantContext is **non-blocking** — if no tenant_id, it sets `state.tenant=None`
  and passes through. It NEVER returns an error.

### 2.2 Middleware Placement in server.py (excerpt)

```python
# Order matters — add from outermost to innermost:
app.add_middleware(CORSMiddleware, ...)                    # 1
app.add_middleware(RequestMetricsMiddleware, ...)          # 2
app.add_middleware(AuthMiddleware)                         # 3
app.add_middleware(TenantContextMiddleware)                # 4
app.add_middleware(RateLimitMiddleware)                    # 5
```

FastAPI's `add_middleware` wraps inside-out (last added runs first in request
path). But the spec order is `Metrics → Auth → Tenant → RateLimit → Route`,
which is the natural FastAPI order when added as shown.

---

## 3. Auth Middleware — Data Flow

### 3.1 Complete Auth Resolution Chain

```
┌─────────────┐     ┌──────────────┐     ┌──────────────────┐
│  Request     │     │  Extract Key │     │  SHA-256 Hash    │
│  Headers     │────▶│              │────▶│                  │
│              │     │  Bearer >    │     │  hashlib.sha256( │
│ Authorization│     │  X-API-Key   │     │    raw.encode()  │
│ X-API-Key    │     │              │     │  ).hexdigest()   │
└──────────────┘     └──────────────┘     └────────┬─────────┘
                                                    │
                                                    ▼
┌─────────────────────────────────────────────────────────────────────────┐
│                     Redis Lookup Chain                                  │
│                                                                         │
│  1. GET tenant:keyhash:{hash}           ───▶  api_key_id  (or None→401) │
│  2. HGETALL tenant:apikey:{api_key_id}  ───▶  ApiKey model              │
│     → check is_active (False→403 API_KEY_INACTIVE)                      │
│  3. HGETALL tenant:app:{api_key.app_id} ───▶  App model                 │
│     → check status (suspended→403 APP_SUSPENDED)                        │
│  4. HGETALL tenant:developer:{app.developer_id} ───▶  Developer model   │
│     → check is_active (False→403 DEVELOPER_INACTIVE)                    │
│  5. Scan tenant:plan:*                    ───▶  Plan model              │
│     → match scopes via store._resolve_plan(api_key.scopes)              │
│                                                                         │
└─────────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
┌─────────────────────────────────────────────────────────────────────────┐
│                    State Injection                                       │
│                                                                         │
│  request.state.developer = Developer(id=..., name=..., ...)             │
│  request.state.app       = App(id=..., developer_id=..., ...)           │
│  request.state.api_key   = ApiKey(id=..., app_id=..., ...)              │
│  request.state.plan      = Plan(id=..., scopes=[...], ...)              │
│  request.state.tenant    = None  (← TenantContext fills this)           │
│                                                                         │
└─────────────────────────────────────────────────────────────────────────┘
```

### 3.2 Error Code Reference

| Condition | HTTP | `error.code` |
|-----------|------|-------------|
| No `Authorization` header + no `X-API-Key` | 401 | `UNAUTHORIZED` |
| Hash not found in Redis (invalid/unknown key) | 401 | `UNAUTHORIZED` |
| Wrong auth scheme (e.g. `Basic`) | 401 | `UNAUTHORIZED` |
| ApiKey found but `is_active=False` | 403 | `API_KEY_INACTIVE` |
| ApiKey found but App doesn't exist | 403 | `API_KEY_INVALID` |
| App found but `status="suspended"` | 403 | `APP_SUSPENDED` |
| Developer found but `is_active=False` | 403 | `DEVELOPER_INACTIVE` |
| Missing scope for admin endpoint | 403 | `INSUFFICIENT_SCOPE` |

### 3.3 Public Path Bypass

The following paths bypass auth entirely (allow-list):

```
GET /v1/health
POST /v1/admin/register
```

These paths reach the handler without setting `request.state` — the handler
and subsequent middleware check for `None` before accessing state.

### 3.4 Dual Header Support (Transition)

During the transition period, the middleware accepts BOTH:

1. `Authorization: Bearer fa_abc...` (preferred)
2. `X-API-Key: fa_abc...` (legacy, will be removed next release)

When **both** are present, `Authorization: Bearer` takes priority.

Goal: allow existing integrators to migrate without a coordinated cutover.

---

## 4. Tenant Resolution

### 4.1 Resolution Strategy

```
  ApiKey
    │
    ├── tenant_id = "tnt_01"  ────▶  TenantStore.get("tnt_01")  ──▶  Tenant
    │                                (primary — direct field lookup)
    │
    └── tenant_id = None      ────▶  request.state.tenant = None
                                     (no-op — no tenant binding)
```

**Strategy**: The `ApiKey` model gains an optional `tenant_id: str | None`
field. The `TenantContextMiddleware` reads this field directly — no separate
developer→tenant index needed for the initial implementation.

This is the simplest path: zero extra indexes, zero extra writes during key
creation. The `tenant_id` is set at key-creation time (or retroactively via
admin API).

If a future use case requires binding tenants to developers (not keys), a
`tenant:developer_tenant:{developer_id}` index can be added later.

### 4.2 Tenant Model (Pydantic)

New model in `models.py`:

```python
class PlanTier(str, Enum):
    free = 'free'
    pro = 'pro'
    enterprise = 'enterprise'

class Tenant(BaseModel):
    id: str
    name: str
    plan_tier: PlanTier = PlanTier.free
    cuit: str
    clave_fiscal: str
    certificados: list[str] = []
    clientes: list[dict] = []
    provincias: list[str] = []
    is_active: bool = True
```

### 4.3 ApiKey Model Update

One new optional field:

```python
class ApiKey(BaseModel):
    # ... existing fields ...
    tenant_id: str | None = None  # NEW
```

### 4.4 TenantStore — Redis Schema

New key prefixes in `store.py`:

| Key Pattern | Type | Purpose |
|-------------|------|---------|
| `tenant:tenant:{id}` | Hash | Tenant fields (JSON-serialized per value) |
| `tenant:tenant:by_cuit:{cuit}` | String | Index: CUIT → tenant ID |
| `tenant:tenant:all` | Set | Set of all tenant IDs |

**Methods** (`TenantStore`, same Redis client, same serialization helpers):

| Method | Signature | Description |
|--------|-----------|-------------|
| `create` | `(tenant: Tenant) -> Tenant` | Store hash, CUIT index, add to all set |
| `get` | `(id: str) -> Tenant \| None` | HGETALL → deserialize |
| `get_by_cuit` | `(cuit: str) -> Tenant \| None` | Index → get |
| `list_all` | `() -> list[Tenant]` | SMEMBERS all → get each |
| `update` | `(id: str, updates: dict) -> None` | HSET individual fields |
| `delete` | `(id: str) -> None` | Remove hash, index, all set |
| `seed_defaults` | `() -> None` | Create Tenant 1 from .env + clients.yaml |

### 4.5 TenantContextMiddleware

```python
class TenantContextMiddleware(BaseHTTPMiddleware):
    """Resolves tenant from api_key.tenant_id after auth."""

    async def dispatch(self, request, call_next):
        api_key = getattr(request.state, 'api_key', None)
        request.state.tenant = None   # default

        if api_key is not None and api_key.tenant_id is not None:
            store: RedisStore = request.app.state.store
            tenant_data = await store.redis.hgetall(
                f'tenant:tenant:{api_key.tenant_id}'
            )
            if tenant_data:
                request.state.tenant = RedisStore._deserialize(Tenant, tenant_data)

        return await call_next(request)
```

**Key behaviors**:
- Runs AFTER auth (needs `request.state.api_key`)
- NEVER returns an error — silently sets `tenant=None` and passes through
- Skips if `api_key.tenant_id` is `None` (backward compatible with existing keys)
- Skips if `request.state.api_key` is `None` (unauthenticated request — health, register)

---

## 5. Seed Migration — Estudio 1 → Tenant 1

### 5.1 What Happens at Startup

```
server.py lifespan
    │
    ├── 1. RedisStore.seed_defaults()     (existing — creates plans + admin dev)
    │
    └── 2. TenantStore.seed_defaults()    (NEW)
              │
              ├── Check if any tenant exists (idempotent)
              │     └── SMEMBERS tenant:tenant:all → if non-empty, return
              │
              ├── Read ESTUDIO_CUIT, ESTUDIO_CLAVE_FISCAL from AppSettings
              │
              ├── Try to read clients.yaml
              │     ├── Load clientes list
              │     └── Extract unique provincias from clientes[*].provincias
              │
              └── Create Tenant 1:
                    id          = generated (12 hex chars)
                    name        = "Estudio Contable"
                    plan_tier   = "free"
                    cuit        = ESTUDIO_CUIT
                    clave_fiscal = ESTUDIO_CLAVE_FISCAL
                    clientes    = from clients.yaml (or [])
                    provincias  = extracted from clientes (or [])
                    is_active   = True
```

### 5.2 Data Sources

| Tenant Field | Source |
|-------------|--------|
| `id` | Auto-generated (`uuid.uuid4().hex[:12]`) |
| `name` | Hardcoded `"Estudio Contable"` |
| `plan_tier` | `"free"` (default, upgrade via admin API later) |
| `cuit` | `.env` → `AppSettings.cuit` (`ESTUDIO_CUIT`) |
| `clave_fiscal` | `.env` → `AppSettings.clave_fiscal` (`ESTUDIO_CLAVE_FISCAL`) |
| `clientes` | `clients.yaml` → `AppConfig.clientes` (list of dicts) |
| `provincias` | Extracted from `clientes[*].provincias` (unique, flattened) |

### 5.3 Idempotency

`TenantStore.seed_defaults()` checks `SMEMBERS tenant:tenant:all` before
creating. If any tenants exist, it returns immediately. This means:
- **First start**: seeds Tenant 1, admin dev, plans
- **Restart with Redis data**: skips seed (existing data preserved)
- **Restart with Redis reset**: seeds again (fresh state)

### 5.4 Linking Tenant 1 to Admin Developer

After seeding, the admin developer's API keys do NOT have `tenant_id` set by
default. An admin MUST explicitly bind the developer/key to Tenant 1 via:

```
POST /v1/admin/tenants/{tenant_id}/bind
```

Payload: `{"developer_id": "dev_01"}` or `{"api_key_id": "key_01"}`

This sets `tenant_id` on the ApiKey record in Redis. This is intentional —
we don't auto-bind existing keys to avoid unexpected tenant scoping.

Alternatively, the admin can create new keys with `tenant_id` via the admin API
or the `POST /v1/admin/keys` endpoint (future: accept `tenant_id` in body).

---

## 6. Full Request Sequence Diagram

### 6.1 Authenticated Request — Happy Path

```
Client                  FastAPI              Redis
  │                        │                   │
  │  GET /v1/report/20324837796                │
  │  Authorization: Bearer fa_abc...           │
  │                        │                   │
  │───────────────────────▶│                   │
  │                        │                   │
  │                  ┌─────┴─────┐             │
  │                  │ CORS      │ Allow origin│
  │                  │ check     │────────     │
  │                  └─────┬─────┘             │
  │                        │                   │
  │                  ┌─────┴─────┐             │
  │                  │ Metrics   │ Record req   │
  │                  └─────┬─────┘             │
  │                        │                   │
  │                  ┌─────┴─────┐             │
  │                  │ Auth      │ Extract      │
  │                  │ Middleware│ Bearer token │
  │                  │           │             │
  │                  │           │ SHA-256     │
  │                  │           │─────────────│────▶ GET tenant:keyhash:{hash}
  │                  │           │◀────────────│──── api_key_id
  │                  │           │             │
  │                  │           │─────────────│────▶ HGETALL tenant:apikey:{id}
  │                  │           │◀────────────│──── ApiKey (is_active=True)
  │                  │           │             │
  │                  │           │─────────────│────▶ HGETALL tenant:app:{app_id}
  │                  │           │◀────────────│──── App (status=active)
  │                  │           │             │
  │                  │           │─────────────│────▶ HGETALL tenant:developer:{id}
  │                  │           │◀────────────│──── Developer (is_active=True)
  │                  │           │             │
  │                  │           │─────────────│────▶ SCAN tenant:plan:* → match
  │                  │           │◀────────────│──── Plan
  │                  │           │             │
  │                  │           │ Inject      │
  │                  │           │ state: dev, │
  │                  │           │ app, key,   │
  │                  │           │ plan, tenant │
  │                  └─────┬─────┘             │
  │                        │                   │
  │                  ┌─────┴─────┐             │
  │                  │ Tenant    │ Read         │
  │                  │ Context   │ api_key.     │
  │                  │           │ tenant_id    │
  │                  │           │─────────────│────▶ HGETALL tenant:tenant:{id}
  │                  │           │◀────────────│──── Tenant
  │                  │           │ Inject       │
  │                  │           │ state.tenant │
  │                  └─────┬─────┘             │
  │                        │                   │
  │                  ┌─────┴─────┐             │
  │                  │ RateLimit │ Read plan    │
  │                  │           │              │
  │                  │           │─────────────│────▶ ZCARD/ZADD for sliding window
  │                  │           │◀────────────│──── {allowed, remaining, ...}
  │                  │           │ allowed=true │
  │                  │           │ Add headers  │
  │                  └─────┬─────┘             │
  │                        │                   │
  │                  ┌─────┴─────┐             │
  │                  │ Route     │ Use state    │
  │                  │ Handler   │ to execute   │
  │                  │           │ business     │
  │                  │           │ logic        │
  │                  └─────┬─────┘             │
  │                        │                   │
  │  ◄─────────────────────│                   │
  │  200 OK + UnifiedResponse                  │
  │  X-RateLimit-Limit: 100                    │
  │  X-RateLimit-Remaining: 99                 │
```

### 6.2 Unauthenticated Request — 401 Fast Path

```
Client                  FastAPI
  │                        │
  │  GET /v1/report/...    │ (no Authorization header)
  │───────────────────────▶│
  │                  ┌─────┴─────┐
  │                  │ CORS      │✓
  │                  ├───────────┤
  │                  │ Metrics   │ Record 401
  │                  ├───────────┤
  │                  │ Auth      │ Missing header → return 401 JSON
  │                  │ Middleware│ (rate limiter / handler NEVER execute)
  │                  └─────┬─────┘
  │                        │
  │  ◄─────────────────────│
  │  401 Unauthorized
  │  {"status":"error","error":{"code":"UNAUTHORIZED",...}}
```

### 6.3 Rate Limited Request — 429 Fast Path

```
Client                  FastAPI                    Redis
  │                        │                         │
  │  GET /v1/report/...    │ (key with 10/10 RPM)    │
  │───────────────────────▶│                         │
  │                  ┌─────┴─────┐                   │
  │                  │ Auth ✓    │ (valid key)        │
  │                  ├───────────┤                   │
  │                  │ Tenant ✓  │ (pass through)     │
  │                  ├───────────┤                   │
  │                  │ RateLimit │ check_rate_limit() │
  │                  │           │───────────────────│──▶ ZCARD = 10 ≥ RPM
  │                  │           │◀──────────────────│── {allowed: false, ...}
  │                  │           │ return 429 JSON    │
  │                  └─────┬─────┘                   │
  │                        │                         │
  │  ◄─────────────────────│                         │
  │  429 Too Many Requests
  │  Retry-After: 45
  │  X-RateLimit-Limit: 10
  │  X-RateLimit-Remaining: 0
  │  {"status":"error","error":{"code":"RATE_LIMIT_EXCEEDED",...}}
```

---

## 7. File Manifest & Changes

### 7.1 Models Layer

| File | Change | Details |
|------|--------|---------|
| `fiscal_agent/models.py` | **Update** | Add `Tenant`, `PlanTier` models. Add `tenant_id: str \| None = None` to `ApiKey`. |

### 7.2 Store Layer

| File | Change | Details |
|------|--------|---------|
| `fiscal_agent/api/store.py` | **Update** | Add key prefixes `_KEY_TENANT`, `_KEY_TENANT_BY_CUIT`, `_KEY_TENANT_ALL`. Add `TenantStore` class with CRUD + `seed_defaults()`. TenantStore reuses `RedisStore._serialize_for_redis` and `RedisStore._deserialize_from_redis` static methods. |

### 7.3 Middleware Layer

| File | Change | Details |
|------|--------|---------|
| `fiscal_agent/api/middleware/auth.py` | **New** | `AuthMiddleware(BaseHTTPMiddleware)`. Extracts Bearer/X-API-Key, SHA-256 lookup via `RedisStore._hash_key()`, resolves chain via `request.app.state.redis` and `RedisStore._deserialize()`, injects state, returns 401/403 JSON. |
| `fiscal_agent/api/middleware/tenant.py` | **New** | `TenantContextMiddleware(BaseHTTPMiddleware)`. Reads `api_key.tenant_id`, fetches `Tenant` from Redis, injects `request.state.tenant`. Non-blocking — never errors. |
| `fiscal_agent/api/middleware/rate_limit.py` | **New** | `RateLimitMiddleware(BaseHTTPMiddleware)`. Calls `check_rate_limit(redis, api_key.id, plan)`, returns 429 + headers or passes through with rate-limit headers. |
| `fiscal_agent/api/middleware/__init__.py` | **Update** | Export `AuthMiddleware`, `TenantContextMiddleware`, `RateLimitMiddleware`. |

### 7.4 API Layer

| File | Change | Details |
|------|--------|---------|
| `fiscal_agent/api/server.py` | **Update** | Wire middleware in correct order. Instantiate `TenantStore(redis)` and call `tenant_store.seed_defaults()` during lifespan. Replace hardcoded CORS `allow_origins` with `get_settings().cors_origins`. |
| `fiscal_agent/api/routes/admin.py` | **Update** | Re-enable `/v1/admin/me` (reads `request.state.developer`), `/v1/admin/keys` GET (lists from `request.state.developer`). Update `/v1/admin/apps` to use `request.state.developer.id`. Update `/v1/admin/register` to auto-provision Developer + App + ApiKey. Add `GET /v1/admin/tenants` (admin:read), `POST /v1/admin/tenants` (admin:write), `POST /v1/admin/register` → returns `{developer, app, api_key, full_key}`. Add `require_scope` dependency. |
| `fiscal_agent/config.py` | **Update** | Add `cors_origins: list[str]` field reading from `CORS_ORIGINS` env var (comma-separated, default `["http://localhost:3000", "http://localhost:3001"]`). |
| `fiscal_agent/browser/composio.py` | **Update** | Add optional `tenant: Tenant \| None = None` parameter to `__init__`. When provided, use `tenant.cuit` and `tenant.clave_fiscal` in `_run_single()` tasks (for instruction template placeholders and `secrets` dict). When not provided, fall back to existing `self._estudio_cuit` / `self._estudio_clave`. |

### 7.5 Configuration & Deployment

| File | Change | Details |
|------|--------|---------|
| `.env.prod` | **New** | Production environment template with all required vars (CUIT, clave, Composio, CORS, Redis, SMTP, Engram). |
| `docker-compose.prod.yml` | **Update** | Add `CORS_ORIGINS` to fiscal-agent service environment. |

### 7.6 Admin Route Changes (Detailed)

#### `require_scope` Dependency

A lightweight callable check, added to `admin.py` (not a new file):

```python
async def require_scope(scope: str, request: Request) -> None:
    api_key = getattr(request.state, 'api_key', None)
    if api_key is None or scope not in api_key.scopes:
        raise HTTPException(
            status_code=403,
            detail=UnifiedResponse(
                status='error',
                error=ApiError(code='INSUFFICIENT_SCOPE', ...),
            ).model_dump(),
        )
```

Usage: `@router.get(..., dependencies=[Depends(require_scope("admin:read"))])`

#### Endpoint Changes

| Current Endpoint | Problem | Fix |
|-----------------|---------|-----|
| `GET /v1/admin/me` | Returns `AUTH_DISABLED` | Return `request.state.developer` |
| `POST /v1/admin/register` | Returns only `Developer` | Return `{developer, app, api_key, full_key}` |
| `POST /v1/admin/apps` | Takes `developer_id` in body | Read `developer_id` from `request.state.developer.id` |
| `POST /v1/admin/keys` | Takes `app_id`, no ownership check | Check `app.developer_id == request.state.developer.id` (404 if mismatch) |
| `GET /v1/admin/keys` | Returns `AUTH_DISABLED` | List keys from `request.state.developer` |
| `GET /v1/admin/tenants` | **New** | List all tenants (requires `admin:read`) |
| `POST /v1/admin/tenants` | **New** | Create tenant (requires `admin:write`) |

---

## 8. Ponytail Design Principles Applied

### 8.1 Minimum Code

| Principle | Applied In |
|-----------|-----------|
| Auth in one file | Everything in `middleware/auth.py` — no split across auth/routes/store/utils |
| One class per middleware | Each middleware is a single class extending `BaseHTTPMiddleware` |
| No extra interfaces | No abstract base classes, no middleware factory, no plugin system |
| No new dependencies | All imports are from existing modules (`models.py`, `store.py`, `rate_limiter.py`) |

### 8.2 Reuse Existing RedisStore Methods

| Needed Capability | Existing Method | How We Use It |
|-------------------|----------------|---------------|
| SHA-256 hashing | `RedisStore._hash_key(key)` | Static method, called from auth middleware |
| Redis serialization | `RedisStore._serialize_for_redis(data)` | Static method, reused in `TenantStore` |
| Redis deserialization | `RedisStore._deserialize(model_class, data)` | Static method, called from auth middleware and TenantContext middleware |
| Plan resolution | `RedisStore._resolve_plan(scopes)` | Called via `request.app.state.store._resolve_plan()` |
| Key prefix constants | `_KEY_KEYHASH`, `_KEY_APIKEY`, etc. | Format strings used with Redis keys |

### 8.3 Extend, Don't Replace

| Module | Action | Rationale |
|--------|--------|-----------|
| `store.py` | **Add** `TenantStore` class alongside `RedisStore` | Adding new capability, not replacing existing store logic |
| `models.py` | **Add** fields to `ApiKey`, **add** `Tenant`/`PlanTier` | Extending data contracts without touching existing models |
| `rate_limiter.py` | **No change** | Already implemented — middleware wraps existing `check_rate_limit()` |
| `server.py` | **Wire** new middleware + seed call | Standard framework composition, no structural changes |

### 8.4 No Unrequested Abstractions

Things we are NOT doing:

- ❌ No abstract `BaseMiddleware` class (each middleware is concrete)
- ❌ No middleware registry or plugin system
- ❌ No `TenantService` layer between middleware and store
- ❌ No `Scope` enum (scopes remain `list[str]` for now)
- ❌ No developer→tenant binding index (reserve for when needed)
- ❌ No encryption of `clave_fiscal` in Redis (use env-level security for now)
- ❌ No tenant-aware caching layer
- ❌ No per-tenant file storage

Each of these is a valid future improvement but NOT needed for this change.

### 8.5 Code Size Targets

| File | Est. Lines | Notes |
|------|-----------|-------|
| `middleware/auth.py` | ~110 | Header extraction + hash + chain + state injection + error responses |
| `middleware/tenant.py` | ~30 | Simple passthrough with optional tenant lookup |
| `middleware/rate_limit.py` | ~70 | check_rate_limit call + 429 response + headers |
| `store.py` additions | ~80 | TenantStore class (CRUD + seed) |
| `models.py` additions | ~25 | Tenant + PlanTier models + ApiKey.tenant_id |
| `routes/admin.py` changes | ~100 | Re-enable endpoints + new tenant endpoints + require_scope |

---

## 9. Key Design Decisions

### 9.1 Why `BaseHTTPMiddleware` (not raw ASGI)?

The existing `RequestMetricsMiddleware` uses Starlette's `BaseHTTPMiddleware`,
which provides:
- Simple `dispatch(request, call_next)` interface
- Automatic `request.state` support
- Consistent error handling with the rest of the middleware stack

Raw ASGI middleware would be marginally faster but inconsistent with the
codebase pattern. The auth middleware does Redis lookups (5+ms), so the
micro-optimization of raw ASGI isn't meaningful here.

### 9.2 Why `TenantStore` is a Separate Class (not part of `RedisStore`)

`RedisStore` has focused responsibility: developer/app/key/plan CRUD. Adding
tenant CRUD would bloat it beyond single responsibility. A separate
`TenantStore` class:
- Shares the same Redis client and serialization helpers
- Has its own key prefix constants
- Can evolve independently (e.g., add tenant-specific caching)
- Follows the same patterns as `RedisStore` for consistency

### 9.3 Why `tenant_id` on `ApiKey` (not Developer)

The spec originally considered two resolution strategies:
1. Direct `tenant_id` on `ApiKey`
2. Developer→Tenant binding index

Strategy 1 is chosen because:
- A single developer could work with multiple tenants in the future
- The key is the auth credential — it's the natural scope boundary
- Zero additional writes during registration (key creation sets tenant_id)
- Simpler to reason about ("this key belongs to tenant X")

### 9.4 PlanTier Enum — Unification with Existing Billing Module

The `billing/tiers.py` module already defines a `PlanTier` enum with values
`estudio`/`freelance`/`enterprise`. Our spec requires `free`/`pro`/`enterprise`.

**Resolution**: Move `PlanTier` to `models.py` as the canonical definition
with values `free`/`pro`/`enterprise`. Update `billing/tiers.py` to import
`PlanTier` from `models.py` and map its `PLAN_RULES` accordingly:
- `estudio` → `free` (current default, basic tier)
- `freelance` → `pro` (intermediate tier)
- `enterprise` → `enterprise` (unchanged)

This ensures a single source of truth for the enum while keeping pricing
rules in the billing module. The `Tenant.plan_tier` field directly references
the canonical enum.

```python
# models.py (canonical)
class PlanTier(str, Enum):
    free = 'free'
    pro = 'pro'
    enterprise = 'enterprise'

# billing/tiers.py (imports canonical)
from fiscal_agent.models import PlanTier
# PLAN_RULES keys updated to PlanTier.free, PlanTier.pro, PlanTier.enterprise
```

### 9.5 Why RateLimit Runs AFTER Auth

- The rate limiter needs `request.state.plan` for RPM/RPD limits
- The rate limiter needs `request.state.api_key.id` for the Redis key
- Auth failures (401/403) should NOT consume rate limit budget
- This order matches the spec: `Auth → RateLimit → Route`

### 9.6 Sliding Window vs Fixed Window

The existing `rate_limiter.py` already implements Redis-backed sliding windows
(Sorted Sets). The middleware wraps this existing function. This is strictly
better than the old in-memory fixed window:
- Survives restarts (Redis persistence)
- Accurate per-second sliding (no window boundary bursts)
- Shared across multiple server instances
- Auto-cleanup via TTL (2× window size)

---

## 10. Scope & Future Considerations

### 10.1 Out of Scope (This Change)

| Feature | Reason |
|---------|--------|
| Clerk Auth / JWT | Sprint 3 — this change uses API-key-based auth |
| Provincia Router / IIBB templates | Sprint 1 — separate pipeline feature |
| Tenant admin UI | No frontend work in this phase |
| Per-tenant file storage | No per-tenant isolation of certs/files yet |
| `Scope` enum | Would add ceremony without concrete benefit yet |
| Developer→Tenant binding index | Not needed until developers need multiple tenants |

### 10.2 Future Extension Points

- **Tenant-scoped Redis keys**: All `tenant:*` keys already include tenant ID.
  Adding per-tenant data isolation only requires changing key prefixes.
- **Multi-developer tenants**: When a tenant needs >1 developer, add a
  `tenant:tenant_developers:{tenant_id}` set and the binding index.
- **JWT/SSO**: The auth middleware accepts any credential. Adding JWT means
  a new extractor that populates the same `request.state` fields.
- **Per-tenant rate limits**: Plan resolution already reads from Redis.
  Per-tenant overrides just need a plan override in the Tenant model.
