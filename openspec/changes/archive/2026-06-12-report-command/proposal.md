# Proposal: report-command

## Intent

Los comandos actuales (`run`, `deuda`, `discover`) operan por batch sobre todo `clients.yaml`. Falta un comando interactivo que permita al contador procesar un solo CUIT rápidamente: validarlo, descubrirlo si no existe, seleccionar qué extraer, generar el PDF con la fecha en la ruta, y preguntar si enviar email.

## Scope

### In Scope
- Nuevo comando `python -m fiscal_agent report` en `cli.py` (~150-200 líneas)
- Modificación de `PdfGenerator.generar()` para aceptar `output_dir` opcional con subcarpeta YYYY-MM
- Flujo interactivo: prompt CUIT → validación 11 dígitos → lookup en YAML → descubrimiento opcional → selección de tasks → pipeline completo → email prompt → resumen

### Out of Scope
- Modificar `models.py` (no tocar)
- Cambiar el pipeline batch (`run`) existente
- Nuevas dependencias
- UI/UX web, solo CLI interactiva

## Capabilities

### New Capabilities
- `report-command`: Comando Typer interactivo para pipeline single-cliente con CUIT lookup, descubrimiento Padrón A5, selección de tasks (deuda/facilidades/registro), PDF con ruta fechada, y email opcional.

### Modified Capabilities
- `pdf-generation` (cambio menor): `PdfGenerator.generar()` acepta `output_dir` opcional para incluir carpeta `storage/YYYY-MM/` en la ruta.

## Approach

1. Agregar comando `report` en `cli.py` con decorador `@app.command()`.
2. Usar `typer.prompt()` para CUIT, validar con regex (11 dígitos).
3. Cargar `clients.yaml`, buscar CUIT en `config.clientes`. Si no existe, llamar `discover` inline (Padrón A5 + prompts para email/clave) y agregar al YAML en runtime.
4. Preguntar qué tasks ejecutar: deuda (s/N), facilidades (s/N), registro (s/N).
5. Reutilizar lógica del pipeline `run` para cliente único: TA → Padrón → Rules Engine → Composio Browser (tasks seleccionadas).
6. Llamar `PdfGenerator.generar(output_dir=storage/YYYY-MM/)` para que el PDF quede en subcarpeta por mes.
7. Preguntar si enviar email. Reutilizar `EmailSender`.
8. Mostrar resumen con ruta del PDF generado.

## Affected Areas

| Area | Impact | Description |
|------|--------|-------------|
| `fiscal_agent/cli.py` | New | Comando `report` (~150-200 líneas) |
| `fiscal_agent/pdf_generator.py` | Modified | `generar()` acepta `output_dir` opcional |

## Risks

| Risk | Likelihood | Mitigation |
|------|------------|------------|
| YAML write race condition | Low | Solo escritura en runtime; el archivo se carga al inicio |
| Composio timeout en sesión interactiva | Med | Mismo manejo de errores que `run` — error se muestra, no se bloquea |
| CUIT inválido pero pasa validación 11 dígitos | Low | La validación real ocurre en Padrón A5 |

## Rollback Plan

Revertir cambios en `cli.py` y `pdf_generator.py` vía `git revert`. No hay migraciones ni cambios de esquema.

## Dependencies

- Dependencias existentes (Typer, YAML, Composio, ReportLab, dotenv, etc.)

## Success Criteria

- [ ] `python -m fiscal_agent report` ejecuta el flujo completo sin errores
- [ ] PDF generado en `storage/YYYY-MM/{CUIT}_{Nombre}.pdf`
- [ ] CUIT desconocido se descubre y agrega al YAML
- [ ] Email se envía solo cuando el usuario confirma
- [ ] Resumen final muestra ruta del PDF
