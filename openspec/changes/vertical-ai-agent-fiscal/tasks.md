# Tasks: Vertical AI Agent Fiscal

## Review Workload Forecast

| Field | Value |
|-------|-------|
| Estimated changed lines | ~1500–2000 |
| 400-line budget risk | High |
| Chained PRs recommended | No |
| Suggested split | Single PR (4 sprints secuenciales) |
| Delivery strategy | single-pr |
| Chain strategy | size-exception |

Decision needed before apply: Yes
Chained PRs recommended: No
Chain strategy: size-exception
400-line budget risk: High

### Suggested Work Units

| Unit | Goal | Sprint | Notes |
|------|------|--------|-------|
| 1 | WS API → Rules Engine → PDF → Email | Sprint 1 ✅ | Pipeline calendario completo sin browser-use. Completado con mapeo IIBB, observaciones, PDF landscape |
| 2 | Browser-use (deuda real) + ajustes | Sprint 2 ← NEXT | Login estudio, switch representado, extraer deuda |
| 3 | Producción y deploy | Sprint 3 | CLI, Docker, VPS, cron, monitoreo |
| 4 | Ajustes y entrega | Sprint 4 | Edge cases, validación contador, buffer |

---

## Sprint 1: PIPELINE CALENDARIO (Días 1–7)

> Generar calendario fiscal completo desde WS API + reglas de negocio. Sin browser-use.

| ID | Nombre | Días | Dependencias | Archivos afectados | Criterio de aceptación | Prio |
|----|--------|------|--------------|-------------------|----------------------|------|
| ✅ T-01 | Setup `fiscal_agent/` y `models.py` | 1 | — | `fiscal_agent/__init__.py`, `__main__.py`, `models.py`, `pyproject.toml` | Pydantic models compilan, `python -m fiscal_agent` sin error | Alta |
| ✅ T-02 | `clients.yaml` + WS API (Padrón A5) | 1 | T-01 | `clients.yaml`, `arca_ws.py` | YAML válido + conexión WSAA + Padrón A5 exitosa. ✅ Verificado con Fittex Group SA | Alta |
| ✅ **T-03** | **Rules Engine: feriados + días hábiles + tablas AFIP** | **3** | T-02 | `rules_engine.py`, `feriados.csv`, `models.py`, `calendario_afip.json` | RulesEngine.calcular(PadronA5Output) produce calendario con vencimientos correctos por tipo contribuyente, CUIT terminación, categoría monotributo, feriados | Alta |
| ✅ **T-04** | **PDF Generator con ReportLab** | **1** | T-01 | `pdf_generator.py` | PDF con header/table/footer, filename `Calendario_{CUIT}_{YYYY-MM}.pdf` | Alta |
| ✅ **T-05** | **Email Sender SMTP** | **1** | T-01 | `email_sender.py` | Email con PDF adjunto via `smtplib`, error 1 cliente no bloquea resto | Alta |
| ✅ **T-06** | **Pipeline integrado (WS API → Rules → PDF → Email)** | **1** | T-03, T-04, T-05 | `cli.py`, `__main__.py` | Pipeline corre end-to-end para 1 cliente real: WS API → calendario → PDF → email listo | Alta |

| ✅ T-03a | Mapeo IIBB: IDs 5904 (Córdoba), 5902 (CABA), 5905 (BS AS), 5906 (Santa Fe), 215 (Acciones), 211 (BP-Acciones) | — | `rules_engine.py` | IIBB y BP-Acciones mapeados correctamente | High |
| ✅ T-03b | Observaciones para obligaciones informativas (Régimen Info 103, Participaciones Societarias 68, Estados Contables 255) | — | `rules_engine.py` | Observations aparecen en RulesOutput debajo de la tabla | High |
| ✅ T-03c | Participaciones Societarias RG 4697: fecha de vencimiento (julio según CUIT) + fuente citada | — | `rules_engine.py` | RG 4697 documentada con fecha de julio por terminación CUIT | Medium |
| ✅ T-04a | PDF rediseñado a landscape A4 con portada + calendario + página vacía para workflows | T-04 | `pdf_generator.py` | PDF horizontal de 3 páginas con estructura profesional | Medium |

> ✅ **HITO Semana 1**: Pipeline genera calendario fiscal y lo entrega por email, SIN browser-use

---

## Sprint 2: DEUDA REAL — WORKFLOWS + MATCHING + IMPORTES

> Estrategia Workflow-First: Grabar workflows determinísticos → Integrar en arca_extractor → Matching con calendario → Llenar importes

| ID | Nombre | Días | Fase | Dependencias | Archivos afectados | Criterio de aceptación | Prio |
|----|--------|------|------|--------------|-------------------|----------------------|------|
| T-07a | Grabar login_estudio.workflow.yaml | 1 | Recording | T-01 | `fiscal_agent/workflows/arca/login_estudio.workflow.yaml` | Workflow grabado, usa CSS selectors, acepta {{cuit}}/{{clave_fiscal}}, valida 3× sin fallos | Alta |
| T-07b | Grabar switch_representado.workflow.yaml | 1 | Recording | T-07a | `fiscal_agent/workflows/arca/switch_representado.workflow.yaml` | Workflow grabado, acepta {{target_cuit}}, switchea sin re-login, valida 3× | Alta |
| T-07c | Integrar workflows en arca_extractor.py | 2 | Integration | T-07b | `arca_extractor.py`, `workflow_use/workflow/executor.py` | `login()` y `switch_representado()` usan workflows primero, fallback a Agent si falla. Tests pasan. | Alta |
| T-08a | Grabar extract_deuda.workflow.yaml | 1 | Recording | T-07c | `fiscal_agent/workflows/arca/extract_deuda.workflow.yaml` | Workflow grabado, navega Mis Facilidades, extrae deuda JSON, valida 3× | Alta |
| T-08b | Integrar deuda en pipeline | 1 | Integration | T-08a | `arca_extractor.py`, `models.py` | `extract_deuda()` ejecuta workflow, output: DeudaOutput. Parsea JSON y valida schema. | Alta |
| T-09 | Matching: vincular deuda extraída con filas de page 3 | 1 | Integration | T-08b | `pdf_generator.py` o módulo nuevo | Cada deuda matchea con su concepto en la tabla (ej: "IVA Mayo" ↔ fila page 3) | Alta |
| T-10 | Llenar columna Importe en page 3 con datos matcheados | 1 | Integration | T-09 | `pdf_generator.py` | Importe se muestra en la fila correcta de la tabla | Alta |
| T-11 | Edge cases: clave expirada, 2FA, portal caído | 2 | Edge Cases | T-08b | `arca_extractor.py`, workflows error/ | Tests para escenarios ARCA-4/5/6/7 pasan, logs con mensajes esperados | Alta |
| T-12 | Validación con contador (3 clientes reales) | 2 | Validation | T-10 | — (validación) | Datos correctos para monotributo, autónomo y RI. DeudaOutput matches WS API. | Alta |
| T-13 | Buffer: bugs y ajustes finos | 1 | Buffer | T-12 | varios | Todos los bugs conocidos corregidos, pipeline estable sin regresiones | Media |

---

### 📋 DESGLOSE: T-07 Y T-08 (Workflow-First)

#### **T-07: LOGIN ESTUDIO + SWITCH REPRESENTADO**

**Fase 1: Grabación (Días 1-2)**:

##### T-07a: Grabar login_estudio.workflow.yaml
```
Acción:
  1. Inicia: python -m workflow_use record --headed --port 8888
  2. Navega: https://auth.afip.gob.ar/
  3. Espera: 3s (ARCA carga dinámicamente CUIT input)
  4. Ingresa: CUIT 20324837796
  5. Ingresa: Clave fiscal [from .env]
  6. Click: Botón "Ingresar"
  7. Espera: Título "Mis Impuestos" visible
  
Output: fiscal_agent/workflows/arca/login_estudio.workflow.yaml

Validación:
  ✓ 3 ejecuciones sin fallos
  ✓ Usa: selector: '[placeholder="CUIT"]' (CSS, no index)
  ✓ Paramétrizado: {{cuit}}, {{clave_fiscal}}
  ✓ Tiempo: <5 segundos

Criterio Aceptación: PASSED
```

##### T-07b: Grabar switch_representado.workflow.yaml
```
Prerequisito: T-07a grabado y funcionando

Acción:
  1. Inicia: login_estudio workflow (sesión activa)
  2. Navega: Selector de representados
  3. Busca: Dropdown o link "Cambiar Representado"
  4. Selecciona: CUIT 30716395541 (Gruppo Muratore)
  5. Confirma: Click/Enter
  6. Espera: Page refresh + cambio de CUIT en header
  
Output: fiscal_agent/workflows/arca/switch_representado.workflow.yaml

Validación:
  ✓ 3 ejecuciones con diferentes CUITs (30716395541, 33718532669)
  ✓ No necesita re-login
  ✓ Detecta representado activo
  ✓ Tiempo: <3 segundos

Criterio Aceptación: PASSED
```

**Fase 2: Integración (Días 2-3)**:

##### T-07c: Integrar workflows en arca_extractor.py
```
Cambios:
  1. Crear: _load_workflow(filename) → Pydantic WorkflowDefinitionSchema
  2. Crear: _run_workflow(workflow, inputs) → async executor
  3. Modificar: login() → 
        Try: workflow login_estudio
        Except: fallback a Agent (retry 3×)
        Finally: log cual ruta se usó
  4. Modificar: switch_representado() →
        Try: workflow switch_representado
        Except: fallback a Agent
  
Tests:
  ✓ login() con CUIT real → sesión activa
  ✓ switch_representado() con CUIT real → representado activo
  ✓ Ambos end-to-end para 2+ representados
  ✓ Log tracks workflow vs Agent path

Criterio Aceptación: TESTS PASSING
```

---

#### **T-08: EXTRAER DEUDA "MIS FACILIDADES"**

**Fase 1: Grabación (Día 3)**:

##### T-08a: Grabar extract_deuda.workflow.yaml
```
Prerequisito: T-07c integrado, login + switch workflows funcionando

Acción:
  1. Inicia: login + switch workflows (sesión activa en representado)
  2. Navega: "Mis Facilidades" o sección deuda
  3. Busca: Tabla con deuda actual, saldos, planes de pago
  4. Extrae: Deuda total, vencimientos, importes
  5. Captura: Page content como JSON
  
Output: fiscal_agent/workflows/arca/extract_deuda.workflow.yaml

Expected JSON structure:
  {
    "deuda_actual": 150000.00,
    "saldos": [
      { "concepto": "IVA Mayo 2026", "importe": 85000.00, "vencimiento": "2026-06-18" }
    ],
    "planes_pagos": null
  }

Validación:
  ✓ 3 ejecuciones con diferentes representados
  ✓ JSON schema valida contra DeudaOutput
  ✓ Números extraídos correctamente
  ✓ Tiempo: <8 segundos

Criterio Aceptación: PASSED
```

**Fase 2: Integración (Día 4)**:

##### T-08b: Integrar deuda en pipeline
```
Cambios:
  1. Crear: extract_deuda() método async
  2. Modificar: Pipeline → login → switch → extract_deuda para cada representado
  3. Crear: Mapeo JSON → DeudaOutput Pydantic
  4. Validar: Schema compliance
  
Pipeline flow:
  for client in clients:
    deuda_output = await arca_extractor.login()
    for representado in client.representados:
      await arca_extractor.switch_representado(representado.cuit)
      deuda = await arca_extractor.extract_deuda()  ← T-08b
      client.deuda_list.append(deuda)
  
Tests:
  ✓ extract_deuda() output matches DeudaOutput schema
  ✓ Deuda data correct vs manual ARCA check
  ✓ Pipeline end-to-end: login → switch → deuda OK

Criterio Aceptación: TESTS PASSING + MANUAL VALIDATION
```

---

### 📊 Tabla Comparativa: Workflows vs Agent

| Aspecto | Recorded Workflow | LLM Agent |
|---------|-------------------|-----------|
| **Velocidad** | 10-100× rápido | Lento (latencia LLM) |
| **Costo** | $0 | $$ tokens |
| **Precisión** | 99.9% (replay grabado) | 85-95% (alucinaciones) |
| **Selectores** | CSS (`selector:` field) | Índices rotos (`index:`) ❌ |
| **Debugging** | Pasos explícitos | Difícil trazar LLM |
| **Mantenimiento** | Re-grabar si ARCA cambia UI | Adapta pero lento |
| **Cost per run** | Free | ~$0.01-0.05 por login |

---

### ✅ Hito Sprint 2

**T-07a/b**: Workflows grabados y validados (Día 2)
**T-07c**: Integrados en arca_extractor.py (Día 3)
**T-08a**: Workflow deuda grabado y validado (Día 3)
**T-08b**: Deuda integrada en pipeline (Día 4)
**T-09/T-10**: Matching + importes (Días 5-6)
**T-11/T-12**: Edge cases + validación real (Días 7-9)
**T-13**: Buffer (Día 10)

> ✅ **HITO FIN SPRINT 2 (Día 10)**: Pipeline completo con deuda real, workflows grabados, validado con contador

---

---

## Sprint 3: PRODUCCIÓN (Días 15–21)

| ID | Nombre | Días | Dependencias | Archivos afectados | Criterio de aceptación | Prio |
|----|--------|------|--------------|-------------------|----------------------|------|
| T-13 | CLI Typer (`run --config`) | 1 | T-09 | `cli.py` | `python -m fiscal_agent run --config clients.yaml` ejecuta pipeline completo | Alta |
| T-14 | Dockerfile (Python + Playwright) | 1 | T-13 | `Dockerfile` | Build exitoso, Playwright + deps instaladas, entrypoint funciona | Alta |
| T-15 | Setup VPS Hetzner CX22 | 1 | T-14 | — (infra) | Python 3.12 + Playwright + dependencias instaladas | Alta |
| T-16 | Deploy proyecto en VPS | 1 | T-15 | — (deploy) | `python -m fiscal_agent run` funciona en VPS con clientes reales | Alta |
| T-17 | Scheduler cron ejecución mensual | 1 | T-16 | — (cron) | Cron ejecuta pipeline automáticamente, logs con timestamp | Alta |
| T-18 | Monitoreo + log de ejecución | 1 | T-16 | `cli.py` | Log por cliente con OK/error, alerta en fallo general | Media |

> ✅ **HITO Semana 3**: Sistema corriendo en VPS con los clientes del estudio

---

## Sprint 4: AJUSTES FINALES (Días 22–30)

| ID | Nombre | Días | Dependencias | Archivos afectados | Criterio de aceptación | Prio |
|----|--------|------|--------------|-------------------|----------------------|------|
| T-19 | Prueba scheduler: 3 ejecuciones automáticas | 2 | T-17 | — (testing) | 3 ejecuciones exitosas consecutivas sin intervención manual | Alta |
| T-20 | Buffer: bugs de producción | 3 | T-19 | varios | Todos los bugs conocidos corregidos, pipeline estable sin regresiones | Media |
| T-21 | Entrega + documentación estudio contable | 1 | T-20 | — (docs) | Estudio puede operar el sistema sin asistencia técnica | Alta |

> ✅ **HITO Semana 4**: Entregar al estudio contable

---

## Dependencies Graph

```
T-01 ─┬─ T-02
      │
      ├─ T-03 ─── T-06 ─┐
      ├─ T-04 ──────────┤
      └─ T-05 ──────────┤
                         T-09 ─ T-13 ─ T-14 ─ T-15 ─ T-16 ─┬─ T-17 ─ T-19 ─ T-20 ─ T-21
                                                             └─ T-18
T-07 ─ T-08 ─ T-09 ─ T-10 ─ T-11 ─ T-12
```

## Risk-Adjusted Timeline

| Sprint | Días calendario | Días buffer | Riesgo clave | Mitigación |
|--------|----------------|-------------|--------------|------------|
| 1 | 7 | 0 | Tablas AFIP incompletas | El contador está buscando las tablas; diseño permite actualizarlas sin cambiar código |
| 2 | 9 | 2 (T-12) | Selectores ARCA cambian, 2FA inesperado | Log claros, skip + alerta, retry 3× backoff |
| 3 | 7 | 1 (T-18) | Playwright headless falla en VPS | Dockerfile con `playwright install --with-deps`, test local pre-deploy |
| 4 | 6 | 3 (T-20) | Bugs imprevistos, fechas incorrectas | Buffer de 3 días dedicado a correcciones |

- **Riesgo reducido**: Sprint 1 no usa browser-use → eliminamos el riesgo de selectores ARCA, 2FA, portal caído. El calendario se genera 100% con reglas de negocio.
- **Complejidad**: Baja-media. Reglas de negocio son condicionales directos (sin LLM). PDF y email son estándar. Browser-use queda para Sprint 2 con más tiempo y menos presión.

## Review Workload Narrative

- **Líneas nuevas**: ~1200–1600 (menos que antes porque el browser-use se simplifica)
- **Estrategia PR**: Single PR con size-exception. Los sprints son fases del mismo cambio.
- **Size exception**: Requiere aprobación del maintainer para exceder el límite de 400 líneas por PR.
