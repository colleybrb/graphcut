"""FastAPI backend server bringing GraphCut endpoints natively into a local UI."""

import logging
from pathlib import Path
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles

logger = logging.getLogger(__name__)

def create_app(project_dir: Path | None = None) -> FastAPI:
    """Create and configure the FastAPI application."""
    app = FastAPI(title="GraphCut API", version="1.0.0")

    app.add_middleware(
        CORSMiddleware,
        allow_origins=["*"],
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )

    # Attach the active project directory to the app state so endpoints can access it 
    app.state.project_dir = project_dir

    from graphcut.api import router
    app.include_router(router)

    # Static UI hosting (Phase 7 frontend component)
    static_dir = Path(__file__).parent / "static"
    static_dir.mkdir(parents=True, exist_ok=True)
    app.mount("/", StaticFiles(directory=static_dir, html=True), name="static")

    return app
