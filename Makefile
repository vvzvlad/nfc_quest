.PHONY: frontend install run

# Build the React frontend and output to /static (served by Flask)
frontend:
	cd frontend && npm install && npm run build

# Install Python backend dependencies
install:
	pip install -r backend/requirements.txt

# Run the backend (serves API + built frontend from /static)
run:
	python run.py
