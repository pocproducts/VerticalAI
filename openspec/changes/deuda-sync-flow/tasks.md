# Tasks: deuda-sync-flow

## Review Workload Forecast

| Field | Value |
|-------|-------|
| Estimated changed lines | ~135-150 |
| 400-line budget risk | Low |
| Chained PRs recommended | No |
| Suggested split | single PR |
| Delivery strategy | single-pr-default |
| Chain strategy | size-exception |

Decision needed before apply: No
Chained PRs recommended: No
Chain strategy: size-exception
400-line budget risk: Low

### Suggested Work Units

| Unit | Goal | Likely PR | Notes |
|------|------|-----------|-------|
| 1 | Full deuda-sync-flow (3 files) | single PR | single-pr-default |

---

## Phase 1: Foundation — PDF generator + parse fix

- [ ] 1.1 **`pdf_generator.py`**: Agregar `from fiscal_agent.models import DeudaOutput, DeudaItem` — importar tipos que ya existen (sin cambios en modelos)
- [ ] 1.2 **`pdf_generator.py`**: Modificar firma `generar()` — agregar `deuda: Optional[DeudaOutput] = None` como último parámetro opcional; pasar `deuda` a `_build_detalle()`
- [ ] 1.3 **`pdf_generator.py`**: Modificar `_build_detalle()` — aceptar `deuda: Optional[DeudaOutput] = None`, inyectar columna Importe con datos cuando hay `DeudaItem[]` en `deuda.saldos`
- [ ] 1.4 **`pdf_generator.py`**: Implementar helper `_match_importe(concepto, saldos) -> Optional[float]` — fuzzy keyword match (intersección de tokens entre `Vencimiento.concepto` y `DeudaItem.concepto`)
- [ ] 1.5 **`pdf_generator.py`**: Formatear importe como moneda argentina (`$ 75.000,25`) en la celda Importe (columna índice 1)
- [ ] 1.6 **`composio.py`**: Eliminar paso 2 (regex `\{[^{}]*\}`) en `_parse_extract_output()` — brace-matching (paso 3 actual) queda como único fallback tras `json.loads()` directo

## Phase 2: Core — CLI flag + run_single sync wrapper

- [ ] 2.1 **`composio.py`**: Agregar método público `run_single(self, cliente: ClientConfig) -> DeudaOutput` — wrapper síncrono que ejecuta `asyncio.run(self._run_single(cliente))`, captura toda excepción y siempre retorna `DeudaOutput` (nunca propaga error al caller)
- [ ] 2.2 **`cli.py`**: Agregar flag `--with-deuda` / `-d` como `typer.Option(bool, default=False)` en comando `run`
- [ ] 2.3 **`cli.py`**: Validar `COMPOSIO_API_KEY` temprano si `--with-deuda` está activo — mostrar error descriptivo y `raise typer.Exit(1)` si falta
- [ ] 2.4 **`cli.py`**: Importar `ComposioBrowser` condicionalmente (`from fiscal_agent.browser import ComposioBrowser`) solo dentro del bloque `if with_deuda` (import diferido, no al tope del módulo)
- [ ] 2.5 **`cli.py`**: En el loop de clientes (entre Rules Engine y PDF), insertar paso Composio si `--with-deuda`: instanciar `ComposioBrowser`, llamar `run_single(cliente)`, pasar `DeudaOutput` a `PdfGenerator.generar()`, loggear resultado por CUIT
- [ ] 2.6 **`cli.py`**: Si browser falla para un CUIT (`DeudaOutput.error != None`), pipeline continúa — importes vacíos, sin interrupción

## Phase 3: Testing

- [ ] 3.1 Test `_parse_extract_output()`: fixture con JSON anidado (`saldos: [{...}]`) → verifica que brace-matching captura estructura completa
- [ ] 3.2 Test `_parse_extract_output()`: fixture con JSON plano → sin regresión
- [ ] 3.3 Test `_parse_extract_output()`: data vacío/None → retorna dict default
- [ ] 3.4 Test matching conceptos: tabla paramétrica (exact match, substring/fuzzy match, sin match, múltiples matches)
- [ ] 3.5 Test `run_single()` error wrapping: mock `_run_single` → `TimeoutError`, `ComposioError`, excepción genérica → verificar que retorna `DeudaOutput` con `error` poblado
- [ ] 3.6 Test CLI flag: Typer `CliRunner` con `--with-deuda` vs sin flag → verificar que el comportamiento difiere solo cuando el flag está presente

## Implementation Order

1. **Phase 1 primero** — `pdf_generator.py` y `_parse_extract_output` no dependen de nada nuevo. Se pueden testear en aislamiento.
2. **Phase 2 después** — `run_single()` y el flag `--with-deuda` dependen de los tipos y contratos de Phase 1.
3. **Phase 3 al final** — tests unitarios e integración sobre código ya implementado.

Sin dependencias externas nuevas, sin cambios en `pyproject.toml`, sin migraciones.
