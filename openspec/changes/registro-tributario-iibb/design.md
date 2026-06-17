# Design: registro-tributario-iibb

## Architecture Overview

The change extends the existing Registro Tributario pipeline with multi-jurisdiction IIBB support. No new services, no new dependencies. All changes are additive to existing models, parsers, and presenters.

### Data Flow

```
Browser (RUT) → TEMPLATE_REGISTRO (expanded)
    ↓ raw JSON
_parse_registro_output() → dict with iibb_jurisdicciones[]
    ↓
_parse_registro() → RegistroOutput.iibb_jurisdicciones: List[RegistroIIBBJurisdiccion]
    ↓
CLI pipeline → evaluar_iibb() → List[IIBBJurisdiccionResultado]
    ↓
PdfGenerator._build_registro_tables() → PDF table "Jurisdicciones IIBB"
    ↓
Chat API → format_registro() → text response
```

### Module Responsibilities

| Module | Responsibility |
|--------|---------------|
| `models.py` | Define `RegistroIIBBJurisdiccion` and `IIBBJurisdiccionResultado`; extend `RegistroOutput` |
| `browser/workflows/registro.py` | Expanded NL template that asks for per-jurisdiction IIBB data |
| `browser/task.py` | `_parse_registro_output()` recognizes `iibb_jurisdicciones` key |
| `browser/composio.py` | `_parse_registro()` maps dict → `RegistroIIBBJurisdiccion[]` |
| `matching.py` | New `evaluar_iibb()` function; existing `evaluar_rentas_cordoba()` unchanged |
| `memory/brain.py` | May use new IIBB data in context building (optional enhancement) |
| `pdf_generator.py` | New table in `_build_registro_tables()` for IIBB jurisdictions |
| `chat/response_builder.py` | New `format_registro()` function |

## Data Contracts

### RegistroIIBBJurisdiccion (new in models.py)

```python
class RegistroIIBBJurisdiccion(BaseModel):
    provincia: str = ""
    inscripcion: str = ""
    estado: str = ""
    fecha_alta: Optional[date] = None
    fecha_baja: Optional[date] = None
```

### IIBBJurisdiccionResultado (new in models.py or matching.py)

```python
class IIBBJurisdiccionResultado(BaseModel):
    provincia: str = ""
    configurada_en_cliente: bool = False
    detectada_en_ws: bool = False
    detectada_en_rut: bool = False
    inscripcion: str = ""
    estado: str = ""
    match_total: bool = False
```

### RegistroOutput extension

```python
class RegistroOutput(BaseModel):
    domicilios: List[RegistroDomicilio] = Field(default_factory=list)
    jurisdiccion: Optional[str] = None
    actividades: List[RegistroActividad] = Field(default_factory=list)
    impuestos: List[RegistroImpuesto] = Field(default_factory=list)
    puntos_de_venta: List[RegistroPuntoVenta] = Field(default_factory=list)
    iibb_jurisdicciones: List[RegistroIIBBJurisdiccion] = Field(default_factory=list)  # NEW
```

### Browser template JSON extension (in TEMPLATE_REGISTRO)

```json
{
  "domicilios": [...],
  "jurisdiccion": "CABA",
  "actividades": [...],
  "impuestos": [...],
  "puntos_de_venta": [...],
  "iibb_jurisdicciones": [
    {"provincia": "CABA", "inscripcion": "901-123456-7", "estado": "Activo", "fecha_alta": "2020-01-01", "fecha_baja": null}
  ]
}
```

## Matching Algorithm

`evaluar_iibb()` implements a 3-way check per jurisdiction:

1. **Config check**: Is this provincia in the client's `provincias` list?
2. **WS check**: Does the WS API have an IIBB idImpuesto matching this provincia? (Using the id→provincia mapping from rules_engine)
3. **RUT check**: Does the RUT have an inscription in this provincia?

`match_total=True` when ALL THREE are true.
`match_total=False` when any is missing.

The provincia→idImpuesto mapping is:

| Provincia | idImpuesto |
|-----------|-----------|
| CABA | 5902 |
| Buenos Aires | 5905 |
| Córdoba | 5904 |
| Santa Fe | 5906 |
| Acciones/BP | 215 |

## Sequence Diagram

```
CLI pipeline
   │
   ├── browser.run_single() with RegistroTask
   │      │
   │      ├── Composio: ejecuta TEMPLATE_REGISTRO (expanded)
   │      │      └── AI agent navega RUT → extrae JSON con iibb_jurisdicciones[]
   │      │
   │      └── _parse_registro_output() → dict
   │             └── _parse_registro() → RegistroOutput with iibb_jurisdicciones
   │
   ├── evaluar_iibb(provincias, impuestos_ws, iibb_jurisdicciones)
   │      └── List[IIBBJurisdiccionResultado] (one per detected jurisdiction)
   │
   └── pdf_gen.generar(deuda=deuda_output, rentas_matching=...)
          └── _build_registro_tables()
                 └── Table: "Jurisdicciones IIBB" (if non-empty)
```

## Backward Compatibility

- `RegistroOutput` gains one new optional field with default `[]`
- `_parse_registro()` handles missing key gracefully
- `_build_registro_tables()` conditionally shows the new table
- `format_registro()` is a new function, no existing callers to break
- `RegistroIIBBJurisdiccion` and `IIBBJurisdiccionResultado` are new models
- Pipeline without `--with-registro` is completely unaffected

## Risks and Mitigations

| Risk | Mitigation |
|------|-----------|
| RUT may not display structured IIBB data per jurisdiction | Template instructs agent to extract what's visible; empty array fallback |
| AI agent may not follow new template instructions correctly | Template uses explicit JSON example; parser is lenient |
| IIBB id→provincia mapping may be incomplete | Mapping is documented; easy to extend |
| format_registro() may not match chat output expectations | Follows same pattern as existing format functions |
