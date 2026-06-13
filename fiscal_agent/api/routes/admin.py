"""Admin endpoints for developer self-service.

All admin endpoints require Auth0 JWT authentication with appropriate
scopes (``admin:read``, ``admin:write``). API key auth is rejected.
"""

from __future__ import annotations

from typing import List

from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel, Field

from fiscal_agent.api.auth import ScopeRequired, ScopeRequiredJWT
from fiscal_agent.api.store import ConflictError, RedisStore
from fiscal_agent.models import ApiError, App, Developer, Scope, UnifiedResponse

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
		401: {'description': 'JWT faltante o inválido', 'model': UnifiedResponse[ApiError]},
		403: {'description': 'Waitlist no aprobado / permiso insuficiente', 'model': UnifiedResponse[ApiError]},
		409: {'description': 'Email ya registrado', 'model': UnifiedResponse[ApiError]},
	},
)
async def register(
	request: RegisterRequest,
	req: Request,
	_=Depends(ScopeRequiredJWT(Scope.ADMIN_WRITE)),
):
	"""Registra una nueva cuenta de desarrollador vinculada al usuario Auth0 autenticado.
	Requiere JWT de Auth0 con permiso ``admin:write``.
	"""
	auth0_id = req.state.auth0_claims.get('sub', '')
	store: RedisStore = req.app.state.store

	try:
		dev = await store.register_developer(
			name=request.name,
			email=request.email,
			auth0_id=auth0_id,
		)
	except ConflictError as exc:
		raise HTTPException(
			status_code=409,
			detail=UnifiedResponse(
				status='error',
				error=ApiError(code=exc.code, cause=str(exc)),
			).model_dump(),
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
		401: {'description': 'JWT faltante o inválido', 'model': UnifiedResponse[ApiError]},
		403: {'description': 'Permiso insuficiente o waitlist no aprobado', 'model': UnifiedResponse[ApiError]},
		429: {'description': 'Límite de tasa excedido', 'model': UnifiedResponse[ApiError]},
	},
)
async def create_app_endpoint(
	request: CreateAppRequest,
	req: Request,
	_=Depends(ScopeRequired(Scope.ADMIN_WRITE, require_jwt=True)),
):
	"""Crea una nueva aplicación para el desarrollador autenticado.
	Requiere JWT de Auth0 con permiso ``admin:write``.
	"""
	developer = req.state.developer
	store: RedisStore = req.app.state.store

	app = await store.create_app(developer.id, request.name, request.environment)
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
		401: {'description': 'JWT faltante o inválido', 'model': UnifiedResponse[ApiError]},
		403: {'description': 'Permiso insuficiente o waitlist no aprobado', 'model': UnifiedResponse[ApiError]},
		404: {'description': 'App no encontrada', 'model': UnifiedResponse[ApiError]},
		429: {'description': 'Límite de tasa excedido', 'model': UnifiedResponse[ApiError]},
	},
)
async def create_key(
	request: CreateKeyRequest,
	req: Request,
	_=Depends(ScopeRequired(Scope.ADMIN_WRITE, require_jwt=True)),
):
	"""Genera una nueva API key para una aplicación.
	La clave completa se muestra una sola vez.
	Requiere JWT de Auth0 con permiso ``admin:write``.
	"""
	store: RedisStore = req.app.state.store
	result = await store.create_api_key(request.app_id)
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
	responses={
		401: {'description': 'JWT faltante o inválido', 'model': UnifiedResponse[ApiError]},
		403: {'description': 'Permiso insuficiente o waitlist no aprobado', 'model': UnifiedResponse[ApiError]},
		429: {'description': 'Límite de tasa excedido', 'model': UnifiedResponse[ApiError]},
	},
)
async def list_keys(
	req: Request,
	_=Depends(ScopeRequired(Scope.ADMIN_READ, require_jwt=True)),
):
	"""Lista todas las API keys del desarrollador autenticado.
	Requiere JWT de Auth0 con permiso ``admin:read``.
	"""
	developer = req.state.developer
	store: RedisStore = req.app.state.store
	keys = await store.list_developer_keys(developer.id)

	return UnifiedResponse(
		status='success',
		result={'keys': keys},
	)


@router.get(
	'/v1/admin/me',
	response_model=UnifiedResponse[Developer],
	summary='Perfil del desarrollador autenticado',
	responses={
		401: {'description': 'JWT faltante o inválido', 'model': UnifiedResponse[ApiError]},
		403: {'description': 'Permiso insuficiente o waitlist no aprobado', 'model': UnifiedResponse[ApiError]},
		429: {'description': 'Límite de tasa excedido', 'model': UnifiedResponse[ApiError]},
	},
)
async def me(
	req: Request,
	_=Depends(ScopeRequired(Scope.ADMIN_READ, require_jwt=True)),
):
	"""Obtiene el perfil del desarrollador autenticado.
	Requiere JWT de Auth0 con permiso ``admin:read``.
	"""
	return UnifiedResponse(
		status='success',
		result=req.state.developer,
	)
