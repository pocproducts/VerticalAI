# Proposal: Fase 0 — Foundation

## Intent

Las 5 features del roadmap (API agent-ready, developer platform, x402 payments, multi-tenant, cost tracking) comparten requisitos base que hoy no existen: schema de respuesta uniforme, modelo de tenant/identity, y contrato de idempotencia. Sin esta base, cada feature nueva fuerza refactors destructivos sobre la anterior.

## Scope

### In Scope
- **Output schema unificado**: `UnifiedResponse[T]` genérico con `{status, result, next_actions, human_approval_required, error{code,cause,remediation}}`
- **Tenant/Identity model tree**: `Developer → App → ApiKey → Plan → Scope`, con validación de API key como capa base
- **Idempotency contract**: campo `idempotency_key` opcional en operaciones de escritura (schema only, sin almacenamiento)
- **Base models Pydantic v2** para los 3 conceptos, integrados con modelos existentes

### Out of Scope
- Servidor HTTP/REST (Fase 1) — MCP Server (Fase 2) — Rate limiting funcional (Feature02)
- Almacenamiento persistente de idempotency keys
- Developer onboarding real (solo modelo de datos)
- Tests (se agregan en fases siguientes)
- Operaciones semánticas agent-ready (Fase 1)
- Modificaciones a la CLI existente

## Capabilities

### New Capabilities
- `unified-output-schema`: contrato de respuesta uniforme para todas las operaciones del sistema
- `tenant-identity`: modelo de datos para developers, apps, API keys, planes y scopes
- `idempotency`: soporte base para idempotency_key en operaciones de escritura

### Modified Capabilities
None

## Approach

1. Agregar modelos Pydantic en `fiscal_agent/models.py`: `UnifiedResponse[T]` genérico, `ApiError`, `Developer`, `App`, `ApiKey`, `Plan`, `Scope`, e `IdempotentRequest` como base mixin.
2. Los modelos existentes (`DeudaOutput`, `RulesOutput`, `PadronA5Output`) se mantienen intactos — el output schema los envuelve, no los reemplaza.
3. Exportar los nuevos modelos desde `fiscal_agent/__init__.py`. No tocar la CLI ni ningún otro módulo.

## Affected Areas

| Area | Impact | Description |
|------|--------|-------------|
| `fiscal_agent/models.py` | Modified | +5-8 modelos Pydantic nuevos |
| `fiscal_agent/__init__.py` | Modified | Exportar nuevos modelos |

## Risks

| Risk | Likelihood | Mitigation |
|------|------------|------------|
| Over-engineering para features que no existen | Med | Modelos ligeros (Pydantic), sin infraestructura asociada, fáciles de cambiar |
| Conflicto con modelos existentes | Low | Los nuevos envuelven a los existentes, no los reemplazan |

## Rollback Plan

`git revert` del commit. No hay migraciones, ni cambios de esquema, ni dependencias nuevas.

## Dependencies

Ninguna externa. Solo Pydantic v2, ya presente en el proyecto.

## Success Criteria

- [ ] `UnifiedResponse[T]` es generic y type-safe
- [ ] Modelos existentes funcionan sin cambios
- [ ] Schema unificado cubre: status, result, next_actions, human_approval_required, error con code+cause+remediation
- [ ] Modelos de tenant cubren: Developer, App, ApiKey, Plan, Scope
- [ ] `idempotency_key` presente como campo opcional en operaciones de escritura
