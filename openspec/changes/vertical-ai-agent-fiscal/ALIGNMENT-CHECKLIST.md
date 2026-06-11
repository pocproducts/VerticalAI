# ✅ SDD ALIGNMENT CHECKLIST — Workflow-First Strategy

## Completed (2026-06-09)

### 📋 Documents Updated

- [x] **design.md** (openspec)
  - Technical Approach: Workflow-First + Agent Fallback
  - Architecture Decisions: 8 updated (Workflows as primary, CSS selectors, manual recording, Git storage)
  - Data Flow: New diagram showing workflows in Track Complementario
  - Module Structure: fiscal_agent/workflows/ documented

- [x] **spec.md** (openspec)
  - ARCA-extraction section: Rewritten for Workflows + Agent
  - Requirements ARCA-1 to ARCA-10: Added selectors + parameterization + QA
  - Scenarios S1-S8: Workflow execution + fallback paths
  - Data Contract: Workflow outputs (login, switch, deuda JSON schemas)

- [x] **tasks.md** (openspec)
  - Sprint 2 desglosado: T-07a, T-07b, T-07c, T-08a, T-08b (detailed subtasks)
  - 13 total tasks organized by Phase (Recording, Integration, Edge Cases, Validation, Buffer)
  - Each subtask includes: Acción, Output, Validación, Criterio Aceptación
  - Comparison table: Workflows vs Agent
  - Sprint 2 Hito updated to Day 10

### 🗂️ Folder Structure Created

- [x] `fiscal_agent/workflows/arca/` ← ARCA portal workflows (empty, ready for recording)
- [x] `fiscal_agent/workflows/integration/` ← Integration workflows (future)
- [x] `fiscal_agent/workflows/README.md` ← Complete documentation

### 📖 Documentation Added

- [x] **fiscal_agent/workflows/README.md**
  - Estructura: Folder layout
  - Workflows: 3 detailed definitions (login_estudio, switch_representado, extract_deuda)
  - Grabación: Step-by-step process for each workflow + commands
  - Integración: Code examples for loading/executing workflows in arca_extractor.py
  - Checklist: Pre-recording, post-recording, error handling
  - Próximas fases: Timeline reference

---

## Workflow Definitions Documented

### T-07a: login_estudio.workflow.yaml
- **Purpose**: Navigate ARCA, enter CUIT + clave fiscal, verify login
- **Inputs**: cuit, clave_fiscal (parametrized with {{}} syntax)
- **Output**: authenticated=true, study_cuit, elapsed_ms
- **Key Requirements**: CSS selectors, 3s wait for dynamic load, "Mis Impuestos" success
- **Validation**: 3× runs without failures
- **Status**: 📋 DOCUMENTED, ready to record (T-07a)

### T-07b: switch_representado.workflow.yaml
- **Purpose**: Switch between representados without re-login
- **Inputs**: target_cuit (parametrized)
- **Output**: switched=true, client_cuit, elapsed_ms
- **Key Requirements**: CSS selectors, no re-login, 2+ CUIT validation
- **Status**: 📋 DOCUMENTED, ready to record (T-07b)

### T-08a: extract_deuda.workflow.yaml
- **Purpose**: Navigate Mis Facilidades, extract deuda/saldos/plans
- **Inputs**: None (uses active session)
- **Output**: DeudaOutput JSON (cuit, deuda_actual, saldos[], planes_pagos, error)
- **Key Requirements**: JSON schema compliance, 2+ representados validation
- **Status**: 📋 DOCUMENTED, ready to record (T-08a)

---

## Strategy Clarification

### Why Workflow-First?

| Factor | Workflow | Agent |
|--------|----------|-------|
| Speed | 10-100× faster | Slow (LLM latency) |
| Cost | $0 | $$ per run |
| Accuracy | 99.9% (replay) | 85-95% (hallucinations) |
| Element Detection | CSS selectors ✅ | Index-based ❌ |
| Debugging | Explicit steps | Hard to trace |
| Solve current issue | YES (selectors) | NO (indices still fail) |

### Workflow + Agent Fallback

```
Try:   Load login_estudio.workflow.yaml
       ├─ Fast, $0 cost, CSS selectors
       └─ Success → proceed
       
Except: LLM Agent takes control
        ├─ Retry 3× with backoff
        ├─ Handles: 2FA, captchas, UI changes
        └─ Log: which path was taken
```

---

## Next Phase: Recording (When Ready)

### Pre-requisites

- [ ] `.env` configured with `ESTUDIO_CUIT`, `ESTUDIO_CLAVE`
- [ ] RecordingService running: `python -m workflow_use record --headed`
- [ ] ARCA accessible (no VPN/network issues)
- [ ] All folder structure created ✅ (already done)

### Recording Order

1. **T-07a** (Day 1): `login_estudio.workflow.yaml`
   - Record: Navigate ARCA, enter CUIT + clave, login
   - Validate: 3× runs without failures
   - Save: `fiscal_agent/workflows/arca/login_estudio.workflow.yaml`

2. **T-07b** (Day 2): `switch_representado.workflow.yaml`
   - Record: Change to representado (30716395541, 33718532669)
   - Validate: 3× with different CUITs
   - Save: `fiscal_agent/workflows/arca/switch_representado.workflow.yaml`

3. **T-08a** (Day 3): `extract_deuda.workflow.yaml`
   - Record: Navigate Mis Facilidades, extract deuda JSON
   - Validate: Schema compliance, 2+ representados
   - Save: `fiscal_agent/workflows/arca/extract_deuda.workflow.yaml`

### Integration Order (After Recording)

1. **T-07c** (Day 3-4): Integrate login + switch workflows in arca_extractor.py
   - Add: `_load_workflow()`, `_run_workflow()` methods
   - Modify: `login()` → try workflow, fallback Agent
   - Test: End-to-end with real CUIT

2. **T-08b** (Day 4-5): Integrate extract_deuda in pipeline
   - Add: `extract_deuda()` method
   - Modify: Pipeline → for each representado, extract deuda
   - Test: DeudaOutput schema validation

---

## Alignment Summary

| Component | Before | After | Status |
|-----------|--------|-------|--------|
| **Design** | Agent-only approach | Workflow-First + fallback | ✅ Updated |
| **Spec** | Browser-use requirements | Workflow + Agent requirements | ✅ Updated |
| **Tasks** | T-07/T-08 (monolithic) | T-07a/b/c + T-08a/b (phased) | ✅ Updated |
| **Folder Structure** | N/A | `fiscal_agent/workflows/{arca,integration}/` | ✅ Created |
| **Documentation** | N/A | `fiscal_agent/workflows/README.md` | ✅ Created |
| **Workflow Defs** | N/A | 3 workflows documented (login, switch, deuda) | ✅ Documented |

---

## Ready Status

✅ **SDD Aligned**: All documents updated, strategy clear
✅ **Folder Structure**: fiscal_agent/workflows/ ready
✅ **Documented**: README.md with complete workflow definitions
✅ **Next Step**: Record T-07a (login_estudio.workflow.yaml)

**Timeline**: Ready to start recording phase **TODAY** (if .env configured)

---

## Key Documents for Reference

- **Sprint Planning**: [tasks.md](../../../openspec/changes/vertical-ai-agent-fiscal/tasks.md)
- **Technical Design**: [design.md](../../../openspec/changes/vertical-ai-agent-fiscal/design.md)
- **Requirements**: [spec.md](../../../openspec/changes/vertical-ai-agent-fiscal/spec.md)
- **Workflow Docs**: [fiscal_agent/workflows/README.md](../../../fiscal_agent/workflows/README.md)
- **Session Memory**: [workflow-orchestration-strategy.md](/memories/session/workflow-orchestration-strategy.md)
