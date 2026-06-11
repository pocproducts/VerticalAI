# Design: Vertical AI Agent Fiscal

## Technical Approach

Pipeline en 2 tracks paralelos:

**Track principal (Sprint 1)**: WS API → Rules Engine → PDF → Email. Sin browser-use, sin navegación. ✅ COMPLETADO
**Track complementario (Sprint 2)**: **Workflow-First** login estudio → switch representado → deuda real. LLM Agent como fallback.

Sin DB, sin LLM en reglas de negocio. Cada etapa itera clientes con aislamiento de errores. CLI via Typer, config YAML, file-based storage.

**Track principal — Pipeline calendario**:
1. **WS API (Padrón A5)**: datos estructurados del contribuyente vía WSAA + SOAP. Devuelve tipo persona, denominación, domicilio, actividades, impuestos inscriptos, categoría monotributo, cierre ejercicio.
2. **Rules Engine**: consume `PadronA5Output` DIRECTAMENTE y genera el calendario fiscal completo del mes. Aplica feriados argentinos, tabla CUIT terminación, tabla por categoría monotributo, tabla por tipo de impuesto. NO es un fallback — es la fuente primaria de vencimientos.
3. **PDF + Email**: generan y entregan el calendario.

**Track complementario — Deuda real (Sprint 2)**: **WORKFLOW-FIRST + AGENT FALLBACK**
1. **Recorded Workflows** (determinísticos):
   - `login_estudio.workflow.yaml`: Navega ARCA, ingresa CUIT + clave, verifica login exitoso
   - `switch_representado.workflow.yaml`: Cambia entre representados sin re-login
   - `extract_deuda.workflow.yaml`: Navega Mis Facilidades, extrae deuda JSON
   - Grabados con browser-use Recorder, usa selectores CSS (no índices)
   - $0 costo, 10-100× más rápido que Agent, 99.9% preciso

2. **LLM Agent Fallback** (edge cases):
   - Si workflow falla → Agent toma control
   - Maneja variantes UI, 2FA, captchas (futuros)
   - Retry con backoff 3× (5s, 15s, 45s)

3. **Data Integration**:
   - DeudaOutput de workflows + PadronA5Output de WS API
   - Matching: deuda con calendarios (T-09)
   - Llenar importes en PDF (T-10)

## Architecture Decisions

| Opción | Tradeoff | Decisión |
|--------|----------|----------|
| Extracción: browser-use Agent vs Recorded Workflows | Agent (LLM) = flexible pero lento, costoso, index-based detection falla. Workflows = determinístico, $0 cost, CSS selectors. | **Workflow-First** (grabado): login, switch, deuda. Agent fallback para edge cases (2FA, UI changes). Mejor de ambos mundos. |
| Workflows: índices vs selectores | Índices (index: 2) = rápido pero frágil. Selectores CSS (selector: 'button[type="submit"]') = robusto, estable. | CSS selectors en todos los workflows. Estables ante cambios DOM. |
| Grabación: manual vs automática | Manual = control total, quality control. Automática = más rápido pero puede grabar pasos innecesarios. | Manual: Grabamos login, switch, deuda con RecordingService headed. Validamos 3× antes de integrar. |
| Almacenamiento workflows: Git vs dynamodb | Git = versionable, auditable. DynamoDB = serverless pero sin control. | Git: `fiscal_agent/workflows/arca/*.yaml`. Versionable, revisable, reutilizable. |
| Models compartidos vs duplicados | Pydantic models en `models.py` vs cada módulo con su dict | Pydantic centralizado: validación en fronteras, tipado fuerte entre etapas |
| Holidays: CSV vs dict embebido | CSV permite edición sin release, dict evita file I/O | CSV en `fiscal_agent/feriados.csv`. Se actualiza 1×/año, manual |
| Browser-use headless vs headed | Headless para CI/prod, headed debug para desarrollo | Headless default, flag `--headed` via CLI para debug. Grabación siempre `--headed` |
| Email: error parcial vs fallo total | `smtplib` por cliente vs lote completo | Un email por conexión SMTP. Falla un cliente → log, sigue el resto |
| CLI como `python -m fiscal_agent` vs subcomando de cli.py | Proyecto autocontenido vs integrado al CLI existente | Módulo independiente `python -m fiscal_agent run`. No toca `cli.py`. Desacopla completamente |
| Deuda: WS API vs browser-use | WS API (Padrón A5) da datos estructurados sin navegación. Browser-use captura lo que API no expone (deuda, vencimientos reales). | **Híbrido**: WS API = fuente primaria (tipo, impuestos). Workflows = deuda real (complementario). |

## Data Flow

```
                                   clients.yaml
                                       │
                                       ▼
                          ┌──────────────────────────────┐
                          │  [fiscal_agent/cli.py]       │
                          │  Lee YAML, valida, itera     │
                          └────────────┬─────────────────┘
                                       │
                          ┌────────────▼─────────────────┐
                          │  TRACK PRINCIPAL (Sprint 1)   │
                          │  Pipeline Calendario          │
                          └────────────┬─────────────────┘
                                       ▼  (por cliente)
                          ┌──────────────────────────────┐
                          │  [arca_ws.py] — WS API       │
                          │  WSAA → TA (token+sign)       │
                          │  Padrón A5: getPersona(CUIT)  │
                          │  → PadronA5Output             │
                          │  (sin navegación, sin clave)  │
                          └────────────┬─────────────────┘
                                       ▼
                          ┌──────────────────────────────┐
                          │  [rules_engine.py]            │
                          │  calcular(PadronA5Output)     │
                          │  → RulesOutput (vencimientos) │
                          │  Basado en: impuestos[],      │
                          │  categoría, CUIT term,        │
                          │  feriados, provincias         │
                          └────────────┬─────────────────┘
                                       ▼
                          ┌──────────────────────────────┐
                          │  [pdf_generator.py]           │
                          │  → Calendario_{CUIT}_*.pdf    │
                          └────────────┬─────────────────┘
                                       ▼
                          ┌──────────────────────────────┐
                          │  [email_sender.py]            │
                          │  → Email con PDF adjunto      │
                          └────────────┬─────────────────┘
                                       ▼
                          ┌──────────────────────────────┐
                          │  ✅ CALENDARIO ENTREGADO      │
                          └──────────────────────────────┘

  TRACK COMPLEMENTARIO (Sprint 2): WORKFLOW-FIRST + AGENT FALLBACK

  clients.yaml
      │
      ▼
  [arca_extractor.py] — Orquestador
      │
      ├─→ Login Estudio (T-07a)
      │   │
      │   ├─→ Try: Load workflows/arca/login_estudio.workflow.yaml
      │   │    │  Input: cuit, clave_fiscal
      │   │    │  Uses: CSS selectors (no índices)
      │   │    │  Cost: $0, 10-100× rápido
      │   │    ▼
      │   │   ✅ Session active → proceed
      │   │
      │   └─→ Except: Fallback LLM Agent
      │        │  Retry 3× con backoff (5s, 15s, 45s)
      │        │  Detecta: ARCA-4 (credenciales), ARCA-6 (2FA)
      │        ▼
      │       ✅ o ❌ Skip + log
      │
      ├─→ Switch Representado (T-07b)
      │   │
      │   └─→ Load workflows/arca/switch_representado.workflow.yaml
      │        │  Input: target_cuit
      │        │  Output: switched without re-login
      │        ▼
      │       ✅ Representado activo
      │
      ├─→ Extraer Deuda (T-08)
      │   │
      │   └─→ Load workflows/arca/extract_deuda.workflow.yaml
      │        │  Navigate: Mis Facilidades
      │        │  Extract: deuda, saldos, planes pagos
      │        │  Output: DeudaOutput JSON
      │        ▼
      │       ✅ DeudaOutput → integración
      │
      └─→ Integración (T-09, T-10)
          │
          └─→ Matching: deuda con calendario
              │  Llenar importes en PDF
              ▼
             ✅ PDF con deuda real completado
```
```

## Module Structure

### `fiscal_agent/models.py` — Pydantic contracts

```python
# @dataclass alternatives considered, Pydantic wins for validation
from __future__ import annotations
from datetime import date, datetime
from enum import Enum
from typing import List, Optional
from pydantic import BaseModel, Field

class TipoContribuyente(str, Enum):
    monotributo = 'monotributo'
    autonomo = 'autonomo'
    responsable_inscripto = 'responsable_inscripto'

class TipoPersona(str, Enum):
    fisica = 'fisica'
    juridica = 'juridica'

class SmtpConfig(BaseModel):
    host: str
    port: int = 587
    user: str
    password: str
    from_addr: str

class ClientConfig(BaseModel):
    cuit: str
    clave_fiscal: str
    tipo: TipoContribuyente
    email: str
    nombre: str
    tipo_persona: Optional[TipoPersona] = None     # solo RI
    cierre_ejercicio: Optional[int] = None         # mes cierre (default: 12)
    provincias: Optional[List[str]] = None          # Convenio Multilateral

class AppConfig(BaseModel):
    smtp: SmtpConfig
    clientes: List[ClientConfig]

class ArcaOutput(BaseModel):
    cuit: str
    tipo: str
    extracted_at: datetime
    datos: dict = {}              # flexible: varía por tipo contribuyente
    error: str | None = None

class Vencimiento(BaseModel):
    concepto: str
    fecha: date
    importe: float | None = None
    es_fecha_habil: bool = True

class RulesOutput(BaseModel):
    cuit: str
    periodo: str              # "2026-06"
    vencimientos: list[Vencimiento]
    feriados_presentes: list[date]
    error: str | None = None
```

### `fiscal_agent/arca_ws.py` — WS API ARCA (WSAA + Padrón A5)

```
- obtener_ta(service: str, cert: bytes, key: bytes) → tuple[str, str]
  → WSAA login: token + sign CMS
- consultar_cuit(cuit: str, token: str, sign: str, cuit_representante: str) → PadronA5Result
  → Padrón A5: getPersona SOAP → parser XML completo
- PadronA5Result: parser con 14+ modelos Pydantic anidados
  → DatosGenerales, DomicilioFiscal, ActividadEconomica, ImpuestoInscripto,
    CategoriaContribuyente, RegimenInscripto, DatosRegimenGeneral,
    DatosMonotributo, ErrorConstancia, ErrorSeccion, MetadataRespuesta
- _build_wsaa_soap(service, cert_b64) → str
- _build_padron_soap(cuit, token, sign, cuit_representante) → str
- _extract(elem, tag) → str | None (parser helper con/sin namespace)
```

### `fiscal_agent/__main__.py`

```python
from fiscal_agent.cli import app
app()  # typer
```

### `fiscal_agent/cli.py`

```
- app: typer.Typer
- run(config: Path, headed: bool = False, deuda: bool = False)
  → Lee y valida clients.yaml
  → TRACK PRINCIPAL (Sprint 1 — siempre corre):
      Para cada cliente:
          padron = ArcaWS.consultar_cuit(cuit)
          vtos = RulesEngine().calcular(padron.to_output())
          pdf = PdfGenerator().generar(cliente, vtos)
          ok = EmailSender(config.smtp).enviar(cliente, pdf)
  → TRACK DEUDA (Sprint 2 — flag --deuda):
      Si --deuda:
          login único estudio
          Para cada cliente:
              switch representado
              deuda = ArcaExtractor.extraer_deuda()
  → Log resumen: OKs, errores, tiempo total
```

### `fiscal_agent/arca_extractor.py`

```
class ArcaExtractor:
    - __init__(estudio_cuit: str, estudio_clave: str, headed: bool)
    - async login() → bool
      - Login ÚNICO al portal ARCA con CUIT + clave del estudio
      - Maneja 2FA, credencial inválida, portal caído
    - async switch_representado(cuit: str) → bool
      - Switchea al representado sin relogin
    - async extraer_deuda() → DeudaOutput
      - Extrae deuda actual, Mis Facilidades (planes de pago), saldos
      - Output: lista de { concepto, importe, vencimiento, tipo, plan }
    - async run_all(clientes: list[ClientConfig]) → list[DeudaOutput]
      - login() + switch + extraer_deuda() por cada cliente

### Module separado (o rango de pdf_generator): `matching`

```
def matchear_deuda(vencimientos: list[Vencimiento], deuda: DeudaOutput) -> dict[str, float]:
    - Cruzar concepto + período entre calendario y deuda extraída
    - Retornar dict: concept_key → importe
    - Sin match → importe None (se muestra vacío en PDF)
```

### `fiscal_agent/rules_engine.py`

```
class RulesEngine:
    - calcular(padron: PadronA5Output, mes: int, anio: int,
               provincias: list[str]|None) → RulesOutput
      → Punto de entrada principal. Consume WS API output.
      → RulesOutput incluye vencimientos + observaciones (obligaciones
        informativas) + feriados_presentes
    - _obligaciones_para_contribuyente(padron) → list[str]
      → Mapea idImpuesto → obligaciones del calendario:
          30 (IVA) → iva_ddjj
          10 (Ganancias) → ganancias_sociedades, anticipos_ganancias, gcias_bienes
          211 (BP-Acciones) → gcias_bienes (Bienes Personales)
          5904/5902/5905/5906/215 (IIBB) → convenio_multilateral
      → IIBB: 1 provincia = local, 2+ provincias = Convenio Multilateral
      → Agrega ret_perc_sicore_sire siempre para RI con IVA
      → Agrega monotributo/autonomos según corresponda
    - _observaciones_para_contribuyente(padron) → list[str]
      → idImpuesto 103 (Régimen de Información) → observación
      → idRégimen 68 (Participaciones Societarias RG 4697) → observación
        con fecha de vencimiento según terminación CUIT (julio)
      → idRégimen 255 (Estados Contables PDF) → observación
    - _cargar_feriados() → set[date]  # desde feriados.csv
    - _proximo_habil(fecha: date) → date  # salta feriados + finde
    - _dia_vencimiento(key, ultimo_digito_cuit, mes) → int
      → lookup en calendario_afip.json por CUIT terminación + mes
```

### `fiscal_agent/pdf_generator.py`

```
class PdfGenerator:
    - generar(cliente: str, cuit: str, vtos: list[Vencimiento],
              mes: str, anio: str, observaciones: list[str]|None) → Path
      → ReportLab platypus en A4 landscape (horizontal)
      → 3 páginas: portada (título + descripción solución) → calendario
        (tabla + observaciones) → página vacía para próximos workflows
      → output en storage/calendarios/Calendario_{CUIT}_{YYYY-MM}.pdf
```

### `fiscal_agent/email_sender.py`

```
class EmailSender:
    - __init__(smtp_config: SmtpConfig)
    - enviar(cliente: ClientConfig, pdf_path: Path) → bool
      → smtplib.SMTP con TLS
      → email con MIME multipart (texto + PDF adjunto)
      → captura exception → log → return False
```

## Error Handling Strategy

### Track principal — Pipeline calendario

| Capa | Error | Acción |
|------|-------|--------|
| CLI | YAML inválido | Halt con mensaje de campo específico |
| ArcaWS | WSAA falla (certificado vencido) | Log + aborta todo el pipeline |
| ArcaWS | Padrón A5 timeout | 3 retries: 5s, 15s, 45s, luego skip cliente |
| RulesEngine | Holiday CSV corrupto | Log + continúa sin feriados (warning) |
| RulesEngine | Impuesto no reconocido | Log + skip ese impuesto, continúa con el resto |
| PdfGenerator | Error generando PDF | Log + skip cliente |
| EmailSender | SMTP caído | Log "SMTP error" + marca todos como fail |
| EmailSender | Email individual falla | Log + sigue al próximo cliente |

### Track complementario — Browser-use deuda

| Capa | Error | Acción |
|------|-------|--------|
| ArcaExtractor | Credenciales estudio inválidas | Log + aborta track deuda completo |
| ArcaExtractor | Portal down (5xx/timeout) | 3 retries: 5s, 15s, 45s, luego skip track |
| ArcaExtractor | 2FA detectado | Log + skip track, no retry |
| ArcaExtractor | Switch representado falla | Log + skip ese cliente, continúa con el resto |
| ArcaExtractor | Sesión expirada mid-scrape | Log + re-login + retry desde switch |

## File Structure

```
workflows/
├── fiscal_agent/
│   ├── __init__.py       ✅ T-01
│   ├── __main__.py       ✅ T-01 → ✅ T-06 (redirige a cli.py)
│   ├── cli.py            ✅ T-06 (Typer CLI: validate, generate-template, run)
│   ├── models.py         ✅ T-01 → ✅ T-03 (+RulesOutput, +Vencimiento, +CalendarioAFIP, +DeudaOutput)
│   ├── arca_ws.py        ✅ T-02 (WS API: WSAA + Padrón A5)
│   ├── rules_engine.py   ✅ T-03 (corazón del pipeline — consume PadronA5Output + calendario_afip.json)
│   ├── feriados.csv      ✅ T-03 (feriados argentinos 2025/2026)
│   ├── calendario_afip.json ✅ T-03 (tabla AFIP completa 12 meses × 11 obligaciones)
│   ├── pdf_generator.py  ✅ T-04 (ReportLab con header/table/footer)
│   ├── email_sender.py   ✅ T-05 (SMTP con SSL/TLS, aislamiento por cliente)
│   ├── arca_extractor.py ← T-07 (browser-use: login estudio + switch + deuda — Sprint 2)
├── clients.yaml          ✅ T-02 → ✅ T-05 (SMTP Resend configurado)
├── storage/
│   ├── calendarios/      ✅ PDFs generados (Calendario_{CUIT}_{YYYY-MM}.pdf)
│   └── logs/             ← Logs de ejecución (Sprint 3)
└── pyproject.toml         ✅ T-01 (+pydantic, +reportlab)
```

## Testing Strategy

| Layer | Qué probar | Cómo |
|-------|-----------|------|
| Unit | `rules_engine` date math | Tests con fechas conocidas: feriados, CUIT terminación, categoría |
| Unit | `models` validation | `ArcaOutput`, `RulesOutput` schema con fixtures |
| Unit | `pdf_generator` output | Generar PDF y verificar existencia + filename pattern |
| Integration | Pipeline completo | 1 cliente fixture (monotributo mock), YAML válido, verificar PDF + log |
| E2E | ArcaExtractor (opcional) | Browser headed con portal de prueba o grabación |

## Dependencies

Add to `pyproject.toml`: `reportlab>=4.x` for PDF generation.

## Open Questions

- [x] ¿URLs y selectores exactos de ARCA? **Aplazado hasta Sprint 2** — el pipeline calendario (Sprint 1) no necesita browser-use
- [x] ¿AFIP/ARCA tiene un entorno de prueba/sandbox o solo producción? **Solo producción** (homologación existe pero no replica datos reales; usamos certificados de producción directo)
- [ ] ¿Cuándo vence la clave fiscal del estudio? Preguntar al estudio antes de implementar browser-use (Sprint 2)
- [ ] ¿Provincias y emails de cada cliente? Pendiente que el contador provea estos datos
- [ ] ¿Tabla AFIP de vencimientos actualizada? El contador está buscándola — mientras tanto se puede arrancar con feriados + estructura del Rules Engine
