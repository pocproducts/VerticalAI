# Request Metrics Specification

## Purpose

FastAPI middleware that captures per-endpoint request count, HTTP status distribution, and latency percentiles in memory.

## Requirements

| # | Feature | Scope | Description |
|---|---------|-------|-------------|
| 1 | Request counting | All endpoints | Count requests by endpoint path |
| 2 | Status code tracking | All endpoints | Group by 2xx, 4xx, 5xx |
| 3 | Latency percentiles | All endpoints | p50, p95, p99 in memory |

### Requirement 1: Request count by endpoint

The middleware MUST increment a per-endpoint counter for every incoming request.

#### Scenario: Request counted

- GIVEN the metrics middleware is active
- WHEN a request hits GET /v1/health
- THEN the counter for `GET /v1/health` MUST increment by 1

#### Scenario: Unknown endpoint counted

- GIVEN a request to a non-existent path
- WHEN a request hits GET /v1/unknown
- THEN the request MUST still be counted under that path pattern

### Requirement 2: HTTP status code groups

The middleware MUST track HTTP status distribution grouped as 2xx, 4xx, and 5xx per endpoint.

#### Scenario: Status tracked

- GIVEN a request to POST /v1/calendar returns 200
- WHEN the response is sent
- THEN the 2xx counter for POST /v1/calendar MUST increment by 1

#### Scenario: Error status tracked

- GIVEN a request returns 422 validation error
- WHEN the response is sent
- THEN the 4xx counter for that endpoint MUST increment

### Requirement 3: Latency percentiles

The middleware MUST track request latency and expose p50, p95, and p99 in memory.

#### Scenario: Percentiles computed

- GIVEN 100 requests to the same endpoint with varying latencies
- WHEN metrics are queried
- THEN p50 SHOULD be at or below the median latency
- AND p95 and p99 MUST be present

### Requirement 4: Metrics reset

Metrics are in-memory and MAY reset on server restart.

#### Scenario: Volatile metrics

- GIVEN a running server with accumulated metrics
- WHEN the server restarts
- THEN all request metrics MUST start at zero
