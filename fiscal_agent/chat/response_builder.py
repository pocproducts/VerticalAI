"""Format pipeline results into natural Spanish chat responses.

Each formatter receives the raw ``data`` dict from the handler (or ``None``)
and returns a human-readable string in Spanish with markdown formatting.
"""

from __future__ import annotations

from typing import Any


def format_taxpayer_response(data: dict[str, Any] | None, cuit: str) -> str:
	"""Format taxpayer query result."""
	if data is None:
		return f'No se pudo consultar el CUIT {cuit}. Verificá que los certificados ARCA estén configurados.'

	error = data.get('error')
	if error:
		return f'❌ Error al consultar CUIT {cuit}: {error}'

	nombre = data.get('nombre', '')
	tipo = data.get('tipo', '')
	tipo_persona = data.get('tipo_persona', '')

	lines = [f'**Datos del contribuyente — {cuit}**\n']
	if nombre:
		lines.append(f'• **Nombre**: {nombre}')
	if tipo:
		lines.append(f'• **Tipo**: {tipo}')
	if tipo_persona:
		lines.append(f'• **Persona**: {tipo_persona}')

	return '\n'.join(lines)


def format_reporte_response(data: dict[str, Any] | None, cuit: str) -> str:
	"""Format a complete fiscal report result into Spanish text.

	Args:
		data: The pipeline result dict from ``_procesar_cliente_pipeline()``.
		cuit: The CUIT that was queried.

	Returns:
		Human-readable response in Spanish with markdown formatting.
	"""
	if data is None:
		return f'No se pudo generar el reporte para CUIT {cuit}. Verificá que los certificados ARCA estén configurados.'

	error = data.get('error')
	if error:
		return f'❌ Error al generar reporte para CUIT {cuit}: {error}'

	cliente = data.get('cliente', cuit)
	lines = [f'**Reporte fiscal para {cliente} ({cuit})**\n']

	# Padrón A5
	if data.get('ws_api'):
		lines.append('✅ Datos del Padrón A5 consultados')

	# Calendario
	if data.get('calendario'):
		lines.append('✅ Calendario fiscal calculado')

	# PDF
	if data.get('pdf'):
		pdf_path = data.get('pdf_path', '')
		lines.append('✅ PDF generado exitosamente')
		if pdf_path:
			filename = pdf_path.split('/')[-1]
			lines.append(f'📄 [Descargar reporte]({_pdf_download_url(filename)})')

	# Email
	if data.get('email'):
		lines.append('✅ Email enviado al cliente')

	return '\n'.join(lines)


def _pdf_download_url(filename: str) -> str:
	"""Build the PDF download URL path."""
	return f'/v1/chat/reports/{filename}'
