# MCP Tools Specification

## Purpose

Model Context Protocol (MCP) server exposing fiscal agent capabilities as callable tools for AI agents. Built with `mcp.server.fastmcp`. All tools return `UnifiedResponse[T]` serialized as JSON string.

## Architecture

The MCP server (`fiscal_agent/mcp/server.py`) initializes shared services once via lifespan context and exposes them to all tools:

| Service | Key | Source | Optional |
|---------|-----|--------|----------|
| RulesEngine | `engine` | `RulesEngine()` | No |
| PdfGenerator | `pdf_gen` | `PdfGenerator()` | No |
| TA Cache | `ta_cache` | `get_ta()` | No |
| ComposioBrowser | `browser` | `ComposioBrowser(...)` | Yes (missing COMPOSIO_API_KEY) |
| FiscalMemoryClient | `memory` | `FiscalMemoryClient()` | No (best-effort) |

All tools follow the same pattern:
1. Obtain `lifespan_context` from `ctx.request_context.lifespan_context`
2. Extract required services from context
3. Validate preconditions (TA available, browser configured when needed)
4. Execute logic in `try/except`
5. Return `UnifiedResponse(...).model_dump_json()` (JSON string)

## Common response envelope

All tools return `UnifiedResponse[T]` with:

| Field | Type | Description |
|-------|------|-------------|
| `status` | `"success"` \| `"error"` \| `"pending"` \| `"requires_approval"` | Outcome |
| `result` | `T \| null` | Payload on success |
| `error` | `ApiError \| null` | Error details on failure |
| `next_actions` | `list[str]` | Suggested follow-up actions |
| `human_approval_required` | `bool` | Whether human review is needed |

## Tools

### Tool: get_calendar

Calculate fiscal deadlines for a taxpayer.

#### Parameters

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `cuit` | `str` | — | CUIT del contribuyente (11 dígitos) |
| `mes` | `int \| None` | Current month | Month (1-12) |
| `anio` | `int \| None` | Current year | Year (e.g., 2026) |
| `provincias` | `list[str] \| None` | `[]` | Provinces for Convenio Multilateral |

#### Behaviour

1. Consult Padrón A5 via ARCA SOAP WS (`consultar_cuit()`)
2. Apply fiscal rules via `RulesEngine.calcular()`
3. Return structured vencimientos list

#### Output

`UnifiedResponse[RulesOutput]` where `result` contains:
- `vencimientos` — list of deadlines with dates, taxes, and amounts
- `observaciones` — warnings and notes
- `feriados_presentes` — holidays in the period

#### Error codes

| Code | Condition |
|------|-----------|
| `TA_NOT_AVAILABLE` | ARCA access token is None |
| `CONSTANCIA_ERROR` | ARCA constancia has errors (CUIT inactive, invalid) |
| `INVALID_CUIT` | CUIT format is invalid |
| `ARCA_ERROR` | Generic ARCA service error |

#### Scenario: Happy path — calendar generated

- GIVEN a valid CUIT registered in ARCA Padrón A5
- WHEN `get_calendar(cuit="20301234561", mes=6, anio=2026)` is called
- THEN `status` MUST be `"success"`
- AND `result.vencimientos` MUST be a non-empty list of deadlines

#### Scenario: CUIT not in padrón

- GIVEN a CUIT that does not exist in ARCA
- WHEN `get_calendar(cuit="20999999999")` is called
- THEN `status` MUST be `"error"`
- AND `error.code` MUST be `"CONSTANCIA_ERROR"`

---

### Tool: health

Server liveness check.

#### Parameters

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `ctx` | `Context` | `None` | FastMCP context |

#### Behaviour

Return basic server health: status, timestamp, and whether a valid TA token is cached.

#### Output

`UnifiedResponse[dict]` with:
- `status` — always `"ok"`
- `timestamp` — ISO8601 timestamp
- `ta_vigente` — boolean, whether TA cache has a valid token

#### Error codes

None. This tool always returns `status="success"`.

#### Scenario: Server running

- GIVEN the MCP server started successfully
- WHEN `health()` is called
- THEN `status` MUST be `"success"`
- AND `result.ta_vigente` MUST be a boolean

---

### Tool: get_taxpayer

Query taxpayer profile from ARCA Padrón A5.

#### Parameters

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `cuit` | `str` | — | CUIT del contribuyente (11 dígitos) |

#### Behaviour

1. Consult ARCA SOAP WS via `consultar_cuit()`
2. Return full taxpayer data: name, tax category, address, activities, taxes

#### Output

`UnifiedResponse[dict]` where `result` contains PadronA5Output fields:
- `denominacion`, `tipo_persona`, `estado`, `provincia`
- `imp_iva`, `monotributo`, `mes_cierre`, `tipo`
- Domicilio fiscal, activities, impuestos inscriptos

#### Error codes

| Code | Condition |
|------|-----------|
| `TA_NOT_AVAILABLE` | Access token unavailable |
| `CUIT_NOT_FOUND` | CUIT not registered in ARCA |
| `INVALID_CUIT` | Invalid CUIT format |
| `ARCA_ERROR` | Generic ARCA error |

#### Scenario: Happy path — taxpayer found

- GIVEN a valid CUIT
- WHEN `get_taxpayer(cuit="20301234561")` is called
- THEN `status` MUST be `"success"`
- AND `result.denominacion` MUST be a non-empty string

#### Scenario: Invalid CUIT

- GIVEN a CUIT with wrong length
- WHEN `get_taxpayer(cuit="123")` is called
- THEN `status` MUST be `"error"`
- AND `error.code` MUST be `"INVALID_CUIT"`

---

### Tool: extract_deuda

Extract real debt data by browsing ARCA via Composio browser automation.

#### Parameters

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `cuit` | `str` | — | CUIT del contribuyente (11 dígitos) |

#### Behaviour

1. Build browser task with `build_browser_tasks(with_deuda=True)`
2. Execute via `ComposioBrowser.run_single()`
3. Save extraction result to FiscalMemoryClient on success or error
4. Return structured debt data

#### Output

`UnifiedResponse[DeudaOutput]` where `result` includes:
- `deuda_actual` — current total debt
- `saldos` — balance breakdown by concept
- `vencimientos` — upcoming payment deadlines
- `deudas` — detailed debt items

#### Error codes

| Code | Condition |
|------|-----------|
| `BROWSER_NOT_CONFIGURED` | COMPOSIO_API_KEY not set |
| `BROWSER_TIMEOUT` | Browser execution timed out |
| `BROWSER_ERROR` | Generic browser automation error |

#### Side effects

Saves to `FiscalMemoryClient.save_extraction_result(cuit, 'deuda', ...)` on both success and error.

#### Scenario: Happy path — debt extracted

- GIVEN a valid CUIT and Composio is configured
- WHEN `extract_deuda(cuit="20301234561")` is called
- THEN `status` MUST be `"success"`
- AND `result.deuda_actual` MUST be a number

#### Scenario: Browser not configured

- GIVEN COMPOSIO_API_KEY is not in .env
- WHEN `extract_deuda(cuit="20301234561")` is called
- THEN `status` MUST be `"error"`
- AND `error.code` MUST be `"BROWSER_NOT_CONFIGURED"`

---

### Tool: extract_facilidades

Extract payment plans (Mis Facilidades) by browsing ARCA via Composio browser automation.

Transient errors (502 Bad Gateway, tunnel failures, 503) trigger up to 3 automatic retries with 30s delay.

#### Parameters

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `cuit` | `str` | — | CUIT del contribuyente (11 dígitos) |

#### Behaviour

1. Build browser task with `build_browser_tasks(with_facilidades=True)`
2. Execute via `ComposioBrowser.run_single()` with automatic retry on transient errors
3. Save extraction result to FiscalMemoryClient

#### Output

`UnifiedResponse[dict]` where `result` contains:
- `facilidades` — list of `FacilidadPlan` objects (plan name, quota count, next due date, outstanding balance)

#### Error codes

| Code | Condition |
|------|-----------|
| `BROWSER_NOT_CONFIGURED` | COMPOSIO_API_KEY not set |
| `BROWSER_TIMEOUT` | Browser execution timed out |
| `BROWSER_ERROR` | Generic browser automation error |

#### Side effects

Saves to `FiscalMemoryClient.save_extraction_result(cuit, 'facilidades', ...)`.

#### Scenario: Happy path — facilidades extracted

- GIVEN a valid CUIT with active payment plans
- WHEN `extract_facilidades(cuit="20301234561")` is called
- THEN `status` MUST be `"success"`
- AND `result.facilidades` MUST be a list

---

### Tool: extract_registro

Extract complete tax registry (addresses, activities, taxes, sales points, IIBB) by browsing ARCA.

#### Parameters

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `cuit` | `str` | — | CUIT del contribuyente (11 dígitos) |

#### Behaviour

1. Build browser task with `build_browser_tasks(with_registro=True)`
2. Execute via `ComposioBrowser.run_single()`
3. Save extraction result to FiscalMemoryClient

#### Output

`UnifiedResponse[RegistroOutput]` where `result` contains:
- `domicilios` — registered addresses
- `actividades` — economic activities (AFIP codes + descriptions)
- `impuestos` — registered taxes (IVA, Ganancias, etc.)
- `puntos_de_venta` — registered sales points
- `iibb_jurisdicciones` — IIBB jurisdictions
- `iibb_cuotas_vencidas` — overdue IIBB quotas with amounts, surcharges, and mora status (from Rentas Córdoba DGR)

Returns `{}` if `output.registro` is `None`.

#### Error codes

| Code | Condition |
|------|-----------|
| `BROWSER_NOT_CONFIGURED` | COMPOSIO_API_KEY not set |
| `BROWSER_TIMEOUT` | Browser execution timed out |
| `BROWSER_ERROR` | Generic browser automation error |

#### Side effects

Saves to `FiscalMemoryClient.save_extraction_result(cuit, 'registro', ...)`.

#### Scenario: Happy path — registro extracted

- GIVEN a valid CUIT with full tax registry data
- WHEN `extract_registro(cuit="20301234561")` is called
- THEN `status` MUST be `"success"`
- AND `result.actividades` MUST be a non-empty list

---

### Tool: run_pipeline

Execute complete fiscal pipeline: Padrón → RulesEngine → browser extractions (optional) → PDF → email (optional).

Browser tasks include automatic retry for transient errors (502/503/tunnel failures): up to 3 attempts with 30s delay.

#### Parameters

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `cuit` | `str` | — | CUIT del contribuyente |
| `mes` | `int \| None` | Current month | Month (1-12) |
| `anio` | `int \| None` | Current year | Year |
| `with_deuda` | `bool` | `False` | Include real debt extraction |
| `with_facilidades` | `bool` | `False` | Include payment plans extraction |
| `with_registro` | `bool` | `False` | Include tax registry extraction |
| `with_iibb` | `bool` | `False` | Extract IIBB jurisdictions and overdue quotas from Rentas Córdoba |
| `send_email` | `bool` | `False` | Send PDF by email |

#### Behaviour

Delegates to `PipelineService.run_pipeline()` which orchestrates:
1. Consult Padrón A5
2. Calculate calendar with RulesEngine
3. Browser extractions (deuda, facilidades, registro, iibb — conditional)
4. Generate PDF
5. Send email (conditional)

#### Output

`UnifiedResponse[dict]` with pipeline results including:
- PadronA5 data, RulesOutput, browser extractions
- `pdf_path` — path to generated PDF
- `email_status` — delivery status (if `send_email=True`)

**IIBB extraction** (`with_iibb=True`) returns two datasets:
- `iibb_jurisdicciones` — provinces where the taxpayer is registered in IIBB
- `iibb_cuotas_vencidas` — overdue quotas with amounts, surcharges, and mora status (extracted from Rentas Córdoba DGR)

#### Error codes

| Code | Condition |
|------|-----------|
| `TA_NOT_AVAILABLE` | Access token unavailable |
| `BROWSER_NOT_CONFIGURED` | Browser flags enabled but no API key |
| `PIPELINE_ERROR` | Internal pipeline failure |

#### Scenario: Happy path — full pipeline

- GIVEN a valid CUIT with `with_deuda=True` and `send_email=False`
- WHEN `run_pipeline(cuit="20301234561", mes=6, anio=2026, with_deuda=True)` is called
- THEN `status` MUST be `"success"`
- AND `result.pdf_path` MUST be a non-empty string

---

### Tool: match_rentas_cordoba

Evaluate whether a Convenio Multilateral taxpayer with IIBB Córdoba needs Rentas Córdoba integration.

#### Parameters

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `cuit` | `str` | — | CUIT del contribuyente |
| `provincias` | `list[str] \| None` | `[]` | Provinces of operation |

#### Behaviour

1. Consult Padrón A5
2. Apply `evaluar_rentas_cordoba()` matching logic
3. Determine if Rentas Córdoba integration is required

#### Output

`UnifiedResponse[RentasCordobaMatching]` where `result` contains:
- `requiere_integracion` — whether integration is needed
- `tiene_convenio_multilateral` — taxpayer has Convenio Multilateral
- `tiene_iibb_cordoba` — taxpayer is in IIBB Córdoba
- `url` — Rentas Córdoba portal URL
- `estado` — one of: `no_requerido`, `requerido`, `integrado`, `error`
- `observacion` — human-readable note

#### Error codes

| Code | Condition |
|------|-----------|
| `TA_NOT_AVAILABLE` | Access token unavailable |
| `CUIT_NOT_FOUND` | CUIT not found in ARCA |
| `INVALID_CUIT` | Invalid CUIT format |
| `MATCHING_ERROR` | Error in matching evaluation |

#### Scenario: Happy path — integration required

- GIVEN a taxpayer with Convenio Multilateral and IIBB Córdoba
- WHEN `match_rentas_cordoba(cuit="20301234561")` is called
- THEN `status` MUST be `"success"`
- AND `result.tiene_convenio_multilateral` MUST be `True`
- AND `result.tiene_iibb_cordoba` MUST be `True`

#### Scenario: No integration needed

- GIVEN a taxpayer without IIBB Córdoba
- WHEN `match_rentas_cordoba(cuit="20301234561")` is called
- THEN `result.requiere_integracion` MUST be `False`
- AND `result.estado` MUST be `"no_requerido"`

---

### Tool: get_report_pdf

Generate a fiscal report PDF with optional real debt data.

#### Parameters

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `cuit` | `str` | — | CUIT del contribuyente |
| `mes` | `int \| None` | Current month | Month (1-12) |
| `anio` | `int \| None` | Current year | Year |
| `con_deuda` | `bool` | `False` | Include real debt from browser |

#### Behaviour

1. Consult Padrón A5
2. Calculate calendar with RulesEngine
3. Optionally extract real debt via `VencimientosDeudasTask`
4. Generate PDF with `PdfGenerator.generar()`
5. Save all results to FiscalMemoryClient

Stores pipeline results in memory: padron, pdf sent, and optionally deuda extraction.

#### Output

`UnifiedResponse[dict]` where `result` contains:
- `pdf_path` — absolute path to generated PDF
- `pages` — number of PDF pages
- `periodo` — fiscal period in `YYYY-MM` format

#### Error codes

| Code | Condition |
|------|-----------|
| `TA_NOT_AVAILABLE` | Access token unavailable |
| `BROWSER_NOT_CONFIGURED` | `con_deuda=True` but no Composio key |
| `CONSTANCIA_ERROR` | ARCA constancia has errors |
| `PDF_ERROR` | PDF generation failure |

#### Side effects

Saves to memory: `save_padron_result()`, `save_extraction_result()`, `save_pdf_sent()`.

#### Scenario: Happy path — PDF with deuda

- GIVEN a valid CUIT and Composio configured
- WHEN `get_report_pdf(cuit="20301234561", mes=6, anio=2026, con_deuda=True)` is called
- THEN `status` MUST be `"success"`
- AND `result.pdf_path` MUST be a non-empty string
- AND `result.pages` MUST be a positive integer

#### Scenario: PDF without deuda

- GIVEN a valid CUIT
- WHEN `get_report_pdf(cuit="20301234561", con_deuda=False)` is called
- THEN `status` MUST be `"success"`
- AND `result.pdf_path` MUST be a non-empty string
