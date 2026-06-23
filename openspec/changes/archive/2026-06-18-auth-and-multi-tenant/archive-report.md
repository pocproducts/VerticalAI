# Archive Report: auth-and-multi-tenant

- **Change name**: auth-and-multi-tenant
- **Archive date**: 2026-06-18
- **Mode**: openspec
- **Verification**: ✅ PASS WITH WARNINGS (no CRITICAL issues)

---

## What Was Implemented

Single PR combining Phase 1 hardening with ADR-002 Sprint 2 (multi-tenant ground):

- **Auth middleware** (ASGI): Bearer token + X-API-Key fallback, SHA-256 hash → Redis lookup, full chain resolution (ApiKey → App → Developer → Plan), state injection into `request.state`
- **Rate limiter middleware** (ASGI): wraps existing `check_rate_limit()`, 429 with headers, Redis sliding windows, fallback to 10 RPM / 100 RPD
- **Tenant model** (`Tenant` + `PlanTier`): Pydantic v2 models in `models.py`
- **TenantStore**: CRUD + `seed_defaults()` for Tenant 1 (Estudio Contable) from `.env` + `clients.yaml`
- **TenantContext middleware**: resolves tenant from `api_key.tenant_id`, non-blocking enrichment
- **Admin API re-enable**: `GET /v1/admin/me`, `GET /v1/admin/keys`, auto-provisioning register, tenant CRUD endpoints
- **Scoped ComposioBrowser**: optional `tenant` param for per-tenant ARCA credentials
- **Deployment hardening**: dynamic CORS from `CORS_ORIGINS` env var, `.env.prod` template, `docker-compose.prod.yml` update

### 13 files changed (4 new, 9 modified)
| File | Action |
|------|--------|
| `fiscal_agent/config.py` | Modify (+cors_origins) |
| `fiscal_agent/models.py` | Modify (+Tenant, PlanTier, ApiKey.tenant_id) |
| `fiscal_agent/billing/tiers.py` | Modify (import PlanTier from models) |
| `fiscal_agent/api/store.py` | Modify (+TenantStore, key prefixes) |
| `fiscal_agent/api/middleware/auth.py` | **New** |
| `fiscal_agent/api/middleware/rate_limit.py` | **New** |
| `fiscal_agent/api/middleware/tenant.py` | **New** |
| `fiscal_agent/api/middleware/__init__.py` | Modify (exports) |
| `fiscal_agent/api/server.py` | Modify (wire all middleware, TenantStore, seed) |
| `fiscal_agent/api/routes/admin.py` | Modify (auth re-enable + tenant CRUD) |
| `fiscal_agent/browser/composio.py` | Modify (optional tenant param) |
| `.env.prod` | **New** |
| `docker-compose.prod.yml` | Modify (+CORS_ORIGINS) |

---

## Specs Synced

| Domain | Action | Details |
|--------|--------|---------|
| `api-auth` | **Updated** | Migrated from X-API-Key-only to Bearer with fallback. Added full chain resolution, inactive/suspended entity checks, public path bypass. 10 requirements (was 7). |
| `rate-limiting` | **Updated** | Replaced in-memory fixed-window with Redis sliding windows + ASGI middleware. 7 requirements (was 6). |
| `tenant-context` | **Created** | New domain. Tenant model, PlanTier enum (incl. pro_max), TenantStore CRUD + seed, TenantContext middleware, ApiKey.tenant_id. 5 requirements. |
| `admin-api` | **Updated** | Re-enabled disabled endpoints, auto-provisioning on register, ownership checks on key creation, new tenant CRUD endpoints (GET/POST /v1/admin/tenants). 9 requirements (was 7). |
| `deployment-hardening` | **Created** | New domain. CORS_ORIGINS env var with comma-separated parser, .env.prod template, docker-compose wiring. 4 requirements. |
| `composio-browser-integration` | **Updated** | Added REQ-8: Optional tenant parameter on ComposioBrowser, tenant-scoped ARCA credentials, backward compatible. |

---

## Open Items

1. **PlanTier.pro_max not in delta spec** — The spec's Data Contract (tenant-context) now includes `pro_max` to match the implementation. This was added for backward compatibility with existing `billing/tiers.py`.

2. **No dedicated middleware tests** — `test_tenant_brain.py` passes (15/15) but there are no dedicated unit tests for `AuthMiddleware`, `RateLimitMiddleware`, or `TenantContextMiddleware`. Functionality verified via static analysis + import tests + 83 existing passing tests. Recommend adding `fakeredis`-based middleware tests before next deployment.

3. **Dead code in `composio.py`** (lines 247-253) — Code after `return` on line 245 is pre-existing unreachable code. Not introduced by this change. Fix in separate cleanup PR.

4. **Rate limit middleware logging** — Currently silent when `plan` is `None` (falls back to defaults). Consider adding a log line for observability.

5. **`GET /v1/admin/me` response model** — Consider adding response model annotation for OpenAPI docs.

6. **`TenantStore.list_all()` pagination** — Could benefit from pagination for large tenant sets.

---

## Delta Sync Notes

- **api-auth**: Replaced X-API-Key-only auth with Bearer-first + X-API-Key fallback. Old R1 ("Missing API key → 401") merged into new R1 (Bearer extraction with fallback). Old R2 ("Inactive API key → 403") superseded by new R5 (broader inactive/suspended entity checking). Old R3 ("Missing scope → 403") preserved as new R6. Old R4 ("Valid key + scope → request proceeds") superseded by new R4 (inject into state, but now includes full chain resolution). Old R5 ("ScopeRequired dependency") preserved as new R7. Old R6 ("Middleware before handlers") preserved as new R8. Old R7 ("Admin scope required") preserved as new R9. New R10 (public bypass) added.

- **rate-limiting**: Complete rewrite. Old in-memory fixed-window (R2, R5) replaced with Redis sliding windows (R6). Old Plan-based limits (R1) preserved. Old 429 headers (R3) enhanced with `X-RateLimit-Reset` and `RATE_LIMIT_EXCEEDED` code. New requirements: middleware order (R1), check_rate_limit() call (R2), health skip (R5), no-plan fallback (R7).

- **admin-api**: Added auto-provisioning to register (now returns developer + app + api_key + full_key). Added ownership check to key creation. Added tenant CRUD (GET/POST /v1/admin/tenants). Updated apps to use `request.state.developer.id`. Re-enabled GET /v1/admin/me and GET /v1/admin/keys.

- **composio-browser-integration**: Added REQ-8 as new section. All existing requirements unchanged. File manifest unchanged (change is to existing composio.py).

- **tenant-context** and **deployment-hardening**: Created as new spec files — no merge necessary.

---

## Source of Truth Updated

The following specs now reflect the new behavior:

- `openspec/specs/api-auth/spec.md` — Updated
- `openspec/specs/rate-limiting/spec.md` — Updated
- `openspec/specs/tenant-context/spec.md` — **New**
- `openspec/specs/admin-api/spec.md` — Updated
- `openspec/specs/deployment-hardening/spec.md` — **New**
- `openspec/specs/composio-browser-integration/spec.md` — Updated (REQ-8 added)

---

## SDD Cycle Complete

The change has been fully planned, implemented, verified, and archived. All specs synced to main spec tree. Archive preserved at `openspec/changes/archive/2026-06-18-auth-and-multi-tenant/`.

Ready for the next change.
