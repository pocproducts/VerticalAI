# Admin API Specification

## Purpose

Endpoints de autoservicio para developers: registrarse, crear apps, generar API keys, listar keys, ver perfil. Todos requieren autenticación por API key con scope `admin:*`.

## Requirements

### Requirement 1: POST /v1/admin/register

Creates a Developer. Input: `name`, `email`. Auto-generates `id` and assigns Free plan.

#### Scenario: Happy path — register new developer

- GIVEN a POST with `{"name": "Alice", "email": "alice@example.com"}`
- WHEN POST /v1/admin/register
- THEN status MUST be 201
- AND `UnifiedResponse.result` MUST contain Developer with `id`, `name`, `email`, `created_at`, `is_active=True`

#### Scenario: Duplicate email

- GIVEN an existing developer with email `alice@example.com`
- WHEN POST /v1/admin/register with the same email
- THEN status MUST be 409
- AND `ApiError.code` MUST be `"EMAIL_ALREADY_EXISTS"`

### Requirement 2: POST /v1/admin/apps

Creates an App for the authenticated developer. Input: `name`, `environment`.

#### Scenario: Happy path — create app

- GIVEN an authenticated developer
- WHEN POST /v1/admin/apps with `{"name": "My App", "environment": "sandbox"}`
- THEN status MUST be 201
- AND `UnifiedResponse.result` MUST contain App with `developer_id` matching auth

### Requirement 3: POST /v1/admin/keys

Generates an API key for a given app. Returns the full key ONCE.

#### Scenario: Happy path — generate key

- GIVEN an authenticated developer with an existing app
- WHEN POST /v1/admin/keys with `{"app_id": "app_01"}`
- THEN status MUST be 201
- AND `UnifiedResponse.result` MUST contain ApiKey with `key_preview` (last 4 chars)
- AND the full raw key MUST be included in the response (single opportunity)

#### Scenario: Key for nonexistent app

- GIVEN an `app_id` that does not exist
- WHEN POST /v1/admin/keys
- THEN status MUST be 404
- AND `ApiError.code` MUST be `"APP_NOT_FOUND"`

### Requirement 4: GET /v1/admin/keys

Lists API keys for the authenticated developer.

#### Scenario: Happy path — list keys

- GIVEN an authenticated developer with 2 API keys across apps
- WHEN GET /v1/admin/keys
- THEN status MUST be 200
- AND `UnifiedResponse.result` MUST be a list of ApiKey objects
- AND each ApiKey MUST contain `key_preview` only (NOT full key)

### Requirement 5: GET /v1/admin/me

Returns the authenticated developer's profile.

#### Scenario: Happy path — view profile

- GIVEN an authenticated developer
- WHEN GET /v1/admin/me
- THEN status MUST be 200
- AND `UnifiedResponse.result` MUST be the Developer object

### Requirement 6: UnifiedResponse envelope

All admin endpoints MUST return `UnifiedResponse[T]` as the output envelope.

#### Scenario: Error uses UnifiedResponse

- GIVEN a 404 from key generation
- WHEN inspecting the response
- THEN the body MUST contain `UnifiedResponse` with `status="error"`

### Requirement 7: Seed data on server start

On startup, the system MUST seed: a "Free" plan with basic scopes, and an "admin" Developer with a pre-generated API key for testing.

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
