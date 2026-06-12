"""Fixed-window rate limiter for API keys.

Simple in-memory implementation using time.time() windows.
Not suitable for horizontal scaling — use Redis in production.
"""

from __future__ import annotations

import time
from typing import Optional

from fiscal_agent.models import Plan

# ── Window storage ──────────────────────────────────────────────────

#: api_key_id -> {'minute': {window_start, count}, 'day': {window_start, count}}
_windows: dict[str, dict] = {}

#: Default limits for plans without explicit config
_DEFAULT_RPM = 10
_DEFAULT_RPD = 100

_WINDOW_MINUTE = 60
_WINDOW_DAY = 86400


def _get_window(api_key_id: str, window_type: str, window_size: int) -> dict:
	"""Get or create a rate limit window."""
	now = time.time()
	window_key = f'{window_type}_{window_size}'

	if api_key_id not in _windows:
		_windows[api_key_id] = {}

	entry = _windows[api_key_id].get(window_key)
	if entry is None or (now - entry['start']) >= window_size:
		entry = {'start': now, 'count': 0}
		_windows[api_key_id][window_key] = entry

	return entry


def check_rate_limit(api_key_id: str, plan: Optional[Plan] = None) -> dict:
	"""Check if request is within rate limits.

	Returns dict with:
	- ``allowed``: bool
	- ``limit``: int (requests per minute)
	- ``remaining``: int
	- ``retry_after``: int (seconds, 0 if allowed)
	"""
	rpm = plan.rate_limit_rpm if plan else _DEFAULT_RPM
	rpd = plan.rate_limit_rpd if plan else _DEFAULT_RPD

	# ── Minute window ─────────────────────────────────────────────
	min_window = _get_window(api_key_id, 'minute', _WINDOW_MINUTE)
	min_window['count'] += 1

	minute_remaining = max(0, rpm - min_window['count'])
	minute_allowed = min_window['count'] <= rpm

	# ── Day window ────────────────────────────────────────────────
	day_window = _get_window(api_key_id, 'day', _WINDOW_DAY)
	day_window['count'] += 1

	day_remaining = max(0, rpd - day_window['count'])
	day_allowed = day_window['count'] <= rpd

	# ── Determine result ──────────────────────────────────────────
	allowed = minute_allowed and day_allowed
	retry_after = 0

	if not allowed:
		if not minute_allowed:
			retry_after = int(_WINDOW_MINUTE - (time.time() - min_window['start']))
		else:
			retry_after = int(_WINDOW_DAY - (time.time() - day_window['start']))

	return {
		'allowed': allowed,
		'limit': rpm,
		'remaining': minute_remaining if allowed else 0,
		'retry_after': max(1, retry_after),
	}
