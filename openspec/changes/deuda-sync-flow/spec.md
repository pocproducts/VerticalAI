# Delta Spec: deuda-sync-flow

Extiende el pipeline `run` (WS ARCA → Rules Engine → PDF) con el browser Composio para llenar la columna Importe en página 3 del PDF con deuda real. El flag `--with-deuda` activa un pipeline síncrono por CUIT que no afecta el flujo actual cuando está ausente.

## ADDED Requirements

### REQ-1: Flag `--with-deuda` en comando `run`

El comando `run` en `cli.py` MUST aceptar un flag opcional `--with-deuda` / `-d` de tipo `bool` (default `False`).

- Cuando `--with-deuda` está activo, el pipeline por cada cliente MUST ser: WS API → Rules Engine → Composio Browser → PDF. El resultado del browser se pasa a `PdfGenerator.generar()` para llenar la columna Importe en página 3.
- Cuando `--with-deuda` está inactivo, el pipeline MUST ser idéntico al actual: WS API → Rules Engine → PDF (columna Importe vacía).
- Si `--with-deuda` está activo pero `COMPOSIO_API_KEY` no está configurada en `.env`, el comando MUST mostrar un error descriptivo y terminar antes de procesar clientes.

#### Scenario: Pipeline completo con importes reales

- GIVEN `clients.yaml` con 3 clientes, `COMPOSIO_API_KEY` en `.env`, `ESTUDIO_CLAVE_FISCAL` configurada
- WHEN `python -m fiscal_agent run --config clients.yaml --with-deuda` ejecuta
- THEN cada cliente procesa WS → Rules → Composio → PDF secuencialmente
- THEN cada PDF contiene importes reales en la columna Importe de página 3
- THEN ningún cliente queda con columna Importe completamente vacía (salvo que browser no tenga datos para ese CUIT)

#### Scenario: Sin flag, pipeline idéntico

- GIVEN `clients.yaml` con 3 clientes
- WHEN `python -m fiscal_agent run --config clients.yaml` ejecuta (sin `--with-deuda`)
- THEN pipeline por cliente es WS → Rules → PDF (Composio no se instancia)
- THEN PDF tiene columna Importe vacía en página 3 (comportamiento actual)

#### Scenario: --with-deuda sin API key

- GIVEN `COMPOSIO_API_KEY` no está en `.env`
- WHEN `python -m fiscal_agent run --config clients.yaml --with-deuda` ejecuta
- THEN CLI muestra error: `❌ COMPOSIO_API_KEY no configurada en .env`
- THEN CLI termina con código de error
- THEN ningún cliente se procesa

### REQ-2: ComposioBrowser.run_single() público síncrono

`ComposioBrowser` MUST exponer un método público `run_single(cliente: ClientConfig) -> DeudaOutput` que envuelva `_run_single` y maneje su propio event loop internamente.

- La invocación MUST ser síncrona desde la perspectiva del caller (el CLI `run` no usa `asyncio`).
- `run_single` MUST crear un nuevo event loop con `asyncio.run()` o equivalente para ejecutar `_run_single`.
- `run_single` MUST capturar `ComposioError`, `TimeoutError` y cualquier excepción inesperada, retornando siempre un `DeudaOutput` con `error` poblado (nunca levanta excepción al caller).
- `STOP_TASK` MUST ejecutarse en `finally` de `_run_single` como ya ocurre — `run_single` hereda esta garantía.

#### Scenario: run_single exitoso

- GIVEN `ComposioBrowser(cliente)` con credenciales ARCA válidas
- WHEN `run_single(cliente)` se invoca
- THEN retorna `DeudaOutput` con `error=None`, `saldos` parseados
- THEN Composio `STOP_TASK` se ejecutó en `finally`
- THEN sin side effects en el `ComposioBrowser` que afecten futuras invocaciones

#### Scenario: run_single con error ARCA-4

- GIVEN `ComposioBrowser(cliente)` con CUIT/clave inválidos
- WHEN `run_single(cliente)` se invoca
- THEN retorna `DeudaOutput(cuit=..., error="ARCA-4")`
- THEN no levanta excepción al caller
- THEN `STOP_TASK` se ejecutó

#### Scenario: run_single con timeout

- GIVEN cliente donde Composio excede el timeout (180s para _run_single)
- WHEN `run_single(cliente)` se invoca
- THEN retorna `DeudaOutput(cuit=..., error="Timeout — ...")`
- THEN `STOP_TASK` se ejecutó
- THEN pipeline puede continuar con el siguiente cliente

### REQ-3: Fix `_parse_extract_output()` — regex no captura JSON anidado

`_parse_extract_output()` MUST eliminar el paso 2 (regex `\{[^{}]*\}`) como mecanismo de parseo. El brace-matching (actual paso 3) SHALL ser el único fallback tras el intento de parseo directo (paso 1).

- La regex `\{[^{}]*\}` NO captura JSON con objetos o arrays anidados (e.g. `{"saldos": [{"importe": 1}]}`), porque `[^{}]` excluye cualquier brace interior. El brace-matching sí los captura.
- El brace-matching (actual paso 3) maneja TANTO JSON plano como anidado, por lo que eliminar el paso 2 no pierde cobertura.
- El orden MUST ser: (1) intentar `json.loads()` directo sobre todo el `data`, (2) brace-matching sobre el texto buscando el primer bloque JSON válido de nivel superior.

#### Scenario: JSON con nested objects

- GIVEN extract output text con JSON que contiene `saldos` como array de objetos:
  ```
  Acá está el resultado: {"deuda_actual": 150000.50, "saldos": [{"concepto": "IVA - Período 5/2026", "importe": 75000.25, "vencimiento": "2026-06-15"}], "plan_pagos": null}
  ```
- WHEN `_parse_extract_output(data)` procesa
- THEN paso 1 falla (hay texto alrededor)
- THEN brace-matching encuentra el JSON completo
- THEN `parsed["deuda_actual"] == 150000.50`
- THEN `parsed["saldos"][0]["concepto"] == "IVA - Período 5/2026"`

#### Scenario: JSON plano — sin regresión

- GIVEN extract output con JSON plano (sin anidamiento):
  ```
  {"deuda_actual": 0, "saldos": []}
  ```
- WHEN `_parse_extract_output(data)` procesa
- THEN retorna dict correctamente parseado
- THEN `parsed == {"deuda_actual": 0, "saldos": []}`

#### Scenario: Output vacío

- GIVEN extract output con `data` vacío o `None`
- WHEN `_parse_extract_output(data)` procesa
- THEN retorna `{"deuda_actual": None, "saldos": [], "plan_pagos": None}`
- THEN sin error ni warning

### REQ-4: PdfGenerator.generar() acepta DeudaOutput

`PdfGenerator.generar()` MUST aceptar un parámetro opcional `deuda: Optional[DeudaOutput] = None`.

- `_build_detalle()` MUST recibir la lista de `DeudaItem` desde `DeudaOutput.saldos`.
- Para cada fila de la tabla en página 3, MUST buscar un match entre `Vencimiento.concepto` y `DeudaItem.concepto`.
- Estrategia de matching:
  1. Exact match: `DeudaItem.concepto.lower() == Vencimiento.concepto.lower()`.
  2. Substring match: `DeudaItem.concepto.lower()` está contenido en `Vencimiento.concepto.lower()`, o viceversa.
  3. Sin match → la celda Importe queda vacía (comportamiento actual).
- Cuando hay match, la celda Importe (columna índice 1) MUST mostrar `DeudaItem.importe` formateado como moneda argentina (`$ 75.000,25`).
- Si `DeudaOutput` es `None` o `saldos` está vacío, `_build_detalle()` MUST ser idéntico al actual (columna Importe vacía).

#### Scenario: Match exacto de conceptos

- GIVEN `Vencimiento.concepto = "IVA - Período 5/2026"` y `DeudaItem.concepto = "IVA - Período 5/2026", importe = 75000.25`
- WHEN `_build_detalle()` genera la fila de IVA
- THEN columna Importe contiene `$ 75.000,25`
- THEN el resto de la fila es idéntico

#### Scenario: Match por substring

- GIVEN `Vencimiento.concepto = "IVA - Período 5/2026"` y `DeudaItem.concepto = "IVA"`, `importe = 50000`
- WHEN `_build_detalle()` genera la fila de IVA
- THEN columna Importe contiene `$ 50.000,00`

#### Scenario: Sin match — concepto sin deuda

- GIVEN `Vencimiento.concepto = "Ganancias - Anticipo 6/2026"` y ningún `DeudaItem` tiene concepto que matchee
- WHEN `_build_detalle()` genera la fila de Ganancias
- THEN columna Importe está vacía (como hoy)

#### Scenario: Sin DeudaOutput — comportamiento actual

- GIVEN `PdfGenerator.generar()` invocado sin argumento `deuda`
- WHEN se genera página 3
- THEN columna Importe está vacía en todas las filas
- THEN PDF es byte-por-byte idéntico al actual (misma estructura, mismas notas)

### REQ-5: Pipeline síncrono por CUIT — sin paralelismo

El pipeline `run` con `--with-deuda` MUST procesar cada CUIT secuencialmente: una sola sesión Composio activa por vez. NO usa `asyncio.gather` ni paralelismo entre clientes.

- Cada iteración del loop de clientes ejecuta: WS → Rules → Composio (`run_single`) → PDF.
- Si `run_single()` retorna un `DeudaOutput` con `error`, los importes quedan vacíos para ese CUIT y el pipeline MUST continuar con el siguiente cliente sin interrupción.
- Si `run_single()` retorna `DeudaOutput` exitoso pero con `saldos` vacío (deuda_actual = 0), la página 3 se genera con columna Importe vacía (no hay datos que mostrar).
- La latencia total escala linealmente con `n` clientes: `sum(t_ws + t_rules + t_browser + t_pdf)` por cliente.

#### Scenario: Browser falla para un CUIT, pipeline continúa

- GIVEN 2 clientes, el segundo tiene credenciales inválidas (ARCA-4)
- WHEN pipeline con `--with-deuda` ejecuta
- THEN cliente 1: Composio exitoso → PDF con importes
- THEN cliente 2: Composio retorna error → PDF sin importes (columna vacía)
- THEN pipeline procesa ambos clientes completamente
- THEN resumen final muestra ambos clientes procesados

#### Scenario: Browser exitoso sin deuda

- GIVEN cliente con deuda actual = 0 (sin saldos impagos)
- WHEN `run_single` retorna `DeudaOutput` con `saldos: []`
- THEN página 3 se genera con columna Importe vacía (sin datos)
- THEN pipeline no se interrumpe

#### Scenario: Orden secuencial verificable

- GIVEN 3 clientes: A, B, C
- WHEN pipeline con `--with-deuda` ejecuta
- THEN el log muestra orden A → B → C (un CUIT completa su browser antes de empezar el siguiente)
- THEN no hay sesiones Composio concurrentes

## Archivos Afectados

| REQ | Archivo | Acción |
|-----|---------|--------|
| REQ-1 | `fiscal_agent/cli.py` | **Modificar** — agregar flag `--with-deuda`/`-d` en comando `run`; integrar `ComposioBrowser.run_single` en loop de clientes; validar `COMPOSIO_API_KEY` temprano |
| REQ-2 | `fiscal_agent/browser/composio.py` | **Modificar** — agregar método público `run_single(cliente: ClientConfig) -> DeudaOutput` síncrono que envuelve `_run_single` |
| REQ-3 | `fiscal_agent/browser/composio.py` | **Modificar** — eliminar paso 2 (regex `\{[^{}]*\}`) en `_parse_extract_output()` |
| REQ-4 | `fiscal_agent/pdf_generator.py` | **Modificar** — `generar()` acepta `deuda: Optional[DeudaOutput]`; `_build_detalle()` recibe `DeudaItem[]` y llena columna Importe con match por concepto |
| REQ-5 | `fiscal_agent/cli.py` | **Modificar** — el loop de clientes en `run` es secuencial (ya lo es); integrar `run_single` como paso bloqueante por CUIT |

## Non-Functional Requirements

| ID | Requisito | Target |
|----|-----------|--------|
| NFR-S1 | Invocación síncrona de Composio desde CLI síncrono | `run_single` MUST manejar su propio event loop |
| NFR-S2 | Sin dependencias nuevas | `pyproject.toml` MUST no agregar nuevas dependencias |
| NFR-S3 | Sin cambios en comando `deuda` standalone | `deuda` command MUST funcionar idéntico (paralelo vía `run_all`) |
| NFR-S4 | Logging por CUIT con resultado de browser | MUST loggear `[CUIT] Composio: OK|ERROR|TIMEOUT` por cliente en pipeline `run` |
