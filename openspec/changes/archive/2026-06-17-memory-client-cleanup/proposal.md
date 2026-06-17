# Proposal: Memory Client Cleanup

## Intent

Exponer métodos públicos en `FiscalMemoryClient` para que `mcp/tools/memory.py` y `api/routes/memory.py` dejen de acceder a implementation details privados (`_engram_post`, `_session_cache`, `_cuit_session_id`).

## Scope

### In Scope
1. Agregar `FiscalMemoryClient.save_observation(cuit, title, type, content)` — método público que wrappea `_ensure_cuit_session` + `_engram_post` + `_session_cache`
2. Renombrar `_cuit_session_id` → `cuit_session_id` (público, útil para callers)
3. Actualizar `mcp/tools/memory.py` — usar `save_observation()` y `cuit_session_id()`
4. Actualizar `api/routes/memory.py` — usar `save_observation()` y `cuit_session_id()`
5. Actualizar tests que mockean los privados

### Out of Scope
- Mejoras a `_engram_post` o `_engram_get`
- Cache layer changes
- Nuevos métodos de lectura

## Approach

Additivo: se agrega `save_observation()` sin eliminar los privados. Los callers se actualizan uno por uno.

## Affected Areas
- `fiscal_agent/memory/client.py` — +save_observation(), rename _cuit_session_id → cuit_session_id
- `fiscal_agent/mcp/tools/memory.py` — usar métodos públicos
- `fiscal_agent/api/routes/memory.py` — usar métodos públicos
- `fiscal_agent/tests/test_mcp_memory.py` — update mocks
- `fiscal_agent/tests/test_api_memory.py` — update mocks
- `fiscal_agent/tests/test_memory.py` — update references

## Risks
None — refactor puro, zero behavioral change.

## Success Criteria
- [ ] `grep -rn "\._(engram_post\|session_cache\|cuit_session_id)" fiscal_agent/ --include="*.py"` count = 0 (en source, no tests)
- [ ] Tests pasan sin modificación de lógica
