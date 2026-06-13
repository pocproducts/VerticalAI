# Proposal: Auth0 + Redis Platform Foundation

## Intent

Replace in-memory storage with Redis for persistence across restarts, and add Auth0 authentication for production-ready admin access control with waitlist workflow.

## Scope

### In Scope
- Auth0 JWT verification in `ScopeRequired` (dual mode: API key OR JWT)
- Auth0 Management API: sync users, check status metadata
- Auth0 Actions for post-login waitlist redirect
- Admin endpoints switch to Auth0 JWT protection
- Redis persistence for developers, apps, API keys, plans
- Redis-backed rate limiter (sliding window)
- Seed-on-startup if Redis is empty
- `.env` vars: `AUTH0_DOMAIN`, `AUTH0_AUDIENCE`, `REDIS_URL`
- `pyproject.toml`: add `redis[hiredis]`

### Out of Scope
- User registration UI (Auth0 Universal Login handles it)
- Multi-tenant Redis isolation
- Redis cluster/sentinel setup
- API key rotation or revocation workflows
- Analytics or audit logging

## Capabilities

### New Capabilities
- `auth0-integration`: Auth0 tenant setup, JWT verification, Management API, waitlist workflow
- `redis-persistence`: Redis connection pool management, CRUD ops replacing in-memory store

### Modified Capabilities
- `api-auth`: dual-mode — API keys for M2M, Auth0 JWT for admin
- `admin-api`: endpoints protected by Auth0 JWT; waitlist-based registration
- `rate-limiting`: in-memory → Redis sliding window
- `tenant-identity`: Developer model may add `auth0_id`

## Approach

**Auth**: `ScopeRequired` gets a second code path — if `Authorization` decodes as a valid Auth0 RS256 JWT, populate `request.state` from JWT claims + Redis. If it's `Bearer fa_*`, use existing API key resolution. Admin endpoints require JWT; fiscal endpoints accept API key.

**Redis**: Single `redis.asyncio` connection pool via `REDIS_URL`. Store wraps Redis hash/set ops. Key schema: `tenant:developer:<id>`, `tenant:app:<id>`, `tenant:apikey:<id>`, `tenant:plan:<id>`, `tenant:keyhash:<hash>`. Rate limiter uses Redis Sorted Set for sliding window.

**Lifespan**: On startup, connect Redis, seed if empty. On shutdown, close pool.

## Affected Areas

| Area | Impact | Description |
|------|--------|-------------|
| `fiscal_agent/api/auth.py` | Modified | Auth0 JWT verification path |
| `fiscal_agent/api/store.py` | Modified | In-memory → Redis CRUD |
| `fiscal_agent/api/rate_limiter.py` | Modified | Redis sliding window |
| `fiscal_agent/api/server.py` | Modified | Lifespan: Redis connect/seed/close |
| `fiscal_agent/api/routes/admin.py` | Modified | Auth0 JWT protection |
| `fiscal_agent/models.py` | Modified | `auth0_id` on Developer |
| `pyproject.toml` | Modified | + `redis[hiredis]` |
| `.env` | Modified | + AUTH0_* + REDIS_URL |

## Risks

| Risk | Likelihood | Mitigation |
|------|------------|------------|
| Redis unavailable at startup | Low | Log error, fall back to in-memory store |
| Auth0 JWT validation latency | Low | Cache JWKS keyset, validate offline |
| In-memory → Redis migration | Medium | Seed on startup if empty; no live migration (MVP data) |

## Rollback Plan

1. Revert `pyproject.toml` and `.env` changes
2. Revert `auth.py`, `store.py`, `rate_limiter.py`, `server.py`, `admin.py`, `models.py`
3. Restart server — fully back to in-memory state

## Dependencies

- Auth0 tenant (must be created before deployment)
- Redis instance (local: Docker, prod: managed Redis)

## Success Criteria

- [ ] `ScopeRequired` accepts API key (Bearer fa_*) OR Auth0 JWT (Bearer <jwt>)
- [ ] Admin endpoints reject API key auth, require valid JWT
- [ ] Fiscal endpoints accept API key auth (unchanged)
- [ ] All CRUD ops survive server restart (Redis persistence)
- [ ] Rate limiter uses Redis, counters survive restart
- [ ] Seed data auto-created when Redis is empty
- [ ] Existing tests pass without modification
