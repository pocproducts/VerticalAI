# Fiscal Agent · Vertical AI

<p align="center">
  <strong>Agente fiscal autónomo para estudios contables</strong><br>
  Conecta tu estudio con ARCA. Automatiza consultas, cálculos, extracciones e informes.<br>
  Consumí todo el pipeline fiscal desde CLI, REST API o agentes de IA vía MCP.
</p>

---

## Misión

Eliminar la carga operativa de la gestión fiscal. Cada mes, los estudios contables invierten horas en entrar a ARCA, consultar CUIT por CUIT, calcular vencimientos, extraer deuda, descargar planes de pago, y armar informes. **Fiscal Agent automatiza todo eso.** Un solo comando (o una llamada de API, o un mensaje a un LLM) ejecuta el pipeline completo para todos los clientes del estudio.

## Visión

Ser la capa de inteligencia fiscal que conecta estudios contables con ARCA, reemplazando clicks manuales por agentes autónomos. No solo automatizar lo que ya se hace, sino **repensar cómo se consume la información fiscal**:

- **Hoy**: un contador entra a ARCA, navega menús, exporta PDFs, arma informes a mano.
- **Mañana**: un AI agent consulta el estado fiscal de cualquier cliente en segundos, recibe respuestas estructuradas, y accede a todo el pipeline desde herramientas conversacionales.

Fiscal Agent expone el pipeline fiscal en **tres interfaces complementarias**, cada una para un público distinto:

| Interfaz | Público | Uso |
|----------|---------|-----|
| **CLI** | Contadores, DevOps | Comandos directos en terminal, pipelines batch |
| **REST API** | Integraciones, sistemas | Endpoints HTTP con auth, para apps y microservicios |
| **MCP Server** | AI Agents | Tools consumibles por Claude Desktop, Cline, y cualquier LLM |

---

## Capacidades actuales

### Pipeline fiscal completo

```
┌──────────┐    ┌──────────────┐    ┌────────────────┐    ┌──────┐    ┌───────┐
│  ARCA WS  │───→│ Rules Engine │───→│ Browser Agent  │───→│ PDF  │───→│ Email │
│ (Padrón)  │    │ (Vencimientos)│    │ (Deuda/Planes) │    │      │    │       │
└──────────┘    └──────────────┘    └────────────────┘    └──────┘    └───────┘
```

Cada etapa del pipeline es independiente y reutilizable:

| Etapa | Qué hace | Fuente |
|-------|----------|--------|
| **WS API** | Consulta el Padrón A5 de ARCA (datos del contribuyente, impuestos, actividades) | Certificados digitales |
| **Rules Engine** | Calcula vencimientos según tipo de contribuyente, provincias, Convenio Multilateral | Calendario AFIP |
| **Browser Agent** | Extrae deuda real, planes de pago y registro tributario navegando ARCA vía AI agent | Composio Browser |
| **PDF Generator** | Genera informe fiscal profesional con headers de sección y tablas formateadas | ReportLab |
| **Email Sender** | Envía el informe al cliente vía SMTP | Configurable |

### ① CLI (Typer)

```bash
uv run python -m fiscal_agent run                # Pipeline completo para todos los clientes
uv run python -m fiscal_agent report              # Informe interactivo para un cliente
uv run python -m fiscal_agent validate            # Validar clients.yaml
uv run python -m fiscal_agent discover [cuit]     # Descubrir datos desde Padrón A5
uv run python -m fiscal_agent deuda               # Extraer deuda vía browser
```

### ② REST API (FastAPI)

| Endpoint | Descripción | Auth |
|----------|-------------|------|
| `POST /v1/calendar` | Calendario de vencimientos para un CUIT | Scope `calendar:read` |
| `GET /v1/taxpayer/{cuit}` | Datos del contribuyente desde Padrón A5 | Scope `taxpayer:read` |
| `POST /v1/extract` | Extracción vía browser agent | Scope `taxpayer:read` |
| `POST /v1/report` | Pipeline completo + PDF + email | Scope `report:write` |
| `GET /v1/health` | Health check | Público |

Seguridad: API Key via `Authorization: Bearer`, rate limiting por plan, scopes granulares por endpoint. Administración de keys vía endpoints `/v1/admin/*`.

### ③ MCP Server (Model Context Protocol)

Nueve tools consumibles por **Claude Desktop, Cline, Cursor, o cualquier LLM** que implemente MCP:

| Tool | Descripción |
|------|-------------|
| `get_calendar` | Calcula calendario de vencimientos |
| `get_taxpayer` | Consulta datos del contribuyente |
| `extract_deuda` | Extrae deuda real vía browser |
| `extract_facilidades` | Extrae planes de pago |
| `extract_registro` | Extrae registro tributario |
| `run_pipeline` | Ejecuta pipeline completo + PDF |
| `get_report_pdf` | Genera PDF de reporte |
| `match_rentas_cordoba` | Evalúa integración con Rentas Córdoba |
| `health` | Health check del servidor |

Dos modos de conexión:

```bash
# STDIO (default) — local, sin configuración, para Claude Desktop
uv run python -m fiscal_agent mcp

# HTTP/SSE — remoto, con API keys y rate limiting
MCP_TRANSPORT=http uv run python -m fiscal_agent mcp
```

---

## Arquitectura

```
fiscal_agent/
├── cli.py                   # CLI entry point + pipeline orchestrator
├── models.py                # Modelos Pydantic v2 (UnifiedResponse, DeudaOutput, etc.)
├── __main__.py              # Entry point: dispatchea a CLI o MCP
│
├── arca_ws.py               # WS ARCA: consultar_cuit(), obtener_ta()
├── rules_engine.py          # Cálculo de vencimientos fiscales
├── pdf_generator.py         # Generación de PDF con ReportLab
├── email_sender.py          # Envío de emails vía SMTP
├── matching.py              # Matching Rentas Córdoba
│
├── browser/                 # Browser automation layer
│   ├── composio.py          # ComposioBrowser: orquestador de AI agents
│   └── task.py              # FullTask, FacilidadesTask, RegistroTask
│
├── api/                     # REST API (FastAPI)
│   ├── server.py            # FastAPI app + routers
│   ├── deps.py              # Singletons: engine, pdf_gen, TA cache
│   ├── auth.py              # ScopeRequired middleware
│   ├── store.py             # In-memory store (developers, apps, keys)
│   ├── rate_limiter.py      # Fixed-window rate limiter
│   └── routes/              # health, calendar, report, extract, admin
│
└── mcp/                     # MCP Server (FastMCP)
    ├── server.py            # FastMCP app + lifespan context
    ├── transport.py         # STDIO / HTTP dispatcher + auth middleware
    └── tools/               # 9 tool functions
        ├── calendar.py      # get_calendar
        ├── taxpayer.py      # get_taxpayer
        ├── deuda.py         # extract_deuda
        ├── facilidades.py   # extract_facilidades
        ├── registro.py      # extract_registro
        ├── pipeline.py      # run_pipeline
        ├── report.py        # get_report_pdf
        ├── rentas.py        # match_rentas_cordoba
        └── health.py        # health
```

### Stack

| Componente | Tecnología |
|-----------|------------|
| Lenguaje | Python 3.11+ |
| CLI | Typer |
| API REST | FastAPI |
| MCP Server | FastMCP (mcp>=1.27) |
| Validación | Pydantic v2 |
| WS ARCA | requests + cryptography (certificados) |
| Browser automation | Composio (AI agents) |
| PDF | ReportLab |
| Auth | API Keys via Bearer token (SHA256) |
| Rate limiting | Fixed-window in-memory |

---

## Roadmap

### ✅ Completado

| Fase | Feature | Estado |
|------|---------|--------|
| **Fase 0** | Foundation — UnifiedResponse, tenant/identity models, idempotency contract | ✅ |
| **Fase 1** | API Layer — FastAPI server con 5 endpoints REST | ✅ |
| **Fase 2** | Platform Layer — API Key auth, scopes, rate limiting, admin endpoints | ✅ |
| **Fase 3** | MCP Server — 9 tools MCP, STDIO + HTTP, integración con auth de Fase 2 | ✅ |

### 🔜 Próximas features

| Feature | Descripción |
|---------|-------------|
| **x402 Payments** | Integración con protocolo x402 para pagos on-chain |
| **Multi-tenant** | Separación completa de clientes por tenant con aislamiento de datos |
| **Cost Tracking** | Tracking de uso por API key, costos por consulta, reporting |

### 🧠 Ideas en exploración

- Integración con Rentas Córdoba (matching ya implementado)
- Webhook notifications para eventos fiscales
- Dashboard web con métricas de uso
- Exportación a sistemas contables (BALANZ, Siare, etc.)

---

## Producción

Fiscal Agent está listo para su **primera fase productiva**. El pipeline core está probado con clientes reales: consulta a ARCA, extracción vía browser agent, generación de PDFs profesionales, y envío por email. Las interfaces REST y MCP permiten integrarse con cualquier sistema o agente de IA.

Para usar en producción necesitás:

1. **Certificados digitales ARCA** en `.certificados-arca/`
2. **Archivo `clients.yaml`** con los clientes del estudio
3. **Configuración SMTP** en `.env` (para envío de emails)

---

<p align="center">
  <strong>Vertical AI</strong> · Agente Fiscal<br>
  <sub>Automatización inteligente para estudios contables</sub>
</p>
