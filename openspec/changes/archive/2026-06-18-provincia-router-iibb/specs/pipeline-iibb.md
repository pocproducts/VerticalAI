# Delta for pipeline

Base spec: `openspec/specs/pipeline/spec.md`

## ADDED Requirements

### Requirement: Provincia derivation from ClientConfig

The system SHALL derive the provincia for IIBB extraction from `cliente.provincias` when `with_iibb=True` in `run_pipeline()`.

The derivation logic MUST be:
- If `cliente.provincias` is `None` or empty → `None` (triggers Córdoba fallback in IIBBRouter)
- If `cliente.provincias` has exactly one element → that provincia
- If `cliente.provincias` has multiple elements → first element (Convenio Multilateral)

#### Scenario: Single provincia

- GIVEN a `ClientConfig` with `provincias=["JUJUY"]`
- WHEN `run_pipeline()` executes with `with_iibb=True`
- THEN the `IIBBTask` MUST receive `provincia='JUJUY'`

#### Scenario: No provincias (None)

- GIVEN a `ClientConfig` with `provincias=None`
- WHEN `run_pipeline()` executes with `with_iibb=True`
- THEN the `IIBBTask` MUST receive `provincia=None` (Córdoba fallback)

#### Scenario: Empty provincias list

- GIVEN a `ClientConfig` with `provincias=[]`
- WHEN `run_pipeline()` executes with `with_iibb=True`
- THEN the `IIBBTask` MUST receive `provincia=None` (Córdoba fallback)

#### Scenario: Multiple provincias (Convenio Multilateral)

- GIVEN a `ClientConfig` with `provincias=["CORDOBA", "JUJUY"]`
- WHEN `run_pipeline()` executes with `with_iibb=True`
- THEN the `IIBBTask` MUST receive `provincia='CORDOBA'` (first provincia)

### Requirement: build_browser_tasks provincia parameter

`build_browser_tasks()` SHALL accept an optional `provincia: str | None = None` parameter and pass it to `IIBBTask` when `with_iibb=True`.

#### Scenario: Builder passes provincia

- GIVEN `build_browser_tasks(cuit=..., clave=..., cliente_cuit=..., with_iibb=True, provincia='JUJUY')`
- WHEN the function executes
- THEN the created `IIBBTask` MUST have `provincia='JUJUY'`

#### Scenario: Builder default (no provincia)

- GIVEN `build_browser_tasks(cuit=..., clave=..., cliente_cuit=..., with_iibb=True)` without `provincia`
- WHEN the function executes
- THEN the created `IIBBTask` MUST use the default value `'CORDOBA'`

#### Scenario: Builder with_iibb=False ignores provincia

- GIVEN `build_browser_tasks(..., with_iibb=False, provincia='JUJUY')`
- WHEN the function executes
- THEN no `IIBBTask` MUST be created
- AND no error MUST be raised
