# Tenant Identity Specification

## Purpose

Define el modelo de datos para developers, aplicaciones, API keys, planes y scopes del sistema. Es un contrato de datos exclusivamente — no incluye lógica de persistencia, validación criptográfica ni autenticación HTTP.

## Requirements

### Requirement: Developer model

The system MUST include a `Developer` Pydantic v2 model with fields: `id` (str), `name` (str), `email` (str), `created_at` (datetime), `is_active` (bool).

#### Scenario: Create a developer

- GIVEN a developer with name, email, and current timestamp
- WHEN constructing a `Developer` instance
- THEN all fields MUST be present and typed as specified

#### Scenario: Inactive developer

- GIVEN a developer who has been deactivated
- WHEN inspecting `is_active`
- THEN `is_active` MUST be `False`

### Requirement: App model

The system MUST include an `App` model with fields: `id` (str), `developer_id` (str), `name` (str), `environment` (enum: `sandbox` | `production`), `status` (enum: `pending` | `active` | `suspended` | `revoked`).

#### Scenario: Create an app in sandbox

- GIVEN a developer with id `"dev_01"`
- WHEN creating an `App` with `environment="sandbox"` and `status="pending"`
- THEN the app MUST be linked via `developer_id`
- AND environment MUST be constrained to the enum

#### Scenario: Suspended app

- GIVEN an app that violated terms
- WHEN setting `status="suspended"`
- THEN the app MUST be identifiable by `id`
- AND `status` MUST be one of the allowed values

### Requirement: ApiKey model

The system MUST include an `ApiKey` model with fields: `id` (str), `app_id` (str), `key_preview` (str — últimos 4 caracteres), `is_active` (bool), `scopes` (list[str]), `created_at` (datetime), `expires_at` (Optional[datetime]).

#### Scenario: Active API key with scopes

- GIVEN an app with id `"app_01"`
- WHEN creating an `ApiKey` with `scopes=["taxpayer:read"]` and `is_active=True`
- THEN `key_preview` MUST contain only the last 4 characters
- AND `expires_at` MAY be `None`

#### Scenario: Expired API key

- GIVEN an API key with `expires_at` in the past
- WHEN checking `is_active`
- THEN the model still represents the key as-is (no auto-invalidation logic)
- AND `is_active` MAY be `True` independently of expiry (validation is out of scope)

### Requirement: Plan model

The system MUST include a `Plan` model with fields: `id` (str), `name` (str), `scopes` (list[str]), `rate_limit_rpm` (int), `rate_limit_rpd` (int).

#### Scenario: Define a basic plan

- GIVEN a plan named `"free"`
- WHEN setting `rate_limit_rpm=10` and `rate_limit_rpd=100`
- THEN the model MUST carry `scopes` as a list of scope strings

### Requirement: Scope enum

The system MUST include a `Scope` string enum with values: `calendar:read`, `calendar:write`, `taxpayer:read`, `report:read`, `report:write`, `admin:read`, `admin:write`.

#### Scenario: Valid scope value

- GIVEN the string `"taxpayer:read"`
- WHEN constructing `Scope("taxpayer:read")`
- THEN it MUST be a valid enum member

#### Scenario: Invalid scope value

- GIVEN the string `"invalid:scope"`
- WHEN constructing a `Scope` from it
- THEN it MUST raise a `ValueError`

### Requirement: No persistence or validation logic

The models MUST NOT include persistence, encryption, hashing, or API key validation logic — they are pure data contracts.

#### Scenario: Models are Pydantic only

- GIVEN any model in this spec
- WHEN inspecting its methods
- THEN it MUST only contain Pydantic field definitions and configuration
- AND MUST NOT reference databases, hashing, or HTTP
