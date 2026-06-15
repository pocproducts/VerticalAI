# Tenant Brain Specification

## Purpose

`TenantBrain` aggregates all fiscal data for a CUIT into a single
`TenantContext`: padrón, deuda, facilidades, registro, calendario,
rentas matching, and historical memory. Each source is best-effort —
a failure in one source does not block the others.

## Requirements

### Requirement 1: TenantBrain initialization

`TenantBrain.__init__` MUST accept a `FiscalMemoryClient` instance.

#### Scenario: Valid initialization

- GIVEN a `FiscalMemoryClient` instance
- WHEN `TenantBrain(memory_client)` is called
- THEN the instance MUST be created without error

### Requirement 2: build_context

`TenantBrain.build_context(cuit: str)` MUST return a `TenantContext`
with all fiscal data sources populated. Calls are SEQUENTIAL (parallelism
is deferred). Errors in one source MUST NOT fail the entire context.

#### Scenario: Happy path — all sources available

- GIVEN a valid CUIT, ARCA reachable, Engram reachable
- WHEN `build_context(cuit)` is called
- THEN `TenantContext` MUST contain `padron`, `deuda`, `facilidades`,
      `registro`, `calendario`, `rentas_matching`, `memoria_historica`,
      and `resumen_ejecutivo`
- AND `ultimo_error` MUST be `None`

#### Scenario: Partial failure — ARCA padrón unavailable

- GIVEN a valid CUIT but ARCA is unreachable
- WHEN `build_context(cuit)` is called
- THEN `padron` MUST be `None`
- AND `ultimo_error` MUST contain the padrón error details
- AND other fields (deuda, facilidades, etc.) MUST still be populated

#### Scenario: Partial failure — Engram unavailable

- GIVEN a valid CUIT but Engram is unreachable
- WHEN `build_context(cuit)` is called
- THEN `memoria_historica` MUST be an empty list
- AND `resumen_ejecutivo` MUST still be generated from available sources

#### Scenario: Empty CUIT — no fiscal data

- GIVEN a CUIT with no data in any source
- WHEN `build_context(cuit)` is called
- THEN all optional fields MUST be `None` or empty
- AND `resumen_ejecutivo` MUST be a non-empty string explaining the absence

### Requirement 3: TenantContext model

`TenantContext` SHALL be a Pydantic v2 model with the following fields:

| Field | Type | Default |
|-------|------|---------|
| `padron` | `PadronA5Output \| None` | `None` |
| `deuda` | `list[DeudaDetail]` | `[]` |
| `facilidades` | `list[FacilidadPlan]` | `[]` |
| `registro` | `RegistroOutput \| None` | `None` |
| `calendario` | `RulesOutput \| None` | `None` |
| `rentas_matching` | `RentasCordobaMatching \| None` | `None` |
| `memoria_historica` | `list[dict]` | `[]` |
| `ultimo_error` | `dict \| None` | `None` |
| `resumen_ejecutivo` | `str` | `""` |

No scenarios needed — the model is a static data contract.

### Requirement 4: Rentas matching refactor

The `evaluar_rentas_cordoba()` function from `matching.py` SHALL be
refactored as `TenantBrain._match_rentas()`. The public API of
`matching.py` SHALL remain intact via a thin wrapper.

#### Scenario: Internal method preserves behavior

- GIVEN an existing call to `evaluar_rentas_cordoba(cuit, output, cliente)`
- WHEN the same logic is invoked via `brain._match_rentas(cuit, output, cliente)`
- THEN the result MUST be identical

#### Scenario: Thin wrapper maintains public API

- GIVEN `from fiscal_agent.matching import evaluar_rentas_cordoba`
- WHEN the module is imported after refactor
- THEN the function MUST still be importable and callable with the same signature

### Requirement 5: Historical memory loading

`build_context()` MUST load observations from `FiscalMemoryClient` for the
given CUIT. At minimum: `padron`, `deuda`, `facilidades`, `registro`, and
`error` types.

#### Scenario: Memory enriches context

- GIVEN a CUIT with historical padron and error observations
- WHEN `build_context(cuit)` is called
- THEN `memoria_historica` MUST include those observations
- AND `ultimo_error` MUST be the most recent error observation, if any

### Requirement 6: resumen_ejecutivo auto-generation

`build_context()` MUST generate a human-readable executive summary from
all available data sources.

#### Scenario: Summary includes key facts

- GIVEN a CUIT with padron, deuda, and facilidades data
- WHEN `build_context(cuit)` is called
- THEN `resumen_ejecutivo` MUST mention taxpayer identity, total debt
      count, active payment plans count, and calendar status

