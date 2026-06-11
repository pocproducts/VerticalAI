# Design: Rentas Córdoba Matching

A pure-function matching engine that detects when a Convenio Multilateral IIBB taxpayer also holds IIBB Córdoba registration, and a PDF placeholder that surfaces this pending integration to the contador. Zero external dependencies, fully additive, no existing code touched unless importing a new model.

## Quick Path

1. Create `fiscal_agent/matching.py` with `evaluar_rentas_cordoba()` — pure function, no I/O, no side effects.
2. Add `RentasCordobaMatching` model to `fiscal_agent/models.py` (standalone `BaseModel`, no existing fields modified).
3. Wire matching into `fiscal_agent/cli.py` between Composio browser tasks (post-line-482) and PDF generation (pre-line-485).
4. Add optional `rentas_matching` parameter to `PDFGenerator.generar()` and a new `_build_rentas_cordoba_placeholder()` method.
5. Verify manually: run pipeline with `--with-registro` against a client with 2+ provincias + IIBB Córdoba; confirm PDF contains the placeholder page. Same client without `--with-registro` should not crash and produce no placeholder.

---

## Architecture Decisions

### New `matching.py` module vs inline in `cli.py`

**Decision**: New module `fiscal_agent/matching.py`.

| Criterion | New module | Inline in cli.py |
|-----------|------------|-------------------|
| Testability | Pure function importable by any test harness | Coupled to CLI state, harder to isolate |
| Reusability | Other entry points (API, scheduled tasks) can import it | Must duplicate or refactor later |
| Single Responsibility | `cli.py` orchestrates; `matching.py` evaluates | `cli.py` grows more responsibilities |
| Diff clarity | One new file + 3 modified = clear scope | One file changed, harder to review |

The matching logic is a business rule that will likely grow (more provinces, more conditions). Keeping it in its own module is the cheapest way to keep it isolated.

### Duplicate the IIBB id set vs import from `rules_engine`

**Decision**: **Duplicate** the `{5904, 5902, 5905, 5906, 215}` set in `matching.py`.

- `_IMPUESTO_TO_OBLIGACION` is a **private** module variable (underscore-prefixed) in `rules_engine.py`. Python convention says don't import private names from other modules.
- Importing it would create a coupling between matching and the rules engine — two conceptually independent concerns.
- The set is small (5 integers) and semantically stable: these are ARCA's `idImpuesto` codes for IIBB, not something that changes monthly.
- **Tradeoff**: if ARCA adds a new IIBB `idImpuesto` code, both `rules_engine.py` and `matching.py` must be updated. This is acceptable — the set is tiny, and the update would be a trivial one-line change in both files.

### Substring match `"CORDOBA"` vs exact match

**Decision**: **Substring** — `"CORDOBA" in impuesto.upper()`.

Reasons:
- The `RegistroOutput.impuesto` field comes from RUT (browser-extracted text). The exact string is not guaranteed to match a controlled vocabulary — variations like `"REG. GENERAL IIBB CÓRDOBA"`, `"REG. GRAL. IIBB CORDOBA"`, `"IIBB CORDOBA REG. GENERAL"` are possible.
- Exact match would fail on any of these. Substring match with uppercasing catches them all.
- The substring `"CORDOBA"` is specific enough not to false-positive (no other province name contains "CORDOBA").
- **Tradeoff**: `"CBA"` would not match — but that's intentional. `"CBA"` is ambiguous and could appear for other concepts. If a new RUT format uses `"CBA"` instead of `"CORDOBA"`, we update the match string in one place.

### PDF placeholder: PageBreak + Paragraph with link

**Decision**: **`PageBreak()` then `Paragraph` with inline `<a href="...">`** using ReportLab's built-in support.

Alternatives considered:
- **Separate flowable widget**: over-engineered for a single link. Inconsistent with every other page in the PDF.
- **Inline in existing page**: would break the visual separation. The placeholder is a distinct section that should be self-contained.
- **No PageBreak (add after registro tables)**: would append to the same page. But the registro tables can fill a full page already.

ReportLab's `Paragraph` natively supports `<a href="URL">text</a>` — no extra dependency, works with existing `ParagraphStyle`, consistent with how all other content is built in `pdf_generator.py`.

---

## Data Flow Diagram

```
ClientConfig                          PadronA5Output                      RegistroOutput
┌──────────────┐                      ┌────────────────────┐             ┌──────────────────┐
│ provincias   │──[1]──►              │ regimenGeneral     │             │ impuestos[]      │
│ ["CABA",     │                      │   impuestos[]      │──[2]─►      │   [{impuesto:    │
│  "Córdoba"]  │                      │   [{idImpuesto:    │             │    "REG. GENERAL │
└──────────────┘                      │     5904}, ...]    │             │     IIBB CORDOBA"│
                                      └────────────────────┘             │    }, ...]       │
         │                                     │                         └────────┬─────────┘
         │                                     │                                  │
         ▼                                     ▼                                  ▼
┌─────────────────────────────────────────────────────────────────────────────────────────┐
│                              evaluar_rentas_cordoba()                                     │
│                                                                                           │
│  1. Check Convenio Multilateral:                                                          │
│     len(provincias) >= 2 AND any idImpuesto in {5904,5902,5905,5906,215}                  │
│     → tiene_convenio_multilateral = True/False                                            │
│                                                                                           │
│  2. Check IIBB Córdoba:                                                                   │
│     "CORDOBA" in any registro_impuestos[].impuesto.upper()                                │
│     → tiene_iibb_cordoba = True/False/None                                                │
│                                                                                           │
│  3. Rule: requiere_integracion = tiene_convenio_multilateral AND tiene_iibb_cordoba       │
└───────────────────────────────────────────────────┬─────────────────────────────────────┘
                                                     │
                                                     ▼
                                     ┌──────────────────────────────┐
                                     │ RentasCordobaMatching        │
                                     │   requiere_integracion: True │
                                     │   tiene_convenio: True       │
                                     │   tiene_iibb_cordoba: True   │
                                     │   estado: "pendiente"        │
                                     └──────────────┬───────────────┘
                                                     │
                                                     ▼
┌──────────────────────────────────────────────────────────────────────┐
│ PDFGenerator.generar(rentas_matching=RentasCordobaMatching(...))     │
│                                                                      │
│  ┌─ Page 1: Cover (unchanged)                                        │
│  ├─ Page 2: Calendar (unchanged)                                     │
│  ├─ Page 3: Detalle (unchanged)                                      │
│  ├─ Page 4: Deuda (unchanged)                                        │
│  ├─ Page 5: Facilidades (unchanged)                                  │
│  ├─ Page 6: Registro (unchanged)                                     │
│  └─ Page 7: Rentas Córdoba Placeholder ← NEW (only if requiere_integracion)
│       "Rentas Córdoba — Integración Pendiente"                        │
│       [body text + clickable link]                                    │
└──────────────────────────────────────────────────────────────────────┘
```

**Pipeline position (in `cli.py`):**

```
┌──────────────┐    ┌───────────────┐    ┌─────────────┐    ┌──────────────┐    ┌───────────┐
│ Padrón A5    │──► │ Rules Engine  │──► │ Composio    │──► │ Matching     │──► │ PDF Gen   │
│ WS API       │    │ .calcular()   │    │ Browser     │    │ .evaluar()   │    │ .generar()│
│              │    │               │    │ (deuda,     │    │              │    │           │
│              │    │               │    │  facilidades,│   │              │    │           │
│              │    │               │    │  registro)  │    │              │    │           │
└──────────────┘    └───────────────┘    └─────────────┘    └──────────────┘    └───────────┘
                                                                                     │
                                                                               (receives
                                                                                matching
                                                                                result)
```

---

## Interfaces / Contracts

### New model: `RentasCordobaMatching` (in `fiscal_agent/models.py`)

```python
class RentasCordobaMatching(BaseModel):
    """Resultado del matching de integración con Rentas Córdoba."""

    requiere_integracion: bool = False
    tiene_convenio_multilateral: bool = False
    tiene_iibb_cordoba: Optional[bool] = None
    url: str = "https://www.rentascordoba.gob.ar/"
    estado: str = "no_requerido"       # "pendiente" | "no_requerido" | "sin_datos"
    observacion: str = ""
```

All fields have safe defaults: `False` or `None` or `""`. The model is a standalone `BaseModel` — it does not inherit from, modify, or touch any existing model.

### Pure function: `evaluar_rentas_cordoba()` (in `fiscal_agent/matching.py`)

```python
IIBB_IDS: set[int] = {5904, 5902, 5905, 5906, 215}

def evaluar_rentas_cordoba(
    provincias: Optional[list[str]],
    impuestos_ws: Optional[list[ImpuestoInscripto]],
    registro_impuestos: Optional[list[RegistroImpuesto]],
) -> RentasCordobaMatching:
```

Pure contract:
- **Inputs**: three `Optional` lists. `None` means "data not available".
- **No I/O**: does not read files, call APIs, query databases, or write anything.
- **No side effects**: does not mutate inputs, log, or emit events.
- **Output**: a `RentasCordobaMatching` with all fields populated according to the conjunctive rule.

| Input state | `tiene_convenio_multilateral` | `tiene_iibb_cordoba` | `requiere_integracion` | `estado` |
|---|---|---|---|---|
| `provincias=None` or `[]` | `False` | as evaluated | `False` | `"no_requerido"` |
| `len(provincias) >= 2` + IIBB id in `impuestos_ws` | `True` | as evaluated | depends | depends |
| `registro_impuestos=None` or `[]` | as evaluated | `None` | `False` | `"sin_datos"` |
| Both conditions True | `True` | `True` | `True` | `"pendiente"` |

### Modified signature: `PDFGenerator.generar()` (in `fiscal_agent/pdf_generator.py`)

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

New parameter is **optional with default `None`** → 100% backward compatible. Every existing call site continues to work without changes.

### New internal method: `PDFGenerator._build_rentas_cordoba_placeholder()`

```python
def _build_rentas_cordoba_placeholder(
    self,
    story: list,
    styles: object,
    matching: RentasCordobaMatching,
) -> None:
    """Append a placeholder page for Rentas Córdoba integration."""
```

Called from `generar()` after the registro tables block:
```python
if rentas_matching and rentas_matching.requiere_integracion:
    story.append(PageBreak())
    self._build_rentas_cordoba_placeholder(story, styles, rentas_matching)
```

---

## File Changes

### `fiscal_agent/matching.py` — NEW (≈35 lines)

```python
"""Pure matching logic for provincial tax integration."""

from __future__ import annotations

from typing import Optional

from fiscal_agent.models import ImpuestoInscripto, RegistroImpuesto, RentasCordobaMatching

# IIBB idImpuesto codes from ARCA Padrón A5 (same set as rules_engine._IMPUESTO_TO_OBLIGACION
# but duplicated here to avoid coupling to rules_engine internals).
_IIBB_IDS: set[int] = {5904, 5902, 5905, 5906, 215}


def evaluar_rentas_cordoba(
    provincias: Optional[list[str]],
    impuestos_ws: Optional[list[ImpuestoInscripto]],
    registro_impuestos: Optional[list[RegistroImpuesto]],
) -> RentasCordobaMatching:
    """Evaluate whether a taxpayer requires integration with Rentas Córdoba.

    Pure function — no I/O, no side effects.
    """
    # ── Convenio Multilateral check ──────────────────────────────────────
    tiene_convenio = bool(
        provincias is not None
        and len(provincias) >= 2
        and impuestos_ws is not None
        and any(
            imp.idImpuesto in _IIBB_IDS
            for imp in impuestos_ws
            if imp.idImpuesto is not None
        )
    )

    # ── IIBB Córdoba check ───────────────────────────────────────────────
    tiene_cordoba: Optional[bool]
    if registro_impuestos is None or len(registro_impuestos) == 0:
        tiene_cordoba = None
    else:
        tiene_cordoba = any(
            "CORDOBA" in imp.impuesto.upper()
            for imp in registro_impuestos
        )

    # ── Conjunctive rule ─────────────────────────────────────────────────
    requiere = bool(tiene_convenio and tiene_cordoba is True)

    estado: str
    observacion: str
    if requiere:
        estado = "pendiente"
        observacion = (
            "El contribuyente tiene Convenio Multilateral IIBB y registro "
            "en IIBB Córdoba. Se requiere integración con Rentas Córdoba "
            "para consultar deuda y vencimientos provinciales."
        )
    elif tiene_cordoba is None:
        estado = "sin_datos"
        observacion = "No se pudieron obtener los datos de registro tributario."
    else:
        estado = "no_requerido"
        observacion = ""

    return RentasCordobaMatching(
        requiere_integracion=requiere,
        tiene_convenio_multilateral=tiene_convenio,
        tiene_iibb_cordoba=tiene_cordoba,
        estado=estado,
        observacion=observacion,
    )
```

### `fiscal_agent/models.py` — MODIFIED (+15 lines)

Add after the `RegistroPuntoVenta` class (~line 267):

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

No existing model modified. No fields removed or changed.

### `fiscal_agent/cli.py` — MODIFIED (+10 lines)

After the browser task block (after line 482, inside the `if usa_browser` block), before the PDF generation (line 484):

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

Then pass to `pdf_gen.generar()` (modify the call at line 486):

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

### `fiscal_agent/pdf_generator.py` — MODIFIED

1. **Import** `RentasCordobaMatching` in the import block (add to the existing import from `fiscal_agent.models`):

```python
from fiscal_agent.models import (
    ...
    RegistroPuntoVenta,
    RentasCordobaMatching,  # NEW
    Vencimiento,
    ...
)
```

2. **Signature** — add parameter to `generar()` (line 91):

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

3. **Story injection** — after the registro tables block (after line 171), before `doc.build()`:

```python
# ═══════════════════════════════════════════════════════════════════════
# PAGE 7 — RENTAS CÓRDOBA PLACEHOLDER
# ═══════════════════════════════════════════════════════════════════════
if rentas_matching and rentas_matching.requiere_integracion:
    story.append(PageBreak())
    self._build_rentas_cordoba_placeholder(story, styles, rentas_matching)

# ── Build ────────────────────────────────────────────────────────────
doc.build(story)
```

4. **New method** — add to `PdfGenerator` class:

```python
# ── Página 7: Rentas Córdoba placeholder ─────────────────────────────

def _build_rentas_cordoba_placeholder(
    self,
    story: list,
    styles: object,
    matching: RentasCordobaMatching,
) -> None:
    """Page 7: Placeholder for Rentas Córdoba integration (en desarrollo)."""
    title_style = ParagraphStyle(
        'RentasTitle',
        parent=styles['Title'],
        fontName='Helvetica-Bold',
        fontSize=18,
        textColor=COLOR_PRIMARY,
        spaceAfter=6 * mm,
        alignment=1,
    )
    story.append(Paragraph('Rentas Córdoba — Integración Pendiente', title_style))

    body_style = ParagraphStyle(
        'RentasBody',
        parent=styles['Normal'],
        fontName='Helvetica',
        fontSize=11,
        leading=16,
        spaceAfter=4 * mm,
        alignment=1,
    )
    story.append(
        Paragraph(
            'La integración con Rentas Córdoba se encuentra en desarrollo. '
            'Para consultar deuda y vencimientos provinciales, ingrese al '
            'portal oficial de Rentas Córdoba haciendo clic en el siguiente enlace:',
            body_style,
        )
    )

    link_style = ParagraphStyle(
        'RentasLink',
        parent=styles['Normal'],
        fontName='Helvetica',
        fontSize=13,
        leading=18,
        textColor=colors.HexColor('#0066cc'),
        alignment=1,
    )
    story.append(
        Paragraph(
            f'<a href="{matching.url}">{matching.url}</a>',
            link_style,
        )
    )

    if matching.observacion:
        obs_style = ParagraphStyle(
            'RentasObs',
            parent=styles['Normal'],
            fontName='Helvetica-Oblique',
            fontSize=9,
            leading=13,
            textColor=colors.HexColor('#666666'),
            spaceBefore=6 * mm,
            alignment=1,
        )
        story.append(Paragraph(matching.observacion, obs_style))
```

---

## Testing Strategy

The project has **no test infrastructure** (`strict_tdd: false`). All verification is manual. Each scenario from the spec maps to a concrete manual check:

| Scenario | Manual verification |
|----------|---------------------|
| REQ-1: Model defaults | Open Python shell: `from fiscal_agent.models import RentasCordobaMatching; m = RentasCordobaMatching(); print(m.model_dump())` — confirm `requiere_integracion=False`, `tiene_iibb_cordoba=None`, `estado="no_requerido"` |
| REQ-1: Custom fields | Same shell: `m = RentasCordobaMatching(requiere_integracion=True, tiene_convenio_multilateral=True, tiene_iibb_cordoba=True, estado="pendiente")` — confirm fields hold |
| REQ-2: Positive match | Shell: `from fiscal_agent.matching import evaluar_rentas_cordoba; r = evaluar_rentas_cordoba(["CABA","Córdoba"], [ImpuestoInscripto(idImpuesto=5904)], [RegistroImpuesto(impuesto="REG. GENERAL IIBB CORDOBA")])` — confirm `requiere_integracion=True` |
| REQ-2: 1 provincia only | Same call with `provincias=["Córdoba"]` — `requiere_integracion=False`, `tiene_convenio_multilateral=False` |
| REQ-2: No IIBB in WS API | Same call with `impuestos_ws=[ImpuestoInscripto(idImpuesto=30)]` — `requiere_integracion=False` |
| REQ-2: No Córdoba in RUT | Same with `registro_impuestos=[RegistroImpuesto(impuesto="REG. GENERAL IIBB BUENOS AIRES")]` — `requiere_integracion=False` |
| REQ-2: Case intensitive | Same with `registro_impuestos=[RegistroImpuesto(impuesto="Reg. General Iibb Córdoba")]` — `tiene_iibb_cordoba=True` |
| REQ-3: Pipeline integration | Run `python -m fiscal_agent run --with-registro --with-deuda` for a client with 2+ provincias + IIBB Córdoba — confirm no errors and matching runs |
| REQ-4: PDF placeholder visible | Same run — open generated PDF, confirm Page 7 shows "Rentas Córdoba — Integración Pendiente" + link |
| REQ-4: PDF placeholder hidden | Run for a client without matching — confirm PDF has no Rentas Córdoba page |
| REQ-5: Graceful no registro | Run `python -m fiscal_agent run` (without `--with-registro`) — confirm no crash, no placeholder |

### Python one-liner for REQ-2 verification (copy-paste into shell):

```python
from fiscal_agent.models import ImpuestoInscripto, RegistroImpuesto
from fiscal_agent.matching import evaluar_rentas_cordoba

# Positive
r = evaluar_rentas_cordoba(
    ["CABA", "Córdoba"],
    [ImpuestoInscripto(idImpuesto=5904)],
    [RegistroImpuesto(impuesto="REG. GENERAL IIBB CORDOBA")]
)
assert r.requiere_integracion == True, f"Expected True, got {r.requiere_integracion}"
assert r.estado == "pendiente", f"Expected pendiente, got {r.estado}"
print(f"✅ Positive match: {r.model_dump()}")

# Negative: 1 provincia
r = evaluar_rentas_cordoba(
    ["Córdoba"],
    [ImpuestoInscripto(idImpuesto=5904)],
    [RegistroImpuesto(impuesto="REG. GENERAL IIBB CORDOBA")]
)
assert r.requiere_integracion == False
print(f"✅ Single provincia: requires_integracion=False")

# Negative: no IIBB in WS
r = evaluar_rentas_cordoba(
    ["CABA", "Córdoba"],
    [ImpuestoInscripto(idImpuesto=30)],
    [RegistroImpuesto(impuesto="REG. GENERAL IIBB CORDOBA")]
)
assert r.requiere_integracion == False
print(f"✅ No IIBB in WS: requires_integracion=False")

# Negative: no Córdoba in RUT
r = evaluar_rentas_cordoba(
    ["CABA", "Córdoba"],
    [ImpuestoInscripto(idImpuesto=5904)],
    [RegistroImpuesto(impuesto="REG. GENERAL IIBB BUENOS AIRES")]
)
assert r.requiere_integracion == False
assert r.tiene_iibb_cordoba == False
print(f"✅ No Córdoba in RUT: requires_integracion=False")

# Graceful: None registro
r = evaluar_rentas_cordoba(
    ["CABA", "Córdoba"],
    [ImpuestoInscripto(idImpuesto=5904)],
    None
)
assert r.requiere_integracion == False
assert r.tiene_iibb_cordoba is None
assert r.estado == "sin_datos"
print(f"✅ Graceful None registro: estado=sin_datos")

print("\n🎉 All checks passed")
```

---

## Risks & Mitigations

| Risk | Likelihood | Mitigation |
|------|------------|------------|
| `output.regimenGeneral` is `None` | Low (Padrón A5 always returns regimenGeneral for active taxpayers) | Code uses safe navigation: `output.regimenGeneral.impuestos if output.regimenGeneral else None` |
| `deuda_output` is `None` but `--with-registro` was passed | Low (browser error would surface at task level) | CLI block is gated on `if deuda_output is not None` |
| Import cycle: `matching.py` imports from `models.py`, and some other module imports from `matching.py` | Very low | `matching.py` only imports types from `models.py` — no risk. `cli.py` imports `matching.py` locally inside the `if` block to avoid top-level issues |
| RUT text changes from "CORDOBA" to "CBA" | Medium | Match string is a single constant in `matching.py` — trivial to update. Monitoring in production is the safety net |

---

## Rollback

Pure additive change. Rollback is:
```
git revert <commit-hash>
```
Or manually:
1. `git rm fiscal_agent/matching.py`
2. Revert `models.py` (remove `RentasCordobaMatching` class)
3. Revert `cli.py` (remove matching block, remove `rentas_matching` param from `generar()` call)
4. Revert `pdf_generator.py` (remove method, remove import, remove param, remove injection)
