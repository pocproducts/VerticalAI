# Tasks: memoria-core

## Review Workload Forecast

| Field | Value |
|-------|-------|
| Estimated changed lines | ~385 |
| 400-line budget risk | Medium |
| Chained PRs recommended | No |
| Suggested split | single PR |
| Delivery strategy | single-pr |
| Chain strategy | size-exception |

Decision needed before apply: No
Chained PRs recommended: No
Chain strategy: size-exception
400-line budget risk: Medium

### Suggested Work Units

| Unit | Goal | Likely PR | Notes |
|------|------|-----------|-------|
| 1 | Full cambio memoria-core | PR 1 (single) | base=main; ~385 líneas estimadas dentro del budget |

## Phase 1: Foundation — Modelos y types

- [x] 1.1 Crear `fiscal_agent/memory/models.py` con `MemoryObservation`, `MemoryQueryRequest`, `MemoryQueryResponse`, `MemoryObserveRequest`, `TenantContext` — todos Pydantic v2 con los campos del design
- [x] 1.2 Actualizar `fiscal_agent/memory/__init__.py` para exportar los nuevos modelos

## Phase 2: Core — TenantBrain

- [x] 2.1 Crear `fiscal_agent/memory/brain.py` con clase `TenantBrain.__init__(client: FiscalMemoryClient)`
- [x] 2.2 Implementar `build_context(cuit)` con 8 pasos secuenciales best-effort (try/except por source), seteando `ultimo_error` y continuando
- [x] 2.3 Refactorizar `evaluar_rentas_cordoba()` de `matching.py` como `TenantBrain._match_rentas()`, manteniendo thin wrapper público en `matching.py` con misma signature

## Phase 3: Integration — REST + MCP + wiring

- [x] 3.1 Crear `fiscal_agent/api/routes/memory.py` con `GET /v1/memory/{cuit}`, `GET /v1/memory/{cuit}/{obs_type}`, `POST /v1/memory/observe` — todos con `ScopeRequired(admin:*)`, `run_in_executor`, `UnifiedResponse`
- [x] 3.2 Crear `fiscal_agent/mcp/tools/memory.py` con `get_memory_history(cuit, obs_type?, limit)` y `save_memory_observation(cuit, title, type, content)` — patrón `ctx.lifespan_context['memory']`
- [x] 3.3 En `fiscal_agent/api/server.py`: importar `memory.router` e incluirlo con `tags=['memory']`
- [x] 3.4 En `fiscal_agent/mcp/server.py`: importar `fiscal_agent.mcp.tools.memory` junto a los other tools
- [x] 3.5 Agregar Requirements 7-10 (tabla de endpoints) en `openspec/specs/rest-api/spec.md`

## Phase 4: Testing

- [x] 4.1 Tests unitarios de models: `MemoryObserveRequest` validation (content max 10 KB, CUIT min_length), `TenantContext` defaults
- [x] 4.2 Tests de `TenantBrain.build_context()` con mock de `FiscalMemoryClient`: happy path, partial failure ARCA, partial failure Engram, CUIT vacío
- [x] 4.3 Tests de `_match_rentas()`: copiar tests existentes de `matching.py`, verificar output idéntico a `evaluar_rentas_cordoba()`
- [x] 4.4 Tests de API endpoints con `TestClient`: happy path GET/POST, invalid CUIT, validation error, auth fallback scope
- [x] 4.5 Tests de MCP tools con mock de lifespan_context: happy path read/write, Engram unavailable, limit param
