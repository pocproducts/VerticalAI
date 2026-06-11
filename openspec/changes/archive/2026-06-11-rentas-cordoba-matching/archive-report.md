# Archive Report: rentas-cordoba-matching

**Archived**: 2026-06-11
**Mode**: openspec (file-based)
**SDD Cycle**: Complete ✅

---

## 1. Change Summary

A pure-function matching engine that detects when a Convenio Multilateral IIBB taxpayer also holds IIBB Córdoba registration, plus a PDF placeholder that surfaces the pending integration to the contador. Zero external dependencies, fully additive, no existing code modified in a breaking way.

### What was done

1. **New model** `RentasCordobaMatching` added to `fiscal_agent/models.py` with fields: `requiere_integracion`, `tiene_convenio_multilateral`, `tiene_iibb_cordoba`, `url`, `estado`, `observacion`.
2. **New module** `fiscal_agent/matching.py` containing the pure function `evaluar_rentas_cordoba()` — conjunctive rule: Convenio Multilateral (2+ provincias + IIBB idImpuesto in WS API) AND IIBB Córdoba in RUT (`"CORDOBA"` substring match with accent normalization).
3. **CLI integration** in `fiscal_agent/cli.py`: matching invoked after Composio browser block, result passed to PDF generator as `rentas_matching`.
4. **PDF placeholder** in `fiscal_agent/pdf_generator.py`: new parameter on `generar()`, Page 7 with heading "Rentas Córdoba — Integración Pendiente", body text, clickable link, and optional observation text.

### Files affected

| File | Action | Est. Lines Added |
|------|--------|------------------|
| `fiscal_agent/models.py` | Modified | +14 (new model class) |
| `fiscal_agent/matching.py` | New | +92 |
| `fiscal_agent/cli.py` | Modified | +15 (matching block + param) |
| `fiscal_agent/pdf_generator.py` | Modified | +65 (import, param, story injection, placeholder method) |
| **Total** | | **~186** |

---

## 2. Delta Between Spec and Final

### Deviations

| # | Aspect | Spec | Implementation | Status |
|---|--------|------|----------------|--------|
| 1 | **Accent normalization** | `"CORDOBA" in impuesto.upper()` | `_normalize()` using NFKD decomposition + ASCII filter before `"CORDOBA" in` | ✅ **Improvement** — handles `CÓRDOBA` → `CORDOBA` |
| 2 | **File structure** | Spec at `specs/{domain}/spec.md` (delta) | `spec.md` at root of change folder (flat) | ✅ **Equivalent** — no domain split needed for a single-domain change |
| 3 | **`observacion` text** | `"El contribuyente tiene Convenio Multilateral IIBB y registro en IIBB Córdoba. Se requiere integración con Rentas Córdoba para consultar deuda y vencimientos provinciales."` | `"Contribuyente con Convenio Multilateral IIBB y registro en IIBB Córdoba. La integración con Rentas Córdoba está en desarrollo."` | ✅ **Minor** — shorter, equally descriptive |

All deviations are non-breaking improvements or equivalent. The accent normalization surpasses the spec's basic `upper()` check and was flagged in the verification report as a recommended enhancement. No regressions are introduced.

### Spec compliance

**17/17 scenarios compliant** (per verification report). All requirements (REQ-1 through REQ-5) and NFRs (NFR-1 through NFR-3) are met.

---

## 3. Tasks Completed

| Task | File | Status | Est. Lines | Verdict |
|------|------|--------|-----------|---------|
| T-1 | `fiscal_agent/models.py` — Add `RentasCordobaMatching` model | ✅ Complete | ~12 | All defaults correct, custom fields hold |
| T-2 | `fiscal_agent/matching.py` — Create matching module | ✅ Complete | ~50 | All 13 matching scenarios pass |
| T-3 | `fiscal_agent/cli.py` — Integrate matching in CLI pipeline | ✅ Complete | ~15 | Matching called after Composio, result passed to PDF |
| T-4 | `fiscal_agent/pdf_generator.py` — Add PDF placeholder | ✅ Complete | ~55 | Placeholder gated on `requiere_integracion`, backward compatible |
| **Total** | | **4/4** | **~132** | **All PASS** |

---

## 4. Verification Verdict

**PASS** ✅

All 4 tasks completed. All 17 spec scenarios verified compliant:

- 9 manual Python shell assertions for REQ-1 (model) and REQ-2 (matching logic)
- Static code review for REQ-3 (CLI), REQ-4 (PDF), REQ-5 (graceful degradation)
- All NFR constraints verified: 100% additive, no external deps, file scope respected

### Issues found

- **CRITICAL**: None
- **WARNING**: None
- **SUGGESTION**: Accent normalization enhancement should be documented in spec if strict adherence is required. End-to-end pipeline test recommended before production deployment (requires browser infrastructure).

---

## 5. Source of Truth Updated

No main specs exist for `rentas-cordoba-matching` in `openspec/specs/` — this is a new domain with no delta spec subdirectory. The `spec.md` in the change folder is the full, single-domain spec. No merge was necessary.

### What was learned

- The `"CORDOBA"` substring match with NFKD accent normalization (`_normalize()`) handles more edge cases than the spec's basic `upper()` — a concrete improvement worth propagating to future provincial matching implementations.
- The matching function is designed as a pure, testable function with explicit inputs, making it straightforward to extend for other provinces (Buenos Aires, Santa Fe, CABA) in future changes.
- The PDF placeholder pattern (PageBreak + Paragraph with inline `<a href>` link) is consistent with ReportLab usage elsewhere in the codebase and requires no new dependencies.

---

## 6. Engram Observation IDs

Not applicable — openspec file-based mode. No Engram observations were persisted for this change's artifacts (all are filesystem-based). Key Engram observations that may exist for the project overall:

- `sdd/rentas-cordoba-matching/proposal` — change proposal
- `sdd/rentas-cordoba-matching/spec` — requirements and scenarios
- `sdd/rentas-cordoba-matching/design` — architecture decisions and data flow
- `sdd/rentas-cordoba-matching/tasks` — breakdown into implementation tasks
- `sdd/rentas-cordoba-matching/verify-report` — verification results
- `sdd/rentas-cordoba-matching/archive-report` — this report

*Query Engram with `mem_search(query: "sdd/rentas-cordoba-matching/{artifact}")` to retrieve specific observation IDs.*

---

## 7. Archive Contents

| Artifact | Status |
|----------|--------|
| `proposal.md` | ✅ |
| `spec.md` | ✅ |
| `design.md` | ✅ |
| `tasks.md` | ✅ |
| `verify-report.md` | ✅ |
| `archive-report.md` | ✅ |

## 8. SDD Cycle Complete

The change `rentas-cordoba-matching` has been fully planned, specified, designed, implemented, verified, and archived. The SDD cycle is complete.

Ready for the next change.
