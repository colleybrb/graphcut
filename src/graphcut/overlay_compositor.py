"""Overlay compositing for webcams, watermarks, and titles."""

from __future__ import annotations

import logging

from graphcut.filtergraph import FilterGraph, FilterNode
from graphcut.models import StickerOverlay, WebcamOverlay

logger = logging.getLogger(__name__)


class OverlayCompositor:
    """Manages visual overlay layers on the main video track."""

    def __init__(self) -> None:
        pass

    def add_webcam_overlay(
        self,
        fg: FilterGraph,
        base_label: str,
        webcam_input_idx: int,
        config: WebcamOverlay,
        base_width: int,
        base_height: int,
    ) -> str:
        """Add a scaled, positioned webcam picture-in-picture stream."""
        # 1. Scale
        target_w = int(base_width * config.scale)
        # Assuming 16:9 for the webcam for calculation height proxy if unknown
        # The filter will keep aspect ratio correctly if we just scale to width and -1 height
        scaled_label = fg._next_v_label()
        fg.nodes.append(FilterNode(
            filter_name="scale",
            inputs=[f"{webcam_input_idx}:v"],
            outputs=[scaled_label],
            params={"w": target_w, "h": -1}
        ))

        active_overlay_lbl = scaled_label

        # 2. Add Border if configured (pad filter)
        if config.border_width > 0:
            bordered_label = fg._next_v_label()
            bw = config.border_width
            fg.nodes.append(FilterNode(
                filter_name="pad",
                inputs=[active_overlay_lbl],
                outputs=[bordered_label],
                # iw+2*border, ih+2*border, x=border, y=border
                params={
                    "w": f"iw+{bw*2}", 
                    "h": f"ih+{bw*2}",
                    "x": str(bw),
                    "y": str(bw),
                    "color": config.border_color
                }
            ))
            active_overlay_lbl = bordered_label

        # 3. Calculate positioning mapping
        # Let W, H = base width, height via "main_w", "main_h" evaluated inside FFmpeg
        # Let w, h = overlay width, height via "overlay_w", "overlay_h"
        x_pos, y_pos = self._overlay_position(config.position, margin=20)
        
        # 4. Apply Overlay
        return fg.overlay(
            base_label=base_label,
            overlay_label=active_overlay_lbl,
            x=x_pos,
            y=y_pos
        )

    def add_sticker_overlay(
        self,
        fg: FilterGraph,
        base_label: str,
        sticker_input_idx: int,
        config: StickerOverlay,
        base_width: int,
    ) -> str:
        """Add a scaled asset overlay such as a GIF, PNG, or viral cutaway."""
        target_w = max(80, int(base_width * config.scale))
        scaled_label = fg.scale(f"{sticker_input_idx}:v", width=target_w, height=-1)
        active_label = scaled_label

        if config.opacity < 0.99:
            rgba_label = fg._next_v_label()
            fg.nodes.append(
                FilterNode(
                    filter_name="format",
                    inputs=[active_label],
                    outputs=[rgba_label],
                    params={"pix_fmts": "rgba"},
                )
            )
            alpha_label = fg._next_v_label()
            fg.nodes.append(
                FilterNode(
                    filter_name="colorchannelmixer",
                    inputs=[rgba_label],
                    outputs=[alpha_label],
                    params={"aa": f"{max(0.05, min(1.0, config.opacity)):.2f}"},
                )
            )
            active_label = alpha_label

        x_pos, y_pos = self._overlay_position(config.position, margin=24)
        enable = self._time_enable(config.start_time, config.end_time)
        return fg.overlay(
            base_label=base_label,
            overlay_label=active_label,
            x=x_pos,
            y=y_pos,
            enable=enable,
        )

    def add_emoji_overlay(
        self,
        fg: FilterGraph,
        base_label: str,
        config: StickerOverlay,
        base_width: int,
        base_height: int,
    ) -> str:
        """Add a timed drawtext overlay for emoji or short text reactions."""
        out_lbl = fg._next_v_label()
        fontsize = max(54, int(min(base_width, base_height) * max(0.08, config.scale)))
        x_pos, y_pos = self._text_position(config.position, margin=48)
        enable = self._time_enable(config.start_time, config.end_time)
        text = self._escape_drawtext_text(config.text or "")

        fg.nodes.append(
            FilterNode(
                filter_name="drawtext",
                inputs=[base_label],
                outputs=[out_lbl],
                params={
                    "text": f"'{text}'",
                    "fontsize": str(fontsize),
                    "fontcolor": f"white@{max(0.1, min(1.0, config.opacity)):.2f}",
                    "x": x_pos,
                    "y": y_pos,
                    "borderw": "6",
                    "bordercolor": "black@0.35",
                    "shadowcolor": "black@0.25",
                    "shadowx": "3",
                    "shadowy": "3",
                    "enable": enable,
                },
            )
        )
        return out_lbl

    def add_watermark(
        self,
        fg: FilterGraph,
        base_label: str,
        watermark_input_idx: int,
        position: str = "bottom-right",
        opacity: float = 0.5,
        scale: float = 0.1,
    ) -> str:
        """Add a static logo/watermark overlay."""
        # Note: Opacity requires format=rgba,colorchannelmixer=aa=opacity
        alpha_lbl = fg._next_v_label()
        
        # Scale and set opacity
        fg.nodes.append(FilterNode(
            filter_name=f"scale=iw*{scale}:-1,format=rgba,colorchannelmixer=aa={opacity}",
            inputs=[f"{watermark_input_idx}:v"],
            outputs=[alpha_lbl]
        ))

        margin = 10
        pos_rules = {
            "bottom-right": (f"main_w-overlay_w-{margin}", f"main_h-overlay_h-{margin}"),
            "bottom-left": (str(margin), f"main_h-overlay_h-{margin}"),
            "top-right": (f"main_w-overlay_w-{margin}", str(margin)),
            "top-left": (str(margin), str(margin)),
        }
        x_pos, y_pos = pos_rules.get(position, pos_rules["bottom-right"])

        return fg.overlay(base_label, alpha_lbl, x_pos, y_pos)

    def add_title_card(
        self,
        fg: FilterGraph,
        title_input_idx: int,
        duration: float = 3.0,
        fade_duration: float = 0.5,
    ) -> tuple[str, str]:
        """Create a fading title card block replacing the intro."""
        # This returns an independent stream of V and A to be concatenated at the front 
        # But for simplification within GraphCut rendering rules, we simulate an `overlay` 
        # on the main stream restricted by time using `enable='between(t,0,duration)'`.
        
        # We will assume Title Cards are just text elements or images faded over the start of the timeline.
        # So we fade out the title card overlay output cleanly.
        
        faded_lbl = fg._next_v_label()
        fg.nodes.append(FilterNode(
            filter_name=f"fade=t=out:st={duration - fade_duration}:d={fade_duration}",
            inputs=[f"{title_input_idx}:v"],
            outputs=[faded_lbl]
        ))
        
        return faded_lbl, "0:a" # Proxy response

    def add_lower_third(
        self,
        fg: FilterGraph,
        base_label: str,
        text: str,
        duration: float = 5.0,
        position: str = "bottom"
    ) -> str:
        """Use drawtext to render dynamic lower third text."""
        out_lbl = fg._next_v_label()
        
        y_pos = "h-100" if position == "bottom" else "100"
        
        fg.nodes.append(FilterNode(
            filter_name="drawtext",
            inputs=[base_label],
            outputs=[out_lbl],
            params={
                "text": f"'{text}'",
                "fontsize": "48",
                "fontcolor": "white",
                "box": "1",
                "boxcolor": "black@0.6",
                "boxborderw": "10",
                "x": "100",
                "y": y_pos,
                "enable": f"between(t,0,{duration})"
            }
        ))
        return out_lbl

    def _overlay_position(self, position: str, margin: int = 20) -> tuple[str, str]:
        pos_rules = {
            "bottom-right": (f"main_w-overlay_w-{margin}", f"main_h-overlay_h-{margin}"),
            "bottom-left": (str(margin), f"main_h-overlay_h-{margin}"),
            "top-right": (f"main_w-overlay_w-{margin}", str(margin)),
            "top-left": (str(margin), str(margin)),
            "center": ("(main_w-overlay_w)/2", "(main_h-overlay_h)/2"),
            "top-center": ("(main_w-overlay_w)/2", str(margin)),
            "bottom-center": ("(main_w-overlay_w)/2", f"main_h-overlay_h-{margin}"),
            "side-by-side": ("0", "(main_h-overlay_h)/2"),
        }
        return pos_rules.get(position, pos_rules["bottom-right"])

    def _text_position(self, position: str, margin: int = 40) -> tuple[str, str]:
        pos_rules = {
            "bottom-right": (f"w-text_w-{margin}", f"h-text_h-{margin}"),
            "bottom-left": (str(margin), f"h-text_h-{margin}"),
            "top-right": (f"w-text_w-{margin}", str(margin)),
            "top-left": (str(margin), str(margin)),
            "center": ("(w-text_w)/2", "(h-text_h)/2"),
            "top-center": ("(w-text_w)/2", str(margin)),
            "bottom-center": ("(w-text_w)/2", f"h-text_h-{margin}"),
        }
        return pos_rules.get(position, pos_rules["top-right"])

    def _time_enable(self, start_time: float, end_time: float | None) -> str:
        start = max(0.0, float(start_time or 0.0))
        if end_time is None:
            return f"gte(t,{start:.3f})"
        end = max(start, float(end_time))
        return f"between(t,{start:.3f},{end:.3f})"

    def _escape_drawtext_text(self, value: str) -> str:
        return (
            str(value)
            .replace("\\", r"\\")
            .replace(":", r"\:")
            .replace("'", r"\'")
            .replace("%", r"\%")
            .replace("[", r"\[")
            .replace("]", r"\]")
        )
