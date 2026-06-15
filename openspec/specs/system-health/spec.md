# System Health Specification

## Purpose

Extended health check that reports live status for all system dependencies: API, Redis, Engram, TA ARCA, and Composio.

## Requirements

| # | Endpoint | Method | Response Model | Description |
|---|----------|--------|----------------|-------------|
| 1 | /v1/health | GET | `SystemHealth` | Extended health with per-service status |

### Requirement 1: Extended health check

The system MUST return a `SystemHealth` response with a `services` list where each entry contains `service`, `status` (`healthy`|`unhealthy`), `last_check`, `latency_ms`, and an optional `error` field.

#### Scenario: All services healthy

- GIVEN API, Redis, Engram, TA ARCA, and Composio are all operational
- WHEN GET /v1/health
- THEN `status` MUST be `"success"`
- AND `result.services` MUST contain entries for each dependency
- AND each entry MUST have `status: "healthy"` and a non-negative `latency_ms`

#### Scenario: Redis connection failure

- GIVEN Redis is unreachable
- WHEN GET /v1/health
- THEN Redis MUST report `status: "unhealthy"` with an `error` describing the failure
- AND all other services MUST still be reported with their actual status

#### Scenario: TA ARCA token expired

- GIVEN the TA ARCA token is expired or missing
- WHEN GET /v1/health
- THEN TA ARCA MUST report `status: "unhealthy"` with `error` containing expiry details

#### Scenario: Partial failure — one service down, others up

- GIVEN Composio returns 401 but Redis and Engram respond
- WHEN GET /v1/health
- THEN Composio MUST be `"unhealthy"` while Redis and Engram are `"healthy"`
- AND the overall endpoint MUST still return HTTP 200
