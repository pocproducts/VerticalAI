# Admin API Specification — Auth Re-enablement + Tenant Endpoints

> **Delta from** `openspec/specs/admin-api/spec.md`. This spec re-enables the
> previously disabled admin endpoints (which were returning
> `"AUTH_DISABLED"` errors) by reading from `request.state`, and adds new
> tenant management endpoints.

## Purpose

Restore the admin self-service API with real authentication from
`request.state` (populated by the auth middleware), and add tenant CRUD
endpoints for managing multi-tenant entities.

## Data Contract

Same output envelope: all admin endpoints return `UnifiedResponse[T]`.
Models: `Developer`, `App`, `ApiKey`, `Tenant` — defined in
`tenant-identity/spec.md` and `tenant-context/spec.md`.

## Requirements

### Requirement 1: GET /v1/admin/me — return current developer

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

### Requirement 2: POST /v1/admin/register — open registration

This endpoint MUST remain open (no auth required) for now. Creates a `Developer`
with the Free plan, and creates an initial `App` + `ApiKey` for immediate use.

`POST /v1/admin/register` with `{"name": "...", "email": "..."}`:
- Creates `Developer` (via `RedisStore.register_developer`)
- Creates an initial `App` named `"Default App"` with `environment="sandbox"`
- Creates an `ApiKey` with basic scopes for that app
- Returns `Developer` + `ApiKey` (full key shown once)

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

### Requirement 4: GET /v1/admin/keys — list keys for current developer

Re-enables the previously disabled endpoint. Lists API keys for all apps
owned by `request.state.developer`.

#### Scenario: Happy path — list keys

- GIVEN an authenticated developer with 2 API keys across apps
- WHEN `GET /v1/admin/keys`
- THEN status MUST be 200
- AND `UnifiedResponse.result` MUST be a list of `ApiKey` objects
- AND each `ApiKey` MUST contain `key_preview` only (NOT full key)

### Requirement 5: POST /v1/admin/apps — create app for current developer

Updates the existing endpoint to use `request.state.developer.id` instead of
an explicit `developer_id` parameter.

#### Scenario: Create app for current developer

- GIVEN an authenticated developer
- WHEN `POST /v1/admin/apps` with `{"name": "My App", "environment": "sandbox"}`
- THEN `developer_id` MUST be taken from `request.state.developer.id`
- AND status MUST be 201
- AND `UnifiedResponse.result` MUST be the created `App`

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

## File Manifest

| File | Change |
|------|--------|
| `fiscal_agent/api/routes/admin.py` | **Update** — replace `developer_id` param with `request.state.developer`; add tenant endpoints |
| `fiscal_agent/api/routes/admin.py` | **Update** — register returns dev+key+app (auto-provision) |
| `fiscal_agent/api/server.py` | No change — admin router already included |
