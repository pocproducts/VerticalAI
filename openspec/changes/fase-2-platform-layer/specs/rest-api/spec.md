# REST API — Delta Specification (Fase 2)

> **Based on:** `openspec/specs/rest-api/spec.md`
> **Change scope:** Add auth + scope enforcement to existing endpoints.

## Scope Requirements

Todos los endpoints excepto `/v1/health` requieren API key autenticada y un scope específico:

| Endpoint | Method | Scope Required | Cambio |
|----------|--------|---------------|--------|
| /v1/health | GET | Ninguno (público) | Nuevo — abierto |
| /v1/calendar | POST | `calendar:read` | Agregado |
| /v1/taxpayer/{cuit} | GET | `taxpayer:read` | Agregado |
| /v1/report | POST | `report:write` | Agregado |
| /v1/extract | POST | `taxpayer:read` | Agregado |

## Modified Requirements

### Requirement 1: POST /v1/calendar (modified)

The system MUST accept calendar requests. Requires API key with `calendar:read` scope. *(Previously: sin autenticación)*

#### Scenario: Happy path — valid CUIT with deadlines

- GIVEN a valid CUIT registered in ARCA Padrón A5
- AND a valid API key with `calendar:read` scope
- WHEN POST /v1/calendar with `cuit`, `mes`, `anio`
- THEN `status` MUST be `"success"`
- AND `result` MUST contain the calculated deadlines

#### Scenario: Error — CUIT not found

- GIVEN a CUIT that does not exist in ARCA Padrón A5
- AND a valid API key with `calendar:read`
- WHEN POST /v1/calendar with that CUIT
- THEN `status` MUST be `"error"`
- AND `error.code` MUST be `"TAXPAYER_NOT_FOUND"`

### Requirement 2: POST /v1/report (modified)

The system MUST accept full pipeline requests. Requires API key with `report:write` scope. *(Previously: sin autenticación)*

#### Scenario: Happy path — full pipeline

- GIVEN a valid CUIT with `with_deuda`, `with_facilidades`, `with_registro`, `send_email` all `True`
- AND a valid API key with `report:write` scope
- WHEN POST /v1/report
- THEN `status` MUST be `"success"`
- AND `result` MUST contain `pdf_path` and `email_status`

### Requirement 3: GET /v1/taxpayer/{cuit} (modified)

The system MUST return taxpayer profile data. Requires API key with `taxpayer:read` scope. *(Previously: sin autenticación)*

#### Scenario: Happy path — valid CUIT

- GIVEN a valid CUIT registered in Padrón A5
- AND a valid API key with `taxpayer:read` scope
- WHEN GET /v1/taxpayer/{cuit}
- THEN `status` MUST be `"success"`
- AND `result` MUST contain the taxpayer data

#### Scenario: Error — invalid CUIT format

- GIVEN a CUIT with invalid format
- AND a valid API key with `taxpayer:read`
- WHEN GET /v1/taxpayer/{cuit}
- THEN `status` MUST be `"error"`
- AND `error.code` MUST be `"INVALID_CUIT"`

### Requirement 4: POST /v1/extract (modified)

The system MUST accept extraction tasks. Requires API key with `taxpayer:read` scope. *(Previously: sin autenticación)*

#### Scenario: Happy path — successful extraction

- GIVEN a valid CUIT and task list
- AND a valid API key with `taxpayer:read` scope
- WHEN POST /v1/extract with `tasks = ["deuda", "facilidades"]`
- THEN `status` MUST be `"success"`
- AND `result` MUST contain extracted data

### Requirement 5: GET /v1/health (modified)

The system MUST return health status. This endpoint is PUBLIC — no API key required. *(Previously: sin autenticación, se mantiene igual)*

#### Scenario: Server is running

- GIVEN the server started successfully
- WHEN GET /v1/health (without any API key)
- THEN `status` MUST be `"success"`
- AND `result` MUST contain `server_status`, `timestamp`, and `ta_expiration`

## Unchanged

Requirements 6 (UnifiedResponse envelope) and its scenarios from the base spec remain unchanged. All existing scenarios remain valid with the added precondition of a valid authenticated API key with the correct scope.
