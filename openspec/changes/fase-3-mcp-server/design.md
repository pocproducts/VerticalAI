# Design: Fase 3 — MCP Server

## Technical Approach

Servidor MCP via FastMCP que expone 9 tools wrappeando lógica existente del pipeline fiscal. Cada tool es una función `async` pura que recibe parámetros planos (strings, ints) y retorna `UnifiedResponse`. El server comparte servicios (engine, pdf_gen, browser cache) vía lifespan context. STDIO por defecto sin auth; HTTP/SSE opcional envuelve el server en Starlette con middleware de API Key scopes reusado de Fase 2.

## Architecture Decisions

| Decision | Choice | Alternatives | Rationale |
|----------|--------|-------------|-----------|
| Tool granularity | 1 file per tool | Monolithic single file | Cada tool aísla imports y testing. Matching Fase 1 route-per-file pattern. |
| Service init | FastMCP lifespan context | Global singletons | FastMCP provee lifespan nativo. Tools reciben contexto tipado vía `ctx.request_context.lifespan_context`. |
| TA caching | `deps.get_ta()` reusado | Duplicar lógica | Misma cache de TA que API REST. Evita pedir TA por cada tool call. |
| HTTP auth | Starlette middleware wrapping | FastMCP native plugins | FastMCP v1.x no expone auth hooks. Wrapper reusa `resolve_api_key` de Fase 2 sin modificar el SDK. |
| Return format | `UnifiedResponse` siempre | Raw models | Consistente con API REST. Agentes MCP reciben el mismo envelope que LLMs vía REST. |
| Browser init | Lazy via lifespan (solo si COMPOSIO_API_KEY presente) | Forzar startup | Evita error si no hay browser configurado. Matching CLI pattern. |

## Directory Structure

```
fiscal_agent/mcp/
├── __init__.py
├── server.py            # FastMCP app + lifespan + tool registration
├── transport.py         # STDIO vs HTTP runner + auth middleware
└── tools/
    ├── __init__.py
    ├── calendar.py       # get_calendar
    ├── taxpayer.py       # get_taxpayer
    ├── deuda.py          # extract_deuda
    ├── facilidades.py    # extract_facilidades
    ├── registro.py       # extract_registro
    ├── pipeline.py       # run_pipeline
    ├── report.py         # get_report_pdf
    ├── health.py         # health
    └── rentas.py         # match_rentas_cordoba
```

## Server Architecture

```
FastMCP lifespan
  ├── init engine   = RulesEngine()
  ├── init pdf_gen  = PdfGenerator()
  ├── init ta_cache = deps.get_ta() cached
  └── init browser  = ComposioBrowser(...) if COMPOSIO_API_KEY
         │
         ▼
 lifespan_context = {engine, pdf_gen, browser, ta_cache}
         │
         ▼
  Tool registration (imports all 9 tools, calls @mcp.tool() decorator)
         │
         ▼
  transport.py dispatches:
    MCP_TRANSPORT=stdio → mcp.run(transport="stdio")
    MCP_TRANSPORT=http  → Starlette(middleware=auth) + mcp.run(transport="sse")
    default             → mcp.run(transport="stdio")
```

## Tool Design

Cada tool vive en su archivo, recibe parámetros planos desde el LLM, obtiene servicios del lifespan context, llama lógica existente, y wrappea resultado en `UnifiedResponse`.

| Tool | File | Wraps | Key Params | Scope (HTTP) |
|------|------|-------|-----------|--------------|
| `get_calendar` | `calendar.py` | `engine.calcular()` + `consultar_cuit()` | cuit, mes, anio, provincias[] | `calendar:read` |
| `get_taxpayer` | `taxpayer.py` | `consultar_cuit()` | cuit | `taxpayer:read` |
| `extract_deuda` | `deuda.py` | `browser.run_single(FullTask)` | cuit | `taxpayer:read` |
| `extract_facilidades` | `facilidades.py` | `browser.run_single(FacilidadesTask)` | cuit | `taxpayer:read` |
| `extract_registro` | `registro.py` | `browser.run_single(RegistroTask)` | cuit | `taxpayer:read` |
| `run_pipeline` | `pipeline.py` | `_procesar_cliente_pipeline()` | cuit, mes, anio, with_deuda, etc. | `report:write` |
| `get_report_pdf` | `report.py` | pipeline + `pdf_gen.generar()` | cuit, mes, anio | `report:read` |
| `health` | `health.py` | `deps.get_ta()` stub | none | public |
| `match_rentas_cordoba` | `rentas.py` | `evaluar_rentas_cordoba()` | cuit, provincias[] | `calendar:read` |

### get_calendar — code sketch (non-obvious pattern)

```python
@mcp.tool()
async def get_calendar(cuit: str, mes: int, anio: int,
                        provincias: list[str] | None = None,
                        ctx: Context) -> str:
    svc = ctx.request_context.lifespan_context
    token, sign = svc["ta_cache"]
    padron = consultar_cuit(cuit, token, sign, REPRESENTANTE_CUIT)
    output = padron.to_output()
    result = svc["engine"].calcular(output, mes, anio, provincias=provincias)
    return UnifiedResponse(status="success", result=result.model_dump()).model_dump_json()
```

### run_pipeline — wraps CLI pipeline

```python
@mcp.tool()
async def run_pipeline(cuit: str, mes: int, anio: int,
                        with_deuda: bool = False,
                        with_facilidades: bool = False,
                        with_registro: bool = False,
                        ctx: Context) -> str:
    svc = ctx.request_context.lifespan_context
    cliente = ClientConfig(cuit=cuit)
    token, sign = svc["ta_cache"]
    resultado = _procesar_cliente_pipeline(
        cliente=cliente, token=token, sign=sign,
        engine=svc["engine"], pdf_gen=svc["pdf_gen"],
        mes=mes, anio=anio, browser=svc.get("browser"),
        with_deuda=with_deuda, with_facilidades=with_facilidades,
        with_registro=with_registro, send_email=False,
    )
    return UnifiedResponse(status="success", result=resultado).model_dump_json()
```

## HTTP Transport

En `transport.py`: si `MCP_TRANSPORT=http`, se crea un Starlette app que envuelve `mcp.sse_app()` con middleware de auth:

```
Request ──► Bearer token? ──No──► 401
                  │ Yes
            resolve_api_key()
                  │
            ┌─────┴──────┐
            │ Key valid?  │──No──► 401
            └─────┬───────┘
                  │ Yes
            ┌─────┴──────────┐
            │ Scope match?    │──No──► 403 (por tool)
            └─────┬───────────┘
                  │ Yes ──► mcp.sse_app() handler
```

Los scopes se mapean por tool name (ver tabla "Scope (HTTP)" arriba). Health check salta auth.

## Entry Point

`fiscal_agent/__main__.py` se modifica para parsear `sys.argv`:

```
$ python -m fiscal_agent mcp          →  MCP_TRANSPORT=stdio (default)
$ MCP_TRANSPORT=http python -m fiscal_agent mcp  →  HTTP/SSE mode
```

El subcomando `mcp` llama `fiscal_agent.mcp.transport.run_mcp()`. El CLI existente (`run`, `report`, etc.) sigue funcionando sin cambios.

## Error Handling

Cada tool wrappea su cuerpo en `try/except Exception` y retorna:

```python
UnifiedResponse(
    status="error",
    error=ApiError(code="MCP_ERROR", cause=str(exc)),
).model_dump_json()
```

Las excepciones conocidas (ValueError del pipeline, KeyError del rules engine, requests.HTTPError de WS) se capturan con mensajes descriptivos. Timeouts de browser se traducen como `ApiError(code="BROWSER_TIMEOUT", ...)`.

## File Changes

| File | Action | Description |
|------|--------|-------------|
| `fiscal_agent/mcp/__init__.py` | Create | Package init, empty |
| `fiscal_agent/mcp/server.py` | Create | FastMCP app, lifespan, tool registry |
| `fiscal_agent/mcp/transport.py` | Create | STDIO/HTTP runner + auth middleware |
| `fiscal_agent/mcp/tools/*.py` | Create | 9 tool files |
| `fiscal_agent/__main__.py` | Modify | Add `mcp` subcommand dispatch |
| `pyproject.toml` | Modify | Add `mcp>=1.27,<2` |

## Dependencies

`mcp>=1.27,<2` en `pyproject.toml`. Sin dependencias adicionales — FastMCP trae Starlette (necesario para HTTP/SSE). En STDIO mode solo usa `asyncio` + `sys.stdin/stdout`.
