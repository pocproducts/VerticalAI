"""POST /v1/extract — extraer datos vía Composio Browser."""

from __future__ import annotations

import os
from typing import List, Optional

from fastapi import APIRouter, Depends
from pydantic import BaseModel

from fiscal_agent.api.auth import ScopeRequired
from fiscal_agent.api.deps import REPRESENTANTE_CUIT
from fiscal_agent.models import ApiError, DeudaOutput, Scope, UnifiedResponse

router = APIRouter()


class ExtractRequest(BaseModel):
	"""Request body for POST /v1/extract."""

	cuit: str
	tasks: List[str]  # 'deuda', 'facilidades', 'registro'
	idempotency_key: Optional[str] = None


@router.post('/v1/extract')
async def extract(
	request: ExtractRequest,
	_: None = Depends(ScopeRequired(Scope.TAXPAYER_READ)),
):
	"""Extract taxpayer data via Composio Browser.

	Supports: deuda (ctacte.cloud), facilidades (Mis Facilidades), registro (RUT).
	"""
	composio_key = os.environ.get('COMPOSIO_API_KEY', '')
	estudio_clave = os.environ.get('ESTUDIO_CLAVE_FISCAL', '')

	if not composio_key:
		return UnifiedResponse(
			status='error',
			error=ApiError(
				code='COMPOSIO_KEY_MISSING',
				cause='COMPOSIO_API_KEY no configurada en .env',
			),
		)
	if not estudio_clave:
		return UnifiedResponse(
			status='error',
			error=ApiError(
				code='ESTUDIO_CLAVE_MISSING',
				cause='ESTUDIO_CLAVE_FISCAL no configurada en .env',
			),
		)

	from fiscal_agent.browser import ComposioBrowser
	from fiscal_agent.browser import FacilidadesTask, FullTask, RegistroTask
	from fiscal_agent.models import ClientConfig

	browser = ComposioBrowser(
		composio_api_key=composio_key,
		estudio_cuit=REPRESENTANTE_CUIT,
		estudio_clave=estudio_clave,
	)

	# Build task list from request
	available_tasks = {
		'deuda': FullTask,
		'facilidades': FacilidadesTask,
		'registro': RegistroTask,
	}

	task_instances = []
	for task_name in request.tasks:
		task_cls = available_tasks.get(task_name)
		if task_cls is None:
			return UnifiedResponse(
				status='error',
				error=ApiError(
					code='INVALID_TASK',
					cause=f'Task desconocida: {task_name}',
					'remediation': 'Usar: deuda, facilidades, registro',
				),
			)
		task_instances.append(
			task_cls(
				cuit=REPRESENTANTE_CUIT,
				clave=estudio_clave,
				cliente_cuit=request.cuit,
			)
		)

	cliente = ClientConfig(cuit=request.cuit)

	try:
		deuda_output = browser.run_single(cliente, tasks=task_instances)
	except Exception as exc:
		return UnifiedResponse(
			status='error',
			error=ApiError(
				code='BROWSER_EXTRACTION_FAILED',
				cause=str(exc),
				'remediation': 'Verificar que Composio esté disponible y las credenciales sean válidas',
			),
		)

	if deuda_output.error:
		error_tag = 'TIMEOUT' if 'Timeout' in deuda_output.error else 'EXTRACTION_ERROR'
		return UnifiedResponse(
			status='error',
			error=ApiError(code=error_tag, cause=deuda_output.error),
		)

	return UnifiedResponse(status='success', result=deuda_output)
