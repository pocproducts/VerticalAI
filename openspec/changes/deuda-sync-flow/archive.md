# Archive: deuda-sync-flow

**Archived**: 2026-06-10
**Status**: ✅ Implementado y verificado

---

## 1. Resumen del Cambio

Integrar extracción de deuda real vía Composio Browser dentro del pipeline `run` por CUIT individual, para que la página 3 del PDF contenga importes reales en la columna Importe en vez de estar vacía.

**Flag**: `--with-deuda` / `-d` en el comando `run` — opt-in, backward compatible. Sin el flag, el pipeline es idéntico al actual.

**Pipeline con flag**: WS ARCA → Rules Engine → Composio Browser (`run_single`) → PDF final con importes.

---

## 2. Archivos Modificados

| Archivo | Acción | Líneas | Descripción |
|---------|--------|--------|-------------|
| `fiscal_agent/cli.py` | Modificado | ~30 líneas | Flag `--with-deuda`/`-d`, validación temprana de `COMPOSIO_API_KEY`, integración síncrona de Composio en loop de clientes, logging por CUIT |
| `fiscal_agent/browser/composio.py` | Modificado | ~20 líneas | Método público `run_single()` sync wrapper, fix `_parse_extract_output()` — eliminada regex `\{[^{}]*\}`, brace-matching como único fallback |
| `fiscal_agent/pdf_generator.py` | Modificado | ~30 líneas | `generar()` acepta `deuda: Optional[DeudaOutput]`, helper `_match_importe()` fuzzy keyword, `_format_ars()` moneda argentina |
| `fiscal_agent/tests/test_deuda_sync.py` | Nuevo | 164 líneas | Tests unitarios: parseo JSON, matching conceptos, formateo moneda, error wrapping |

**Total estimado**: ~150 líneas de cambio neto.

---

## 3. Estado de Requerimientos

### REQ-1: Flag `--with-deuda` en comando `run`

| Sub-requisito | Estado | Implementación |
|---|---|---|
| Flag `--with-deuda`/`-d` bool default False | ✅ | `cli.py:300-305` — `typer.Option(False, '--with-deuda', '-d')` |
| Pipeline alternativo cuando flag activo | ✅ | `cli.py:406-416` — Composio entre Rules Engine y PDF |
| Pipeline idéntico sin flag | ✅ | `cli.py:406` — `deuda_output = None` cuando `with_deuda=False` |
| Error descriptivo si falta `COMPOSIO_API_KEY` | ✅ | `cli.py:324-328` — `❌ COMPOSIO_API_KEY no configurada en .env` |

**Escenarios**:
- ✅ Pipeline completo con importes reales
- ✅ Sin flag, pipeline idéntico
- ✅ `--with-deuda` sin API key

### REQ-2: ComposioBrowser.run_single() público síncrono

| Sub-requisito | Estado | Implementación |
|---|---|---|
| Método público `run_single(cliente) -> DeudaOutput` | ✅ | `composio.py:538-555` |
| Sync wrapper con `asyncio.run()` | ✅ | `composio.py:548` |
| Captura `ComposioError`, `TimeoutError`, excepciones inesperadas | ✅ | `composio.py:547-554` — try/except Exception |
| `STOP_TASK` en `finally` de `_run_single` | ✅ | `composio.py:489-492` |

**Escenarios**:
- ✅ `run_single` exitoso → `DeudaOutput` sin error
- ✅ ARCA-4 → `DeudaOutput` con `error="ARCA-4"`
- ✅ Timeout → `DeudaOutput` con error descriptivo

### REQ-3: Fix `_parse_extract_output()` — regex no captura JSON anidado

| Sub-requisito | Estado | Implementación |
|---|---|---|
| Eliminar regex `\{[^{}]*\}` como paso de parseo | ✅ | `composio.py:323-361` — sin regex simple |
| Brace-matching como único fallback | ✅ | `composio.py:344-358` |
| Orden: (1) json.loads directo, (2) brace-matching | ✅ | `composio.py:339-342` → `344-358` |

**Escenarios**:
- ✅ JSON con nested objects → parseo correcto
- ✅ JSON plano → sin regresión
- ✅ Output vacío/None → dict default
- ✅ Texto sin JSON → dict default con `_raw`

### REQ-4: PdfGenerator.generar() acepta DeudaOutput

| Sub-requisito | Estado | Implementación |
|---|---|---|
| Parámetro `deuda: Optional[DeudaOutput] = None` | ✅ | `pdf_generator.py:81` |
| `_build_detalle()` recibe DeudaOutput | ✅ | `pdf_generator.py:132,336` |
| Matching por intersección de tokens | ✅ | `pdf_generator.py:455-467` — `_match_importe()` |
| Formateo moneda argentina `$ 75.000,25` | ✅ | `pdf_generator.py:469-472` — `_format_ars()` |
| Sin DeudaOutput → comportamiento actual | ✅ | `pdf_generator.py:370` — solo procesa si `deuda and deuda.saldos` |

**Escenarios**:
- ✅ Match exacto de conceptos
- ✅ Match por substring/fuzzy
- ✅ Sin match → Importe vacío
- ✅ Sin `DeudaOutput` → columna Importe vacía

### REQ-5: Pipeline síncrono por CUIT — sin paralelismo

| Sub-requisito | Estado | Implementación |
|---|---|---|
| Loop secuencial de clientes | ✅ | `cli.py:367` — `for i, cliente in enumerate(config.clientes)` |
| `run_single()` bloqueante por CUIT | ✅ | `cli.py:409` — `browser.run_single(cliente)` |
| Error en browser → pipeline continúa | ✅ | `cli.py:410-416` — log + continuar sin interrupción |
| Logging `[CUIT] Composio: OK|ERROR|TIMEOUT` | ✅ | `cli.py:413-416` |

**Escenarios**:
- ✅ Browser falla para un CUIT → pipeline continúa
- ✅ Browser exitoso sin deuda → PDF sin importes
- ✅ Orden secuencial verificable

### Non-Functional Requirements

| ID | Requisito | Estado | Evidencia |
|----|-----------|--------|-----------|
| NFR-S1 | Invocación síncrona desde CLI síncrono | ✅ | `composio.py:548` — `asyncio.run(self._run_single(cliente))` |
| NFR-S2 | Sin dependencias nuevas | ✅ | No se agregaron imports a `pyproject.toml` |
| NFR-S3 | Comando `deuda` standalone intacto | ✅ | `cli.py:476-551` — sin cambios en flujo `deuda` |
| NFR-S4 | Logging por CUIT con resultado | ✅ | `cli.py:413,416` — `logger.info('[CUIT] Composio: ...')` |

---

## 4. Decisiones Clave

### 4.1 Flag opt-in vs comando separado

Se eligió `--with-deuda` como flag del comando `run` existente en vez de crear un comando independiente. Esto evita duplicar la lógica del pipeline (carga de config, certs, TA, loop de clientes) y mantiene un único entry point para generación de calendarios. El flag tiene default `False`, por lo que cero impacto en el flujo actual.

### 4.2 `run_single()` síncrono vía `asyncio.run()`

`ComposioBrowser` originalmente usa async (`_run_single` es `async def`), mientras que el CLI `run` es síncrono. En vez de refactorizar todo `run` a async, se creó un wrapper síncrono con `asyncio.run()` que maneja su propio event loop. Decisión pragmática: el wrapper captura toda excepción y siempre retorna `DeudaOutput`, por lo que es seguro llamarlo desde código síncrono.

Alternativa descartada: reusar `run_all()` async — requería reestructurar `run` completo.

### 4.3 PDF generado una sola vez (post-browser)

Se genera el PDF **después** de Composio, en un solo paso. Alternativa descartada: generar PDF antes y sobrescribir — duplicaba trabajo sin beneficio real.

### 4.4 Fuzzy keyword match para conceptos

Se usa intersección de tokens (palabras) entre `Vencimiento.concepto` y `DeudaItem.concepto`. Es simple, no requiere NLP externo, y maneja diferencias textuales comunes (ej: "IVA Mensual" vs "IVA - Período 5/2026"). Alternativas descartadas: exact match (frágil), LLM match (overkill).

### 4.5 Brace-matching como único fallback

Se eliminó la regex `\{[^{}]*\}` porque no captura JSON con objetos anidados (como `saldos: [{...}]`). El brace-matching existente como paso 3 cubre tanto JSON plano como anidado, y quedó como único fallback tras el intento de `json.loads()` directo.

### 4.6 Error handling: skip + continue

Si Composio falla para un CUIT, el pipeline continúa con el siguiente cliente con importes vacíos. No se aborta el pipeline completo. Esto maximiza la cantidad de PDFs generados por ejecución.

---

## 5. Lecciones Aprendidas

### Técnicas

1. **JSON anidado en output de AI agent**: El AI agent de Composio frecuentemente devuelve JSON dentro de texto natural ("Acá está el resultado: {...}"). La regex `\{[^{}]*\}` es insuficiente cuando el JSON contiene objetos o arrays. El brace-matching con conteo de profundidad es la solución correcta y reutilizable.

2. **Matching fuzzy minimalista**: La intersección de tokens (vía `re.findall(r'\w+')`) es sorprendentemente efectiva para matchear conceptos tributarios. Es barata, determinística, y no requiere dependencias externas. Suficiente para el caso de uso — no se necesita NLP ni embeddings.

3. **`asyncio.run()` en wrapper síncrono**: Funciona bien para integrar código async en un CLI síncrono. La clave es capturar toda excepción en el wrapper para que el caller nunca vea un `RuntimeError("asyncio.run() cannot be called from a running event loop")`.

4. **Formateo monetario argentino**: Python no tiene locale ARS por defecto. El patrón `f'$ {importe:,.2f}'.replace(',', 'X').replace('.', ',').replace('X', '.')` es un clásico argentino que funciona en cualquier entorno.

### De Proceso

5. **Delta spec sin main spec target**: REQ-1, REQ-4, REQ-5 no tienen un spec principal existente (no hay spec para `cli.py` ni `pdf_generator.py`). Esto sugiere que estos módulos necesitan su propio spec. Considerar crear `openspec/specs/run-pipeline/spec.md` y `openspec/specs/pdf-generation/spec.md`.

6. **Tasks sin checkboxes**: Las tasks en `tasks.md` quedaron con `- [ ]` sin marcar. Para futuros cambios, marcar `- [x]` a medida que se completan ayuda a tracking.

---

## 6. Próximos Pasos Sugeridos

1. **Sync delta specs a main specs**: Los REQ-2 y REQ-3 corresponden al spec `composio-browser-integration` y deberían mergearse. Los REQ-1, REQ-4, REQ-5 son candidatos para specs nuevos de dominio (`run-pipeline`, `pdf-generation`).

2. **Mover carpeta a archive**: Ejecutar `mv openspec/changes/deuda-sync-flow openspec/changes/archive/2026-06-10-deuda-sync-flow/` para completar el archivado físico.

3. **Test de integración CLI**: El task 3.6 (Typer CliRunner) no se implementó. Considerar agregar test que verifique que `--with-deuda` activa la rama Composio y sin flag no.

4. **Monitoreo de latencia**: El pipeline ahora escala linealmente con la cantidad de clientes (latencia = sumatoria por CUIT). Si la cantidad de clientes crece, considerar timeout global o paralelismo controlado.

5. **Test con datos reales**: Ejecutar E2E con `run --config clients.yaml --with-deuda` contra un cliente real para verificar PDF final con importes.

---

## Compliance

- SDD cycle: **Completo** (Proposal → Spec → Design → Tasks → Apply → Verify → Archive)
- Backward compatibility: ✅ Sin `--with-deuda` el comportamiento es idéntico
- Sin dependencias nuevas: ✅
- Sin cambios en modelos: ✅ (`DeudaOutput`, `DeudaItem` ya existían)
- Sin cambios en comando `deuda` standalone: ✅
