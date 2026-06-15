# System Errors Specification

## Purpose

Queryable list of system errors with type, severity, service, and trend classification.

## Requirements

| # | Endpoint | Method | Query Params | Description |
|---|----------|--------|--------------|-------------|
| 1 | /v1/system/errors | GET | `severity`, `service`, `period` (default 24h) | Filtered error list |

### Requirement 1: Error listing with filters

The system MUST return a filtered list of errors. Each error MUST include `id`, `type`, `message`, `severity`, `service`, `timestamp`, `count`, and `trend`.

#### Scenario: Happy path — all errors in default period

- GIVEN errors exist in the last 24 hours
- WHEN GET /v1/system/errors
- THEN status MUST be `"success"`
- AND each error MUST have `id`, `type`, `message`, `severity`, `service`, `timestamp`, `count`, `trend`

#### Scenario: Filter by severity

- GIVEN errors of mixed severity exist
- WHEN GET /v1/system/errors?severity=critical
- THEN all returned errors MUST have `severity: "critical"`
- AND no lower-severity errors MUST appear

#### Scenario: Filter by service

- GIVEN errors from multiple services exist
- WHEN GET /v1/system/errors?service=Composio
- THEN all returned errors MUST have `service: "Composio"`

#### Scenario: Combined filters

- GIVEN errors across services and severities
- WHEN GET /v1/system/errors?severity=high&service=Engram&period=7d
- THEN only errors matching ALL filters MUST be returned

#### Scenario: No errors in period

- GIVEN no errors in the requested period
- WHEN GET /v1/system/errors
- THEN `result` MUST be an empty list

### Requirement 2: Error type classification

Error `type` MUST be one of: `TimeoutException`, `ARCAError`, `ComposioError`, `EngramError`, `RedisError`, `ValidationError`, or `Unknown`.

#### Scenario: Known error types

- GIVEN errors with known types exist
- WHEN GET /v1/system/errors
- THEN each error MUST have a `type` from the allowed classification

### Requirement 3: Trend indication

Each error MUST include a `trend` field: `increasing`, `stable`, or `decreasing`.

#### Scenario: Trend based on count

- GIVEN an error appeared 10 times in last hour vs 2 times the hour before
- WHEN GET /v1/system/errors
- THEN that error MUST report `trend: "increasing"`
