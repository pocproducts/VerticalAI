"""Fiscal Agent FastAPI server.

Run with::

	uv run uvicorn fiscal_agent.api.server:app --reload
"""

from __future__ import annotations

from contextlib import asynccontextmanager
from typing import AsyncIterator

import redis.asyncio as redis
from fastapi import FastAPI, HTTPException, Request
from fastapi.openapi.utils import get_openapi
from fastapi.responses import JSONResponse

from fiscal_agent.api.routes import admin, calendar, extract, health, report
from fiscal_agent.api.store import RedisStore
from fiscal_agent.config import get_settings
from fiscal_agent.models import ApiError, UnifiedResponse


@asynccontextmanager
async def lifespan(app: FastAPI) -> AsyncIterator[None]:
	"""Connect Redis, seed defaults on empty store, close on shutdown."""
	settings = get_settings()
	redis_client = redis.from_url(settings.redis.url, decode_responses=True)
	store = RedisStore(redis_client)
	app.state.redis = redis_client
	app.state.store = store

	# Seed if empty
	await store.seed_defaults()

	yield  # Server is now serving

	# Clean shutdown
	await redis_client.aclose()


app = FastAPI(
	title='Fiscal Agent API',
	version='2.0.0',
	lifespan=lifespan,
	description='Vertical AI Agent Fiscal — API REST para agentes e integraciones',
)


# ── Global HTTP exception handler ───────────────────────────────────────


@app.exception_handler(HTTPException)
async def http_exception_handler(request: Request, exc: HTTPException) -> JSONResponse:
	"""Wrap all HTTP exceptions in UnifiedResponse format."""
	return JSONResponse(
		status_code=exc.status_code,
		content=exc.detail
		if isinstance(exc.detail, dict)
		else UnifiedResponse(
			status='error',
			error={'code': 'HTTP_ERROR', 'cause': str(exc.detail)},
		).model_dump(),
	)


# ── Rate limiting middleware ────────────────────────────────────────────


@app.middleware('http')
async def rate_limit_middleware(request: Request, call_next):
	"""Apply rate limiting per API key.

	Actual rate limit enforcement happens inside ``ScopeRequired._api_key_path``
	after the API key is resolved. This middleware only skips the health
	endpoint and passes all other requests through.
	"""
	path = request.url.path

	# Skip rate limiting for health endpoint
	if path == '/v1/health':
		return await call_next(request)

	# Let the request flow — ScopeRequired handles rate limiting internally
	response = await call_next(request)
	return response


# ── OpenAPI custom schema ──────────────────────────────────────────────


def custom_openapi() -> dict:
	if app.openapi_schema:
		return app.openapi_schema

	openapi_schema = get_openapi(
		title='Fiscal Agent API',
		version='2.0.0',
		description='Vertical AI Agent Fiscal — API REST para agentes e integraciones',
		routes=app.routes,
	)

	# Contacto
	openapi_schema['info']['contact'] = {
		'name': 'Fiscal Agent Team',
		'url': 'https://fiscal-agent.ar',
		'email': 'dev@fiscal-agent.ar',
	}

	# Servidores
	openapi_schema['servers'] = [
		{'url': 'http://localhost:8000', 'description': 'Desarrollo local'},
		{'url': 'https://api.fiscal-agent.ar', 'description': 'Producción'},
	]

	# Esquemas de seguridad
	auth0_domain = os.getenv('AUTH0_DOMAIN', '{tenant}.auth0.com')
	openapi_schema['components']['securitySchemes'] = {
		'Auth0OAuth2': {
			'type': 'oauth2',
			'flows': {
				'authorizationCode': {
					'authorizationUrl': f'https://{auth0_domain}/authorize',
					'tokenUrl': f'https://{auth0_domain}/oauth/token',
					'scopes': {
						'calendar:read': 'Leer calendario fiscal',
						'calendar:write': 'Generar calendario fiscal',
						'taxpayer:read': 'Consultar datos del contribuyente',
						'report:read': 'Leer reportes',
						'report:write': 'Generar reportes',
						'admin:read': 'Leer datos de administración',
						'admin:write': 'Operaciones de administración',
					},
				},
			},
		},
		'ApiKeyAuth': {
			'type': 'apiKey',
			'in': 'header',
			'name': 'Authorization',
			'description': 'API key: Bearer fa_<key>',
		},
	}
	openapi_schema['security'] = []

	# Tags con descripciones
	openapi_schema['tags'] = [
		{
			'name': 'health',
			'description': 'Endpoints de monitoreo y health check',
		},
		{
			'name': 'calendar',
			'description': 'Generación de calendarios fiscales por CUIT y período',
		},
		{
			'name': 'report',
			'description': 'Reportes fiscales completos e información de contribuyentes',
		},
		{
			'name': 'extract',
			'description': 'Extracción automatizada de datos vía navegador (Composio)',
		},
		{
			'name': 'admin',
			'description': 'Autogestión de desarrolladores, aplicaciones y API keys',
		},
	]

	app.openapi_schema = openapi_schema
	return app.openapi_schema


app.openapi = custom_openapi


# ── Routers ─────────────────────────────────────────────────────────────

app.include_router(health.router, tags=['health'])
app.include_router(calendar.router, tags=['calendar'])
app.include_router(report.router, tags=['report'])
app.include_router(extract.router, tags=['extract'])
app.include_router(admin.router, tags=['admin'])
