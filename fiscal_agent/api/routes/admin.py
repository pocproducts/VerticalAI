"""Admin endpoints for developer self-service.

Temporary: authentication was removed to prepare for a new provider.
Endpoints that previously relied on ``request.state.developer`` now
accept an explicit ``developer_id`` parameter.
"""

from __future__ import annotations

from fastapi import APIRouter, HTTPException, Query, Request
from pydantic import BaseModel, Field

from fiscal_agent.api.store import RedisStore
from fiscal_agent.models import ApiError, App, Developer, UnifiedResponse

router = APIRouter()


# ── Request / Response models ───────────────────────────────────────


class RegisterRequest(BaseModel):
	"""Solicitud de registro de nuevo desarrollador."""

	name: str = Field(
		description='Nombre completo del desarrollador o estudio',
		examples=['Estudio Contable Pérez'],
	)
	email: str = Field(
		description='Correo electrónico del desarrollador',
		examples=['contacto@estudioperez.com'],
	)


class CreateAppRequest(BaseModel):
	"""Solicitud de creación de nueva aplicación."""

	developer_id: str = Field(
		description='ID del desarrollador',
		examples=['dev-1'],
	)
	name: str = Field(
		description='Nombre de la aplicación',
		examples=['Sistema de Gestión Pérez'],
	)
	environment: str = Field(
		default='sandbox',
		description='Entorno: "sandbox" para pruebas, "production" para producción',
		examples=['sandbox', 'production'],
	)


class CreateKeyRequest(BaseModel):
	"""Solicitud de generación de API key."""

	app_id: str = Field(
		description='ID de la aplicación',
		examples=['a1b2c3d4e5f6'],
	)


# ── Endpoints ───────────────────────────────────────────────────────


@router.post(
	'/v1/admin/register',
	response_model=UnifiedResponse[Developer],
	status_code=201,
	summary='Registrar nuevo desarrollador',
	responses={
		409: {'description': 'Email ya registrado', 'model': UnifiedResponse[ApiError]},
	},
)
async def register(
	body: RegisterRequest,
	req: Request,
):
	"""Registra una nueva cuenta de desarrollador.

	TODO: agregar validación de autenticación cuando se implemente
	el nuevo proveedor.
	"""
	store: RedisStore = req.app.state.store  # type: ignore[attr-defined]

	dev = await store.register_developer(
		name=body.name,
		email=body.email,
	)

	return UnifiedResponse(
		status='success',
		result=dev,
	)


@router.post(
	'/v1/admin/apps',
	response_model=UnifiedResponse[App],
	summary='Crear nueva aplicación',
	responses={
		400: {'description': 'Error de creación', 'model': UnifiedResponse[ApiError]},
	},
)
async def create_app_endpoint(
	body: CreateAppRequest,
	req: Request,
):
	"""Crea una nueva aplicación para un desarrollador."""
	store: RedisStore = req.app.state.store  # type: ignore[attr-defined]

	app = await store.create_app(body.developer_id, body.name, body.environment)
	if app is None:
		raise HTTPException(
			status_code=400,
			detail=UnifiedResponse(
				status='error',
				error=ApiError(
					code='APP_CREATION_FAILED', cause='No se pudo crear la aplicación. Verificá que el desarrollador exista.'
				),
			).model_dump(),
		)

	return UnifiedResponse(
		status='success',
		result=app,
	)


@router.post(
	'/v1/admin/keys',
	response_model=UnifiedResponse[dict],
	summary='Generar nueva API key',
	responses={
		404: {'description': 'App no encontrada', 'model': UnifiedResponse[ApiError]},
	},
)
async def create_key(
	body: CreateKeyRequest,
	req: Request,
):
	"""Genera una nueva API key para una aplicación.
	La clave completa se muestra una sola vez.
	"""
	store: RedisStore = req.app.state.store  # type: ignore[attr-defined]
	result = await store.create_api_key(body.app_id)
	if result is None:
		raise HTTPException(
			status_code=404,
			detail=UnifiedResponse(
				status='error',
				error=ApiError(code='APP_NOT_FOUND', cause='App no encontrada'),
			).model_dump(),
		)

	return UnifiedResponse(
		status='success',
		result={
			'api_key': result['api_key'],
			'full_key': result['full_key'],
			'warning': 'Guardá esta key — no se mostrará nuevamente',
		},
	)


@router.get(
	'/v1/admin/keys',
	response_model=UnifiedResponse[dict],
	summary='Listar API keys del desarrollador',
)
async def list_keys(
	developer_id: str = Query(description='ID del desarrollador'),
):
	"""Lista todas las API keys de un desarrollador.

	TODO: necesita store para funcionar — temporalmente deshabilitado.
	"""
	return UnifiedResponse(
		status='error',
		error=ApiError(
			code='AUTH_DISABLED',
			cause='Este endpoint requiere autenticación. Disponible cuando se implemente el nuevo proveedor.',
		),
	)


@router.get(
	'/v1/admin/me',
	response_model=UnifiedResponse[Developer],
	summary='Perfil del desarrollador autenticado',
)
async def me():
	"""Obtiene el perfil del desarrollador autenticado.

	TODO: implementar cuando se agregue el nuevo proveedor de auth.
	"""
	return UnifiedResponse(
		status='error',
		error=ApiError(
			code='AUTH_DISABLED',
			cause='Endpoint temporalmente deshabilitado. La autenticación se está migrando a un nuevo proveedor.',
		),
	)
