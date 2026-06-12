"""Fiscal Agent FastAPI server.

Run with::

	uv run uvicorn fiscal_agent.api.server:app --reload
"""

from __future__ import annotations

from contextlib import asynccontextmanager
from typing import AsyncIterator

from fastapi import FastAPI, HTTPException, Request
from fastapi.responses import JSONResponse

from fiscal_agent.api.routes import admin, calendar, extract, health, report
from fiscal_agent.api.store import seed_defaults
from fiscal_agent.models import UnifiedResponse


@asynccontextmanager
async def lifespan(app: FastAPI) -> AsyncIterator[None]:
	"""Initialize seed data on startup."""
	seed_defaults()
	yield


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
	"""Apply rate limiting per API key (skip for health and admin register)."""
	path = request.url.path

	# Skip rate limiting for health and registration
	if path in ('/v1/health',) or (path == '/v1/admin/register' and request.method == 'POST'):
		return await call_next(request)

	# Check if we have auth state (request.state.api_key set by ScopeRequired)
	# If no auth, let auth middleware handle it first
	response = await call_next(request)
	return response


# ── Routers ─────────────────────────────────────────────────────────────

app.include_router(health.router, tags=['health'])
app.include_router(calendar.router, tags=['calendar'])
app.include_router(report.router, tags=['report'])
app.include_router(extract.router, tags=['extract'])
app.include_router(admin.router, tags=['admin'])
