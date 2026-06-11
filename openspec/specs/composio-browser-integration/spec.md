# composio-browser-integration Specification

> Replaces `arca-browser-sync` (Playwright + YAML + heartbeat). Source of truth for browser-based ARCA extraction via Composio Browser Tool with natural language instructions.

## Purpose

`ComposioBrowser` manages ARCA extraction using Composio Browser Tool. Each client runs in its own cloud session with natural language instructions (NL templates), enabling real parallelism without local Playwright or fragile CSS selectors.

## Requirements

### REQ-1: ComposioBrowser — Sesión por Cliente

`ComposioBrowser` MUST crear una sesión Composio independiente por cada cliente. Cada sesión ejecuta login → extract secuencial. Las sesiones entre clientes MAY ejecutarse en paralelo (`asyncio.gather`). `COMPOSIO_API_KEY` MUST leerse de `.env`.

#### Scenario: Sesiones paralelas

- GIVEN 3 clientes configurados
- WHEN `run_all(clientes)` ejecuta
- THEN cada cliente tiene sesión propia
- THEN las sesiones corren concurrentemente

### REQ-2: Tools Composio Integrados

`ComposioBrowser` MUST integrar estos 5 tools de Composio:

| Tool | Propósito |
|------|-----------|
| `BROWSER_TOOL_CREATE_TASK` | Crear tarea de navegación con instrucciones NL |
| `BROWSER_TOOL_WATCH_TASK` | Esperar completitud con timeout configurable |
| `BROWSER_TOOL_GET_SESSION` | Obtener URL de sesión (modo `--headed`) |
| `BROWSER_TOOL_STOP_TASK` | Detener tarea en timeout/error/`finally` |
| `BROWSER_TOOL_GET_OUTPUT_FILE` | Recuperar resultado JSON de extracción |

#### Scenario: Pipeline completo con tools

- GIVEN un cliente con credenciales válidas
- WHEN `run_all()` procesa el cliente
- THEN CREATE_TASK (login) → WATCH_TASK → CREATE_TASK (extract) → WATCH_TASK → GET_OUTPUT_FILE retorna JSON

#### Scenario: Timeout seguro

- GIVEN tarea que excede timeout
- WHEN WATCH_TASK detecta timeout
- THEN STOP_TASK cancela la tarea
- THEN error se registra y pipeline continúa

### REQ-3: Templates de Instrucciones NL

Los templates SHALL estar en `templates.py` como strings Python en español argentino, paso a paso, con URLs exactas y detección de errores ARCA.

**Template A — Login Estudio**: Navegar auth.afip.gob.ar, ingresar CUIT, clave, esperar redirección a 'impuestos'. Detectar ARCA-4 (credenciales inválidas → detener + error) y ARCA-6 (2FA → detener + error).

**Template B — Mis Facilidades**: Navegar misFacilidades, esperar tabla de deuda, extraer JSON con `deuda_actual`, `saldos[{concepto, importe, vencimiento}]`, `plan_pagos`.

**Template C — Pipeline**: Ejecuta A luego B, captura resultado combinado.

#### Scenario: Login exitoso

- GIVEN CUIT + clave fiscal válidos
- WHEN AI agent ejecuta Template A
- THEN URL contiene 'impuestos'
- THEN login marcado como exitoso

#### Scenario: ARCA-4 (credenciales inválidas)

- GIVEN credenciales incorrectas
- WHEN AI agent ejecuta Template A
- THEN detecta mensaje de error
- THEN tarea se detiene con error ARCA-4

#### Scenario: ARCA-6 (2FA)

- GIVEN estudio con 2FA habilitado
- WHEN aparece desafío de doble factor
- THEN tarea se detiene con error ARCA-6

#### Scenario: Extracción de deuda

- GIVEN sesión con representado activo y autenticado
- WHEN AI agent ejecuta Template B
- THEN retorna JSON con `deuda_actual` y `saldos`

### REQ-4: Reemplazo en CLI

`cli.py` comando `deuda` MUST instanciar `ComposioBrowser` en vez de `ArcaBrowser`. La firma del comando (`--config`, `--headed`) y el tipo de output (`DeudaOutput`) SHALL ser idénticos.

#### Scenario: Comando deuda funciona

- GIVEN `COMPOSIO_API_KEY` en `.env` + `ESTUDIO_CLAVE_FISCAL` configurada
- WHEN `fiscal-agent deuda --config clients.yaml` ejecuta
- THEN instancia `ComposioBrowser(estudio_cuit, estudio_clave, api_key, headed)`
- THEN procesa todos los clientes
- THEN output es `list[DeudaOutput]` compatible con downstream

#### Scenario: Flag --headed funcional

- GIVEN `--headed` activo
- WHEN sesión Composio se crea
- THEN GET_SESSION imprime URL de sesión Composio en vez de abrir browser local

### REQ-5: Continue on Client Failure

Una falla individual MUST NOT detener el resto. `ComposioBrowser.run_all()` MUST capturar la excepción, registrar error en resultado, y continuar con el siguiente cliente. STOP_TASK MUST ejecutarse en `finally` por sesión.

#### Scenario: Falla parcial

- GIVEN 3 clientes
- WHEN cliente 2 falla en login
- THEN resultado[2] contiene error
- THEN clientes 1 y 3 procesados normalmente
- THEN resultado tiene 3 entradas

#### Scenario: Cleanup siempre

- GIVEN cualquier escenario (éxito, error parcial, error total)
- WHEN `run_all()` termina
- THEN STOP_TASK se ejecutó por cada sesión activa
- THEN sin sesiones Composio colgadas

### REQ-6: Multi-Task Orchestration

`ComposioBrowser` MUST soportar ejecución secuencial de múltiples `BrowserTask` por sesión Composio, reusando el `session_id` entre tasks.

MUST:
- Aceptar `tasks: list[BrowserTask]` opcional en `_run_single()`
- Default `tasks=None` → usar `[FullTask()]` (compatibilidad)
- Compartir `session_id` entre tasks secuenciales
- Si `needs_auth=True` en la primera task → crea sesión nueva (login)
- Si `needs_auth=False` → reusa session_id existente
- Detener pipeline del cliente si una task falla (no ejecutar tasks siguientes)
- STOP_TASK al finalizar TODAS las tasks (no por task individual)
- Timeout individual configurable por task
- Recolectar `list[TaskResult]` y consolidar en `DeudaOutput`

#### Scenario: Multi-task secuencial

- GIVEN un cliente con 2 BrowserTasks (login + extract)
- WHEN `_run_single(cliente, tasks=[login, extract])` ejecuta
- THEN login crea sesión y retorna session_id
- THEN extract reusa session_id
- THEN STOP_TASK se ejecuta UNA vez al final
- THEN `DeudaOutput` contiene datos del extract

#### Scenario: Backward compatible (tasks=None)

- GIVEN `_run_single(cliente)` sin tasks explícito
- WHEN ejecuta
- THEN usa `[FullTask()]` internamente
- THEN `DeudaOutput` es idéntico al anterior
- THEN `run_single()` funciona sin cambios desde cli.py

#### Scenario: Falla en task intermedia

- GIVEN 3 BrowserTasks (login, extract_A, extract_B)
- WHEN extract_A falla con error
- THEN extract_B NO se ejecuta
- THEN STOP_TASK mata las tasks activas
- THEN resultado contiene error de extract_A

### REQ-7: Console Tracking en _watch_task()

`_watch_task()` MUST loguear en tiempo real cada cambio de `current_step` del AI agent de Composio durante la ejecución de una tarea.

MUST:
- Almacenar el último `current_step` conocido y comparar con cada respuesta del polling loop
- Cuando `current_step` cambia, loguear via `console.print()` y/o `logger.info()`
- Incluir en el log: `task_id`, número de step, y descripción del paso
- NO interferir con el polling loop ni la lógica de timeout
- NO cambiar la firma de `_watch_task()`

#### Scenario: Step progression logged

- GIVEN una tarea Composio en ejecución con múltiples pasos
- WHEN el AI agent avanza de un step a otro
- THEN se loggea el nuevo step con task_id, step number, y descripción
- THEN el polling loop continúa sin interrupción

#### Scenario: Step sin cambios (no duplica logs)

- GIVEN una tarea donde `current_step` permanece igual entre polls
- WHEN `_watch_task()` recibe respuesta sin cambio de step
- THEN no se produce log del mismo step repetido
- THEN el comportamiento del polling loop es idéntico al actual

## Non-Functional Requirements

| ID | Requisito | Target |
|----|-----------|--------|
| NFR-C1 | Tiempo por tarea Composio | SHOULD completar <120s por tarea |
| NFR-C2 | Timeout configurable | SHOULD tener timeout por tarea (default 300s) |
| NFR-C3 | Sin dependencia Playwright | MUST no requerir `playwright` en `pyproject.toml` ni runtime |
| NFR-C4 | Retry en fallo de API | MAY reintentar CREATE_TASK 1× ante error de red/API |
| NFR-C5 | Logging estructurado | MUST loggear session_id + task_id + error_code por operación |

## Data Contracts

| Stage | Input | Output |
|-------|-------|--------|
| `_run_single` — login | `{cuit, clave}` vía TEMPLATE_LOGIN | Sesión Composio autenticada (sessionId) |
| `_run_single` — extract | sessionId activa vía TEMPLATE_EXTRACT | JSON con `deuda_actual`, `saldos[]`, `plan_pagos` |
| `run_all` | `list[ClientConfig]` | `list[DeudaOutput]` con `cuit`, `extraido_el`, `deuda_actual`, `saldos`, `plan_pagos`, `error` |

## File Manifest

| Archivo | Rol |
|---------|-----|
| `fiscal_agent/browser/composio.py` | `ComposioBrowser` class con 5 tools Composio |
| `fiscal_agent/browser/templates.py` | Templates NL: `TEMPLATE_LOGIN`, `TEMPLATE_EXTRACT`, `TEMPLATE_FULL` |
| `fiscal_agent/browser/__init__.py` | Exporta `ComposioBrowser` |
| `fiscal_agent/cli.py` | Comando `deuda` con `ComposioBrowser` |
| `pyproject.toml` | Dependencia `composio`, sin `playwright` |
