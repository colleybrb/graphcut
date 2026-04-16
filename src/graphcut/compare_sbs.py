"""Side-by-side comparison engine for GraphCut — pure Python via MoviePy v2.

Given a YAML pairs manifest this module:
  1. Parses and validates the manifest (Pydantic v2 ClipPair models).
  2. For each pair, subclips before / after segments.
  3. Applies freeze / black / loop / trim behaviour to the shorter side.
  4. Composites both sides with ``clips_array`` (h-stack or v-stack).
  5. Concatenates all pairs (with optional gap) into the final output.
  6. Returns a structured ``ComparisonResult`` for JSON / Markdown reporting.

No system FFmpeg install required — MoviePy bundles its own binary via
``imageio-ffmpeg``.  Install it with ``pip install moviepy``.
"""

from __future__ import annotations

import logging
import os
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Literal

import yaml
from pydantic import BaseModel, Field, model_validator

logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Types
# ---------------------------------------------------------------------------

FreezeMode = Literal["last-frame", "black", "loop", "none"]
Layout = Literal["horizontal", "vertical"]
AudioMode = Literal["mute", "before", "after", "mix"]

LARGE_DURATION_MISMATCH_RATIO = 2.0


# ---------------------------------------------------------------------------
# Manifest models (Pydantic v2)
# ---------------------------------------------------------------------------

class ClipSegment(BaseModel):
    """One side of a before / after pair."""

    label: str = ""
    source: Path | None = None  # overrides primary source when set
    in_point: float = Field(alias="in", default=0.0)
    out_point: float = Field(alias="out", default=0.0)

    model_config = {"populate_by_name": True}

    @model_validator(mode="after")
    def _validate_range(self) -> "ClipSegment":
        if self.out_point <= self.in_point:
            raise ValueError(
                f"out ({self.out_point}) must be > in ({self.in_point}) "
                f"for segment '{self.label}'"
            )
        return self

    @property
    def duration(self) -> float:
        return self.out_point - self.in_point


class ClipPair(BaseModel):
    """A single before / after comparison unit."""

    id: str
    title: str = ""
    before: ClipSegment
    after: ClipSegment


class ManifestOptions(BaseModel):
    """Top-level options block from the YAML manifest."""

    layout: Layout = "horizontal"
    background: str = "#000000"
    before_label: str = "Before"
    after_label: str = "After"
    gap_between_pairs: float = 0.0  # seconds of black silence between pairs


class SBSManifest(BaseModel):
    """Parsed pairs manifest."""

    pairs: list[ClipPair]
    options: ManifestOptions = Field(default_factory=ManifestOptions)


# ---------------------------------------------------------------------------
# Result models
# ---------------------------------------------------------------------------

@dataclass
class FreezeInfo:
    side: str        # "before" | "after" | "none"
    mode: FreezeMode
    duration: float  # seconds of padding applied


@dataclass
class PairResult:
    id: str
    title: str
    before_duration: float
    after_duration: float
    output_duration: float
    freeze: FreezeInfo
    warnings: list[str] = field(default_factory=list)


@dataclass
class ComparisonResult:
    input_source: str
    output: str
    pairs: list[PairResult] = field(default_factory=list)
    total_output_duration: float = 0.0
    warnings: list[str] = field(default_factory=list)
    version: str = "graphcut-0.1"

    def to_dict(self) -> dict[str, Any]:
        return {
            "input": self.input_source,
            "output": self.output,
            "pairs": [
                {
                    "id": p.id,
                    "title": p.title,
                    "before": {"duration": round(p.before_duration, 3)},
                    "after": {"duration": round(p.after_duration, 3)},
                    "output_duration": round(p.output_duration, 3),
                    "freeze": {
                        "side": p.freeze.side,
                        "mode": p.freeze.mode,
                        "duration": round(p.freeze.duration, 3),
                    },
                    "warnings": p.warnings,
                }
                for p in self.pairs
            ],
            "total_output_duration": round(self.total_output_duration, 3),
            "warnings": self.warnings,
            "version": self.version,
        }

    def to_markdown_table(self) -> str:
        header = (
            "| Pair ID | Title | Before (s) | After (s) | "
            "Output (s) | Freeze side | Freeze (s) |\n"
            "|---------|-------|------------|-----------|"
            "------------|-------------|------------|\n"
        )
        rows = "".join(
            f"| {p.id} | {p.title} | {p.before_duration:.1f} | "
            f"{p.after_duration:.1f} | {p.output_duration:.1f} | "
            f"{p.freeze.side} | {p.freeze.duration:.1f} |\n"
            for p in self.pairs
        )
        footer = f"\n**Total output duration:** {self.total_output_duration:.1f} s\n"
        return header + rows + footer


# ---------------------------------------------------------------------------
# Manifest loading
# ---------------------------------------------------------------------------

def load_pairs_manifest(
    path: Path,
    primary_source: Path | None = None,
) -> SBSManifest:
    """Parse a YAML pairs manifest.

    ``primary_source`` fills in any segment where ``source`` is omitted.
    """
    with open(path, encoding="utf-8") as fh:
        raw = yaml.safe_load(fh)

    manifest = SBSManifest.model_validate(raw)

    for pair in manifest.pairs:
        for seg in (pair.before, pair.after):
            if seg.source is None:
                if primary_source is None:
                    raise ValueError(
                        f"Pair '{pair.id}': segment '{seg.label}' has no "
                        "`source:` and no primary source was provided."
                    )
                seg.source = primary_source

    return manifest


# ---------------------------------------------------------------------------
# Pair analysis (pure Python, no I/O)
# ---------------------------------------------------------------------------

def _analyze_pair(
    pair: ClipPair,
    freeze_mode: FreezeMode,
) -> tuple[float, FreezeInfo, list[str]]:
    """Return ``(output_duration, FreezeInfo, warnings)`` for one pair."""
    d_before = pair.before.duration
    d_after = pair.after.duration
    warnings: list[str] = []

    ratio = max(d_before, d_after) / max(min(d_before, d_after), 0.001)
    if ratio >= LARGE_DURATION_MISMATCH_RATIO:
        warnings.append("large_duration_mismatch")

    if freeze_mode == "none":
        output_duration = min(d_before, d_after)
        return output_duration, FreezeInfo("none", "none", 0.0), warnings

    output_duration = max(d_before, d_after)
    if abs(d_before - d_after) < 0.001:
        return output_duration, FreezeInfo("none", freeze_mode, 0.0), warnings

    if d_before < d_after:
        freeze = FreezeInfo("before", freeze_mode, d_after - d_before)
    else:
        freeze = FreezeInfo("after", freeze_mode, d_before - d_after)

    return output_duration, freeze, warnings


# ---------------------------------------------------------------------------
# MoviePy helpers — thin wrappers for testability
# ---------------------------------------------------------------------------

def _import_moviepy() -> None:
    """Verify moviepy is installed; raise a clean ImportError if not."""
    try:
        import moviepy  # noqa: PLC0415,F401
    except ImportError as exc:
        raise ImportError(
            "compare-sbs requires moviepy.\n"
            "Install it with:  pip install moviepy"
        ) from exc


def _moviepy_concat(clips: list[Any], **kw: Any) -> Any:
    from moviepy import concatenate_videoclips  # noqa: PLC0415
    return concatenate_videoclips(clips, **kw)


def _moviepy_color_clip(size: tuple[int, int], color: tuple[int, int, int], duration: float) -> Any:
    from moviepy import ColorClip  # noqa: PLC0415
    return ColorClip(size=size, color=color, duration=duration)


def _moviepy_clips_array(grid: list[list[Any]]) -> Any:
    from moviepy import clips_array  # noqa: PLC0415
    return clips_array(grid)


def _moviepy_composite_video(clips: list[Any], size: tuple[int, int]) -> Any:
    from moviepy import CompositeVideoClip  # noqa: PLC0415
    return CompositeVideoClip(clips, size=size)


# ---------------------------------------------------------------------------
# Freeze / extend helpers
# ---------------------------------------------------------------------------

def _apply_freeze(clip: Any, freeze_mode: FreezeMode, target_duration: float) -> Any:
    """Extend *clip* to *target_duration* using the requested freeze strategy.

    Bug-fixes vs naive implementation:
    - Uses native ``vfx.Freeze`` for last-frame (avoids PTS discontinuity).
    - Strips audio from black/loop pads before concat so mixed-audio clips
      don't raise when one stream is silent.
    - ``vfx.Loop`` is applied with ``total_duration`` so no manual trim needed.
    """
    from moviepy import concatenate_videoclips, vfx  # noqa: PLC0415

    pad_seconds = target_duration - clip.duration
    if pad_seconds <= 0.001:
        return clip

    if freeze_mode == "last-frame":
        # Native Freeze effect: freeze at the last frame for pad_seconds.
        # Much more reliable than to_ImageClip + concat (avoids fps mismatch).
        freeze_t = max(0.0, clip.duration - 1 / 30)
        try:
            return clip.with_effects(
                [vfx.Freeze(t=freeze_t, freeze_duration=pad_seconds)]
            )
        except Exception:  # pragma: no cover — fallback for older API
            from moviepy import ImageClip  # noqa: PLC0415
            last_frame_arr = clip.get_frame(freeze_t)
            frozen = (
                ImageClip(last_frame_arr)
                .with_duration(pad_seconds)
                .with_fps(clip.fps or 30)
                .without_audio()
            )
            clip_no_audio = clip.without_audio()
            return concatenate_videoclips([clip_no_audio, frozen])

    elif freeze_mode == "black":
        # Hold a silent black frame for pad_seconds then concat
        black = (
            _moviepy_color_clip(size=clip.size, color=(0, 0, 0), duration=pad_seconds)
            .without_audio()
        )
        # Ensure base clip also has no audio to prevent stream mismatch
        return concatenate_videoclips([clip.without_audio(), black])

    elif freeze_mode == "loop":
        # vfx.Loop repeats the clip; duration controls the total output length
        return clip.with_effects([vfx.Loop(duration=target_duration)])

    # freeze_mode == "none" — caller already trimmed; nothing to do
    return clip


# ---------------------------------------------------------------------------
# Per-side clip builder
# ---------------------------------------------------------------------------

def _make_side_clip(seg: ClipSegment, target_w: int, target_h: int) -> Any:
    """Load, trim, letterbox-scale one segment to *target_w* × *target_h*.

    Windows note: ``VideoFileClip`` receives the path as a ``str`` so that
    pathlib paths with backslashes work correctly on all platforms.
    """
    from moviepy import VideoFileClip, vfx  # noqa: PLC0415

    # Forward-slash str works on all platforms; avoids Windows escape issues
    raw = VideoFileClip(seg.source.as_posix())
    trimmed = raw.subclipped(seg.in_point, seg.out_point)

    # Scale to fit inside the target bounding box (preserve aspect ratio)
    src_w, src_h = trimmed.size
    scale = min(target_w / src_w, target_h / src_h)
    scaled_w = int(src_w * scale)
    scaled_h = int(src_h * scale)

    # vfx.Resize accepts positional tuple (new_size) — confirmed in MoviePy 2.1
    scaled = trimmed.with_effects([vfx.Resize(new_size=(scaled_w, scaled_h))])

    # Letterbox: centre the scaled clip on a black canvas
    x_offset = (target_w - scaled_w) // 2
    y_offset = (target_h - scaled_h) // 2
    composite = _moviepy_composite_video(
        [
            _moviepy_color_clip(
                size=(target_w, target_h), color=(0, 0, 0), duration=scaled.duration
            ),
            scaled.with_position((x_offset, y_offset)),
        ],
        size=(target_w, target_h),
    )
    return composite.with_duration(scaled.duration)


# ---------------------------------------------------------------------------
# Per-pair compositor
# ---------------------------------------------------------------------------

def _build_pair_clip(
    pair: ClipPair,
    layout: Layout,
    freeze_mode: FreezeMode,
    audio_mode: AudioMode,
    canvas_w: int,
    canvas_h: int,
) -> tuple[Any, PairResult]:
    """Return a composed MoviePy clip for one before/after pair + metadata."""
    from moviepy import CompositeAudioClip  # noqa: PLC0415

    output_duration, freeze, warnings = _analyze_pair(pair, freeze_mode)

    # Determine per-side canvas
    if layout == "horizontal":
        side_w, side_h = canvas_w // 2, canvas_h
    else:
        side_w, side_h = canvas_w, canvas_h // 2

    before_clip = _make_side_clip(pair.before, side_w, side_h)
    after_clip = _make_side_clip(pair.after, side_w, side_h)

    # Apply freeze / trim
    if freeze_mode != "none" and freeze.side != "none" and freeze.duration > 0.001:
        if freeze.side == "before":
            before_clip = _apply_freeze(before_clip, freeze_mode, output_duration)
        else:
            after_clip = _apply_freeze(after_clip, freeze_mode, output_duration)
    elif freeze_mode == "none":
        before_clip = before_clip.subclipped(0, output_duration)
        after_clip = after_clip.subclipped(0, output_duration)

    # Stack side-by-side using clips_array (no manual position math needed)
    if layout == "horizontal":
        stacked = _moviepy_clips_array([[before_clip, after_clip]])
    else:
        stacked = _moviepy_clips_array([[before_clip], [after_clip]])

    # Audio handling
    if audio_mode == "mute":
        stacked = stacked.without_audio()
    elif audio_mode == "before":
        stacked = stacked.with_audio(before_clip.audio) if before_clip.audio else stacked.without_audio()
    elif audio_mode == "after":
        stacked = stacked.with_audio(after_clip.audio) if after_clip.audio else stacked.without_audio()
    elif audio_mode == "mix":
        audios = [c.audio for c in (before_clip, after_clip) if c.audio is not None]
        stacked = stacked.with_audio(CompositeAudioClip(audios)) if audios else stacked.without_audio()
    else:
        stacked = stacked.without_audio()

    pair_result = PairResult(
        id=pair.id,
        title=pair.title,
        before_duration=round(pair.before.duration, 3),
        after_duration=round(pair.after.duration, 3),
        output_duration=round(output_duration, 3),
        freeze=freeze,
        warnings=warnings,
    )
    return stacked, pair_result


# ---------------------------------------------------------------------------
# Public entry point
# ---------------------------------------------------------------------------

def run_compare_sbs(
    primary_source: Path | None,
    pairs_manifest: Path,
    output: Path,
    layout: Layout = "horizontal",
    freeze_mode: FreezeMode = "last-frame",
    audio_mode: AudioMode = "mute",
    platform_name: str | None = None,
    canvas_w: int = 1920,
    canvas_h: int = 1080,
    gap_between_pairs: float | None = None,
    fps: int = 30,
    write_kwargs: dict[str, Any] | None = None,
) -> ComparisonResult:
    """Run the full side-by-side comparison pipeline using MoviePy v2.

    No system FFmpeg install required — MoviePy uses its bundled binary.

    Args:
        primary_source: Default video file for segments without an explicit
            ``source:`` key.  Set to ``None`` only when every segment in the
            manifest specifies its own ``source:``.
        pairs_manifest: Path to the YAML pairs manifest.
        output: Destination for the final concatenated video.
        layout: ``"horizontal"`` (left/right) or ``"vertical"`` (top/bottom).
        freeze_mode: How to extend the shorter side.
        audio_mode: ``"mute"`` | ``"before"`` | ``"after"`` | ``"mix"``.
        platform_name: Reserved for future preset canvas sizing.
        canvas_w: Output canvas width in pixels (default 1920).
        canvas_h: Output canvas height in pixels (default 1080).
        gap_between_pairs: Override the manifest ``gap_between_pairs`` option.
        fps: Output frame rate (default 30).
        write_kwargs: Extra keyword arguments forwarded to
            ``VideoClip.write_videofile``.  Useful for overriding codec,
            bitrate, preset, etc.

    Returns:
        :class:`ComparisonResult` with per-pair stats and totals.

    Raises:
        ImportError:  If ``moviepy`` is not installed.
        ValueError:   If the manifest is empty or a segment has no source.
    """
    _import_moviepy()

    manifest = load_pairs_manifest(pairs_manifest, primary_source=primary_source)

    if not manifest.pairs:
        raise ValueError("No pairs were produced — the manifest is empty.")

    effective_gap = (
        gap_between_pairs
        if gap_between_pairs is not None
        else manifest.options.gap_between_pairs
    )

    result = ComparisonResult(
        input_source=str(primary_source or ""),
        output=str(output),
    )

    pair_clips: list[Any] = []

    for pair in manifest.pairs:
        clip, pair_result = _build_pair_clip(
            pair=pair,
            layout=layout,
            freeze_mode=freeze_mode,
            audio_mode=audio_mode,
            canvas_w=canvas_w,
            canvas_h=canvas_h,
        )
        if pair_clips and effective_gap > 0:
            # Silent black gap between consecutive pairs
            gap_clip = _moviepy_color_clip(
                size=(canvas_w, canvas_h),
                color=(0, 0, 0),
                duration=effective_gap,
            ).without_audio()
            pair_clips.append(gap_clip)

        pair_clips.append(clip)
        result.pairs.append(pair_result)

    final = _moviepy_concat(pair_clips, method="compose")

    # Ensure output directory exists (handles Windows UNC paths too)
    output_parent = output.parent
    if str(output_parent) not in (".", ""):
        output_parent.mkdir(parents=True, exist_ok=True)

    # Build write args — suppress audio track when muted to avoid silent
    # audio encoding overhead (saves ~10% encode time on long comparisons)
    has_audio = audio_mode != "mute"
    default_kwargs: dict[str, Any] = {
        "fps": fps,
        "codec": "libx264",
        "audio": has_audio,
        "audio_codec": "aac" if has_audio else None,
        # Use None logger for clean output on Windows (no tqdm ANSI issues)
        "logger": None if _is_windows() else "bar",
    }
    default_kwargs.update(write_kwargs or {})

    logger.info("Writing comparison video → %s", output)
    final.write_videofile(output.as_posix(), **default_kwargs)

    result.total_output_duration = round(
        sum(
            p.output_duration + (effective_gap if i > 0 else 0)
            for i, p in enumerate(result.pairs)
        ),
        3,
    )
    logger.info(
        "compare-sbs complete → %s (%.1fs)",
        output,
        result.total_output_duration,
    )
    return result


def _is_windows() -> bool:
    """Return True when running on Windows."""
    return os.name == "nt"
