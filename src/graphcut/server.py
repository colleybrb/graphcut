"""FastAPI backend server bringing GraphCut endpoints natively into a local UI."""

import logging
import re
from pathlib import Path
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles

logger = logging.getLogger(__name__)
LOOPBACK_ORIGIN_PATTERN = re.compile(r"^https?://(localhost|127\.0\.0\.1|\[::1\])(?::\d+)?$")

def create_app(project_dir: Path | None = None) -> FastAPI:
    """Create and configure the FastAPI application."""
    app = FastAPI(title="GraphCut API", version="1.0.0")
    app.state.allowed_origin_pattern = LOOPBACK_ORIGIN_PATTERN

    app.add_middleware(
        CORSMiddleware,
        allow_origin_regex=LOOPBACK_ORIGIN_PATTERN.pattern,
        allow_credentials=False,
        allow_methods=["*"],
        allow_headers=["*"],
    )

    # Attach the active project directory to the app state so endpoints can access it 
    app.state.project_dir = project_dir

    from fastapi import Request
    from fastapi.responses import JSONResponse
    from graphcut.ffmpeg_executor import FFmpegError

    @app.exception_handler(FFmpegError)
    async def ffmpeg_exception_handler(request: Request, exc: FFmpegError):
        """Catch underlying FFmpeg binary errors gracefully for the UI."""
        logger.error(f"FFmpeg Execution Error: {exc}")
        return JSONResponse(
            status_code=500,
            content={"detail": str(exc)},
        )

    from graphcut.api import router
    app.include_router(router)

    # Static UI hosting (Phase 7 frontend component)
    static_dir = Path(__file__).parent / "static"
    static_dir.mkdir(parents=True, exist_ok=True)
    app.mount("/", StaticFiles(directory=static_dir, html=True), name="static")

    return app
