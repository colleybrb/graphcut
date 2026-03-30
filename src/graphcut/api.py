"""REST API endpoints for the GraphCut underlying FFmpeg and project state logic."""

import logging
from pathlib import Path
from typing import Any

from fastapi import APIRouter, Request, HTTPException, BackgroundTasks, WebSocket, WebSocketDisconnect
from fastapi.responses import FileResponse, JSONResponse
from pydantic import BaseModel

from graphcut.models import ProjectManifest, ClipRef, AudioMix, WebcamOverlay, CaptionStyle, ExportPreset
from graphcut.project_manager import ProjectManager
from graphcut.transcriber import Transcriber
from graphcut.exporter import Exporter

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api", tags=["GraphCut"])


# Background job task tracker
_JOBS: dict[str, dict[str, Any]] = {}
_WS_CLIENTS: list[WebSocket] = []

async def broadcast_progress(job_id: str, action: str, progress: float, speed: str = "0.0", eta: str = "--:--"):
    """Broadcast progress to all connected frontend clients."""
    msg = {
        "job_id": job_id,
        "action": action,
        "progress": progress,
        "speed": speed,
        "eta": eta
    }
    for client in _WS_CLIENTS.copy():
        try:
            await client.send_json(msg)
        except WebSocketDisconnect:
            _WS_CLIENTS.remove(client)


def get_manifest(request: Request) -> ProjectManifest:
    """Helper verifying active UI project context."""
    pdir = getattr(request.app.state, "project_dir", None)
    if not pdir or not pdir.exists():
        raise HTTPException(status_code=400, detail="No active project assigned during server boot.")
    try:
        return ProjectManager.load_project(pdir)
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

def save_manifest(manifest: ProjectManifest, request: Request):
    """Save changes explicitly out to YML disk bounds."""
    ProjectManager.save_project(manifest, request.app.state.project_dir)

# ----------------- #
#   Project Admin   #
# ----------------- #

@router.get("/project", response_model=ProjectManifest)
def get_project(request: Request):
    return get_manifest(request)


class OpenReq(BaseModel):
    path: str

@router.post("/project/open")
def open_project(req: OpenReq, request: Request):
    p = Path(req.path)
    if not p.exists() or not (p / "project.yaml").exists():
        raise HTTPException(status_code=404, detail="Invalid project directory.")
    request.app.state.project_dir = p
    return {"status": "ok", "project": get_manifest(request)}


# ----------------- #
#      Sources      #
# ----------------- #

@router.get("/sources")
def list_sources(request: Request):
    manifest = get_manifest(request)
    # Trigger thumbnails caching
    from graphcut.thumbnails import generate_thumbnails
    thumb_paths = generate_thumbnails(manifest, request.app.state.project_dir)
    
    res = {}
    for sid, info in manifest.sources.items():
        res[sid] = info.model_dump()
        res[sid]["thumbnail"] = f"/api/sources/{sid}/thumbnail" if sid in thumb_paths else None
    return res

@router.get("/sources/{source_id}/thumbnail")
def source_thumbnail(source_id: str, request: Request):
    manifest = get_manifest(request)
    if source_id not in manifest.sources:
        raise HTTPException(404, "Source not found")
        
    pdir = request.app.state.project_dir
    tf = pdir / ".cache" / "thumbnails" / f"{manifest.sources[source_id].file_hash}_{source_id}.jpg"
    if tf.exists():
        return FileResponse(tf, media_type="image/jpeg")
    raise HTTPException(404, "Thumbnail not found/generated.")


# ----------------- #
#       Clips       #
# ----------------- #

@router.get("/clips")
def get_clips(request: Request):
    manifest = get_manifest(request)
    return manifest.clip_order

@router.put("/clips/reorder")
def reorder_clips(indices: list[int], request: Request):
    manifest = get_manifest(request)
    new_order = [manifest.clip_order[i] for i in indices if i < len(manifest.clip_order)]
    manifest.clip_order = new_order
    save_manifest(manifest, request)
    return {"status": "success"}

class AddClipReq(BaseModel):
    source_id: str

@router.post("/clips/add")
def add_clip(req: AddClipReq, request: Request):
    manifest = get_manifest(request)
    if req.source_id not in manifest.sources:
        raise HTTPException(404, "Source not found")
    manifest.clip_order.append(ClipRef(source_id=req.source_id))
    save_manifest(manifest, request)
    return manifest.clip_order


# ----------------- #
#    Transcripts    #
# ----------------- #

@router.get("/transcript")
def get_transcript(request: Request):
    manifest = get_manifest(request)
    pdir = request.app.state.project_dir
    results = {}
    for sid, info in manifest.sources.items():
        tp = pdir / ".cache" / "transcripts" / f"{info.file_hash}_medium.json"
        if tp.exists():
            import json
            with tp.open() as f:
                results[sid] = json.load(f)
    return results

@router.post("/transcript/generate")
async def generate_transcript(request: Request, bg_tasks: BackgroundTasks):
    manifest = get_manifest(request)
    pdir = request.app.state.project_dir
    
    def transcribe_task():
        transcriber = Transcriber("medium")
        for sid, info in manifest.sources.items():
            if info.media_type in ("video", "audio"):
                try:
                    transcriber.transcribe(info.file_path, pdir)
                except Exception as e:
                    logger.error("Transcription failed for %s: %s", sid, e)

    bg_tasks.add_task(transcribe_task)
    return {"status": "ok", "message": "Transcription job started"}

@router.post("/transcript/cuts")
def apply_transcript_cuts(cuts: list[dict], request: Request):
    manifest = get_manifest(request)
    manifest.transcript_cuts = cuts
    save_manifest(manifest, request)
    return {"status": "ok"}


# ----------------- #
#       Audio       #
# ----------------- #

@router.get("/audio")
def get_audio(request: Request) -> AudioMix:
    return get_manifest(request).audio_mix

@router.put("/audio")
def update_audio(mix: AudioMix, request: Request):
    manifest = get_manifest(request)
    manifest.audio_mix = mix
    save_manifest(manifest, request)
    return {"status": "ok"}


# ----------------- #
#     Overlays      #
# ----------------- #

@router.get("/overlays")
def get_overlays(request: Request):
    m = get_manifest(request)
    return {"webcam": m.webcam, "caption_style": m.caption_style}

@router.put("/overlays/webcam")
def set_webcam(overlay: WebcamOverlay, request: Request):
    m = get_manifest(request)
    m.webcam = overlay
    save_manifest(m, request)
    return {"status": "ok"}

@router.delete("/overlays/webcam")
def delete_webcam(request: Request):
    m = get_manifest(request)
    m.webcam = None
    save_manifest(m, request)
    return {"status": "ok"}


# ----------------- #
#      Export       #
# ----------------- #

@router.get("/export/presets")
def list_presets(request: Request):
    return get_manifest(request).export_presets

class RenderReq(BaseModel):
    preset: str
    quality: str = "final"

@router.post("/export/render")
async def trigger_render(req: RenderReq, request: Request, bg_tasks: BackgroundTasks):
    manifest = get_manifest(request)
    pdir = request.app.state.project_dir
    exporter = Exporter()
    
    p = next((x for x in manifest.export_presets if x.name.lower() == req.preset.lower()), None)
    if not p:
        raise HTTPException(400, f"Preset {req.preset} not found.")

    p.quality = req.quality
    job_id = f"render_{p.name}_{p.quality}"
    
    async def render_task():
        try:
            def cb(pct: float, spd: str, rem: str):
                import asyncio
                asyncio.run(broadcast_progress(job_id, "render", pct, spd, rem))
                
            out = pdir / manifest.build_dir
            out.mkdir(parents=True, exist_ok=True)
            exporter.export(manifest, p, out, progress_callback=cb)
        except Exception as e:
            logger.error("Render job %s failed: %s", job_id, e)
            
    bg_tasks.add_task(render_task)
    return {"status": "started", "job_id": job_id}


@router.websocket("/ws/progress")
async def ws_progress(websocket: WebSocket):
    await websocket.accept()
    _WS_CLIENTS.append(websocket)
    try:
        while True:
            # Keep alive
            data = await websocket.receive_text()
    except WebSocketDisconnect:
        if websocket in _WS_CLIENTS:
            _WS_CLIENTS.remove(websocket)
