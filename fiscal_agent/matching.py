"""Matching engine para detectar contribuyentes que requieren Rentas Córdoba.

Evalúa si un contribuyente con Convenio Multilateral IIBB y registro
en IIBB Córdoba (desde RUT) necesita integración con Rentas Córdoba.

Uso:
	from fiscal_agent.matching import evaluar_rentas_cordoba

	resultado = evaluar_rentas_cordoba(
	    provincias=cliente.provincias,
	    impuestos_ws=padron.regimenGeneral.impuestos,
	    registro_impuestos=deuda_output.registro.impuestos,
	)

Nota:
	``evaluar_rentas_cordoba`` ahora es un **thin wrapper** que delega
	en ``TenantBrain._match_rentas()``. La firma y el comportamiento
	público son idénticos — no se requiere cambios en los callers.
"""

from __future__ import annotations

from typing import Optional

from fiscal_agent.memory import FiscalMemoryClient
from fiscal_agent.memory.brain import TenantBrain
from fiscal_agent.models import ImpuestoInscripto, RegistroImpuesto, RentasCordobaMatching


def evaluar_rentas_cordoba(
	provincias: Optional[list[str]],
	impuestos_ws: Optional[list[ImpuestoInscripto]],
	registro_impuestos: Optional[list[RegistroImpuesto]],
) -> RentasCordobaMatching:
	"""Evalúa si un contribuyente requiere integración con Rentas Córdoba.

	La regla es conjuntiva — TODAS las condiciones deben cumplirse:

	1. **Convenio Multilateral**: 2+ provincias configuradas Y al menos un
	   ``idImpuesto`` IIBB (5904/5902/5905/5906/215) en ``impuestos_ws``.
	2. **IIBB Córdoba**: al menos un ``RegistroImpuesto`` cuyo campo
	   ``impuesto`` contenga "CORDOBA" (case-insensitive).

	Args:
		provincias: Provincias configuradas del cliente (ClientConfig).
		impuestos_ws: Impuestos del Padrón A5 (WS API).
		registro_impuestos: Impuestos del RegistroOutput (RUT browser task).

	Returns:
		RentasCordobaMatching con campos evaluados.
	"""
	brain = TenantBrain(FiscalMemoryClient())
	return brain._match_rentas(
		provincias=list(provincias) if provincias is not None else None,
		impuestos_ws=list(impuestos_ws) if impuestos_ws is not None else None,
		registro_impuestos=list(registro_impuestos) if registro_impuestos is not None else None,
	)
