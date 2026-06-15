# System Services Specification

## Purpose

Live status overview of every service in the fiscal-agent system.

## Requirements

| # | Endpoint | Method | Description |
|---|----------|--------|-------------|
| 1 | /v1/system/services | GET | List of services with status and uptime |

### Requirement 1: Services list

The system MUST return a list of system services, each with `name`, `version`, `status` (`healthy`|`degraded`|`down`), `uptime`, `last_check`, and `latency_ms`.

#### Scenario: Happy path — all services healthy

- GIVEN all services are operational
- WHEN GET /v1/system/services
- THEN status MUST be `"success"`
- AND each service MUST include `name`, `version`, `status`, `uptime`, `last_check`, `latency_ms`
- AND services SHOULD include API, Redis, Engram, TA ARCA, Composio

#### Scenario: Service degraded

- GIVEN a service (e.g. Engram) responds slowly (>2s)
- WHEN GET /v1/system/services
- THEN that service MUST report `status: "degraded"` with elevated `latency_ms`

#### Scenario: Service down

- GIVEN a service (e.g. Redis) is unreachable
- WHEN GET /v1/system/services
- THEN that service MUST report `status: "down"` with `error` description

### Requirement 2: Optional metrics per service

Services MAY include `error_rate` and `requests_total` when those metrics are available.

#### Scenario: Service with request metrics

- GIVEN the API service has request metrics from the metrics middleware
- WHEN GET /v1/system/services
- THEN the API service entry MAY include `error_rate` and `requests_total`
