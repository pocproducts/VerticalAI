# Proposal: API Documentation Standard

## Intent

FastAPI auto-generates OpenAPI 3.1 but current endpoints lack `response_model`, `summary`, error `responses`, and `examples` in request models. This makes the generated docs useless for consumers. Enrich all route decorators and Pydantic models with metadata — no behavioral changes.

## Scope

### In Scope
- `response_model=UnifiedResponse[X]` on all endpoint decorators (calendar, report, extract, admin, health)
- `summary` with concise descriptions on all endpoints
- `responses={401, 403, 429}` with descriptions on all endpoints
- `Field(examples=[...], description=...)` on Pydantic request models
- `app.openapi()` hook: servers, contact info, OAuth2 security scheme (Auth0 placeholder)
- Tag metadata (description per tag) in `server.py`
- Update `fiscal_agent/api/server.py` — OpenAPI metadata, tags, security schemes

### Out of Scope
- ❌ Custom docs portal (Redoc/Scalar) — deferred
- ❌ Auth0 integration — only the OpenAPI security scheme placeholder
- ❌ MCP tools documentation — separate mechanism

## Capabilities

> This is a pure metadata change — no spec-level behavior modification.

### New Capabilities
None

### Modified Capabilities
None

## Approach

1. Enrich route decorators in all 5 route files (`health.py`, `calendar.py`, `report.py`, `extract.py`, `admin.py`)
2. Enrich Pydantic request models in `models.py` with `examples` and `description`
3. Configure OpenAPI metadata, tags, and security schemes in `server.py`
4. Backward compatible — only metadata, zero behavior change

## Affected Areas

| Area | Impact | Description |
|------|--------|-------------|
| `fiscal_agent/api/server.py` | Modified | OpenAPI config, tags, security schemes |
| `fiscal_agent/api/routes/health.py` | Modified | response_model, summary, responses |
| `fiscal_agent/api/routes/calendar.py` | Modified | response_model, summary, responses |
| `fiscal_agent/api/routes/report.py` | Modified | response_model, summary, responses |
| `fiscal_agent/api/routes/extract.py` | Modified | response_model, summary, responses |
| `fiscal_agent/api/routes/admin.py` | Modified | response_model, summary, responses |
| `fiscal_agent/models.py` | Modified | Field(examples=[...]) on request models |

## Risks

| Risk | Likelihood | Mitigation |
|------|------------|------------|
| response_model mal tipado | Low | `UnifiedResponse[ModelType]` chequeado contra modelos existentes |
| Auth0 placeholder incorrecto | Low | Solo esquema OAuth2 en OpenAPI, sin validación real |
| Cambio puramente cosmético | None | Solo metadata, no cambia comportamiento |

## Rollback Plan

Revert the single commit. No migration, no data loss, no behavioral trace.

## Dependencies

None.

## Success Criteria

- [ ] All endpoints expose `response_model`, `summary`, and error `responses` in `/docs`
- [ ] All Pydantic request models show `examples` in the Swagger UI
- [ ] OpenAPI schema includes `servers`, `contact`, and `oauth2` security scheme
- [ ] Tags have descriptions in the generated schema
- [ ] All existing tests pass (zero behavioral change)
