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
| 6 | /v1/memory/{cuit} | GET | `cuit` (path), `limit` (query, default 10) | `FiscalMemoryClient.get_pipeline_history()` via `asyncio.to_thread` | `UnifiedResponse[list]` |
| 7 | /v1/memory/{cuit}/{obs_type} | GET | `cuit` (path), `obs_type` (path), `limit` (query, default 10) | `FiscalMemoryClient.get_extraction_history()` via `asyncio.to_thread` | `UnifiedResponse[list]` |
| 8 | /v1/memory/observe | POST | `MemoryObserveRequest` body (cuit, title, type, content) | `FiscalMemoryClient._engram_post('/observations', ...)` via `asyncio.to_thread` | `UnifiedResponse[dict]` |
| 9 | /v1/memory… scopes | — | — | All memory endpoints require `admin:*` scope via `ScopeRequired` | — |
| 10 | /v1/chat/message | POST | `message` (str), `conversation_id` (str, optional), `history` (list[dict], optional) | `IntentRouter.detect()` → internal handler reuse → `ResponseBuilder.format()` | `ChatResponse` (proprietary: `{conversation_id, reply, actions_taken, data}`) |

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

The system MUST return an extended health check response that includes server status, timestamp, TA validity, AND per-service status for Redis, Engram, TA ARCA, and Composio.
(Previously: Only returned server_status, timestamp, and ta_expiration — no per-service status)

#### Scenario: Server is running with extended health

- GIVEN the server started successfully
- WHEN GET /v1/health
- THEN `status` MUST be `"success"`
- AND `result` MUST contain `server_status`, `timestamp`, `ta_expiration`, AND `services`
- AND `services` MUST list each dependency with `service`, `status`, `last_check`, `latency_ms`

#### Scenario: Redis connection failure in health endpoint

- GIVEN Redis is unreachable
- WHEN GET /v1/health
- THEN Redis entry MUST have `status: "unhealthy"` with an `error` field
- AND other services MUST still be reported

#### Scenario: TA ARCA certificate expired

- GIVEN the TA ARCA token is expired
- WHEN GET /v1/health
- THEN TA ARCA entry MUST have `status: "unhealthy"` with expiry details in `error`

#### Scenario: Composio API key invalid

- GIVEN Composio API key returns 401
- WHEN GET /v1/health
- THEN Composio entry MUST have `status: "unhealthy"` with error description

#### Scenario: All healthy — backward compatible shape

- GIVEN all services respond
- WHEN GET /v1/health
- THEN `result.server_status` MUST be `"ok"` (backward compat)
- AND `result.ta_expiration` MUST still be present (backward compat)
- AND `result.services` MUST be the new extended field

### Requirement 7: GET /v1/memory/{cuit}

The system MUST return the memory observation history for a CUIT.

#### Scenario: Happy path — valid CUIT with observations

- GIVEN a valid CUIT with existing observations in Engram
- WHEN GET /v1/memory/{cuit}
- THEN `status` MUST be `"success"`
- AND `result` MUST be a list of observations

#### Scenario: Empty history — CUIT without observations

- GIVEN a CUIT with no observations
- WHEN GET /v1/memory/{cuit}
- THEN `status` MUST be `"success"`
- AND `result` MUST be an empty list

### Requirement 8: GET /v1/memory/{cuit}/{obs_type}

The system MUST filter memory observations by type for a CUIT.

#### Scenario: Happy path — filter by type

- GIVEN a CUIT with observations of type "padron"
- WHEN GET /v1/memory/{cuit}/padron
- THEN `status` MUST be `"success"`
- AND `result` MUST only contain observations with type "padron"

#### Scenario: No observations of that type

- GIVEN a CUIT with no error observations
- WHEN GET /v1/memory/{cuit}/error
- THEN `status` MUST be `"success"`
- AND `result` MUST be an empty list

### Requirement 9: POST /v1/memory/observe

The system MUST accept observation creation requests and persist them to Engram.

#### Scenario: Happy path — valid observation

- GIVEN a valid `MemoryObserveRequest` with cuit, title, type, content
- WHEN POST /v1/memory/observe
- THEN status MUST be 201
- AND `status` MUST be `"success"`
- AND `result` MUST contain `cuit`, `type`, `title`

#### Scenario: Validation error — content too large

- GIVEN a `MemoryObserveRequest` with content > 10 KB
- WHEN POST /v1/memory/observe
- THEN status MUST be 422
- AND `error.code` MUST be `"VALIDATION_ERROR"`

### Requirement 10: Auth scope enforcement on memory endpoints

All memory endpoints MUST require `admin:*` scopes.

#### Scenario: Insufficient scope

- GIVEN an API key with `calendar:read` scope but no `admin:*` scope
- WHEN GET /v1/memory/{cuit}
- THEN status MUST be 403
- AND `error.code` MUST be `"INSUFFICIENT_SCOPE"`

### Requirement 11: POST /v1/chat/message

The system MUST accept natural-language fiscal queries and return structured chat replies. Uses `ChatResponse` (proprietary envelope) instead of `UnifiedResponse` — the chat response shape (`reply`, `actions_taken`, `data`) does not fit the generic envelope.

#### Scenario: Happy path — consulta CUIT

- GIVEN a message like "consulta datos del contribuyente 20-32483779-6"
- WHEN POST /v1/chat/message processes it
- THEN `actions_taken` MUST contain `"consultar_cuit"`
- AND `data` MUST contain PadronA5Output fields (nombre, tipo, domicilio)

#### Scenario: Happy path — consulta deuda

- GIVEN a message like "deuda de 20324837796"
- WHEN POST /v1/chat/message processes it
- THEN `actions_taken` MUST contain `"consultar_deuda"`
- AND `reply` MUST include the total debt amount in natural language

#### Scenario: Mensaje sin CUIT

- GIVEN a message without any valid CUIT pattern
- WHEN POST /v1/chat/message processes it
- THEN `reply` MUST prompt the user to provide a CUIT
- AND `actions_taken` MUST be an empty list

### Requirement 6: Unified response envelope (cross-cutting)

All HTTP endpoints MUST wrap responses in `UnifiedResponse[T]`. All POST endpoints SHOULD accept an optional `idempotency_key` field.

Exception: `POST /v1/chat/message` uses a proprietary `ChatResponse` envelope.

#### Scenario: POST endpoint with idempotency key

- GIVEN a POST endpoint
- WHEN the request includes `idempotency_key`
- THEN the key MUST be passed to the backend for deduplication
