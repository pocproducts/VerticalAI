"""MCP tool: extract_facilidades — extrae planes de pago.

Scope (HTTP): taxpayer:read
Requiere COMPOSIO_API_KEY configurada en .env.
"""

from __future__ import annotations

import asyncio
import os

from mcp.server.fastmcp import Context

from fiscal_agent.browser import FacilidadesTask
from fiscal_agent.cli import REPRESENTANTE_CUIT
from fiscal_agent.mcp.server import mcp
from fiscal_agent.models import ApiError, UnifiedResponse


@mcp.tool()
async def extract_facilidades(cuit: str, ctx: Context = None) -> str:
	"""Extraer los planes de pago (Mis Facilidades) de un contribuyente.

	Navega el sistema ARCA via browser automation para obtener los
	planes de pago activos e históricos del contribuyente.

	Args:
	    cuit: CUIT del contribuyente (11 dígitos).

	Returns:
	    UnifiedResponse con lista de FacilidadPlan.
	"""
	svc = ctx.request_context.lifespan_context
	browser = svc.get('browser')

	if browser is None:
		return UnifiedResponse(
			status='error',
			error=ApiError(
				code='BROWSER_NOT_CONFIGURED',
				cause='COMPOSIO_API_KEY no configurada',
				remediation='Agregar COMPOSIO_API_KEY en .env',
			),
		).model_dump_json()

	estudio_clave = os.environ.get('ESTUDIO_CLAVE_FISCAL', '')

	try:
		task = FacilidadesTask(
			cuit=REPRESENTANTE_CUIT,
			clave=estudio_clave,
			cliente_cuit=cuit,
		)
		output = await asyncio.to_thread(browser.run_single, None, tasks=[task])

		if output.error:
			error_tag = 'BROWSER_TIMEOUT' if 'Timeout' in output.error else 'BROWSER_ERROR'
			return UnifiedResponse(
				status='error',
				error=ApiError(code=error_tag, cause=output.error),
			).model_dump_json()

		return UnifiedResponse(
			status='success',
			result={'facilidades': [f.model_dump() for f in output.facilidades]},
		).model_dump_json()

	except Exception as exc:
		return UnifiedResponse(
			status='error',
			error=ApiError(code='BROWSER_ERROR', cause=str(exc)),
		).model_dump_json()
