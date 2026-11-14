"""
BELIMO | Collia - Application Server
Stage 1: FastAPI Server and UI Integration
"""

from pathlib import Path
from fastapi import FastAPI, Request
from fastapi.responses import HTMLResponse
from fastapi.staticfiles import StaticFiles
from fastapi.templating import Jinja2Templates

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

# Mount static directory if it exists
if STATIC_DIR.exists():
    app.mount("/static", StaticFiles(directory=str(STATIC_DIR)), name="static")

# Templates
templates = Jinja2Templates(directory=str(TEMPLATES_DIR))


@app.get("/", response_class=HTMLResponse)
async def read_root(request: Request):
    """Serve the primary Collia web interface."""
    return templates.TemplateResponse(
        request=request,
        name="index.html",
        context={"facility_name": "Campus North — Building 04"}
    )


@app.get("/api/health")
async def health_check():
    """Health status endpoint."""
    return {
        "status": "healthy",
        "service": "BELIMO | Collia",
        "stage": "Stage 1 — Project Setup and UI Implementation",
        "csv_dir": str(DATA_DIR / "csv"),
        "config_dir": str(DATA_DIR / "configuration")
    }


if __name__ == "__main__":
    import uvicorn
    uvicorn.run("backend.app.main:app", host="127.0.0.1", port=8000, reload=True)
