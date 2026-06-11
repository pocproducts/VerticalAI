## Verification Report

**Change**: rentas-cordoba-matching
**Version**: N/A (initial implementation)
**Mode**: Standard (no test infrastructure; `strict_tdd: false`)

### Completeness

| Metric | Value |
|--------|-------|
| Tasks total | 4 |
| Tasks complete | 4 |
| Tasks incomplete | 0 |

### Build & Tests Execution

**Build**: ✅ Passed (Python imports, no type-checker configured)

```text
All module imports resolve successfully:
- fiscal_agent.models.RentasCordobaMatching ✓
- fiscal_agent.matching.evaluar_rentas_cordoba ✓
- fiscal_agent.pdf_generator.PdfGenerator (with new param) ✓
- fiscal_agent.cli (matching integration) ✓
```

**Tests**: ✅ 17/17 passed (manual Python shell assertions)

```text
✅ T-1: Defaults correct
✅ T-1: Custom fields hold
✅ Positive match (Convenio Multilateral + IIBB Córdoba)
✅ Single provincia → no matching
✅ No IIBB in WS → no matching
✅ No Córdoba in RUT → no matching
✅ Case-insensitive match (Córdoba with accent)
✅ No CORDOBA substring → False
✅ Graceful None registro
✅ Graceful empty registro
✅ None provincias handled
✅ All IIBB idImpuesto variants (5904, 5902, 5905, 5906, 215)
✅ Empty impuestos_ws list
✅ None impuestos_ws
✅ None idImpuesto in list handled
✅ Empty provincias list
✅ Accented CÓRDOBA handled (normalized)
```

**Coverage**: ➖ Not available (no test framework configured)

### Spec Compliance Matrix

| Requirement | Scenario | Test (manual assertion) | Result |
|-------------|----------|------------------------|--------|
| REQ-1 | Model instantiation — defaults | T-1 shell: `m = RentasCordobaMatching()` → assert all defaults | ✅ COMPLIANT |
| REQ-1 | Model instantiation — custom fields | T-1 shell: custom kwargs → assert values hold | ✅ COMPLIANT |
| REQ-2 | Positive match — CM + IIBB Córdoba | `evaluar_rentas_cordoba(["CABA","Córdoba"], [ImpuestoInscripto(5904)], [RegistroImpuesto("...CORDOBA")])` | ✅ COMPLIANT |
| REQ-2 | Negative — 1 provincia | provincias=["Córdoba"] → `requiere_integracion=False` | ✅ COMPLIANT |
| REQ-2 | Negative — no IIBB in WS API | impuestos_ws=[ImpuestoInscripto(30)] → `requiere_integracion=False` | ✅ COMPLIANT |
| REQ-2 | Negative — no Córdoba in RUT | registro_impuestos=[RegistroImpuesto("...BUENOS AIRES")] → `requiere_integracion=False` | ✅ COMPLIANT |
| REQ-2 | Case-insensitive matching | "Reg. General Iibb Córdoba" → `tiene_iibb_cordoba=True`; "IIBB RG CBA" → `False` | ✅ COMPLIANT |
| REQ-3 | CLI pipeline integration | Code review: matching called after Composio block, result passed to `generar()` | ✅ COMPLIANT |
| REQ-3 | Without `--with-registro` | Code review: `registro_impuestos=None` → graceful | ✅ COMPLIANT |
| REQ-4 | PDF placeholder shown | Code review: gated on `requiere_integracion`, heading + link + observacion | ✅ COMPLIANT |
| REQ-4 | PDF placeholder hidden | Code review: gated on `False`/`None` | ✅ COMPLIANT |
| REQ-4 | Backward compat — no param | Code review: `rentas_matching: Optional[...] = None` | ✅ COMPLIANT |
| REQ-5 | Graceful — None RegistroOutput | `registro_impuestos=None` → `tiene_iibb_cordoba=None`, `estado="sin_datos"` | ✅ COMPLIANT |
| REQ-5 | Graceful — empty impuestos list | `registro_impuestos=[]` → `tiene_iibb_cordoba=None`, `estado="sin_datos"` | ✅ COMPLIANT |
| NFR-1 | 100% additive | All changes additive; no existing fields/signatures modified | ✅ COMPLIANT |
| NFR-2 | No external deps | Only stdlib (`unicodedata`, `typing`) + existing project deps (Pydantic, ReportLab) | ✅ COMPLIANT |
| NFR-3 | File scope | 1 new file (`matching.py`) + 3 modified (`models.py`, `cli.py`, `pdf_generator.py`) | ✅ COMPLIANT |

**Compliance summary**: 17/17 scenarios compliant

### Correctness (Static Evidence)

| Requirement | Status | Notes |
|------------|--------|-------|
| REQ-1: RentasCordobaMatching model | ✅ Implemented | Lines 269-282 in `models.py`. Fields: `requiere_integracion(bool)`, `tiene_convenio_multilateral(bool)`, `tiene_iibb_cordoba(Optional[bool])`, `url(str)`, `estado(str)`, `observacion(str)`. All defaults match spec exactly. |
| REQ-2: evaluar_rentas_cordoba() | ✅ Implemented | 92-line module `matching.py`. Pure function — no I/O, no side effects. Conjunctive rule: CM check (2+ provincias + IIBB idImpuesto) AND Córdoba check (substring). |
| REQ-2: IIBB ID set | ✅ Implemented | `_IIBB_IDS = {5904, 5902, 5905, 5906, 215}` — duplicated to avoid coupling to `rules_engine`, per design decision. |
| REQ-2: Accent normalization | ✅ Enhanced | Implementation uses `_normalize()` (NFKD + ASCII filter) before `"CORDOBA"` search — handles accented `CÓRDOBA`, surpasses the basic `impuesto.upper()` from spec. |
| REQ-3: CLI integration | ✅ Implemented | Lines 488-496: matching call after Composio, gated on `deuda_output is not None`. Line 510: `rentas_matching=rentas_matching` passed to `generar()`. Variable initialized to `None` at line 435 for proper scope. |
| REQ-4: PDF placeholder | ✅ Implemented | `_build_rentas_cordoba_placeholder()` at lines 1028-1086. PageBreak + Paragraph with heading "Rentas Córdoba — Integración Pendiente", body text, clickable `<a href="...">` link, optional observacion in italic. Gated at lines 181-183. |
| REQ-5: Graceful degradation | ✅ Implemented | When `registro_impuestos is None` or empty: `tiene_iibb_cordoba=None`, `estado="sin_datos"`, `requiere_integracion=False`. CLI block gated on `deuda_output is not None`. |

### Coherence (Design)

| Decision | Followed? | Notes |
|----------|-----------|-------|
| New `matching.py` module vs inline in `cli.py` | ✅ Yes | New module at `fiscal_agent/matching.py` |
| Duplicate IIBB id set vs import from `rules_engine` | ✅ Yes | `_IIBB_IDS` defined as private constant in `matching.py` |
| Substring match `"CORDOBA"` vs exact match | ✅ Yes (enhanced) | Uses `_normalize()` (uppercase + NFKD accent stripping) before `"CORDOBA" in` — improves on the spec |
| PDF placeholder: PageBreak + Paragraph with link | ✅ Yes | `PageBreak()` before content, `Paragraph` with `<a href="...">` using ReportLab inline link support |
| Lazy import in CLI (inside `if` block) | ✅ Yes | `from fiscal_agent.matching import evaluar_rentas_cordoba` at line 490 (inside `if deuda_output`) |
| Safe navigation for `regimenGeneral` | ✅ Yes | `output.regimenGeneral.impuestos if output.regimenGeneral else None` |

### Issues Found

**CRITICAL**: None

**WARNING**: None

**SUGGESTION**:
1. **Accent normalization deviates from spec literal** — The spec defines the check as `"CORDOBA" in impuesto.upper()`, but the implementation uses `_normalize()` which additionally strips accents via NFKD normalization (handling `CÓRDOBA` → `CORDOBA`). This is an **improvement**, not a bug, and is recommended for production. If strict spec compliance is required, the spec should be updated to reflect this enhancement.
2. **No end-to-end pipeline test** — The matching function is verified via unit tests (17 shell assertions), but the full CLI pipeline (`python -m fiscal_agent run --with-registro --with-deuda`) was NOT executed due to lack of browser infrastructure in this environment. The PDF placeholder rendering (REQ-4) was verified by code review only. An integration test with real/mocked browser output should confirm the full flow before production deployment.

### Verdict

**PASS**

All 4 tasks completed. All 17 spec scenarios verified compliant via static analysis and manual Python execution of the matching function. The implementation is 100% additive, respects NFR constraints, and improves on the spec's matching robustness with accent normalization. No CRITICAL or WARNING issues found. The two SUGGESTION items are non-blocking: the accent enhancement is a clear improvement, and end-to-end testing is expected for a feature that requires browser infrastructure.
