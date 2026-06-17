## Context

El pipeline fiscal ya extrae datos del Registro Único Tributario (RUT) de ARCA vía ComposioBrowser y los muestra en la página 6 del PDF ("Registro Tributario — IIBB e Impuestos"). Sin embargo:

1. El matching de IIBB solo cubre Córdoba (no CABA, Santa Fe, Buenos Aires, etc.)
2. El PDF no muestra las jurisdicciones IIBB desglosadas con números de inscripción
3. `format_registro()` no está implementado (deuda técnica en chat API)
4. El template de extracción no pide datos IIBB completos por jurisdicción

## Propuesta

### INTENT
Agregar matching multi-jurisdicción de IIBB + enriquecer el PDF del Registro Tributario con datos IIBB desglosados por provincia, implementar format_registro() para la chat API, y expandir el template de extracción del RUT para capturar todas las jurisdicciones IIBB.

### SCOPE
Incluye:
- Mejora de modelos: agregar RegistroIIBBJurisdiccion a RegistroOutput
- Expansión del browser template para extraer IIBB por jurisdicción
- Matching multi-provincia (todas las jurisdicciones, no solo Córdoba)
- Tabla de jurisdicciones IIBB en PDF página 6
- Implementación de format_registro()

NO incluye:
- Cambios en rules_engine.py (el mapeo IIBB id→provincia ya existe)
- Cambios en el pipeline CLI (--with-registro ya funciona)
- Tests automáticos (sin bash, pero se dejan tasks para tests)

### APPROACH
1. Model: Agregar `RegistroIIBBJurisdiccion` a models.py y campo `iibb_jurisdicciones: List[RegistroIIBBJurisdiccion]` a `RegistroOutput`
2. Template: Expandir TEMPLATE_REGISTRO para pedir "TODAS las jurisdicciones IIBB con su número de inscripción y estado"
3. Parsing: `_parse_registro_output()` y `_parse_registro()` manejar nuevos campos
4. Matching: Extender `evaluar_rentas_cordoba()` → `evaluar_iibb()` multi-jurisdicción
5. PDF: Nueva tabla en _build_registro_tables() para jurisdicciones IIBB
6. Chat: Implementar format_registro() en response_builder.py

### FILES AFFECTED
- fiscal_agent/models.py — +RegistroIIBBJurisdiccion, +iibb_jurisdicciones en RegistroOutput
- fiscal_agent/browser/workflows/registro.py — expandir template
- fiscal_agent/browser/task.py — expandir _parse_registro_output()
- fiscal_agent/browser/composio.py — expandir _parse_registro()
- fiscal_agent/matching.py — extender a multi-jurisdicción
- fiscal_agent/memory/brain.py — extender _match_rentas()
- fiscal_agent/pdf_generator.py — agregar tabla IIBB
- fiscal_agent/chat/response_builder.py — implementar format_registro()
- fiscal_agent/tests/test_tenant_brain.py — actualizar tests

### RISKS
- El RUT puede no tener datos IIBB estructurados por jurisdicción
- Matching multi-jurisdicción depende de cruzar ids del WS API con provincias configuradas
- El template NL puede ser frágil si la UI del RUT cambia

### SUCCESS CRITERIA
- PDF página 6 muestra tabla con todas las jurisdicciones IIBB detectadas
- El matching reporta correctamente cada provincia IIBB con su estado
- format_registro() devuelve texto legible para la chat API
- Backward compatible: pipeline sin --with-registro funciona idéntico
