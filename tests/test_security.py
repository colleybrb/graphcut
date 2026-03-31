"""Security regression tests for path handling and local API boundaries."""

from io import BytesIO
from pathlib import Path
from types import SimpleNamespace

import anyio
from fastapi import HTTPException, UploadFile

from graphcut.api import _resolve_within, _validate_remote_import_url, upload_source
from graphcut.exporter import Exporter
from graphcut.models import ExportPreset, MediaInfo, ProjectManifest
from graphcut.project_manager import ProjectManager


def _init_project(project_dir: Path) -> None:
    project_dir.mkdir(parents=True, exist_ok=True)
    (project_dir / "build").mkdir(exist_ok=True)
    ProjectManifest(name="demo").save_yaml(project_dir / "project.yaml")


def test_upload_source_sanitizes_filename_and_stays_in_media_dir(tmp_path: Path, monkeypatch):
    """Uploads should not be able to escape the project media directory."""
    project_dir = tmp_path / "project"
    _init_project(project_dir)

    def fake_probe(file_path: Path) -> MediaInfo:
        return MediaInfo(file_path=file_path, media_type="video")

    monkeypatch.setattr("graphcut.project_manager.probe_file", fake_probe)
    request = SimpleNamespace(app=SimpleNamespace(state=SimpleNamespace(project_dir=project_dir)))
    upload = UploadFile(
        filename="../../escape.mp4",
        file=BytesIO(b"demo-bytes"),
    )
    payload = anyio.run(upload_source, request, upload)

    assert payload["filename"] == "escape.mp4"
    assert (project_dir / "media" / "escape.mp4").exists()
    assert not (tmp_path / "escape.mp4").exists()


def test_remote_import_blocks_loopback_hosts():
    """Remote URL imports should reject localhost/loopback destinations."""
    try:
        _validate_remote_import_url("http://127.0.0.1/test.mp4")
    except HTTPException as exc:
        assert exc.status_code == 403
    else:
        raise AssertionError("Loopback import URL should have been rejected")


def test_resolve_within_blocks_parent_traversal(tmp_path: Path):
    """Scoped path resolution should reject parent directory traversal."""
    root = tmp_path / "build"
    root.mkdir()

    try:
        _resolve_within(root, "../../project.yaml", "blocked")
    except HTTPException as exc:
        assert exc.status_code == 403
    else:
        raise AssertionError("Parent traversal should have been rejected")


def test_export_filename_is_sanitized():
    """Export filenames should not inherit path separators from project metadata."""
    manifest = ProjectManifest(name="../../demo project")
    preset = ExportPreset(name="../shorts", aspect_ratio="9:16", width=1080, height=1920)

    assert Exporter.build_output_filename(manifest, preset) == "demo_project_shorts.mp4"


def test_project_manager_normalizes_source_ids(tmp_path: Path, monkeypatch):
    """Source IDs derived from user input should be normalized before storage."""
    media_path = tmp_path / "demo clip.mp4"
    media_path.write_bytes(b"video")
    manifest = ProjectManifest(name="demo")

    def fake_probe(file_path: Path) -> MediaInfo:
        return MediaInfo(file_path=file_path, media_type="video")

    monkeypatch.setattr("graphcut.project_manager.probe_file", fake_probe)

    source_id = ProjectManager.add_source(manifest, media_path, source_id='"><img src=x onerror=1>')

    assert source_id == "img_src_x_onerror_1"
    assert source_id in manifest.sources
