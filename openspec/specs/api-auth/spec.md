# API Auth Specification — Bearer Token Migration

> Updated 2026-06-18: Migrated from `X-API-Key`-only to `Authorization: Bearer`
> with `X-API-Key` fallback (transition period). Added full entity chain resolution
> (ApiKey → App → Developer → Plan) via Redis SHA-256 hash lookup.

## Purpose

Secure every API request via Bearer token. Extract the token, SHA-256 hash it,
look up the key in Redis (`tenant:keyhash:{hash}`), resolve `ApiKey → App →
Developer → Plan`, and inject everything into `request.state`. Return 401 or
403 before the route handler executes.

## Data Contract

Models defined in `openspec/specs/tenant-identity/spec.md` — this spec does
NOT redefine types. The `RedisStore` class in `fiscal_agent/api/store.py`
provides the lookup methods.

## Requirements

### Requirement 1: Bearer token extraction (with X-API-Key fallback)

The middleware MUST extract the token from the `Authorization` header using the
`Bearer` scheme (preferred). If the `Authorization` header is missing, the
middleware MUST fall back to the `X-API-Key` header (legacy, transition only).

If the `Authorization` header uses a different scheme (e.g. `Basic`, `Digest`),
the request MUST NOT proceed.

If neither header is present, the request MUST return 401.

#### Scenario: Valid Bearer header

- GIVEN a request with `Authorization: Bearer fa_abc123...`
- WHEN the middleware extracts the token
- THEN the extracted raw key MUST be `"fa_abc123..."`

#### Scenario: Missing Authorization header, X-API-Key present

- GIVEN a request with `X-API-Key: fa_abc123...` but NO `Authorization` header
- WHEN the middleware inspects the request
- THEN the extracted raw key MUST be `"fa_abc123..."`
- AND the request MUST proceed to scope/plan resolution

#### Scenario: Both headers present — Bearer takes priority

- GIVEN a request with BOTH `Authorization: Bearer fa_def...` AND
  `X-API-Key: fa_abc...`
- WHEN the middleware inspects the request
- THEN `Authorization: Bearer` MUST take priority
- AND `X-API-Key` MUST be ignored

#### Scenario: No API key header

- GIVEN a request to any endpoint
- WHEN the request does NOT include `Authorization` or `X-API-Key` header
- THEN status MUST be 401
- AND `UnifiedResponse.status` MUST be `"error"`
- AND `ApiError.code` MUST be `"UNAUTHORIZED"`

#### Scenario: Wrong auth scheme

- GIVEN a request with `Authorization: Basic dXNlcjpwYXNz`
- WHEN the middleware inspects the header
- THEN status MUST be 401
- AND `UnifiedResponse.error.code` MUST be `"UNAUTHORIZED"`

### Requirement 2: SHA-256 hash lookup in Redis

The middleware MUST hash the raw key with SHA-256 and look up
`tenant:keyhash:{hash}` in Redis. The value stored at that key is the
`api_key_id` string.

#### Scenario: Hash found in Redis

- GIVEN a raw key `"fa_abc123..."`
- WHEN computing `sha256("fa_abc123...")` → `"a1b2c3..."`
- AND looking up `tenant:keyhash:a1b2c3...`
- THEN the value MUST be an `api_key_id` (e.g. `"key_01"`)

#### Scenario: Hash not found (invalid key)

- GIVEN a raw key whose SHA-256 hash does NOT exist in Redis
- WHEN the middleware performs the lookup
- THEN status MUST be 401
- AND `UnifiedResponse.error.code` MUST be `"UNAUTHORIZED"`

### Requirement 3: Resolve ApiKey → App → Developer → Plan

After finding the `api_key_id`, the middleware MUST resolve the full entity
chain from Redis:

1. `tenant:apikey:{api_key_id}` → `ApiKey`
2. `tenant:app:{app_id}` → `App`
3. `tenant:developer:{developer_id}` → `Developer`
4. `tenant:plan:{plan_id}` → `Plan` (via `RedisStore._resolve_plan()`)

#### Scenario: Full chain resolved

- GIVEN a valid API key hash pointing to `key_01`
- WHEN the middleware resolves the chain
- THEN `app_id` comes from the `ApiKey.app_id` field
- AND `developer_id` comes from the `App.developer_id` field
- AND a matching `Plan` is found via scope matching

#### Scenario: ApiKey exists but App is missing

- GIVEN a valid ApiKey whose `app_id` does NOT exist in Redis
- WHEN the middleware tries to resolve the App
- THEN status MUST be 403
- AND `UnifiedResponse.error.code` MUST be `"API_KEY_INVALID"`

### Requirement 4: Inject resolved entities into `request.state`

On successful resolution, the middleware MUST inject four objects into
`request.state`:

| Attribute | Type | Source |
|-----------|------|--------|
| `request.state.developer` | `Developer` | Developer resolved from App |
| `request.state.app` | `App` | App resolved from ApiKey |
| `request.state.api_key` | `ApiKey` | ApiKey resolved from hash |
| `request.state.plan` | `Plan` | Plan resolved from scopes |

#### Scenario: State populated after success

- GIVEN a valid key with full chain resolvable
- WHEN the middleware finishes and the request reaches the route handler
- THEN `request.state.developer` MUST be a non-None `Developer` instance
- AND `request.state.app` MUST be a non-None `App` instance
- AND `request.state.api_key` MUST be a non-None `ApiKey` instance
- AND `request.state.plan` MUST be a non-None `Plan` instance

### Requirement 5: Inactive/suspended entities → 403

If the ApiKey, App, or Developer is inactive or suspended, the middleware
MUST return 403 with a specific error code.

#### Scenario: Deactivated API key

- GIVEN an ApiKey with `is_active=False`
- WHEN the middleware inspects the key status
- THEN status MUST be 403
- AND `UnifiedResponse.error.code` MUST be `"API_KEY_INACTIVE"`

#### Scenario: Suspended App

- GIVEN an App with `status="suspended"`
- WHEN the middleware inspects the app status
- THEN status MUST be 403
- AND `UnifiedResponse.error.code` MUST be `"APP_SUSPENDED"`

#### Scenario: Inactive Developer

- GIVEN a Developer with `is_active=False`
- WHEN the middleware inspects the developer status
- THEN status MUST be 403
- AND `UnifiedResponse.error.code` MUST be `"DEVELOPER_INACTIVE"`

### Requirement 6: Missing scope → 403

A valid active API key without the required scope MUST return 403.

#### Scenario: Wrong scope for endpoint

- GIVEN an API key with `scopes=["calendar:read"]`
- WHEN requesting `POST /v1/report` (requires `report:write`)
- THEN status MUST be 403
- AND `ApiError.code` MUST be `"INSUFFICIENT_SCOPE"`

### Requirement 7: `ScopeRequired(scope)` dependency

The system MUST provide a FastAPI dependency callable `ScopeRequired(scope)` that checks `request.state.api_key.scopes`.

#### Scenario: ScopeRequired passes

- GIVEN an endpoint decorated with `ScopeRequired("taxpayer:read")`
- WHEN `request.state.api_key.scopes` contains `"taxpayer:read"`
- THEN the dependency MUST succeed and let the handler execute

#### Scenario: ScopeRequired fails

- GIVEN an endpoint decorated with `ScopeRequired("report:write")`
- WHEN `request.state.api_key.scopes` does NOT contain `"report:write"`
- THEN the dependency MUST raise HTTPException 403

### Requirement 8: Middleware runs before route handlers

Auth middleware MUST execute before any route handler or dependency.

#### Scenario: 401 before handler logic

- GIVEN any endpoint
- WHEN the request has no valid auth headers
- THEN the response MUST be 401
- AND no route handler code MUST execute

### Requirement 9: Admin endpoints require admin scope

Endpoints under `/v1/admin/*` MUST require `admin:write` or `admin:read` scope.

#### Scenario: Admin endpoint with correct scope

- GIVEN an API key with `admin:write` scope
- WHEN requesting `POST /v1/admin/keys`
- THEN the request MUST proceed to the handler

#### Scenario: Admin endpoint without admin scope

- GIVEN an API key with `calendar:read` scope only
- WHEN requesting `GET /v1/admin/me`
- THEN status MUST be 403
- AND `ApiError.code` MUST be `"INSUFFICIENT_SCOPE"`

### Requirement 10: Public endpoints bypass auth

The health endpoint `/v1/health` and registration endpoint `POST /v1/admin/register`
MUST be publicly accessible without any authentication. Other public endpoints
MAY be added via an allow-list.

#### Scenario: Health check without auth

- GIVEN a request to `GET /v1/health` with NO `Authorization` header
- WHEN the middleware processes the request
- THEN the request MUST proceed without checking auth
- AND `request.state` MUST remain empty (no developer, no api_key, etc.)

## Non-Functional Requirements

| ID | Requirement | Target |
|----|-------------|--------|
| NFR-A1 | Hash lookup latency | MUST complete <5ms (Redis local network) |
| NFR-A2 | Full chain resolution | SHOULD complete <20ms |
| NFR-A3 | Auth middleware order | MUST run BEFORE rate limiter, AFTER CORS |

## File Manifest

| File | Change |
|------|--------|
| `fiscal_agent/api/middleware/auth.py` | **New** — ASGI Bearer auth middleware |
| `fiscal_agent/api/middleware/__init__.py` | Update — export `AuthMiddleware` |
| `fiscal_agent/api/server.py` | Update — wire `AuthMiddleware` |
| `fiscal_agent/api/store.py` | No change — `_KEY_KEYHASH` + resolution methods exist |
