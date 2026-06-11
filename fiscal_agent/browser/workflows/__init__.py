"""Workflow templates for Composio Browser Tool.

Separados por etapa del pipeline ARCA:
    - login.py:  autenticación en AFIP con detección ARCA-4/ARCA-6
    - extract.py: extracción de deuda de Mis Facilidades (legacy)
    - full.py: pipeline completo login + switch + extract (ctacte.cloud)
    - facilidades.py: planes de pago vigentes y caducos recientes
"""

from fiscal_agent.browser.workflows.extract import TEMPLATE_EXTRACT
from fiscal_agent.browser.workflows.facilidades import TEMPLATE_FACILIDADES
from fiscal_agent.browser.workflows.full import TEMPLATE_FULL
from fiscal_agent.browser.workflows.login import TEMPLATE_LOGIN
from fiscal_agent.browser.workflows.registro import TEMPLATE_REGISTRO

__all__ = [
	'TEMPLATE_EXTRACT',
	'TEMPLATE_FACILIDADES',
	'TEMPLATE_FULL',
	'TEMPLATE_LOGIN',
	'TEMPLATE_REGISTRO',
]
