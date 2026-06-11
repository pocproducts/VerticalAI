"""Fiscal agent entry point: python -m fiscal_agent [command].

Usage:
	python -m fiscal_agent validate [config]     Validar clients.yaml
	python -m fiscal_agent generate-template     Generar CSV template
	python -m fiscal_agent run                   Ejecutar pipeline completo
	python -m fiscal_agent run --help            Ayuda del comando run
"""

from fiscal_agent.cli import main

main()
