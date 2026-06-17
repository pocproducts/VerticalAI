# Tasks: registro-tributario-iibb

## Review Workload Forecast

| Task | File | Est. Lines | Nature |
|------|------|-----------|--------|
| T-1 | `fiscal_agent/models.py` | ~20 | Modified (add 2 models + 1 field) |
| T-2 | `fiscal_agent/browser/workflows/registro.py` | ~15 | Modified (expand template) |
| T-3 | `fiscal_agent/browser/task.py` | ~5 | Modified (expand parser) |
| T-4 | `fiscal_agent/browser/composio.py` | ~15 | Modified (expand _parse_registro) |
| T-5 | `fiscal_agent/matching.py` + `models.py` | ~50 | Modified (new evaluar_iibb + IIBBJurisdiccionResultado) |
| T-6 | `fiscal_agent/pdf_generator.py` | ~40 | Modified (add IIBB table) |
| T-7 | `fiscal_agent/chat/response_builder.py` | ~35 | Modified (implement format_registro) |
| **Total** | | **~180** | |

**400-line budget risk: Low** — ~180 lines is well within the single-PR budget. No split needed.

---

## Tasks

### T-1: Add models to `fiscal_agent/models.py`  ✅

**File:** `fiscal_agent/models.py`

**T-1.1 — Add `RegistroIIBBJurisdiccion` model**

Insert after `RegistroPuntoVenta` (line 267), before `RentasCordobaMatching` (line 269):

```python
class RegistroIIBBJurisdiccion(BaseModel):
    """IIBB jurisdiction where the taxpayer is registered.

    Each entry represents one province where the taxpayer has an
    IIBB inscription, with registration number and status.
    """

    provincia: str = ''
    inscripcion: str = ''
    estado: str = ''
    fecha_alta: Optional[date] = None
    fecha_baja: Optional[date] = None
```

**T-1.2 — Add `IIBBJurisdiccionResultado` model**

Insert after `RegistroIIBBJurisdiccion`:

```python
class IIBBJurisdiccionResultado(BaseModel):
    """Result of IIBB matching for a single jurisdiction.

    Three-way check: client config, WS API, RUT data.
    ``match_total`` is True only when all three align.
    """

    provincia: str = ''
    configurada_en_cliente: bool = False
    detectada_en_ws: bool = False
    detectada_en_rut: bool = False
    inscripcion: str = ''
    estado: str = ''
    match_total: bool = False
```

**T-1.3 — Add `iibb_jurisdicciones` field to `RegistroOutput`**

Add after `puntos_de_venta` field (line 292):

```python
iibb_jurisdicciones: List[RegistroIIBBJurisdiccion] = Field(default_factory=list)
```

Also add `RegistroIIBBJurisdiccion` and `IIBBJurisdiccionResultado` to the imports in any file that needs them. For `models.py` itself, no import changes needed since it's defined here.

**Verification criteria (manual):**
1. Verify the file parses: `python -c "from fiscal_agent.models import RegistroIIBBJurisdiccion, IIBBJurisdiccionResultado, RegistroOutput; print('✅ Models OK')"`
2. Verify defaults: `m = RegistroIIBBJurisdiccion(); assert m.provincia == ''; assert m.fecha_alta is None`
3. Verify `RegistroOutput` has new field: `r = RegistroOutput(); assert r.iibb_jurisdicciones == []`

---

### T-2: Expand browser template  ✅

**File:** `fiscal_agent/browser/workflows/registro.py`

**T-2.1 — Add IIBB jurisdictions section to template**

After the existing "PUNTOS DE VENTA" extraction step (section E in PARTE 4), add:

```
    F) IIBB JURISDICCIONES: buscar la sección de Ingresos Brutos.
       Para CADA provincia donde el contribuyente esté inscripto,
       extraer: provincia, número de inscripción, estado, fecha de alta,
       fecha de baja (si visible).
```

**T-2.2 — Add new JSON section to the example**

Add after the `puntos_de_venta` section in the JSON example:

```json
  "iibb_jurisdicciones": [
    {"provincia": "CABA", "inscripcion": "901-123456-7", "estado": "Activo", "fecha_alta": "2020-01-01", "fecha_baja": null},
    {"provincia": "Córdoba", "inscripcion": "123-456789-0", "estado": "Activo", "fecha_alta": "2019-06-15", "fecha_baja": null}
  ]
```

**T-2.3 — Update the `done()` example**

Update the done() example to include the new `iibb_jurisdicciones` key.

**Verification criteria (manual):**
1. Read the file and confirm the new extraction instructions are clear
2. Confirm the JSON example includes `iibb_jurisdicciones`

---

### T-3: Expand `_parse_registro_output()` in task.py  ✅

**File:** `fiscal_agent/browser/task.py`

**T-3.1 — Add `iibb_jurisdicciones` to recognized keys**

In `_parse_registro_output()`, update the `_keys` tuple (line 362) to include `'iibb_jurisdicciones'`:

```python
_keys = ('domicilios', 'actividades', 'impuestos', 'puntos_de_venta', 'iibb_jurisdicciones')
```

Also update the return dict structure comment and fallback return to include the new key:

```python
return {'domicilios': [], 'jurisdiccion': None, 'actividades': [], 'impuestos': [], 'puntos_de_venta': [], 'iibb_jurisdicciones': []}
```

**Verification criteria (manual):**
1. `python -c "from fiscal_agent.browser.task import _parse_registro_output; r = _parse_registro_output('{\\\"iibb_jurisdicciones\\\": []}'); assert 'iibb_jurisdicciones' in r; print('✅ T-3 OK')"`

---

### T-4: Expand `_parse_registro()` in composio.py  ✅

**File:** `fiscal_agent/browser/composio.py`

**T-4.1 — Add import for `RegistroIIBBJurisdiccion`**

Add `RegistroIIBBJurisdiccion` to the import block from `fiscal_agent.models` (lines 30-45):

```python
from fiscal_agent.models import (
    ...
    RegistroIIBBJurisdiccion,
    ...
)
```

**T-4.2 — Add IIBB jurisdictions parsing to `_parse_registro()`**

In `_parse_registro()`, after the `puntos_de_venta` block (after line 643), add:

```python
iibb_jurisdicciones = []
for ij in data.get('iibb_jurisdicciones', []):
    iibb_jurisdicciones.append(
        RegistroIIBBJurisdiccion(
            provincia=str(ij.get('provincia', '')),
            inscripcion=str(ij.get('inscripcion', '')),
            estado=str(ij.get('estado', '')),
            fecha_alta=(
                datetime.strptime(ij['fecha_alta'], '%Y-%m-%d').date()
                if ij.get('fecha_alta') and isinstance(ij.get('fecha_alta'), str)
                else None
            ),
            fecha_baja=(
                datetime.strptime(ij['fecha_baja'], '%Y-%m-%d').date()
                if ij.get('fecha_baja') and isinstance(ij.get('fecha_baja'), str)
                else None
            ),
        )
    )
```

Add `from datetime import datetime` at the top of the file if not already imported (check first — line 24 already has it).

**T-4.3 — Update `RegistroOutput` instantiation**

In the final `RegistroOutput(...)` return (lines 645-651), add the new field:

```python
return RegistroOutput(
    domicilios=domicilios,
    jurisdiccion=str(data.get('jurisdiccion')) if data.get('jurisdiccion') else None,
    actividades=actividades,
    impuestos=impuestos,
    puntos_de_venta=puntos_de_venta,
    iibb_jurisdicciones=iibb_jurisdicciones,  # NEW
)
```

**Verification criteria (manual):**
1. `python -c "from fiscal_agent.browser.composio import ComposioBrowser; print('✅ T-4 imports OK')"`
2. Quick parse test: run a pipeline with `--with-registro` and verify no crash

---

### T-5: Implement `evaluar_iibb()` multi-jurisdicción matching  ✅

**File:** `fiscal_agent/matching.py` (+ models.py already done in T-1.2)

**T-5.1 — Add IIBB id→provincia mapping**

Add a module-level constant after the existing imports:

```python
# IIBB idImpuesto → provincia mapping
# Same set as rules_engine._IMPUESTO_TO_OBLIGACION IIBB keys
_IIBB_ID_TO_PROVINCIA: dict[int, str] = {
    5902: 'CABA',
    5904: 'Córdoba',
    5905: 'Buenos Aires',
    5906: 'Santa Fe',
    215: 'Acciones',
}
```

**T-5.2 — Implement `evaluar_iibb()` function**

Add after `evaluar_rentas_cordoba()`:

```python
def evaluar_iibb(
    provincias_configuradas: Optional[list[str]],
    impuestos_ws: Optional[list[ImpuestoInscripto]],
    iibb_jurisdicciones: Optional[list[RegistroIIBBJurisdiccion]],
) -> list[IIBBJurisdiccionResultado]:
    """Evalúa IIBB multi-jurisdicción: cruza config, WS API y RUT.

    Para cada jurisdicción IIBB detectada en el RUT, verifica:
    1. Si el cliente tiene esa provincia configurada
    2. Si el WS API reporta IIBB para esa provincia
    3. Resultado: match_total solo si coinciden las 3 fuentes

    Args:
        provincias_configuradas: Provincias del ClientConfig.
        impuestos_ws: Impuestos del Padrón A5 (WS API).
        iibb_jurisdicciones: Jurisdicciones IIBB del RUT.

    Returns:
        Lista de IIBBJurisdiccionResultado, una por jurisdicción detectada.
    """
    if not iibb_jurisdicciones:
        return []

    provincias_set = set(p.lower() for p in (provincias_configuradas or []))
    ws_ids = set(
        imp.idImpuesto for imp in (impuestos_ws or [])
        if imp.idImpuesto is not None
    )

    resultados: list[IIBBJurisdiccionResultado] = []
    for ij in iibb_jurisdicciones:
        prov = ij.provincia
        prov_lower = prov.lower()

        configurada = prov_lower in provincias_set

        # Check WS: does any IIBB id map to this provincia?
        en_ws = any(
            mapping_provincia.lower() == prov_lower
            for _id, mapping_provincia in _IIBB_ID_TO_PROVINCIA.items()
            if _id in ws_ids
        )

        resultados.append(
            IIBBJurisdiccionResultado(
                provincia=prov,
                configurada_en_cliente=configurada,
                detectada_en_ws=en_ws,
                detectada_en_rut=True,
                inscripcion=ij.inscripcion,
                estado=ij.estado,
                match_total=configurada and en_ws,
            )
        )

    return resultados
```

**T-5.3 — Add imports to matching.py**

Add to the import block:

```python
from fiscal_agent.models import (
    ...
    IIBBJurisdiccionResultado,
    RegistroIIBBJurisdiccion,
    ...
)
```

**Verification criteria (manual):**
```python
from fiscal_agent.models import RegistroIIBBJurisdiccion
from fiscal_agent.matching import evaluar_iibb

# Positive match
r = evaluar_iibb(
    provincias_configuradas=["CABA", "Córdoba"],
    impuestos_ws=[ImpuestoInscripto(idImpuesto=5902), ImpuestoInscripto(idImpuesto=5904)],
    iibb_jurisdicciones=[
        RegistroIIBBJurisdiccion(provincia="CABA", inscripcion="901-123456-7", estado="Activo"),
        RegistroIIBBJurisdiccion(provincia="Córdoba", inscripcion="123-456789-0", estado="Activo"),
    ],
)
assert len(r) == 2
assert all(item.match_total for item in r)
print("✅ T-5: Multi-jurisdicción OK")
```

---

### T-6: Add IIBB jurisdiction table to PDF  ✅

**File:** `fiscal_agent/pdf_generator.py`

**T-6.1 — Add import**

Add `RegistroIIBBJurisdiccion` and `IIBBJurisdiccionResultado` to the import block from `fiscal_agent.models` (lines 41-57).

**T-6.2 — Add IIBB table section to `_build_registro_tables()`**

After the "Puntos de venta" table block (after line 1015) and before the IIBB Match Detection section (line 1017), add:

```python
# ── Tabla: Jurisdicciones IIBB ────────────────────────────────
if registro and registro.iibb_jurisdicciones:
    story.append(Spacer(1, 4 * mm))
    story.append(Paragraph('Jurisdicciones IIBB:', sub_title))
    header5 = ['Provincia', 'Inscripción', 'Estado', 'Match']
    rows5: list[list] = [header5]
    for ij in registro.iibb_jurisdicciones:
        match_symbol = '—'
        rows5.append(
            [
                Paragraph(ij.provincia, cell_style),
                Paragraph(ij.inscripcion or '—', cell_style),
                Paragraph(ij.estado, cell_style),
                Paragraph(match_symbol, cell_style),
            ]
        )
    self._draw_table(story, rows5, [4 * cm, 5 * cm, 3 * cm, 2 * cm])
```

Note: The Match column uses `—` as placeholder. When the matching result from `evaluar_iibb()` is available, this can be enriched. For now, the raw RUT data is displayed.

**T-6.3 — Ensure section is conditional**

The section MUST only appear when `registro.iibb_jurisdicciones` is non-empty. The existing `if` guard (line 1002 `if registro and registro.puntos_de_venta:`) pattern MUST be followed.

**Verification criteria (manual):**
1. Run pipeline with `--with-registro` for a client with IIBB data — confirm "Jurisdicciones IIBB" table appears
2. Run pipeline without `--with-registro` — confirm no crash, PDF generated normally
3. Verify the table columns match: Provincia, Inscripción, Estado, Match

---

### T-7: Implement `format_registro()` in response_builder.py  ✅

**File:** `fiscal_agent/chat/response_builder.py`

**T-7.1 — Add function**

Add at the end of the file:

```python
def format_registro(registro: Optional[RegistroOutput], cuit: str) -> str:
    """Formatea el registro tributario para respuesta de chat.

    Args:
        registro: RegistroOutput del pipeline (o None).
        cuit: CUIT del contribuyente.

    Returns:
        Texto plano legible con los datos del registro.
    """
    if registro is None:
        return f'No se encontró registro tributario para CUIT {cuit}.'

    lines: list[str] = [f'Registro Tributario — CUIT {cuit}', '']

    if registro.jurisdiccion:
        lines.append(f'Jurisdicción: {registro.jurisdiccion}')
        lines.append('')

    if registro.domicilios:
        lines.append('Domicilios:')
        for d in registro.domicilios:
            parts = []
            if d.tipo:
                parts.append(d.tipo)
            if d.direccion:
                parts.append(d.direccion)
            if d.localidad:
                parts.append(d.localidad)
            if d.provincia:
                parts.append(d.provincia)
            if d.codigo_postal:
                parts.append(f'CP {d.codigo_postal}')
            lines.append(f'  • {", ".join(parts)}')
        lines.append('')

    if registro.actividades:
        lines.append('Actividades:')
        for a in registro.actividades:
            act_str = a.actividad
            if a.codigo:
                act_str += f' ({a.codigo})'
            if a.estado:
                act_str += f' — {a.estado}'
            lines.append(f'  • {act_str}')
        lines.append('')

    if registro.impuestos:
        lines.append('Impuestos:')
        for imp in registro.impuestos:
            imp_str = imp.impuesto
            if imp.categoria:
                imp_str += f' ({imp.categoria})'
            if imp.estado:
                imp_str += f' — {imp.estado}'
            lines.append(f'  • {imp_str}')
        lines.append('')

    if registro.iibb_jurisdicciones:
        lines.append('IIBB por jurisdicción:')
        for ij in registro.iibb_jurisdicciones:
            ij_str = f'  • {ij.provincia}'
            if ij.inscripcion:
                ij_str += f' — Insc: {ij.inscripcion}'
            if ij.estado:
                ij_str += f' ({ij.estado})'
            lines.append(ij_str)
        lines.append('')

    return '\n'.join(lines)
```

**T-7.2 — Add import**

Add `RegistroOutput` to the imports at the top of the file.

**Verification criteria (manual):**
```python
from fiscal_agent.chat.response_builder import format_registro
from fiscal_agent.models import RegistroOutput

# With data
r = RegistroOutput(jurisdiccion="CABA")
text = format_registro(r, "20324837796")
assert "CUIT 20324837796" in text
assert "Jurisdicción: CABA" in text
print("✅ T-7: format_registro OK")

# None
text = format_registro(None, "20324837796")
assert "No se encontró" in text
print("✅ T-7: None handled OK")
```

---

## Dependencies

```
T-1 (models) ──┬── T-3 (task.py parser)
               ├── T-4 (composio parser)
               ├── T-5 (matching)
               ├── T-6 (PDF table)
               └── T-7 (response_builder)

T-2 (template) ──► T-4 (composio parser) ──┬── T-6 (PDF table)
                                           └── T-7 (response_builder)

T-3 (task parser) ──► T-4 (composio parser)

T-5 (matching) ──► T-6 (PDF table) [optional enrichment]
```

- **T-1** must complete before T-3, T-4, T-5, T-6, T-7 (all depend on new models).
- **T-2** and **T-3** are independent and can be done in parallel.
- **T-4** depends on T-1 + T-3 (needs model + parser key recognition).
- **T-5** depends on T-1 (needs models).
- **T-6** depends on T-1 + T-4 (needs model + data flowing through).
- **T-7** depends on T-1 (needs model).
- All tasks are 100% additive — no existing code is modified in a breaking way.

---

## Total Estimated Lines: ~180
