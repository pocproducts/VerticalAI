# Proposal: composio-browser-provider

## Intent

Reemplazar ArcaBrowser (Playwright directo + YAML workflows con selectores CSS) por Composio Browser Tool. Eliminar fragilidad de selectores, sesión compartida con heartbeat, y dependencia de Playwright local. Ganar: sesiones paralelas por cliente (sin switch representado secuencial), cloud browser sin infra local, instrucciones en lenguaje natural interpretadas por AI agent de Composio.

## Scope

### In Scope

- Eliminar `fiscal_agent/browser/client.py`, `__init__.py`, `workflows/login.yaml`, `switch.yaml`, `extract.yaml`
- Nuevo `fiscal_agent/browser/composio_provider.py` — provider con 5 tools Composio (CREATE_TASK, WATCH_TASK, GET_SESSION, STOP_TASK, GET_OUTPUT_FILE)
- Instrucciones en lenguaje natural detalladas (paso a paso) para login ARCA, switch representado, y extract deuda
- Cada cliente procesado en su propia sesión Composio (paralelismo real con `asyncio.gather`)
- Refactor `cli.py` comando `deuda` para instanciar `ComposioProvider` en vez de `ArcaBrowser`
- `pyproject.toml`: remover `playwright`, agregar `composio`
- Flag `--headed` adaptado: muestra URL de sesión Composio (GET_SESSION) en vez de browser local

### Out of Scope

- Modelos `DeudaOutput` / `DeudaItem` (no cambian)
- Pipeline calendario (validate, run, generate-template)
- Firma del comando `deuda` en CLI
- Tests (strict_tdd: false)
- Scheduler, monitoreo, o dashboard de sesiones Composio

## Capabilities

### New Capabilities

- `composio-browser-integration`: integración con Composio Browser Tool que reemplaza ArcaBrowser. Define sesiones, tools, e instrucciones NL para navegación ARCA.

### Modified Capabilities

- `arca-browser-sync`: reemplazada completamente por `composio-browser-integration`. Se archiva al completar el cambio.

## Approach

Provider pattern: `ComposioProvider(estudio_cuit, estudio_clave, api_key)` con método `async run_all(clientes)`. Internamente crea una sesión Composio por cliente (paralelo con `asyncio.gather`). Cada sesión ejecuta 3 tasks secuenciales vía `BROWSER_TOOL_CREATE_TASK`: login → switch → extract, usando instrucciones NL detalladas. `BROWSER_TOOL_WATCH_TASK` monitorea hasta completar (con timeout). `GET_SESSION` para debug opcional (`--headed`). `STOP_TASK` como timeout de seguridad en `finally`.

Las instrucciones NL se escriben en español argentino, paso a paso, incluyendo URLs exactas, campos a completar, y valores a verificar — para que el AI agent de Composio las ejecute sin ambigüedad.

## Affected Areas

| Area | Impact | Description |
|------|--------|-------------|
| `fiscal_agent/browser/client.py` | Removed | ArcaBrowser completo |
| `fiscal_agent/browser/__init__.py` | Modified | Re-exporta ComposioProvider |
| `fiscal_agent/browser/workflows/` | Removed | login.yaml, switch.yaml, extract.yaml |
| `fiscal_agent/browser/composio_provider.py` | New | Provider con 5 tools Composio |
| `fiscal_agent/cli.py` | Modified | Import + instancia ComposioProvider |
| `pyproject.toml` | Modified | -playwright +composio |

## Risks

| Risk | Likelihood | Mitigation |
|------|------------|------------|
| Composio API cambia o tiene outage | Med | STOP_TASK + retry 2×; log claro para diagnóstico |
| Instrucciones NL malinterpretadas por AI agent | Med | Iterar prompts hasta 3 intentos por sesión; WATCH_TASK detecta fracaso |
| Sesión Composio no liberada (costo) | Low | STOP_TASK siempre en finally block por sesión |
| Clave fiscal viaja a cloud Composio | Low | Solo datos de navegación; sin datos sensibles del cliente en instrucciones |

## Rollback Plan

Revertir `pyproject.toml` (volver playwright), restaurar `browser/client.py`, `__init__.py`, `workflows/` desde git, y revertir `cli.py` al import original. Sin migración de datos — los outputs usan el mismo `DeudaOutput`.

## Dependencies

- `composio` package (agregar a `pyproject.toml`)
- API key Composio en `.env` como `COMPOSIO_API_KEY`
- Cuenta Composio activa con Browser Tool habilitado

## Success Criteria

- [ ] `fiscal-agent deuda` procesa todos los clientes sin error
- [ ] Cada cliente corre en sesión Composio separada (paralelismo real)
- [ ] Instrucciones NL producen login ARCA + switch representado + extract deuda correctos
- [ ] `pip freeze` no muestra `playwright`
- [ ] Flag `--headed` muestra URL de sesión Composio en vez de lanzar browser local
