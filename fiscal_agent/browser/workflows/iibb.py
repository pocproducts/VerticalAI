"""IIBB jurisdictions extraction — instrucción NL para Composio Browser Tool.

Extrae todas las jurisdicciones IIBB donde el contribuyente está inscripto  
desde el Registro Único Tributario (RUT) de ARCA.

Placeholders: ``{cuit}``, ``{clave}``, ``{cliente_cuit}``
"""

from __future__ import annotations

TEMPLATE_IIBB: str = """IIBB Jurisdicciones — Extraer IIBB de Rentas

--- PARTE 1: LOGIN ---

1. Abrí https://auth.afip.gob.ar/contribuyente_/login.xhtml
2. Ingresá CUIT: {cuit}
3. Click 'Siguiente'. Esperá campo contraseña.
4. Ingresá clave: {clave}
5. Click 'Ingresar'. Esperá redirección a URL con 'cloud.afip.gob.ar'.

SI VES: 'CUIT incorrecto', 'clave inválida' → reportá ERROR ARCA-4 y detené.
SI VES: 'código de verificación', '2FA' → reportá ERROR ARCA-6 y detené.

--- PARTE 2: NAVEGAR A DGR Provincia de Córdoba---

6. En el portal cloud, buscá en el campo de búsqueda "DGR Provincia de Córdoba".
   Hacé clic en el resultado que aparezca.
7. Se abre una nueva pestaña/ventana. Cambiá a ella.
   La URL debería contener "https://www.rentascordoba.gob.ar/emision/perfil/impuestos".
8. En la página de Rentas Cordoba, buscá el campo para seleccionar en la parte superior
   Clickearlo y apretar en "Representados", esperar que cargue la pagina, escrolear si es necesario hasta identificar {cliente_cuit} y una vez identificado cambiar al {cliente_cuit}

--- PARTE 3: ENTRAR AL RUT ---

9. Una vez cargado el contribuyente, buscá en la pagina
   "Pagos Mensuales" y desplegar solamente "Ingresos Brutos"
   
10. En la misma pagina se listaran **Todos los pagos**
    que corresponda a todos los impuestos de Ingresos Brutos de la Provincia de Cordoba.
11. Esperá que la página cargue COMPLETAMENTE (puede tardar).
12. Si en "Pagos Mensuales" no hay existencia alguna de "Ingresos Brutos"
    entonces el contribuyente no deudas de "Ingresos Brutos" a pagar

--- PARTE 4: EXTRAER JURISDICCIONES IIBB ---

12. Una vez cargada la página del RUT, reconoce la pagina y la seccion "Pagos Mensuales"
13. Desplega ls seccion de "Ingresos Brutos" y si no hay una seccion de Ingresos Brutos entonces el contribuyente no tiene deudas por ende la navegacion termina y se avisa en el PDF que Ingresos Brutos de la Provincia de Cordoba no tiene deudas, de lo contrario te aparecera el paso 14.
14. Para CADA impuesto de ingresos brutos que aparece desplegado, extraé:
    - provincia (nombre de la provincia)
    - inscripción (número de inscripción IIBB)
    - estado (Activo, Suspendido, Baja, etc.)
    - fecha_alta (si visible, formato YYYY-MM-DD)
    - fecha_baja (si visible, formato YYYY-MM-DD, null si no aplica)

15. Armá este JSON exacto con los datos extraídos:

Armá este JSON exacto con los datos extraídos:

{{
  "iibb_jurisdicciones": [
    {{
      "provincia": "<nombre>",
      "inscripcion": "<número>",
      "estado": "<estado>",
      "fecha_alta": "<YYYY-MM-DD o null>",
      "fecha_baja": "<YYYY-MM-DD o null>"
    }}
  ]
}}
--- FINAL ---

16. Llamá al comando `done` con el JSON en el campo `text`.

Ejemplo:
done({{"text": "{{\\"iibb_jurisdicciones\\": []}}", "success": true}})

Si no hay datos de IIBB, devolvé el array vacío y el mensaje "DGR Pronviancia de Cortdoba no hay deudas y se encuentra al dia".
NO pongas texto adicional fuera del JSON.
"""
