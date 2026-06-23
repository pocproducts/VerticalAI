# Tasks: Auth + Hardening + Multi-tenant

> **Delivery**: Single PR (size exception pre-authorized)
> **Ponytail**: minimum code, no abstractions, fewest files
> **Builds on**: Existing `RedisStore`, `check_rate_limit()`, `models.py` (Developer, App, ApiKey, Plan)

---

## Phase 1 — Auth + Hardening (tasks 1.x)

### Task 1.1 — Add `cors_origins` to `config.py`

**Description**: Add a `cors_origins: list[str]` field to `AppSettings` that reads from `CORS_ORIGINS` env var (comma-separated). Defaults to `["http://localhost:3000", "http://localhost:3001"]`. Includes a `field_validator` to parse the comma-separated string into a list.

**Files**:
- `fiscal_agent/config.py` — Modify (add field + validator to `AppSettings`)

**Est. lines added**: ~10

**Dependencies**: None

**Test criteria**:
- `get_settings().cors_origins` returns default `["http://localhost:3000", "http://localhost:3001"]` when `CORS_ORIGINS` not set
- `get_settings().cors_origins` parses `"https://a.com,https://b.com"` into `["https://a.com", "https://b.com"]`
- Single origin returns a list of one element

---

### Task 1.2 — Create `middleware/auth.py` (Bearer + X-API-Key dual support)

**Description**: New `AuthMiddleware(BaseHTTPMiddleware)` that:
- Extracts Bearer token from `Authorization` header (preferred) or falls back to `X-API-Key` header
- SHA-256 hashes the raw key and looks up `tenant:keyhash:{hash}` in Redis
- Resolves the full chain: `ApiKey → App → Developer → Plan` via Redis HGETALL
- Injects `request.state.{developer, app, api_key, plan}` on success
- Returns 401 `UNAUTHORIZED` on missing/invalid key, 403 with specific codes on inactive/suspended entities
- Public path bypass for `GET /v1/health` and `POST /v1/admin/register`
- Reuses existing `RedisStore._hash_key()`, `RedisStore._deserialize()` static methods

**Files**:
- `fiscal_agent/api/middleware/auth.py` — **New** (~108 lines)
- `fiscal_agent/api/middleware/__init__.py` — Modify (add `AuthMiddleware` import + export, ~2 lines)

**Est. lines added**: ~110

**Dependencies**: None (uses existing store.py static methods)

**Test criteria**:
- No `Authorization` header + no `X-API-Key` → 401 `UNAUTHORIZED`
- `Authorization: Basic ...` → 401 `UNAUTHORIZED`
- Valid Bearer + full resolvable chain → 200, state populated with Developer/App/ApiKey/Plan
- Invalid/unknown key hash → 401 `UNAUTHORIZED`
- `ApiKey.is_active=False` → 403 `API_KEY_INACTIVE`
- `App.status=suspended` → 403 `APP_SUSPENDED`
- `Developer.is_active=False` → 403 `DEVELOPER_INACTIVE`
- `GET /v1/health` without auth → 200 (bypasses middleware)
- `POST /v1/admin/register` without auth → 201 (bypasses middleware)
- `X-API-Key` header accepted when no `Authorization` header
- Both headers present → `Authorization: Bearer` takes priority

---

### Task 1.3 — Wire CORS + auth middleware in `server.py`

**Description**: Two changes in `server.py`:
1. Replace hardcoded `allow_origins` list with `get_settings().cors_origins`
2. Import and add `AuthMiddleware` via `app.add_middleware(AuthMiddleware)`
   - Order: CORSMiddleware → RequestMetricsMiddleware → AuthMiddleware → [tenant → rate_limit later]

**Files**:
- `fiscal_agent/api/server.py` — Modify

**Est. lines added/changed**: ~15 (5 modified + 10 added)

**Dependencies**: 1.1 (cors_origins), 1.2 (auth middleware)

**Test criteria**:
- CORSMiddleware configured with origins from `get_settings().cors_origins`
- Auth middleware runs after Metrics, before route handlers
- Request from non-allowed origin → CORS rejection

---

### Task 1.4 — Create `middleware/rate_limit.py`

**Description**: New `RateLimitMiddleware(BaseHTTPMiddleware)` that:
- Reads `request.state.api_key.id` and `request.state.plan` (set by auth middleware)
- Calls `check_rate_limit(redis, api_key_id, plan)` from existing `rate_limiter.py`
- When `allowed=False`: returns 429 with `Retry-After`, `X-RateLimit-Limit`, `X-RateLimit-Remaining`, `X-RateLimit-Reset` headers
- When `allowed=True`: passes through, adds `X-RateLimit-Limit` and `X-RateLimit-Remaining` to response
- Bypasses `GET /v1/health` (no rate limit check)
- Falls back to 10 RPM / 100 RPD when `plan` is `None`

**Files**:
- `fiscal_agent/api/middleware/rate_limit.py` — **New** (~68 lines)
- `fiscal_agent/api/middleware/__init__.py` — Modify (add `RateLimitMiddleware` import + export, ~2 lines)

**Est. lines added**: ~70

**Dependencies**: 1.2 (needs auth to populate `request.state`)

**Test criteria**:
- Rate within limits → request passes through, headers `X-RateLimit-Limit` and `X-RateLimit-Remaining` present
- Rate exceeded → 429 with `Retry-After` header, `X-RateLimit-Remaining=0`, code `RATE_LIMIT_EXCEEDED`
- `GET /v1/health` always passes through (no rate limit check)
- Different API keys have independent counters

---

### Task 1.5 — Wire rate limiter after auth in `server.py`

**Description**: Import and add `RateLimitMiddleware` via `app.add_middleware(RateLimitMiddleware)` after `AuthMiddleware`.

**Files**:
- `fiscal_agent/api/server.py` — Modify

**Est. lines added**: ~5

**Dependencies**: 1.3 (server.py wiring context), 1.4 (rate_limit middleware)

**Test criteria**:
- Middleware order is `Metrics → Auth → RateLimit → Route Handler`
- Rate limit check runs after authentication (has access to `request.state`)

---

### Task 1.6 — Create `.env.prod` template

**Description**: Production environment variable template with all required vars, placeholder values, and inline documentation. Includes: `ESTUDIO_CUIT`, `ESTUDIO_CLAVE_FISCAL`, `COMPOSIO_API_KEY`, `CORS_ORIGINS`, `REDIS_URL`, `DEV_API_KEY`, SMTP vars, `MEMORY_REDIS_CACHE_URL`, `MEMORY_REDIS_MAX_MB`, `ENGRAM_JWT_SECRET`, `POSTGRES_PASSWORD`.

**Files**:
- `.env.prod` — **New** (~30 lines)

**Est. lines added**: ~30

**Dependencies**: None

**Test criteria**:
- File exists at project root
- `AppSettings` can parse it with `env_file='.env.prod'` (all fields get default/placeholder values)

---

### Task 1.7 — Update `docker-compose.prod.yml` with `CORS_ORIGINS`

**Description**: Add `CORS_ORIGINS` to the `fiscal-agent` service's `environment` block in `docker-compose.prod.yml`.

**Files**:
- `docker-compose.prod.yml` — Modify

**Est. lines added**: ~4

**Dependencies**: None (config change only)

**Test criteria**:
- `fiscal-agent` service has `CORS_ORIGINS` in its environment block
- When `CORS_ORIGINS` is not set in host `.env`, the container uses app's default

---

## Phase 2 — Multi-tenant (tasks 2.x)

### Task 2.1 — Add `Tenant` model + `PlanTier` enum to `models.py`

**Description**: Three changes:
1. Add `PlanTier(str, Enum)` with values `free`, `pro`, `enterprise` to `models.py` (canonical source)
2. Add `Tenant(BaseModel)` with fields: `id`, `name`, `plan_tier`, `cuit`, `clave_fiscal`, `certificados`, `clientes`, `provincias`, `is_active`
3. Migrate `billing/tiers.py`:
   - Remove local `PlanTier` enum → import from `fiscal_agent.models`
   - Update `PLAN_RULES` dict keys: `estudio→free`, `freelance→pro`, `enterprise→enterprise`
4. `billing/__init__.py` re-exports remain unchanged (import re-routes through `tiers.py`)

**Files**:
- `fiscal_agent/models.py` — Modify (add ~40 lines for Tenant + PlanTier)
- `fiscal_agent/billing/tiers.py` — Modify (~8 lines changed: remove local enum, add import, update keys)
- `fiscal_agent/billing/__init__.py` — No change (re-exports work transitively)

**Est. lines added/changed**: ~50 (40 added + 10 changed)

**Dependencies**: None

**Test criteria**:
- `Tenant(id="abc", name="Test", cuit="20324837796", clave_fiscal="s")` constructs successfully
- `Tenant(plan_tier="mega")` raises `ValidationError`
- `PlanTier.free.value == "free"`, `PlanTier.pro.value == "pro"`, `PlanTier.enterprise.value == "enterprise"`
- `billing/tiers.py` imports `PlanTier` from `models.py`, `PLAN_RULES` keys use new enum values
- `calcular_costo()` works with `PlanTier.free`, `PlanTier.pro`, `PlanTier.enterprise`

---

### Task 2.2 — Add `TenantStore` to `store.py`

**Description**: Add `TenantStore` class alongside existing `RedisStore`. Uses the same Redis client and serialization helpers (`_serialize_for_redis`, `_deserialize`). Implements Redis key schema:

| Key Pattern | Type | Purpose |
|-------------|------|---------|
| `tenant:tenant:{id}` | Hash | Tenant fields (JSON-serialized) |
| `tenant:tenant:by_cuit:{cuit}` | String | Index: CUIT → tenant ID |
| `tenant:tenant:all` | Set | Set of all tenant IDs |

**Methods**: `create()`, `get()`, `get_by_cuit()`, `list_all()`, `update()`, `delete()`, `seed_defaults()`

`seed_defaults()` implementation:
- Checks `SMEMBERS tenant:tenant:all` → returns immediately if any exist (idempotent)
- Reads `ESTUDIO_CUIT` / `ESTUDIO_CLAVE_FISCAL` from `get_settings()`
- Loads `clients.yaml` via `AppConfig`, extracts `clientes` and unique `provincias`
- Creates Tenant 1 with `name="Estudio Contable"`, `plan_tier="free"`, the CUIT/clave from settings

**Files**:
- `fiscal_agent/api/store.py` — Modify (add key prefix constants + `TenantStore` class, ~95 lines)

**Est. lines added**: ~95

**Dependencies**: 2.1 (Tenant model must exist)

**Test criteria**:
- `TenantStore.create(tenant)` stores Hash at `tenant:tenant:{id}`, CUIT index at `tenant:tenant:by_cuit:{cuit}`, ID in `tenant:tenant:all`
- `TenantStore.get(id)` returns `Tenant` instance, `None` for missing
- `TenantStore.get_by_cuit(cuit)` returns correct tenant
- `TenantStore.list_all()` returns all tenants
- `TenantStore.update(id, {"name": "New"})` updates only that field
- `TenantStore.delete(id)` removes Hash, CUIT index, and all-set entry
- `seed_defaults()` creates Tenant 1 on empty Redis, does nothing on re-run
- Tenant 1 has `cuit` from `get_settings().cuit`, `clientes` from `clients.yaml`

---

### Task 2.3 — Add `tenant_id` to `ApiKey` model

**Description**: Add optional `tenant_id: str | None = None` field to the existing `ApiKey` model in `models.py`. This creates the direct `key → tenant` binding path used by `TenantContextMiddleware`.

**Files**:
- `fiscal_agent/models.py` — Modify (add one field to `ApiKey`, ~3 lines)

**Est. lines added**: ~3

**Dependencies**: None (models.py change only)

**Test criteria**:
- `ApiKey(id="k1", app_id="a1", key_preview="abcd", created_at=...)` constructs without `tenant_id` (defaults to `None`)
- `ApiKey(..., tenant_id="tnt_01")` constructs with `tenant_id` set
- Existing code constructing `ApiKey` works unchanged
- Existing Redis data lacking `tenant_id` field deserializes correctly (field is optional)

---

### Task 2.4 — Create `middleware/tenant.py` (TenantContext middleware)

**Description**: New `TenantContextMiddleware(BaseHTTPMiddleware)` that:
- Runs AFTER auth middleware (needs `request.state.api_key`)
- Reads `api_key.tenant_id` field
- If set: fetches `Tenant` from Redis via HGETALL `tenant:tenant:{tenant_id}`, injects into `request.state.tenant`
- If `None`: silently sets `request.state.tenant = None` and passes through
- If `request.state.api_key` is `None` (unauthenticated request): skips entirely
- NEVER returns an error — it is a non-blocking enrichment middleware

**Files**:
- `fiscal_agent/api/middleware/tenant.py` — **New** (~30 lines)
- `fiscal_agent/api/middleware/__init__.py` — Modify (add `TenantContextMiddleware` import + export, ~2 lines)

**Est. lines added**: ~32

**Dependencies**: 2.1 (Tenant model), 2.2 (TenantStore), 2.3 (ApiKey.tenant_id)

**Test criteria**:
- ApiKey with `tenant_id="tnt_01"` → `request.state.tenant` is the resolved `Tenant`
- ApiKey with `tenant_id=None` → `request.state.tenant` is `None` (pass through)
- Unauthenticated request → middleware skips silently, `request.state.tenant` stays `None`
- `GET /v1/health` → no error (no state to read)

---

### Task 2.5 — Wire TenantContext middleware in `server.py`

**Description**: Insert `TenantContextMiddleware` between `AuthMiddleware` and `RateLimitMiddleware`. Final middleware order:

```
app.add_middleware(CORSMiddleware, ...)              # 1 — CORS
app.add_middleware(RequestMetricsMiddleware, ...)    # 2 — Metrics
app.add_middleware(AuthMiddleware)                   # 3 — Auth
app.add_middleware(TenantContextMiddleware)           # 4 — Tenant (NEW)
app.add_middleware(RateLimitMiddleware)               # 5 — Rate limit
```

**Files**:
- `fiscal_agent/api/server.py` — Modify (import + add_middleware call, ~5 lines)

**Est. lines added**: ~5

**Dependencies**: 2.4 (TenantContext middleware), 1.5 (server.py current middleware set)

**Test criteria**:
- TenantContext runs after Auth, before RateLimit
- `request.state.tenant` available in route handlers and rate limiter
- Existing auth/rate-limit behavior unchanged

---

### Task 2.6 — Update admin routes with auth + tenant CRUD

**Description**: Re-enable previously disabled admin endpoints and add new tenant management:

1. **`GET /v1/admin/me`** — Return `request.state.developer` (removes `AUTH_DISABLED` stub)
2. **`POST /v1/admin/register`** — Update to auto-provision `Developer + App + ApiKey` (returns all three + full_key)
3. **`POST /v1/admin/apps`** — Read `developer_id` from `request.state.developer.id` instead of request body
4. **`POST /v1/admin/keys`** — Check `app.developer_id == request.state.developer.id` (404 if mismatch)
5. **`GET /v1/admin/keys`** — List keys from `request.state.developer` (removes `AUTH_DISABLED` stub)
6. **`GET /v1/admin/tenants`** — **New**: list all tenants (requires `admin:read` scope via `require_scope`)
7. **`POST /v1/admin/tenants`** — **New**: create tenant (requires `admin:write` scope, checks duplicate CUIT → 409)

Add `require_scope(scope: str)` dependency that checks `api_key.scopes`.

**Files**:
- `fiscal_agent/api/routes/admin.py` — Modify (~125 lines: re-enable ~60 + tenant endpoints ~50 + require_scope ~15)

**Est. lines added/changed**: ~130

**Dependencies**: 1.2 (auth middleware populates state), 2.1 (Tenant model), 2.2 (TenantStore CRUD)

**Test criteria**:
- `GET /v1/admin/me` with valid auth → 200, returns `Developer`
- `GET /v1/admin/me` without auth → 401 (auth middleware blocks)
- `POST /v1/admin/register` with name+email → 201, returns `{developer, app, api_key, full_key}`
- `POST /v1/admin/register` with duplicate email → 409 `EMAIL_ALREADY_EXISTS`
- `POST /v1/admin/apps` → uses `request.state.developer.id`
- `POST /v1/admin/keys` with wrong developer's app → 404 `APP_NOT_FOUND`
- `GET /v1/admin/keys` → returns list of `ApiKey` with `key_preview` only
- `GET /v1/admin/tenants` with `admin:read` → 200, list of `Tenant`
- `GET /v1/admin/tenants` without admin scope → 403 `INSUFFICIENT_SCOPE`
- `POST /v1/admin/tenants` with `admin:write` → 201, created `Tenant`
- `POST /v1/admin/tenants` with duplicate CUIT → 409 `TENANT_CUIT_EXISTS`

---

### Task 2.7 — Update `ComposioBrowser` with optional tenant param

**Description**: Add optional `tenant: Tenant | None = None` parameter to `ComposioBrowser.__init__`. When provided, `_run_single()` uses `tenant.cuit` and `tenant.clave_fiscal` for ARCA authentication (instruction template placeholders and `secrets` dict). When `None`, falls back to existing `self._estudio_cuit` / `self._estudio_clave` (backward compatible).

**Files**:
- `fiscal_agent/browser/composio.py` — Modify (~35 lines: `__init__` signature change + `_run_single` credential logic)

**Est. lines added/changed**: ~35

**Dependencies**: 2.1 (Tenant model)

**Test criteria**:
- `ComposioBrowser(api_key, estudio_cuit, estudio_clave)` works without tenant (backward compatible)
- `ComposioBrowser(api_key, estudio_cuit, estudio_clave, tenant=tenant)` uses tenant CUIT/clave
- `tenant=None` explicitly → falls back to `estudio_cuit`/`estudio_clave`  
- `cli.py` `deuda` command continues to work unchanged (no tenant param)

---

### Task 2.8 — Wire `TenantStore.seed_defaults()` in `server.py` lifespan

**Description**: Update `server.py` lifespan to:
1. Import `TenantStore`
2. Instantiate `TenantStore(redis_client)` after `RedisStore`
3. Call `await tenant_store.seed_defaults()` after `await store.seed_defaults()`

This seeds Tenant 1 (Estudio Contable) from `.env` + `clients.yaml` on first startup.

**Files**:
- `fiscal_agent/api/server.py` — Modify (import + instantiation + seed call, ~8 lines)

**Est. lines added**: ~8

**Dependencies**: 2.2 (TenantStore with seed_defaults), 1.3 (server.py lifespan structure)

**Test criteria**:
- On fresh Redis (no tenant data), Tenant 1 is created after server starts
- On restart with existing Redis data, seed is skipped (idempotent)
- Tenant 1 has `name="Estudio Contable"`, `cuit` from settings, `clientes` from `clients.yaml`

---

## Summary — All Files Touched

| File | Action | Est. Lines |
|------|--------|-----------|
| `fiscal_agent/config.py` | Modify | +10 |
| `fiscal_agent/models.py` | Modify | +43 |
| `fiscal_agent/billing/tiers.py` | Modify | ~10 changed |
| `fiscal_agent/api/store.py` | Modify | +95 |
| `fiscal_agent/api/middleware/auth.py` | **New** | ~108 |
| `fiscal_agent/api/middleware/rate_limit.py` | **New** | ~68 |
| `fiscal_agent/api/middleware/tenant.py` | **New** | ~30 |
| `fiscal_agent/api/middleware/__init__.py` | Modify | +6 |
| `fiscal_agent/api/server.py` | Modify | ~33 |
| `fiscal_agent/api/routes/admin.py` | Modify | +130 |
| `fiscal_agent/browser/composio.py` | Modify | +35 |
| `.env.prod` | **New** | ~30 |
| `docker-compose.prod.yml` | Modify | +4 |

---

## Review Workload Forecast

### Total Estimated Changed Lines

| Category | Lines |
|----------|-------|
| **New files** (3 middleware + .env.prod) | ~236 |
| **Modified files** (9 files) | ~366 |
| **Total additions** | ~602 |
| **Lines removed/changed** (existing code modified) | ~10 |
| **Net change** | ~592 - 602 lines |

### Risk Assessment

- **Total**: ~600 lines
- **Review budget**: 400 lines
- **Over budget by**: ~200 lines (50% over)
- **Risk level**: **HIGH**

### Decision

**Single PR with `size:exception`** — the user explicitly chose Single PR delivery and pre-authorized the size exception. No chained PRs needed.

**Risk mitigations**:
- Middleware files are self-contained (<110 lines each) and independently reviewable
- `models.py` additions are purely declarative (no logic)
- `TenantStore` follows identical patterns to existing `RedisStore`
- `rate_limit.py` middleware just wraps existing `check_rate_limit()` — no new rate limit logic
- Phase 1 (auth + hardening, ~244 lines) is reviewable standalone, Phase 2 (~360 lines) builds on it
- All changes are in a single concern domain (auth/tenant infrastructure) — no cross-cutting changes
