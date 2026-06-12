# Tasks: report-command

## Review Workload Forecast

### Estimación por archivo

| Archivo | Acción | Líneas netas nuevas | Líneas modificadas | Líneas movidas (refactor) | Total delta |
|---------|--------|--------------------:|-------------------:|--------------------------:|------------:|
| `fiscal_agent/pdf_generator.py` | Modificar `generar()` | +3 | ~7 | 0 | **~10** |
| `fiscal_agent/cli.py` — helpers | Nuevos: `_validar_cuit`, `_descubrir_cliente`, `_seleccionar_tasks`, `_preguntar_email`, `_mostrar_resumen` | ~85 | 0 | 0 | **~85** |
| `fiscal_agent/cli.py` — `_procesar_cliente_pipeline()` | Extraído de `run()` | 0 | 0 | ~120 (movidas) | **~0** |
| `fiscal_agent/cli.py` — `report()` command | Nuevo comando Typer | ~45 | 0 | 0 | **~45** |
| `fiscal_agent/cli.py` — refactor `run()` | Usar helper compartido | ~5 | ~25 | -120 (eliminadas) | **~-90** |
| **Total neto** | | **~138** | **~32** | **~120** | **~50** |

### Desglose detallado por componente

#### `_procesar_cliente_pipeline()` — extraído de `run()` líneas 396-519
- Código a extraer: loop body de `run()`, excluyendo init del `resultado` dict, email section, y exception handler.
- Líneas fuente: 396-519 (~124 líneas). Extracción neta: ~110 líneas (sin los `typer.echo()` de render).
- Firma: 10 parámetros (cliente, token, sign, engine, browser, mes, anio, with_deuda/facilidades/registro, pdf_gen, output_dir).
- Retorna `dict` con: cliente, cuit, ws_api, calendario, pdf, pdf_path, error, browser_failed.

#### Helpers interactivos nuevos

| Helper | Líneas | Descripción |
|--------|-------:|-------------|
| `_validar_cuit()` | ~15 | Loop `typer.prompt()` + regex `^\d{11}$` + manejo vacío |
| `_descubrir_cliente(cuit)` | ~40 | TA → Padrón A5 → mostrar datos → prompt email/clave → `ClientConfig` |
| `_seleccionar_tasks()` | ~15 | Loop `typer.confirm()` deuda/facilidades/registro hasta >=1 |
| `_preguntar_email(cliente, pdf_path, config, mes, anio)` | ~20 | State machine: sin PDF → omitido, sin email → warning, confirm → enviar |
| `_mostrar_resumen(cliente, resultado, email_status)` | ~15 | Cuadro con borde `═` mostrando cliente, PDF path, email status, estado |

### Budget check: ¿Riesgo 400-line budget?

**Riesgo: MUY BAJO**.

- Líneas netas nuevas totales: ~138
- Líneas movidas (refactor puro, no cuentan para review): ~120
- Líneas modificadas en código existente: ~32
- El cambio total en el diff será de ~170 líneas (138 nuevas + 32 modificadas).
- **Lejos del límite de 400 líneas.** No requiere chained PR.

### Hot spots (mayor densidad de review necesaria)

1. **`_procesar_cliente_pipeline()` refactor**: ~110 líneas de lógica existencial (WS → Rules → Composio → Matching → PDF). El reviewer debe verificar que no se perdió ningún step ni se alteraron los `typer.echo()`.
2. **`_descubrir_cliente()`**: ~40 líneas con lógica de negocio real (TA, Padrón A5, construcción de `ClientConfig`). Es código nuevo no cubierto por tests de regresión.
3. **CUIT validation**: ~15 líneas. Simple pero crítico — un error permite ejecutar pipelines con datos inválidos.

---

## Suggested Work Units

### WU-1: PdfGenerator — `generar()` acepta `output_dir` (REQ-2)
- **Archivo**: `fiscal_agent/pdf_generator.py`
- **Dependencias**: Ninguna
- **Commits**: 1 (`feat(pdf): add output_dir parameter to generar()`)
- **Por qué es primera**: No depende de nada. Todos los tests existentes deben pasar sin cambios.

### WU-2: Extraer `_procesar_cliente_pipeline()` de `run()` (refactor)
- **Archivo**: `fiscal_agent/cli.py`
- **Dependencias**: WU-1 (por el parámetro `output_dir`)
- **Commits**: 1 (`refactor(cli): extract _procesar_cliente_pipeline() from run()`)
- **Nota**: No debe cambiar comportamiento. `run()` llama al helper con los mismos parámetros y el resultado es idéntico.

### WU-3: Helpers interactivos para `report`
- **Archivo**: `fiscal_agent/cli.py`
- **Dependencias**: WU-2 (usa el helper del pipeline)
- **Commits**: 1 (`feat(cli): add interactive helpers for report command`)
- **Helpers**: `_validar_cuit()`, `_descubrir_cliente()`, `_seleccionar_tasks()`, `_preguntar_email()`, `_mostrar_resumen()`

### WU-4: Comando `report`
- **Archivo**: `fiscal_agent/cli.py`
- **Dependencias**: WU-3 (usa los helpers)
- **Commits**: 1 (`feat(cli): add interactive report command`)
- **Nota**: Wires todos los helpers + `_procesar_cliente_pipeline()` en el flujo completo.

### WU-5: Tests de regresión en `run()` + limpieza
- **Archivo**: `fiscal_agent/cli.py`
- **Dependencias**: WU-2
- **Commits**: 1 (`test(cli): verify run regression after pipeline extraction`)
- **Verifica**: `run()` produce mismo output con y sin `--with-deuda`, `--with-facilidades`, `--with-registro`.

---

## Task List

| ID | Nombre | Archivos | Dependencias | Criterio de Aceptación |
|----|--------|----------|--------------|------------------------|
| T0 | `PdfGenerator.generar()` acepta `output_dir` opcional | `fiscal_agent/pdf_generator.py` | Ninguna | `generar(output_dir=Path('storage/2026-06'))` produce PDF en esa ruta. `generar()` sin `output_dir` produce mismo path que antes (`self.output_dir`). `mkdir(parents=True, exist_ok=True)` crea el dir si no existe. **Tests existentes de PDF pasan sin cambios.** |
| T1 | Extraer `_procesar_cliente_pipeline()` de `run()` | `fiscal_agent/cli.py` | T0 | Función extraída con firma: `_procesar_cliente_pipeline(cliente, token, sign, engine, browser, mes, anio, with_deuda, with_facilidades, with_registro, pdf_gen, output_dir=None) -> dict`. `run()` la llama y resultado es byte-por-byte idéntico al original. El helper NO maneja email. |
| T2 | Helper `_validar_cuit()` | `fiscal_agent/cli.py` | Ninguno | `typer.prompt()` loop que retorna string de 11 dígitos o sale con `typer.Exit`. Rechaza vacío, guiones, letras. Solo acepta `^\d{11}$`. |
| T3 | Helper `_descubrir_cliente(cuit)` | `fiscal_agent/cli.py` | Ninguno | TA → Padrón A5 → muestra datos deducidos → prompt email/clave → retorna `ClientConfig`. Si errorConstancia, muestra errores y `typer.Exit(1)`. Si faltan certificados, `typer.Exit(1)`. |
| T4 | Helper `_seleccionar_tasks()` | `fiscal_agent/cli.py` | Ninguno | Loop `typer.confirm()` para deuda (default S), facilidades (default N), registro (default N). Si todas False, muestra warning y repite. Retorna `tuple[bool, bool, bool]`. |
| T5 | Helper `_preguntar_email(cliente, pdf_path, config, mes, anio)` | `fiscal_agent/cli.py` | T0 (usa `EmailSender`) | State machine: sin PDF → retorna `"Omitido (no hay PDF generado)"`. Sin email → retorna `"Sin email configurado"`. Confirmación → envía vía `EmailSender.enviar()` → retorna `"✅ Enviado"` o `"❌ Error al enviar email: {error}"`. Decline → `"Email: omitido"`. |
| T6 | Helper `_mostrar_resumen(cliente, resultado, email_status)` | `fiscal_agent/cli.py` | Ninguno | Muestra cuadro con borde `═`, cliente/CUIT, PDF path (o `"—"`), email status, estado general (`✅ Procesado exitosamente` o `❌ Error — {msg}`). |
| T7 | Comando `report()` completo | `fiscal_agent/cli.py` | T1, T2, T3, T4, T5, T6 | `@app.command()` con flag `--headed`. Flujo: `_validar_cuit()` → lookup YAML → `_descubrir_cliente()` si no existe → `_seleccionar_tasks()` → early validation env vars → `output_dir = Path(f'storage/{now.year}-{now.month:02d}')` → init certs/TA/browser → `_procesar_cliente_pipeline()` → `_preguntar_email()` → `_mostrar_resumen()`. Maneja errores sin salir abruptamente. |
| T8 | Refactor `run()` para usar `_procesar_cliente_pipeline()` | `fiscal_agent/cli.py` | T1 | `run()` reemplaza el loop body inline (líneas 396-541) con llamada a `_procesar_cliente_pipeline()`. Email handling se mantiene en `run()`. Output debe ser idéntico. |
| T9 | Tests de regresión | `fiscal_agent/cli.py` + tests existentes | T8 | `python -m fiscal_agent run --config clients.yaml` produce mismo output. Tests unitarios de `_validar_cuit()` (mock `typer.prompt`): CUIT válido, con guiones, vacío. Test de `generar(output_dir=...)`: verificar que `filepath` usa el `dest` correcto. |

---

## Implementation Order

```
T0 ───────────────────────────────────────┐
                                          │
T1 ───────────────────────────────────────┤
                                          │
T2 ───────────┐                          │
T3 ───────────┤                          │
T4 ───────────┤── T7 ──── T9             │
T5 ───────────┤                          │
T6 ───────────┘                          │
                                          │
T8 ───────────────────────────────────────┘
```

### Orden de ejecución recomendado

1. **T0** — `pdf_generator.py`: Cambio mínimo e independiente. Testeable en aislamiento. Primer commit.
2. **T1** — Extraer `_procesar_cliente_pipeline()`: Refactor puro. Probar que `run()` funciona igual ANTES de tocar nada más. Segundo commit.
3. **T8** — Refactor `run()` para usar el helper: Confirmar que no hay regresión antes de continuar. Tercer commit.
4. **T2, T3, T4, T5, T6** — Helpers interactivos: Se pueden implementar en paralelo (no dependen entre sí). Todos en un solo commit. Cuarto commit.
5. **T7** — Comando `report()`: Wires todo. Quinto commit.
6. **T9** — Tests: Unitarios de validación CUIT, `generar(output_dir=...)`, y regresión de `run()`. Sexto commit.

### Secuencia de commits propuesta

| # | Commit | WU | Tasks |
|---|--------|----|-------|
| 1 | `feat(pdf): add output_dir parameter to generar()` | WU-1 | T0 |
| 2 | `refactor(cli): extract _procesar_cliente_pipeline() from run()` | WU-2 | T1 |
| 3 | `refactor(cli): use _procesar_cliente_pipeline() in run()` | WU-5 | T8 |
| 4 | `feat(cli): add interactive helpers for report command` | WU-3 | T2, T3, T4, T5, T6 |
| 5 | `feat(cli): add interactive report command` | WU-4 | T7 |
| 6 | `test(cli): add unit tests for report validators and PDF output_dir` | WU-5 | T9 |

---

## Riesgos

| Riesgo | Severidad | Probabilidad | Mitigación |
|--------|-----------|-------------|------------|
| **Refactor de `run()` altera output existente** | Alta | Baja | T9: tests de regresión ANTES de mergear. Comparar output de `run` con git diff de archivos generados. |
| **Pipeline extract pierde un step** | Alta | Baja | Revisión línea por línea del código extraído vs. original. Los tests de regresión detectan diferencias en output. |
| **`_descubrir_cliente()` duplica lógica de `discover` command** | Media | Media | Ya es aceptado por el design (el comando `discover` existe independientemente). La duplicación es deliberada porque la UI interactiva es diferente (no muestra bloque YAML, construye `ClientConfig` directamente). |
| **Falta de tests interactivos** | Media | Alta | `typer.prompt()` y `typer.confirm()` son blocking. Para tests unitarios, se mockean. Para E2E, se necesita simular stdin. El spec no exige test E2E automatizado — se verifica manualmente. |
| **Ruta `storage/YYYY-MM/` con month/day off-by-one** | Baja | Muy baja | `datetime.now()` ya se usa en `run()`. Usar exactamente `now.month` y `now.year` como en el spec. |

---

## Resumen de Artefactos

| Artefacto | Ruta |
|-----------|------|
| Tasks | `openspec/changes/report-command/tasks.md` |
| Engram | `sdd/report-command/tasks` (via `mem_save` con `capture_prompt: false`) |
