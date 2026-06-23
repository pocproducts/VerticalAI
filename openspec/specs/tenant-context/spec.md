# Tenant Context Specification

> **New capability** (2026-06-18). Defines the `Tenant` data model, the
> `TenantStore` for Redis persistence, and the TenantContext middleware that
> resolves the current tenant from the authenticated developer's binding.

## Purpose

Establish the multi-tenant data model (`Tenant`), its Redis storage layer
(`TenantStore`), and middleware that injects the current `Tenant` into
`request.state.tenant` after authentication. This is the foundation for
per-tenant credential isolation, per-tenant browser sessions, and eventual
tenant-scoped data access.

## Data Contract

### Tenant model

The `Tenant` Pydantic v2 model represents an accounting firm (estudio
contable) or taxpayer entity that uses the system.

**Fields:**

| Field | Type | Required | Default | Description |
|-------|------|----------|---------|-------------|
| `id` | `str` | Yes | — | Unique identifier (12 hex chars, generated) |
| `name` | `str` | Yes | — | Human-readable tenant name |
| `plan_tier` | `PlanTier` | Yes | `free` | Subscription tier |
| `cuit` | `str` | Yes | — | CUIT of the tenant (unique index) |
| `clave_fiscal` | `str` | Yes | — | ARCA clave fiscal for this tenant |
| `certificados` | `list[str]` | No | `[]` | Paths to ARCA certificate files |
| `clientes` | `list[dict]` | No | `[]` | Client configuration list |
| `provincias` | `list[str]` | No | `[]` | Provinces where the tenant operates |
| `is_active` | `bool` | No | `True` | Soft-delete / disable flag |

### PlanTier enum

```python
class PlanTier(str, Enum):
    free = 'free'
    pro = 'pro'
    pro_max = 'pro_max'    # Added for backward compat with billing/tiers.py
    enterprise = 'enterprise'
```

## Requirements

### Requirement 1: Tenant model

The system MUST include a `Tenant` Pydantic v2 model with all fields as
defined in the Data Contract above.

#### Scenario: Create a tenant

- GIVEN tenant data with `name="Estudio Pérez"`, `cuit="20324837796"`,
  `plan_tier="pro"`, and `clave_fiscal="secret123"`
- WHEN constructing a `Tenant` instance
- THEN all fields MUST be present and typed as specified
- AND `plan_tier` MUST be constrained to the `PlanTier` enum
- AND `is_active` MUST default to `True`

#### Scenario: Invalid plan_tier

- GIVEN a `plan_tier` value of `"mega"`
- WHEN constructing a `Tenant` with it
- THEN it MUST raise a `ValidationError`

### Requirement 2: TenantStore — Redis CRUD

The system MUST include a `TenantStore` class that extends the same patterns
as `RedisStore` for tenant CRUD operations.

**Redis key schema:**

| Key Pattern | Type | Purpose |
|-------------|------|---------|
| `tenant:tenant:{id}` | Hash | Tenant fields (serialized via JSON) |
| `tenant:tenant:by_cuit:{cuit}` | String | Index: CUIT → tenant ID |
| `tenant:tenant:all` | Set | Set of all tenant IDs |

#### Scenario: Create tenant

- GIVEN a `Tenant` with `cuit="20324837796"`
- WHEN `TenantStore.create(tenant)` is called
- THEN a Redis Hash at `tenant:tenant:{id}` MUST store all fields
- AND a Redis String at `tenant:tenant:by_cuit:20324837796` MUST point to the
  tenant ID
- AND the ID MUST be added to `tenant:tenant:all`

#### Scenario: Get tenant by ID

- GIVEN an existing tenant with `id="tnt_01"`
- WHEN `TenantStore.get("tnt_01")` is called
- THEN it MUST return the full `Tenant` instance
- AND `model_dump(mode='json')` round-trips through Redis

#### Scenario: Get tenant by CUIT

- GIVEN an existing tenant with `cuit="20324837796"`
- WHEN `TenantStore.get_by_cuit("20324837796")` is called
- THEN it MUST return the full `Tenant` instance

#### Scenario: Get nonexistent tenant

- GIVEN a tenant ID that does NOT exist
- WHEN `TenantStore.get("nonexistent")` is called
- THEN it MUST return `None`

#### Scenario: List all tenants

- GIVEN 3 tenants stored in Redis
- WHEN `TenantStore.list_all()` is called
- THEN it MUST return a list of 3 `Tenant` instances

#### Scenario: Update tenant

- GIVEN an existing tenant
- WHEN `TenantStore.update(id, {"name": "New Name"})` is called
- THEN the Redis Hash field `name` MUST be updated
- AND other fields MUST remain unchanged

#### Scenario: Delete tenant

- GIVEN an existing tenant with `id="tnt_01"`
- WHEN `TenantStore.delete("tnt_01")` is called
- THEN the Redis Hash MUST be removed
- AND the CUIT index MUST be removed
- AND the ID MUST be removed from `tenant:tenant:all`

### Requirement 3: TenantStore — Seed defaults

`TenantStore.seed_defaults()` MUST create Tenant 1 (Estudio) from the
existing `.env` credentials (`ESTUDIO_CUIT`, `ESTUDIO_CLAVE_FISCAL`) and
`clients.yaml` data (`clientes`, `provincias`).

This is called during server startup alongside `RedisStore.seed_defaults()`.

#### Scenario: Tenant 1 seeded on first start

- GIVEN a fresh Redis with no tenant data AND `.env` has
  `ESTUDIO_CUIT=20324837796` and `ESTUDIO_CLAVE_FISCAL=secret`
- WHEN `TenantStore.seed_defaults()` is called
- THEN a Tenant MUST be created with `cuit="20324837796"`,
  `clave_fiscal="secret"`, `name="Estudio Contable"`
- AND `clientes` MUST be populated from `clients.yaml` (if it exists)
- AND `provincias` MUST be extracted from client entries

#### Scenario: Seed is idempotent

- GIVEN Redis already has tenant data
- WHEN `TenantStore.seed_defaults()` is called again
- THEN no new tenants MUST be created
- AND existing data MUST NOT be modified

### Requirement 4: TenantContext middleware

The TenantContext middleware MUST run AFTER the auth middleware and resolve
the current `Tenant` by finding which tenant is bound to the authenticated
developer.

**Resolution strategy:**
1. If `ApiKey` has a `tenant_id` field → use it directly
2. Otherwise, look up a `developer_id → tenant_id` binding in Redis

The resolved `Tenant` MUST be injected into `request.state.tenant`.

#### Scenario: Tenant resolved from api_key.tenant_id

- GIVEN an authenticated API key with `tenant_id="tnt_01"`
- WHEN the TenantContext middleware runs
- THEN `request.state.tenant` MUST be the `Tenant` with `id="tnt_01"`

#### Scenario: No tenant bound (no-op)

- GIVEN an authenticated developer with NO tenant binding (tenant_id=None)
- WHEN the TenantContext middleware runs
- THEN `request.state.tenant` MUST be `None`
- AND the request MUST proceed normally (no error)

#### Scenario: Unauthenticated request

- GIVEN a request that failed auth (no `request.state.api_key`)
- WHEN the TenantContext middleware runs
- THEN the middleware MUST skip resolution silently
- AND `request.state.tenant` MUST remain `None`

### Requirement 5: ApiKey.tenant_id field

The `ApiKey` model MUST gain an optional `tenant_id: str | None = None`
field. This creates the direct path from key → tenant without needing a
separate developer→tenant index.

#### Scenario: ApiKey with tenant_id

- GIVEN an `ApiKey` with `tenant_id="tnt_01"`
- WHEN the TenantContext middleware inspects the key
- THEN it MUST use `api_key.tenant_id` to look up the Tenant
- AND `request.state.tenant` MUST be the resolved Tenant

#### Scenario: ApiKey without tenant_id (backward compatible)

- GIVEN an existing `ApiKey` without a `tenant_id` field
- WHEN the model is constructed
- THEN `tenant_id` MUST default to `None`
- AND existing code MUST continue to work unchanged

## Non-Functional Requirements

| ID | Requirement | Target |
|----|-------------|--------|
| NFR-T1 | Tenant lookup latency | MUST complete <10ms (Redis local network) |
| NFR-T2 | Middleware skip for health | TenantContext MUST NOT error on `/v1/health` |

## File Manifest

| File | Change |
|------|--------|
| `fiscal_agent/models.py` | **Update** — add `Tenant`, `PlanTier` models; add `tenant_id` to `ApiKey` |
| `fiscal_agent/api/store.py` | **Update** — add `TenantStore` class, key prefixes |
| `fiscal_agent/api/middleware/tenant.py` | **New** — TenantContext ASGI middleware |
| `fiscal_agent/api/middleware/__init__.py` | **Update** — export `TenantContextMiddleware` |
| `fiscal_agent/api/server.py` | **Update** — wire `TenantStore` + `TenantContextMiddleware`, add seed call |
| `fiscal_agent/billing/tiers.py` | **Update** — import `PlanTier` from `models.py` (migrated enum) |
