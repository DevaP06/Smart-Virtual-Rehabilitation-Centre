# One container: React build served by the FastAPI app. Needs DATABASE_URL (Postgres) at runtime.
FROM node:22-slim AS web
WORKDIR /web
COPY web/package*.json ./
RUN npm ci
COPY web/ ./
RUN npm run build

FROM python:3.12-slim
WORKDIR /app
COPY requirements.txt requirements-engine.txt ./
RUN pip install --no-cache-dir -r requirements-engine.txt
COPY . .
COPY --from=web /web/dist ./web/dist
ENV PORT=8000
CMD ["sh", "-c", "uvicorn api.index:app --host 0.0.0.0 --port ${PORT}"]
