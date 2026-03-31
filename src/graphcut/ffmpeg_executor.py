"""FFmpeg/ffprobe subprocess executor with hardware encoder detection."""

from __future__ import annotations

import json
import logging
import os
import re
import shutil
import subprocess
from pathlib import Path
from typing import Any, Callable

logger = logging.getLogger(__name__)


class FFmpegError(Exception):
    """Raised when an FFmpeg command fails."""

    def __init__(
        self,
        message: str,
        returncode: int = 1,
        stderr: str = "",
        cmd: list[str] | None = None,
    ) -> None:
        self.returncode = returncode
        self.stderr = stderr
        self.cmd = cmd
        super().__init__(message)


class FFmpegExecutor:
    """Wrapper for FFmpeg and ffprobe subprocess calls.

    Locates binaries, detects hardware encoders, runs commands with
    optional progress parsing.
    """

    # Encoder priority order — best to worst for H.264
    _ENCODER_PRIORITY = [
        "h264_videotoolbox",  # macOS
        "h264_nvenc",  # NVIDIA
        "h264_qsv",  # Intel Quick Sync
        "libx264",  # Software fallback (always available)
    ]
    _SOFTWARE_ENCODER = "libx264"

    def __init__(
        self,
        ffmpeg_path: str | Path | None = None,
        ffprobe_path: str | Path | None = None,
    ) -> None:
        self.ffmpeg_path = Path(ffmpeg_path) if ffmpeg_path else self._find_binary("ffmpeg")
        self.ffprobe_path = Path(ffprobe_path) if ffprobe_path else self._find_binary("ffprobe", required=False)
        self._encoder_cache: dict[str, bool] | None = None
        self._encoder_init_cache: dict[str, bool] = {}

        logger.debug("FFmpeg: %s", self.ffmpeg_path)
        logger.debug("ffprobe: %s", self.ffprobe_path)

    @staticmethod
    def _find_binary(name: str, required: bool = True) -> Path | None:
        """Locate a binary on the system PATH."""
        location = shutil.which(name)

        # Fallback for macOS where environments (IDEs/services) often strip Homebrew PATH
        if location is None:
            for fallback_dir in ["/opt/homebrew/bin", "/usr/local/bin"]:
                fallback_path = Path(fallback_dir) / name
                if fallback_path.exists() and fallback_path.is_file():
                    location = str(fallback_path)
                    break

        if location is None:
            try:
                import static_ffmpeg
                import urllib.request

                sys_proxies = urllib.request.getproxies()

                # Manual CLI override passed from `serve --proxy`
                manual_override = os.environ.get("GRAPHCUT_HTTP_PROXY")
                if manual_override:
                    sys_proxies = {"http": manual_override, "https": manual_override}

                proxy_env_updates: dict[str, str | None] = {}
                for scheme in ("http", "https"):
                    proxy = sys_proxies.get(scheme)
                    if not proxy:
                        continue
                    for key in (f"{scheme.upper()}_PROXY", f"{scheme.lower()}_proxy"):
                        proxy_env_updates.setdefault(key, os.environ.get(key))
                        os.environ[key] = proxy

                try:
                    run_api = getattr(static_ffmpeg, "run", None)
                    resolver = getattr(run_api, "get_or_fetch_platform_executables_else_raise", None)
                    if callable(resolver):
                        ffmpeg_path, ffprobe_path = resolver()
                        location = {
                            "ffmpeg": ffmpeg_path,
                            "ffprobe": ffprobe_path,
                        }.get(name)

                    if location is None:
                        # Backward-compatible fallback for older static-ffmpeg releases.
                        static_ffmpeg.add_paths()
                        location = shutil.which(name)
                finally:
                    for key, previous in proxy_env_updates.items():
                        if previous is None:
                            os.environ.pop(key, None)
                        else:
                            os.environ[key] = previous
            except Exception as e:
                logger.warning(f"Failed to bootstrap static FFmpeg fallback: {e}")
                location = None

        if location is None:
            if not required:
                return None
            raise FFmpegError(
                f"'{name}' not found on PATH or common Homebrew directories, and static-ffmpeg could not provide it. "
                "Install FFmpeg or add the Python package fallback with `pip install static-ffmpeg`."
            )
        return Path(location)

    def _require_ffprobe(self) -> Path:
        """Resolve ffprobe lazily so render-only workflows can still run."""
        if self.ffprobe_path is None:
            self.ffprobe_path = self._find_binary("ffprobe")
        return self.ffprobe_path

    def detect_encoders(self) -> dict[str, bool]:
        """Detect available H.264 and audio encoders.

        Returns a dict mapping encoder name to availability.
        Results are cached after the first call.
        """
        if self._encoder_cache is not None:
            return self._encoder_cache

        try:
            result = subprocess.run(
                [str(self.ffmpeg_path), "-encoders", "-hide_banner"],
                capture_output=True,
                text=True,
                encoding="utf-8",
                errors="replace",
                timeout=10,
            )
            output = result.stdout
        except (subprocess.TimeoutExpired, OSError) as e:
            logger.warning("Failed to detect encoders: %s", e)
            # Assume software fallback is available
            self._encoder_cache = {"libx264": True, "aac": True}
            return self._encoder_cache

        encoders_to_check = [
            "h264_videotoolbox",
            "h264_nvenc",
            "h264_qsv",
            "libx264",
            "aac",
            "libfdk_aac",
        ]

        self._encoder_cache = {}
        for enc in encoders_to_check:
            # FFmpeg encoder list format: " V..... libx264 ..."
            pattern = rf"\s[A-Z.]+\s+{re.escape(enc)}\s"
            self._encoder_cache[enc] = bool(re.search(pattern, output))

        logger.debug("Available encoders: %s", self._encoder_cache)
        return self._encoder_cache

    def get_best_encoder(self, preferred: str | None = None) -> str:
        """Return the best available H.264 encoder.

        Priority: videotoolbox > nvenc > qsv > libx264.
        """
        available = self.detect_encoders()
        requested = (preferred or os.environ.get("GRAPHCUT_VIDEO_ENCODER") or "").strip()
        if requested:
            if available.get(requested, False) and self._is_encoder_usable(requested):
                logger.debug("Selected requested encoder: %s", requested)
                return requested
            logger.warning("Requested video encoder '%s' is unavailable or unusable; falling back to auto-detect.", requested)

        for encoder in self._ENCODER_PRIORITY:
            if available.get(encoder, False) and self._is_encoder_usable(encoder):
                logger.debug("Selected encoder: %s", encoder)
                return encoder

        # libx264 should always be available, but just in case
        return self._SOFTWARE_ENCODER

    @classmethod
    def is_hardware_encoder(cls, encoder: str) -> bool:
        """Return True when the encoder depends on a hardware backend."""
        return encoder != cls._SOFTWARE_ENCODER and any(
            token in encoder for token in ("videotoolbox", "nvenc", "qsv")
        )

    @classmethod
    def should_retry_with_software(cls, encoder: str, error: FFmpegError) -> bool:
        """Return True when a hardware encoder failed during initialization."""
        if not cls.is_hardware_encoder(encoder):
            return False

        stderr = (error.stderr or "").lower()
        failure_markers = (
            "could not open encoder",
            "error while opening encoder",
            "open encode session failed",
            "cannot create compression session",
            "no capable devices found",
            "cannot load nvcuda",
            "device not available",
            "initialization failed",
            "unsupported device",
            "invalid argument",
        )
        return any(marker in stderr for marker in failure_markers)

    def _is_encoder_usable(self, encoder: str) -> bool:
        """Return True when the encoder is both advertised and can be initialized."""
        if not self.is_hardware_encoder(encoder):
            return True

        cached = self._encoder_init_cache.get(encoder)
        if cached is not None:
            return cached

        usable = self._probe_encoder_init(encoder)
        self._encoder_init_cache[encoder] = usable
        return usable

    def _probe_encoder_init(self, encoder: str) -> bool:
        """Run a tiny synthetic encode to verify that a hardware encoder can start."""
        cmd = [
            str(self.ffmpeg_path),
            "-hide_banner",
            "-loglevel",
            "error",
            "-f",
            "lavfi",
            "-i",
            "testsrc2=size=64x64:rate=1",
            "-frames:v",
            "1",
            "-an",
            "-c:v",
            encoder,
        ]
        if "videotoolbox" in encoder:
            cmd.extend(["-allow_sw", "1"])
        cmd.extend(["-f", "null", "-"])

        try:
            result = subprocess.run(
                cmd,
                capture_output=True,
                text=True,
                encoding="utf-8",
                errors="replace",
                timeout=10,
            )
        except (subprocess.TimeoutExpired, OSError) as e:
            logger.warning("Failed to probe encoder %s: %s", encoder, e)
            return False

        if result.returncode == 0:
            return True

        logger.warning(
            "Skipping unusable hardware encoder %s: %s",
            encoder,
            (result.stderr or "").strip()[-300:],
        )
        return False

    def run_ffprobe(self, file_path: Path) -> dict[str, Any]:
        """Run ffprobe on a file and return parsed JSON output.

        Args:
            file_path: Path to the media file to probe.

        Returns:
            Parsed JSON dict with 'format' and 'streams' keys.

        Raises:
            FFmpegError: If ffprobe fails or returns invalid JSON.
        """
        if not file_path.exists():
            raise FFmpegError(f"File not found: {file_path}")

        ffprobe_path = self._require_ffprobe()

        cmd = [
            str(ffprobe_path),
            "-v", "quiet",
            "-print_format", "json",
            "-show_format",
            "-show_streams",
            str(file_path),
        ]

        logger.debug("Running ffprobe: %s", " ".join(cmd))

        try:
            result = subprocess.run(
                cmd,
                capture_output=True,
                text=True,
                encoding="utf-8",
                errors="replace",
                timeout=30,
            )
        except subprocess.TimeoutExpired:
            raise FFmpegError(f"ffprobe timed out for: {file_path}")
        except OSError as e:
            raise FFmpegError(f"Failed to run ffprobe: {e}")

        if result.returncode != 0:
            raise FFmpegError(
                f"ffprobe failed for {file_path}: {result.stderr.strip()}",
                returncode=result.returncode,
                stderr=result.stderr,
            )

        try:
            return json.loads(result.stdout)
        except json.JSONDecodeError as e:
            raise FFmpegError(f"ffprobe returned invalid JSON for {file_path}: {e}")

    def run(
        self,
        args: list[str],
        progress_callback: Callable[[float, str, str], None] | None = None,
        duration: float | None = None,
        timeout: int | None = None,
    ) -> subprocess.CompletedProcess[str]:
        """Run an FFmpeg command with optional progress reporting.

        Args:
            args: FFmpeg arguments (without the ffmpeg binary itself).
            progress_callback: Called with progress percentage (0-100).
            duration: Total duration in seconds for progress calculation.
            timeout: Command timeout in seconds (None for no timeout).

        Returns:
            CompletedProcess with stdout/stderr.

        Raises:
            FFmpegError: If the command fails.
        """
        cmd = [str(self.ffmpeg_path)] + args
        logger.debug("Running FFmpeg: %s", " ".join(cmd))

        if progress_callback and duration and duration > 0:
            return self._run_with_progress(cmd, progress_callback, duration, timeout)

        try:
            result = subprocess.run(
                cmd,
                capture_output=True,
                text=True,
                encoding="utf-8",
                errors="replace",
                timeout=timeout,
            )
        except subprocess.TimeoutExpired:
            raise FFmpegError(f"FFmpeg command timed out: {' '.join(args[:5])}...")
        except OSError as e:
            raise FFmpegError(f"Failed to run FFmpeg: {e}")

        if result.returncode != 0:
            raise FFmpegError(
                f"FFmpeg failed: {result.stderr.strip()[-500:]}",
                returncode=result.returncode,
                stderr=result.stderr,
                cmd=cmd,
            )

        return result

    def _run_with_progress(
        self,
        cmd: list[str],
        callback: Callable[[float, str, str], None],
        duration: float,
        timeout: int | None,
    ) -> subprocess.CompletedProcess[str]:
        """Run FFmpeg with real-time progress parsing from stderr."""
        # FFmpeg writes progress to stderr
        process = subprocess.Popen(
            cmd,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            text=True,
            encoding="utf-8",
            errors="replace",
        )

        stderr_lines: list[str] = []
        time_pattern = re.compile(r"time=(\d+):(\d+):(\d+)\.(\d+)")
        speed_pattern = re.compile(r"speed=\s*([\d.]+)x")

        try:
            assert process.stderr is not None
            for line in process.stderr:
                stderr_lines.append(line)
                time_match = time_pattern.search(line)
                speed_match = speed_pattern.search(line)
                
                speed = speed_match.group(1) if speed_match else "0.0"
                
                if time_match:
                    hours, mins, secs, centis = (int(g) for g in time_match.groups())
                    current = hours * 3600 + mins * 60 + secs + centis / 100
                    progress = min(100.0, (current / duration) * 100)
                    
                    eta = "Unknown"
                    spd = float(speed)
                    if spd > 0.0:
                        rem_sec = (duration - current) / spd
                        m, s = divmod(int(rem_sec), 60)
                        eta = f"{m:02d}:{s:02d}"
                        
                    callback(progress, speed, eta)

            process.wait(timeout=timeout)
        except subprocess.TimeoutExpired:
            process.kill()
            raise FFmpegError(f"FFmpeg command timed out: {' '.join(cmd[:5])}...")

        stdout = process.stdout.read() if process.stdout else ""
        stderr = "".join(stderr_lines)

        if process.returncode != 0:
            raise FFmpegError(
                f"FFmpeg failed: {stderr.strip()[-500:]}",
                returncode=process.returncode,
                stderr=stderr,
                cmd=cmd,
            )

        callback(100.0, "0.0", "00:00")
        return subprocess.CompletedProcess(
            args=cmd, returncode=0, stdout=stdout, stderr=stderr
        )
