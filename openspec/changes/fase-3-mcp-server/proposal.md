# Proposal: Fase 3 — MCP Server

## Intent

Exponer el pipeline fiscal como **MCP tools** para que LLMs (Claude Desktop, Cline, etc.) consulten calendario, contribuyentes, deuda y ejecuten el pipeline completo desde interfaces conversacionales. Sin MCP Server, el pipeline solo es accesible vía CLI o REST API — ningún agente puede razonar sobre el estado fiscal de un cliente.

## Scope

### In Scope
- Server MCP con FastMCP (`mcp>=1.27,<2`) — STDIO por defecto
- 9 tools: `get_calendar`, `get_taxpayer`, `extract_deuda`, `extract_facilidades`, `extract_registro`, `run_pipeline`, `get_report_pdf`, `health`, `match_rentas_cordoba`
- Reuso directo de lógica existente en `cli.py`, `arca_ws.py`, `rules_engine.py`, `browser/`, `matching.py`, `pdf_generator.py`, `email_sender.py`
- Streamable HTTP opcional vía env `MCP_TRANSPORT=http` + auth middleware reusado de Fase 2
- Entry point `fiscal_agent/__main__.py` para `uv run mcp`

### Out of Scope
- Resources y prompts MCP (solo tools por ahora)
- UI chat o cliente MCP
- BD persistente — rate limiting sigue en memoria

## Capabilities

### New
- `mcp-server`: Servidor MCP con 9 tools que wrappean el pipeline fiscal existente

### Modified
- `rest-api`: HTTP transport mode para MCP (solo si `MCP_TRANSPORT=http`)
- `api-auth`: Scope check exportable para middleware HTTP del MCP

## Approach

1. Crear `fiscal_agent/mcp/tools/` — un archivo por tool, cada una wrappea lógica existente
2. `fiscal_agent/mcp/server.py` — FastMCP app que registra todas las tools
3. STDIO por defecto: `mcp.run(transport="stdio")` — sin auth, ideal para Claude Desktop
4. HTTP opcional: `mcp.run(transport="sse")` con middleware de API Key scopes (Fase 2)
5. Tools sensibles (run_pipeline) requieren scope `report:write` en HTTP mode; health siempre pública
6. `fiscal_agent/__main__.py` — entry point que parsea `MCP_TRANSPORT` y arranca el server

## Affected Areas

| Area | Impact | Description |
|------|--------|-------------|
| `fiscal_agent/mcp/server.py` | New | FastMCP app + tool registration |
| `fiscal_agent/mcp/tools/*.py` | New | 9 tool functions |
| `fiscal_agent/__main__.py` | New | Entry point `python -m fiscal_agent` |
| `fiscal_agent/api/auth.py` | Modified | Exportar `Scope` enum y helper `check_scope()` |
| `pyproject.toml` | Modified | Add `mcp>=1.27,<2` dependency |

## Risks

| Risk | Likelihood | Mitigation |
|------|------------|------------|
| MCP SDK breaking changes in v1.x | Low | Pin `mcp>=1.27,<2` |
| ComposioBrowser async vs sync mismatch | Medium | FastMCP soporta async nativo — usar `async def` |
| HTTP sin auth por env mal configurado | Medium | Validar `MCP_TRANSPORT` al startup; default seguro (stdio) |

## Rollback Plan

1. Remover `fiscal_agent/mcp/`, `fiscal_agent/__main__.py`
2. Revertir `pyproject.toml` (eliminar `mcp`)
3. Verificar CLI y REST API sin cambios

## Dependencies

- `mcp>=1.27,<2` — PyPI
- Lógica existente: `_procesar_cliente_pipeline`, `consultar_cuit`, `RulesEngine.calcular`, `ComposioBrowser.run_single`, `evaluar_rentas_cordoba`, `PdfGenerator.generar`, `EmailSender`

## Success Criteria

- [ ] `uv run mcp` inicia server STDIO listando 9 tools
- [ ] Cada tool retorna `UnifiedResponse` válido con datos reales
- [ ] `MCP_TRANSPORT=http` + API key válida → tools funcionan con scope check
- [ ] `MCP_TRANSPORT=http` + API key inválida → 401/403
- [ ] CLI y REST API siguen operativos sin cambios
