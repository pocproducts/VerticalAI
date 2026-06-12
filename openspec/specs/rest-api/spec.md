# REST API Specification

## Purpose

FastAPI HTTP server exposing the fiscal pipeline capabilities as REST endpoints. All responses use `UnifiedResponse[T]` as the output envelope. Business logic is reused from the existing CLI — no duplication.

## Requirements

| # | Endpoint | Method | Input | Backend Logic | Output Envelope |
|---|----------|--------|-------|---------------|-----------------|
| 1 | /v1/calendar | POST | `cuit` (str), `mes` (int 1-12), `anio` (int), MAY accept `idempotency_key` | `RulesEngine.calcular()` + `consultar_cuit()` | `UnifiedResponse[RulesOutput]` |
| 2 | /v1/report | POST | `cuit`, `mes`, `anio`, `with_deuda`/`with_facilidades`/`with_registro`/`send_email` (bools), MAY accept `idempotency_key` | calendar + Composio Browser (optional) + PDF + email (optional) | `UnifiedResponse[dict]` |
| 3 | /v1/taxpayer/{cuit} | GET | `cuit` (path param) | `consultar_cuit()` → Padrón A5 | `UnifiedResponse[PadronA5Output]` |
| 4 | /v1/extract | POST | `cuit` (str), `tasks` (list[str] enum: deuda, facilidades, registro), MAY accept `idempotency_key` | `ComposioBrowser.run_single()` | `UnifiedResponse[DeudaOutput]` |
| 5 | /v1/health | GET | None | Server status + timestamp + TA vigente | `UnifiedResponse[dict]` |

### Requirement 1: POST /v1/calendar

The system MUST accept calendar requests and return fiscal deadlines.

#### Scenario: Happy path — valid CUIT with deadlines

- GIVEN a valid CUIT registered in ARCA Padrón A5
- WHEN POST /v1/calendar with `cuit`, `mes`, `anio`
- THEN `status` MUST be `"success"`
- AND `result` MUST contain the calculated deadlines

#### Scenario: Error — CUIT not found in padrón

- GIVEN a CUIT that does not exist in ARCA Padrón A5
- WHEN POST /v1/calendar with that CUIT
- THEN `status` MUST be `"error"`
- AND `error.code` MUST be `"TAXPAYER_NOT_FOUND"`

### Requirement 2: POST /v1/report

The system MUST accept full pipeline requests and return a report with optional browser data, PDF, and email delivery.

#### Scenario: Happy path — full pipeline with all flags

- GIVEN a valid CUIT with `with_deuda`, `with_facilidades`, `with_registro`, `send_email` all `True`
- WHEN POST /v1/report
- THEN `status` MUST be `"success"`
- AND `result` MUST contain `pdf_path` and `email_status`

#### Scenario: No email configured — requires human approval

- GIVEN `send_email` is `True` but no email configuration exists
- WHEN POST /v1/report
- THEN `status` MUST be `"success"`
- AND `human_approval_required` MUST be `True`
- AND `next_actions` MUST include `"configure_email"`

### Requirement 3: GET /v1/taxpayer/{cuit}

The system MUST return taxpayer profile data from Padrón A5.

#### Scenario: Happy path — valid CUIT

- GIVEN a valid CUIT registered in Padrón A5
- WHEN GET /v1/taxpayer/{cuit}
- THEN `status` MUST be `"success"`
- AND `result` MUST contain the taxpayer data

#### Scenario: Error — invalid CUIT format

- GIVEN a CUIT with invalid format (wrong length or checksum)
- WHEN GET /v1/taxpayer/{cuit}
- THEN `status` MUST be `"error"`
- AND `error.code` MUST be `"INVALID_CUIT"`

### Requirement 4: POST /v1/extract

The system MUST accept extraction tasks for browser-based data retrieval.

#### Scenario: Happy path — successful extraction

- GIVEN a valid CUIT and task list
- WHEN POST /v1/extract with `tasks = ["deuda", "facilidades"]`
- THEN `status` MUST be `"success"`
- AND `result` MUST contain extracted data

#### Scenario: Error — Composio browser timeout

- GIVEN ComposioBrowser is unresponsive
- WHEN POST /v1/extract
- THEN `status` MUST be `"error"`
- AND `error.code` MUST be `"BROWSER_TIMEOUT"`

### Requirement 5: GET /v1/health

The system MUST return a health check response with server status, timestamp, and current TA validity.

#### Scenario: Server is running

- GIVEN the server started successfully
- WHEN GET /v1/health
- THEN `status` MUST be `"success"`
- AND `result` MUST contain `server_status`, `timestamp`, and `ta_expiration`

### Requirement 6: Unified response envelope (cross-cutting)

All HTTP endpoints MUST wrap responses in `UnifiedResponse[T]`. All POST endpoints SHOULD accept an optional `idempotency_key` field.

#### Scenario: POST endpoint with idempotency key

- GIVEN a POST endpoint
- WHEN the request includes `idempotency_key`
- THEN the key MUST be passed to the backend for deduplication
