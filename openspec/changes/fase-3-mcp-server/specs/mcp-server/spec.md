# Spec: mcp-server

## Description

Servidor MCP (Model Context Protocol) que expone el pipeline fiscal de Fiscal-Agent como 9 tools invocables por LLMs. Usa FastMCP del SDK oficial `mcp>=1.27,<2`. Por defecto corre en modo STDIO (local, sin auth); opcionalmente soporta Streamable HTTP/SSE con auth vía API keys reusando Fase 2.

## Requirements

### REQ-001: FastMCP server con lifespan
- Server crea `FastMCP("fiscal-agent")` con lifespan que inicializa: RulesEngine, PdfGenerator, TA cache, y ComposioBrowser (solo si `COMPOSIO_API_KEY` está presente).
- Lifespan context expone servicios tipados accesibles desde cada tool.
- **Escenario**: server inicia con `COMPOSIO_API_KEY` → browser disponible en lifespan.
- **Escenario**: server inicia sin `COMPOSIO_API_KEY` → browser es `None`, tools de extracción retornan error claro.

### REQ-002: STDIO transport por defecto
- `mcp.run(transport="stdio")` es el modo default.
- Sin necesidad de configurar puertos, auth, o middleware.
- **Escenario**: `python -m fiscal_agent mcp` inicia server STDIO listando 9 tools.

### REQ-003: HTTP transport opcional con auth
- Si `MCP_TRANSPORT=http`, corre server via Starlette con SSE transport.
- Middleware valida `Authorization: Bearer <api_key>` contra store de Fase 2.
- Cada tool requiere un scope específico (ver tabla abajo). Health check es público.
- **Escenario**: `MCP_TRANSPORT=http python -m fiscal_agent mcp` inicia server HTTP.
- **Escenario**: request sin API key → 401.
- **Escenario**: API key sin scope suficiente → 403.

### REQ-004: Todas las tools retornan UnifiedResponse
- Cada tool retorna `UnifiedResponse.model_dump_json()`.
- Status `success` en éxito, `error` en fallo.
- Errores usan `ApiError(code, cause, remediation)`.
- **Escenario**: tool exitosa → `{"status":"success","result":{...}}`.
- **Escenario**: tool con error → `{"status":"error","error":{"code":"MCP_ERROR","cause":"..."}}`.

### REQ-005: Sin cambios en CLI ni REST API
- El CLI existente (`run`, `report`, etc.) y la REST API (Fase 1+2) siguen funcionando sin modificaciones.
- El subcomando `mcp` es aditivo.

### REQ-006: TA caching compartido
- `obtener_ta()` se llama una vez en lifespan y se cachea en memoria.
- Misma lógica de cache que `fiscal_agent/api/deps.py`.
- **Escenario**: múltiples tool calls reusan el mismo TA sin pedir uno nuevo.

### REQ-007: Browser lazy init
- ComposioBrowser se inicializa en lifespan solo si `COMPOSIO_API_KEY` está en env.
- Tools que usan browser retornan error claro si no está configurado:
  `ApiError(code="BROWSER_NOT_CONFIGURED", cause="COMPOSIO_API_KEY no configurada", remediation="Agregar COMPOSIO_API_KEY en .env")`

## Tool Specifications

### get_calendar
- **File**: `fiscal_agent/mcp/tools/calendar.py`
- **Scope (HTTP)**: `calendar:read`
- **Inputs**:
  | Parámetro | Tipo | Required | Default | Description |
  |-----------|------|----------|---------|-------------|
  | `cuit` | `str` | Sí | — | CUIT del contribuyente (11 dígitos) |
  | `mes` | `int` | No | mes actual | Mes (1-12) |
  | `anio` | `int` | No | año actual | Año (e.g. 2026) |
  | `provincias` | `list[str]` | No | `[]` | Provincias para Convenio Multilateral |
- **Wraps**: `consultar_cuit()` + `engine.calcular()`
- **Returns**: `UnifiedResponse` con `RulesOutput` (vencimientos + observaciones)
- **Errors**:
  - CUIT inválido → `ApiError(code="INVALID_CUIT")`
  - Error de WS ARCA → `ApiError(code="ARCA_ERROR")`
  - Sin vencimientos → `UnifiedResponse(status="success", result={...})` con lista vacía (no es error)

### get_taxpayer
- **File**: `fiscal_agent/mcp/tools/taxpayer.py`
- **Scope (HTTP)**: `taxpayer:read`
- **Inputs**:
  | Parámetro | Tipo | Required | Description |
  |-----------|------|----------|-------------|
  | `cuit` | `str` | Sí | CUIT del contribuyente |
- **Wraps**: `consultar_cuit()`
- **Returns**: `UnifiedResponse` con `PadronA5Output` (datos generales, domicilio, impuestos, actividades)
- **Errors**:
  - CUIT no encontrado → `ApiError(code="CUIT_NOT_FOUND")`
  - Error de constancia → `ApiError(code="CONSTANCIA_ERROR")`

### extract_deuda
- **File**: `fiscal_agent/mcp/tools/deuda.py`
- **Scope (HTTP)**: `taxpayer:read`
- **Inputs**:
  | Parámetro | Tipo | Required | Description |
  |-----------|------|----------|-------------|
  | `cuit` | `str` | Sí | CUIT del contribuyente |
- **Wraps**: `browser.run_single([FullTask(...)])`
- **Returns**: `UnifiedResponse` con `DeudaOutput` (vencimientos + deudas detalladas)
- **Errors**:
  - Browser no configurado → `ApiError(code="BROWSER_NOT_CONFIGURED")`
  - Timeout de extracción → `ApiError(code="BROWSER_TIMEOUT")`
  - Error de navegación → `ApiError(code="BROWSER_ERROR")`

### extract_facilidades
- **File**: `fiscal_agent/mcp/tools/facilidades.py`
- **Scope (HTTP)**: `taxpayer:read`
- **Inputs**:
  | Parámetro | Tipo | Required | Description |
  |-----------|------|----------|-------------|
  | `cuit` | `str` | Sí | CUIT del contribuyente |
- **Wraps**: `browser.run_single([FacilidadesTask(...)])`
- **Returns**: `UnifiedResponse` con `DeudaOutput.facilidades` (planes de pago)
- **Errors**: mismos que `extract_deuda`

### extract_registro
- **File**: `fiscal_agent/mcp/tools/registro.py`
- **Scope (HTTP)**: `taxpayer:read`
- **Inputs**:
  | Parámetro | Tipo | Required | Description |
  |-----------|------|----------|-------------|
  | `cuit` | `str` | Sí | CUIT del contribuyente |
- **Wraps**: `browser.run_single([RegistroTask(...)])`
- **Returns**: `UnifiedResponse` con `RegistroOutput` (domicilios, actividades, impuestos, puntos de venta)
- **Errors**: mismos que `extract_deuda`

### run_pipeline
- **File**: `fiscal_agent/mcp/tools/pipeline.py`
- **Scope (HTTP)**: `report:write`
- **Inputs**:
  | Parámetro | Tipo | Required | Default | Description |
  |-----------|------|----------|---------|-------------|
  | `cuit` | `str` | Sí | — | CUIT del contribuyente |
  | `mes` | `int` | No | mes actual | Mes (1-12) |
  | `anio` | `int` | No | año actual | Año |
  | `with_deuda` | `bool` | No | `false` | Extraer deuda vía browser |
  | `with_facilidades` | `bool` | No | `false` | Extraer planes de pago |
  | `with_registro` | `bool` | No | `false` | Extraer registro tributario |
  | `send_email` | `bool` | No | `false` | Enviar email al cliente |
- **Wraps**: `_procesar_cliente_pipeline()` de cli.py
- **Returns**: `UnifiedResponse` con dict del pipeline (calendario, PDF, email, errores)
- **Errors**:
  - Error en cualquier etapa del pipeline → error reportado en `result.error`
  - Browser no configurado pero se requiere → `ApiError(code="BROWSER_NOT_CONFIGURED")`

### get_report_pdf
- **File**: `fiscal_agent/mcp/tools/report.py`
- **Scope (HTTP)**: `report:read`
- **Inputs**:
  | Parámetro | Tipo | Required | Default | Description |
  |-----------|------|----------|---------|-------------|
  | `cuit` | `str` | Sí | — | CUIT del contribuyente |
  | `mes` | `int` | No | mes actual | Mes (1-12) |
  | `anio` | `int` | No | año actual | Año |
  | `con_deuda` | `bool` | No | `false` | Incluir deuda en PDF |
- **Wraps**: pipeline parcial + `pdf_gen.generar()`
- **Returns**: `UnifiedResponse` con `{"pdf_path": "storage/...pdf", "pages": N}`
- **Errors**: mismos que `get_calendar` + `BROWSER_NOT_CONFIGURED` si `con_deuda=true` sin browser

### health
- **File**: `fiscal_agent/mcp/tools/health.py`
- **Scope (HTTP)**: público (sin auth)
- **Inputs**: ninguno
- **Wraps**: verifica que el server está vivo y TA cache disponible
- **Returns**: `UnifiedResponse` con `{"status": "ok", "timestamp": "...", "ta_vigente": bool}`
- **Errors**: solo si el server no puede iniciar (no aplica en runtime)

### match_rentas_cordoba
- **File**: `fiscal_agent/mcp/tools/rentas.py`
- **Scope (HTTP)**: `calendar:read`
- **Inputs**:
  | Parámetro | Tipo | Required | Default | Description |
  |-----------|------|----------|---------|-------------|
  | `cuit` | `str` | Sí | — | CUIT del contribuyente |
  | `provincias` | `list[str]` | No | `[]` | Provincias donde opera |
- **Wraps**: `consultar_cuit()` + `evaluar_rentas_cordoba()`
- **Returns**: `UnifiedResponse` con `RentasCordobaMatching` (requiere_integracion, tiene_convenio_multilateral, etc.)
- **Errors**:
  - CUIT inválido → `ApiError(code="INVALID_CUIT")`
  - No se pudo determinar impuestos → resultado con `requiere_integracion=false` (no es error)

## Main Specs Merge

Este spec convive con los specs existentes. No modifica `rest-api`, `api-auth`, `tenant-identity`, ni ningún spec previo. Es una capability nueva y aditiva.

