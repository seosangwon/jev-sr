FROM node:20-bookworm-slim AS frontend-build
WORKDIR /app/frontend
COPY frontend/package.json frontend/package-lock.json ./
RUN npm ci
COPY frontend/ ./
COPY samples/ /app/samples/
RUN npm run build

FROM python:3.12-slim
WORKDIR /app
RUN pip install --no-cache-dir uv==0.9.9
COPY pyproject.toml uv.lock ./
RUN uv sync --locked --no-dev
COPY backend/ ./backend/
COPY samples/ ./samples/
COPY --from=frontend-build /app/frontend/dist/ ./frontend/dist/
ENV DEPLOY_MODE=1 PYTHONUNBUFFERED=1
CMD ["sh", "-c", "exec .venv/bin/uvicorn backend.app.main:app --host 0.0.0.0 --port ${PORT:-10000}"]
