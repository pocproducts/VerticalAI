# Tasks: rentas-cordoba-matching

## Review Workload Forecast

| Task | File | Est. Lines | Nature |
|------|------|-----------|--------|
| T-1 | `fiscal_agent/models.py` | ~12 | Modified (add new model) |
| T-2 | `fiscal_agent/matching.py` | ~50 | New file |
| T-3 | `fiscal_agent/cli.py` | ~15 | Modified (add matching call) |
| T-4 | `fiscal_agent/pdf_generator.py` | ~55 | Modified (param + placeholder) |
| **Total** | | **~132** | |

**400-line budget risk: Low** — 132 lines is well within the single-PR budget. No split needed.

---

## Tasks

### T-1: Add `RentasCordobaMatching` model to `fiscal_agent/models.py`

**File:** `fiscal_agent/models.py`
**Insertion point:** After class `RegistroPuntoVenta` (line 267), before `RegistroOutput` (line 269).

**T-1.1 — Define the model class**

Add a new standalone `BaseModel` subclass with these fields:

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `requiere_integracion` | `bool` | `False` | `True` when both conditions hold (Convenio Multilateral + IIBB Córdoba in RUT) |
| `tiene_convenio_multilateral` | `bool` | `False` | `True` if Rules Engine detected IIBB in WS API AND client has 2+ provincias |
| `tiene_iibb_cordoba` | `Optional[bool]` | `None` | `True` if "REG. GENERAL IIBB CORDOBA" found in `RegistroOutput.impuestos[]`; `None` if data missing |
| `url` | `str` | `"https://www.rentascordoba.gob.ar/"` | Link for PDF placeholder |
| `estado` | `str` | `"no_requerido"` | One of: `"pendiente"`, `"no_requerido"`, `"sin_datos"` |
| `observacion` | `str` | `""` | Texto descriptivo del resultado del matching |

**Verification criteria (manual):**
1. Open a Python shell and run:
   ```python
   from fiscal_agent.models import RentasCordobaMatching
   m = RentasCordobaMatching()
   assert m.requiere_integracion is False
   assert m.tiene_iibb_cordoba is None
   assert m.estado == "no_requerido"
   assert m.url == "https://www.rentascordoba.gob.ar/"
   assert m.observacion == ""
   print("✅ T-1: Defaults correct")
   ```
2. Verify custom instantiation:
   ```python
   m = RentasCordobaMatching(
       requiere_integracion=True,
       tiene_convenio_multilateral=True,
       tiene_iibb_cordoba=True,
       estado="pendiente",
       observacion="Test",
   )
   assert m.requiere_integracion is True
   assert m.estado == "pendiente"
   print("✅ T-1: Custom fields hold")
   ```
3. Confirm no existing model was modified (field types, defaults, and class hierarchy are untouched).

---

### T-2: Create `fiscal_agent/matching.py` module

**File:** `fiscal_agent/matching.py` (new)

**T-2.1 — Define IIBB ID set constant**

Duplicate the IIBB `idImpuesto` set from `rules_engine._IMPUESTO_TO_OBLIGACION` (kept as a private module-level constant to avoid coupling):

```python
_IIBB_IDS: set[int] = {5904, 5902, 5905, 5906, 215}
```

**T-2.2 — Implement `evaluar_rentas_cordoba()` pure function**

Signature:
```python
def evaluar_rentas_cordoba(
    provincias: Optional[list[str]],
    impuestos_ws: Optional[list[ImpuestoInscripto]],
    registro_impuestos: Optional[list[RegistroImpuesto]],
) -> RentasCordobaMatching:
```

Logic:
1. **Convenio Multilateral check**: `True` when `len(provincias) >= 2` AND any `impuesto_ws[].idImpuesto` is in `_IIBB_IDS`.
2. **IIBB Córdoba check**: `True` when any `registro_impuestos[].impuesto.upper()` contains `"CORDOBA"`. `None` when `registro_impuestos` is `None` or empty.
3. **Conjunctive rule**: `requiere_integracion = tiene_convenio AND tiene_iibb_cordoba is True`.
4. **Estado mapping**: `"pendiente"` when both true, `"sin_datos"` when `tiene_iibb_cordoba is None`, `"no_requerido"` otherwise.
5. Pure function — no I/O, no side effects, no mutation of inputs.

**Verification criteria (manual):**
Run the following in a Python shell:

```python
from fiscal_agent.models import ImpuestoInscripto, RegistroImpuesto
from fiscal_agent.matching import evaluar_rentas_cordoba

# Positive match
r = evaluar_rentas_cordoba(
    ["CABA", "Córdoba"],
    [ImpuestoInscripto(idImpuesto=5904)],
    [RegistroImpuesto(impuesto="REG. GENERAL IIBB CORDOBA")],
)
assert r.requiere_integracion is True, f"Expected True, got {r.requiere_integracion}"
assert r.tiene_convenio_multilateral is True
assert r.tiene_iibb_cordoba is True
assert r.estado == "pendiente"
print("✅ Positive match")

# Single provincia → no convenio
r = evaluar_rentas_cordoba(
    ["Córdoba"],
    [ImpuestoInscripto(idImpuesto=5904)],
    [RegistroImpuesto(impuesto="REG. GENERAL IIBB CORDOBA")],
)
assert r.requiere_integracion is False
assert r.tiene_convenio_multilateral is False
assert r.tiene_iibb_cordoba is True
print("✅ Single provincia → no matching")

# No IIBB in WS API
r = evaluar_rentas_cordoba(
    ["CABA", "Córdoba"],
    [ImpuestoInscripto(idImpuesto=30)],  # IVA only
    [RegistroImpuesto(impuesto="REG. GENERAL IIBB CORDOBA")],
)
assert r.requiere_integracion is False
assert r.tiene_convenio_multilateral is False
assert r.tiene_iibb_cordoba is True
print("✅ No IIBB in WS → no matching")

# No Córdoba in RUT
r = evaluar_rentas_cordoba(
    ["CABA", "Córdoba"],
    [ImpuestoInscripto(idImpuesto=5904)],
    [RegistroImpuesto(impuesto="REG. GENERAL IIBB BUENOS AIRES")],
)
assert r.requiere_integracion is False
assert r.tiene_convenio_multilateral is True
assert r.tiene_iibb_cordoba is False
print("✅ No Córdoba in RUT → no matching")

# Case-insensitive match
r = evaluar_rentas_cordoba(
    ["CABA", "Córdoba"],
    [ImpuestoInscripto(idImpuesto=5904)],
    [RegistroImpuesto(impuesto="Reg. General Iibb Córdoba")],
)
assert r.tiene_iibb_cordoba is True
print("✅ Case-insensitive match works")

# Graceful: None registro
r = evaluar_rentas_cordoba(
    ["CABA", "Córdoba"],
    [ImpuestoInscripto(idImpuesto=5904)],
    None,
)
assert r.requiere_integracion is False
assert r.tiene_iibb_cordoba is None
assert r.estado == "sin_datos"
print("✅ Graceful None registro")

# Graceful: empty registro
r = evaluar_rentas_cordoba(
    ["CABA", "Córdoba"],
    [ImpuestoInscripto(idImpuesto=5904)],
    [],
)
assert r.requiere_integracion is False
assert r.tiene_iibb_cordoba is None
assert r.estado == "sin_datos"
print("✅ Graceful empty registro")

# None provincias
r = evaluar_rentas_cordoba(None, None, None)
assert r.requiere_integracion is False
assert r.tiene_convenio_multilateral is False
assert r.tiene_iibb_cordoba is None
assert r.estado == "sin_datos"
print("✅ None provincias handled")

print("\n🎉 T-2: All matching scenarios pass")
```

---

### T-3: Integrate matching in CLI pipeline (`fiscal_agent/cli.py`)

**File:** `fiscal_agent/cli.py`

**T-3.1 — Add matching call after Composio block**

Insert after line 482 (`logger.info(...)`) and before line 484 (`# ── PDF`), **inside** the `if usa_browser and browser is not None` block but after the Composio task processing closes:

```python
# ── Rentas Córdoba Matching ─────────────────────────────────────────
rentas_matching = None
if deuda_output is not None:
    from fiscal_agent.matching import evaluar_rentas_cordoba

    rentas_matching = evaluar_rentas_cordoba(
        provincias=cliente.provincias,
        impuestos_ws=output.regimenGeneral.impuestos if output.regimenGeneral else None,
        registro_impuestos=deuda_output.registro.impuestos if deuda_output.registro else None,
    )
```

Note: `rentas_matching` must be initialized (`= None`) **before** the `if usa_browser` block so it's available in scope when `usa_browser=False` (falls through as `None`).

**T-3.2 — Pass matching result to `pdf_gen.generar()`**

Add `rentas_matching=rentas_matching` to the `pdf_gen.generar()` call at line 486-494:

```python
pdf_path = pdf_gen.generar(
    cliente.nombre,
    cliente.cuit,
    calendario.vencimientos,
    mes,
    anio,
    observaciones=calendario.observaciones or None,
    deuda=deuda_output,
    rentas_matching=rentas_matching,  # NEW
)
```

**Verification criteria (manual):**
1. Run `python -m fiscal_agent run --with-registro --with-deuda --with-facilidades` for a client with 2+ provincias + IIBB Córdoba — confirm pipeline completes without error.
2. Run without `--with-registro` — confirm no crash, PDF generated normally.
3. Run for a client without IIBB Córdoba — confirm no Rentas Córdoba page in PDF.
4. Check that `typer.echo('  Generando PDF ...')` still fires after matching (no echo leak from matching).

---

### T-4: Add PDF placeholder for Rentas Córdoba (`fiscal_agent/pdf_generator.py`)

**File:** `fiscal_agent/pdf_generator.py`

**T-4.1 — Add import for `RentasCordobaMatching`**

Add `RentasCordobaMatching` to the existing `from fiscal_agent.models import (...)` block (lines 36-51):

```python
from fiscal_agent.models import (
    ...
    RegistroPuntoVenta,
    RentasCordobaMatching,  # NEW — add after RegistroPuntoVenta
    Vencimiento,
    ...
)
```

**T-4.2 — Add `rentas_matching` parameter to `generar()`**

Add the parameter after `deuda` in the signature (line 99):

```python
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

Also update the docstring's `Args:` section to document the new parameter.

**T-4.3 — Add story injection in `generar()` body**

Insert after the registro tables block (after line 171, before `# ── Build` at line 173):

```python
# ═══════════════════════════════════════════════════════════════════════
# PAGE 7 — RENTAS CÓRDOBA PLACEHOLDER
# ═══════════════════════════════════════════════════════════════════════
if rentas_matching and rentas_matching.requiere_integracion:
    story.append(PageBreak())
    self._build_rentas_cordoba_placeholder(story, styles, rentas_matching)
```

**T-4.4 — Implement `_build_rentas_cordoba_placeholder()` method**

Add a new method to the `PdfGenerator` class (after `_build_registro_tables`):

```python
def _build_rentas_cordoba_placeholder(
    self,
    story: list,
    styles: object,
    matching: RentasCordobaMatching,
) -> None:
    """Page 7: Placeholder for Rentas Córdoba integration (en desarrollo)."""
```

Content:
- **Title**: Paragraph with `"Rentas Córdoba — Integración Pendiente"` using `ParagraphStyle` (fontSize=18, bold, COLOR_PRIMARY, centered).
- **Body text**: Paragraph explaining integration is under development, inviting user to visit the official portal.
- **Clickable link**: Paragraph with `<a href="{matching.url}">{matching.url}</a>` in blue (#0066cc, fontSize=13, centered).
- **Observation**: If `matching.observacion` is non-empty, render it in italic gray (fontSize=9, Helvetica-Oblique, #666666).

Use `PageBreak()` before the content (already added in T-4.3 story injection).

**Verification criteria (manual):**
1. Run pipeline for a matching client (2+ provincias + IIBB Córdoba) — open generated PDF, confirm Page 7 exists with:
   - Heading "Rentas Córdoba — Integración Pendiente"
   - Body text explaining it's in development
   - Clickable link to `https://www.rentascordoba.gob.ar/`
2. Run pipeline for a non-matching client — confirm PDF has NO Rentas Córdoba page (page count unchanged).
3. Run pipeline without `--with-registro` — confirm PDF generated normally, no placeholder.
4. Import `PdfGenerator` and call `generar()` without `rentas_matching` kwarg — confirm no TypeError (backward compat).

---

## Dependencies

```
T-1 (models.py) ──────► T-2 (matching.py) ──┬──► T-3 (cli.py)
                                             └──► T-4 (pdf_generator.py)
```

- **T-1** must complete before **T-2** (T-2 imports `RentasCordobaMatching` from models).
- **T-2** must complete before **T-3** and **T-4** (both depend on `evaluar_rentas_cordoba` and/or `RentasCordobaMatching`).
- **T-3** and **T-4** are independent of each other and can be implemented in parallel after T-2.
- All tasks are 100% additive — no existing code is modified in a breaking way.

---

## Total Estimated Lines: ~132
