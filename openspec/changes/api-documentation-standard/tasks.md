# Tasks: API Documentation Standard

## Review Workload Forecast

| Field | Value |
|-------|-------|
| Estimated changed lines | ~250-290 |
| 400-line budget risk | Low |
| Chained PRs recommended | No |
| Suggested split | Single PR |
| Delivery strategy | ask-on-risk |

Decision needed before apply: Yes
Chained PRs recommended: No
Chain strategy: pending
400-line budget risk: Low

## Phase 1: Foundation — Model Enrichment

- [x] 1.1 **models.py** — Add `Field(description=...)` to `ApiError.code`, `.cause`, `.remediation`; `UnifiedResponse.status`, `.result`, `.next_actions`, `.human_approval_required`, `.error`; `IdempotentRequest.idempotency_key

## Phase 2: Server Configuration

- [x] 2.1 **server.py** — Add `custom_openapi()` hook with `get_openapi()` call, `servers`, `contact.name`/`.url`/`.email`, `securitySchemes.Auth0OAuth2` (oauth2/authorizationCode placeholder), tags with descriptions; set `app.openapi = custom_openapi`

## Phase 3: Route Enrichment

- [x] 3.1 **health.py** — Add `response_model=UnifiedResponse[dict]`, `summary='Health check del agente'`, `responses={401,403,429}` with descriptions; translate docstring to ES
- [x] 3.2 **calendar.py** — Add `response_model=UnifiedResponse[RulesOutput]`, `summary`, `responses`; add `Field(description=..., examples=[...])` to `CalendarRequest`; translate docstring
- [x] 3.3 **report.py** — Enrich `get_taxpayer` (response_model `UnifiedResponse[PadronA5Output]`) and `report` (response_model `UnifiedResponse[dict]`); add `Field(...)` to `ReportRequest`; translate both docstrings
- [x] 3.4 **extract.py** — Add `response_model=UnifiedResponse[DeudaOutput]`, `summary`, `responses`; add `Field(...)` to `ExtractRequest`; translate docstring
- [x] 3.5 **admin.py** — Enrich all 5 endpoints (`register`, `apps`, `create_key`, `list_keys`, `me`); add `Field(...)` to `RegisterRequest`, `CreateAppRequest`, `CreateKeyRequest`; translate all docstrings

## Verification

- [x] 4.1 Server starts without errors — `uv run uvicorn fiscal_agent.api.server:app`
- [x] 4.2 OpenAPI schema returns contact, servers, security schemes, tag descriptions
- [x] 4.3 Every path has `summary`, `response_model`, and `{401,403,429}` responses
- [x] 4.4 All existing tests pass — `uv run pytest`
