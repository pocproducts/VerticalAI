# Design: Composio Browser Provider

## Technical Approach

Reemplazar `ArcaBrowser` (Playwright local + YAML workflows + sesión compartida con heartbeat) por `ComposioBrowser` que usa Composio Browser Tool con instrucciones en lenguaje natural. Cada cliente corre en su propia sesión Composio (paralelismo real vía `asyncio.gather`), eliminando la fragilidad de selectores CSS y la dependencia de Playwright.

El diseño sigue el mismo contrato externo (`run_all(clientes) → list[DeudaOutput]`) para que `cli.py` requiera cambios mínimos.

## Architecture Decisions

| Decisión | Opciones | Tradeoff | Resolución |
|----------|----------|----------|------------|
| Provider vs. composio_provider.py separado | Provider único `ComposioBrowser` vs. clase + módulo tools separado | Proposal original sugiere `composio_provider.py` con 5 tools separados, pero ArcaBrowser tiene 1 clase con interfaz `run_all()`. Menos archivos nuevos = menos fricción de review. | **1 clase `ComposioBrowser` en `composio.py`** con métodos privados `_create_task`, `_watch_task`, `_stop_task`. Tools no se exponen públicamente — son detalle interno. |
| Templates separados vs. inline | `templates.py` módulo propio vs. strings en `composio.py` | Templates largos (instrucciones NL paso a paso en español) — mezclarlos en composio.py añade ~60 líneas de strings que opacan la lógica. | **Módulo `templates.py` separado** con `TEMPLATE_LOGIN`, `TEMPLATE_EXTRACT`, `TEMPLATE_FULL`. F-strings con placeholders `{cuit}`, `{clave}`. |
| Sesión por cliente vs. multiplexada | Sesión Composio por cliente (N sesiones) vs. 1 sesión + login/switch secuencial | ArcaBrowser usaba 1 sesión compartida + switch entre clientes + heartbeat. Composio permite N sesiones paralelas — gana velocidad pero consume más recursos cloud. | **Sesión por cliente con `asyncio.gather`**. STOP_TASK en `finally` por sesión. El costo cloud extra es aceptable vs. ganancia de paralelismo real. |
| Detección de errores ARCA | Parse de response vs. excepciones | Composio devuelve el resultado como JSON en `response.data`. No hay excepciones Python — hay que parsear el texto de salida del AI agent. | **Detección por substring en `response.data`**. `_parse_arca_error(data)` busca patrones ARCA-4 (credencial inválida) y ARCA-6 (2FA). No retry en estos casos. |
| Timeout | `asyncio.wait_for` vs. WATCH_TASK timeout param | WATCH_TASK acepta timeout nativo. Combinar con `asyncio.wait_for` por seguridad extra. | **WATCH_TASK timeout = 120s** (NFR-C2) + `asyncio.wait_for` wrapper que ejecuta STOP_TASK al expirar. |

## Data Flow

```
cli.py: deuda command
  │
  ├── ComposioBrowser.__init__(api_key, cuit, clave, headed)
  │
  └── ComposioBrowser.run_all(clientes)
        │
        ├── asyncio.gather( *[ _run_single(c) for c in clientes ] )
        │     │
        │     └── _run_single(cliente)
        │           │
        │           ├── BROWSER_TOOL_CREATE_TASK
        │           │     instruction=TEMPLATE_LOGIN
        │           │     startUrl="https://auth.afip.gob.ar/..."
        │           │     secrets={"https://auth.afip.gob.ar": "CUIT:CLAVE"}
        │           │     └──→ task_login
        │           │
        │           ├── BROWSER_TOOL_WATCH_TASK(task_login.taskId, timeout=120s)
        │           │     └──→ sessionId (de task_login.sessionId)
        │           │     └──→ si error ARCA-4/ARCA-6 → skip, log, return error
        │           │
        │           ├── BROWSER_TOOL_CREATE_TASK
        │           │     instruction=TEMPLATE_EXTRACT
        │           │     sessionId=sessionId  ← misma sesión, login preservado
        │           │     └──→ task_extract
        │           │
        │           ├── BROWSER_TOOL_WATCH_TASK(task_extract.taskId, timeout=120s)
        │           │     └──→ JSON con deuda_actual, saldos, plan_pagos
        │           │
        │           ├── parse response.data → DeudaOutput
        │           │
        │           └── finally: BROWSER_TOOL_STOP_TASK(task_login.taskId)
        │                     (o usar composio_client.sessions.stop(sessionId))
        │
        └── → list[DeudaOutput] con error=None o error=str
```

## File Changes

| File | Acción | Descripción |
|------|--------|-------------|
| `fiscal_agent/browser/composio.py` | Crear | Clase `ComposioBrowser` con 5 tools Composio, manejo de errores ARCA, timeout |
| `fiscal_agent/browser/templates.py` | Crear | `TEMPLATE_LOGIN`, `TEMPLATE_EXTRACT`, `TEMPLATE_FULL` como f-strings NL |
| `fiscal_agent/browser/__init__.py` | Modificar | Exportar `ComposioBrowser` en vez de `ArcaBrowser` |
| `fiscal_agent/cli.py` | Modificar | Import `ComposioBrowser`, instanciar con `COMPOSIO_API_KEY` de `.env` |
| `pyproject.toml` | Modificar | `-playwright`, `+composio` |
| `fiscal_agent/browser/client.py` | Eliminar | `ArcaBrowser` completo (424 líneas) |
| `fiscal_agent/browser/workflows/login.yaml` | Eliminar | YAML workflow obsoleto |
| `fiscal_agent/browser/workflows/switch.yaml` | Eliminar | YAML workflow obsoleto |
| `fiscal_agent/browser/workflows/extract.yaml` | Eliminar | YAML workflow obsoleto |

## Interfaces / Contracts

```python
# composio.py — interfaz pública
class ComposioBrowser:
    def __init__(
        self,
        composio_api_key: str,
        estudio_cuit: str,
        estudio_clave: str,
        headed: bool = False,
    ) -> None: ...

    async def run_all(self, clientes: list[ClientConfig]) -> list[DeudaOutput]: ...
    async def close(self) -> None: ...

# templates.py
TEMPLATE_LOGIN: str       # f-string con {cuit} {clave}
TEMPLATE_EXTRACT: str     # sin placeholders (usa sesión activa)
TEMPLATE_FULL: str        # pipeline login + extract

# __init__.py
__all__ = ['ComposioBrowser']
```

**Contrato `run_all`**: misma firma que `ArcaBrowser.run_all`. Recibe `list[ClientConfig]` (con `.cuit`, `.nombre`, `.clave_fiscal`), retorna `list[DeudaOutput]`. Cada `DeudaOutput` con `cuit`, `extraido_el`, `deuda_actual`, `saldos`, `plan_pagos`, `error`.

## Testing Strategy

| Capa | Qué testear | Enfoque |
|------|-------------|---------|
| Parseo | `_parse_arca_error()` con textos conocidos | Test unitario con strings que contienen ARCA-4/ARCA-6 |
| Templates | Interpolación de placeholders | Test unitario: formatear con CUIT/CLAVE dummy, verificar que no queden `{` sin reemplazar |
| Contrato CLI | `cli.py` comando `deuda` con `--config` | Test de integración mockeando `ComposioBrowser` (typer.test_runner) |

## Migration / Rollout

No migration requerida. Los outputs (`DeudaOutput`) no cambian. Rollback: restaurar `pyproject.toml`, `client.py`, `__init__.py`, `workflows/` desde git, revertir `cli.py`.

## Open Questions

- [ ] `composio` SDK: ¿el `create_task` con `sessionId` preserva cookies/login entre tasks? Verificar con SDK real. Si no, usar `TEMPLATE_FULL` (1 task = login + extract combinado).
- [ ] `composio` SDK: ¿`stop_task(taskId)` o `sessions.stop(sessionId)` para cleanup? Depende de la versión del SDK.
- [ ] Manejo de secrets: `secrets` dict en `create_task` — confirmar formato exacto que espera Composio Browser Tool.
