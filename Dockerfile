FROM python:3.11-slim
WORKDIR /app

RUN pip install --no-cache-dir uv
COPY pyproject.toml uv.lock ./
RUN uv sync --no-dev --frozen
COPY fiscal_agent/ fiscal_agent/
RUN mkdir -p /app/output

ENV PYTHONPATH=/app
CMD ["python", "-m", "fiscal_agent"]
