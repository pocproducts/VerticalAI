# Design: Auth0 + Redis Platform Foundation

## Technical Approach

Six capabilities converge on a single architecture: JWT-authenticated admin layer backed by persistent Redis storage.

```
┌──────────────┐      ┌───────────────────┐      ┌───────────────┐
│  Auth0       │──────▶  FastAPI Server   │──────▶  Redis        │
│  JWKS / MGMT │      │                   │      │  (key-value)  │
└──────────────┘      │  ┌─────────────┐  │      └───────────────┘
                      │  │ ScopeRequired│  │
┌──────────────┐      │  │ dual-mode    │  │
│  API Key     │──────▶│  └─────────────┘  │
│  (fa_*)      │      │  ┌─────────────┐  │
└──────────────┘      │  │ Rate Limiter │  │
                      │  │ Redis S.S.   │  │
                      │  └─────────────┘  │
                      │  ┌─────────────┐  │
                      │  │ RedisStore  │  │
                      │  │ CRUD layer  │  │
                      │  └─────────────┘  │
                      └───────────────────┘
```

**Credential detection**: `ScopeRequired` inspects the Bearer token prefix. `fa_` → API key path (unchanged flow). Any other prefix → Auth0 JWT path.

**Lifespan**: connect Redis pool → seed if empty → yield (serving requests) → close pool. No silent fallback: if Redis is unreachable, server fails fast at startup.

## Architecture Decisions

| Option | Tradeoffs | Decision |
|--------|-----------|----------|
| `redis.asyncio` pool vs aioredis | aioredis merged into redis-py 4.x. `redis.asyncio` is the canonical async client. | Use `redis.asyncio` with connection pool |
| Silent Redis fallback to memory | Confusing for operators — data appears then disappears. | Fail at startup with clear log message |
| JWKS cache TTL | 10 min balances freshness vs latency. | In-memory cache, refresh on `KeyError` (stale key) |
| Sorted Set for rate limiting | `ZADD` + `ZREMRANGEBYSCORE` + `ZCARD` gives accurate sliding window. TTL for cleanup. | Redis Sorted Set, 2 keys per api_key (minute, day) |
| Auth0 `permissions` claim vs custom namespace | Auth0 issues `permissions` array by default for RBAC. Matches `Scope` enum values. | Use built-in `permissions` claim |
| Waitlist check in Auth0 Action + API | Action redirects before token issuance; API double-checks `app_metadata.status` on each admin request. | Both: Action for UX, API for enforcement |

## Data Flow

### API Key Path (fiscal endpoints)
```
Request (Bearer fa_...)
  → ScopeRequired.detect("fa_")
  → resolve_api_key(full_key)
    → hash → tenant:keyhash:{sha256} → api_key_id
    → tenant:apikey:{id} → ApiKey
    → tenant:app:{id} → App
    → tenant:developer:{id} → Developer
    → plan matching → Plan
  → request.state.{developer, app, api_key, plan}
```

### Auth0 JWT Path (admin endpoints)
```
Request (Bearer eyJ...)
  → ScopeRequired.detect("eyJ") → require_jwt=True
  → verify_auth0_jwt(token)
    → fetch/cache JWKS from {AUTH0_DOMAIN}/.well-known/jwks.json
    → decode + verify RS256 signature
    → check iss, aud, exp
  → get_auth0_user_info(token) → GET /userinfo
    → check app_metadata.status (must be "approved")
  → extract sub → look up tenant:developer:by_auth0:{auth0_id}
  → request.state.developer (only — no app/api_key/plan)
  → check permissions claim for required scope
```

### Redis Key Schema
```
Key                              │ Type    │ Value
─────────────────────────────────┼─────────┼─────────────────────
tenant:developer:{id}            │ Hash    │ Developer fields
tenant:app:{id}                  │ Hash    │ App fields
tenant:apikey:{id}               │ Hash    │ ApiKey fields
tenant:plan:{id}                 │ Hash    │ Plan fields
tenant:keyhash:{sha256}          │ String  │ api_key_id
tenant:developer:by_email:{email}│ String  │ developer_id
tenant:developer:by_auth0:{sub}  │ String  │ developer_id
ratelimit:{key_id}:minute        │ S.Set   │ timestamp:random members
ratelimit:{key_id}:day           │ S.Set   │ timestamp:random members
```

## File Changes

| File | Action | Description |
|------|--------|-------------|
| `fiscal_agent/models.py` | Modify | Add `auth0_id: str = ''` to Developer |
| `fiscal_agent/api/store.py` | Rewrite | In-memory dicts → `RedisStore` class with `redis.asyncio` |
| `fiscal_agent/api/rate_limiter.py` | Rewrite | Fixed-window → Redis Sorted Set sliding window |
| `fiscal_agent/api/auth.py` | Enrich | Add JWT verification path + `require_jwt` flag |
| `fiscal_agent/api/server.py` | Enrich | Lifespan: Redis pool + seed. Middleware: enforce rate limits |
| `fiscal_agent/api/routes/admin.py` | Modify | `ScopeRequired(require_jwt=True)` on all endpoints |
| `pyproject.toml` | Modify | Add `redis[hiredis]` dependency |
| `.env` | Modify | Add `AUTH0_DOMAIN`, `AUTH0_AUDIENCE`, `AUTH0_MGMT_CLIENT_ID`, `AUTH0_MGMT_CLIENT_SECRET`, `REDIS_URL` |

## Interfaces / Contracts

### `RedisStore` — replaces module-level functions

```python
class RedisStore:
	def __init__(self, redis_client: Redis) -> None: ...

	async def register_developer(self, name: str, email: str, auth0_id: str = '') -> Developer: ...

	async def create_app(self, developer_id: str, name: str, environment: str) -> App | None: ...

	async def create_api_key(self, app_id: str) -> dict | None:
		"""Returns {'api_key': ApiKey, 'full_key': str} or None."""

	async def resolve_api_key(self, key: str) -> tuple[Developer, App, ApiKey, Plan] | None: ...

	async def list_developer_keys(self, developer_id: str) -> list[ApiKey]: ...

	async def get_developer_by_auth0_id(self, auth0_id: str) -> Developer | None: ...

	async def get_developer_by_email(self, email: str) -> Developer | None: ...

	async def seed_defaults(self) -> None:
		"""Check if tenant:plan:* exists. If empty, create Free plan + admin dev."""
```

Each entity stored via Redis Hash with `model_dump()` (excludes `None` fields) and retrieved via `model_validate()`. The `keyhash` and `by_auth0` lookups use Redis String (SET/GET).

### `ScopeRequired` — dual mode

```python
class ScopeRequired:
	def __init__(self, scope: Scope, require_jwt: bool = False): ...

	async def __call__(self, request, credentials):
		if credentials is None:
			raise 401

		token = credentials.credentials
		if token.startswith('fa_'):
			return await self._api_key_path(request, token)
		else:
			return await self._jwt_path(request, token)

	async def _api_key_path(self, request, token):
		# Existing flow: resolve_api_key → populate request.state.*
		# If require_jwt=True, this path is rejected
		...

	async def _jwt_path(self, request, token):
		# 1. verify_auth0_jwt(token) → claims
		# 2. get_auth0_user_info(token) → app_metadata
		# 3. Check status == "approved" or raise 403
		# 4. Look up developer by auth0_id from claims.sub
		# 5. Check scope in claims.permissions
		# 6. Set request.state.developer
		...
```

### `check_rate_limit` — same interface, Redis-backed

```python
async def check_rate_limit(redis: Redis, api_key_id: str, plan: Plan | None = None) -> dict:
	"""Returns {allowed, limit, remaining, retry_after}."""
	# ZREMRANGEBYSCORE for entries outside window
	# ZCARD for current count
	# ZADD new entry with timestamp as score
	# EXPIRE key at 2x window
```

### Models change

```python
class Developer(BaseModel):
	id: str
	name: str
	email: str
	auth0_id: str = ''          # NEW: linked Auth0 user ID
	created_at: datetime
	is_active: bool = True
```

## Testing Strategy

| Layer | What | How |
|-------|------|-----|
| Unit | `check_rate_limit` sliding window logic | `fakeredis` or mock `redis.asyncio` |
| Unit | `verify_auth0_jwt` token validation | Mock JWKS endpoint, test valid/expired/bad-sig tokens |
| Unit | `ScopeRequired` dual-mode routing | Test `fa_` prefix vs JWT prefix, both `require_jwt` values |
| Integration | `RedisStore` CRUD round-trip | Real Redis via Docker, test all operations with `model_dump`/`model_validate` |
| Integration | Rate limiter with Redis | Real Redis, test sliding window at second boundaries |
| E2E | Admin endpoint with real JWT | Full server startup, mock Auth0 /userinfo |
| E2E | Waitlist rejection flow | Mock `app_metadata.status = "waitlist"`, expect 403 |

**Note**: No tests exist today. This change should add a `tests/` structure at project root with `pytest` + `pytest-asyncio`.

## Implementation Order

1. **models.py**: Add `auth0_id` to Developer (non-breaking, defaults to `''`)
2. **pyproject.toml + .env**: Add `redis[hiredis]`, config vars
3. **store.py**: Rewrite to `RedisStore` with connection pool, key schema, CRUD, seed logic
4. **rate_limiter.py**: Rewrite to Redis Sorted Set sliding window with same interface
5. **auth.py**: Add JWT verification (`verify_auth0_jwt`, `get_auth0_user_info`), extend `ScopeRequired`
6. **server.py**: Lifespan: init Redis → seed → yield → close. Middleware: call `check_rate_limit`
7. **admin.py**: Set `require_jwt=True` on all `ScopeRequired` usages, add 403 waitlist check

## Risks and Mitigations

| Risk | Likelihood | Mitigation |
|------|------------|------------|
| Redis unavailable at startup | Low | Fail fast: log error + raise. Notify operator. No silent fallback — would cause confusing data loss. |
| JWKS endpoint temporarily down | Low | Cache keys in memory. On `KeyError` (unknown kid), retry fetch once. Fail 401 if still unavailable. |
| Auth0 token expiry vs long-lived API keys | Medium | API keys (M2M) have no expiry logic yet. JWT tokens validated for `exp`, `iss`, `aud`. Admin operations require fresh JWT. |
| Migration: no live data in prod | None (MVP) | `seed_defaults()` on empty Redis. No migration script needed. |
| Auth0 Management API rate limits | Low | Only called on JWT auth path. Cache `app_metadata.status` in Redis to reduce API calls. |

## Open Questions

- [ ] Cache `app_metadata.status` in Redis with TTL? Reduces Auth0 Management API calls but adds stale-data risk.
