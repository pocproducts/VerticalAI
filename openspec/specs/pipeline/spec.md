# Spec: Pipeline Service Extraction

> **Change**: `pipeline-service-extraction`
> **Resolves**: #1 (CLI as orchestrator), #3 (parallel `deuda`), #5 (raw `dict`), #6 (duplicated constants)

## Functional Requirements

### REQ-1: PipelineService
- **FR1.1** — The system MUST provide a `PipelineService` class in `fiscal_agent/pipeline/service.py`.
- **FR1.2** — `PipelineService` MUST expose a `run_pipeline()` method that reproduces the exact behavior of `_procesar_cliente_pipeline()` from `cli.py`.
- **FR1.3** — `run_pipeline()` MUST accept the same parameters as the current function, with `echo_func` renamed to `progress_callback` as optional `Callable[[str], None] | None`.
- **FR1.4** — `PipelineService.__init__()` MUST accept `RulesEngine`, `PdfGenerator`, and `FiscalMemoryClient | None` via dependency injection.
- **FR1.5** — `PipelineService` MUST NOT import from `cli.py` or have any Typer dependency.

### REQ-2: PipelineResult Model
- **FR2.1** — The system MUST provide a `PipelineResult` Pydantic `BaseModel` in `fiscal_agent/pipeline/models.py`.
- **FR2.2** — `PipelineResult` MUST include these fields with the same names as the current raw dict: `cliente`, `cuit`, `ws_api`, `calendario`, `pdf`, `pdf_path`, `email`, `error`.
- **FR2.3** — `model_dump()` on `PipelineResult` MUST produce a dict with identical structure to the current pipeline return.
- **FR2.4** — New fields MAY be added but existing field names and types MUST NOT change.

### REQ-3: Config Unification
- **FR3.1** — `CERT_DIR`, `CERT_PATH`, `KEY_PATH` MUST be defined in `fiscal_agent/config.py`.
- **FR3.2** — `REPRESENTANTE_CUIT` MUST be accessible from `fiscal_agent/config.py`.
- **FR3.3** — `fiscal_agent/cli.py` MUST remove its local `CERT_PATH` and `REPRESENTANTE_CUIT` and import from `config`.
- **FR3.4** — `fiscal_agent/api/deps.py` MUST remove its local `CERT_PATH`, `KEY_PATH`, `REPRESENTANTE_CUIT` and import from `config`.

### REQ-4: Backward Compatibility
- **FR4.1** — `_procesar_cliente_pipeline()` MUST remain in `cli.py` as a thin wrapper that delegates to `PipelineService.run_pipeline()`.
- **FR4.2** — The wrapper MUST return a `dict` identical to the current return value (via `PipelineResult.model_dump()`).
- **FR4.3** — All existing imports of `_procesar_cliente_pipeline` from `cli.py` MUST continue to work unmodified.

### REQ-5: Entry Point Refactors
- **FR5.1** — CLI commands `run`, `report` MUST delegate to `PipelineService`.
- **FR5.2** — `fiscal_agent/api/routes/chat.py` MUST import `PipelineService` and `_completar_cliente_desde_padron` from `fiscal_agent.pipeline.service` instead of `cli.py`.
- **FR5.3** — `fiscal_agent/api/routes/report.py` MUST import from `fiscal_agent.pipeline.service` instead of `cli.py`.
- **FR5.4** — `fiscal_agent/mcp/tools/pipeline.py` MUST import `PipelineService` from `fiscal_agent.pipeline.service`.
- **FR5.5** — MCP tools (`deuda.py`, `facilidades.py`, `registro.py`, `rentas.py`, `taxpayer.py`, `report.py`, `calendar.py`) MUST import `REPRESENTANTE_CUIT` from `config` instead of `cli`.

### REQ-6: Provincia derivation from ClientConfig

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

### REQ-7: build_browser_tasks provincia parameter

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

## Non-Functional Requirements

- **NFR1** — Pipeline execution time MUST NOT regress by more than 5%.
- **NFR2** — Memory save side effects MUST be preserved in the same order and frequency.
- **NFR3** — The new code MUST pass all existing tests without modification.

## Out of Scope

- Browser task factory (Phase 2)
- Memory client public API cleanup (Phase 3)
- Auth reconnection (Phase 4)
- PipelineStep cleanup (Phase 5)
- TA cache unification (issue #7)
- Browser extraction deduplication (issue #2)
