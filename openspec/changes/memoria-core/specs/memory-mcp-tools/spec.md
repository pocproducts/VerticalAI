# Memory MCP Tools Specification

## Purpose

MCP tools to read/write fiscal memory, following the existing tool pattern:
`@mcp.tool()` decorator, `ctx.request_context.lifespan_context` for service
access, `UnifiedResponse` serialized via `model_dump_json()`.

## Requirements

### Requirement 1: get_memory_history

The system MUST expose an MCP tool `get_memory_history` that returns
observations for a CUIT, optionally filtered by type.

#### Scenario: Happy path — observations returned

- GIVEN a CUIT with existing observations
- WHEN the tool is called with `cuit="20301234561"`
- THEN the response MUST be a `UnifiedResponse` with `status="success"`
- AND `result` MUST contain a list of observations, newest first

#### Scenario: Filtered by type

- GIVEN a CUIT with observations of type `"padron"` and `"deuda"`
- WHEN the tool is called with `cuit="20301234561"` and `obs_type="padron"`
- THEN result MUST contain only observations of type `"padron"`

#### Scenario: Limit parameter respected

- GIVEN a CUIT with 20 observations
- WHEN the tool is called with `cuit="20301234561"` and `limit=5`
- THEN result MUST contain at most 5 observations

#### Scenario: CUIT not found in memory

- GIVEN a CUIT that has never been written to
- WHEN the tool is called with that CUIT
- THEN response MUST be a `UnifiedResponse` with `status="success"`
- AND result MUST be an empty list

### Requirement 2: save_memory_observation

The system MUST expose an MCP tool `save_memory_observation` that persists
an observation for a CUIT.

#### Scenario: Happy path — observation persisted

- GIVEN valid parameters `cuit, title, type, content`
- WHEN the tool is called
- THEN response MUST be a `UnifiedResponse` with `status="success"`

#### Scenario: Engram unavailable

- GIVEN Engram is unreachable
- WHEN the tool is called
- THEN response MUST be a `UnifiedResponse` with `status="error"`
- AND `error.code` MUST be `"MEMORY_UNAVAILABLE"`

### Requirement 3: Service resolution

The tool MUST obtain `FiscalMemoryClient` from
`ctx.request_context.lifespan_context['memory']`.

#### Scenario: Memory service in lifespan context

- GIVEN the MCP server started with `FiscalMemoryClient` in lifespan context
- WHEN either tool is invoked
- THEN `ctx.request_context.lifespan_context['memory']` MUST resolve
- AND the resolved client MUST be used for all memory operations

