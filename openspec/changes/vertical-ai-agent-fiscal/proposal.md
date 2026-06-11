# Proposal: Vertical AI Agent Fiscal (Argentina)

## Intent

Estudio contable pierde ~8h/semana armando calendarios de vencimientos. Cliente paga $950/mes por automatización. Este cambio construye un agente vertical que navega ARCA, extrae datos fiscales, aplica reglas de negocio hardcodeadas, genera PDF y envía por email — sin intervención manual.

## Scope

### In Scope
- Workflow browser-use para navegar ARCA (monotributo, autónomos, RI)
- Extracción de vencimientos por CUIT + clave fiscal
- Motor de reglas hardcodeadas (NO LLM)
- PDF individual por cliente + envío por email
- Scheduler diario en VPS + logging mínimo
- Configuración multi-cliente vía YAML/JSON

### Out of Scope
- Dashboard web, LangGraph, RAG, fine-tuning
- Base de datos relacional (file-based storage)
- Kubernetes, multi-agent orchestration
- Soporte >10 clientes (escala futura)

## Capabilities

### New Capabilities
- `arca-extraction`: Navegación headless de ARCA, login CUIT/clave fiscal, scraping de vencimientos por categoría
- `fiscal-rules-engine`: Reglas de negocio codificadas (vencimientos, feriados, días hábiles)
- `pdf-calendar`: Generación PDF con hitos fiscales del mes
- `email-delivery`: Envío por SMTP configurable

### Modified Capabilities
- None (proyecto nuevo)

## Approach

Pipeline secuencial: CLI recibe clientes → browser-use navega ARCA → reglas calculan vencimientos → ReportLab genera PDF → smtplib envía email → cron ejecuta diario. Sin DB: `clients.yaml` + `storage/` para outputs. Sin LLM en ruta crítica de reglas.

## Affected Areas

| Area | Impact | Description |
|------|--------|-------------|
| `workflows/fiscal_agent/` | New | Módulo del agente fiscal |
| `workflows/cli.py` | Modified | Nuevo comando `fiscal` |
| `workflows/backend/` | New | Endpoint POST `/fiscal/run` |
| `storage/calendarios/` | New | PDFs generados |

## Risks

| Risk | Likelihood | Mitigation |
|------|------------|------------|
| ARCA cambia estructura del portal | Med | Selectores resilientes + alerta en fallo |
| Clave fiscal expira / 2FA | High | Log claro + excluir cliente + notificar |
| Portal caído en ejecución | Med | 3 reintentos con backoff + skip del día |
| Error en PDF/email para 1 cliente | Low | No bloquea al resto; reintento individual |

## Rollback Plan

Eliminar `workflows/fiscal_agent/` y revertir `cli.py`. Cambio auto-contenido: no afecta workflows existentes ni requiere migración.

## Dependencies

`browser-use` + `playwright` (ya en proyecto). Añadir `reportlab` a pyproject.toml. SMTP del estudio contable.

## Success Criteria

- [ ] ARCA extrae datos correctos para monotributo, autónomo y RI
- [ ] Reglas producen calendario con fechas hábiles correctas
- [ ] PDF legible con todos los hitos del mes
- [ ] Email llega con PDF adjunto
- [ ] Scheduler corre 7 días sin intervención
