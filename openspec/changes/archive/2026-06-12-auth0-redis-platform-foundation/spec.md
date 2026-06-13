# Spec: Auth0 + Redis Platform Foundation

## 1. redis-persistence (NEW)

### Purpose

Reemplazar el almacenamiento en memoria (`fiscal_agent/api/store.py`) con Redis
para que los datos de tenant sobrevivan a reinicios del servidor.

### Requirements

#### Requirement 1.1: Redis connection pool via lifespan

The system MUST establish an `redis.asyncio` connection pool on application
startup configured from `REDIS_URL` env var. On shutdown, the pool MUST be
closed cleanly.

##### Scenario: Redis connects on startup

- GIVEN `REDIS_URL` is set in the environment
- WHEN the FastAPI lifespan starts
- THEN a Redis connection pool MUST be created
- AND the pool MUST be accessible throughout the application

##### Scenario: Redis unavailable at startup

- GIVEN Redis is not reachable at `REDIS_URL`
- WHEN the lifespan starts
- THEN the system MUST log a warning
- AND MUST fall back to in-memory store gracefully

#### Requirement 1.2: Key schema

Tenant data MUST use key schema `tenant:{entity}:{id}` for hashes and
`tenant:keyhash:{hash}` for API key hash-to-ID lookup.

- Developers → `tenant:developer:{id}`
- Apps → `tenant:app:{id}`
- API keys → `tenant:apikey:{id}`
- Plans → `tenant:plan:{id}`
- Key hash → `tenant:keyhash:{sha256}` (string: api_key_id)

##### Scenario: All entities follow schema

- GIVEN any tenant entity (developer, app, api_key, plan, keyhash)
- WHEN persisted to Redis
- THEN its key MUST match the `tenant:{entity}:{id}` pattern

#### Requirement 1.3: Full CRUD parity with in-memory store

All operations from `store.py` MUST be ported to Redis:
`register_developer`, `create_app`, `create_api_key`, `resolve_api_key`,
`list_developer_keys`.

##### Scenario: Read after write returns correct data

- GIVEN a developer created via `register_developer()`
- WHEN the same developer is retrieved
- THEN the data MUST match what was written

##### Scenario: resolve_api_key traverses the chain

- GIVEN a valid full API key in Redis
- WHEN `resolve_api_key()` is called
- THEN it MUST return (Developer, App, ApiKey, Plan)
- AND each entity MUST be resolved from Redis

#### Requirement 1.4: Seed on empty Redis

On startup, if Redis has no tenant data, `seed_defaults()` MUST create the Free
plan and admin developer.

##### Scenario: Empty Redis gets seeded

- GIVEN a fresh Redis instance with no tenant keys
- WHEN the lifespan starts
- THEN seed data MUST be created in Redis

##### Scenario: Non-empty Redis is preserved

- GIVEN a Redis instance with existing tenant data
- WHEN the lifespan starts
- THEN no new seed data MUST be created

#### Requirement 1.5: Pydantic v2 serialization

Models MUST round-trip through Redis hashes via `model_dump()` and
`model_validate()`. Datetime fields MUST be stored as ISO 8601 strings.

##### Scenario: Model round-trip preserves data

- GIVEN any tenant model (Developer, App, ApiKey, Plan)
- WHEN serialized to dict, stored in Redis hash, retrieved, and deserialized
- THEN the result MUST equal the original

---

## 2. auth0-integration (NEW)

### Purpose

Integrar Auth0 como proveedor de identidad: verificación JWT RS256 vía JWKS,
Management API para estado de usuarios, y flujo de waitlist.

### Requirements

#### Requirement 2.1: JWT verification via JWKS

The system MUST verify Auth0-issued JWT tokens using RS256 against the JWKS
endpoint at `https://{AUTH0_DOMAIN}/.well-known/jwks.json`.

##### Scenario: Valid JWT is accepted

- GIVEN a valid RS256 JWT signed by Auth0
- WHEN the system verifies the token
- THEN it MUST decode payload claims successfully

##### Scenario: Invalid signature is rejected

- GIVEN a JWT with an invalid signature
- WHEN verified
- THEN status MUST be 401

##### Scenario: Expired JWT is rejected

- GIVEN an expired JWT
- WHEN verified
- THEN status MUST be 401

#### Requirement 2.2: JWKS key cache with refresh

The JWKS key set MUST be cached in memory and SHOULD refresh periodically
(e.g., every 10 minutes).

##### Scenario: JWKS cached after first verification

- GIVEN a valid Auth0 domain
- WHEN the first JWT verification occurs
- THEN the JWKS MUST be fetched and cached
- AND subsequent verifications MUST use the cache

#### Requirement 2.3: Auth0 Management API client

The system MUST provide a client for Auth0 Management API to look up user info
by Auth0 user ID and check `app_metadata.status`.

##### Scenario: User lookup by auth0_id

- GIVEN a valid Management API token
- WHEN looking up a user by `auth0_id`
- THEN the user info including `app_metadata` MUST be returned

##### Scenario: Unknown user returns None

- GIVEN a non-existent `auth0_id`
- WHEN looking up the user
- THEN the result MUST be None (no error raised)

#### Requirement 2.4: Waitlist status workflow

The system MUST read `app_metadata.status` from Auth0. Valid values:
`"waitlist"`, `"approved"`, `"suspended"`. Users with status `"waitlist"` or
`"suspended"` MUST be rejected.

##### Scenario: Approved user passes

- GIVEN a JWT with `app_metadata.status = "approved"`
- WHEN authenticating
- THEN the user MUST be allowed through

##### Scenario: Waitlist user blocked

- GIVEN a JWT with `app_metadata.status = "waitlist"`
- WHEN accessing any admin endpoint
- THEN status MUST be 403
- AND `ApiError.code` MUST be `"WAITLIST_NOT_APPROVED"`

##### Scenario: Suspended user blocked

- GIVEN a JWT with `app_metadata.status = "suspended"`
- WHEN accessing any admin endpoint
- THEN status MUST be 403

#### Requirement 2.5: Auth0 Action for waitlist redirect

An Auth0 Action MUST be deployed that checks `app_metadata.status` after login
and redirects waitlist users to a "pending approval" page instead of issuing a
session token.

##### Scenario: Post-login redirect for waitlist

- GIVEN a user who just logged in via Auth0
- WHEN `app_metadata.status = "waitlist"`
- THEN the action MUST redirect to a waiting page
- AND MUST NOT issue a session token

#### Requirement 2.6: Environment configuration

The system MUST read `AUTH0_DOMAIN` and `AUTH0_AUDIENCE` from env vars. If
either is missing, Auth0 JWT authentication MUST be disabled with a warning.

##### Scenario: Missing Auth0 config disables JWT auth

- GIVEN `AUTH0_DOMAIN` is not set
- WHEN the server starts
- THEN Auth0 JWT auth MUST be disabled
- AND a warning MUST be logged

---

## 3. api-auth (MODIFIED)

### Modified Requirements

#### Requirement 3.1: Dual-mode auth — API key OR Auth0 JWT

`ScopeRequired` MUST accept credentials in two forms:
- `Bearer fa_*` → API key resolution via Redis (existing flow)
- `Bearer <JWT>` → Auth0 RS256 JWT verification (new flow)

(Previously: `ScopeRequired` only accepted API key via `X-API-Key` or Bearer)

##### Scenario: API key auth still works for fiscal endpoints

- GIVEN a valid API key `fa_*` with required scope
- WHEN `ScopeRequired` processes the request
- THEN it MUST resolve via Redis key hash (unchained flow)
- AND populate `request.state` with developer, app, api_key, plan

##### Scenario: Auth0 JWT auth works for admin endpoints

- GIVEN a valid Auth0 JWT with `app_metadata.status = "approved"`
- WHEN `ScopeRequired` processes the request
- THEN it MUST verify the JWT signature and extract claims
- AND populate `request.state.developer` from Auth0 identity + Redis

##### Scenario: JWT path does NOT set M2M fields

- GIVEN a request authenticated via Auth0 JWT
- WHEN `ScopeRequired` completes
- THEN `request.state.app`, `request.state.api_key`, and `request.state.plan`
  MUST NOT be set (those are M2M-only concepts)

#### Requirement 3.2: Token type detection

The system MUST detect credential type by inspecting the Bearer token prefix.
Tokens starting with `fa_` are API keys; all others are treated as JWT.

##### Scenario: fa_ prefix triggers API key path

- GIVEN `Authorization: Bearer fa_a1b2c3...`
- WHEN `ScopeRequired` runs
- THEN the API key resolution path MUST be used

##### Scenario: Non-fa_ token triggers JWT path

- GIVEN `Authorization: Bearer eyJhbGci...` (a JWT)
- WHEN `ScopeRequired` runs
- THEN the Auth0 JWT verification path MUST be used

#### Requirement 3.3: JWT developer lookup

When authenticated via JWT, the system MUST extract `sub` from token claims,
look up developer in Redis by `auth0_id`, and set `request.state.developer`.

##### Scenario: Developer exists in Redis by auth0_id

- GIVEN a JWT with `sub = "auth0|123"`
- AND a developer in Redis with `auth0_id = "auth0|123"`
- WHEN `ScopeRequired` processes the request
- THEN `request.state.developer` MUST be the matching Developer

##### Scenario: Developer not found in Redis

- GIVEN a valid JWT signature
- BUT no developer in Redis with the JWT's `sub`
- WHEN `ScopeRequired` processes the request
- THEN status MUST be 403
- AND `ApiError.code` MUST be `"DEVELOPER_NOT_FOUND"`

#### Requirement 3.4: Scopes from JWT permissions

When authenticated via JWT, the system MUST check scopes from the JWT
`permissions` claim (Auth0-issued permissions array).

##### Scenario: JWT has required permission

- GIVEN a JWT with `permissions: ["admin:read", "admin:write"]`
- WHEN checking `ScopeRequired(Scope.ADMIN_READ)`
- THEN the dependency MUST succeed

##### Scenario: JWT lacks required permission

- GIVEN a JWT with `permissions: ["calendar:read"]`
- WHEN checking `ScopeRequired(Scope.ADMIN_WRITE)`
- THEN status MUST be 403
- AND `ApiError.code` MUST be `"INSUFFICIENT_SCOPE"`

---

## 4. admin-api (MODIFIED)

### Modified Requirements

#### Requirement 4.1: Admin endpoints require Auth0 JWT

All `/v1/admin/*` endpoints MUST require Auth0 JWT authentication. API key
authentication MUST be rejected for admin endpoints.

(Previously: Admin endpoints accepted API key auth via `ScopeRequired`)

##### Scenario: Admin endpoint with JWT succeeds

- GIVEN a valid Auth0 JWT with `admin:write` permission
- WHEN `POST /v1/admin/keys`
- THEN the request MUST proceed

##### Scenario: Admin endpoint with API key is rejected

- GIVEN a valid API key with `admin:write` scope
- WHEN any `/v1/admin/*` endpoint
- THEN status MUST be 401
- AND `ApiError.code` MUST be `"AUTH0_JWT_REQUIRED"`

#### Requirement 4.2: POST /v1/admin/register requires JWT

`POST /v1/admin/register` MUST require Auth0 JWT authentication. The created
developer MUST be linked to the Auth0 user via `auth0_id`.

(Previously: POST /v1/admin/register was a public endpoint with no auth)

##### Scenario: Register creates developer linked to Auth0 user

- GIVEN an approved Auth0 JWT with `sub = "auth0|123"`
- WHEN `POST /v1/admin/register` with `{"name": "Alice", "email": "alice@e.com"}`
- THEN a Developer MUST be created in Redis
- AND `developer.auth0_id` MUST be `"auth0|123"`
- AND status MUST be 201

##### Scenario: Duplicate email returns 409

- GIVEN a developer with email `alice@e.com` already exists in Redis
- WHEN `POST /v1/admin/register` with the same email
- THEN status MUST be 409
- AND `ApiError.code` MUST be `"EMAIL_ALREADY_EXISTS"`

#### Requirement 4.3: POST /v1/admin/apps requires JWT + admin:write

`POST /v1/admin/apps` MUST require Auth0 JWT with `admin:write` scope.
The developer is identified from the JWT-linked developer.

(Previously: POST /v1/admin/apps used API key auth with admin:write scope)

##### Scenario: Create app from JWT identity

- GIVEN an approved Auth0 JWT linked to a developer
- WHEN `POST /v1/admin/apps` with valid data
- THEN the App MUST be created with `developer_id` from the JWT-linked developer
- AND status MUST be 201

#### Requirement 4.4: POST /v1/admin/keys requires JWT + admin:write

`POST /v1/admin/keys` MUST require Auth0 JWT with `admin:write` scope.

(Previously: POST /v1/admin/keys used API key auth with admin:write scope)

##### Scenario: Generate API key with JWT

- GIVEN an approved Auth0 JWT linked to a developer with an existing app
- WHEN `POST /v1/admin/keys` with a valid `app_id`
- THEN a new API key MUST be created in Redis
- AND the full key MUST be returned once

##### Scenario: Key for nonexistent app

- GIVEN an `app_id` that does not exist in Redis
- WHEN `POST /v1/admin/keys`
- THEN status MUST be 404
- AND `ApiError.code` MUST be `"APP_NOT_FOUND"`

#### Requirement 4.5: GET endpoints return data from JWT identity

`GET /v1/admin/keys` and `GET /v1/admin/me` MUST return data from the
developer linked to the authenticated JWT identity.

(Previously: These endpoints returned data from API-key-resolved
`request.state.developer`)

##### Scenario: Me returns JWT-linked developer

- GIVEN an approved Auth0 JWT linked to a developer
- WHEN `GET /v1/admin/me`
- THEN status MUST be 200
- AND `result` MUST be the Developer linked to the JWT's `sub`

##### Scenario: List keys returns developer's keys

- GIVEN an approved Auth0 JWT linked to a developer with 2 API keys
- WHEN `GET /v1/admin/keys`
- THEN status MUST be 200
- AND `result.keys` MUST be a list of ApiKey objects

#### Requirement 4.6: Waitlist rejection before handler

The system MUST reject waitlist users (status `"waitlist"`) with 403 BEFORE any
admin handler executes.

##### Scenario: Waitlist user blocked from all admin endpoints

- GIVEN a valid Auth0 JWT with `app_metadata.status = "waitlist"`
- WHEN `GET /v1/admin/me`
- THEN status MUST be 403
- AND `ApiError.code` MUST be `"WAITLIST_NOT_APPROVED"`

##### Scenario: Suspended user blocked

- GIVEN a valid Auth0 JWT with `app_metadata.status = "suspended"`
- WHEN `GET /v1/admin/me`
- THEN status MUST be 403
- AND `ApiError.code` MUST be `"WAITLIST_NOT_APPROVED"`

---

## 5. rate-limiting (MODIFIED)

### Modified Requirements

#### Requirement 5.1: Redis-based sliding window

The rate limiter MUST use a Redis Sorted Set for sliding window counters per API
key, replacing the in-memory fixed window.

(Previously: In-memory fixed window counters per API key — reset on restart)

##### Scenario: Requests tracked in sliding minute window

- GIVEN an API key with `rate_limit_rpm = 10`
- WHEN 10 requests arrive within 60 seconds
- THEN the 11th request MUST return 429

##### Scenario: Window slides and allows new requests

- GIVEN an API key with `rate_limit_rpm = 10`
- WHEN 10 requests arrive at T=0
- AND the 11th request arrives at T=61
- THEN the 11th request MUST succeed (window slid past first request)

#### Requirement 5.2: Same `check_rate_limit()` interface

The `check_rate_limit(api_key_id, plan)` function MUST keep the same return
shape: `{allowed: bool, limit: int, remaining: int, retry_after: int}`.

(Previously: check_rate_limit existed with same interface but in-memory)

##### Scenario: Rate limit response format unchanged

- GIVEN a call to `check_rate_limit("key_01", plan)` within limits
- THEN `allowed` MUST be `true`
- AND `remaining` MUST be a non-negative integer
- AND `limit` MUST match the plan's RPM

#### Requirement 5.3: Minute and day sliding windows

The system MUST track two independent sliding windows per API key: 60-second
(minute) and 86,400-second (day).

##### Scenario: Day window allows requests after minute reset

- GIVEN a plan with `rate_limit_rpm = 10`, `rate_limit_rpd = 100`
- WHEN 10 requests arrive in minute 1 (RPM exhausted)
- AND 1 request arrives in minute 2 (RPM reset)
- THEN the minute-2 request MUST succeed if RPD is not exceeded

##### Scenario: Day window exhausted blocks request

- GIVEN a plan with `rate_limit_rpd = 100`
- WHEN 100 requests arrive within the same calendar day
- THEN the 101st request MUST return 429

#### Requirement 5.4: Rate limit middleware actually enforces

The HTTP middleware in `server.py` MUST call `check_rate_limit()` and return 429
when exceeded. Currently it is a no-op pass-through.

(Previously: Rate limit middleware skipped all enforcement — always called
`call_next`)

##### Scenario: Middleware blocks exceeded request

- GIVEN 10 requests already tracked for an API key (RPM exhausted)
- WHEN an 11th request arrives within the minute
- THEN the middleware MUST return 429 before the route handler

##### Scenario: Skips rate limiting for health endpoint

- GIVEN a request to `GET /v1/health` with any API key
- WHEN the rate limit middleware runs
- THEN the request MUST pass through without rate check

#### Requirement 5.5: Plan-based limits from model

Rate limits MUST be read from `Plan.rate_limit_rpm` and `Plan.rate_limit_rpd`.

##### Scenario: Higher RPM from plan

- GIVEN a plan with `rate_limit_rpm = 1000`
- WHEN 500 requests arrive in one minute
- THEN all MUST be allowed

#### Requirement 5.6: Redis key TTL cleanup

Sorted Set keys for rate limiting SHOULD have a TTL to auto-clean after
inactivity (e.g., 2x the window size).

##### Scenario: Minute window key auto-expires

- GIVEN a Redis key for minute-window rate limiting
- WHEN 120 seconds pass since last request
- THEN the key MUST be removed by TTL

---

## 6. tenant-identity (MODIFIED)

### Modified Requirements

#### Requirement 6.1: Developer model gains optional auth0_id

The `Developer` model MUST include an optional `auth0_id: str = ''` field.

(Previously: Developer had no `auth0_id` field)

##### Scenario: Developer from seed has empty auth0_id

- GIVEN a developer created via seed data (no Auth0 integration)
- WHEN inspecting `developer.auth0_id`
- THEN it MUST be `""`

##### Scenario: Developer registered via Auth0 has auth0_id set

- GIVEN a developer registered via `POST /v1/admin/register` with an Auth0 JWT
- WHEN inspecting `developer.auth0_id`
- THEN it MUST equal the JWT's `sub` claim

#### Requirement 6.2: Developer lookup by auth0_id

The system MUST support looking up a Developer by `auth0_id`.

##### Scenario: Lookup by auth0_id returns developer

- GIVEN a developer with `auth0_id = "auth0|123"`
- WHEN querying by that `auth0_id`
- THEN the matching Developer MUST be returned

##### Scenario: Lookup by unknown auth0_id returns None

- GIVEN no developer with `auth0_id = "auth0|999"`
- WHEN querying by that `auth0_id`
- THEN the result MUST be None

### Removed Requirements

#### Requirement 6.R1: No persistence or validation logic (modified scope)

(Reason: Models are no longer pure data contracts in isolation — `auth0_id`
implies Auth0 integration. However, models MUST still NOT include persistence,
hashing, encryption, or HTTP logic. The `auth0_id` field is data-only, not
behavior.)

---

## Summary of Changes

| Domain | Type | Requirements | Scenarios |
|--------|------|-------------|-----------|
| redis-persistence | New (full) | 5 | 10 |
| auth0-integration | New (full) | 6 | 12 |
| api-auth | Modified (delta) | 4 | 9 |
| admin-api | Modified (delta) | 6 | 9 |
| rate-limiting | Modified (delta) | 6 | 9 |
| tenant-identity | Modified (delta) | 2 + 1 removed | 5 |

**Total**: 29 requirements, 54 scenarios
