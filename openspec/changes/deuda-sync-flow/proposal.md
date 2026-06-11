# Proposal: deuda-sync-flow

## Intent

Integrar extracción de deuda real (Composio Browser) dentro del pipeline `run` por CUIT individual, para que página 3 del PDF contenga importes del browser en vez de la columna vacía actual.

## Scope

### In Scope
- Flag `--with-deuda` en `run` que activa pipeline síncrono por CUIT
- `ComposioBrowser.run_single(cuit)` público, invocación sincrónica
- Fix `_parse_extract_output()`: regex `\{[^{}]*\}` no captura JSON anidado
- `PdfGenerator.generar()` acepta `DeudaOutput`, llena columna Importe
- Pipeline por CUIT: WS → Rules → PDF (1-2) → Composio → completar pág 3
- Comando `deuda` standalone intacto

### Out of Scope
- Modelos (`DeudaOutput`, `DeudaItem`), `arca_ws.py`, `rules_engine.py`, templates Composio, email flow — no cambian
- Paralelismo: flujo deliberadamente síncrono, 1 CUIT por vez

## Capabilities

### New
- `deuda-sync-flow`: Pipeline integrado WS → Rules → PDF → Browser → PDF final con importes reales.

### Modified
- `composio-browser-integration`: se agrega `run_single()`. `_parse_extract_output()` fixea JSON anidado.

## Approach

1. Flag `--with-deuda` en comando `run` (`cli.py`)
2. Exponer `ComposioBrowser.run_single(cliente) → DeudaOutput` (wrapper de `_run_single`)
3. Fix `_parse_extract_output()`: brace-matching como primary (ya existe como fallback), eliminar regex simple
4. `PdfGenerator.generar()` acepta `deuda: Optional[DeudaOutput]`, matchea `DeudaItem.concepto` vs `Vencimiento.concepto` (fuzzy), llena columna Importe
5. Pipeline con `--with-deuda`: por CUIT → WS → Rules → PDF → Composio → si hay saldos, actualizar pág 3
6. Si browser falla, importes quedan vacíos (como hoy), pipeline continúa

## Affected Areas

| Area | Impact | Description |
|------|--------|-------------|
| `fiscal_agent/cli.py` | Modified | Flag `--with-deuda`, integración síncrona |
| `fiscal_agent/browser/composio.py` | Modified | `run_single()` público, fix parseo JSON |
| `fiscal_agent/pdf_generator.py` | Modified | Acepta `DeudaOutput`, columna Importe con datos |

## Risks

| Risk | Likelihood | Mitigation |
|------|------------|------------|
| Browser timeout ralentiza pipeline (1 CUIT lento) | Med | Timeout configurable; skip + warning, importes vacíos |
| Fix JSON parse rompe casos existentes | Low | Probar con outputs reales guardados (incluir el del bug) |
| Conceptos browser no matchean calendario | Med | Match fuzzy por keyword; sin match → importe vacío |

## Rollback Plan

Revertir cambios en `cli.py`, `composio.py`, `pdf_generator.py`. Flag `--with-deuda` es opt-in — sin él el flujo `run` es idéntico al actual. Comando `deuda` standalone intacto.

## Dependencies

- `COMPOSIO_API_KEY` en `.env`
- API Composio accesible desde el entorno

## Success Criteria

- [ ] `run --config clients.yaml --with-deuda` genera PDF con importes reales en página 3
- [ ] Sin `--with-deuda`, PDF es idéntico al actual (columna Importe vacía)
- [ ] `_parse_extract_output()` parsea JSON con `"deuda_actual"` anidado correctamente
- [ ] Cada CUIT se procesa secuencialmente (1 sesión Composio por vez)
- [ ] Si browser falla para un CUIT, pipeline continúa con importes vacíos
