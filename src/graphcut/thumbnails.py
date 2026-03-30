"""Thumbnail generation for video sources."""

from __future__ import annotations

import logging
from pathlib import Path

from graphcut.models import ProjectManifest
from graphcut.ffmpeg_executor import FFmpegExecutor

logger = logging.getLogger(__name__)


def generate_thumbnail(
    file_path: Path, 
    output_path: Path, 
    timestamp: float | None = None, 
    width: int = 320,
    executor: FFmpegExecutor | None = None
) -> Path:
    """Generate a single thumbnail frame from a video file."""
    if not executor:
        executor = FFmpegExecutor()

    # Determine default timestamp if not provided (e.g., 25% in)
    if timestamp is None:
        try:
            info = executor.run_ffprobe(file_path)
            duration = 0.0
            for stream in info.get("streams", []):
                if stream.get("codec_type") == "video":
                    d = stream.get("duration")
                    if d:
                        duration = float(d)
                        break
            # Fallback if no duration found
            timestamp = duration * 0.25 if duration > 0 else 0.0
        except Exception:
            timestamp = 0.0

    cmd = [
        "-ss", str(timestamp),
        "-i", str(file_path),
        "-vframes", "1",
        "-vf", f"scale={width}:-1",
        "-y",
        str(output_path)
    ]
    
    executor.run(cmd)
    return output_path


def generate_thumbnails(manifest: ProjectManifest, cache_dir: Path) -> dict[str, Path]:
    """Generate thumbnails for all applicable video sources in a project."""
    executor = FFmpegExecutor()
    thumb_dir = cache_dir / ".cache" / "thumbnails"
    thumb_dir.mkdir(parents=True, exist_ok=True)
    
    results = {}
    for source_id, info in manifest.sources.items():
        if info.media_type != "video":
            continue
            
        out_path = thumb_dir / f"{info.file_hash}_{source_id}.jpg"
        if not out_path.exists():
            logger.info("Generating thumbnail for %s", source_id)
            try:
                generate_thumbnail(
                    info.file_path, 
                    out_path, 
                    timestamp=info.duration_seconds * 0.25 if info.duration_seconds else 0.0,
                    executor=executor
                )
            except Exception as e:
                logger.warning("Failed to generate thumbnail for %s: %s", source_id, e)
                continue
                
        results[source_id] = out_path
        
    return results
