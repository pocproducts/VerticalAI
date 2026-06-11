# Delta Spec: composio-browser-integration

Reemplaza `arca-browser-sync` (Playwright + YAML + heartbeat) por Composio Browser Tool con instrucciones NL para AI agent. Todo el spec `arca-browser-sync` (REQ-1..REQ-8, NFR-1..NFR-5) queda obsoleto.

## ADDED Requirements

### REQ-1: ComposioBrowser — Sesión por Cliente

`ComposioBrowser` MUST crear una sesión Composio independiente por cada cliente. Cada sesión ejecuta login → switch → extract secuencial. Las sesiones entre clientes MAY ejecutarse en paralelo (`asyncio.gather`). `COMPOSIO_API_KEY` MUST leerse de `.env`.

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
- THEN CREATE_TASK (login) → WATCH_TASK → CREATE_TASK (switch) → WATCH_TASK → CREATE_TASK (extract) → WATCH_TASK → GET_OUTPUT_FILE retorna JSON

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

## REMOVED Requirements

| ID | Razón |
|----|-------|
| REQ-1 (Browser Ownership) | Reemplazado: sesión Composio por cliente, no shared Browser |
| REQ-2 (Workflow Receives Browser) | Eliminado: no hay YAML workflows ni Browser object |
| REQ-3 (Workflow-First Execution) | Eliminado: AI agent de Composio ejecuta NL, no YAML |
| REQ-4 (Session Heartbeat) | Eliminado: Composio maneja lifecycle de sesión cloud |
| REQ-5 (ARCA Error Handling) | Reemplazado por REQ-3 (detección en templates NL) |
| REQ-6 (Always Clean Up) | Reemplazado por REQ-5 (STOP_TASK en finally) |
| REQ-7 (login_estudio Last Step) | Eliminado: no hay schema de workflow YAML |
| REQ-8 (Continue on Client Failure) | Reemplazado por REQ-5 (idéntico comportamiento) |
| NFR-1 a NFR-5 | Eliminados: métricas Playwright/YAML no aplican |

## Archivos Afectados

| REQ | Archivo | Acción |
|-----|---------|--------|
| REQ-1, REQ-2 | `fiscal_agent/browser/composio.py` | **Crear** — class `ComposioBrowser` con 5 tools Composio |
| REQ-3 | `fiscal_agent/browser/templates.py` | **Crear** — Templates A, B, C como strings Python |
| REQ-4 | `fiscal_agent/browser/__init__.py` | **Modificar** — exportar `ComposioBrowser` |
| REQ-4 | `fiscal_agent/cli.py` | **Modificar** — import + instancia `ComposioBrowser` |
| REQ-2 | `pyproject.toml` | **Modificar** — +composio, -playwright |
| REQ-4 | `fiscal_agent/browser/client.py` | **Eliminar** — ArcaBrowser completo |
| REQ-3 | `fiscal_agent/browser/workflows/login.yaml` | **Eliminar** |
| REQ-3 | `fiscal_agent/browser/workflows/switch.yaml` | **Eliminar** |
| REQ-3 | `fiscal_agent/browser/workflows/extract.yaml` | **Eliminar** |

## Non-Functional Requirements

| ID | Requisito | Target |
|----|-----------|--------|
| NFR-C1 | Tiempo por tarea Composio | SHOULD completar <120s por tarea |
| NFR-C2 | Timeout configurable | SHOULD tener timeout por tarea (default 120s) |
| NFR-C3 | Sin dependencia Playwright | MUST no requerir `playwright` en `pyproject.toml` ni runtime |
| NFR-C4 | Retry en fallo de API | MAY reintentar CREATE_TASK 1× ante error de red/API |
| NFR-C5 | Logging estructurado | MUST loggear session_id + task_id + error_code por operación |
