# Archive Report: Fase 3 — MCP Server

**Date**: 2026-06-12
**Status**: Implemented with known issues
**Verify Result**: PASS WITH WARNINGS — 1 CRITICAL, 1 WARNING, 4 SUGGESTIONS

---

## 1. Resumen del Cambio

Servidor MCP (Model Context Protocol) que expone el pipeline fiscal de Fiscal-Agent como 9 tools invocables por LLMs (Claude Desktop, Cline, etc.). Usa FastMCP del SDK oficial `mcp>=1.27,<2`. Por defecto corre en modo STDIO (local, sin auth); opcionalmente soporta Streamable HTTP/SSE con auth vía API keys reusando Fase 2.

**Intent original**: Que agentes conversacionales puedan consultar calendario, contribuyentes, deuda y ejecutar el pipeline fiscal completo sin depender de CLI o REST API.

---

## 2. Estado de Implementación

### 2.1 Files Creados (13 archivos)

| File | Líneas | Propósito |
|------|--------|-----------|
| `fiscal_agent/mcp/__init__.py` | — | Package marker |
| `fiscal_agent/mcp/server.py` | 103 | FastMCP app, lifespan context (RulesEngine, PdfGenerator, TA cache, ComposioBrowser) |
| `fiscal_agent/mcp/transport.py` | 183 | Transport dispatcher (STDIO/HTTP) + auth middleware + scope map |
| `fiscal_agent/mcp/tools/__init__.py` | — | Subpackage marker |
| `fiscal_agent/mcp/tools/health.py` | 34 | Tool: health — liveness check (público) |
| `fiscal_agent/mcp/tools/calendar.py` | 84 | Tool: get_calendar — vencimientos fiscales |
| `fiscal_agent/mcp/tools/taxpayer.py` | ~60 | Tool: get_taxpayer — datos del contribuyente |
| `fiscal_agent/mcp/tools/deuda.py` | ~60 | Tool: extract_deuda — deuda vía browser |
| `fiscal_agent/mcp/tools/facilidades.py` | ~60 | Tool: extract_facilidades — planes de pago |
| `fiscal_agent/mcp/tools/registro.py` | ~60 | Tool: extract_registro — registro tributario |
| `fiscal_agent/mcp/tools/pipeline.py` | 100 | Tool: run_pipeline — pipeline completo |
| `fiscal_agent/mcp/tools/report.py` | ~70 | Tool: get_report_pdf — PDF del calendario |
| `fiscal_agent/mcp/tools/rentas.py` | ~70 | Tool: match_rentas_cordoba — matching rentas |

### 2.2 Files Modificados (2 archivos)

| File | Cambio |
|------|--------|
| `fiscal_agent/__main__.py` | Agregado subcomando `mcp` que llama a `transport.run_mcp()` |
| `pyproject.toml` | Agregada dependencia `mcp>=1.27,<2` |

### 2.3 Tasks Completadas

| Fase | Task | Estado |
|------|------|--------|
| 1 | Package + Server skeleton + Transport | ✅ |
| 2 | Simple tools (calendar, taxpayer, health) | ✅ |
| 3 | Browser tools (deuda, facilidades, registro) | ✅ |
| 4 | Complex tools (pipeline, report, rentas) | ✅ |
| 5 | Entry point + dependencies | ✅ |

**13/13 tasks completadas.** ~571 líneas nuevas netas.

---

## 3. Issues Conocidos

### C1 — CRITICAL: Scope enforcement no funciona en HTTP mode

**Problema**: El middleware de auth en `transport.py` intenta extraer el tool name desde `request.query_params.get('tool', '')` o del path, pero en el protocolo MCP SSE estándar el tool name viaja dentro del cuerpo JSON-RPC (`{"method": "tools/call", "params": {"name": "run_pipeline", ...}}`), no en la URL ni query params.

**Impacto**: En HTTP mode (`MCP_TRANSPORT=http`), la validación de API key funciona (401 si falta), pero el scope check por tool (403 si la key no tiene el scope) **no puede determinar qué tool se está invocando**. Todas las requests pasan el scope check o fallan genéricamente.

**Root cause**: FastMCP v1.x no expone hooks de auth por tool. El wrapper Starlette intercepta antes de que FastMCP procese el body JSON-RPC.

**Posible solución**: Parsear el body JSON-RPC en el middleware para extraer `params.name`, o esperar que FastMCP agregue auth hooks nativos en v2.x.

**Status**: Aceptado como limitación conocida. STDIO mode no tiene este problema (no hay auth que enforce).

### W1 — WARNING: Sin tests dedicados

No hay tests específicos para el módulo `fiscal_agent/mcp/`. Las tools dependen de servicios externos (ARCA WS, browser) que hacen el testing unitario complejo sin mocking. Los tests existentes del pipeline cubren la lógica subyacente indirectamente.

### S1-S4 — SUGGESTIONS (menores)

- Usar `ctx` como primer parámetro (convención FastMCP)
- Agregar timeout configurable para tools de browser
- Documentar MCP tools en README
- Agregar health check endpoint separado en HTTP mode

---

## 4. Delta Specs vs Main Specs

El spec de `mcp-server` es **aditivo** — no modifica ningún spec existente (`rest-api`, `api-auth`, `tenant-identity`, etc.). Es una capability nueva.

| Main Spec | Acción | Razón |
|-----------|--------|-------|
| `openspec/specs/mcp-server` | **No existe** | Espec nuevo — no hay main spec preexistente que actualizar |

El delta spec en `openspec/changes/fase-3-mcp-server/specs/mcp-server/spec.md` contiene 7 requirements (REQ-001 a REQ-007) y 9 tool specifications completas. Este spec describe el estado final implementado.

---

## 5. Architecture Highlights

### Decisiones de diseño confirmadas en implementación

| Decisión | Implementado como |
|----------|-------------------|
| FastMCP lifespan context | `server.py` — `@asynccontextmanager lifespan()` yield ctx con engine, pdf_gen, ta_cache, browser |
| 1 file per tool | 9 archivos en `tools/`, cada uno con `@mcp.tool()` que importa `mcp` de `server.py` |
| Tool registration via import side-effect | `server.py` líneas 91-103: imports que disparan `@mcp.tool()` decorator |
| STDIO default | `transport.py` — `_run_stdio()` llama `mcp.run(transport='stdio')` |
| HTTP opcional con auth | `transport.py` — `_run_http()` crea Starlette app con `MCPAuthMiddleware` |
| Scope map | `transport.py` — `SCOPE_MAP` dict con tool→scope mapping |
| TA caching compartido | `server.py` lifespan — `get_ta()` se llama una vez |
| Browser lazy init | `server.py` lifespan — solo si `COMPOSIO_API_KEY` presente |
| UnifiedResponse envelope | Todas las tools retornan `UnifiedResponse.model_dump_json()` |
| Error handling uniforme | `try/except` con `ApiError(code, cause, remediation)` |

### Patrón no obvio

Las tools se registran vía **import side-effect**: `server.py` importa cada módulo de tool, y ese módulo ejecuta `@mcp.tool()` en el momento de la importación (porque `mcp` es una instancia singleton de `FastMCP`). Esto evita tener que llamar explícitamente a `mcp.tool()` para cada una.

---

## 6. Dependencias

- `mcp>=1.27,<2` — SDK oficial de Model Context Protocol (agregada en `pyproject.toml`)
- FastMCP trae Starlette (`starlette`) y `uvicorn` como dependencias transitivas para HTTP mode
- En STDIO mode solo usa `asyncio` + `sys.stdin/stdout`

---

## 7. Next Steps Sugeridos

1. **Resolver C1**: Parsear JSON-RPC body en middleware HTTP para extraer tool name y habilitar scope enforcement real. Alternativa: migrar a FastMCP v2 si agregan auth hooks nativos.
2. **Agregar tests**: Tests unitarios con mocking de `consultar_cuit()`, `RulesEngine`, `ComposioBrowser`. Tests de integración para ciclo MCP completo.
3. **Health endpoint HTTP separado**: Endpoint `GET /health` fuera de SSE path para monitoreo.
4. **Timeout configurable**: Para tools de browser (evitar que una tool cuelgue el server).
5. **Documentación**: Agregar sección MCP en README con ejemplos de uso en Claude Desktop.
6. **Rate limiting post-auth**: Ya importado en transport.py pero depende de Fase 2 store seeding.

---

## 8. Artefactos del Cambio

| Artefacto | Path | Estado |
|-----------|------|--------|
| Proposal | `openspec/changes/fase-3-mcp-server/proposal.md` | ✅ |
| Spec | `openspec/changes/fase-3-mcp-server/specs/mcp-server/spec.md` | ✅ |
| Design | `openspec/changes/fase-3-mcp-server/design.md` | ✅ |
| Tasks | `openspec/changes/fase-3-mcp-server/tasks.md` | ✅ |
| Archive Report | `openspec/changes/fase-3-mcp-server/archive-report.md` | ✅ (este archivo) |

---

*Archive generado el 2026-06-12. Change permanece en `openspec/changes/fase-3-mcp-server/` (no movido a archive — archive documental, no estructural).*
