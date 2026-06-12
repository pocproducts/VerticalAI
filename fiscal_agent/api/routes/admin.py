"""Admin endpoints for developer self-service.

All admin endpoints require authentication via Authorization header
and appropriate scopes (admin:read, admin:write).
"""

from __future__ import annotations

from typing import List

from fastapi import APIRouter, Depends, Request
from pydantic import BaseModel

from fiscal_agent.api.auth import ScopeRequired
from fiscal_agent.api.store import create_api_key, create_app, list_developer_keys, register_developer
from fiscal_agent.models import ApiError, Scope, UnifiedResponse

router = APIRouter()


# ── Request / Response models ───────────────────────────────────────


class RegisterRequest(BaseModel):
	name: str
	email: str


class CreateAppRequest(BaseModel):
	name: str
	environment: str = 'sandbox'


class CreateKeyRequest(BaseModel):
	app_id: str


# ── Endpoints ───────────────────────────────────────────────────────


@router.post('/v1/admin/register')
async def register(request: RegisterRequest):
	"""Register a new developer account."""
	dev = register_developer(request.name, request.email)

	return UnifiedResponse(
		status='success',
		result=dev,
	)


@router.post('/v1/admin/apps')
async def create_app_endpoint(
	request: CreateAppRequest,
	req: Request,
	_=Depends(ScopeRequired(Scope.ADMIN_WRITE)),
):
	"""Create a new application for the authenticated developer."""
	developer = req.state.developer

	app = create_app(developer.id, request.name, request.environment)
	if app is None:
		return UnifiedResponse(
			status='error',
			error=ApiError(code='APP_CREATION_FAILED', cause='No se pudo crear la aplicación'),
		)

	return UnifiedResponse(
		status='success',
		result=app,
	)


@router.post('/v1/admin/keys')
async def create_key(
	request: CreateKeyRequest,
	req: Request,
	_=Depends(ScopeRequired(Scope.ADMIN_WRITE)),
):
	"""Generate a new API key for an app.

	The full key is returned ONCE — store it securely.
	"""
	developer = req.state.developer

	result = create_api_key(request.app_id)
	if result is None:
		return UnifiedResponse(
			status='error',
			error=ApiError(code='KEY_CREATION_FAILED', cause='App no encontrada'),
		)

	return UnifiedResponse(
		status='success',
		result={
			'api_key': result['api_key'],
			'full_key': result['full_key'],
			'warning': 'Guardá esta key — no se mostrará nuevamente',
		},
	)


@router.get('/v1/admin/keys')
async def list_keys(
	req: Request,
	_=Depends(ScopeRequired(Scope.ADMIN_READ)),
):
	"""List all API keys for the authenticated developer."""
	developer = req.state.developer
	keys = list_developer_keys(developer.id)

	return UnifiedResponse(
		status='success',
		result={'keys': keys},
	)


@router.get('/v1/admin/me')
async def me(
	req: Request,
	_=Depends(ScopeRequired(Scope.ADMIN_READ)),
):
	"""Get profile of the authenticated developer."""
	return UnifiedResponse(
		status='success',
		result=req.state.developer,
	)
