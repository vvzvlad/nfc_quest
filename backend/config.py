import os

# Default DB path: data/quest.db relative to the project root (where run.py lives).
# In Docker, override DATABASE_URL=sqlite:////data/quest.db (absolute /data volume).
# run.py ensures the directory exists before starting the app.
_PROJECT_ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
_DEFAULT_DB = os.path.join(_PROJECT_ROOT, "data", "quest.db")


class Config:
    SECRET_KEY = os.getenv("SECRET_KEY", "dev-secret-key")
    ADMIN_PASSWORD = os.getenv("ADMIN_PASSWORD", "admin")
    BASE_URL = os.getenv("BASE_URL", "http://localhost:5000")
    SQLALCHEMY_DATABASE_URI = os.getenv("DATABASE_URL", f"sqlite:///{_DEFAULT_DB}")
    SQLALCHEMY_TRACK_MODIFICATIONS = False
    SESSION_TYPE = "filesystem"
    SESSION_PERMANENT = False
    QUEST_NAME = os.getenv("QUEST_NAME", "ПЕРИМЕТР")
