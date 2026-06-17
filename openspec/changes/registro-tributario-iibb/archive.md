# Archive: registro-tributario-iibb

## Summary
Expansión multi-jurisdicción de IIBB para el Registro Tributario — extracción, parsing, matching y visualización en PDF de todas las jurisdicciones IIBB detectadas en el RUT de ARCA.

## Changes Made

### Models (fiscal_agent/models.py)
- `RegistroIIBBJurisdiccion`: new model with provincia, inscripcion, estado, fecha_alta, fecha_baja
- `IIBBJurisdiccionResultado`: new model with 3-way match result (config × WS × RUT)
- `RegistroOutput.iibb_jurisdicciones`: new field (default `[]`)

### Browser Template (fiscal_agent/browser/workflows/registro.py)
- Expanded TEMPLATE_REGISTRO to ask for IIBB jurisdictions per province
- Added JSON example with iibb_jurisdicciones array

### Parsing (fiscal_agent/browser/task.py + composio.py)
- `_parse_registro_output()` recognizes `iibb_jurisdicciones` key
- `_parse_registro()` converts raw data to `RegistroIIBBJurisdiccion[]` with date parsing
- Lenient fallback: missing/malformed key → empty list

### Matching (fiscal_agent/matching.py)
- New `_IIBB_ID_TO_PROVINCIA` mapping (5902→CABA, 5904→Córdoba, 5905→BA, 5906→Santa Fe, 215→Acciones)
- New `evaluar_iibb()` function: 3-way check for each detected jurisdiction
- Existing `evaluar_rentas_cordoba()` unchanged (backward compatible)

### PDF (fiscal_agent/pdf_generator.py)
- New "Jurisdicciones IIBB" table in page 6 (after Puntos de Venta)
- Columns: Provincia, Inscripción, Estado, Match
- Only shown when `iibb_jurisdicciones` is non-empty

### Chat API (fiscal_agent/chat/response_builder.py)
- New `format_registro()` function — plain text for chat responses
- Covers: jurisdicción, domicilios, actividades, impuestos, IIBB jurisdicciones

## Stats
- Total changed lines: ~180
- Files modified: 7
- New models: 2
- New functions: 2 (evaluar_iibb, format_registro)
- Breaking changes: 0 (100% additive)

## Backward Compatibility
All changes are additive. Pipeline without `--with-registro` is unaffected.
Existing `evaluar_rentas_cordoba()` continues to work.
