# Spec: rentas-cordoba-matching

## Requirements

### REQ-1 — RentasCordobaMatching data model

A new Pydantic model `RentasCordobaMatching` MUST be added to `fiscal_agent/models.py` with the following fields:

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `requiere_integracion` | `bool` | `False` | `True` cuando ambas condiciones se cumplen (Convenio Multilateral + IIBB Córdoba en RUT) |
| `tiene_convenio_multilateral` | `bool` | `False` | `True` si el Rules Engine detectó IIBB en WS API y el cliente tiene 2+ provincias configuradas |
| `tiene_iibb_cordoba` | `Optional[bool]` | `None` | `True` si se encontró "REG. GENERAL IIBB CORDOBA" en `RegistroOutput.impuestos[]`; `False` si no se encontró; `None` si faltan datos de registro |
| `url` | `str` | `"https://www.rentascordoba.gob.ar/"` | Link a Rentas Córdoba para el placeholder del PDF |
| `estado` | `str` | `"no_requerido"` | Estado del matching: `"pendiente"` (requiere integración), `"no_requerido"` (no aplica), `"sin_datos"` (no se pudo evaluar) |
| `observacion` | `str` | `""` | Texto descriptivo del resultado del matching para mostrar en el PDF |

The model MUST NOT modify any existing fields on existing models. It MUST be a standalone `BaseModel` subclass.

### REQ-2 — `evaluar_rentas_cordoba()` pure function

A pure function `evaluar_rentas_cordoba()` MUST be defined in a new module `fiscal_agent/matching.py`.

**Signature:**

```python
def evaluar_rentas_cordoba(
    provincias: Optional[List[str]],
    impuestos_ws: Optional[List[ImpuestoInscripto]],
    registro_impuestos: Optional[List[RegistroImpuesto]],
) -> RentasCordobaMatching:
    """Evaluate whether a taxpayer requires integration with Rentas Córdoba.

    The matching rule is conjunctive — ALL three conditions must hold:
    1. Convenio Multilateral: 2+ provincias configured AND any IIBB
       idImpuesto (5904, 5902, 5905, 5906, 215) present in impuestos_ws.
    2. IIBB Córdoba: a RegistroImpuesto whose impuesto field contains
       "CORDOBA" (case-insensitive substring match) in registro_impuestos.
    3. Both conditions must be True simultaneously.

    Args:
        provincias: Client-configured provinces list (from ClientConfig).
        impuestos_ws: Impuestos from Padrón A5 regimenGeneral (WS API).
        registro_impuestos: Impuestos from RegistroOutput (RUT browser task).

    Returns:
        RentasCordobaMatching with evaluated fields populated.
    """
```

**Matching rule detail:**

1. **Convenio Multilateral check** — MUST evaluate to `True` when:
   - `provincias` has length >= 2, AND
   - `impuestos_ws` contains at least one `ImpuestoInscripto` whose `idImpuesto` is in `{5904, 5902, 5905, 5906, 215}` (the same set as `_IMPUESTO_TO_OBLIGACION` keys that map to `'_iibb'`)

2. **IIBB Córdoba check** — MUST evaluate to `True` when:
   - `registro_impuestos` contains at least one `RegistroImpuesto` where the `impuesto` field (uppercased) contains the substring `"CORDOBA"`

3. **Result:**
   - `requiere_integracion=True` ONLY when both checks are `True`
   - Otherwise `requiere_integracion=False`
   - If `registro_impuestos` is `None` or empty, `tiene_iibb_cordoba` MUST be `None` (indicating missing data) and `requiere_integracion` MUST be `False`

The function MUST be pure: no I/O, no side effects, no database calls, no network access.

### REQ-3 — CLI integration

The CLI pipeline in `fiscal_agent/cli.py` MUST invoke `evaluar_rentas_cordoba()` between the Composio browser task block and the PDF generation call.

The matching result MUST be passed to `pdf_gen.generar()` as a new parameter `rentas_matching`.

Specifically:

1. After line 482 (Composio tasks complete) and before line 486 (`typer.echo('  Generando PDF ...')`), the CLI MUST:
   - Collect `provincias` from `cliente.provincias`
   - Collect `impuestos_ws` from `output.regimenGeneral.impuestos` (where `output` is the `PadronA5Output`)
   - Collect `registro_impuestos` from `deuda_output.registro.impuestos` if `deuda_output` and `deuda_output.registro` are not `None`; otherwise `None`
   - Call `evaluar_rentas_cordoba(provincias, impuestos_ws, registro_impuestos)`
   - Store the result to pass to PDF generation

2. `pdf_gen.generar()` MUST accept the new parameter as `rentas_matching: Optional[RentasCordobaMatching] = None`.

3. The matching MUST NOT block PDF generation — if `deuda_output` is `None` the function still runs with `registro_impuestos=None` and produces a graceful result.

### REQ-4 — PDF placeholder for Rentas Córdoba

The PDF generator MUST show a dedicated placeholder page/section for Rentas Córdoba **only** when `rentas_matching.requiere_integracion` is `True`.

The placeholder MUST contain:

- A heading "Rentas Córdoba — Integración Pendiente"
- Body text explaining that the feature is under development
- A clickable link to `https://www.rentascordoba.gob.ar/`
- The `observacion` text if present

The PDF MUST NOT show the placeholder when `rentas_matching` is `None` or when `rentas_matching.requiere_integracion` is `False`.

Implementation approach:

- New method `_build_rentas_cordoba_placeholder(story, styles, matching: RentasCordobaMatching) -> None` in `PDFGenerator`
- Called from `generar()` after the registro tables section and before `doc.build()`, gated on `rentas_matching and rentas_matching.requiere_integracion`
- SHOULD use a `PageBreak()` before the placeholder content

### REQ-5 — Graceful degradation when RegistroOutput is unavailable

The matching function SHOULD handle the case where `RegistroOutput` (and therefore `registro_impuestos`) is not available:

- When `registro_impuestos` is `None` or an empty list, `tiene_iibb_cordoba` MUST be set to `None` (not `False`)
- `requiere_integracion` MUST be `False` when registry data is missing (can't confirm Córdoba IIBB)
- `estado` MUST be `"sin_datos"` in this case
- The pipeline MUST NOT crash, warn, or produce an error trace — graceful handling is silent
- The PDF generator MUST NOT fail when `rentas_matching` is `None` (backward compatibility)

### NFR-1 — 100% additive

The change MUST NOT modify any existing model field, remove any existing functionality, or alter any existing method signature in a breaking way. Existing models, CLI flags, PDF output for non-matching clients, and email delivery MUST remain identical when the matching result is negative or absent.

### NFR-2 — No external dependencies

The implementation SHOULD use only stdlib and existing project dependencies (Pydantic v2, ReportLab, etc.). No new `pip install` dependencies SHOULD be required.

### NFR-3 — File scope constraint

The change MUST create exactly one new file (`fiscal_agent/matching.py`) and modify at most three existing files:
- `fiscal_agent/models.py` — add `RentasCordobaMatching` model
- `fiscal_agent/cli.py` — add matching invocation + pass result to PDF
- `fiscal_agent/pdf_generator.py` — new parameter + placeholder method

No other files MUST be created or modified.

---

## Scenarios

### Scenario REQ-1: Model instantiation

**Given** a `RentasCordobaMatching` model
**When** instantiated with default values
**Then** `requiere_integracion` MUST be `False`
**And** `tiene_convenio_multilateral` MUST be `False`
**And** `tiene_iibb_cordoba` MUST be `None`
**And** `url` MUST be `"https://www.rentascordoba.gob.ar/"`
**And** `estado` MUST be `"no_requerido"`
**And** `observacion` MUST be `""`

**Given** a `RentasCordobaMatching` model
**When** instantiated with `requiere_integracion=True`, `tiene_convenio_multilateral=True`, `tiene_iibb_cordoba=True`, `estado="pendiente"`
**Then** all fields MUST hold their provided values
**And** `url` MUST remain the default value unless overridden

### Scenario REQ-2: Matching positive — Convenio Multilateral + IIBB Córdoba

**Given** a taxpayer with `provincias=["CABA", "Córdoba"]`
**And** `impuestos_ws` containing `[ImpuestoInscripto(idImpuesto=5904, descripcionImpuesto="REG. GENERAL IIBB CORDOBA")]`
**And** `registro_impuestos` containing `[RegistroImpuesto(impuesto="REG. GENERAL IIBB CORDOBA")]`
**When** `evaluar_rentas_cordoba(provincias, impuestos_ws, registro_impuestos)` is called
**Then** `requiere_integracion` MUST be `True`
**And** `tiene_convenio_multilateral` MUST be `True`
**And** `tiene_iibb_cordoba` MUST be `True`
**And** `estado` MUST be `"pendiente"`

### Scenario REQ-2: Matching negative — only 1 provincia configured

**Given** a taxpayer with `provincias=["Córdoba"]`
**And** `impuestos_ws` containing `[ImpuestoInscripto(idImpuesto=5904)]`
**And** `registro_impuestos` containing `[RegistroImpuesto(impuesto="REG. GENERAL IIBB CORDOBA")]`
**When** `evaluar_rentas_cordoba(provincias, impuestos_ws, registro_impuestos)` is called
**Then** `requiere_integracion` MUST be `False`
**And** `tiene_convenio_multilateral` MUST be `False` (solo 1 provincia)
**And** `tiene_iibb_cordoba` MUST be `True`

### Scenario REQ-2: Matching negative — no IIBB in WS API

**Given** a taxpayer with `provincias=["CABA", "Córdoba", "Santa Fe"]`
**And** `impuestos_ws` containing only `[ImpuestoInscripto(idImpuesto=30)]` (IVA only, no IIBB)
**And** `registro_impuestos` containing `[RegistroImpuesto(impuesto="REG. GENERAL IIBB CORDOBA")]`
**When** `evaluar_rentas_cordoba(provincias, impuestos_ws, registro_impuestos)` is called
**Then** `requiere_integracion` MUST be `False`
**And** `tiene_convenio_multilateral` MUST be `False` (no IIBB idImpuesto in WS API)
**And** `tiene_iibb_cordoba` MUST be `True`

### Scenario REQ-2: Matching negative — no IIBB Córdoba in registro

**Given** a taxpayer with `provincias=["CABA", "Córdoba"]`
**And** `impuestos_ws` containing `[ImpuestoInscripto(idImpuesto=5904)]`
**And** `registro_impuestos` containing `[RegistroImpuesto(impuesto="REG. GENERAL IIBB BUENOS AIRES")]`
**When** `evaluar_rentas_cordoba(provincias, impuestos_ws, registro_impuestos)` is called
**Then** `requiere_integracion` MUST be `False`
**And** `tiene_convenio_multilateral` MUST be `True`
**And** `tiene_iibb_cordoba` MUST be `False`

### Scenario REQ-2: Case-insensitive matching for Córdoba

**Given** `registro_impuestos` containing `[RegistroImpuesto(impuesto="Reg. General Iibb Córdoba")]`
**When** `evaluar_rentas_cordoba` is called
**Then** `tiene_iibb_cordoba` MUST be `True` (substring "CORDOBA" matched case-insensitively)

**Given** `registro_impuestos` containing `[RegistroImpuesto(impuesto="IIBB RG CBA")]`
**When** `evaluar_rentas_cordoba` is called
**Then** `tiene_iibb_cordoba` MUST be `False` (no "CORDOBA" substring)

### Scenario REQ-3: CLI pipeline integration

**Given** a running pipeline with `--with-registro` flag
**When** Composio browser tasks complete successfully
**Then** `evaluar_rentas_cordoba()` MUST be called before PDF generation
**And** the result MUST be passed as `rentas_matching` to `pdf_gen.generar()`

**Given** a running pipeline with `--with-deuda` but WITHOUT `--with-registro`
**When** Composio browser tasks complete
**Then** `evaluar_rentas_cordoba()` MUST still be called with `registro_impuestos=None`
**And** the returned `tiene_iibb_cordoba` MUST be `None`
**And** `requiere_integracion` MUST be `False`
**And** PDF generation MUST proceed normally

### Scenario REQ-4: PDF placeholder shown

**Given** a `RentasCordobaMatching` with `requiere_integracion=True`
**When** `generar()` is called with this matching object
**Then** the PDF MUST contain a page/section with heading "Rentas Córdoba — Integración Pendiente"
**And** MUST contain the link `https://www.rentascordoba.gob.ar/`
**And** MUST contain the `observacion` text

### Scenario REQ-4: PDF placeholder hidden

**Given** a `RentasCordobaMatching` with `requiere_integracion=False`
**When** `generar()` is called with this matching object
**Then** the PDF MUST NOT contain any Rentas Córdoba placeholder content

**Given** `generar()` is called without `rentas_matching` parameter (backward compat)
**When** the method executes
**Then** the PDF MUST be generated normally
**And** MUST NOT contain any Rentas Córdoba placeholder content

### Scenario REQ-5: Graceful when RegistroOutput is None

**Given** `deuda_output=None`
**When** the CLI pipeline reaches the matching step
**Then** `evaluar_rentas_cordoba()` MUST receive `registro_impuestos=None`
**And** MUST return `requiere_integracion=False`, `tiene_iibb_cordoba=None`, `estado="sin_datos"`
**And** no exception MUST be raised
**And** the pipeline MUST continue to PDF generation

### Scenario REQ-5: Graceful when RegistroOutput.impuestos is empty

**Given** `deuda_output.registro.impuestos=[]`
**When** the CLI pipeline reaches the matching step
**Then** `evaluar_rentas_cordoba()` MUST receive `registro_impuestos=[]` (empty list)
**And** MUST return `tiene_iibb_cordoba=None`, `requiere_integracion=False`
**And** `estado` MUST be `"sin_datos"`

### Scenario NFR-1: No existing functionality broken

**Given** an existing client with 0 provincias and no IIBB
**When** the modified pipeline runs
**Then** the PDF output MUST be identical in content (no placeholder, no extra page)
**And** the email delivery MUST behave identically

### Scenario NFR-3: File scope

**Given** the change is implemented
**When** checking modified files
**Then** only `matching.py` (new), `models.py`, `cli.py`, and `pdf_generator.py` MUST be affected

---

## Data Contracts

### `RentasCordobaMatching` (new, in `fiscal_agent/models.py`)

```python
class RentasCordobaMatching(BaseModel):
    """Resultado del matching de integración con Rentas Córdoba.

    Indica si un contribuyente con Convenio Multilateral IIBB y registro
    en IIBB Córdoba requiere integrarse con Rentas Córdoba para consultar
    deuda y vencimientos provinciales.
    """

    requiere_integracion: bool = False
    tiene_convenio_multilateral: bool = False
    tiene_iibb_cordoba: Optional[bool] = None
    url: str = "https://www.rentascordoba.gob.ar/"
    estado: str = "no_requerido"
    observacion: str = ""
```

### `evaluar_rentas_cordoba()` (new, in `fiscal_agent/matching.py`)

```python
def evaluar_rentas_cordoba(
    provincias: Optional[List[str]],
    impuestos_ws: Optional[List[ImpuestoInscripto]],
    registro_impuestos: Optional[List[RegistroImpuesto]],
) -> RentasCordobaMatching:
```

### Modified signatures

```python
# In PDFGenerator (pdf_generator.py)
def generar(
    self,
    nombre: str,
    cuit: str,
    vtos: List[Vencimiento],
    mes: int,
    anio: int,
    observaciones: Optional[List[str]] = None,
    deuda: Optional[DeudaOutput] = None,
    rentas_matching: Optional[RentasCordobaMatching] = None,  # NEW
) -> Path:
```

---

## Implementation Notes

- The IIBB idImpuesto set `{5904, 5902, 5905, 5906, 215}` is already defined in `_IMPUESTO_TO_OBLIGACION` in `rules_engine.py`. The matching function SHOULD duplicate this set (or import it) to avoid coupling to the rules engine.
- The Córdoba substring check `"CORDOBA" in impuesto.upper()` is intentionally simple — it tolerates minor formatting variations like "Córdoba", "CORDOBA", "Cordoba". If false negatives appear in production, this is the first place to adjust.
- The `_build_rentas_cordoba_placeholder()` method SHOULD use `Paragraph` with an inline link (ReportLab supports `<a href="...">` in paragraph text) rather than a separate widget, to keep the implementation consistent with existing PDF styling.
