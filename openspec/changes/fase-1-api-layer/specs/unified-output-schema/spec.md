# Delta for Unified Output Schema

## ADDED Requirements

### Requirement: HTTP Endpoints MUST use UnifiedResponse envelope

All HTTP REST endpoints MUST wrap their responses in `UnifiedResponse[T]` as the output envelope. The envelope MUST include `status`, `result`, `next_actions`, `human_approval_required`, and `error` fields per their existing semantics defined in the main spec.

#### Scenario: GET /v1/health returns UnifiedResponse

- GIVEN the server is running
- WHEN a GET /v1/health request is processed
- THEN the response MUST be a valid `UnifiedResponse` with `status`, `result`, `next_actions`, `human_approval_required`, `error`

#### Scenario: POST endpoint error returns UnifiedResponse with ApiError

- GIVEN a POST endpoint receives invalid input
- WHEN the handler detects the error
- THEN `status` MUST be `"error"`
- AND `error` MUST be a valid `ApiError` with `code`, `cause`, and optionally `remediation`
