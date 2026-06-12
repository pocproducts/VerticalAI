# API Auth Specification

## Purpose

Validar API key en cada request HTTP. Resolver Developer, App, Plan y scopes. Rechazar requests sin auth o con credenciales inválidas antes de llegar al route handler.

## Data Contract

Modelos definidos en `tenant-identity/spec.md` — este spec NO redefine tipos.

## Requirements

### Requirement 1: Missing API key → 401

Every request without `X-API-Key` header MUST return 401.

#### Scenario: No API key header

- GIVEN a request to any endpoint
- WHEN the request does NOT include `X-API-Key` header
- THEN status MUST be 401
- AND `UnifiedResponse.status` MUST be `"error"`
- AND `ApiError.code` MUST be `"UNAUTHORIZED"`

### Requirement 2: Inactive API key → 403

A valid API key with `is_active=False` MUST return 403.

#### Scenario: Key exists but deactivated

- GIVEN an API key stored with `is_active=False`
- WHEN a request includes that key in `X-API-Key`
- THEN status MUST be 403
- AND `ApiError.code` MUST be `"API_KEY_INACTIVE"`

### Requirement 3: Missing scope → 403

A valid active API key without the required scope MUST return 403.

#### Scenario: Wrong scope for endpoint

- GIVEN an API key with `scopes=["calendar:read"]`
- WHEN requesting `POST /v1/report` (requires `report:write`)
- THEN status MUST be 403
- AND `ApiError.code` MUST be `"INSUFFICIENT_SCOPE"`

### Requirement 4: Valid key + scope → request proceeds

A valid active API key with sufficient scopes MUST populate `request.state`.

#### Scenario: Successful auth populates state

- GIVEN a valid active API key with required scope
- WHEN the request reaches the route handler
- THEN `request.state.developer` MUST be the `Developer` object
- AND `request.state.app` MUST be the `App` object
- AND `request.state.api_key` MUST be the `ApiKey` object
- AND `request.state.plan` MUST be the `Plan` object

### Requirement 5: `ScopeRequired(scope)` dependency

The system MUST provide a FastAPI dependency callable `ScopeRequired(scope: Scope)` that checks `request.state.api_key.scopes`.

#### Scenario: ScopeRequired passes

- GIVEN an endpoint decorated with `ScopeRequired(Scope.taxpayer_read)`
- WHEN `request.state.api_key.scopes` contains `"taxpayer:read"`
- THEN the dependency MUST succeed and let the handler execute

#### Scenario: ScopeRequired fails

- GIVEN an endpoint decorated with `ScopeRequired(Scope.report_write)`
- WHEN `request.state.api_key.scopes` does NOT contain `"report:write"`
- THEN the dependency MUST raise HTTPException 403

### Requirement 6: Middleware runs before route handlers

Auth middleware MUST execute before any route handler or dependency.

#### Scenario: 401 before handler logic

- GIVEN any endpoint
- WHEN the request has no `X-API-Key`
- THEN the response MUST be 401
- AND no route handler code MUST execute

### Requirement 7: Admin endpoints require admin scope

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
