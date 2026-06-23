# Scoped ComposioBrowser Specification

> **Delta from** `openspec/specs/composio-browser-integration/spec.md`. This
> spec adds optional tenant-scoped credentials to `ComposioBrowser` so that
> per-tenant browser sessions use each tenant's own CUIT and clave fiscal
> instead of the global estudio credentials.

## Purpose

Allow `ComposioBrowser` to accept an optional `Tenant` parameter. When
provided, the browser session authenticates to ARCA using the tenant's
`cuit` and `clave_fiscal` rather than the global estudio credentials. When
not provided, the existing global credentials are used (backward compatible).

## Requirements

### Requirement 1: Optional tenant parameter on ComposioBrowser

`ComposioBrowser.__init__` MUST accept an optional `tenant: Tenant | None`
parameter.

#### Scenario: Tenant provided

- GIVEN a `Tenant` with `cuit="20324837796"` and `clave_fiscal="secret123"`
- WHEN `ComposioBrowser(api_key, tenant=tenant, headed=False)` is constructed
- THEN the browser MUST use `tenant.cuit` and `tenant.clave_fiscal` for ARCA
  authentication
- AND global `estudio_cuit` / `estudio_clave` MUST be ignored

#### Scenario: Tenant NOT provided (backward compatible)

- GIVEN no `tenant` argument
- WHEN `ComposioBrowser(api_key, estudio_cuit, estudio_clave, headed=False)`
  is constructed
- THEN the browser MUST use the passed `estudio_cuit` and `estudio_clave`
  (existing behavior)
- AND all existing callers MUST continue to work unchanged

#### Scenario: Tenant is None (explicit)

- GIVEN `tenant=None`
- WHEN `ComposioBrowser(api_key, estudio_cuit, estudio_clave, tenant=None)`
  is constructed
- THEN the browser MUST fall back to the passed positional `estudio_cuit` /
  `estudio_clave`
- AND behavior MUST be identical to not passing tenant at all

### Requirement 2: Tenant credentials override global for ARCA login

When a `Tenant` is provided, the `_run_single()` method MUST use the
tenant's `cuit` and `clave_fiscal` when creating tasks that require
authentication (i.e. tasks with `needs_auth=True`).

Specifically, the `secrets` dict and template params passed to
`_create_task()` MUST use `tenant.cuit` and `tenant.clave_fiscal`.

#### Scenario: Tenant login uses tenant creds

- GIVEN a `ComposioBrowser` with `tenant=Tenant(cuit="20324837796", ...)`
- WHEN `_run_single(cliente)` executes a login task
- THEN the instruction template MUST receive `cuit="20324837796"`
- AND the `secrets` dict MUST contain `tenant.clave_fiscal`
- AND the HTTP API calls MUST use the tenant's credentials

#### Scenario: Global fallback when no tenant

- GIVEN a `ComposioBrowser` WITHOUT a tenant
- WHEN `_run_single(cliente)` executes a login task
- THEN the instruction template MUST receive
  `cuit=self._estudio_cuit` (global)
- AND the `secrets` dict MUST contain `self._estudio_clave` (global)

### Requirement 3: Tenant 1 seeded from .env + clients.yaml

The `TenantStore.seed_defaults()` MUST create Tenant 1 using the global
`ESTUDIO_CUIT` and `ESTUDIO_CLAVE_FISCAL` from `.env`, and populate
`clientes` and `provincias` from `clients.yaml`.

This ensures that the existing estudio (Tenant 1) can immediately use the
scoped browser without additional configuration.

#### Scenario: Tenant 1 matches estudio credentials

- GIVEN `.env` with `ESTUDIO_CUIT=20324837796` and
  `ESTUDIO_CLAVE_FISCAL=secret`
- AND `clients.yaml` with 5 clients and 3 provinces
- WHEN `TenantStore.seed_defaults()` runs
- THEN Tenant 1 is created with `cuit="20324837796"`,
  `clave_fiscal="secret"`
- AND `clientes` is a list of 5 dicts
- AND `provincias` contains 3 province strings

#### Scenario: ComposioBrowser uses Tenant 1

- GIVEN Tenant 1 seeded from global credentials
- WHEN `ComposioBrowser(api_key, tenant=tenant_1)` is constructed
- THEN it MUST authenticate to ARCA with the same CUIT and clave fiscal as
  the existing global pipeline

### Requirement 4: Backward compatibility with CLI

The `cli.py` `deuda` command MUST continue to work without changes. It
constructs `ComposioBrowser` without the `tenant` parameter, so it uses
global credentials.

#### Scenario: CLI unchanged

- GIVEN `fiscal-agent deuda --config clients.yaml`
- WHEN the command runs
- THEN `ComposioBrowser` is instantiated without `tenant` (existing code path)
- THEN all clients process with global estudio credentials
- THEN output is `list[DeudaOutput]` as before

## File Manifest

| File | Change |
|------|--------|
| `fiscal_agent/browser/composio.py` | **Update** — add optional `tenant: Tenant | None` param to `__init__`, use its creds in `_run_single` |
| `fiscal_agent/cli.py` | No change — continues to construct without tenant (backward compatible) |
| `fiscal_agent/api/store.py` | No change (spec'd in tenant-context) |
