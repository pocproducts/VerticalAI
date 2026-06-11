# Tasks: composio-browser-provider

Reemplazar `ArcaBrowser` (Playwright + YAML) por `ComposioBrowser` (Composio Browser Tool + instrucciones NL).

## Review Workload Forecast

| Field | Value |
|-------|-------|
| Estimated changed lines | ~800 (260 new + 520 deleted) |
| 400-line budget risk | High |
| Chained PRs recommended | Yes |
| Suggested split | PR 1: templates.py + composio.py (~260 new) → PR 2: init + cli + toml + cleanup (~540, mostly deletions) |
| Delivery strategy | ask-on-risk |
| Chain strategy | stacked-to-main |

Decision needed before apply: Yes
Chained PRs recommended: Yes
Chain strategy: stacked-to-main
400-line budget risk: High

### Suggested Work Units

| Unit | Goal | Likely PR | Notes |
|------|------|-----------|-------|
| Core provider | templates.py + composio.py | PR 1 | ~260 new lines, under 400. Independiente. Base = main |
| Integration + cleanup | init, cli, toml, delete old files | PR 2 | Deletions dominan. Base = main (merged PR 1) |

---

## Phase 1: Foundation — Templates NL (Task 1)

| Campo | Valor |
|-------|-------|
| ID | T1 |
| Nombre | Templates NL |
| Archivos | `fiscal_agent/browser/templates.py` (crear) |
| Criterio de aceptación | `from fiscal_agent.browser.templates import TEMPLATE_LOGIN, TEMPLATE_EXTRACT, TEMPLATE_FULL` funciona sin error. Placeholders `{cuit}`/`{clave}` interpolables con `.format()`. Strings en español argentino, paso a paso. |
| Dependencias | None |

- [ ] 1.1 Crear `fiscal_agent/browser/templates.py` con `TEMPLATE_LOGIN`: instrucciones NL para navegar `auth.afip.gob.ar`, ingresar CUIT + clave, esperar redirección a `impuestos`. Detectar ARCA-4 (credencial inválida → detener + log error) y ARCA-6 (2FA → detener + log error). Placeholders `{cuit}`, `{clave}`.
- [ ] 1.2 Agregar `TEMPLATE_EXTRACT`: instrucciones NL para navegar `misFacilidades`, esperar tabla de deuda, extraer JSON con `deuda_actual`, `saldos[{concepto, importe, vencimiento}]`, `plan_pagos`. Sin placeholders (usa sesión activa).
- [ ] 1.3 Agregar `TEMPLATE_FULL`: pipeline login → extract combinado (opcional, para un solo `CREATE_TASK` si el SDK no preserva cookies entre tasks).

## Phase 2: Core Implementation — ComposioBrowser (Task 2)

| Campo | Valor |
|-------|-------|
| ID | T2 |
| Nombre | ComposioBrowser class |
| Archivos | `fiscal_agent/browser/composio.py` (crear) |
| Criterio de aceptación | `ComposioBrowser(composio_api_key, estudio_cuit, estudio_clave, headed).run_all(clientes)` retorna `list[DeudaOutput]`. Sesiones paralelas por cliente. Errores ARCA-4/ARCA-6 detectados. STOP_TASK en `finally`. |
| Dependencias | T1 (importa templates) |

- [ ] 2.1 Implementar `__init__`: guardar `composio_api_key`, `estudio_cuit`, `estudio_clave`, `headed`. Inicializar `composio.Client` o similar según SDK.
- [ ] 2.2 Implementar `_run_single(cliente)` — pipeline por cliente: `CREATE_TASK(TEMPLATE_LOGIN)` → `WATCH_TASK` (timeout 120s) → detectar ARCA-4/ARCA-6 en `response.data` → si ok, `CREATE_TASK(TEMPLATE_EXTRACT)` → `WATCH_TASK` → `GET_OUTPUT_FILE` → parsear JSON → `DeudaOutput`. `STOP_TASK` en `finally` por sesión.
- [ ] 2.3 Implementar `run_all(clientes)`: `asyncio.gather(*map(_run_single, clientes))`, capturar excepciones individuales, retornar `list[DeudaOutput]` con `error=None` o `error=str` por cliente.
- [ ] 2.4 Implementar `close()`: cleanup del cliente Composio si aplica (sessions stop, etc.).
- [ ] 2.5 Implementar `_parse_arca_error(data: str) -> Optional[str]`: busca substrings ARCA-4 (credencial inválida) y ARCA-6 (2FA) en `response.data`. Si detecta → retorna código de error, no reintenta.
- [ ] 2.6 Manejar flag `headed`: si True, llamar `GET_SESSION` tras login y loguear URL de sesión Composio (`logger.info('Session URL: %s', url)`) en vez de abrir browser local.
- [ ] 2.7 Agregar logging estructurado por operación: `session_id`, `task_id`, `error_code` (NFR-C5).

## Phase 3: Integration / Wiring — CLI + Init (Task 3)

| Campo | Valor |
|-------|-------|
| ID | T3 |
| Nombre | Integración CLI |
| Archivos | `fiscal_agent/browser/__init__.py` (modificar), `fiscal_agent/cli.py` (modificar), `pyproject.toml` (modificar) |
| Criterio de aceptación | `from fiscal_agent.browser import ComposioBrowser` funciona. `fiscal-agent deuda --config clients.yaml` instancia `ComposioBrowser`. `pip freeze` no muestra playwright. |
| Dependencias | T2 (ComposioBrowser class) |

- [ ] 3.1 `fiscal_agent/browser/__init__.py`: reemplazar import de `ArcaBrowser` por `ComposioBrowser`. `__all__ = ['ComposioBrowser']`.
- [ ] 3.2 `fiscal_agent/cli.py` comando `deuda`: leer `COMPOSIO_API_KEY` de `os.environ`, instanciar `ComposioBrowser(composio_api_key=..., estudio_cuit=REPRESENTANTE_CUIT, estudio_clave=estudio_clave, headed=headed)`. Reemplazar bloque `from fiscal_agent.browser import ArcaBrowser` / `ArcaBrowser(...)`.
- [ ] 3.3 `pyproject.toml`: quitar `playwright>=1.50.0` de `dependencies`, agregar `composio`.

## Phase 4: Cleanup — Archivos Viejos (Task 4)

| Campo | Valor |
|-------|-------|
| ID | T4 |
| Nombre | Cleanup archivos viejos |
| Archivos | `fiscal_agent/browser/client.py` (eliminar), `fiscal_agent/browser/workflows/login.yaml` (eliminar), `switch.yaml` (eliminar), `extract.yaml` (eliminar) |
| Criterio de aceptación | `git diff --name-only` contra main no muestra estos archivos. `grep -r "ArcaBrowser" fiscal_agent/` retorna vacío. |
| Dependencias | T3 (CLI no debe importar ArcaBrowser) |

- [ ] 4.1 Eliminar `fiscal_agent/browser/client.py` (ArcaBrowser, 424 líneas).
- [ ] 4.2 Eliminar `fiscal_agent/browser/workflows/login.yaml`.
- [ ] 4.3 Eliminar `fiscal_agent/browser/workflows/switch.yaml`.
- [ ] 4.4 Eliminar `fiscal_agent/browser/workflows/extract.yaml`.

## Phase 5: Setup Manual — Usuario (Task 5)

| Campo | Valor |
|-------|-------|
| ID | T5 |
| Nombre | Setup manual — usuario |
| Archivos | `.env` (modificar) |
| Criterio de aceptación | Usuario tiene `COMPOSIO_API_KEY` en `.env`, paquete `composio` instalado, cuenta Composio activa con Browser Tool. |
| Dependencias | None (independiente, puede hacerse en paralelo) |

- [ ] 5.1 Instalar paquete Composio: `uv add composio` o `pip install composio`.
- [ ] 5.2 Crear cuenta en [composio.dev](https://composio.dev), habilitar **Browser Tool** desde el dashboard.
- [ ] 5.3 Generar API key desde Settings → API Keys en Composio.
- [ ] 5.4 Agregar `COMPOSIO_API_KEY=<key>` a `.env` (junto a `ESTUDIO_CUIT` y `ESTUDIO_CLAVE_FISCAL`).
- [ ] 5.5 Verificar: `python -c "from composio.client import Composio; c = Composio(api_key='...'); print(c)"` sin error.
