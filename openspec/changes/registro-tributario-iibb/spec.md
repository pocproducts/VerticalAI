# Spec: registro-tributario-iibb

## Requirements

### REQ-1 — RegistroIIBBJurisdiccion data model

A new Pydantic model `RegistroIIBBJurisdiccion` MUST be added to `fiscal_agent/models.py` with the following fields:

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `provincia` | `str` | `""` | Provincia donde el contribuyente está inscripto en IIBB |
| `inscripcion` | `str` | `""` | Número de inscripción IIBB en esa provincia |
| `estado` | `str` | `""` | Estado de la inscripción (Activo, Suspendido, Baja, etc.) |
| `fecha_alta` | `Optional[date]` | `None` | Fecha de alta en IIBB de esa provincia |
| `fecha_baja` | `Optional[date]` | `None` | Fecha de baja (si aplica) |

The model MUST be a standalone `BaseModel` subclass.

`RegistroOutput` MUST gain a new field:

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `iibb_jurisdicciones` | `List[RegistroIIBBJurisdiccion]` | `[]` | Lista de jurisdicciones IIBB detectadas en el RUT |

The existing fields (`domicilios`, `jurisdiccion`, `actividades`, `impuestos`, `puntos_de_venta`) MUST remain unchanged. Backward compatibility MUST be preserved — code that accesses `registro.domicilios` etc. continues to work without modification.

### REQ-2 — Browser template expansion

`TEMPLATE_REGISTRO` in `fiscal_agent/browser/workflows/registro.py` MUST be expanded to explicitly ask the AI agent to extract ALL IIBB jurisdictions with their details.

The JSON format in the template MUST include a new section:

```json
"iibb_jurisdicciones": [
  {"provincia": "CABA", "inscripcion": "901-123456-7", "estado": "Activo", "fecha_alta": "2020-01-01", "fecha_baja": null}
]
```

The template MUST instruct the AI agent to:
1. Look for the IIBB section in the RUT page
2. Extract EACH jurisdiction where the taxpayer is registered
3. Include inscription number, status, and dates where visible
4. If no IIBB data is found, return an empty array `[]`

### REQ-3 — Parser expansion

`_parse_registro_output()` in `fiscal_agent/browser/task.py` MUST recognize the new key `iibb_jurisdicciones` in the parsed dict and include it in the output.

`_parse_registro()` in `fiscal_agent/browser/composio.py` MUST convert the raw `iibb_jurisdicciones` list to a list of `RegistroIIBBJurisdiccion` model instances.

The parser MUST be lenient — if the key is missing or malformed, it defaults to an empty list without crashing.

### REQ-4 — Multi-jurisdicción IIBB matching

A new function `evaluar_iibb()` MUST be created in `fiscal_agent/matching.py` that evaluates ALL IIBB jurisdictions (not just Córdoba).

**Signature:**
```python
def evaluar_iibb(
    provincias_configuradas: Optional[List[str]],
    impuestos_ws: Optional[List[ImpuestoInscripto]],
    iibb_jurisdicciones: Optional[List[RegistroIIBBJurisdiccion]],
) -> List[IIBBJurisdiccionResultado]:
```

Where `IIBBJurisdiccionResultado` is a new model with:

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `provincia` | `str` | `""` | Provincia evaluada |
| `configurada_en_cliente` | `bool` | `False` | True si el cliente tiene esta provincia en su config |
| `detectada_en_ws` | `bool` | `False` | True si el WS API tiene IIBB para esta provincia |
| `detectada_en_rut` | `bool` | `False` | True si el RUT muestra inscripción IIBB en esta provincia |
| `inscripcion` | `str` | `""` | Número de inscripción desde el RUT (si disponible) |
| `estado` | `str` | `""` | Estado de la inscripción |
| `match_total` | `bool` | `False` | True cuando coincide en WS + RUT + config |

The existing `evaluar_rentas_cordoba()` MUST continue to work (backward compat). The new function SHOULD be used alongside it.

### REQ-5 — PDF IIBB jurisdiction table

`_build_registro_tables()` in `fiscal_agent/pdf_generator.py` MUST display a new table section "Jurisdicciones IIBB" after the impuestos table (when `iibb_jurisdicciones` is non-empty).

The table MUST have columns: Provincia, Inscripción, Estado, Match.

- "Match" column shows ✅ when `match_total=True`, ⚠️ when partial match, ❌ when no match
- If the IIBB jurisdiction data is enriched via the matching function, use it
- Fallback: if only raw RUT data is available (no matching result), show "—" for Match

When `iibb_jurisdicciones` is empty, the section MUST NOT be displayed.

### REQ-6 — format_registro() implementation

A function `format_registro()` MUST be implemented in `fiscal_agent/chat/response_builder.py`.

**Signature:**
```python
def format_registro(registro: Optional[RegistroOutput], cuit: str) -> str:
```

The function MUST return a human-readable text block for the chat API with:
- CUIT header
- Jurisdicción (if present)
- Domicilios list (tipo: provincia, localidad, dirección)
- Actividades list
- Impuestos list
- IIBB Jurisdicciones list (if present)

Format: plain text with line breaks, no markdown (for SMS/chat compatibility).

### NFR-1 — 100% additive

No existing field, method, or signature MUST be modified in a breaking way. All additions MUST be optional with safe defaults.

### NFR-2 — No new external dependencies

Only stdlib and existing project dependencies SHALL be used.

## Scenarios

### Scenario REQ-1: Model instantiation

**Given** a `RegistroIIBBJurisdiccion` model
**When** instantiated with default values
**Then** `provincia` MUST be `""`
**And** `inscripcion` MUST be `""`
**And** `estado` MUST be `""`
**And** `fecha_alta` MUST be `None`
**And** `fecha_baja` MUST be `None`

**Given** a `RegistroOutput` model with default values
**When** instantiated
**Then** `iibb_jurisdicciones` MUST be `[]`

### Scenario REQ-3: Parser handles new key

**Given** raw data dict with `iibb_jurisdicciones` key
**When** `_parse_registro_output()` processes it
**Then** the output dict contains the key

**Given** raw data dict WITHOUT `iibb_jurisdicciones` key
**When** `_parse_registro()` processes it
**Then** `RegistroOutput.iibb_jurisdicciones` is `[]`
**And** no exception is raised

### Scenario REQ-4: Multi-provincia matching

**Given** a taxpayer with `provincias_configuradas=["CABA", "Córdoba", "Santa Fe"]`
**And** `impuestos_ws` containing IIBB ids for all three
**And** `iibb_jurisdicciones` with inscriptions in all three
**When** `evaluar_iibb()` is called
**Then** the result contains 3 entries
**And** each entry has `match_total=True`

### Scenario REQ-5: PDF shows IIBB table

**Given** a `RegistroOutput` with `iibb_jurisdicciones` containing 2 entries
**When** `_build_registro_tables()` is called
**Then** the PDF story contains a "Jurisdicciones IIBB" section
**And** 2 rows with provincia, inscripción, estado, match

**Given** a `RegistroOutput` with empty `iibb_jurisdicciones`
**When** `_build_registro_tables()` is called
**Then** NO "Jurisdicciones IIBB" section appears

### Scenario REQ-6: format_registro() output

**Given** a `RegistroOutput` with domicilios, actividades, impuestos
**When** `format_registro(registro, "20324837796")` is called
**Then** the output contains "CUIT 20324837796"
**And** contains the domicilio data
**And** contains the actividad data
**And** contains the impuesto data

**Given** `registro=None`
**When** `format_registro(None, "20324837796")` is called
**Then** output contains "No se encontró registro tributario"
