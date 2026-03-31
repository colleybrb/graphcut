"""Unit tests for media prober and FFmpeg executor."""

from __future__ import annotations

import sys
import types
from pathlib import Path

from graphcut.ffmpeg_executor import FFmpegExecutor


def _touch_binary(path: Path) -> Path:
    path.write_text("")
    path.chmod(0o755)
    return path


def test_ffmpeg_executor_init_uses_resolved_binaries(monkeypatch, tmp_path: Path):
    """Executor init should store resolved ffmpeg and ffprobe paths."""
    ffmpeg_path = _touch_binary(tmp_path / "ffmpeg")
    ffprobe_path = _touch_binary(tmp_path / "ffprobe")

    def fake_find_binary(name: str, required: bool = True) -> Path | None:
        return ffmpeg_path if name == "ffmpeg" else ffprobe_path

    monkeypatch.setattr(FFmpegExecutor, "_find_binary", staticmethod(fake_find_binary))

    executor = FFmpegExecutor()

    assert executor.ffmpeg_path == ffmpeg_path
    assert executor.ffprobe_path == ffprobe_path


def test_find_binary_uses_static_ffmpeg_direct_paths(monkeypatch, tmp_path: Path):
    """Fallback should use static-ffmpeg's direct resolver before PATH mutation."""
    ffmpeg_path = _touch_binary(tmp_path / "static_ffmpeg")
    ffprobe_path = _touch_binary(tmp_path / "static_ffprobe")
    static_ffmpeg = types.ModuleType("static_ffmpeg")
    original_exists = Path.exists
    original_is_file = Path.is_file

    def resolve() -> tuple[str, str]:
        return str(ffmpeg_path), str(ffprobe_path)

    def fake_exists(path: Path) -> bool:
        if str(path) in {
            "/opt/homebrew/bin/ffmpeg",
            "/opt/homebrew/bin/ffprobe",
            "/usr/local/bin/ffmpeg",
            "/usr/local/bin/ffprobe",
        }:
            return False
        return original_exists(path)

    def fake_is_file(path: Path) -> bool:
        if str(path) in {
            "/opt/homebrew/bin/ffmpeg",
            "/opt/homebrew/bin/ffprobe",
            "/usr/local/bin/ffmpeg",
            "/usr/local/bin/ffprobe",
        }:
            return False
        return original_is_file(path)

    static_ffmpeg.run = types.SimpleNamespace(
        get_or_fetch_platform_executables_else_raise=resolve
    )
    static_ffmpeg.add_paths = lambda: (_ for _ in ()).throw(
        AssertionError("add_paths should not be needed when the direct resolver succeeds")
    )

    monkeypatch.setattr("graphcut.ffmpeg_executor.shutil.which", lambda _name: None)
    monkeypatch.setattr("graphcut.ffmpeg_executor.Path.exists", fake_exists)
    monkeypatch.setattr("graphcut.ffmpeg_executor.Path.is_file", fake_is_file)
    monkeypatch.setitem(sys.modules, "static_ffmpeg", static_ffmpeg)

    assert FFmpegExecutor._find_binary("ffmpeg") == ffmpeg_path
    assert FFmpegExecutor._find_binary("ffprobe") == ffprobe_path


def test_encoder_detection(monkeypatch, tmp_path: Path):
    """Verify detect_encoders parses the encoder list output."""
    ffmpeg_path = _touch_binary(tmp_path / "ffmpeg")
    ffprobe_path = _touch_binary(tmp_path / "ffprobe")
    executor = FFmpegExecutor(ffmpeg_path=ffmpeg_path, ffprobe_path=ffprobe_path)

    def fake_run(*_args, **_kwargs):
        return types.SimpleNamespace(
            stdout=" V..... libx264\n A..... aac\n",
            stderr="",
            returncode=0,
        )

    monkeypatch.setattr("graphcut.ffmpeg_executor.subprocess.run", fake_run)

    encoders = executor.detect_encoders()

    assert isinstance(encoders, dict)
    assert encoders["libx264"] is True
    assert encoders["aac"] is True


def test_best_encoder(tmp_path: Path):
    """Verify get_best_encoder returns the highest-priority available encoder."""
    ffmpeg_path = _touch_binary(tmp_path / "ffmpeg")
    ffprobe_path = _touch_binary(tmp_path / "ffprobe")
    executor = FFmpegExecutor(ffmpeg_path=ffmpeg_path, ffprobe_path=ffprobe_path)
    executor._encoder_cache = {
        "h264_videotoolbox": False,
        "h264_nvenc": True,
        "h264_qsv": False,
        "libx264": True,
        "aac": True,
    }

    assert executor.get_best_encoder() == "h264_nvenc"


def test_best_encoder_skips_unusable_hardware(monkeypatch, tmp_path: Path):
    """Auto-detect should ignore hardware encoders that cannot initialize."""
    ffmpeg_path = _touch_binary(tmp_path / "ffmpeg")
    ffprobe_path = _touch_binary(tmp_path / "ffprobe")
    executor = FFmpegExecutor(ffmpeg_path=ffmpeg_path, ffprobe_path=ffprobe_path)
    executor._encoder_cache = {
        "h264_videotoolbox": False,
        "h264_nvenc": True,
        "h264_qsv": False,
        "libx264": True,
        "aac": True,
    }

    monkeypatch.setattr(
        executor,
        "_probe_encoder_init",
        lambda encoder: False if encoder == "h264_nvenc" else True,
    )

    assert executor.get_best_encoder() == "libx264"


def test_best_encoder_requested_hardware_falls_back_when_unusable(monkeypatch, tmp_path: Path):
    """Explicit hardware requests should still fall back when init probing fails."""
    ffmpeg_path = _touch_binary(tmp_path / "ffmpeg")
    ffprobe_path = _touch_binary(tmp_path / "ffprobe")
    executor = FFmpegExecutor(ffmpeg_path=ffmpeg_path, ffprobe_path=ffprobe_path)
    executor._encoder_cache = {
        "h264_videotoolbox": False,
        "h264_nvenc": True,
        "h264_qsv": False,
        "libx264": True,
        "aac": True,
    }

    monkeypatch.setattr(
        executor,
        "_probe_encoder_init",
        lambda encoder: False if encoder == "h264_nvenc" else True,
    )

    assert executor.get_best_encoder("h264_nvenc") == "libx264"


def test_best_encoder_honors_env_override(monkeypatch, tmp_path: Path):
    """Explicit encoder overrides should win when the encoder is available."""
    ffmpeg_path = _touch_binary(tmp_path / "ffmpeg")
    ffprobe_path = _touch_binary(tmp_path / "ffprobe")
    executor = FFmpegExecutor(ffmpeg_path=ffmpeg_path, ffprobe_path=ffprobe_path)

    monkeypatch.setattr(
        executor,
        "detect_encoders",
        lambda: {"h264_nvenc": True, "libx264": True},
    )
    monkeypatch.setenv("GRAPHCUT_VIDEO_ENCODER", "libx264")

    assert executor.get_best_encoder() == "libx264"
