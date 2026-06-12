# Tasks: Fase 0 — Foundation

## Review Workload Forecast

| Field | Value |
|-------|-------|
| Estimated changed lines | ~120-180 |
| 400-line budget risk | Low |
| Chained PRs recommended | No |
| Suggested split | single PR |
| Delivery strategy | single-pr |
| Chain strategy | size-exception |

Decision needed before apply: No
Chained PRs recommended: No
Chain strategy: size-exception
400-line budget risk: Low

### Suggested Work Units

| Unit | Goal | Likely PR | Notes |
|------|------|-----------|-------|
| 1 | Agregar modelos base y output schema a `models.py` | PR 1 | UnifiedResponse, ApiError, IdempotentRequest |
| 2 | Agregar modelos de identity/tenant a `models.py` | PR 1 | Scope, Developer, App, ApiKey, Plan |
| 3 | Exportar nuevos modelos en `__init__.py` | PR 1 | Actualizar exports |

### Phase 1: Modelos de Output Schema

- [x] 1.1 Agregar `ApiError` (code, cause, remediation) en `fiscal_agent/models.py`
- [x] 1.2 Agregar `UnifiedResponse[T]` generic con status, result, next_actions, human_approval_required, error en `fiscal_agent/models.py`
- [x] 1.3 Agregar `IdempotentRequest` con idempotency_key opcional en `fiscal_agent/models.py`

### Phase 2: Modelos de Identity/Tenant

- [x] 2.1 Agregar `Scope` como `str, Enum` con scopes definidos en `fiscal_agent/models.py`
- [x] 2.2 Agregar `Developer` (id, name, email, created_at, is_active) en `fiscal_agent/models.py`
- [x] 2.3 Agregar `App` (id, developer_id, name, environment, status) en `fiscal_agent/models.py`
- [x] 2.4 Agregar `ApiKey` (id, app_id, key_preview, is_active, scopes, created_at, expires_at) en `fiscal_agent/models.py`
- [x] 2.5 Agregar `Plan` (id, name, scopes, rate_limit_rpm, rate_limit_rpd) en `fiscal_agent/models.py`

### Phase 3: Exports y verificación

- [x] 3.1 Exportar los 8 nuevos modelos en `fiscal_agent/__init__.py`
- [ ] 3.2 ~~Verificar que los imports funcionen~~ (sin bash)
