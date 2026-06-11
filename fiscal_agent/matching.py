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
"""

from __future__ import annotations

import unicodedata
from typing import Optional

from fiscal_agent.models import ImpuestoInscripto, RegistroImpuesto, RentasCordobaMatching


def _normalize(text: str) -> str:
	"""Normaliza el texto: uppercase + remueve acentos para matching robusto."""
	text = text.upper()
	# Normaliza caracteres unicode (descompone: Ó → O + combining accent)
	nfkd = unicodedata.normalize('NFKD', text)
	# Filtra solo ASCII (descarta acentos combinados)
	return nfkd.encode('ASCII', 'ignore').decode('ASCII')


#: idImpuesto del padrón que corresponden a IIBB (copia del set en
#: rules_engine._IMPUESTO_TO_OBLIGACION, duplicado para evitar acoplamiento).
_IIBB_IDS: set[int] = {5904, 5902, 5905, 5906, 215}


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
	# ── Convenio Multilateral check ───────────────────────────────────
	tiene_convenio: bool = False
	if provincias is not None and len(provincias) >= 2 and impuestos_ws is not None:
		tiene_convenio = any(imp.idImpuesto is not None and imp.idImpuesto in _IIBB_IDS for imp in impuestos_ws)

	# ── IIBB Córdoba check ────────────────────────────────────────────
	tiene_iibb_cordoba: Optional[bool] = None
	if registro_impuestos is not None and len(registro_impuestos) > 0:
		tiene_iibb_cordoba = any('CORDOBA' in _normalize(imp.impuesto or '') for imp in registro_impuestos)

	# ── Resultado ─────────────────────────────────────────────────────
	requiere_integracion = tiene_convenio and (tiene_iibb_cordoba is True)

	if requiere_integracion:
		estado = 'pendiente'
		observacion = (
			'Contribuyente con Convenio Multilateral IIBB y registro en '
			'IIBB Córdoba. La integración con Rentas Córdoba está en desarrollo.'
		)
	elif tiene_iibb_cordoba is None:
		estado = 'sin_datos'
		observacion = 'No se pudo evaluar la necesidad de integración con Rentas Córdoba (faltan datos de registro tributario).'
	else:
		estado = 'no_requerido'
		observacion = ''

	return RentasCordobaMatching(
		requiere_integracion=requiere_integracion,
		tiene_convenio_multilateral=tiene_convenio,
		tiene_iibb_cordoba=tiene_iibb_cordoba,
		estado=estado,
		observacion=observacion,
	)
