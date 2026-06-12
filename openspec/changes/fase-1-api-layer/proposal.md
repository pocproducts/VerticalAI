# Proposal: Fase 1 — API Layer (FastAPI HTTP Server)

## Intent

Exponer el pipeline fiscal CLI como endpoints REST via FastAPI. Cada endpoint envuelve su respuesta en `UnifiedResponse[T]` (Fase 0). La lógica de negocio del CLI se REUTILIZA — RulesEngine, ComposioBrowser, PdfGenerator, EmailSender — sin duplicación.

## Scope

### In Scope
- Servidor FastAPI con 5 endpoints:
  - `POST /v1/calendar` — calendario fiscal (RulesEngine + Padrón A5)
  - `POST /v1/report` — pipeline completo (calendario + deuda opcional + PDF + email opcional)
  - `GET /v1/taxpayer/{cuit}` — perfil contribuyente desde Padrón A5
  - `POST /v1/extract` — extraer datos via Composio Browser
  - `GET /v1/health` — health check
- Todas las respuestas envueltas en `UnifiedResponse[T]`
- POST endpoints aceptan `IdempotentRequest` como base
- `POST /v1/calendar` y `POST /v1/report` marcan `human_approval_required` en condiciones de riesgo
- WSAA TA cacheado al startup con refresco automático si expira

### Out of Scope
- Autenticación real (API key validation con tenant models) — Fase 2
- Rate limiting funcional
- MCP Server — Fase 3
- Tests (se agregan después)
- Reemplazar el CLI — ambos coexisten
- Base de datos persistente

## Capabilities

### New Capabilities
- `rest-api`: Servidor FastAPI con endpoints REST del pipeline fiscal

### Modified Capabilities
- `unified-output-schema`: Se actualiza el spec para requerir que los endpoints HTTP usen `UnifiedResponse` como contrato de respuesta

## Approach

1. Crear `fiscal_agent/api/` package:
   - `server.py` — FastAPI app, lifespan (carga certificados → TA → engine), startup
   - `routes/calendar.py` — POST /v1/calendar
   - `routes/report.py` — POST /v1/report, GET /v1/taxpayer/{cuit}
   - `routes/extract.py` — POST /v1/extract
   - `routes/health.py` — GET /v1/health
   - `deps.py` — dependency injection (RulesEngine, PdfGenerator, ComposioBrowser)
2. Servidor corre con `uvicorn fiscal_agent.api.server:app`
3. Cada ruta llama a la misma lógica del CLI — RulesEngine.calcular(), consultar_cuit(), ComposioBrowser.run_single(), PdfGenerator.generar(), EmailSender.enviar()
4. Respuestas se envuelven en `UnifiedResponse[T]` con status/result/next_actions/human_approval_required/error

## Affected Areas

| Area | Impact | Description |
|------|--------|-------------|
| `fiscal_agent/api/` | New | Package con server, routes, deps |
| `fiscal_agent/__init__.py` | Modified | Exportar módulos del API package |
| `pyproject.toml` | Modified | Agregar `fastapi>=0.115.0`, `uvicorn[standard]>=0.34.0` |

## Risks

| Risk | Likelihood | Mitigation |
|------|------------|------------|
| WSAA TA stateful — expira y requiere certificado | High | Cache al startup + refresh automático en runtime |
| Composio Browser async, pipeline sync | Medium | `asyncio.to_thread` o `run_single()` existente. Async nativo se difiere |
| CLI sigue en uso, no debe romperse | Low | Lógica compartida no duplicada; CLI importa mismo código |

## Rollback Plan

1. Detener proceso uvicorn
2. Eliminar `fiscal_agent/api/` directory
3. Revertir `fiscal_agent/__init__.py` a versión anterior
4. Remover `fastapi` y `uvicorn` de `pyproject.toml`
5. Ejecutar `uv lock` para sync
6. Verificar CLI: `python -m fiscal_agent report`

## Dependencies

- `fastapi>=0.115.0`
- `uvicorn[standard]>=0.34.0`

## Success Criteria

- [ ] `uvicorn fiscal_agent.api.server:app` levanta sin errores
- [ ] `POST /v1/calendar?cuit=30716395541&periodo=2026-06` devuelve calendario en `UnifiedResponse`
- [ ] `GET /v1/taxpayer/30716395541` devuelve perfil del padrón A5
- [ ] `GET /v1/health` retorna `{"status": "success", "result": {"status": "ok"}}`
- [ ] Todas las respuestas HTTP usan `UnifiedResponse` como envelope
- [ ] `python -m fiscal_agent report` funciona sin cambios
