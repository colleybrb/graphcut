<!-- GSD:project-start source:PROJECT.md -->
## Project

**QuickCut — Local-First Video Editor**

A local-first Python video editor built for a solo creator who needs to quickly merge multiple clips, record narration over them, add webcam overlays, auto-generate captions, and export polished videos for YouTube, Shorts, Reels, TikTok, and podcast clips. It's automation-first — not a Premiere/Final Cut clone — with a CLI backbone and a GUI editor built on top.

**Core Value:** Given raw clips and a voice-over, produce a polished, captioned, multi-format video with one command — and re-render it from a saved project file anytime.

### Constraints

- **Render backend**: FFmpeg filtergraphs for all heavy video/audio processing — no slow Python frame loops
- **Transcription**: faster-whisper with word-level timestamps, local models only for core workflow
- **Source media**: Always preserved immutable — outputs go to project build directory
- **Reproducibility**: Every edit saved to project manifest — no hidden UI-only state
- **Cross-platform**: macOS, Windows, Linux — graceful GPU fallback to CPU
<!-- GSD:project-end -->

<!-- GSD:stack-start source:research/STACK.md -->
## Technology Stack

## Core Rendering — FFmpeg
- Confidence: ★★★★★
| Library | Pros | Cons |
|---------|------|------|
| `ffmpeg-python` (kkroening) | Mature, widely used, fluent API | No type hints, maintenance slow |
| `typed-ffmpeg` | Modern, type-safe, IDE autocomplete, visual playground | Newer, smaller community |
| Raw `subprocess` | Full control, no wrapper bugs | More boilerplate |
- Use `-filter_complex` for all multi-stream operations — cannot mix with `-vf`/`-af`
- `loudnorm` requires **two passes** for best quality (analysis + normalization)
- Use `ffmpeg-normalize` library for the two-pass loudnorm automation
- Use `-c copy` (stream copy) wherever possible to avoid unnecessary re-encoding
- Hardware acceleration: `h264_nvenc` (NVIDIA), `h264_videotoolbox` (macOS), `h264_qsv` (Intel)
## Thin Orchestration — MoviePy v2
- Confidence: ★★★★☆
- `moviepy.editor` → removed. Import from `moviepy` directly
- `set_*()` → `with_*()` (out-of-place, returns copy)
- Effects are now classes: `clip.with_effects([Resize(width=200)])`
- `TextClip` now requires explicit font path
- Methods renamed: `resize()` → `resized()`, `crop()` → `cropped()`
- Quick clip composition/concatenation during development
- Prototype-level compositing where FFmpeg filtergraph would be overly complex
- Final export rendering (too slow — delegates to FFmpeg anyway)
- TextClip rendering in production (notoriously slow per-frame)
- Anything where `-c copy` or FFmpeg filtergraph would be faster
## Transcription — faster-whisper
- Confidence: ★★★★★
| Feature | Implementation |
|---------|---------------|
| Word timestamps | `model.transcribe(audio, word_timestamps=True)` |
| VAD filtering | `vad_filter=True` (built-in Silero VAD) |
| GPU | `device="cuda"`, `compute_type="float16"` |
| CPU | `compute_type="int8"` for speed/memory |
| Models | `large-v3` for quality, `base`/`small` for speed |
- Default model: `medium` (good quality/speed balance for personal use)
- Always cache transcripts with source file hash
- VAD enabled by default for speech region detection
- Consider WhisperX if speaker diarization needed later (uses faster-whisper as backend)
## Scene Detection — PySceneDetect
- Confidence: ★★★★★
- `ContentDetector`: Fast cuts, fixed threshold, general purpose
- `AdaptiveDetector`: Rolling average, better for camera movement/motion
- Requires Python 3.10+
- Install with `pip install scenedetect[opencv]`
- FFmpeg must be in PATH for video splitting
## Audio Normalization — ffmpeg-normalize
- Confidence: ★★★★★
- Default: -23 LUFS target
- Built-in presets: `--preset podcast` (-16 LUFS), `--preset streaming-video`
- Python API available for programmatic use
- Handles video passthrough (normalizes audio, copies video)
## GUI Framework
- Confidence: ★★★★☆
| Option | Pros | Cons |
|--------|------|------|
| Web UI (Python server) | Cross-platform for free, rich text/transcript UI, rapid iteration | Needs browser, less "native" feel |
| PySide6 (Qt) | Native feel, professional | Complex, steep learning curve, heavy dependency |
| Electron + Python | Full Chromium, rich ecosystem | Huge bundle (>100MB), Node.js bridge |
| Tauri + Python | Lightweight, secure | Requires Rust, Python bridge complexity |
| WebUI library | Uses system browser, lightweight | Less mature distribution tooling |
## Package Management
- Python 3.11+
- Pydantic v2 for models/config
- Click or Typer for CLI
- pytest for testing
## What NOT to Use
| Tool | Why Not |
|------|---------|
| PyAV for rendering | FFmpeg does it better, PyAV adds frame-loop overhead |
| MoviePy TextClip in production | Per-frame rendering is slow; use FFmpeg `drawtext` or `subtitles` filter |
| OpenCV for video editing | Wrong tool — it's for computer vision, not video production |
| Cloud transcription APIs | Violates local-first constraint |
| Tkinter | Too primitive for transcript-based editor UI |
<!-- GSD:stack-end -->

<!-- GSD:conventions-start source:CONVENTIONS.md -->
## Conventions

Conventions not yet established. Will populate as patterns emerge during development.
<!-- GSD:conventions-end -->

<!-- GSD:architecture-start source:ARCHITECTURE.md -->
## Architecture

Architecture not yet mapped. Follow existing patterns found in the codebase.
<!-- GSD:architecture-end -->

<!-- GSD:workflow-start source:GSD defaults -->
## GSD Workflow Enforcement

Before using Edit, Write, or other file-changing tools, start work through a GSD command so planning artifacts and execution context stay in sync.

Use these entry points:
- `/gsd-quick` for small fixes, doc updates, and ad-hoc tasks
- `/gsd-debug` for investigation and bug fixing
- `/gsd-execute-phase` for planned phase work

Do not make direct repo edits outside a GSD workflow unless the user explicitly asks to bypass it.
<!-- GSD:workflow-end -->



<!-- GSD:profile-start -->
## Developer Profile

> Profile not yet configured. Run `/gsd-profile-user` to generate your developer profile.
> This section is managed by `generate-claude-profile` -- do not edit manually.
<!-- GSD:profile-end -->
