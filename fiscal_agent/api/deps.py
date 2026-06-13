"""Dependency injection and shared resources for API routes.

Initializes cached instances of RulesEngine, PdfGenerator, and
manages the WSAA Ticket de Acceso lifecycle for all endpoints.
"""

from __future__ import annotations

import logging
from datetime import datetime, timezone
from pathlib import Path
from typing import Optional

from fiscal_agent.arca_ws import obtener_ta
from fiscal_agent.config import get_settings
from fiscal_agent.memory import FiscalMemoryClient
from fiscal_agent.pdf_generator import PdfGenerator
from fiscal_agent.rules_engine import RulesEngine

logger = logging.getLogger(__name__)

# ── Paths ───────────────────────────────────────────────────────────────

CERT_DIR = Path('.certificados-arca')
CERT_PATH = CERT_DIR / 'produccion.crt'
KEY_PATH = CERT_DIR / 'produccion.key'
REPRESENTANTE_CUIT = get_settings().credentials.cuit

# ── Cached services ─────────────────────────────────────────────────────

_engine: Optional[RulesEngine] = None
_pdf_gen: Optional[PdfGenerator] = None
_ta_cache: dict = {}  # {'token': str, 'sign': str, 'expiry': datetime}
_memory: Optional[FiscalMemoryClient] = None


def get_engine() -> RulesEngine:
	"""Return cached RulesEngine instance."""
	global _engine
	if _engine is None:
		_engine = RulesEngine()
	return _engine


def get_pdf_gen() -> PdfGenerator:
	"""Return cached PdfGenerator instance."""
	global _pdf_gen
	if _pdf_gen is None:
		_pdf_gen = PdfGenerator()
	return _pdf_gen


def get_memory() -> FiscalMemoryClient:
	"""Return cached FiscalMemoryClient instance (best-effort, never raises)."""
	global _memory
	if _memory is None:
		_memory = FiscalMemoryClient()
	return _memory


def get_ta(service: str = 'ws_sr_constancia_inscripcion') -> tuple[Optional[str], Optional[str]]:
	"""Return cached Ticket de Acceso, refreshing if expired.

	Returns (token, sign) or (None, None) if certs are missing.
	"""
	global _ta_cache

	now = datetime.now(timezone.utc)

	# Return cached TA if still valid
	if _ta_cache and _ta_cache.get('expiry', now) > now:
		return _ta_cache['token'], _ta_cache['sign']

	# Attempt to obtain a new TA
	if not CERT_PATH.exists() or not KEY_PATH.exists():
		logger.warning('Certificados no encontrados en %s', CERT_DIR)
		return None, None

	try:
		token, sign = obtener_ta(service, str(CERT_PATH), str(KEY_PATH))
		# obtener_ta prints the expiry — we parse from its output or set a default 11h TTL
		_ta_cache = {
			'token': token,
			'sign': sign,
			'expiry': now.replace(hour=now.hour + 11, minute=0, second=0),
		}
		return token, sign
	except Exception as exc:
		logger.error('Error obteniendo TA: %s', exc)
		return None, None
