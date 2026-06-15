# Memory REST API Specification

## Purpose

REST endpoints to read/write fiscal memory (observations) per CUIT. Consumes
`FiscalMemoryClient` (sync) via `run_in_executor` to avoid blocking the
event loop. Follows existing router conventions: `APIRouter`, `ScopeRequired`,
`UnifiedResponse` envelope.

## Requirements

### Requirement 1: GET /v1/memory/{cuit}

The system MUST return all observations for a CUIT, newest first.

#### Scenario: Happy path — CUIT with observations

- GIVEN a CUIT with existing memory observations
- WHEN GET /v1/memory/{cuit}
- THEN status MUST be `"success"`
- AND result MUST contain the full observation list, newest first

#### Scenario: Empty memory — CUIT with no observations

- GIVEN a CUIT with no memory observations
- WHEN GET /v1/memory/{cuit}
- THEN status MUST be `"success"`
- AND result MUST be an empty list

#### Scenario: Invalid CUIT format

- GIVEN a CUIT with invalid format (wrong length or non-numeric)
- WHEN GET /v1/memory/{cuit}
- THEN status MUST be `"error"`
- AND error.code MUST be `"INVALID_CUIT"`

### Requirement 2: GET /v1/memory/{cuit}/{obs_type}

The system MUST filter observations by type for a CUIT.

#### Scenario: Happy path — observations of matching type exist

- GIVEN a CUIT with observations of type `"padron"`
- WHEN GET /v1/memory/{cuit}/padron
- THEN status MUST be `"success"`
- AND result MUST contain only observations where type = `"padron"`

#### Scenario: Type filter returns empty

- GIVEN a CUIT with no observations of type `"deuda"`
- WHEN GET /v1/memory/{cuit}/deuda
- THEN status MUST be `"success"`
- AND result MUST be an empty list

### Requirement 3: POST /v1/memory/observe

The system MUST accept a generic observation and persist it to Engram.

#### Scenario: Happy path — valid observation

- GIVEN a valid `{cuit, title, type, content}` payload
- WHEN POST /v1/memory/observe
- THEN status MUST be `"success"`
- AND HTTP response MUST be 201

#### Scenario: Missing required fields

- GIVEN a payload missing `cuit` or `title`
- WHEN POST /v1/memory/observe
- THEN status MUST be `"error"`
- AND error.code MUST be `"VALIDATION_ERROR"`

#### Scenario: Engram unavailable

- GIVEN Engram is unreachable
- WHEN POST /v1/memory/observe
- THEN status MUST be `"error"`
- AND error.code MUST be `"MEMORY_UNAVAILABLE"`

### Requirement 4: run_in_executor isolation (cross-cutting)

All memory endpoints MUST route `FiscalMemoryClient` calls through
`run_in_executor` to avoid blocking the async event loop.

#### Scenario: Sync client call via executor

- GIVEN a FastAPI async handler for a memory endpoint
- WHEN the handler calls `FiscalMemoryClient`
- THEN the call MUST be wrapped in `loop.run_in_executor(None, ...)`

### Requirement 5: Scoped access control

Memory endpoints SHOULD require scope `admin:*` (fallback while
`memory:*` scopes do not exist in the `Scope` enum).

#### Scenario: Missing or insufficient scope

- GIVEN a request without a valid API key
- WHEN accessing any `/v1/memory/` endpoint
- THEN status MUST be `"error"`
- AND HTTP response MUST be 401 or 403

### Requirement 6: Models

`MemoryObservation` SHALL be a Pydantic v2 model with fields:
`id, cuit, title, type, content, created_at`.

`MemoryQueryRequest` SHALL carry `cuit` (str, required), `obs_type`
(str, optional), `limit` (int, default 10).

`MemoryQueryResponse` SHALL wrap `observations: list[dict]` (resultados crudos de Engram).

#### Scenario: Model validation rejects oversized input

- GIVEN a POST body with `content` exceeding 10 KB
- WHEN POST /v1/memory/observe
- THEN status MUST be `"error"`
- AND error.code MUST be `"VALIDATION_ERROR"`
