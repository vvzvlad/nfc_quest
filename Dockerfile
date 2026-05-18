# Stage 1: build the React frontend
FROM node:20-slim AS frontend-builder
WORKDIR /frontend
COPY frontend/package*.json ./
RUN npm ci
COPY frontend/ ./
# Build outputs to ../static relative to frontend/ → /static in container
RUN npm run build && mv /static /app-static

# Stage 2: Python backend
FROM python:3.12-slim
WORKDIR /app

COPY backend/requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Copy backend source
COPY backend/ ./backend/
COPY run.py .

# Copy built frontend assets (Flask serves them from /app/static)
COPY --from=frontend-builder /app-static ./static

# Persistent data directory (mount a volume here in production)
RUN mkdir -p /app/data

EXPOSE 5000

# Use eventlet worker for WebSocket support via gunicorn
CMD ["python", "-m", "gunicorn", "--worker-class", "eventlet", "-w", "1", "--bind", "0.0.0.0:5000", "run:application"]
