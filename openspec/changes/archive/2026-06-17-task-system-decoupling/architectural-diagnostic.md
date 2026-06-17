# Diagnóstico Arquitectónico — Fiscal-Agent

> Fecha: 2026-06-17
> Contexto: Exploración de adentro hacia afuera del monolito. SDD cycle `task-system-decoupling`.
> Objetivo: Documentar la arquitectura actual y la deuda técnica para guiar refactors futuros sin romper la POC.

---

## 1. Arquitectura Actual (Monolito)

```
                    ┌───────────────────────────────────────────────┐
                    │                  CLI (Typer)                   │
                    │  (run / report / deuda / discover / validate) │
                    │        ← ES EL ORQUESTADOR REAL →             │
                    └──────┬──────────┬──────────┬──────────────────┘
                           │          │          │
              ┌────────────┘          │          └──────────────┐
              ▼                       ▼                       ▼
     ┌─────────────────┐   ┌─────────────────┐   ┌──────────────────────┐
     │  API REST        │   │  MCP Server      │   │  Browser Tasks      │
     │  (FastAPI)       │   │  (STDIO/HTTP)    │   │  (Composio)         │
     │  /v1/*           │   │  tools/*         │   │  task.py, composio  │
     └────────┬─────────┘   └────────┬─────────┘   └──────────┬───────────┘
              │                      │                        │
              └──────────┬───────────┘                        │
                         │                                    │
                         ▼                                    ▼
              ┌────────────────────┐   ┌──────────────────────────────┐
              │  Pipeline Core     │   │  Rules Engine + Matching     │
              │  _procesar_cliente │   │  calendario_afip.json        │
              │  _pipeline()       │   │  feriados.csv                │
              │  (vive en cli.py)  │   └──────────────────────────────┘
              └────────┬───────────┘
                       │
          ┌────────────┼────────────┬──────────────┐
          ▼            ▼            ▼              ▼
   ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌──────────────┐
   │ WS ARCA  │ │ PDF Gen  │ │ Email    │ │ Memory       │
   │ SOAP A5  │ │ReportLab │ │ SMTP     │ │ Engram+Redis │
   └──────────┘ └──────────┘ └──────────┘ └──────────────┘
```

### Capas identificadas

| Capa | Módulo | Rol |
|------|--------|-----|
| **Core Models** | `models.py` | Pydantic: PadronA5Output, ClientConfig, DeudaOutput, RulesOutput, UnifiedResponse |
| **WS ARCA** | `arca_ws.py` | WSAA (TA) + Padrón A5 (SOAP/XML) |
| **Rules Engine** | `rules_engine.py` | Calendario de vencimientos (determinístico, basado en JSON + CSV) |
| **PDF** | `pdf_generator.py` | Generación de PDFs con ReportLab |
| **Email** | `email_sender.py` | Envío SMTP |
| **Matching** | `matching.py` | Rentas Córdoba (en desarrollo, solo diagnóstico) |
| **Browser** | `browser/` | Composio Browser Tool: tasks de navegación NL |
| **Memory** | `memory/` | Engram + Redis cache |
| **CLI** | `cli.py` | Typer commands + pipeline orquestador |
| **API** | `api/` | FastAPI REST endpoints |
| **MCP** | `mcp/` | MCP server + tools |
| **Config** | `config.py` | Settings desde .env |
| **Tasks (nuevo)** | `tasks/` | BaseTask, ApiTask, PadronApiTask (creado en este ciclo) |

---

## 2. Flujo de Datos del Pipeline

```
ENTRADA: clients.yaml (lista de clientes con CUIT, clave_fiscal, email, provincias)
                │
                ▼
┌─ 1. Obtener TA (WSAA SOAP) ───────────────────────────────────────────┐
│   token, sign = obtener_ta('ws_sr_constancia_inscripcion', cert, key) │
└───────────────────────────────────────────────────────────────────────┘
                │
                ▼
┌─ 2. Por cada cliente ─────────────────────────────────────────────────┐
│                                                                        │
│  ┌─ 2a. Memory: check historial de padrón ──────────────────────────┐ │
│  │   memory.get_padron_history(cuit)                                 │ │
│  └───────────────────────────────────────────────────────────────────┘ │
│                                                                        │
│  ┌─ 2b. WS ARCA: Padrón A5 (SOAP XML) ─────────────────────────────┐ │
│  │   PadronA5Result = consultar_cuit(cuit, token, sign, rep_cuit)   │ │
│  │   PadronA5Output = result.to_output() (Pydantic)                 │ │
│  │   memory.save_padron_result(...)                                 │ │
│  └───────────────────────────────────────────────────────────────────┘ │
│                                                                        │
│  ┌─ 2c. Auto-complete cliente desde padrón ─────────────────────────┐ │
│  │   _completar_cliente_desde_padron() → nombre, tipo, provincia    │ │
│  └───────────────────────────────────────────────────────────────────┘ │
│                                                                        │
│  ┌─ 2d. Rules Engine: Calendario ───────────────────────────────────┐ │
│  │   RulesOutput = engine.calcular(padron_output, mes, anio, prov)  │ │
│  │   SI vencimientos == 0 → return (sin PDF)                        │ │
│  └───────────────────────────────────────────────────────────────────┘ │
│                                                                        │
│  ┌─ 2e. Composio Browser (solo si flags activos) ───────────────────┐ │
│  │   tasks = [VencimientosDeudasTask, FacilidadesTask, ...]          │ │
│  │   DeudaOutput = browser.run_single(cliente, tasks=tasks)         │ │
│  │   SI error → browser_failed=True, saltea PDF/Email               │ │
│  │   memory.save_extraction_result(...) por tipo                    │ │
│  └───────────────────────────────────────────────────────────────────┘ │
│                                                                        │
│  ┌─ 2f. Rentas Córdoba Matching (si browser OK) ────────────────────┐ │
│  │   evaluar_rentas_cordoba(provincias, impuestos_ws, registro)     │ │
│  └───────────────────────────────────────────────────────────────────┘ │
│                                                                        │
│  ┌─ 2g. PDF Generator ──────────────────────────────────────────────┐ │
│  │   pdf_path = pdf_gen.generar(nombre, cuit, vencimientos,         │ │
│  │                               mes, anio, deuda=...,              │ │
│  │                               rentas_matching=...)               │ │
│  │   memory.save_pdf_sent(...)                                       │ │
│  └───────────────────────────────────────────────────────────────────┘ │
│                                                                        │
│  ┌─ 2h. Email (si aplica) ──────────────────────────────────────────┐ │
│  │   EmailSender.enviar(cliente, pdf_path, mes, anio)               │ │
│  │   memory.save_pdf_sent(...)                                       │ │
│  └───────────────────────────────────────────────────────────────────┘ │
│                                                                        │
└───────────────────────────────────────────────────────────────────────┘
```

---

## 3. Deuda Técnica — Priorizada

### 🔴 CRÍTICA — Resolver antes de nuevas features

| # | Problema | Dónde | Impacto |
|---|----------|-------|---------|
| 1 | **CLI es el orquestador** | `cli.py:130-343` | `_procesar_cliente_pipeline()` vive en un archivo de CLI. API y MCP importan lógica desde ahí. Cambios cosméticos al CLI pueden romper producción. No hay service layer separado. |
| 2 | **Browser extraction duplicado** | `mcp/tools/deuda.py`, `facilidades.py`, `registro.py` + `cli.py:210` | 4 lugares replican el patrón crear task → run_single → memory save. Cada cambio en BrowserTask requiere modificar 4 archivos. |

### 🟡 MEDIA — Resolver en el próximo ciclo SDD

| # | Problema | Dónde | Impacto |
|---|----------|-------|---------|
| 3 | **Pipeline paralelo en `deuda`** | `cli.py:700-776` | Comando `deuda` tiene su propio pipeline que no pasa por `_procesar_cliente_pipeline`. Código duplicado que se desvía del principal. |
| 4 | **MCP tools acceden a privados** | `mcp/tools/memory.py` | Usa `_engram_post`, `_session_cache`, `_cuit_session_id` — implementation details del MemoryClient. |
| 5 | **Resultados del pipeline en `dict`** | `cli.py:158-167` | Pipeline retorna `dict` crudo sin schema Pydantic. Consumidores parsean a mano. Propenso a errores. |

### 🟢 BAJA — Resolver cuando se toque el área

| # | Problema | Dónde | Impacto |
|---|----------|-------|---------|
| 6 | **Constantes duplicadas** | `cli.py:42-45` y `api/deps.py:24-27` | CERT_PATH, REPRESENTANTE_CUIT definidos en 2 archivos. |
| 7 | **TA cache separado** | CLI siempre pide TA fresco | API/MCP cachean con TTL 11h. CLI pide 2 TAs por cliente. Ineficiente. |

### ⚪ INFORMATIVA — No urgente

| # | Problema | Dónde | Impacto |
|---|----------|-------|---------|
| 8 | **Auth desactivada** | `api/store.py`, `api/rate_limiter.py` | Código escrito pero no conectado. "auth removed temporarily". |
| 9 | **PipelineStep sin uso** | `tasks/base.py:46-70` | Creado en el rename, nunca se usa. Raisea NotImplementedError. |

---

## 4. Dependencias entre deudas

```
#1 CLI como orquestador
  ├── resuelve → #3 (deuda command puede reusar el service)
  ├── resuelve → #5 (el service devuelve PipelineResult Pydantic)
  └── resuelve → #6 (constantes van a config.py)
        │
        ▼
#2 Browser factory
  └── depende de → #1 (usa el mismo service layer)
        │
        ▼
#7 TA cache (independiente, fácil)
#4 Privados memory (independiente, cuando se toque)
#8 Auth (independiente, decisión de negocio)
#9 PipelineStep (independiente, cuando se refactoree tasks)
```

**Conclusión**: Resolver #1 (pipeline service) habilita automáticamente #3, #5, #6. Es el cuello de botella arquitectónico.

---

## 5. Estrategia de Refactor Sin Romper la POC

### Principios

1. **Additivo, no sustractivo**: El código nuevo coexiste con el viejo. No se elimina nada hasta que los 3 entry points (CLI, API, MCP) usen el nuevo service.
2. **Backward compatibility**: `_procesar_cliente_pipeline()` original se mantiene como wrapper hasta la próxima release mayor. El nuevo `PipelineService` se crea en un módulo nuevo.
3. **Pruebas continuas**: Después de cada cambio incremental, `run` y `report` deben producir exactamente el mismo output que antes.

### Plan de ejecución propuesto

```
Fase 1: Pipeline Service (resuelve #1, #3, #5, #6)
  ├── Crear fiscal_agent/pipeline/__init__.py
  ├── Crear fiscal_agent/pipeline/service.py (PipelineService con run_pipeline())
  ├── Crear fiscal_agent/pipeline/models.py (PipelineResult Pydantic)
  ├── Mover constantes a config.py
  ├── Refactor CLI: comandos delegan a PipelineService
  └── Refactor API + MCP: importan PipelineService en vez de cli.py

Fase 2: Browser Factory (resuelve #2)
  ├── Crear fiscal_agent/browser/factory.py
  ├── build_browser_tasks(flags, cuit, clave) → list[BrowserTask]
  ├── CLI usa factory
  └── MCP tools usan factory

Fase 3: Memory Client cleanup (resuelve #4)
  ├── Exponer métodos públicos en FiscalMemoryClient
  └── MCP tools dejan de usar _privados

Fase 4: Auth (resuelve #8 - si se decide)
  ├── Conectar RedisStore + rate limiter
  └── Documentar breaking changes

Fase 5: PipelineStep cleanup (resuelve #9)
  ├── Implementar o eliminar PipelineStep
  └── Decidir si ApiTask se integra en el pipeline o queda standalone
```

---

## 6. Riesgos de la Refactor

| Riesgo | Probabilidad | Mitigación |
|--------|-------------|------------|
| Romper API endpoints que consumen el dict crudo del pipeline | Media | Crear PipelineResult manteniendo los mismos field names del dict actual, más validated |
| `_procesar_cliente_pipeline()` tiene efectos secundarios (memory saves) | Media | Extraer primero la lógica pura, después los efectos secundarios como plugins |
| `report` y `run` tienen lógica divergente (output_dir) | Baja | Documentar la divergencia y unificar en el service |
| MCP tools con `None` como cliente | Baja | Refactorizar `run_single` para aceptar cuit en lugar de ClientConfig |

---

## 7. Próximos Pasos

1. ✅ **Completado**: Diagnóstico arquitectónico (este documento)
2. ⏳ **Pendiente**: SDD `pipeline-service-extraction` 
3. ⏳ **Pendiente**: SDD `browser-task-factory`
4. ⏳ **Pendiente**: SDD `memory-client-cleanup`

> Cada uno de estos SDD debe comenzar con `/sdd-new` y usar este diagnóstico como referencia.
