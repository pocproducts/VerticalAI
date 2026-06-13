# Tasks: Auth0 + Redis Platform Foundation

---

## Review Workload Forecast

### Changed Lines Estimate

| File | Action | Current (lines) | Est. Final (lines) | Net Δ | Review Weight |
|------|--------|-----------------|---------------------|-------|---------------|
| `fiscal_agent/models.py` | Modify | 567 | 568 | **+1** | Trivial — one field addition |
| `pyproject.toml` | Modify | 41 | 42 | **+1** | Trivial — one dependency |
| `.env` | Modify | 27 | 33 | **+6** | Trivial — five env vars |
| `fiscal_agent/api/store.py` | **Rewrite** | 195 | ~240 | **+45** | Full rewrite, new `RedisStore` class, 8+ methods |
| `fiscal_agent/api/rate_limiter.py` | **Rewrite** | 84 | ~110 | **+26** | Full rewrite, async Redis Sorted Set |
| `fiscal_agent/api/auth.py` | **Enrich** | 94 | ~240 | **+146** | Biggest change: JWKS cache, JWT verifier, Management API, dual-mode ScopeRequired |
| `fiscal_agent/api/server.py` | Enrich | 159 | ~230 | **+71** | Lifespan refactor to async, middleware enforcement, OpenAPI update |
| `fiscal_agent/api/routes/admin.py` | Modify | 195 | ~230 | **+35** | require_jwt on all endpoints, waitlist gate, register links auth0_id |
| **Implementation total** | | | | **~331** | **8 files, 2 full rewrites, 2 major enrichments** |
| Tests (if added per design) | New | 0 | ~250-350 | +250-350 | conftest + 4 test modules |
| **Grand total (with tests)** | | | | **~581-681** | |

### 400-Line Budget Risk: **MODERATE-HIGH**

Implementation alone is ~331 net new lines — technically under 400, but the **complexity density** is high:

- **auth.py** (+146 lines): Dual-mode auth is the most delicate code in the change. JWT verification, JWKS caching, Management API calls, scope extraction from permissions, waitlist status checks — one bug here breaks all admin endpoints.
- **store.py** (+45 lines but full rewrite): 195 lines of in-memory dict logic replaced with Redis async patterns. Every CRUD operation changes. Easy to miss a Redis key pattern or a serialization edge case.
- **server.py** (+71 lines): Refactoring `lifespan()` from sync to async touches startup ordering. Rate-limit middleware was a pass-through before — now it actually enforces. Easy to break the whole server startup.
- **admin.py** (+35 lines): Changes are surgical but affect every endpoint. The register endpoint goes from public to JWT-only — that's a security-critical behavioral change.

**If tests are included** (recommended by the design): add ~250-350 lines across 4-5 new test files, putting the total at 581-681 lines. Well over the 400-line budget.

### Chained PRs Recommended: **YES**

Split into **two chained PRs**:

| PR | Scope | Files | Est. Lines | Mergable? |
|----|-------|-------|------------|-----------|
| **PR 1: Redis Foundation** | Phases 1, 2, 3 | `models.py`, `pyproject.toml`, `.env`, `store.py`, `rate_limiter.py`, `server.py` (partial) | ~150 | **Yes** — API key auth still works, data persists in Redis, rate limiter uses Redis. No behavioral breakage for consumers. |
| **PR 2: Auth0 Integration** | Phases 4, 5, server.py remaining changes | `auth.py`, `admin.py`, `server.py` (OpenAPI + middleware), `.env` (if not done) | ~180 | **Yes** — builds on Redis store (developer lookup by auth0_id). Only admin auth flow changes. |

**Split rationale**: PR 1 is safe to merge independently — it replaces in-memory with Redis while keeping the API key auth contract intact. PR 2 adds Auth0 on top. If PR 2 needs rework, PR 1 isn't blocked. If PR 1 has a Redis bug, it's isolated from auth logic.

### Recommended Split Strategy

```
PR 1 branch: refactor/redis-persistence       (target: main or dev)
PR 2 branch: feat/auth0-integration            (target: refactor/redis-persistence or main)
```

Merge PR 1 first, rebase PR 2, then merge PR 2. Each PR stays under 400 lines.

---

## Implementation Phases

> **Note on `pyproject.toml`**: The implementation may also need a JWT library (e.g., `PyJWT>=2.8.0` or `python-jose[cryptography]`) for RS256 JWKS verification. The proposal listed only `redis[hiredis]` — verify during Phase 1 which library to add, or implement RS256 verification using the existing `cryptography` dependency directly.

---

## Phase 1: Foundation — Models + Dependencies

*Depends on: nothing*
*Enables: Phase 2 (Redis needs dependency and model field)*

- [x] 1.1 **pyproject.toml** — Add `redis[hiredis]>=5.0.0` to `[project] dependencies`. Added `redis[hiredis]>=5.0.0` and `httpx>=0.27.0`. No JWT library needed — RS256 verification uses existing `cryptography` dep.
- [x] 1.2 **pyproject.toml** — Add `fakeredis[lua]>=2.0.0` to test dependencies. Created `[project.optional-dependencies] test` group with `fakeredis[lua]`, `pytest`, `pytest-asyncio`, `httpx`.
- [x] 1.3 **.env** — Added five new env vars at end of file:

	```env
	# ── Auth0 ──────────────────────────────────────────────────────
	AUTH0_DOMAIN=your-tenant.auth0.com
	AUTH0_AUDIENCE=https://api.fiscal-agent.ar
	AUTH0_MGMT_CLIENT_ID=
	AUTH0_MGMT_CLIENT_SECRET=

	# ── Redis ──────────────────────────────────────────────────────
	REDIS_URL=redis://localhost:6379/0
	```
- [x] 1.4 **models.py** — Added `auth0_id: str = ''` field to `Developer` model after `email`, before `created_at`. No default factory needed — empty string is the sentinel for "no Auth0 link."

	```python
	class Developer(BaseModel):
		"""A developer account that owns applications."""
		id: str
		name: str
		email: str
		auth0_id: str = ''          # NEW: linked Auth0 user ID ('' = not linked)
		created_at: datetime
		is_active: bool = True
	```

---

## Phase 2: Redis Store

*Depends on: Phase 1 (redis dependency, auth0_id field)*
*Enables: Phase 3 (rate limiter needs Redis connection), Phase 4 (developer lookup by auth0_id)*

**Design reference**: `RedisStore` class with `redis.asyncio` connection pool. Key schema: `tenant:{entity}:{id}` for hashes, `tenant:keyhash:{sha256}` for key lookups, `tenant:developer:by_email:{email}` and `tenant:developer:by_auth0:{sub}` for secondary indexes. Models round-trip via `model_dump()` / `model_validate()`. Datetime fields stored as ISO 8601 strings.

- [x] 2.1 **store.py** — Replaced entire file with `RedisStore` class:

	- **`__init__(self, redis_client: Redis)`**: store the async Redis client. No pool creation here — the pool is passed in from server lifespan.
	- **`_generate_id() -> str`**: static/classmethod, `uuid4().hex[:12]` (same as current, move to class).
	- **`_hash_key(key: str) -> str`**: static/classmethod, `hashlib.sha256(key.encode()).hexdigest()` (same as current, move to class).

	Define module-level constants for key schemas:

	```python
	# Redis key schema prefixes
	_KEY_DEVELOPER = 'tenant:developer:{}'        # Hash → Developer fields
	_KEY_APP = 'tenant:app:{}'                    # Hash → App fields
	_KEY_APIKEY = 'tenant:apikey:{}'              # Hash → ApiKey fields
	_KEY_PLAN = 'tenant:plan:{}'                  # Hash → Plan fields
	_KEY_KEYHASH = 'tenant:keyhash:{}'            # String → api_key_id
	_KEY_DEV_BY_EMAIL = 'tenant:developer:by_email:{}'  # String → developer_id
	_KEY_DEV_BY_AUTH0 = 'tenant:developer:by_auth0:{}'  # String → developer_id
	```

	All entity data stored via Redis Hash (HSET/HGETALL). Use `model_dump(mode='json')` for serialization (ISO 8601 datetimes) and `model_validate()` for deserialization. API key hash lookups via Redis String (SET/GET). Secondary indexes (email, auth0_id) via Redis String.

- [x] 2.2 **store.py** — Implemented all CRUD methods on `RedisStore`:

	- **`async def register_developer(self, name: str, email: str, auth0_id: str = '') -> Developer`**
		- Generate ID, check email uniqueness (`_KEY_DEV_BY_EMAIL`) → raise 409 if exists
		- Create `Developer` with `model_dump(mode='json')`, HSET into `_KEY_DEVELOPER`
		- SET `_KEY_DEV_BY_EMAIL:{email}` → `developer_id`
		- If `auth0_id` is non-empty, SET `_KEY_DEV_BY_AUTH0:{auth0_id}` → `developer_id`
		- Return the Developer

	- **`async def create_app(self, developer_id: str, name: str, environment: str) -> App | None`**
		- Verify developer exists (HEXISTS or HGET on `_KEY_DEVELOPER`) → return None if missing
		- Create `App`, HSET into `_KEY_APP`
		- Return the App

	- **`async def create_api_key(self, app_id: str) -> dict | None`**
		- Verify app exists (HEXISTS on `_KEY_APP`) → return None if missing
		- Generate `fa_{secrets.token_hex(16)}`, create `ApiKey`, HSET into `_KEY_APIKEY`
		- SET `_KEY_KEYHASH:{sha256(full_key)}` → `api_key_id`
		- Return `{'api_key': ApiKey, 'full_key': full_key}`

	- **`async def resolve_api_key(self, key: str) -> tuple[Developer, App, ApiKey, Plan] | None`**
		- GET `_KEY_KEYHASH:{sha256(key)}` → `api_key_id`
		- HGETALL `_KEY_APIKEY:{api_key_id}` → validate active
		- HGETALL `_KEY_APP:{api_key.app_id}` → validate active
		- HGETALL `_KEY_DEVELOPER:{app.developer_id}` → validate active
		- Resolve plan by matching scopes (HGETALL all `_KEY_PLAN:*` via SCAN or keep plan IDs set)
		- Return tuple or None

	- **`async def list_developer_keys(self, developer_id: str) -> list[ApiKey]`**
		- Verify developer exists
		- Pattern: could store a Set of developer's app IDs (`_KEY_DEV_APPS:{dev_id}`) and iterate, or SCAN `_KEY_APP:*` and filter
		- Return matching ApiKey objects

	- **`async def get_developer_by_auth0_id(self, auth0_id: str) -> Developer | None`**
		- GET `_KEY_DEV_BY_AUTH0:{auth0_id}` → `developer_id`
		- If None, return None
		- HGETALL `_KEY_DEVELOPER:{developer_id}` → Developer or None

	- **`async def get_developer_by_email(self, email: str) -> Developer | None`**
		- GET `_KEY_DEV_BY_EMAIL:{email}` → `developer_id`
		- If None, return None
		- HGETALL `_KEY_DEVELOPER:{developer_id}` → Developer or None

	- **`async def seed_defaults(self) -> None`**
		- Check if any plan exists (SCAN `_KEY_PLAN:*` or EXISTS on a sentinel key)
		- If Redis has data (any `tenant:*` keys exist), skip — return immediately
		- Create Free plan (HSET into `_KEY_PLAN`), Admin developer (HSET into `_KEY_DEVELOPER`, SET into `_KEY_DEV_BY_EMAIL`), Admin App (HSET into `_KEY_APP`), Admin API key (HSET into `_KEY_APIKEY`, SET into `_KEY_KEYHASH`)
		- Use `model_dump(mode='json')` for all entity serialization
		- Log the seeded admin API key at INFO level for developer onboarding

	**Key schema verification**: Every Redis key written or read must match the `tenant:{entity}:{id}` pattern and its specific prefix constant. No bare string literals inside methods.

	**Error handling**: Redis connection errors should raise a custom `StoreError` exception or propagate with clear logging. All `register_developer` operations should be idempotent: if the email already exists, raise `409` with code `EMAIL_ALREADY_EXISTS`.

- [x] 2.3 **store.py** — Removed all module-level dicts and functions. `RedisStore` class replaces everything.

- [x] 2.4 **server.py** — Refactored `lifespan()` from sync to async:

	```python
	import redis.asyncio as redis
	
	@asynccontextmanager
	async def lifespan(app: FastAPI) -> AsyncIterator[None]:
		"""Connect Redis, seed defaults on empty store, close on shutdown."""
		redis_url = os.getenv('REDIS_URL', 'redis://localhost:6379/0')
		redis_client = redis.from_url(redis_url, decode_responses=True)
		store = RedisStore(redis_client)
		app.state.redis = redis_client
		app.state.store = store
		
		# Seed if empty
		await store.seed_defaults()
		
		yield  # Server is now serving
		
		# Clean shutdown
		await redis_client.aclose()
	```

	- Import `redis.asyncio` at module level (or inside lifespan if lazy-loading is preferred)
	- Import `RedisStore` from `fiscal_agent.api.store`
	- Import `os` for env var reading
	- Set `decode_responses=True` on the Redis connection (critical — all data is strings, not bytes)
	- Store both `redis_client` and `store` on `app.state` so middleware and routes can access them
	- Remove the old sync `seed_defaults()` call

---

## Phase 3: Redis Rate Limiter

*Depends on: Phase 2 (needs Redis connection from app.state)*
*Enables: Phase 5 (rate limiting enforced on admin endpoints)*

**Design reference**: Sorted Set per key per window (`ratelimit:{key_id}:minute`, `ratelimit:{key_id}:day`). Score = Unix timestamp, member = `{timestamp}:{random}` (to allow duplicate timestamps). Trim expired entries with `ZREMRANGEBYSCORE`, count with `ZCARD`, add with `ZADD`, set TTL with `EXPIRE` (2x window size).

- [x] 3.1 **rate_limiter.py** — Rewrote module to use Redis Sorted Set sliding window:

	- Remove `_windows` dict, `_DEFAULT_RPM`, `_DEFAULT_RPD`, `_WINDOW_MINUTE`, `_WINDOW_DAY`, `_get_window()` — all in-memory state goes away.
	- New signature: `async def check_rate_limit(redis: Redis, api_key_id: str, plan: Plan | None = None) -> dict`
		- Accept `redis: Redis` (the async Redis client from `app.state.redis`) as first parameter — the caller passes it in
		- Accept `api_key_id: str` and `plan: Plan | None` (same as before)
		- Return same shape: `{allowed: bool, limit: int, remaining: int, retry_after: int}`
	- Sliding window implementation per window (minute = 60s, day = 86400s):

		```python
		async def _check_window(redis: Redis, key: str, window_seconds: int, limit: int) -> dict:
			now = time.time()
			cutoff = now - window_seconds
			
			# Remove entries outside the window
			await redis.zremrangebyscore(key, '-inf', cutoff)
			
			# Count current entries
			count = await redis.zcard(key)
			
			# Add current request
			member = f'{now}:{uuid4().hex[:8]}'
			await redis.zadd(key, {member: now})
			
			# Set TTL for auto-cleanup (2x window)
			await redis.expire(key, window_seconds * 2)
			
			allowed = count < limit
			return {
				'allowed': allowed,
				'remaining': max(0, limit - count - 1),
				'limit': limit,
			}
		```

	- `check_rate_limit` orchestrates two windows:

		```python
		minute_key = f'ratelimit:{api_key_id}:minute'
		day_key = f'ratelimit:{api_key_id}:day'
		
		rpm = plan.rate_limit_rpm if plan else 10
		rpd = plan.rate_limit_rpd if plan else 100
		
		minute_result = await _check_window(redis, minute_key, 60, rpm)
		day_result = await _check_window(redis, day_key, 86400, rpd)
		
		allowed = minute_result['allowed'] and day_result['allowed']
		retry_after = 0
		if not allowed:
			# retry_after = seconds until next window slot frees up
			...
		```

	- Retry-after logic: if minute window full, calculate earliest entry timestamp + 60 seconds; if day window full, earliest entry + 86400. Return max(1, retry_after).

- [x] 3.2 **server.py** — Simplified `rate_limit_middleware` (actual enforcement moved to `ScopeRequired._api_key_path` per Option A recommendation):

	- Import `check_rate_limit` from `fiscal_agent.api.rate_limiter`
	- Change the middleware to actually enforce:

		```python
		@app.middleware('http')
		async def rate_limit_middleware(request: Request, call_next):
			path = request.url.path
			
			# Skip rate limiting for health endpoint
			if path == '/v1/health':
				return await call_next(request)
			
			# Let the request through first (auth middleware runs first via ScopeRequired)
			response = await call_next(request)
			
			# If the request has an api_key (set by ScopeRequired), count it
			# This happens AFTER the response so the rate limit is consumed
			# even if the handler itself doesn't use it
			# BUT: this pattern means we consume the rate limit on every request
			#       even non-admin ones. That's correct — rate limiting is per-key.
			
			# Wait — the design says "call check_rate_limit and return 429 when exceeded".
			# We need to check BEFORE the handler, not after.
			# Move the check before call_next.
		```

		**Correct pattern** (check before handler):

		```python
		@app.middleware('http')
		async def rate_limit_middleware(request: Request, call_next):
			path = request.url.path
			
			if path == '/v1/health':
				return await call_next(request)
			
			# Gets api_key_id if already resolved by a previous middleware,
			# or hasattr check on request.state
			api_key_id = getattr(request.state, 'api_key_id', None)
			if api_key_id and hasattr(request.state, 'plan'):
				result = await check_rate_limit(
					request.app.state.redis,
					api_key_id,
					request.state.plan,
				)
				if not result['allowed']:
					return JSONResponse(
						status_code=429,
						content=UnifiedResponse(
							status='error',
							error=ApiError(
								code='RATE_LIMIT_EXCEEDED',
								cause=f'Límite de tasa excedido. Esperar {result["retry_after"]}s.',
							),
						).model_dump(),
					)
			
			return await call_next(request)
		```

		**Important**: `request.state.api_key` (and thus `api_key_id`) is set by `ScopeRequired` which runs as a `Depends()` in the route handler. Middleware runs BEFORE route dependencies. This creates a **timing problem** — the API key ID isn't available in the middleware yet.

		**Solution**: Either:
		- (A) Move the rate limit check INSIDE `ScopeRequired` after key resolution (simpler, keeps logic together)
		- (B) Make the middleware run on `Response` (after the handler) and decrement on 429 — complex, anti-pattern
		- (C) Use `app.middleware('http')` but call `check_rate_limit` in `ScopeRequired.__call__` as a side effect

		**Recommendation**: Option (A) — call `check_rate_limit` inside `ScopeRequired` after resolving the API key, before returning. This is the simplest approach and matches the existing code structure. The middleware then only handles the health-skip and global 429 format. Document this decision clearly.

---

## Phase 4: Auth0 Integration

*Depends on: Phase 2 (RedisStore for developer lookup), Phase 1.3 (env vars)*
*Enables: Phase 5 (admin endpoints need JWT auth)*

- [x] 4.1 **auth.py** — Added JWKS fetcher and JWT verifier (RS256 via `cryptography`):

	- Add imports: `httpx` (async HTTP), `json`, `os`, `base64`, `cryptography` (already in deps), `jose` or `PyJWT`
	- JWKS caching: module-level variable `_jwks_cache: dict[str, Any] | None = None` and `_jwks_fetched_at: float = 0.0`
	- Cache TTL constant: `_JWKS_CACHE_TTL = 600` (10 minutes)

	- **`async def _fetch_jwks() -> dict`**:
		- GET `https://{AUTH0_DOMAIN}/.well-known/jwks.json`
		- Parse JSON, extract `keys` array
		- Build lookup dict: `{key['kid']: key for key in keys}`
		- Update `_jwks_cache` and `_jwks_fetched_at`
		- Return cached keys

	- **`async def _get_jwks_key(kid: str) -> dict | None`**:
		- If cache expired or missing, call `_fetch_jwks()`
		- Lookup key by `kid`, return None if not found (triggers re-fetch as fallback)

	- **`async def verify_auth0_jwt(token: str) -> dict | None`**:
		- Decode JWT header (without verification) to extract `kid` and `alg`
		- Validate `alg == 'RS256'` (reject if not)
		- Get JWK key by `kid`
		- Construct RSA public key from JWK using `cryptography` or `jose`
		- Verify signature: decode payload, verify against RSA key
		- Validate claims:
			- `iss` must equal `https://{AUTH0_DOMAIN}/`
			- `aud` must equal `AUTH0_AUDIENCE` env var
			- `exp` must be in the future (with 30s leeway)
		- Return decoded claims dict (includes `sub`, `permissions`, `exp`, `iss`, `aud`)
		- On any failure, return None (caller converts to 401)

	- **`async def get_auth0_user_info(access_token: str) -> dict | None`**:
		- GET `https://{AUTH0_DOMAIN}/userinfo` with `Authorization: Bearer {token}`
		- Parse response JSON
		- Extract `sub`, `name`, `email`, `app_metadata` (if present)
		- Return dict or None on failure

- [x] 4.2 **auth.py** — Added `Auth0ManagementClient` with client_credentials token acquisition and `/api/v2/users/{id}` lookup:

	- Note: The `/userinfo` endpoint returns basic user info. For `app_metadata`, we may need the Management API (`/api/v2/users/{auth0_id}`). Check during implementation.
	- If needed: implement `Auth0ManagementClient` with token acquisition (client_credentials grant) and user lookup endpoint.
	- **Fallback**: If Management API is too complex for this phase, parse `app_metadata` from a custom JWT claim if configured in the Auth0 Action (the Action could write status into the token). This avoids the Management API round-trip on every request.

- [x] 4.3 **auth.py** — Extended `ScopeRequired` class for dual-mode (`require_jwt` flag, `_api_key_path`, `_jwt_path`):

	- Add `require_jwt: bool = False` parameter to `__init__`:

		```python
		def __init__(self, scope: Scope, require_jwt: bool = False):
			self.scope = scope
			self.require_jwt = require_jwt
		```

	- Refactor `__call__` into a router:

		```python
		async def __call__(
			self,
			request: Request,
			credentials: HTTPAuthorizationCredentials | None = Depends(security),
		):
			if credentials is None:
				raise self._unauthorized('API key o JWT requerido')
			
			token = credentials.credentials
			
			if token.startswith('fa_'):
				return await self._api_key_path(request, token)
			else:
				return await self._jwt_path(request, token)
		```

	- **`async def _api_key_path(self, request: Request, token: str)`**:
		- If `self.require_jwt` is True, reject with 401 and code `AUTH0_JWT_REQUIRED` (admin endpoints must use JWT)
		- Otherwise: existing logic — `resolve_api_key(token)` via `request.app.state.store`
		- Check key active, check scope
		- Set `request.state.{developer, app, api_key, plan}`
		- Call `check_rate_limit()` (per the middleware solution from task 3.2)

	- **`async def _jwt_path(self, request: Request, token: str)`**:
		- Check env vars: if `AUTH0_DOMAIN` or `AUTH0_AUDIENCE` is missing, raise 401 with `AUTH0_NOT_CONFIGURED`
		- Call `verify_auth0_jwt(token)` → None → 401
		- Call `get_auth0_user_info(token)` or Management API to get `app_metadata`
		- Check `app_metadata.status`:
			- If `"approved"`: continue
			- If `"waitlist"`: raise 403 with code `WAITLIST_NOT_APPROVED`
			- If `"suspended"`: raise 403 with code `WAITLIST_NOT_APPROVED`
			- If missing/None: continue (trust but verify — allow, Auth0 Action should handle blocking)
		- Extract `sub` claim → look up developer via `request.app.state.store.get_developer_by_auth0_id(sub)`
			- If None: raise 403 with code `DEVELOPER_NOT_FOUND` (developer must register first)
		- Check scope: `self.scope.value` must be in `claims.get('permissions', [])`
			- If missing: raise 403 with code `INSUFFICIENT_SCOPE`
		- Set `request.state.developer` only (NOT app, api_key, or plan — those are M2M-only concepts per spec)
		- Store claims on `request.state.auth0_claims` for downstream use (e.g., admin.register)

- [x] 4.4 **auth.py** — Added helper methods: `_unauthorized()`, `_forbidden()`, `_too_many_requests()`, and `ScopeRequiredJWT` class for register endpoint:

	- `_unauthorized(self, msg: str)` → HTTPException(401, ...)
	- `_forbidden(self, code: str, msg: str)` → HTTPException(403, ...)

- [x] 4.5 **server.py** — Updated `custom_openapi()` to use real Auth0 domain from env var, added `ApiKeyAuth` scheme:

	- Read `AUTH0_DOMAIN` from env (fallback to placeholder if not set)
	- Replace the hardcoded `{tenant}.auth0.com` with the actual domain:

		```python
		auth0_domain = os.getenv('AUTH0_DOMAIN', '{tenant}.auth0.com')
		openapi_schema['components']['securitySchemes'] = {
			'Auth0OAuth2': {
				'type': 'oauth2',
				'flows': {
					'authorizationCode': {
						'authorizationUrl': f'https://{auth0_domain}/authorize',
						'tokenUrl': f'https://{auth0_domain}/oauth/token',
						'scopes': { ... },  # same as current
					},
				},
			},
		}
		```

	- Keep the API key security scheme as well (for M2M fiscal endpoints):

		```python
		'ApiKeyAuth': {
			'type': 'apiKey',
			'in': 'header',
			'name': 'Authorization',
			'description': 'API key: Bearer fa_<key>',
		}
		```

	- Set `openapi_schema['security']` to an empty list (per-endpoint security is more precise) or keep both schemes.

---

## Phase 5: Admin Endpoints

*Depends on: Phase 4 (Auth0 JWT, extended ScopeRequired)*

- [x] 5.1 **admin.py** — Updated imports: replaced module-level store functions with `RedisStore`, added `ScopeRequiredJWT`, `ConflictError`:

- [x] 5.2 **admin.py** — Added `require_jwt=True` to all existing `ScopeRequired` usages (apps, keys, me):

	- `POST /v1/admin/apps`: `Depends(ScopeRequired(Scope.ADMIN_WRITE, require_jwt=True))`
	- `POST /v1/admin/keys`: `Depends(ScopeRequired(Scope.ADMIN_WRITE, require_jwt=True))`
	- `GET /v1/admin/keys`: `Depends(ScopeRequired(Scope.ADMIN_READ, require_jwt=True))`
	- `GET /v1/admin/me`: `Depends(ScopeRequired(Scope.ADMIN_READ, require_jwt=True))`

- [x] 5.3 **admin.py** — Refactored `POST /v1/admin/register` to use `ScopeRequiredJWT` (verifies JWT, checks waitlist, checks scope, does NOT look up developer). Links `auth0_id` from JWT `sub` claim via `store.register_developer(name, email, auth0_id=sub)`. Returns 409 on duplicate email.

- [x] 5.4 **admin.py** — Updated all endpoint store calls from module-level to `request.app.state.store`:

	- `POST /v1/admin/apps`: `create_app(developer.id, ...)` → `await request.app.state.store.create_app(developer.id, ...)`
	- `POST /v1/admin/keys`: `create_api_key(request.app_id)` → `await request.app.state.store.create_api_key(request.app_id)`
	- `GET /v1/admin/keys`: `list_developer_keys(developer.id)` → `await request.app.state.store.list_developer_keys(developer.id)`
	- `GET /v1/admin/me`: already uses `req.state.developer` — no store call needed, but ensure developer is populated by JWT path
	- Make all endpoint handlers `async` (some may already be async, verify)

- [x] 5.5 **admin.py** — Updated response models: 409 on register, 401/403 descriptions reference JWT instead of API key, 404 on key creation for missing app:

---

## Verification

- [x] 6.1 **Verified against all 29 requirements and 54 scenarios** — Systematic cross-check completed. See apply summary for full table.

	| Domain | Reqs | Scenarios | Verification approach |
	|--------|------|-----------|-----------------------|
	| redis-persistence | 5 | 10 | Read-After-Write test with each entity type; key schema audit; empty/non-empty seed test; model round-trip with `model_dump`/`model_validate` |
	| auth0-integration | 6 | 12 | Valid/invalid JWT test; JWKS cache timing; user lookup; waitlist/suspended/rejected flows; Action redirect test; missing config test |
	| api-auth | 4 | 9 | API key path still works; JWT path works; M2M fields not set on JWT path; fa_/non-fa_ routing; developer lookup by auth0_id; permissions check |
	| admin-api | 6 | 9 | JWT-only enforcement; register links auth0_id; dupe email rejection; create app/key from JWT identity; me returns JWT-linked developer; waitlist rejection |
	| rate-limiting | 6 | 9 | Minute/day sliding window; same interface shape; middleware enforces 429; health skip; plan-based limits; TTL auto-cleanup |
	| tenant-identity | 2 | 5 | auth0_id on Developer model; empty default; lookup by auth0_id; unknown auth0_id returns None |

- [x] 6.2 **Edge case review** completed:
	- Redis failure: fail fast per design (no silent fallback) — spec vs design discrepancy noted
	- Missing permissions claim → 403 `INSUFFICIENT_SCOPE` ✅
	- API key on register → 401 `AUTH0_JWT_REQUIRED` (ScopeRequiredJWT rejects fa_ prefix) ✅
	- Concurrent registration: eventual consistency accepted for MVP (check-then-set race)
	- JWKS rotation: `_get_jwks_key` re-fetches on cache miss ✅

- [x] 6.3 **Seed data verification** — Code review confirms:
	- Free plan created via HSET into `_KEY_PLAN` ✅
	- Admin developer created via HSET into `_KEY_DEVELOPER` + email index SET ✅
	- Admin app created via HSET into `_KEY_APP` + dev-apps SADD ✅
	- Admin API key created via HSET into `_KEY_APIKEY` + keyhash SET + app-keys SADD ✅
	- Admin key logged at INFO level for onboarding ✅

- [x] 6.4 **Migration test** — Code review confirms `seed_defaults()` idempotency:
	- Checks via SCAN `tenant:*` — if any keys exist, skips seeding ✅
	- Empty Redis → creates Free plan, admin developer, app, key ✅
	- Non-empty Redis → preserved (no overwrite) ✅
	- No in-memory data migration (by design) ✅

---

## Dependency Graph

```
Phase 1 (Foundation)
  ├── 1.1 pyproject.toml (redis[hiredis])
  ├── 1.2 .env (env vars)
  └── 1.3 models.py (auth0_id)
       │
Phase 2 (Redis Store) ← depends on 1.1, 1.3
  ├── 2.1 Store class + key schema
  ├── 2.2 CRUD methods
  ├── 2.3 Remove old module-level store
  └── 2.4 server.py lifespan (async Redis connect/seed)
       │
Phase 3 (Rate Limiter) ← depends on Phase 2 (needs Redis connection)
  ├── 3.1 rate_limiter.py (Redis Sorted Set)
  └── 3.2 server.py middleware enforcement
       │
Phase 4 (Auth0) ← depends on Phase 2 (developer lookup), 1.2 (env vars)
  ├── 4.1 JWKS fetcher + JWT verifier
  ├── 4.2 Management API client
  ├── 4.3 Dual-mode ScopeRequired
  └── 4.4 server.py OpenAPI update
       │
Phase 5 (Admin) ← depends on Phase 4 (require_jwt, ScopeRequired)
  ├── 5.1 Import updates
  ├── 5.2 require_jwt=True on all endpoints
  ├── 5.3 Register endpoint (JWT-only, links auth0_id)
  ├── 5.4 Store calls via request.app.state.store
  └── 5.5 Response model updates
```

---

## Chained PR Mapping

If following the recommended 2-PR split:

| PR | Phases | Key Deliverable | Merge Target |
|----|--------|-----------------|--------------|
| **PR 1: Redis Foundation** | 1, 2, 3 | In-memory → Redis. Data survives restart. Rate limiter uses Redis. API key auth unchanged. | `main` or `dev` |
| **PR 2: Auth0 Integration** | 4, 5 | Auth0 JWT auth for admin. Register links Auth0 users. Waitlist enforced. | `main` or `dev` (after PR 1) |
