import os
import sys

# Ensure backend root is on Python sys.path
backend_dir = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "backend"))
if backend_dir not in sys.path:
    sys.path.insert(0, backend_dir)

# On serverless (Vercel), only /tmp is writable
os.environ.setdefault("UPLOAD_DIR", "/tmp/uploads")
os.makedirs("/tmp/uploads/reports", exist_ok=True)

from app.main import app

# Expose app for Vercel Python serverless runtime
app = app
