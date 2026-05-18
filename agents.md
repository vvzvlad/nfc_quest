# Agent Instructions — nfc_quest

## Project structure

- `backend/` — Flask API (Python), tests, models, blueprints
- `frontend/` — React SPA (Vite)
- `.venv/` — Python virtualenv at repo root (shared by all backend work)

## Setting up the environment

### Python (backend)

```bash
# Create virtualenv at repo root (one-time setup)
python3 -m venv .venv

# Install backend dependencies into the virtualenv
.venv/bin/pip install -r backend/requirements.txt

# Install test dependencies (pytest, etc.)
.venv/bin/pip install -r backend/requirements-test.txt
```

### Node.js (frontend)

```bash
# Install frontend dependencies
cd frontend && npm install
```

### Environment variables

Copy `.env.example` to `.env` and fill in the values:

```bash
cp .env.example .env
```

Required variables (see `.env.example` for full list):
- `ADMIN_PASSWORD` — password for the admin panel
- `BASE_URL` — base URL for the backend (e.g. `http://localhost:5000`)

## Environment

Python virtualenv is at `.venv/` (repo root). Always use `.venv/bin/pytest` (not system `python` or `python3`).

Required env vars for backend:
- `BASE_URL` — e.g. `http://localhost:5000`
- `ADMIN_PASSWORD` — e.g. `testpass` (used in tests)

## Running tests

Use the `make test` target (handles env vars and venv automatically):

```bash
# Run all backend tests
make test

# Run a specific test class or file
make test ARGS="tests/test_admin.py::TestAdminTagRename -v"

# Run a single test
make test ARGS="tests/test_admin.py::TestAdminTagRename::test_rename_tag_id_happy_path -v"
```

Equivalent manual command (run from repo root):
```bash
cd backend && BASE_URL=http://localhost:5000 ADMIN_PASSWORD=testpass ../.venv/bin/pytest [ARGS]
```

## Running the backend server

```bash
make run
# or directly:
python run.py
```

## Installing backend dependencies

```bash
make install
# or:
pip install -r backend/requirements.txt
```

## Building the frontend

```bash
make frontend
# or:
cd frontend && npm install && npm run build
```

## Test conventions

- Tests live in `backend/tests/`
- `conftest.py` provides `app`, `client`, `admin_client`, `ws_client` fixtures
- Helper functions (`start_game`, `create_tag`, `scan_tag`, `register_player`, `make_player_id`) are in `backend/tests/helpers.py`
- `rate_limiter.clear()` must be called before each scan in tests that need to bypass the rate limit
- Each test gets a fresh SQLite DB (via `tempfile.mkstemp`)
