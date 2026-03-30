# QuickCut — Local-First Video Editor

A local-first Python video editor for solo creators. Merge clips, record narration, add webcam overlays, auto-generate captions, and export polished videos for YouTube, Shorts, Reels, TikTok, and podcast clips.

## Install

```bash
pip install -e .
```

With all optional features:
```bash
pip install -e ".[all]"
```

## Quick Start

```bash
# Create a new project
quickcut new-project my-video

# Add source files
quickcut add-source my-video clip1.mp4 clip2.mp4

# Inspect media metadata
quickcut inspect-media clip1.mp4
```

## Requirements

- Python 3.11+
- FFmpeg installed and in PATH
