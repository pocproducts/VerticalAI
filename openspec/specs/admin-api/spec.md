# Admin API Specification — Auth Re-enablement + Tenant Endpoints

> Updated 2026-06-18: Re-enabled previously disabled admin endpoints
> (which were returning `"AUTH_DISABLED"` errors) by reading from
> `request.state`. Added auto-provisioning on register (dev+app+key),
> ownership checks on key creation, and new tenant CRUD endpoints.

## Purpose

Endpoints de autoservicio para developers: registrarse, crear apps, generar
API keys, listar keys, ver perfil. Todos requieren autenticación por API key
con scope `admin:*`. Updated to read `request.state` (populated by auth
middleware) instead of request body params.

## Requirements

### Requirement 1: POST /v1/admin/register — open registration

This endpoint MUST remain open (no auth required). Creates a `Developer`
with the Free plan, and auto-provisions an initial `App` + `ApiKey` for
immediate use.

**Input:** `{"name": "...", "email": "..."}`

**Output:** `{developer, app, api_key, full_key}`

#### Scenario: Happy path — register with auto-provisioning

- GIVEN a POST with `{"name": "Alice", "email": "alice@example.com"}`
- WHEN `POST /v1/admin/register`
- THEN status MUST be 201
- AND `UnifiedResponse.result.developer` MUST be a `Developer` with
  `is_active=True`
- AND `UnifiedResponse.result.api_key` MUST contain the `ApiKey` model
- AND `UnifiedResponse.result.full_key` MUST contain the full raw key (shown
  ONCE)
- AND `UnifiedResponse.result.app` MUST be the created `App`

#### Scenario: Duplicate email

- GIVEN an existing developer with email `alice@example.com`
- WHEN `POST /v1/admin/register` with the same email
- THEN status MUST be 409
- AND `ApiError.code` MUST be `"EMAIL_ALREADY_EXISTS"`

### Requirement 2: POST /v1/admin/apps — create app for current developer

Creates an App for the authenticated developer. Input: `name`, `environment`.
`developer_id` is read from `request.state.developer.id`.

#### Scenario: Happy path — create app

- GIVEN an authenticated developer
- WHEN `POST /v1/admin/apps` with `{"name": "My App", "environment": "sandbox"}`
- THEN `developer_id` MUST be taken from `request.state.developer.id`
- AND status MUST be 201
- AND `UnifiedResponse.result` MUST be the created `App`

### Requirement 3: POST /v1/admin/keys — create key for current developer

Requires auth. Creates a new API key for an app owned by the current
developer (from `request.state`). Input: `app_id`.

#### Scenario: Happy path — generate key

- GIVEN an authenticated developer with an existing app
- WHEN `POST /v1/admin/keys` with `{"app_id": "app_01"}`
- THEN status MUST be 201
- AND `UnifiedResponse.result` MUST contain `ApiKey` with `key_preview` (last 4)
- AND the full raw key MUST be included (single opportunity)

#### Scenario: Key for app owned by another developer

- GIVEN an authenticated developer `dev_01` and an app owned by `dev_02`
- WHEN `POST /v1/admin/keys` with the other developer's app_id
- THEN status MUST be 404
- AND `ApiError.code` MUST be `"APP_NOT_FOUND"` (no information leak)

#### Scenario: Key for nonexistent app

- GIVEN an `app_id` that does not exist
- WHEN `POST /v1/admin/keys`
- THEN status MUST be 404
- AND `ApiError.code` MUST be `"APP_NOT_FOUND"`

### Requirement 4: GET /v1/admin/keys — list keys for current developer

Re-enables the previously disabled endpoint. Lists API keys for all apps
owned by `request.state.developer`.

#### Scenario: Happy path — list keys

- GIVEN an authenticated developer with 2 API keys across apps
- WHEN `GET /v1/admin/keys`
- THEN status MUST be 200
- AND `UnifiedResponse.result` MUST be a list of `ApiKey` objects
- AND each `ApiKey` MUST contain `key_preview` only (NOT full key)

### Requirement 5: GET /v1/admin/me — return current developer

This endpoint MUST return the `Developer` from `request.state.developer`.
Previously disabled with `"AUTH_DISABLED"`.

#### Scenario: Authenticated developer

- GIVEN an authenticated developer via valid API key
- WHEN `GET /v1/admin/me`
- THEN status MUST be 200
- AND `UnifiedResponse.result` MUST be the `Developer` object from
  `request.state.developer`

#### Scenario: Unauthenticated request

- GIVEN a request without a valid API key
- WHEN `GET /v1/admin/me`
- THEN status MUST be 401 (auth middleware blocks before handler)

### Requirement 6: GET /v1/admin/tenants — list tenants (admin only)

**New endpoint.** Lists all tenants. Requires `admin:read` scope.

#### Scenario: List tenants with admin scope

- GIVEN an API key with `admin:read` scope
- WHEN `GET /v1/admin/tenants`
- THEN status MUST be 200
- AND `UnifiedResponse.result` MUST be a list of `Tenant` objects

#### Scenario: List tenants without admin scope

- GIVEN an API key with only `calendar:read` scope
- WHEN `GET /v1/admin/tenants`
- THEN status MUST be 403
- AND `ApiError.code` MUST be `"INSUFFICIENT_SCOPE"`

### Requirement 7: POST /v1/admin/tenants — create tenant (admin only)

**New endpoint.** Creates a new tenant. Requires `admin:write` scope.

Input: `{"name", "cuit", "clave_fiscal", "plan_tier"}` (other fields optional).

#### Scenario: Create tenant with admin scope

- GIVEN an API key with `admin:write` scope
- WHEN `POST /v1/admin/tenants` with valid tenant data
- THEN status MUST be 201
- AND `UnifiedResponse.result` MUST be the created `Tenant`

#### Scenario: Duplicate CUIT

- GIVEN an existing tenant with `cuit="20324837796"`
- WHEN `POST /v1/admin/tenants` with the same CUIT
- THEN status MUST be 409
- AND `ApiError.code` MUST be `"TENANT_CUIT_EXISTS"`

### Requirement 8: UnifiedResponse envelope

All admin endpoints MUST return `UnifiedResponse[T]` as the output envelope.

#### Scenario: Error uses UnifiedResponse

- GIVEN a 404 from key generation
- WHEN inspecting the response
- THEN the body MUST contain `UnifiedResponse` with `status="error"`

### Requirement 9: Seed data on server start

On startup, the system MUST seed: a "Free" plan with basic scopes, and an
"admin" Developer with a pre-generated API key for testing.

#### Scenario: Pre-seeded admin developer

- GIVEN the server just started
- WHEN GET /v1/admin/me with the seeded admin API key
- THEN status MUST be 200
- AND `result.name` MUST be `"admin"`
- AND `result.is_active` MUST be `True`

#### Scenario: Free plan seeded with basic scopes

- GIVEN the server just started
- WHEN inspecting the in-memory plan for "Free"
- THEN `rate_limit_rpm` MUST be 10
- AND `rate_limit_rpd` MUST be 100
- AND `scopes` MUST include `["calendar:read", "taxpayer:read", "report:write"]`
