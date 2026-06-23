# API Key Management Specification

## Purpose

Allow authenticated users to manage API keys for their tenant: list existing keys (masked), create new keys (full key shown once), and revoke keys. All operations are scoped to the authenticated tenant from the JWT.

## Requirements

### Requirement: List API Keys

The system MUST provide `GET /v1/admin/api-keys` that returns all non-revoked API keys for the authenticated tenant. Each key MUST return only `key_preview` (last 4 chars), `created_at`, and `scopes`. The full key MUST NOT be returned.

#### Scenario: List keys for tenant

- GIVEN a tenant with 3 active API keys
- WHEN `GET /v1/admin/api-keys` is called
- THEN the response MUST contain 3 key objects
- AND each MUST include `key_preview`, `created_at`, `scopes`
- AND the full key value MUST NOT be returned

#### Scenario: No keys exist

- GIVEN a tenant with zero API keys
- WHEN `GET /v1/admin/api-keys` is called
- THEN the response MUST return `[]`

### Requirement: Create API Key

The system MUST provide `POST /v1/admin/api-keys` that creates a new API key bound to the authenticated tenant. The request body MAY specify `scopes` (subset of plan scopes). The response MUST return the full `key` (prefixed `fa_`) exactly once. Subsequent reads MUST return only `key_preview`.

#### Scenario: Create with default scopes

- GIVEN a tenant with `plan_scopes: ["taxpayer:read", "report:write"]`
- WHEN `POST /v1/admin/api-keys` is called with no body
- THEN the response MUST include the full key (e.g. `fa_abc123...`)
- AND the key MUST have all `plan_scopes` assigned

#### Scenario: Create with subset scopes

- GIVEN a tenant plan allows `["taxpayer:read", "report:write"]`
- WHEN `POST /v1/admin/api-keys` with `{"scopes": ["taxpayer:read"]}` is called
- THEN the key MUST be created with only `["taxpayer:read"]`

#### Scenario: Scope exceeds plan

- GIVEN a tenant plan allows only `["taxpayer:read"]`
- WHEN `POST /v1/admin/api-keys` with `{"scopes": ["report:write"]}` is called
- THEN status MUST be 403
- AND `ApiError.code` MUST be `"SCOPE_EXCEEDS_PLAN"`

### Requirement: Revoke API Key

The system MUST provide `DELETE /v1/admin/api-keys/{key_id}` that marks the key as revoked. Revoked keys MUST NOT appear in list endpoints. Future requests with this key MUST return 401.

#### Scenario: Revoke existing key

- GIVEN an active API key `key_01` belonging to the tenant
- WHEN `DELETE /v1/admin/api-keys/key_01` is called
- THEN the key MUST be marked `revoked=true` in Redis
- AND subsequent requests using this key MUST return 401

#### Scenario: Revoke non-existent key

- GIVEN a `key_id` that does not exist
- WHEN `DELETE /v1/admin/api-keys/nonexistent` is called
- THEN status MUST be 404
- AND `ApiError.code` MUST be `"KEY_NOT_FOUND"`

#### Scenario: Cross-tenant isolation

- GIVEN `key_01` belongs to tenant A
- WHEN tenant B calls `DELETE /v1/admin/api-keys/key_01`
- THEN status MUST be 404 (key is not visible to tenant B)

### Requirement: Tenant Binding

Every created API key MUST be bound to the `tenant_id` extracted from the JWT. All CRUD operations MUST filter by `tenant_id`. A tenant MUST NOT see or manipulate keys from another tenant.

#### Scenario: Key bound to creator

- GIVEN a request with `tenant_id = "t01"`
- WHEN `POST /v1/admin/api-keys` creates a key
- THEN the Redis entry MUST include `tenant_id: "t01"`
- AND `GET /v1/admin/api-keys` for `t01` MUST return this key

### Requirement: Scope Enforcement

API keys MUST inherit scopes from the tenant's plan. The create endpoint MUST validate that requested scopes are a subset of the plan's allowed scopes.

#### Scenario: Inherits from plan

- GIVEN a tenant with `plan_scopes: ["taxpayer:read"]`
- WHEN a key is created without explicit scopes
- THEN the key MUST have `["taxpayer:read"]`
