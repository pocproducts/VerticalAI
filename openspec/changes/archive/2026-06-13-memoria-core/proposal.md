# Proposal: memoria-core

## Intent

No hay forma pública de leer/escribir memoria ni un cerebro central que correlacione padrón + deuda + facilidades + registro + calendario + matching. Cada cliente (CLI, API, MCP) llama fuentes separadas sin contexto unificado.

## Scope

### In Scope
- `GET /v1/memory/{cuit}` y `GET /v1/memory/{cuit}/{obs_type}` públicos
- `POST /v1/memory/observe` para escritura genérica
- `get_memory_history` y `save_memory_observation` como MCP tools
- `TenantBrain` — clase que recibe CUIT y construye `TenantContext` unificado
- Refactor de `matching.py` como método interno de `TenantBrain`

### Out of Scope
- Auth scopes `memory:*` (no existen en enum Scope — se difiere)
- Paralelización de `build_context()`
- Eliminar `FiscalMemoryClient` (sigue siendo capa de bajo nivel)

## Capabilities

### New
- `memory-rest-api`: Endpoints REST públicos para historial de memoria por CUIT.
- `memory-mcp-tools`: Tools MCP `get_memory_history` y `save_memory_observation`.
- `tenant-brain`: `TenantBrain` + `TenantContext` — correlación central de toda la info fiscal de un CUIT.

### Modified
- `rest-api`: Se agregan 3 endpoints (memory list, memory filter, observe). Se debe modificar `openspec/specs/rest-api/spec.md` para incluirlos en la tabla de endpoints.

## Approach

1. Modelos Pydantic en `fiscal_agent/memory/models.py` — `MemoryObservation`, `TenantContext`
2. `TenantBrain` en `memory/brain.py` — `build_context(cuit)` agrega padrón, deuda, facilidades, registro, calendario, matching. Refactoriza `matching.py` como `_match_rentas()`
3. Router `api/routes/memory.py` — 3 endpoints con `run_in_executor` para calls sync a Engram
4. Tool `mcp/tools/memory.py` — 2 tools, mismo patrón de las existentes

## Affected Areas

| Area | Impact | Description |
|------|--------|-------------|
| `memory/models.py` | New | Modelos Pydantic |
| `memory/brain.py` | New | `TenantBrain` class |
| `api/routes/memory.py` | New | Router FastAPI |
| `mcp/tools/memory.py` | New | Tools MCP |
| `matching.py` | Modified | Refactor como método interno |
| `openspec/specs/rest-api/spec.md` | Modified | 3 nuevos endpoints |

## Risks

| Risk | Likelihood | Mitigation |
|------|------------|------------|
| Sync Engram calls bloquean event loop | Med | `run_in_executor` |
| Scope `memory:*` no existe en enum | Low | Fallback `admin:*` |
| `build_context()` lento por calls secuenciales | Low | Cache Redis CUIT + TTL 5min |

## Rollback Plan

Revertir `api/routes/memory.py`, `mcp/tools/memory.py`, `memory/brain.py`, `memory/models.py`. `matching.py` refactor es interno — el wrapper mantiene API pública. Sin cambios en `cli.py` ni `server.py`.

## Dependencies

- `FiscalMemoryClient` de `engram-memory-and-dockerization`
- `fiscal_agent/matching.py` (se refactoriza, no reemplaza)

## Success Criteria

- [ ] `GET /v1/memory/{cuit}` → historial completo + status 200
- [ ] `POST /v1/memory/observe` → observación persistida + 201
- [ ] MCP `get_memory_history` y `save_memory_observation` funcionan
- [ ] `TenantBrain.build_context(cuit)` retorna `TenantContext` completo
- [ ] `matching.py` refactorizado como `_match_rentas()` sin pérdida
- [ ] Engram calls pasan por `run_in_executor` — event loop no se bloquea
