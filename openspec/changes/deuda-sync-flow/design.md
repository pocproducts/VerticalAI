# Design: Pipeline deuda-sync-flow

## Technical Approach

Pipeline síncrono opt-in via `--with-deuda` en `run`. Por cada CUIT: WS ARCA → Rules Engine → Composio Browser (1 sesión) → PDF final con importes en página 3. `DeudaOutput` se matchea contra `Vencimiento[]` vía fuzzy keyword para llenar la columna Importe. Si browser falla → importes vacíos, pipeline continúa. Sin cambios en modelos, `arca_ws.py`, `rules_engine.py`, ni templates Composio.

## Architecture Decisions

### Flag: `--with-deuda` en comando `run`

| Opción | Tradeoff | Decisión |
|--------|----------|----------|
| Flag `--with-deuda` en `run` | Opt-in, no rompe flujo actual, backward-compatible | ✅ Elegido |
| Comando separado | Duplica lógica de pipeline cliente por cliente | ❌ Descartado |

### `run_single()` público síncrono

| Opción | Tradeoff | Decisión |
|--------|----------|----------|
| `run_single()` sync vía `asyncio.run()` wrapper | Control secuencial por CUIT, consistente con flujo sync de `run` | ✅ Elegido |
| Reusar `run_all()` async | Requiere reestructurar `run` para async, cambia firma del comando | ❌ Descartado |

### Momento de generación del PDF

| Opción | Tradeoff | Decisión |
|--------|----------|----------|
| Generar PDF después de browser (1 sola vez) | PDF final directo, sin regeneración | ✅ Elegido |
| Generar PDF antes + sobrescribir | Muestra progreso, pero duplica generación | ❌ Descartado |

### Matching concepto `DeudaItem` ↔ `Vencimiento`

| Opción | Tradeoff | Decisión |
|--------|----------|----------|
| Fuzzy keyword search | Robusto ante diferencias textuales (ej: "IVA Mensual" vs "IVA - Mensual") | ✅ Elegido |
| Exact match | Frágil, textos raramente idénticos entre browser y calendario | ❌ Descartado |
| LLM match | Overkill, agrega latencia y costo, sin ventaja real | ❌ Descartado |

### Fix `_parse_extract_output()`: JSON anidado

| Opción | Tradeoff | Decisión |
|--------|----------|----------|
| Brace-matching como primary, eliminar regex simple | Cubre JSON anidado (`saldos: [{...}]`), corrige bug reportado | ✅ Elegido |
| Mantener regex `\{[^{}]*\}` como fallback | Sigue fallando con estructuras anidadas | ❌ Descartado |

### Error handling: browser fail

| Opción | Tradeoff | Decisión |
|--------|----------|----------|
| Skip cliente + continuar pipeline | Importes vacíos, pipeline no se detiene | ✅ Elegido |
| Abort pipeline completo | Pierde PDFs del resto de clientes | ❌ Descartado |

## Data Flow

```
Por CUIT (loop secuencial en run()):

  WS ARCA ──→ PadronA5Output ──→ Rules Engine ──→ Vencimiento[]
                                                      │
                                                      ▼
                                              ¿--with-deuda?
                                              ┌───┴───┐
                                             Sí       No
                                              │        │
                                    ComposioBrowser   │
                                      run_single()    │
                                      (sync)          │
                                              │        │
                                    DeudaOutput       │
                                    ─ o error ─       │
                                              │        │
                                              ▼        ▼
                                      PdfGenerator.generar()
                                      (deuda=... | None)
                                              │
                                              ▼
                                           PDF final
                                     (3 páginas, columna
                                      Importe con datos
                                      o vacía)
```

## File Changes

| File | Acción | Descripción |
|------|--------|-------------|
| `fiscal_agent/cli.py` | Modify | Flag `--with-deuda` (línea 274+), integración síncrona del browser dentro del loop de clientes |
| `fiscal_agent/browser/composio.py` | Modify | Método público `run_single()` sync wrapper; fix `_parse_extract_output()` (sacar regex, brace-matching primary) |
| `fiscal_agent/pdf_generator.py` | Modify | `generar()` acepta `deuda: Optional[DeudaOutput]`, matcheo fuzzy y llenado de columna Importe en página 3 |

## Interfaces / Contracts

```python
# composio.py — nuevo método público
class ComposioBrowser:
    def run_single(self, cliente: ClientConfig) -> DeudaOutput:
        """Sync wrapper. Crea sesión, ejecuta pipeline login→switch→extract,
        parsea JSON, retorna DeudaOutput. Una sola task Composio."""
        return asyncio.run(self._run_single(cliente))

# pdf_generator.py — firma modificada
class PdfGenerator:
    def generar(
        self,
        nombre: str,
        cuit: str,
        vtos: List[Vencimiento],
        mes: int,
        anio: int,
        observaciones: Optional[List[str]] = None,
        deuda: Optional[DeudaOutput] = None,          # ← NUEVO
    ) -> Path:
```

### Matching conceptos (dentro de `_build_detalle`)

```python
def _match_importe(
    concepto: str,
    saldos: List[DeudaItem],
) -> Optional[float]:
    """Fuzzy keyword match: busca palabras del concepto del vencimiento
    dentro del concepto del DeudaItem. Retorna el primer match."""
    keywords = set(re.findall(r'\w+', concepto.lower()))
    for item in saldos:
        item_words = set(re.findall(r'\w+', item.concepto.lower()))
        if keywords & item_words:  # intersección no vacía
            return item.importe
    return None
```

## Testing Strategy

| Capa | Qué testear | Approach |
|------|-------------|----------|
| Unit | `_parse_extract_output()` con nested JSON | Fixtures con output real de Composio (incluir el caso del bug: `saldos` con objetos anidados) |
| Unit | Matching conceptos: `DeudaItem.concepto` vs `Vencimiento.concepto` | Tabla de casos paramétricos: match exacto, fuzzy, sin match, múltiples matches |
| Unit | `run_single()` error wrapping | Mock `_run_single` → TimeoutError, ComposioError → verificar que retorna `DeudaOutput` con `error` poblado |
| Integration | Flag `--with-deuda` en `run` | Typer CliRunner: verificar que flag activa la rama browser, sin flag el flujo es idéntico al actual |
| E2E | Pipeline completo con browser real | Manual: `run --config clients.yaml --with-deuda`, verificar PDF con importes en página 3 |

## Migration / Rollout

No migration required. Flag `--with-deuda` es opt-in — sin él el comportamiento de `run` es idéntico al actual. Rollback: revertir cambios en `cli.py`, `composio.py`, `pdf_generator.py`.

## Open Questions

None.
