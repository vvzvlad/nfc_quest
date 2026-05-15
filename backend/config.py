import os


class Config:
    SECRET_KEY = os.getenv("SECRET_KEY", "dev-secret-key")
    ADMIN_PASSWORD = os.getenv("ADMIN_PASSWORD", "admin")
    BASE_URL = os.getenv("BASE_URL", "http://localhost:5000")
    SQLALCHEMY_DATABASE_URI = os.getenv("DATABASE_URL", "sqlite:///data/quest.db")
    SQLALCHEMY_TRACK_MODIFICATIONS = False
    SESSION_TYPE = "filesystem"
    SESSION_PERMANENT = False
