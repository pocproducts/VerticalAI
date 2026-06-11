# Vertical AI Agent Fiscal — Specification

> Full specs for all 4 new capabilities. No existing specs to delta against.

---

## 1. `arca-extraction` — WORKFLOW-FIRST + AGENT FALLBACK

### Purpose
Extracción híbrida de datos fiscales desde ARCA (ex AFIP):

1. **WS API (Padrón A5)** como fuente primaria: via WSAA + SOAP, sin navegación, sin clave fiscal del cliente. Devuelve datos estructurados del contribuyente (tipo persona, denominación, domicilio, actividades, impuestos inscriptos).

2. **Recorded Workflows** (Sprint 2 primario):
   - `login_estudio.workflow.yaml`: Grabado con browser-use Recorder. Navega ARCA, ingresa CUIT+clave, verifica login exitoso. Usa CSS selectors (estables). $0 costo.
   - `switch_representado.workflow.yaml`: Cambiar entre representados sin re-login.
   - `extract_deuda.workflow.yaml`: Navega Mis Facilidades, extrae deuda/saldos/planes.
   - Determinísticos, 10-100× más rápido que Agent, 99.9% precisos.

3. **LLM Agent Fallback**: Si workflow falla → Agent toma control. Maneja edge cases (2FA, captchas, cambios UI). Retry 3× con backoff.

Outputs JSON per client combinando WS API + workflows.

### Requirements — Track A: Recorded Workflows + Agent Fallback

> El calendario de vencimientos se genera vía Rules Engine (sección 2). Los workflows solo extraen deuda real.

| ID | Requirement | Strength | Actor |
|----|------------|----------|-------|
| ARCA-1 | Login via ARCA portal using CUIT + clave fiscal del estudio | MUST | Workflow (primary), Agent (fallback) |
| ARCA-2 | Switchear representado sin relogin (el estudio tiene múltiples representados) | MUST | Workflow |
| ARCA-3 | Extract deuda actual, saldos pendientes, plan de pagos por representado | MUST | Workflow |
| ARCA-4 | On invalid credentials: log error, skip, no retry | MUST | Workflow + Agent detection |
| ARCA-5 | On portal down (5xx/timeout): retry 3× with exponential backoff (5s, 15s, 45s), then skip | MUST | Agent |
| ARCA-6 | On 2FA challenge: log "2FA detectado", skip without retry | MUST | Workflow detection OR Agent |
| ARCA-7 | On expired session mid-extraction: log "Sesión expirada", re-login and retry | MUST | Workflow re-execution |
| ARCA-8 | Workflows use CSS selectors (not index-based element detection) | MUST | Workflow recorder |
| ARCA-9 | Workflows parameterized: accept {{cuit}}, {{clave_fiscal}} variables | MUST | Workflow YAML |
| ARCA-10 | Each workflow validates 3× before integration (test CUIT) | MUST | QA/testing |

### Scenarios — Track A: Workflows + Fallback

| # | Name | GIVEN | WHEN | THEN |
|---|------|-------|------|------|
| S1 | Login estudio (workflow) | CUIT + clave del estudio válidos, login_estudio.yaml existe | workflow.run() | sesión activa, elapsed <5s |
| S2 | Switch representado (workflow) | Sesión activa, switch_representado.yaml existe | workflow.run() | representado activo, elapsed <3s |
| S3 | Deuda extraída (workflow) | Representado activo, extract_deuda.yaml existe | workflow.run() | JSON con deuda, elapsed <8s |
| S4 | Workflow fails → Agent fallback | Login workflow lanza exception | Agent.run() con retry 3× | sesión activa OR skip + log (ARCA-5) |
| S5 | Clave inválida | CUIT correcto, clave incorrecta | workflow/agent falla | log + skip, sin retry (ARCA-4) |
| S6 | Portal caído | ARCA devuelve 503 | Agent retry 3× con backoff | skip después de retries (ARCA-5) |
| S7 | 2FA presente | ARCA exige 2FA | Workflow detects o Agent detecta | log + skip (ARCA-6) |
| S8 | Sesión expirada | Sesión expira durante extract_deuda | Workflow detects OR re-execute login | re-login + retry extract (ARCA-7) |

### Data Contract: Workflows Output

```yaml
# login_estudio.workflow.yaml output
{ "authenticated": true, "study_cuit": "20324837796", "elapsed_ms": 3200 }

# switch_representado.workflow.yaml output  
{ "switched": true, "client_cuit": "30716395541", "elapsed_ms": 1800 }

# extract_deuda.workflow.yaml output
{
  "cuit": "30716395541",
  "extraido_el": "2026-06-09T10:30:00Z",
  "fuente": "recorded-workflow",
  "deuda_actual": 150000.00,
  "saldos": [
    { "concepto": "IVA Mayo 2026", "importe": 85000.00, "vencimiento": "2026-06-18", "estado": "impago" }
  ],
  "plan_pagos": null,
  "error": null
}
```

### Acceptance Criteria — Track A
- Login único del estudio funciona + switchea 2+ representados sin relogin
- ARCA-4/5/6/7: Error scenarios log expected messages without crashing the pipeline
- JSON schema validates against contract above

---

## 2. `fiscal-rules-engine`

### Purpose
Motor de reglas hardcodeadas (NO LLM) que consume **directamente** el `PadronA5Output` de la WS API y produce el calendario fiscal completo del mes. Es la fuente primaria de vencimientos — no un fallback. Combina:
- Datos del contribuyente desde WS API (tipo_persona, impuestos inscriptos, categoría monotributo, cierre_ejercicio, provincias)
- Feriados argentinos
- Tablas AFIP de vencimientos por CUIT terminación y categoría

### Requirements

| ID | Requirement | Strength |
|----|------------|----------|
| RULES-1 | Consume `PadronA5Output` directamente (tipo_persona, impuestos[], categoria_monotributo, cierre_ejercicio, provincias) | MUST |
| RULES-2 | Calculate due dates using current month as reference | MUST |
| RULES-3 | Apply argentine national holidays to shift due dates to next business day | MUST |
| RULES-4 | Apply AFIP calendar rules: CUIT termination table, 3rd business day, 20th of each month | MUST |
| RULES-5 | Differentiate by monotributo category (A/B/C vs D/E/F/G/H/I/J/K) for different due dates | MUST |
| RULES-6 | Determine applicable obligations from WS API `impuestos[]`: IVA → vencimientos IVA, Ganancias → vencimientos Ganancias, Monotributo → cuota + anual, Autónomos → mensual | MUST |
| RULES-7 | Produce a sorted list of due date objects (date, concept, importe estimado, es_fecha_habil) | MUST |
| RULES-8 | No LLM calls on the critical path — all rules are literal conditionals | MUST NOT |
| RULES-9 | Holidays file MUST be a local CSV or embedded set, updated manually each year | MUST |

### Scenarios

| # | Name | GIVEN | WHEN | THEN |
|---|------|-------|------|------|
| S1 | RI con IVA + Ganancias | PadronA5Output con IVA y Ganancias en impuestos[] | rules execute for June 2026 | calendario con vencimientos de IVA y Ganancias |
| S2 | Monotributo categoría D | PadronA5Output con monotributo, cat D | rules execute | calendario con cuota mensual + anual, fechas por cat D |
| S3 | Holiday shift | 20th falls on a Saturday | rules execute | vencimiento = next Monday |
| S4 | CUIT termination | CUIT ends in 5 → different date | rules execute | date matches AFIP table |
| S5 | Autónomo | PadronA5Output con autónomo | rules execute | calendario con cuota mensual autónomos |
| S6 | Múltiples provincias IIBB | RI con provincias CABA + Córdoba | rules execute | 2 vencimientos IIBB separados por provincia |

### Data Contract: rules output

```json
{
  "cuit": "20-XXXXXXXX-X",
  "periodo": "2026-06",
  "tipo": "responsable_inscripto",
  "vencimientos": [
    {
      "concepto": "IVA - Período Mayo 2026",
      "fecha": "2026-06-18",
      "importe_estimado": null,
      "es_fecha_habil": true,
      "impuesto_origen": "IVA"
    },
    {
      "concepto": "Ganancias - Anticipo Junio 2026",
      "fecha": "2026-06-22",
      "importe_estimado": null,
      "es_fecha_habil": true,
      "impuesto_origen": "Ganancias"
    }
  ],
  "feriados_presentes": ["2026-06-17"],
  "fuente": "ws-api",
  "error": null
}
```

### Acceptance Criteria
- Each rule table (feriados, CUIT terminación, categoría monotributo, tipo impuesto) passes 3 known-date fixtures
- PadronA5Output sin impuestos inscriptos → calendario vacío con `fuente: "ws-api"`
- Holiday CSV with 10+ entries loads correctly and shifts dates that fall on them
- Output para RI con IVA+Ganancias produce exactamente 2 vencimientos en el mes

---

## 3. `pdf-calendar`

### Purpose
Generate a professional monthly PDF per client with ReportLab. Content: client name, CUIT, month/year, due-date table with amounts. Suitable for sending to the end client.

### Requirements

| ID | Requirement | Strength |
|----|------------|----------|
| PDF-1 | Generate PDF with ReportLab | MUST |
| PDF-2 | Include: cliente nombre, CUIT, mes/año, table of vencimientos, importes | MUST |
| PDF-3 | Professional layout: header, table borders, footer with generation date | MUST |
| PDF-4 | Filename pattern: `Calendario_{CUIT}_{YYYY-MM}.pdf` | MUST |
| PDF-5 | Output directory: `storage/calendarios/` | MUST |
| PDF-6 | Handle empty vencimientos gracefully (PDF with "Sin vencimientos este mes") | SHOULD |
| PDF-7 | ReportLab listed in pyproject.toml as project dependency | MUST |

### Scenarios

| # | Name | GIVEN | WHEN | THEN |
|---|------|-------|------|------|
| S1 | Full month | 5 vencimientos in rules output | generate PDF | PDF with all 5 rows, table renders correctly |
| S2 | Empty month | rules output = empty vencimientos list | generate PDF | PDF with "Sin vencimientos este mes" |
| S3 | Single client | 1 client config | generate | file saved at storage/calendarios/Calendario_{CUIT}_{YYYY-MM}.pdf |

### Acceptance Criteria
- PDF generated for each fixture (full/empty) opens without errors in standard reader
- Filename matches `Calendario_{CUIT}_{YYYY-MM}.pdf` pattern exactly
- Table rows match input vencimientos count

---

## 4. `email-delivery`

### Purpose
Send email with PDF attachment via configurable SMTP (SendGrid or study SMTP). Professional subject/body. One client failure MUST NOT block others.

### Requirements

| ID | Requirement | Strength |
|----|------------|----------|
| MAIL-1 | Send email via SMTP with TLS | MUST |
| MAIL-2 | Attach the generated PDF | MUST |
| MAIL-3 | Subject: "Calendario Fiscal {mes} {año} - {cliente}" | MUST |
| MAIL-4 | Body: professional text (predefined template) | MUST |
| MAIL-5 | SMTP config from `clients.yaml`: host, port, user, pass, from_addr | MUST |
| MAIL-6 | Error for one client MUST NOT block other clients | MUST |
| MAIL-7 | Log success/failure per client for audit trail | MUST |
| MAIL-8 | Use Python `smtplib` (built-in, no extra dependency) | MUST |

### Scenarios

| # | Name | GIVEN | WHEN | THEN |
|---|------|-------|------|------|
| S1 | Single email sent | SMTP config valid, PDF exists | send email to 1 client | email delivered with PDF, log "OK" |
| S2 | 5 clients, 1 fails | 4 valid + 1 invalid email | send to all 5 | 4 succeed, 1 logged as error, no crash |
| S3 | SMTP unreachable | Wrong SMTP host/port | send attempt | log "SMTP connection failed", skip all |

### Acceptance Criteria
- Email with attachment arrives in inbox for valid SMTP config
- When 1/5 emails fail, the remaining 4 deliver successfully
- Audit log records per-client status

---

## 5. Multi-client configuration

### Requirements

| ID | Requirement | Strength |
|----|------------|----------|
| CONF-1 | YAML file at `clients.yaml` (root de workflows/) with client list | MUST |
| CONF-2 | Per client: CUIT, clave_fiscal, tipo (monotributo/autonomo/responsable_inscripto), email, nombre, tipo_persona (fisica/juridica), cierre_ejercicio (1-12), provincias | MUST |
| CONF-3 | Validate all required fields before execution starts | MUST |
| CONF-4 | On validation error: print field-specific message and halt immediately | MUST |
| CONF-5 | SMTP config at top level of same YAML file | MUST |

### Data Contract: clients.yaml

```yaml
smtp:
  host: "smtp.sendgrid.net"
  port: 587
  user: "apikey"
  password: "SG.xxxxx"
  from_addr: "estudio@example.com"

clientes:
  - cuit: "20-30123456-9"
    clave_fiscal: "miclave123"
    tipo: "monotributo"
    email: "cliente1@example.com"
    nombre: "Cliente Ejemplo S.A."

  - cuit: "20-27123456-8"
    clave_fiscal: "miclave456"
    tipo: "responsable_inscripto"
    email: "cliente2@estudio.com"
    nombre: "Otra Empresa SRL"
    tipo_persona: "juridica"
    cierre_ejercicio: 12
    provincias: ["CABA", "Buenos Aires"]

  - cuit: "20-23123456-7"
    clave_fiscal: "miclave789"
    tipo: "autonomo"
    email: "cliente3@example.com"
    nombre: "Juan Perez"
    tipo_persona: "fisica"
```

### Scenarios

| # | Name | GIVEN | WHEN | THEN |
|---|------|-------|------|------|
| S1 | Valid config | All fields present and correct | validate config | passes, execution starts |
| S2 | Missing CUIT | Client has no cuit field | validate | halt with "cliente[0]: campo 'cuit' requerido" |

### Acceptance Criteria
- Schema validation rejects malformed entry with field-specific message
- Valid 3-client config passes and yields 3 items in list

---

## Dependencies

| Library | Type | Purpose |
|---------|------|---------|
| `pydantic>=2.0` | Add to pyproject.toml | Model validation en fronteras de etapa |
| `reportlab>=4.0` | Add to pyproject.toml | PDF generation |
| `smtplib` | Built-in | Email delivery |
| `PyYAML` | Already exists | YAML config loading |
| `browser-use` | Already exists | ARCA browser automation |
| `playwright` | Already exists | Browser engine for ARCA |

## Appendix: Pipeline Overview

```
CLI / Cron → clients.yaml
    ↓
[arca-ws-api] → WSAA + Padrón A5: datos estructurados del contribuyente
    │               (tipo, denominación, domicilio, actividades, impuestos)
    │               Output: PadronA5Output
    ▼
[fiscal-rules-engine] → genera calendario fiscal del mes
    │               Basado en: impuestos inscriptos, categoría monotributo,
    │               CUIT terminación, feriados, provincias
    │               Output: RulesOutput (lista de vencimientos)
    ▼
[pdf-calendar] → PDF por cliente con tabla de vencimientos
    │               Output: storage/calendarios/Calendario_{CUIT}_{YYYY-MM}.pdf
    ▼
[email-delivery] → email con PDF adjunto por cliente
    ▼
  ✅ Calendario entregado
```

**Track complementario — Browser-use (deuda real)**:
```
[arca-extraction] → login único estudio → switch representado → extraer deuda real
    ↓
  Datos: deuda actual, saldos, plan de pagos (NO afecta calendario de vencimientos)
```

- **ARCA WS API**: capa primaria sin navegación. WSAA + Padrón A5 via SOAP. Devuelve datos estructurados del contribuyente. No requiere clave fiscal del cliente — solo el certificado del representante.
- **Fiscal Rules Engine**: fuente PRIMARIA del calendario. Consume PadronA5Output y produce vencimientos aplicando feriados + tablas AFIP. NO es un fallback — es el corazón del pipeline.
- **Browser-use (deuda)**: track separado, no bloqueante. Login único del estudio, switchea representado, extrae deuda real. Corre después del calendario principal o en paralelo.
- **PDF + Email**: generan y entregan el calendario.
- Each stage runs fully before the next starts. A client error in any stage logs and skips that client for that run — the pipeline continues with remaining clients.
