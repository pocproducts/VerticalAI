# Proposal: Auth + Hardening + Multi-tenant

## Intent

Secure the API (Bearer auth, rate limiter, dynamic CORS) and lay multi-tenant ground (Tenant model, key→tenant binding, scoped browser sessions). Combines Phase 1 hardening with ADR-002 Sprint 2 for a single PR.

## Scope

**In**: Auth middleware (Bearer→Redis hash, populates `request.state`), rate limiter middleware (wraps `check_rate_limit()`, 429+headers), dynamic CORS from env var, `.env.prod` template, `Tenant` model + `TenantStore`, API key→tenant binding, TenantContext middleware, scoped ComposioBrowser, Estudio 1→Tenant 1 seed migration.

**Out**: Provincia Router / IIBB templates (Sprint 1), Clerk Auth / JWT (Sprint 3), tenant admin UI, per-tenant file storage.

## Capabilities

**Modified**: `api-auth` (header X-API-Key→Bearer, tenant resolution), `rate-limiting` (update spec to Redis sliding-window), `tenant-identity` (+Tenant model, tenant_id), `admin-api` (re-enable with auth, tenant seeding).

**New**: `tenant-context` (middleware), `deployment-hardening` (CORS from env, .env.prod).

## Approach

**Auth middleware (ASGI)**: extract Bearer, SHA-256 hash, lookup `tenant:keyhash:{hash}`, resolve ApiKey→App→Developer→Plan→inject state. 401/403 as JSON. **Rate limiter**: runs post-auth, calls `check_rate_limit()`, 429 with `Retry-After`. **Tenant model**: `id`, `name`, `plan_tier`, `cuit`, `clave_fiscal`, `certificados[]`, `clientes[]`, `provincias[]`. Redis Hash. **TenantStore**: extends `RedisStore`; `seed_defaults()` creates Tenant 1 from .env+clients.yaml. **ComposioBrowser**: optional tenant param overrides global credentials. **CORS**: `config.py` reads `CORS_ORIGINS` (default `localhost:3000,3001`).

## Affected Areas

| File | Change |
|------|--------|
| `models.py` | +Tenant, tenant_id on ApiKey |
| `store.py` | +TenantStore, key prefixes |
| `middleware/auth.py` | New |
| `middleware/rate_limit.py` | New |
| `middleware/tenant.py` | New |
| `middleware/__init__.py` | Update exports |
| `server.py` | Wire middleware, dynamic CORS, seed |
| `config.py` | +CORS_ORIGINS |
| `routes/admin.py` | Re-enable with auth, tenant binding |
| `browser/composio.py` | Tenant credential param |
| `.env.prod` | New |
| `docker-compose.prod.yml` | +CORS_ORIGINS env |

## Risks

| Risk | Likelihood | Mitigation |
|------|------------|------------|
| Keys break on Bearer switch | High | Accept both headers during transition |
| PR >400 lines | High | Accepted — single PR with size exception |

## Rollback

1. Revert `server.py` middleware wiring → open API
2. Keep `X-API-Key` for 2 releases
3. `git revert` compose/config changes

## Dependencies

Existing `RedisStore` + `check_rate_limit()` functional. ADR-002 Sprint 2 tasks 2.1–2.5.

## Success Criteria

- [ ] No `Authorization` → 401
- [ ] Valid key, wrong scope → 403
- [ ] Rate exceeded → 429 + `Retry-After`
- [ ] CORS restricted to `CORS_ORIGINS`
- [ ] Tenant 1 seeded from .env + clients.yaml
- [ ] `GET /v1/admin/me` returns developer
- [ ] ComposioBrowser runs with Tenant 1 creds
