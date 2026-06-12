"""In-memory data store for tenant management.

Holds developers, apps, API keys, and plans in process memory.
All data is lost on server restart — use for development/MVP only.
"""

from __future__ import annotations

import secrets
from datetime import datetime, timezone
from typing import Optional

from fiscal_agent.models import ApiKey, App, Developer, Plan, Scope

# ── In-memory storage ─────────────────────────────────────────────────

_developers: dict[str, Developer] = {}
_apps: dict[str, App] = {}
_api_keys: dict[str, ApiKey] = {}  # api_key_id -> ApiKey
_plans: dict[str, Plan] = {}
_key_hash: dict[str, str] = {}  # hashed_full_key -> api_key_id


def _generate_id() -> str:
	"""Generate a short unique ID."""
	import uuid

	return uuid.uuid4().hex[:12]


def _hash_key(key: str) -> str:
	"""Simple hash for API key lookup (not cryptographic — MVP only)."""
	import hashlib

	return hashlib.sha256(key.encode()).hexdigest()


def seed_defaults() -> None:
	"""Seed default plans and admin developer.

	Creates:
	- Plan "Free" with basic scopes
	- Developer "admin" with a default app and API key
	"""
	# ── Plans ─────────────────────────────────────────────────────
	free_plan = Plan(
		id=_generate_id(),
		name='Free',
		scopes=[
			Scope.CALENDAR_READ,
			Scope.TAXPAYER_READ,
			Scope.REPORT_READ,
		],
		rate_limit_rpm=10,
		rate_limit_rpd=100,
	)
	_plans[free_plan.id] = free_plan

	# ── Admin developer ───────────────────────────────────────────
	admin_dev = Developer(
		id=_generate_id(),
		name='Admin',
		email='admin@fiscal-agent.local',
		created_at=datetime.now(timezone.utc),
		is_active=True,
	)
	_developers[admin_dev.id] = admin_dev

	admin_app = App(
		id=_generate_id(),
		developer_id=admin_dev.id,
		name='Admin App',
		environment='production',
		status='active',
	)
	_apps[admin_app.id] = admin_app

	# Generate admin API key with full scopes
	full_key = f'fa_{secrets.token_hex(16)}'
	admin_key = ApiKey(
		id=_generate_id(),
		app_id=admin_app.id,
		key_preview=full_key[-4:],
		is_active=True,
		scopes=list(Scope),
		created_at=datetime.now(timezone.utc),
	)
	_api_keys[admin_key.id] = admin_key
	_key_hash[_hash_key(full_key)] = admin_key.id


# ── CRUD operations ─────────────────────────────────────────────────


def register_developer(name: str, email: str) -> Developer:
	"""Register a new developer account."""
	dev = Developer(
		id=_generate_id(),
		name=name,
		email=email,
		created_at=datetime.now(timezone.utc),
		is_active=True,
	)
	_developers[dev.id] = dev
	return dev


def create_app(developer_id: str, name: str, environment: str) -> Optional[App]:
	"""Create a new app for a developer."""
	dev = _developers.get(developer_id)
	if dev is None:
		return None

	app = App(
		id=_generate_id(),
		developer_id=developer_id,
		name=name,
		environment=environment,
		status='active',
	)
	_apps[app.id] = app
	return app


def create_api_key(app_id: str) -> Optional[dict]:
	"""Generate a new API key for an app.

	Returns dict with the ApiKey model and the full key string.
	The full key is only returned once.
	"""
	app = _apps.get(app_id)
	if app is None:
		return None

	full_key = f'fa_{secrets.token_hex(16)}'
	api_key = ApiKey(
		id=_generate_id(),
		app_id=app_id,
		key_preview=full_key[-4:],
		is_active=True,
		created_at=datetime.now(timezone.utc),
	)
	_api_keys[api_key.id] = api_key
	_key_hash[_hash_key(full_key)] = api_key.id

	return {'api_key': api_key, 'full_key': full_key}


def resolve_api_key(key: str) -> Optional[tuple[Developer, App, ApiKey, Plan]]:
	"""Resolve a full API key to its Developer, App, ApiKey, and Plan.

	Returns None if the key is unknown or inactive.
	"""
	api_key_id = _key_hash.get(_hash_key(key))
	if api_key_id is None:
		return None

	api_key = _api_keys.get(api_key_id)
	if api_key is None or not api_key.is_active:
		return None

	app = _apps.get(api_key.app_id)
	if app is None or app.status != 'active':
		return None

	dev = _developers.get(app.developer_id)
	if dev is None or not dev.is_active:
		return None

	# Resolve plan (first plan that covers all scopes, or default Free)
	plan = next((p for p in _plans.values() if all(s in p.scopes for s in api_key.scopes)), None)
	if plan is None:
		# Fallback: find first matching plan
		for p in _plans.values():
			if any(s in p.scopes for s in api_key.scopes):
				plan = p
				break

	if plan is None:
		# Absolute fallback
		plan = list(_plans.values())[0] if _plans else None

	return (dev, app, api_key, plan)


def list_developer_keys(developer_id: str) -> list[ApiKey]:
	"""List all API keys across all apps owned by a developer."""
	dev = _developers.get(developer_id)
	if dev is None:
		return []

	dev_apps = [a for a in _apps.values() if a.developer_id == developer_id]
	dev_app_ids = {a.id for a in dev_apps}

	return [k for k in _api_keys.values() if k.app_id in dev_app_ids]
