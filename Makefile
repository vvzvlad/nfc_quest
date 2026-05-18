.PHONY: frontend install run test

# Build the React frontend and output to /static (served by Flask)
frontend:
	cd frontend && npm install && npm run build

# Install Python backend dependencies
install:
	pip install -r backend/requirements.txt

# Run the backend (serves API + built frontend from /static)
run:
	python run.py

# Run backend tests (requires .venv with dependencies installed)
# Usage: make test
#        make test ARGS="tests/test_admin.py::TestAdminTagRename -v"
test:
	cd backend && BASE_URL=http://localhost:5000 ADMIN_PASSWORD=testpass ../.venv/bin/pytest $(ARGS)
