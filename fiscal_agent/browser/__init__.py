"""Browser automation layer for ARCA extraction.

Composio Browser Tool — instrucciones NL en lugar de Playwright + YAML.
"""

from fiscal_agent.browser.composio import ComposioBrowser
from fiscal_agent.browser.task import BrowserTask, FacilidadesTask, FullTask, LoginTask, RegistroTask

__all__ = [
	'ComposioBrowser',
	'BrowserTask',
	'FacilidadesTask',
	'FullTask',
	'LoginTask',
	'RegistroTask',
]
