# Delta for REST API — Health Endpoint

## MODIFIED Requirements

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
