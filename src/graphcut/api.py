"""REST API endpoints for the GraphCut underlying FFmpeg and project state logic."""

import ipaddress
import mimetypes
import logging
import re
import socket
import shutil
import traceback
import uuid
from datetime import datetime, timezone
from pathlib import Path
from threading import Lock
from typing import Any
from urllib.error import HTTPError, URLError
from urllib.parse import unquote, urlparse
from urllib.request import HTTPRedirectHandler, Request as UrlRequest, build_opener

import anyio
from fastapi import APIRouter, Request, HTTPException, BackgroundTasks, WebSocket, WebSocketDisconnect
from fastapi.responses import FileResponse, JSONResponse
from fastapi import UploadFile, File
from pydantic import BaseModel

from graphcut.models import (
    ProjectManifest,
    ClipRef,
    AudioMix,
    WebcamOverlay,
    StickerOverlay,
    CaptionStyle,
    ExportPreset,
    SceneConfig,
)
from graphcut.ffmpeg_executor import FFmpegError
from graphcut.project_manager import ProjectManager
from graphcut.transcriber import Transcriber
from graphcut.exporter import Exporter
from graphcut.generation_queue import list_provider_names
from graphcut.platforms import list_platform_profiles, list_workflow_recipes

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api", tags=["GraphCut"])
REMOTE_IMPORT_MAX_BYTES = 250 * 1024 * 1024
REMOTE_IMPORT_ALLOWED_TYPES = ("video/", "audio/", "image/")
REMOTE_IMPORT_ALLOWED_SUFFIXES = {
    ".mp4", ".mov", ".m4v", ".webm", ".mkv",
    ".mp3", ".wav", ".aac", ".m4a", ".ogg",
    ".gif", ".png", ".jpg", ".jpeg", ".webp",
}


# Background job task tracker
_JOBS: dict[str, dict[str, Any]] = {}
_JOBS_LOCK = Lock()
_WS_CLIENTS: list[WebSocket] = []
_REMOTE_IMPORT_BLOCKED_HOSTS = {"localhost", "localhost.localdomain"}
_REMOTE_IMPORT_REDIRECT_CODES = {301, 302, 303, 307, 308}

def _utcnow_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def _job_update(job_id: str, **fields: Any) -> None:
    with _JOBS_LOCK:
        job = _JOBS.get(job_id)
        if job is None:
            job = {"job_id": job_id, "created_at": _utcnow_iso()}
            _JOBS[job_id] = job
        job.update(fields)
        job["updated_at"] = _utcnow_iso()


async def broadcast_progress(
    job_id: str,
    action: str,
    progress: float,
    speed: str = "0.0",
    eta: str = "--:--",
    detail: str | None = None,
):
    """Broadcast progress to all connected frontend clients."""
    msg = {
        "job_id": job_id,
        "action": action,
        "progress": progress,
        "speed": speed,
        "eta": eta
    }
    if detail:
        msg["detail"] = detail
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


def _sanitize_media_filename(raw_name: str, fallback_stem: str = "imported_media") -> str:
    candidate = unquote(Path(raw_name or "").name).strip()
    stem = Path(candidate).stem or fallback_stem
    suffix = re.sub(r"[^A-Za-z0-9.]+", "", Path(candidate).suffix)[:12]
    stem = re.sub(r"[^A-Za-z0-9._-]+", "_", stem).strip("._") or fallback_stem
    safe_name = f"{stem}{suffix}"
    return safe_name[:160]


def _unique_media_path(directory: Path, filename: str) -> Path:
    base = Path(filename)
    stem = base.stem or "imported_media"
    suffix = base.suffix
    candidate = directory / filename
    counter = 1
    while candidate.exists():
        candidate = directory / f"{stem}_{counter}{suffix}"
        counter += 1
    return candidate


def _build_remote_filename(raw_name: str, content_type: str, url: str) -> str:
    parsed_path = Path(urlparse(url).path)
    guessed_suffix = Path(raw_name).suffix or parsed_path.suffix or mimetypes.guess_extension(content_type) or ".bin"
    safe_name = _sanitize_media_filename(raw_name or parsed_path.name or "imported_media")
    if Path(safe_name).suffix:
        return safe_name
    return f"{safe_name}{guessed_suffix}"


def _resolve_within(root: Path, user_path: str, error_detail: str) -> Path:
    root_resolved = root.resolve()
    candidate = (root_resolved / user_path).resolve()
    if not candidate.is_relative_to(root_resolved):
        raise HTTPException(403, error_detail)
    return candidate


def _iter_host_ips(hostname: str, port: int) -> list[ipaddress.IPv4Address | ipaddress.IPv6Address]:
    try:
        return [ipaddress.ip_address(hostname)]
    except ValueError:
        pass

    try:
        infos = socket.getaddrinfo(hostname, port, type=socket.SOCK_STREAM)
    except socket.gaierror as exc:
        raise HTTPException(400, f"Could not resolve remote host: {hostname}") from exc

    ips: list[ipaddress.IPv4Address | ipaddress.IPv6Address] = []
    seen: set[str] = set()
    for info in infos:
        sockaddr = info[4]
        if not sockaddr:
            continue
        address_text = sockaddr[0]
        if address_text in seen:
            continue
        seen.add(address_text)
        ips.append(ipaddress.ip_address(address_text))
    return ips


def _validate_remote_import_url(url: str) -> None:
    parsed = urlparse(url)
    if parsed.scheme not in ("http", "https"):
        raise HTTPException(400, "Paste a direct http(s) media URL.")
    if parsed.username or parsed.password:
        raise HTTPException(400, "Credentials in remote media URLs are not supported.")

    hostname = (parsed.hostname or "").strip().lower().rstrip(".")
    if not hostname:
        raise HTTPException(400, "Remote media URL is missing a host.")
    if hostname in _REMOTE_IMPORT_BLOCKED_HOSTS:
        raise HTTPException(403, "Remote imports from localhost are blocked.")

    port = parsed.port or (443 if parsed.scheme == "https" else 80)
    for addr in _iter_host_ips(hostname, port):
        if (
            addr.is_private
            or addr.is_loopback
            or addr.is_link_local
            or addr.is_multicast
            or addr.is_reserved
            or addr.is_unspecified
        ):
            raise HTTPException(403, "Remote imports must point to a public host.")


def _origin_allowed(app: Any, origin: str | None) -> bool:
    if not origin:
        return True
    pattern = getattr(getattr(app, "state", None), "allowed_origin_pattern", None)
    if pattern is None:
        return False
    return bool(pattern.match(origin))


class _NoRedirectHandler(HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        return None


def _validate_sticker_overlay(overlay: StickerOverlay, manifest: ProjectManifest) -> StickerOverlay:
    if overlay.start_time < 0:
        raise HTTPException(400, "Sticker start_time must be >= 0.")
    if overlay.end_time is not None and overlay.end_time <= overlay.start_time:
        raise HTTPException(400, "Sticker end_time must be greater than start_time.")
    if overlay.scale <= 0:
        raise HTTPException(400, "Sticker scale must be greater than 0.")
    if overlay.opacity <= 0 or overlay.opacity > 1:
        raise HTTPException(400, "Sticker opacity must be between 0 and 1.")

    if overlay.mode == "emoji":
        if not (overlay.text or "").strip():
            raise HTTPException(400, "Enter an emoji or short text for the sticker overlay.")
        return overlay

    if not overlay.source_id:
        raise HTTPException(400, "Choose a source asset for the sticker overlay.")
    if overlay.source_id not in manifest.sources:
        raise HTTPException(404, "Sticker source not found.")
    info = manifest.sources[overlay.source_id]
    if info.media_type not in ("video", "image"):
        raise HTTPException(400, "Sticker source must be a video, GIF, or image asset.")
    return overlay

# ----------------- #
#   Project Admin   #
# ----------------- #

@router.get("/project", response_model=ProjectManifest)
def get_project(request: Request):
    return get_manifest(request)


@router.get("/pipeline/capabilities")
def get_pipeline_capabilities():
    return {
        "providers": list_provider_names(),
        "platforms": [platform.to_dict() for platform in list_platform_profiles()],
        "recipes": [recipe.to_dict() for recipe in list_workflow_recipes()],
        "workflows": ["storyboard", "generate", "queue", "package", "viralize", "creator-brief"],
        "features": {
            "source_files": {"label": "Source Files", "status": "gui", "area": "ingest"},
            "scene_detection": {"label": "Scene Detection", "status": "cli", "area": "ingest", "command": "graphcut detect-scenes <project_dir>"},
            "transcription": {"label": "Transcription", "status": "gui", "area": "ingest"},
            "timeline_builder": {"label": "Timeline Builder", "status": "gui", "area": "compose"},
            "audio_normalization": {"label": "Audio Normalization", "status": "gui", "area": "compose"},
            "caption_overlay": {"label": "Caption Overlay", "status": "gui", "area": "compose"},
            "transitions": {"label": "Transitions", "status": "gui", "area": "compose"},
            "platform_presets": {"label": "Platform Presets", "status": "gui", "area": "deliver"},
            "ffmpeg_render": {"label": "FFmpeg Render", "status": "gui", "area": "deliver"},
            "multi_format_export": {"label": "Multi-format Export", "status": "gui", "area": "deliver"},
            "generation_queue": {"label": "Generation Queue", "status": "cli", "area": "agent"},
            "provider_adapters": {"label": "Provider Adapters", "status": "integration", "area": "agent"},
            "agent_templates": {"label": "Agent JSON Templates", "status": "cli", "area": "agent"},
            "creator_brief": {"label": "Creator Brief", "status": "cli", "area": "agent"},
            "preview_surface": {"label": "Preview Surface", "status": "gui", "area": "interface"},
            "node_inspector": {"label": "Node Inspector", "status": "gui", "area": "interface"},
        },
    }


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

@router.post("/sources/upload")
async def upload_source(request: Request, file: UploadFile = File(...)):
    manifest = get_manifest(request)
    pdir = request.app.state.project_dir
    media_dir = pdir / "media"
    media_dir.mkdir(parents=True, exist_ok=True)

    safe_name = _sanitize_media_filename(file.filename or "uploaded_media.mp4", fallback_stem="uploaded_media")
    dest_path = _unique_media_path(media_dir, safe_name)

    with dest_path.open("wb") as buffer:
        shutil.copyfileobj(file.file, buffer)

    try:
        source_id = ProjectManager.add_source(manifest, dest_path)
    except Exception as exc:
        dest_path.unlink(missing_ok=True)
        raise HTTPException(400, f"Uploaded file could not be added as media: {exc}") from exc

    save_manifest(manifest, request)
    return {"status": "ok", "filename": dest_path.name, "source_id": source_id}


class ImportSourceUrlReq(BaseModel):
    url: str
    source_id: str | None = None


@router.post("/sources/import-url")
def import_source_url(req: ImportSourceUrlReq, request: Request):
    manifest = get_manifest(request)
    pdir = request.app.state.project_dir
    media_dir = pdir / "media"
    media_dir.mkdir(parents=True, exist_ok=True)

    url = (req.url or "").strip()
    _validate_remote_import_url(url)
    parsed = urlparse(url)

    source_hint = (req.source_id or "").strip() or None
    dest_path: Path | None = None

    try:
        remote_req = UrlRequest(url, headers={"User-Agent": "GraphCut/1.0"})
        opener = build_opener(_NoRedirectHandler())
        with opener.open(remote_req, timeout=20) as response:
            content_type = (response.headers.get_content_type() or "application/octet-stream").lower()
            looks_like_media = (
                any(parsed.path.lower().endswith(suffix) for suffix in REMOTE_IMPORT_ALLOWED_SUFFIXES)
                or content_type.startswith(REMOTE_IMPORT_ALLOWED_TYPES)
                or content_type == "application/octet-stream"
            )
            if not looks_like_media or content_type == "text/html":
                raise HTTPException(
                    400,
                    "That URL does not look like a direct media file. Paste a direct GIF, image, audio, or video asset URL.",
                )

            safe_name = _build_remote_filename(
                response.headers.get_filename() or Path(parsed.path).name or f"imported_{uuid.uuid4().hex[:8]}",
                content_type,
                url,
            )
            dest_path = _unique_media_path(media_dir, safe_name)

            bytes_written = 0
            with dest_path.open("wb") as handle:
                while True:
                    chunk = response.read(1024 * 1024)
                    if not chunk:
                        break
                    bytes_written += len(chunk)
                    if bytes_written > REMOTE_IMPORT_MAX_BYTES:
                        raise HTTPException(413, "Remote media is too large. Keep imports under 250 MB.")
                    handle.write(chunk)
    except HTTPException:
        if dest_path:
            dest_path.unlink(missing_ok=True)
        raise
    except HTTPError as exc:
        if dest_path:
            dest_path.unlink(missing_ok=True)
        if exc.code in _REMOTE_IMPORT_REDIRECT_CODES:
            raise HTTPException(400, "Redirecting media URLs are blocked. Paste the final direct asset URL.") from exc
        raise HTTPException(502, f"Remote server returned {exc.code} while downloading media.") from exc
    except URLError as exc:
        if dest_path:
            dest_path.unlink(missing_ok=True)
        raise HTTPException(502, f"Could not reach the remote media URL: {exc.reason}") from exc
    except Exception as exc:
        if dest_path:
            dest_path.unlink(missing_ok=True)
        raise HTTPException(500, f"Failed to import remote media: {exc}") from exc

    try:
        source_id = ProjectManager.add_source(manifest, dest_path, source_id=source_hint)
    except Exception as exc:
        dest_path.unlink(missing_ok=True)
        raise HTTPException(400, f"Downloaded file could not be added as media: {exc}") from exc

    save_manifest(manifest, request)
    return {
        "status": "ok",
        "filename": dest_path.name,
        "source_id": source_id,
        "media_type": manifest.sources[source_id].media_type,
    }

@router.delete("/sources/{source_id}")
def delete_source(source_id: str, request: Request, delete_file: bool = False):
    manifest = get_manifest(request)
    try:
        file_deleted = ProjectManager.remove_source(
            manifest,
            source_id,
            delete_file=delete_file,
            project_dir=request.app.state.project_dir,
        )
        save_manifest(manifest, request)
        return {"status": "ok", "file_deleted": file_deleted}
    except ValueError as e:
        raise HTTPException(status_code=404, detail=str(e))


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


@router.get("/sources/{source_id}/media")
def source_media(source_id: str, request: Request):
    manifest = get_manifest(request)
    if source_id not in manifest.sources:
        raise HTTPException(404, "Source not found")

    pdir = request.app.state.project_dir.resolve()
    path = manifest.sources[source_id].file_path.resolve()
    if not path.exists():
        raise HTTPException(404, "Media file not found")
    if not path.is_relative_to(pdir):
        raise HTTPException(403, "Media file is outside the active project directory")

    mt = mimetypes.guess_type(path.name)[0] or "application/octet-stream"

    return FileResponse(path, media_type=mt, filename=path.name)


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
    if len(indices) != len(manifest.clip_order):
        raise HTTPException(400, "Reorder list length must match current clip count.")
    if any((i < 0 or i >= len(manifest.clip_order)) for i in indices):
        raise HTTPException(400, "Invalid clip index in reorder list.")
    if len(set(indices)) != len(indices):
        raise HTTPException(400, "Reorder list cannot contain duplicates.")
    new_order = [manifest.clip_order[i] for i in indices]
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


class InsertClipReq(BaseModel):
    source_id: str
    trim_start: float | None = None
    trim_end: float | None = None
    position: int | None = None


@router.post("/clips/insert")
def insert_clip(req: InsertClipReq, request: Request):
    manifest = get_manifest(request)
    if req.source_id not in manifest.sources:
        raise HTTPException(404, "Source not found")
    if req.trim_start is not None and req.trim_start < 0:
        raise HTTPException(400, "trim_start must be >= 0")
    if req.trim_end is not None and req.trim_end < 0:
        raise HTTPException(400, "trim_end must be >= 0")
    if req.trim_start is not None and req.trim_end is not None and req.trim_end <= req.trim_start:
        raise HTTPException(400, "trim_end must be greater than trim_start")

    clip = ClipRef(
        source_id=req.source_id,
        trim_start=req.trim_start,
        trim_end=req.trim_end,
    )
    pos = req.position if req.position is not None else len(manifest.clip_order)
    pos = max(0, min(len(manifest.clip_order), int(pos)))
    manifest.clip_order.insert(pos, clip)
    save_manifest(manifest, request)
    return {"status": "ok", "clips": manifest.clip_order}


class DuplicateClipReq(BaseModel):
    index: int
    position: int | None = None


@router.post("/clips/duplicate")
def duplicate_clip(req: DuplicateClipReq, request: Request):
    manifest = get_manifest(request)
    if req.index < 0 or req.index >= len(manifest.clip_order):
        raise HTTPException(404, "Clip not found")

    original = manifest.clip_order[req.index]
    clip = ClipRef(**original.model_dump())
    pos = req.position if req.position is not None else (req.index + 1)
    pos = max(0, min(len(manifest.clip_order), int(pos)))
    manifest.clip_order.insert(pos, clip)
    save_manifest(manifest, request)
    return {"status": "ok", "clips": manifest.clip_order}


class SplitClipReq(BaseModel):
    index: int
    time: float


@router.post("/clips/split")
def split_clip(req: SplitClipReq, request: Request):
    manifest = get_manifest(request)
    if req.index < 0 or req.index >= len(manifest.clip_order):
        raise HTTPException(404, "Clip not found")

    clip = manifest.clip_order[req.index]
    info = manifest.sources.get(clip.source_id)
    if not info:
        raise HTTPException(400, "Missing source info for clip")

    t0 = clip.trim_start if clip.trim_start is not None else 0.0
    t1 = clip.trim_end if clip.trim_end is not None else info.duration_seconds
    t = float(req.time)
    if t <= t0 or t >= t1:
        raise HTTPException(400, "Split time must be within the clip trim range")

    left = ClipRef(**clip.model_dump())
    right = ClipRef(**clip.model_dump())
    left.trim_end = t
    right.trim_start = t
    right.trim_end = t1 if clip.trim_end is not None else None

    manifest.clip_order[req.index] = left
    manifest.clip_order.insert(req.index + 1, right)
    save_manifest(manifest, request)
    return {"status": "ok", "clips": manifest.clip_order}


class MoveClipReq(BaseModel):
    from_index: int
    to_index: int


@router.post("/clips/move")
def move_clip(req: MoveClipReq, request: Request):
    manifest = get_manifest(request)
    n = len(manifest.clip_order)
    if req.from_index < 0 or req.from_index >= n:
        raise HTTPException(404, "Clip not found")
    if req.to_index < 0 or req.to_index >= n:
        raise HTTPException(400, "Invalid destination index")

    clip = manifest.clip_order.pop(req.from_index)
    manifest.clip_order.insert(req.to_index, clip)
    save_manifest(manifest, request)
    return {"status": "ok", "clips": manifest.clip_order}


class UpdateClipReq(BaseModel):
    trim_start: float | None = None
    trim_end: float | None = None
    transition: str | None = None
    transition_duration: float | None = None


@router.put("/clips/{index}")
def update_clip(index: int, req: UpdateClipReq, request: Request):
    manifest = get_manifest(request)
    if index < 0 or index >= len(manifest.clip_order):
        raise HTTPException(404, "Clip not found")

    clip = manifest.clip_order[index]
    provided_fields = getattr(req, "model_fields_set", set())
    if "trim_start" in provided_fields:
        clip.trim_start = max(0.0, float(req.trim_start)) if req.trim_start is not None else None

    if "trim_end" in provided_fields:
        clip.trim_end = max(0.0, float(req.trim_end)) if req.trim_end is not None else None

    if clip.trim_start is not None and clip.trim_end is not None and clip.trim_end <= clip.trim_start:
        raise HTTPException(400, "trim_end must be greater than trim_start")

    if req.transition is not None:
        # ClipRef model will validate at save time; keep basic sanity here.
        clip.transition = req.transition  # type: ignore[assignment]
    if req.transition_duration is not None:
        clip.transition_duration = max(0.0, float(req.transition_duration))

    manifest.clip_order[index] = clip
    save_manifest(manifest, request)
    return {"status": "ok", "clip": clip}


@router.delete("/clips/{index}")
def delete_clip(index: int, request: Request):
    manifest = get_manifest(request)
    if index < 0 or index >= len(manifest.clip_order):
        raise HTTPException(404, "Clip not found")
    manifest.clip_order.pop(index)
    save_manifest(manifest, request)
    return {"status": "ok", "clips": manifest.clip_order}


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
    return {"webcam": m.webcam, "sticker": m.sticker, "caption_style": m.caption_style}

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


@router.put("/overlays/sticker")
def set_sticker(overlay: StickerOverlay, request: Request):
    m = get_manifest(request)
    m.sticker = _validate_sticker_overlay(overlay, m)
    save_manifest(m, request)
    return {"status": "ok"}


@router.delete("/overlays/sticker")
def delete_sticker(request: Request):
    m = get_manifest(request)
    m.sticker = None
    save_manifest(m, request)
    return {"status": "ok"}


@router.put("/overlays/caption_style")
def set_caption_style(style: CaptionStyle, request: Request):
    m = get_manifest(request)
    m.caption_style = style
    save_manifest(m, request)
    return {"status": "ok"}


class RolesReq(BaseModel):
    narration: str | None = None
    music: str | None = None


@router.put("/project/roles")
def set_roles(req: RolesReq, request: Request):
    m = get_manifest(request)
    m.narration = req.narration
    m.music = req.music
    save_manifest(m, request)
    return {"status": "ok"}


class SceneNameReq(BaseModel):
    name: str


@router.get("/scenes")
def get_scenes(request: Request):
    m = get_manifest(request)
    return {"active_scene": m.active_scene, "scenes": m.scenes}


@router.post("/scenes/save")
def save_scene(req: SceneNameReq, request: Request):
    m = get_manifest(request)
    name = req.name.strip()
    if not name:
        raise HTTPException(400, "Scene name cannot be empty")

    m.scenes[name] = SceneConfig(
        webcam=m.webcam,
        sticker=m.sticker,
        audio_mix=m.audio_mix,
        caption_style=m.caption_style,
        narration=m.narration,
        music=m.music,
    )
    if m.active_scene is None:
        m.active_scene = name
    save_manifest(m, request)
    return {"status": "ok", "active_scene": m.active_scene, "scenes": m.scenes}


@router.post("/scenes/activate")
def activate_scene(req: SceneNameReq, request: Request):
    m = get_manifest(request)
    name = req.name.strip()
    if name not in m.scenes:
        raise HTTPException(404, "Scene not found")

    sc = m.scenes[name]
    m.active_scene = name
    m.webcam = sc.webcam
    m.sticker = sc.sticker
    m.audio_mix = sc.audio_mix
    m.caption_style = sc.caption_style
    m.narration = sc.narration
    m.music = sc.music

    save_manifest(m, request)
    return {"status": "ok", "active_scene": m.active_scene}


@router.delete("/scenes/{scene_name}")
def delete_scene(scene_name: str, request: Request):
    m = get_manifest(request)
    if scene_name not in m.scenes:
        raise HTTPException(404, "Scene not found")
    del m.scenes[scene_name]
    if m.active_scene == scene_name:
        m.active_scene = None
    save_manifest(m, request)
    return {"status": "ok", "active_scene": m.active_scene, "scenes": m.scenes}


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
    if not manifest.clip_order:
        raise HTTPException(400, "No clips in timeline. Add at least one source to the timeline first.")
    
    p = next((x for x in manifest.export_presets if x.name.lower() == req.preset.lower()), None)
    if not p:
        raise HTTPException(400, f"Preset {req.preset} not found.")

    p.quality = req.quality
    job_id = f"render_{p.name}_{p.quality}_{uuid.uuid4().hex[:8]}"
    out_filename = exporter.build_output_filename(manifest, p)
    out = pdir / manifest.build_dir
    out.mkdir(parents=True, exist_ok=True)

    _job_update(
        job_id,
        type="render",
        status="queued",
        project_name=manifest.name,
        preset=p.name,
        quality=p.quality,
        output_filename=out_filename,
        output_dir=str(out),
    )
    
    def render_task():
        try:
            _job_update(job_id, status="running", started_at=_utcnow_iso(), last_progress=0.0)

            def cb(pct: float, spd: str, rem: str):
                _job_update(job_id, last_progress=pct, speed=spd, eta=rem)
                anyio.from_thread.run(broadcast_progress, job_id, "render", pct, spd, rem)
                
            exporter.export(manifest, p, out, progress_callback=cb, project_dir=pdir)
            anyio.from_thread.run(broadcast_progress, job_id, "render", 100.0, "0.0", "00:00")
            _job_update(job_id, status="succeeded", finished_at=_utcnow_iso(), last_progress=100.0)
        except Exception as e:
            logger.exception("Render job %s failed", job_id)

            err_detail = str(e)
            fields: dict[str, Any] = {
                "status": "failed",
                "finished_at": _utcnow_iso(),
                "error": err_detail,
                "traceback": traceback.format_exc(),
                "last_progress": 100.0,
            }

            if isinstance(e, FFmpegError):
                fields["ffmpeg_returncode"] = e.returncode
                fields["ffmpeg_cmd"] = " ".join(e.cmd) if e.cmd else None
                fields["ffmpeg_stderr_tail"] = (e.stderr or "")[-8000:]

            _job_update(job_id, **fields)
            anyio.from_thread.run(
                broadcast_progress,
                job_id,
                "render failed",
                100.0,
                "0.0",
                "--:--",
                detail=err_detail,
            )
            
    bg_tasks.add_task(render_task)
    return {"status": "started", "job_id": job_id, "filename": out_filename}

@router.get("/jobs")
def list_jobs(limit: int = 20):
    with _JOBS_LOCK:
        jobs = list(_JOBS.values())
    jobs.sort(key=lambda j: j.get("created_at", ""), reverse=True)
    return jobs[: max(1, min(limit, 200))]


@router.get("/jobs/{job_id}")
def get_job(job_id: str):
    with _JOBS_LOCK:
        job = _JOBS.get(job_id)
    if not job:
        raise HTTPException(404, "Job not found")
    return job

@router.get("/export/download/{filename}")
def download_export(filename: str, request: Request):
    pdir = request.app.state.project_dir
    manifest = get_manifest(request)
    build_dir = (pdir / manifest.build_dir).resolve()
    path = _resolve_within(build_dir, filename, "Export path is outside the build directory.")
    if not path.exists():
        raise HTTPException(404, "Export not found")
    return FileResponse(path, media_type="video/mp4", filename=path.name)


@router.websocket("/ws/progress")
async def ws_progress(websocket: WebSocket):
    if not _origin_allowed(websocket.scope.get("app"), websocket.headers.get("origin")):
        await websocket.close(code=1008)
        return
    await websocket.accept()
    _WS_CLIENTS.append(websocket)
    try:
        while True:
            # Keep alive
            data = await websocket.receive_text()
    except WebSocketDisconnect:
        if websocket in _WS_CLIENTS:
            _WS_CLIENTS.remove(websocket)
