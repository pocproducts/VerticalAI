# Delta for API Auth — Clerk JWT Support

## ADDED Requirements

### Requirement: Clerk JWT Extraction

The auth middleware MUST support a `ClerkJWTExtractor` that validates Clerk JWTs. It MUST fetch the JWKS from Clerk, verify the JWT signature, and extract `org_id` and `sub` claims. An invalid or expired JWT MUST return 401.

#### Scenario: Valid Clerk JWT

- GIVEN a request with `Authorization: Bearer <valid_clerk_jwt>`
- WHEN `ClerkJWTExtractor` processes it
- THEN the JWT signature MUST be verified against Clerk's JWKS
- AND `org_id` and `sub` MUST be extracted from claims

#### Scenario: Expired JWT

- GIVEN a request with an expired Clerk JWT
- WHEN `ClerkJWTExtractor` processes it
- THEN status MUST be 401
- AND `ApiError.code` MUST be `"TOKEN_EXPIRED"`

#### Scenario: Invalid signature

- GIVEN a tampered JWT
- WHEN `ClerkJWTExtractor` processes it
- THEN status MUST be 401
- AND `ApiError.code` MUST be `"TOKEN_INVALID"`

### Requirement: JWKS Caching

The middleware MUST cache Clerk's JWKS in Redis with a 1-hour TTL. The JWKS MUST be fetched on first request and served from cache on subsequent requests. A cache miss MUST trigger a fresh fetch from Clerk.

#### Scenario: JWKS from cache

- GIVEN JWKS was cached 10 minutes ago
- WHEN a Clerk JWT request arrives
- THEN verification MUST use the cached JWKS
- AND no external fetch to Clerk is made

#### Scenario: Cache miss

- GIVEN no JWKS in Redis
- WHEN the first Clerk JWT request arrives
- THEN the middleware MUST fetch JWKS from Clerk
- AND cache it in Redis with TTL 3600s

### Requirement: org_id to tenant_id Resolution

The middleware MUST resolve Clerk `org_id` to the internal `tenant_id` via `TenantStore.get(org_id)`. The resolved `tenant_id` MUST be injected into `request.state.tenant_id`. If no org is active, a personal tenant SHOULD be derived from `sub`.

#### Scenario: org_id resolves

- GIVEN a Clerk JWT with `org_id: "org_123"`
- WHEN resolved via `TenantStore.get("org_123")`
- THEN the internal `tenant_id` MUST be returned
- AND `request.state.tenant_id` MUST be set

#### Scenario: Personal scope fallback

- GIVEN a Clerk JWT without `org_id`
- WHEN the middleware processes it
- THEN a personal tenant SHOULD be derived from `sub`

### Requirement: Coexistence with API Key Auth

Both `ApiKeyExtractor` and `ClerkJWTExtractor` MUST run in sequence. `ApiKeyExtractor` MUST be tried first (checks for `fa_` prefix). If it does not match, `ClerkJWTExtractor` MUST process the token. If both fail, 401 MUST be returned.

#### Scenario: API key takes priority

- GIVEN `Authorization: Bearer fa_abc123...`
- WHEN extractors run in sequence
- THEN `ApiKeyExtractor` MUST handle it (detects `fa_` prefix)
- AND `ClerkJWTExtractor` MUST be skipped

#### Scenario: Clerk JWT handled by Clerk extractor

- GIVEN `Authorization: Bearer <clerk_jwt>` (no `fa_` prefix)
- WHEN `ApiKeyExtractor` does not match
- THEN `ClerkJWTExtractor` MUST process the JWT
- AND on success, the request MUST proceed

#### Scenario: Both fail

- GIVEN an invalid token (not a valid API key nor Clerk JWT)
- WHEN both extractors fail
- THEN status MUST be 401
- AND `ApiError.code` MUST be `"UNAUTHORIZED"`

## MODIFIED Requirements

### Requirement: Bearer token extraction (with X-API-Key fallback and Clerk JWT support)

The middleware MUST extract the token from the `Authorization` header using the `Bearer` scheme (preferred). If the `Authorization` header is missing, the middleware MUST fall back to the `X-API-Key` header (legacy, transition only). The extracted token MUST then be evaluated by two extractors in sequence: `ApiKeyExtractor` (for `fa_`-prefixed keys) and `ClerkJWTExtractor` (for Clerk JWTs). If the `Authorization` header uses a different scheme (e.g. `Basic`, `Digest`), the request MUST NOT proceed. If neither header is present, the request MUST return 401.
(Previously: single extractor for API Key Bearer tokens only)

#### Scenario: Valid Bearer header (API key)

- GIVEN a request with `Authorization: Bearer fa_abc123...`
- WHEN the middleware extracts and routes the token
- THEN `ApiKeyExtractor` MUST process it
- AND `request.state` MUST be populated with `developer`, `app`, `api_key`, `plan`

#### Scenario: Valid Bearer header (Clerk JWT)

- GIVEN a request with `Authorization: Bearer <clerk_jwt>`
- WHEN the middleware extracts and routes the token
- THEN `ClerkJWTExtractor` MUST process it
- AND `request.state.tenant_id` MUST be set

#### Scenario: Missing auth header

- GIVEN a request without `Authorization` or `X-API-Key`
- WHEN the middleware inspects the request
- THEN status MUST be 401
- AND `ApiError.code` MUST be `"UNAUTHORIZED"`

#### Scenario: Wrong auth scheme

- GIVEN a request with `Authorization: Basic dXNlcjpwYXNz`
- WHEN the middleware inspects the header
- THEN status MUST be 401
- AND `ApiError.code` MUST be `"UNAUTHORIZED"`
