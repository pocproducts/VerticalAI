"""Tests for system monitoring endpoints — /v1/system/*.

Uses FastAPI TestClient with mocked Engram search and Redis cache.

Scenarios:
- GET /v1/system/metrics: 24h/7d/30d, empty state
- GET /v1/system/services: all services listed
- GET /v1/system/activity: pagination
- GET /v1/system/errors: filter by severity, service
"""

from __future__ import annotations

from unittest.mock import MagicMock, patch

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from fiscal_agent.models import ApiKey, App, Developer, Plan, Scope, UnifiedResponse

_VALID_KEY = 'fa_test_admin_key_12345'


def _make_mock_store_result() -> tuple:
	"""Return a tuple matching ``RedisStore.resolve_api_key`` return type."""
	from datetime import datetime

	dev = Developer(
		id='dev-1',
		name='Test Dev',
		email='dev@test.com',
		auth0_id='',
		created_at=datetime.now(),
		is_active=True,
	)
	app_obj = App(
		id='app-1',
		developer_id='dev-1',
		name='Test App',
		environment='sandbox',
		status='active',
	)
	api_key = ApiKey(
		id='key-1',
		app_id='app-1',
		key_preview=_VALID_KEY[-4:],
		is_active=True,
		scopes=[Scope.ADMIN_READ, Scope.ADMIN_WRITE],
		created_at=datetime.now(),
	)
	plan = Plan(
		id='plan-1',
		name='Test Plan',
		scopes=[Scope.ADMIN_READ, Scope.ADMIN_WRITE],
		rate_limit_rpm=1000,
		rate_limit_rpd=10000,
	)
	return (dev, app_obj, api_key, plan)


@pytest.fixture
def app() -> FastAPI:
	"""Build app with monitor router and mocked store."""
	app = FastAPI()
	mock_store = MagicMock()
	mock_store.resolve_api_key.return_value = _make_mock_store_result()
	app.state.store = mock_store
	app.state.redis = MagicMock()

	from fiscal_agent.api.rate_limiter import check_rate_limit

	app.dependency_overrides[check_rate_limit] = lambda api_key_id, plan: {
		'allowed': True,
		'retry_after': 0,
		'remaining': 999,
	}

	from fiscal_agent.api.routes.monitor import router

	app.include_router(router)
	return app


@pytest.fixture
def client(app: FastAPI) -> TestClient:
	"""TestClient with valid admin API key."""
	return TestClient(app)


@pytest.fixture
def auth_header() -> dict[str, str]:
	return {'Authorization': f'Bearer {_VALID_KEY}'}


# ── GET /v1/system/metrics ─────────────────────────────────────────────────────


class TestSystemMetrics:
	"""GET /v1/system/metrics endpoint."""

	@patch('fiscal_agent.api.routes.monitor.get_memory')
	def test_metrics_24h(self, mock_get_memory: MagicMock, client: TestClient, auth_header: dict) -> None:
		"""Happy path: returns metrics with 24h period."""
		mock_memory = MagicMock()
		mock_memory._engram_get.return_value = []
		mock_get_memory.return_value = mock_memory

		resp = client.get('/v1/system/metrics?period=24h', headers=auth_header)
		assert resp.status_code == 200
		data = resp.json()
		assert data['status'] == 'success'
		assert 'total_runs' in data['result']

	@patch('fiscal_agent.api.routes.monitor.get_memory')
	def test_metrics_7d(self, mock_get_memory: MagicMock, client: TestClient, auth_header: dict) -> None:
		"""Happy path: 7d period."""
		mock_memory = MagicMock()
		mock_memory._engram_get.return_value = []
		mock_get_memory.return_value = mock_memory

		resp = client.get('/v1/system/metrics?period=7d', headers=auth_header)
		assert resp.status_code == 200
		data = resp.json()
		assert data['result']['total_runs'] == 0

	@patch('fiscal_agent.api.routes.monitor.get_memory')
	def test_metrics_empty(self, mock_get_memory: MagicMock, client: TestClient, auth_header: dict) -> None:
		"""Empty state: zero metrics returned."""
		mock_memory = MagicMock()
		mock_memory._engram_get.return_value = []
		mock_get_memory.return_value = mock_memory

		resp = client.get('/v1/system/metrics', headers=auth_header)
		assert resp.status_code == 200
		data = resp.json()
		assert data['result']['total_runs'] == 0
		assert data['result']['error_rate'] == 0.0

	def test_metrics_requires_auth(self) -> None:
		"""Without auth, returns 401."""
		app = FastAPI()
		from fiscal_agent.api.routes.monitor import router

		app.include_router(router)
		resp = TestClient(app).get('/v1/system/metrics')
		assert resp.status_code == 401


# ── GET /v1/system/services ──────────────────────────────────────────────────


class TestSystemServices:
	"""GET /v1/system/services endpoint."""

	@patch('fiscal_agent.api.routes.monitor.get_memory')
	@patch('fiscal_agent.api.routes.monitor._check_redis')
	@patch('fiscal_agent.api.routes.monitor._check_engram')
	@patch('fiscal_agent.api.routes.monitor._check_ta')
	@patch('fiscal_agent.api.routes.monitor._check_composio')
	def test_services_list(
		self,
		mock_composio: MagicMock,
		mock_ta: MagicMock,
		mock_engram: MagicMock,
		mock_redis: MagicMock,
		mock_get_memory: MagicMock,
		client: TestClient,
		auth_header: dict,
	) -> None:
		"""Returns all four services."""
		from fiscal_agent.models import ServiceStatus

		from datetime import datetime

		ts = datetime(2026, 1, 1)
		mock_redis.return_value = ServiceStatus(name='redis', status='healthy', last_check=ts)
		mock_engram.return_value = ServiceStatus(name='engram', status='healthy', last_check=ts)
		mock_ta.return_value = ServiceStatus(name='ta', status='healthy', last_check=ts)
		mock_composio.return_value = ServiceStatus(name='composio', status='healthy', last_check=ts)

		resp = client.get('/v1/system/services', headers=auth_header)
		assert resp.status_code == 200
		data = resp.json()
		assert data['status'] == 'success'
		names = {s['name'] for s in data['result']}
		assert names == {'redis', 'engram', 'ta', 'composio'}


# ── GET /v1/system/activity ─────────────────────────────────────────────────


class TestSystemActivity:
	"""GET /v1/system/activity endpoint."""

	@patch('fiscal_agent.api.routes.monitor.get_memory')
	def test_activity_pagination(
		self,
		mock_get_memory: MagicMock,
		client: TestClient,
		auth_header: dict,
	) -> None:
		"""Returns paginated activity events."""
		mock_memory = MagicMock()
		mock_memory._engram_get.return_value = [
			{'id': 1, 'type': 'pipeline_run', 'title': 'Run 1', 'content': '**Cuit**: 20324837796\n**Status**: success'},
			{'id': 2, 'type': 'error', 'title': 'Error 1', 'content': '**Cuit**: 20324837796\n**Error**: timeout'},
		]
		mock_get_memory.return_value = mock_memory

		resp = client.get('/v1/system/activity?limit=2&offset=0', headers=auth_header)
		assert resp.status_code == 200
		data = resp.json()
		assert data['status'] == 'success'
		assert len(data['result']) == 2

	@patch('fiscal_agent.api.routes.monitor.get_memory')
	def test_activity_empty(
		self,
		mock_get_memory: MagicMock,
		client: TestClient,
		auth_header: dict,
	) -> None:
		"""Empty activity returns empty list."""
		mock_memory = MagicMock()
		mock_memory._engram_get.return_value = []
		mock_get_memory.return_value = mock_memory

		resp = client.get('/v1/system/activity', headers=auth_header)
		assert resp.status_code == 200
		data = resp.json()
		assert data['result'] == []


# ── GET /v1/system/errors ───────────────────────────────────────────────────


class TestSystemErrors:
	"""GET /v1/system/errors endpoint."""

	@patch('fiscal_agent.api.routes.monitor.get_memory')
	def test_errors_filter_severity(
		self,
		mock_get_memory: MagicMock,
		client: TestClient,
		auth_header: dict,
	) -> None:
		"""Filter by severity."""
		mock_memory = MagicMock()
		mock_memory._engram_get.return_value = [
			{'id': 1, 'type': 'error', 'title': 'Error', 'content': '**Stage**: pipeline\n**Error**: timeout'},
		]
		mock_get_memory.return_value = mock_memory

		resp = client.get('/v1/system/errors?severity=error', headers=auth_header)
		assert resp.status_code == 200
		data = resp.json()
		assert data['status'] == 'success'

	@patch('fiscal_agent.api.routes.monitor.get_memory')
	def test_errors_filter_service(
		self,
		mock_get_memory: MagicMock,
		client: TestClient,
		auth_header: dict,
	) -> None:
		"""Filter by service name."""
		mock_memory = MagicMock()
		mock_memory._engram_get.return_value = []
		mock_get_memory.return_value = mock_memory

		resp = client.get('/v1/system/errors?service=pipeline&period=7d', headers=auth_header)
		assert resp.status_code == 200
		data = resp.json()
		assert data['status'] == 'success'
