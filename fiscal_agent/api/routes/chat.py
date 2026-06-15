"""POST /v1/chat/message — natural-language fiscal query endpoint.

Recibe un mensaje en lenguaje natural, detecta el CUIT + intención,
despacha al handler correspondiente (sincrónico, en thread pool),
y devuelve una respuesta formateada en español.

Streaming
---------
``POST /v1/chat/message/stream`` devuelve un SSE (Server-Sent Events)
con eventos ``progress`` y ``complete``, replicando el output de la CLI
en tiempo real.
"""

from __future__ import annotations

import asyncio
import json
import uuid
from pathlib import Path
from typing import Any, Callable

from fastapi import APIRouter, HTTPException
from fastapi.responses import FileResponse, StreamingResponse
from pydantic import BaseModel, ConfigDict, Field

from fiscal_agent.chat.intent_router import Intent, detect
from fiscal_agent.chat.response_builder import format_reporte_response, format_taxpayer_response

router = APIRouter()

# ── Request / Response models ───────────────────────────────────────────────


class ChatRequest(BaseModel):
	"""Natural-language chat message from the user."""

	model_config = ConfigDict(extra='forbid')

	message: str = Field(description='Natural language query from the user')
	conversation_id: str | None = Field(
		default=None,
		description='Opaque conversation identifier (generated if omitted)',
	)
	history: list[dict] | None = Field(
		default=None,
		description='Previous messages: [{"role": "user"|"assistant", "content": str}]',
	)


class ChatResponse(BaseModel):
	"""Structured chat response with natural-language reply and metadata."""

	model_config = ConfigDict(extra='forbid')

	conversation_id: str = Field(description='Conversation identifier')
	reply: str = Field(description='Human-readable response in Spanish')
	actions_taken: list[str] = Field(
		default_factory=list,
		description='Internal actions performed (e.g. ["consultar_cuit"])',
	)
	data: dict[str, Any] | None = Field(
		default=None,
		description='Structured results from backend queries',
	)


# ── Sync handlers (run in thread pool to avoid blocking the event loop) ──────


def _handle_taxpayer(cuit: str) -> dict[str, Any] | None:
	"""Consult taxpayer data via ARCA WS API (sync)."""
	from fiscal_agent.api.deps import REPRESENTANTE_CUIT, get_ta
	from fiscal_agent.arca_ws import consultar_cuit

	token, sign = get_ta()
	if not token or not sign:
		return None

	try:
		result = consultar_cuit(cuit, token, sign, REPRESENTANTE_CUIT)
		output = result.to_output()
		if output.errorConstancia:
			return {'error': '; '.join(output.errorConstancia.error)}
		output_dict = result.to_dict()
		return {
			'nombre': output_dict.get('nombre') or (output.datosGenerales.razonSocial if output.datosGenerales else ''),
			'tipo': output_dict.get('tipo', ''),
			'tipo_persona': output_dict.get('tipo_persona', ''),
		}
	except Exception as exc:
		return {'error': str(exc)}


def _handle_reporte(cuit: str) -> dict[str, Any] | None:
	"""Generate a complete fiscal report (sync — delegates to ``_procesar_cliente_pipeline``).

	Mirrors the CLI ``report`` flow but returns structured data instead of
	printing to console.  Runs the same ``_procesar_cliente_pipeline()``
	shared by the CLI so behaviour is identical.
	"""
	from datetime import datetime

	from fiscal_agent.api.deps import REPRESENTANTE_CUIT, get_engine, get_memory, get_pdf_gen, get_ta
	from fiscal_agent.cli import _completar_cliente_desde_padron, _procesar_cliente_pipeline
	from fiscal_agent.config import get_settings
	from fiscal_agent.models import ClientConfig

	token, sign = get_ta()
	if not token or not sign:
		return None

	# Build minimal client config
	cliente = ClientConfig(cuit=cuit)
	try:
		cliente = _completar_cliente_desde_padron(cliente, token, sign, REPRESENTANTE_CUIT)
	except Exception:
		pass  # Best-effort — proceed with bare CUIT if padrón is unavailable

	now = datetime.utcnow()
	mes, anio = now.month, now.year

	engine = get_engine()
	pdf_gen = get_pdf_gen()
	memory = get_memory()

	creds = get_settings().credentials
	browser = None
	with_browser = bool(creds.composio_api_key and creds.clave_fiscal)

	if with_browser:
		from fiscal_agent.browser import ComposioBrowser

		browser = ComposioBrowser(
			composio_api_key=creds.composio_api_key,
			estudio_cuit=REPRESENTANTE_CUIT,
			estudio_clave=creds.clave_fiscal,
		)

	try:
		resultado = _procesar_cliente_pipeline(
			cliente=cliente,
			token=token,
			sign=sign,
			engine=engine,
			pdf_gen=pdf_gen,
			mes=mes,
			anio=anio,
			browser=browser,
			with_deuda=with_browser,
			with_facilidades=with_browser,
			with_registro=with_browser,
			send_email=False,
			config=None,
			memory_client=memory,
		)
		return resultado
	except Exception as exc:
		return {'error': str(exc)}


# ── Streaming handler (accepts echo_func for progress) ───────────────────


def _handle_reporte_with_echo(
	cuit: str,
	echo_func: Callable[[str], None],
) -> dict[str, Any] | None:
	"""Same as ``_handle_reporte`` but passes ``echo_func`` to the pipeline.

	The ``echo_func`` is called at each pipeline step with the same messages
	that the CLI prints via ``typer.echo``.  Used by the SSE endpoint to
	stream progress in real time.
	"""
	from datetime import datetime

	from fiscal_agent.api.deps import REPRESENTANTE_CUIT, get_engine, get_memory, get_pdf_gen, get_ta
	from fiscal_agent.cli import _completar_cliente_desde_padron, _procesar_cliente_pipeline
	from fiscal_agent.config import get_settings
	from fiscal_agent.models import ClientConfig

	token, sign = get_ta()
	if not token or not sign:
		return None

	cliente = ClientConfig(cuit=cuit)
	try:
		cliente = _completar_cliente_desde_padron(cliente, token, sign, REPRESENTANTE_CUIT)
	except Exception:
		pass

	now = datetime.utcnow()
	mes, anio = now.month, now.year

	engine = get_engine()
	pdf_gen = get_pdf_gen()
	memory = get_memory()

	creds = get_settings().credentials
	browser = None
	with_browser = bool(creds.composio_api_key and creds.clave_fiscal)

	if with_browser:
		from fiscal_agent.browser import ComposioBrowser

		browser = ComposioBrowser(
			composio_api_key=creds.composio_api_key,
			estudio_cuit=REPRESENTANTE_CUIT,
			estudio_clave=creds.clave_fiscal,
		)

	try:
		resultado = _procesar_cliente_pipeline(
			cliente=cliente,
			token=token,
			sign=sign,
			engine=engine,
			pdf_gen=pdf_gen,
			mes=mes,
			anio=anio,
			browser=browser,
			with_deuda=with_browser,
			with_facilidades=with_browser,
			with_registro=with_browser,
			send_email=False,
			config=None,
			memory_client=memory,
			echo_func=echo_func,
		)
		return resultado
	except Exception as exc:
		return {'error': str(exc)}


# ── SSE endpoint ─────────────────────────────────────────────────────────


@router.post(
	'/v1/chat/message/stream',
	summary='Enviar mensaje y recibir progreso vía SSE',
	responses={
		422: {'description': 'Error de validación'},
	},
)
async def chat_message_stream(request: ChatRequest):
	"""Igual que ``/v1/chat/message`` pero devuelve SSE con progreso.

	Cada paso del pipeline se envía como un evento ``progress``.
	Al finalizar se envía ``complete`` con la respuesta final.

	Formato SSE::

	        event: progress
	        data: {'message': '  Consultando Padrón A5 ...'}

	        event: complete
	        data: {'reply': '...', 'pdf_url': '...'}
	"""
	message = request.message
	conversation_id = request.conversation_id or str(uuid.uuid4())

	# 1. Detect intent + extract CUIT
	intent, cuit, _params = detect(message)

	# 2-3. Early returns for invalid/no-intent (same as regular endpoint)
	if not cuit and intent != Intent.UNKNOWN:
		return StreamingResponse(
			_iter_sse_early(conversation_id, 'Por favor, proporcioná un CUIT válido para realizar la consulta.'),
			media_type='text/event-stream',
			headers={'Cache-Control': 'no-cache', 'X-Accel-Buffering': 'no'},
		)

	if intent == Intent.UNKNOWN:
		return StreamingResponse(
			_iter_sse_early(
				conversation_id,
				'Podés consultar datos de un contribuyente '
				'(ej: **consulta CUIT 30716395541**) o generar un reporte '
				'completo (ej: **reporte CUIT 30716395541**).',
			),
			media_type='text/event-stream',
			headers={'Cache-Control': 'no-cache', 'X-Accel-Buffering': 'no'},
		)

	if intent != Intent.REPORTE_COMPLETO:
		return StreamingResponse(
			_iter_sse_early(conversation_id, 'Intento no soportado.'),
			media_type='text/event-stream',
			headers={'Cache-Control': 'no-cache', 'X-Accel-Buffering': 'no'},
		)

	# 4. Streaming flow for REPORTE_COMPLETO
	queue: asyncio.Queue[tuple[str, Any]] = asyncio.Queue()

	# Capture the event loop BEFORE entering the thread pool,
	# because _progress() is called from inside asyncio.to_thread
	# where get_running_loop() would raise RuntimeError.
	_loop = asyncio.get_running_loop()

	def _progress(msg: str) -> None:
		_loop.call_soon_threadsafe(queue.put_nowait, ('progress', msg))

	async def _run():
		try:
			data = await asyncio.to_thread(_handle_reporte_with_echo, cuit, _progress)
			reply = format_reporte_response(data, cuit)
			await queue.put(('complete', {'reply': reply, 'data': data}))
		except Exception as exc:
			await queue.put(('complete', {'reply': f'Ocurrió un error: {exc}', 'data': None}))

	async def _generate():
		task = asyncio.create_task(_run())
		while True:
			event_type, payload = await queue.get()
			if event_type == 'progress':
				yield f'event: progress\ndata: {json.dumps({"message": payload})}\n\n'
			elif event_type == 'complete':
				yield f'event: complete\ndata: {json.dumps(payload)}\n\n'
				break
		await task

	return StreamingResponse(
		_generate(),
		media_type='text/event-stream',
		headers={'Cache-Control': 'no-cache', 'Connection': 'keep-alive', 'X-Accel-Buffering': 'no'},
	)


def _iter_sse_early(conversation_id: str, reply: str):
	"""Yield a single SSE complete event for early-return cases."""
	yield f'event: complete\ndata: {json.dumps({"reply": reply, "conversation_id": conversation_id})}\n\n'


# ── Intent → action name map ──────────────────────────────────────────────

_ACTION_NAMES: dict[Intent, str] = {
	Intent.TAXPAYER_QUERY: 'consultar_cuit',
	Intent.REPORTE_COMPLETO: 'generar_reporte',
}


# ── Endpoint ────────────────────────────────────────────────────────────────


@router.post(
	'/v1/chat/message',
	response_model=ChatResponse,
	summary='Enviar mensaje de chat al asistente fiscal',
	responses={
		422: {'description': 'Error de validación'},
	},
)
async def chat_message(request: ChatRequest) -> ChatResponse:
	"""Procesa un mensaje en lenguaje natural y devuelve una respuesta.

	Detecta la intención y el CUIT mediante expresiones regulares,
	despacha al handler interno correspondiente (ejecutado en un thread
	pool para no bloquear el event loop), y formatea la respuesta en
	español natural.
	"""
	message = request.message
	conversation_id = request.conversation_id or str(uuid.uuid4())

	# 1. Detect intent + extract CUIT
	intent, cuit, _params = detect(message)

	# 2. No CUIT found
	if not cuit and intent != Intent.UNKNOWN:
		return ChatResponse(
			conversation_id=conversation_id,
			reply='Por favor, proporcioná un CUIT válido para realizar la consulta.',
			actions_taken=[],
		)

	# 3. Unknown intent — show help
	if intent == Intent.UNKNOWN:
		return ChatResponse(
			conversation_id=conversation_id,
			reply=(
				'Podés consultar datos de un contribuyente '
				'(ej: **consulta CUIT 30716395541**) o generar un reporte '
				'completo (ej: **reporte CUIT 30716395541**).'
			),
			actions_taken=[],
		)

	# 4. Dispatch to sync handler in thread pool
	action = _ACTION_NAMES.get(intent, 'unknown')

	try:
		if intent == Intent.TAXPAYER_QUERY:
			data = await asyncio.to_thread(_handle_taxpayer, cuit)
			reply = format_taxpayer_response(data, cuit)
		elif intent == Intent.REPORTE_COMPLETO:
			data = await asyncio.to_thread(_handle_reporte, cuit)
			reply = format_reporte_response(data, cuit)
		else:
			data = None
			reply = 'Intento no soportado.'
	except Exception as exc:
		return ChatResponse(
			conversation_id=conversation_id,
			reply=f'Ocurrió un error al procesar la consulta: {exc}',
			actions_taken=[action],
		)

	return ChatResponse(
		conversation_id=conversation_id,
		reply=reply,
		actions_taken=[action],
		data=data if data else None,
	)


# ── PDF download ──────────────────────────────────────────────────────────


REPORTS_DIR = Path('/app/output')


@router.get(
	'/v1/chat/reports/{filename:path}',
	summary='Descargar PDF generado por el chat',
)
async def download_report(filename: str) -> FileResponse:
	"""Serve a generated PDF report for download.

	The file must exist inside the ``/app/output`` directory (Docker volume
	or ``storage/`` local path).
	"""
	# Try Docker path first, fall back to local storage
	full_path = (REPORTS_DIR / filename).resolve()
	if not str(full_path).startswith(str(REPORTS_DIR.resolve())):
		raise HTTPException(status_code=404, detail='Archivo no encontrado')
	if full_path.exists() and full_path.is_file():
		return FileResponse(full_path, media_type='application/pdf', filename=full_path.name)

	# Fallback: local storage/
	local_path = (Path('storage') / filename).resolve()
	if local_path.exists() and local_path.is_file():
		return FileResponse(local_path, media_type='application/pdf', filename=local_path.name)

	raise HTTPException(status_code=404, detail='Archivo no encontrado')
