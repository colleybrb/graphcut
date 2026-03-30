# GraphCut — Local-First Video Automation Editor

GraphCut is a local-first, privacy-respecting video editor aimed at solo creators who want the speed of automation with the power of Python. Built entirely around FFmpeg filtergraphs, it effortlessly merges multiple clips, overlays webcams, mixes audio, syncs transcriptions, and generates burn-in captions natively without waiting for cloud processing.

## Philosophy
* **Local First:** All editing happens offline; no assets or transcripts are sent to a cloud endpoint.
* **Code as Editor:** There are no proprietary bloated binary project formats—project manifests are standard YAML that drives FFmpeg filtergraphs.
* **Automation Ready:** Every GUI/CLI action translates directly to programmable rendering functions, easily integrating into bigger automation suites.
* **Hardware Accelerated:** Automatically detects CPU vs. NVENC (NVIDIA) vs. VideoToolbox (Mac) and uses the best available native hardware acceleration.

## Install

Requires Python 3.11+ and `ffmpeg` / `ffprobe` installed on your local `PATH`.

```bash
# Minimal install
pip install -e .

# Full suite install (incl. local Whisper transcription and scene detection)
pip install -e ".[all]"
```

## Quick Start

```bash
# Initialize a new video project directory
graphcut new-project my-video

# Add media to the project
graphcut add-source my-video clip1.mp4 audiotrack.mp3

# Boot up the local Web GUI editor
graphcut serve my-video
```

## Contributing
GraphCut is licensed under the **Fair Source License**. The codebase is open, freely accessible, and free for any personal, educational, or non-commercial usage indefinitely. See [LICENSE.md](LICENSE.md) for specifics covering corporate/commercial utilization.
