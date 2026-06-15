# Delta for: REST API

## ADDED Requirements

### Requirement 7: GET /v1/memory/{cuit}

The system MUST return the full observation history for a CUIT.

#### Scenario: Happy path — observations exist

- GIVEN a CUIT with existing memory observations
- WHEN GET /v1/memory/{cuit}
- THEN `status` MUST be `"success"`
- AND `result` MUST be a list of observations, newest first
- AND HTTP response MUST be 200

#### Scenario: Empty memory — no observations

- GIVEN a CUIT with no observations
- WHEN GET /v1/memory/{cuit}
- THEN `status` MUST be `"success"`
- AND `result` MUST be `[]`

### Requirement 8: GET /v1/memory/{cuit}/{obs_type}

The system MUST return observations filtered by type for a CUIT.

#### Scenario: Happy path — type filter matches

- GIVEN a CUIT with observations of type `"padron"`
- WHEN GET /v1/memory/{cuit}/padron
- THEN `status` MUST be `"success"`
- AND all items in `result` MUST have `type == "padron"`

#### Scenario: Type filter no match

- GIVEN a CUIT with no observations of type `"deuda"`
- WHEN GET /v1/memory/{cuit}/deuda
- THEN `status` MUST be `"success"`
- AND `result` MUST be `[]`

### Requirement 9: POST /v1/memory/observe

The system MUST accept and persist a generic memory observation.

#### Scenario: Happy path — valid payload

- GIVEN a JSON body with `cuit`, `title`, `type`, `content`
- WHEN POST /v1/memory/observe
- THEN `status` MUST be `"success"`
- AND HTTP response MUST be 201

#### Scenario: Missing required field

- GIVEN a JSON body missing `cuit`
- WHEN POST /v1/memory/observe
- THEN `status` MUST be `"error"`
- AND HTTP response MUST be 422

### Requirement 10: Memory endpoints — cross-cutting

Memory endpoints MUST use `run_in_executor` for sync `FiscalMemoryClient`
calls. They SHOULD require scope `admin:*` (temporary fallback).
They MUST wrap responses in `UnifiedResponse`.

#### Scenario: Sync call isolation

- GIVEN a memory endpoint handler is `async`
- WHEN it invokes `FiscalMemoryClient`
- THEN the call MUST pass through `loop.run_in_executor(None, ...)`

#### Scenario: Auth fallback scope

- GIVEN no `memory:read` scope exists in `Scope` enum
- WHEN any memory endpoint is accessed
- THEN the required scope MUST be `admin:*`
