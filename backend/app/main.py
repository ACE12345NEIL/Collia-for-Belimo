"""
BELIMO | Collia - Application Server
Stage 1: FastAPI Server and UI Integration
"""

from pathlib import Path
from fastapi import FastAPI, Request
from fastapi.responses import HTMLResponse, JSONResponse
from fastapi.staticfiles import StaticFiles
from fastapi.templating import Jinja2Templates

from backend.app.api.configuration_router import router as configuration_router
from backend.app.api.csv_router import router as csv_router

# Calculate base paths
BASE_DIR = Path(__file__).resolve().parent.parent.parent
FRONTEND_DIR = BASE_DIR / "frontend"
TEMPLATES_DIR = FRONTEND_DIR / "templates"
STATIC_DIR = FRONTEND_DIR / "static"
DATA_DIR = BASE_DIR / "data"

app = FastAPI(
    title="BELIMO | Collia",
    description="BMS Configuration, Data Integration and Knowledge Graph Platform",
    version="0.1.0"
)

# Security middleware: reject path traversal in CSV file routes early with 422
@app.middleware("http")
async def security_path_traversal_middleware(request: Request, call_next):
    raw_path = request.scope.get("raw_path", b"").decode("latin-1", errors="ignore")
    req_path = request.url.path
    if "/api/csv/files/" in req_path or "/api/csv/files/" in raw_path:
        if ".." in req_path or ".." in raw_path:
            return JSONResponse(status_code=422, content={"detail": "Path traversal rejected"})
    return await call_next(request)

# Mount static directory if it exists
if STATIC_DIR.exists():
    app.mount("/static", StaticFiles(directory=str(STATIC_DIR)), name="static")

# Templates
templates = Jinja2Templates(directory=str(TEMPLATES_DIR))

# Include API Routers
app.include_router(configuration_router)
app.include_router(csv_router)


@app.get("/", response_class=HTMLResponse)
async def read_root(request: Request):
    """Serve the primary Collia web interface."""
    resp = templates.TemplateResponse(
        request=request,
        name="index.html",
        context={"facility_name": "BELIMO CESIM House, Mumbai"}
    )
    resp.headers["Cache-Control"] = "no-cache, no-store, must-revalidate"
    return resp


@app.get("/api/health")
async def health_check():
    """Health status endpoint."""
    return {
        "status": "healthy",
        "service": "BELIMO | Collia",
        "stage": "Stage 4 — CSV Folder Integration",
        "csv_dir": str(DATA_DIR / "csv"),
        "config_dir": str(DATA_DIR / "configuration")
    }


if __name__ == "__main__":
    import uvicorn
    uvicorn.run("backend.app.main:app", host="127.0.0.1", port=8000, reload=True)
