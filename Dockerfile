FROM python:3.11-slim
WORKDIR /app

RUN pip install --no-cache-dir uv
COPY pyproject.toml uv.lock ./
RUN uv sync --no-dev --frozen
COPY fiscal_agent/ fiscal_agent/
RUN mkdir -p /app/output

ENV PYTHONPATH=/app
ENV VIRTUAL_ENV=/app/.venv
ENV PATH="/app/.venv/bin:$PATH"
CMD ["uvicorn", "fiscal_agent.api.server:app", "--host", "0.0.0.0", "--port", "8000"]
