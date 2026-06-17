# Delta for browser-task

## Overview

Este delta modifica `openspec/specs/browser-task/spec.md` para:
1. Renombrar `FullTask` → `VencimientosDeudasTask` (REQ-3)
2. Rebase: `BrowserTask` ahora hereda de `BaseTask` en vez de ABC directo (REQ-1)
3. `TaskResult` se reusa entre jerarquías BrowserTask y ApiTask (REQ-2)

## ADDED Requirements

No se agregan nuevos requirements. El comportamiento existente (REQ-4: LoginTask, ExtractV2Task; REQ-5: FacilidadesTask) no cambia.

## MODIFIED Requirements

### REQ-1: BrowserTask Protocol

`BrowserTask(BaseTask)` SHALL ser una subclase concreta de `BaseTask` que define la interfaz para operaciones de navegación atómicas en Composio. BrowserTask hereda `name`, `timeout`, `parse_output()` y `execute()` de `BaseTask`.
(Previously: `BrowserTask` heredaba de ABC directamente)

MUST exponer (además de lo heredado de BaseTask):
- `template: str` — template NL con placeholders
- `template_params: dict` — parámetros para `template.format()`
- `secrets: Optional[dict]` — credenciales HTTP básicas
- `start_url: Optional[str]` — URL inicial de navegación
- `needs_auth: bool` — True si requiere login previo

#### Scenario: BrowserTask como BaseTask

- GIVEN un BrowserTask
- WHEN se construye
- THEN hereda `name` y `timeout` de BaseTask
- THEN implementa `parse_output()` y `execute()`
- THEN `isinstance(task, BaseTask)` es True

### REQ-2: TaskResult

`TaskResult` SHALL ser un dataclass que captura el resultado de UNA ejecución de cualquier `BaseTask` (BrowserTask o ApiTask).
(Previously: TaskResult solo se usaba para BrowserTask)

MUST contener:
- `task_name: str`
- `success: bool`
- `raw_output: str`
- `parsed_data: dict`
- `error: Optional[str]`
- `arca_error: Optional[str]` — solo relevante para BrowserTask
- `task_id: Optional[str]` — solo relevante para BrowserTask

#### Scenario: TaskResult desde ApiTask

- GIVEN una ejecución de ApiTask exitosa
- WHEN retorna TaskResult
- THEN `success` es True
- THEN `task_id` y `arca_error` son None
- THEN `parsed_data` contiene el resultado de la API

#### Scenario: TaskResult desde BrowserTask

- GIVEN un BrowserTask que completa OK
- WHEN `execute()` retorna
- THEN `success` es True
- THEN `task_id` no es None
- THEN `parsed_data` contiene el JSON extraído

### REQ-3: VencimientosDeudasTask — Rename from FullTask

`VencimientosDeudasTask(BrowserTask)` SHALL ser una subclase concreta que ejecuta `TEMPLATE_FULL` (login + switch + extract combinado). Es el DEFAULT para mantener compatibilidad hacia atrás. El alias `FullTask` SHALL mantenerse como backward-compatible import en `fiscal_agent/browser/__init__.py`.
(Previously: FullTask era el nombre original)

MUST:
- Usar `TEMPLATE_FULL` como template
- Parsear output con `_parse_extract_output()` existente
- Devolver `parsed_data` con estructura `{vencimientos: [], deudas: []}` idéntica
- `__init__.py` DEBE exportar `from ... import VencimientosDeudasTask as FullTask`

#### Scenario: VencimientosDeudasTask produce mismo output

- GIVEN output crudo de TEMPLATE_FULL
- WHEN `parse_output(raw)` se ejecuta
- THEN retorna dict con `vencimientos` y `deudas`
- THEN el formato es idéntico al `_parse_extract_output()` actual

#### Scenario: Backward compatible alias

- GIVEN `from fiscal_agent.browser import FullTask`
- WHEN se usa `FullTask(...)`
- THEN instancia `VencimientosDeudasTask`
- THEN comportamiento es idéntico

## REMOVED Requirements

(No se remueven requirements. El rename es aditivo con alias.)

## Affected Files

| Archivo | Cambio |
|---------|--------|
| `fiscal_agent/browser/task.py` | Rename `FullTask` → `VencimientosDeudasTask`; rebase `BrowserTask(ABC)` → `BrowserTask(BaseTask)` |
| `fiscal_agent/browser/__init__.py` | Exportar `VencimientosDeudasTask` + alias `FullTask` |
| `fiscal_agent/browser/composio.py` | Import rename |
| `fiscal_agent/cli.py` | Import rename |
| `fiscal_agent/api/routes/extract.py` | Mapping rename |
| `fiscal_agent/mcp/tools/deuda.py` | Import rename |
| `fiscal_agent/mcp/tools/report.py` | Import rename |

## Verification

| ID | Método |
|----|--------|
| REQ-1 | `isinstance(BrowserTask(), BaseTask)` |
| REQ-2 | `isinstance(api_result, TaskResult)` + campos compartidos |
| REQ-3 | `grep -r FullTask fiscal_agent/` = 0 (solo alias en `__init__.py`) |
