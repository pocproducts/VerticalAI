# Delta Spec: report-command

Nuevo comando interactivo `python -m fiscal_agent report` para procesar un solo
CUIT rápidamente: validación, lookup en YAML, descubrimiento opcional vía Padrón
A5, selección de tasks (deuda/facilidades/registro), pipeline completo, PDF en
carpeta fechada (`storage/YYYY-MM/`), y prompt de email.

## ADDED Requirements

### REQ-1: Comando `report` interactivo en CLI

`cli.py` MUST exponer un nuevo comando `report` via `@app.command()` que ejecute
un flujo interactivo de principio a fin para un solo CUIT. No MUST aceptar flags
de CUIT/config (todo se resuelve interactivamente), con la excepción de
`--headed` para debug del browser.

- El flujo MUST ser: prompt CUIT → validación → lookup YAML →
  descubrimiento opcional → selección de tasks → pipeline completo →
  prompt email → resumen.
- `typer.prompt()` MUST usarse para toda entrada interactiva.
- NO MUST usar `asyncio` en el comando — todo MUST ser síncrono.
- Si el pipeline falla, MUST mostrar el error pero continuar hasta el resumen
  (no salir abruptamente).
- Al final, MUST mostrar resumen con ruta del PDF generado (o motivo si no se
  generó).

#### REQ-1.1: CUIT input y validación

El comando MUST pedir el CUIT con `typer.prompt('CUIT del cliente')` y validar:

- Longitud exacta de 11 caracteres (solo dígitos).
- Regex: `^\d{11}$`.
- Si no pasa, MUST mostrar `❌ CUIT inválido — debe tener 11 dígitos` y
  volver a pedir.
- Si el usuario ingresa vacío, MUST mostrar mensaje y salir con código de error.

##### Scenario: CUIT válido

- GIVEN el usuario ingresa `"30716395541"`
- WHEN el comando valida el input
- THEN acepta y continúa con el lookup en YAML

##### Scenario: CUIT con formato incorrecto

- GIVEN el usuario ingresa `"30-71639554-1"` (con guiones)
- WHEN el comando valida el input
- THEN muestra `❌ CUIT inválido — debe tener 11 dígitos`
- THEN vuelve a pedir el CUIT

##### Scenario: CUIT vacío

- GIVEN el usuario ingresa `""` (vacío)
- WHEN el comando valida el input
- THEN muestra mensaje de salida
- THEN termina con código de error

#### REQ-1.2: Lookup en YAML y descubrimiento

El comando MUST cargar `clients.yaml`, parsearlo como `AppConfig`, y buscar el
CUIT ingresado en `config.clientes`.

- Si el CUIT existe, MUST mostrar datos del cliente (nombre, tipo, email) y
  continuar a selección de tasks.
- Si el CUIT NO existe, MUST preguntar:
  `"CUIT {cuit} no encontrado en clients.yaml. ¿Descubrir desde Padrón A5? (s/N)"`.
  - Si el usuario acepta (`s`/`S`), MUST ejecutar descubrimiento inline:
    1. Verificar certificados (`CERT_PATH` / `KEY_PATH`)
    2. Obtener TA via `obtener_ta()`
    3. Consultar Padrón A5 via `consultar_cuit()`
    4. Si error de constancia, MUST mostrar error y salir
    5. Mostrar datos deducidos (nombre, tipo, tipo_persona, cierre, provincia)
    6. Pedir `email` y `clave_fiscal` con `typer.prompt()`
    7. Construir `ClientConfig` con datos deducidos + email + clave_fiscal
    8. **Agregar el nuevo cliente al `config.clientes` en runtime** (no escribe
       el YAML a disco)
  - Si el usuario declina, MUST mostrar mensaje y terminar.

##### Scenario: CUIT encontrado en YAML

- GIVEN `clients.yaml` contiene el cliente con CUIT `"30716395541"`
- WHEN el comando busca el CUIT
- THEN muestra: `✅ Cliente encontrado: MiEmpresa S.A. | Responsable Inscripto | email@ejemplo.com`
- THEN continúa a selección de tasks

##### Scenario: CUIT no encontrado, usuario acepta descubrimiento

- GIVEN `clients.yaml` NO contiene el CUIT `"30716395541"`
- WHEN el comando pregunta si descubrir y el usuario responde `"s"`
- THEN obtiene TA, consulta Padrón A5 exitosamente
- THEN muestra datos deducidos
- THEN pide email y clave_fiscal
- THEN construye `ClientConfig` y lo agrega a `config.clientes`
- THEN continúa a selección de tasks con el nuevo cliente en runtime

##### Scenario: CUIT no encontrado, usuario declina descubrimiento

- GIVEN el CUIT no está en `clients.yaml`
- WHEN el comando pregunta si descubrir y el usuario responde `"N"`
- THEN muestra: `"❌ CUIT no registrado. Agregalo manualmente a clients.yaml y volvé a ejecutar el comando."`
- THEN termina con código de error

##### Scenario: Descubrimiento falla — error de constancia

- GIVEN el CUIT no está en `clients.yaml`, usuario acepta descubrir
- WHEN Padrón A5 retorna error de constancia (e.g. CUIT inexistente)
- THEN muestra los errores del WS
- THEN termina con código de error

#### REQ-1.3: Selección de tasks a extraer

El comando MUST preguntar interactivamente qué tasks ejecutar con valores por
defecto:

- `"¿Extraer deuda ARCA? (S/n)"` → default `S` (True)
- `"¿Extraer facilidades? (s/N)"` → default `N` (False)
- `"¿Extraer registro tributario? (s/N)"` → default `N` (False)

Si NINGUNA task está seleccionada (deuda=N, facilidades=N, registro=N), MUST
mostrar `"⚠️  Sin tasks seleccionadas. Debe seleccionar al menos una."` y
volver a preguntar.

##### Scenario: Deuda seleccionada por defecto

- GIVEN usuario presiona Enter en todas las preguntas
- WHEN task selection termina
- THEN `with_deuda=True`, `with_facilidades=False`, `with_registro=False`

##### Scenario: Todas las tasks seleccionadas

- GIVEN usuario responde `"s"` a deuda, `"s"` a facilidades, `"s"` a registro
- WHEN task selection termina
- THEN `with_deuda=True`, `with_facilidades=True`, `with_registro=True`

##### Scenario: Ninguna task seleccionada

- GIVEN usuario responde `"n"` a las tres preguntas
- WHEN task selection termina
- THEN muestra `"⚠️  Debe seleccionar al menos una task."`
- THEN vuelve a preguntar

#### REQ-1.4: Pipeline single-cliente

El comando MUST ejecutar el pipeline completo para el cliente (descubierto o
existente) siguiendo el mismo orden que `run`:

1. **Validación temprana**: si hay browser tasks seleccionadas, verificar
   `COMPOSIO_API_KEY` y `ESTUDIO_CLAVE_FISCAL` en `.env`.
   - Si faltan, MUST mostrar error y salir.
2. **WS API (Padrón A5)**: consultar el padrón con el CUIT.
3. **Auto-complete**: llamar `_completar_cliente_desde_padron()` para
   campos faltantes.
4. **Rules Engine**: calcular calendario de vencimientos para el mes/año actual
   (usa `datetime.now()` para mes y año).
5. **Composio Browser**: por cada task seleccionada (deuda/facilidades/registro),
   crear el `*Task` correspondiente y ejecutar `browser.run_single()`.
   - Si Composio falla, MUST mostrar `⚠️  Composio: ERROR — {mensaje}` y
     continuar (misma lógica que `run`).
6. **Rentas Córdoba Matching**: ejecutar `evaluar_rentas_cordoba()` si hay
   datos de browser.
7. **PDF**: generar PDF via `PdfGenerator.generar()` con los datos obtenidos.
   - Si el browser falló completamente (todas las tasks con error), MUST
     mostrar advertencia y saltear PDF (misma lógica que `run`).
8. **Email**: preguntar si enviar email (ver REQ-1.5).

El pipeline MUST ser secuencial y síncrono, igual que `run` para un solo cliente.

##### Scenario: Pipeline completo exitoso — deuda + facilidades + registro

- GIVEN CUIT existente en YAML, deuda=S, facilidades=S, registro=S
- WHEN se ejecuta el pipeline
- THEN WS API retorna datos del padrón
- THEN Rules Engine calcula vencimientos
- THEN Composio ejecuta 3 tasks (deuda, facilidades, registro) y retorna datos
- THEN Rentas Córdoba matching se ejecuta (si aplica)
- THEN PDF se genera exitosamente
- THEN se pregunta por email

##### Scenario: Pipeline sin browser tasks — solo deuda

- GIVEN CUIT existente, deuda=S, facilidades=N, registro=N
- WHEN se ejecuta el pipeline
- THEN Composio solo ejecuta `FullTask` (deuda)
- THEN Composio NO ejecuta `FacilidadesTask` ni `RegistroTask`
- THEN PDF incluye página de deuda pero NO de facilidades ni registro

##### Scenario: Composio falla — pipeline continúa

- GIVEN CUIT existente, deuda=S, Composio retorna error (e.g. timeout)
- WHEN se ejecuta el pipeline
- THEN muestra `⚠️  Composio: ERROR/TIMEOUT — {detalle}`
- THEN NO genera PDF (browser falló)
- THEN pregunta por email (salteado porque no hay PDF)
- THEN resumen muestra el error

##### Scenario: Sin vencimientos para el mes actual

- GIVEN CUIT existente, Rules Engine retorna 0 vencimientos
- WHEN se ejecuta el pipeline
- THEN muestra `"Sin vencimientos para {nombre} este mes"`
- THEN saltea PDF (sin datos que mostrar)
- THEN saltea email
- THEN resumen muestra que no hubo vencimientos

#### REQ-1.5: Output path con carpeta fechada

El comando MUST generar el PDF en un subdirectorio con formato
`storage/YYYY-MM/` donde YYYY y MM corresponden al año y mes actuales
(`datetime.now()`).

- La ruta completa MUST ser:
  `storage/{anio:04d}-{mes:02d}/Calendario_{cuit}_{anio:04d}-{mes:02d}.pdf`
- Para lograrlo, MUST invocar `PdfGenerator.generar()` con
  `output_dir=Path(f'storage/{anio:04d}-{mes:02d}')`.
- Si el directorio no existe, MUST crearse automáticamente
  (`mkdir(parents=True, exist_ok=True)`).

##### Scenario: PDF en subcarpeta YYYY-MM

- GIVEN hoy es 2026-06-12
- WHEN el pipeline genera el PDF para CUIT `30716395541`
- THEN el PDF queda en `storage/2026-06/Calendario_30716395541_2026-06.pdf`
- THEN el directorio `storage/2026-06/` existe

##### Scenario: Directorio storage/YYYY-MM no existe previamente

- GIVEN `storage/2026-06/` no existe
- WHEN `PdfGenerator.generar(output_dir=...)` se invoca
- THEN el directorio se crea automáticamente

#### REQ-1.6: Prompt de email

Después de generar el PDF (si se generó), el comando MUST preguntar:

`"¿Enviar email a {email}? (s/N)"`

- Si el cliente no tiene email configurado, MUST mostrar
  `"⚠️  Sin email configurado para {nombre} — salteando envío"`.
- Si el usuario acepta (`s`/`S`), MUST enviar email via `EmailSender.enviar()`.
  - Si el envío falla, MUST mostrar `"❌ Error al enviar email: {error}"`.
  - Si el envío es exitoso, MUST mostrar `"✅ Email enviado a {email}"`.
- Si el usuario declina, MUST mostrar `"Email: omitido"`.

##### Scenario: Email enviado exitosamente

- GIVEN PDF generado, cliente con email `cliente@ejemplo.com`
- WHEN usuario responde `"s"` al prompt de email
- THEN `EmailSender.enviar()` se invoca y retorna `True`
- THEN muestra `"✅ Email enviado a cliente@ejemplo.com"`

##### Scenario: Usuario declina email

- GIVEN PDF generado, cliente con email configurado
- WHEN usuario responde `"N"` al prompt de email
- THEN muestra `"Email: omitido"`

##### Scenario: Cliente sin email

- GIVEN PDF generado, cliente SIN email configurado
- WHEN se llega al paso de email
- THEN muestra `"⚠️  Sin email configurado para {nombre} — salteando envío"`

##### Scenario: Sin PDF generado — email salteado

- GIVEN pipeline falló (Composio error) → no hay PDF
- WHEN se llega al paso de email
- THEN muestra `"Email: omitido (no hay PDF generado)"`

#### REQ-1.7: Resumen final

El comando MUST mostrar un resumen al final con:

- Estado general (`✅ Procesado exitosamente` o `❌ Error`)
- Ruta completa del PDF generado (o `"—"` si no se generó)
- Email: `"Enviado"` / `"Omitido"` / `"Sin email configurado"` / `"No aplica"`
- Si hubo error, mostrar el mensaje de error

##### Scenario: Resumen exitoso

- GIVEN pipeline completo y email enviado
- WHEN el comando termina
- THEN muestra:
  ```
  ══════════════════════════════════════════
    Resumen
  ══════════════════════════════════════════
    Cliente: MiEmpresa S.A. (30716395541)
    PDF:     /ruta/a/storage/2026-06/Calendario_30716395541_2026-06.pdf
    Email:   Enviado a cliente@ejemplo.com
    Estado:  ✅ Procesado exitosamente
  ```

##### Scenario: Resumen con error

- GIVEN pipeline con error de Composio, email omitido
- WHEN el comando termina
- THEN muestra:
  ```
    Cliente: MiEmpresa S.A. (30716395541)
    PDF:     —
    Email:   Omitido (no hay PDF generado)
    Estado:  ❌ Error — Composio: Timeout — la sesión excedió el límite de 180s
  ```

### REQ-2: PdfGenerator.generar() acepta `output_dir` opcional

`PdfGenerator.generar()` MUST aceptar un nuevo parámetro opcional
`output_dir: Optional[Path] = None`.

- Cuando `output_dir` es provisto, MUST usar ESE directorio como base para el
  archivo (en vez de `self.output_dir`).
- MUST crear el directorio con `mkdir(parents=True, exist_ok=True)` si no existe.
- Cuando `output_dir` es `None` (default), MUST mantener el comportamiento
  actual (`self.output_dir`).
- El cambio MUST ser mínimo (~10 líneas): solo la firma del método + la
  resolución del directorio destino antes de construir el path completo.
- Esto NO MUST afectar PDFs generados por el comando `run` ni por tests
  existentes.

##### Scenario: Sin output_dir — comportamiento actual

- GIVEN `PdfGenerator.__init__()` con `output_dir=None` (usa `storage/calendarios/`)
- WHEN `generar()` se invoca sin `output_dir`
- THEN `filepath` se construye con `self.output_dir / filename`
- THEN el PDF queda en `storage/calendarios/Calendario_{cuit}_{anio:04d}-{mes:02d}.pdf`
- THEN el comportamiento es byte-por-byte idéntico al actual

##### Scenario: Con output_dir — ruta personalizada

- GIVEN `PdfGenerator.__init__()` con `output_dir=None`
- WHEN `generar(output_dir=Path('storage/2026-06'))` se invoca
- THEN `filepath` se construye con `Path('storage/2026-06') / filename`
- THEN el PDF queda en `storage/2026-06/Calendario_{cuit}_{anio:04d}-{mes:02d}.pdf`

##### Scenario: output_dir no existe — se crea automáticamente

- GIVEN `storage/2026-06/` no existe en disco
- WHEN `generar(output_dir=Path('storage/2026-06'))` se invoca
- THEN `mkdir(parents=True, exist_ok=True)` crea el directorio
- THEN el PDF se genera sin error

## Archivos Afectados

| REQ   | Archivo                           | Acción      | Descripción |
|-------|-----------------------------------|-------------|-------------|
| REQ-1 | `fiscal_agent/cli.py`             | **Agregar** | Nuevo comando `report` (~150-200 líneas) con flujo interactivo completo |
| REQ-2 | `fiscal_agent/pdf_generator.py`   | **Modificar** | `generar()` acepta `output_dir: Optional[Path] = None` (~10 líneas) |

## Non-Functional Requirements

| ID       | Requisito | Target | Verificación |
|----------|-----------|--------|-------------|
| NFR-R1   | Sin dependencias nuevas | `pyproject.toml` MUST no agregar nuevas dependencias | No hay cambios en `pyproject.toml` |
| NFR-R2   | Sin cambios en comando `run` | `run` command MUST funcionar idéntico sin importar `report` | `run --config clients.yaml` produce mismo output antes y después |
| NFR-R3   | Sin cambios en comando `deuda` | `deuda` command MUST funcionar idéntico | `deuda --config clients.yaml` produce mismo output |
| NFR-R4   | Sin cambios en modelos | `models.py` MUST no modificarse | Sin cambios en archivo `models.py` |
| NFR-R5   | Sin cambios en PdfGenerator existente | `generar()` sin `output_dir` MUST producir mismo PDF | Tests de regresión en PDFs existentes pasan sin cambios |
| NFR-R6   | Validación CUIT temprana | Validación MUST ser solo de formato (11 dígitos). Validación real ocurre en Padrón A5 | Regex `^\d{11}$` |
