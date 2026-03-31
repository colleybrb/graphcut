export class OverlaysPanel {
    constructor(app) {
        this.app = app;
        this.container = document.getElementById('tab-overlays');
        this._timeout = null;
    }

    render() {
        const proj = this.app.state.project;
        const sources = this.app.state.sources || {};
        if (!proj || !this.container) return;

        const webcam = this.app.state.overlays?.webcam || proj.webcam || null;
        const sticker = this.app.state.overlays?.sticker || proj.sticker || null;
        const captionStyle = this.app.state.overlays?.caption_style || proj.caption_style || {};

        const videoSources = Object.entries(sources)
            .filter(([, info]) => info && info.media_type === 'video')
            .map(([id]) => id);
        const visualSources = Object.entries(sources)
            .filter(([, info]) => info && (info.media_type === 'video' || info.media_type === 'image'))
            .map(([id]) => id);
        const avSources = Object.entries(sources)
            .filter(([, info]) => info && (info.media_type === 'video' || info.media_type === 'audio'))
            .map(([id]) => id);

        const webcamEnabled = Boolean(webcam && webcam.source_id);
        const webcamSourceId = webcam?.source_id || '';
        const webcamPosition = webcam?.position || 'bottom-right';
        const webcamScale = webcam?.scale ?? 0.25;

        const stickerEnabled = Boolean(sticker && (sticker.source_id || sticker.text));
        const stickerMode = sticker?.mode || (visualSources.length > 0 ? 'asset' : 'emoji');
        const stickerText = sticker?.text || '🔥';
        const stickerSourceId = sticker?.source_id || '';
        const stickerPosition = sticker?.position || 'top-right';
        const stickerScale = sticker?.scale ?? 0.18;
        const stickerOpacity = sticker?.opacity ?? 0.95;
        const stickerStart = sticker?.start_time ?? 0;
        const stickerEnd = sticker?.end_time ?? '';

        const narration = proj.narration || '';
        const music = proj.music || '';
        const capStyle = captionStyle?.style || 'clean';
        const capPos = captionStyle?.position || 'bottom';
        const webcamUnavailable = videoSources.length === 0 && !webcamEnabled;

        this.container.innerHTML = `
            <div class="gc-stack">
                <section class="gc-section-card">
                    <div class="gc-eyebrow">Picture In Picture</div>
                    <div class="gc-title-row">
                        <strong class="text-sm text-on-surface">Webcam Overlay</strong>
                        <input type="checkbox" id="webcam-enabled" ${webcamEnabled ? 'checked' : ''} ${webcamUnavailable ? 'disabled' : ''} style="width:20px;height:20px;">
                    </div>
                    <p class="gc-copy" style="margin-top:0.45rem;">
                        ${webcamUnavailable ? 'Add a video source to enable webcam picture-in-picture.' : 'Use any project video as a talking-head or reaction camera layer.'}
                    </p>
                    <div class="gc-setting-card" style="margin-top:0.85rem;">
                        <div class="gc-setting-head">
                            <div>
                                <div class="gc-setting-label">Webcam Source</div>
                                <div class="gc-setting-meta">Choose the clip that should float above the main edit.</div>
                            </div>
                        </div>
                        <select id="webcam-source-select" class="form-control" ${webcamEnabled ? '' : 'disabled'}>
                            <option value="">${videoSources.length > 0 ? 'Choose a video source' : 'No video sources available'}</option>
                            ${videoSources.map((id) => `<option value="${this._escapeAttr(id)}" ${id === webcamSourceId ? 'selected' : ''}>${this._escape(id)}</option>`).join('')}
                        </select>
                    </div>
                    <div class="gc-setting-card">
                        <div class="gc-setting-head">
                            <div>
                                <div class="gc-setting-label">Placement</div>
                                <div class="gc-setting-meta">Move the webcam into a corner or side-by-side layout.</div>
                            </div>
                            <div class="gc-setting-value">${this._labelPos(webcamPosition)}</div>
                        </div>
                        <select id="webcam-position" class="form-control" ${webcamEnabled ? '' : 'disabled'}>
                            ${['bottom-right', 'bottom-left', 'top-right', 'top-left', 'side-by-side'].map((p) => `
                                <option value="${p}" ${p === webcamPosition ? 'selected' : ''}>${this._labelPos(p)}</option>
                            `).join('')}
                        </select>
                        <div style="margin-top:0.8rem;">
                            <div class="gc-setting-meta" style="margin-bottom:0.45rem;">Scale <span id="lbl-webcam-scale">${Number(webcamScale).toFixed(2)}</span></div>
                            <input type="range" id="webcam-scale" min="0.1" max="0.5" step="0.05" value="${webcamScale}" ${webcamEnabled ? '' : 'disabled'}>
                        </div>
                    </div>
                </section>

                <section class="gc-section-card">
                    <div class="gc-eyebrow">Sticker Layer</div>
                    <div class="gc-title-row">
                        <strong class="text-sm text-on-surface">Emoji / GIF / Viral Overlay</strong>
                        <input type="checkbox" id="sticker-enabled" ${stickerEnabled ? 'checked' : ''} style="width:20px;height:20px;">
                    </div>
                    <p class="gc-copy" style="margin-top:0.45rem;">
                        Use emoji-style reactions or imported visual assets as timed overlays. For public clips, import a direct media URL from the library link button or the import button below.
                    </p>

                    <div class="gc-setting-card" style="margin-top:0.85rem;">
                        <div class="gc-setting-head">
                            <div>
                                <div class="gc-setting-label">Overlay Mode</div>
                                <div class="gc-setting-meta">Choose between a text/emoji reaction and a visual sticker asset.</div>
                            </div>
                        </div>
                        <select id="sticker-mode" class="form-control" ${stickerEnabled ? '' : 'disabled'}>
                            <option value="asset" ${stickerMode === 'asset' ? 'selected' : ''}>Asset Overlay</option>
                            <option value="emoji" ${stickerMode === 'emoji' ? 'selected' : ''}>Emoji / Text Reaction</option>
                        </select>
                    </div>

                    <div class="gc-setting-card" id="sticker-asset-wrap">
                        <div class="gc-setting-head">
                            <div>
                                <div class="gc-setting-label">Asset Source</div>
                                <div class="gc-setting-meta">Pick a project video, GIF, or image to float above the edit.</div>
                            </div>
                            <button type="button" id="btn-import-overlay-asset" class="gc-scope-btn">Import URL</button>
                        </div>
                        <select id="sticker-source-select" class="form-control" ${stickerEnabled ? '' : 'disabled'}>
                            <option value="">${visualSources.length > 0 ? 'Choose a visual asset' : 'No visual assets available'}</option>
                            ${visualSources.map((id) => `<option value="${this._escapeAttr(id)}" ${id === stickerSourceId ? 'selected' : ''}>${this._escape(id)}</option>`).join('')}
                        </select>
                    </div>

                    <div class="gc-setting-card" id="sticker-text-wrap">
                        <div class="gc-setting-head">
                            <div>
                                <div class="gc-setting-label">Emoji / Text</div>
                                <div class="gc-setting-meta">Short reactions like "🔥", "LOL", or "wait for it". Emoji rendering can depend on system font support.</div>
                            </div>
                        </div>
                        <input type="text" id="sticker-text" class="form-control" maxlength="24" value="${this._escapeAttr(stickerText)}" ${stickerEnabled ? '' : 'disabled'} placeholder="e.g. 🔥 or WAIT">
                    </div>

                    <div class="gc-setting-card">
                        <div class="gc-setting-head">
                            <div>
                                <div class="gc-setting-label">Placement & Timing</div>
                                <div class="gc-setting-meta">Choose where the sticker sits and when it appears.</div>
                            </div>
                        </div>
                        <select id="sticker-position" class="form-control" ${stickerEnabled ? '' : 'disabled'}>
                            ${['top-right', 'top-left', 'bottom-right', 'bottom-left', 'center', 'top-center', 'bottom-center'].map((p) => `
                                <option value="${p}" ${p === stickerPosition ? 'selected' : ''}>${this._labelPos(p)}</option>
                            `).join('')}
                        </select>
                        <div style="margin-top:0.8rem;">
                            <div class="gc-setting-meta" style="margin-bottom:0.45rem;">Scale <span id="lbl-sticker-scale">${Number(stickerScale).toFixed(2)}</span></div>
                            <input type="range" id="sticker-scale" min="0.08" max="0.45" step="0.01" value="${stickerScale}" ${stickerEnabled ? '' : 'disabled'}>
                        </div>
                        <div style="margin-top:0.8rem;">
                            <div class="gc-setting-meta" style="margin-bottom:0.45rem;">Opacity <span id="lbl-sticker-opacity">${Math.round(Number(stickerOpacity) * 100)}%</span></div>
                            <input type="range" id="sticker-opacity" min="0.2" max="1" step="0.05" value="${stickerOpacity}" ${stickerEnabled ? '' : 'disabled'}>
                        </div>
                        <div class="gc-inline-fields" style="margin-top:0.8rem;">
                            <label class="gc-setting-meta" style="margin:0;">Start</label>
                            <input type="number" id="sticker-start" class="form-control" min="0" step="0.1" value="${stickerStart}" style="width:76px" ${stickerEnabled ? '' : 'disabled'}>
                            <label class="gc-setting-meta" style="margin:0;">End</label>
                            <input type="number" id="sticker-end" class="form-control" min="0" step="0.1" value="${stickerEnd}" style="width:76px" ${stickerEnabled ? '' : 'disabled'} placeholder="optional">
                        </div>
                    </div>
                </section>

                <section class="gc-section-card">
                    <div class="gc-eyebrow">Captions</div>
                    <div class="gc-setting-card" style="margin-top:0.75rem;">
                        <div class="gc-setting-head">
                            <div>
                                <div class="gc-setting-label">Caption Style</div>
                                <div class="gc-setting-meta">Choose a caption look and anchor position.</div>
                            </div>
                        </div>
                        <select id="caption-style" class="form-control">
                            <option value="clean" ${capStyle === 'clean' ? 'selected' : ''}>Clean</option>
                            <option value="social" ${capStyle === 'social' ? 'selected' : ''}>Social</option>
                        </select>
                        <select id="caption-position" class="form-control" style="margin-top:0.7rem;">
                            <option value="bottom" ${capPos === 'bottom' ? 'selected' : ''}>Bottom</option>
                            <option value="top" ${capPos === 'top' ? 'selected' : ''}>Top</option>
                            <option value="center" ${capPos === 'center' ? 'selected' : ''}>Center</option>
                        </select>
                    </div>
                </section>

                <section class="gc-section-card">
                    <div class="gc-eyebrow">Audio Roles</div>
                    <div class="gc-setting-card" style="margin-top:0.75rem;">
                        <div class="gc-setting-head">
                            <div>
                                <div class="gc-setting-label">Narration & Music Sources</div>
                                <div class="gc-setting-meta">Assign project assets so the audio mixer knows what should behave like dialogue vs. background music.</div>
                            </div>
                        </div>
                        <select id="role-narration" class="form-control">
                            <option value="">Narration: None</option>
                            ${avSources.map((id) => `<option value="${this._escapeAttr(id)}" ${id === narration ? 'selected' : ''}>Narration: ${this._escape(id)}</option>`).join('')}
                        </select>
                        <select id="role-music" class="form-control" style="margin-top:0.7rem;">
                            <option value="">Music: None</option>
                            ${avSources.map((id) => `<option value="${this._escapeAttr(id)}" ${id === music ? 'selected' : ''}>Music: ${this._escape(id)}</option>`).join('')}
                        </select>
                    </div>
                </section>
            </div>
        `;

        this.bindEvents();
    }

    bindEvents() {
        if (!this.container) return;

        const debounce = (fn) => {
            clearTimeout(this._timeout);
            this._timeout = setTimeout(fn, 250);
        };

        const videoSources = Object.entries(this.app.state.sources || {})
            .filter(([, info]) => info && info.media_type === 'video')
            .map(([id]) => id);
        const visualSources = Object.entries(this.app.state.sources || {})
            .filter(([, info]) => info && (info.media_type === 'video' || info.media_type === 'image'))
            .map(([id]) => id);

        const webcamEnabledEl = this.container.querySelector('#webcam-enabled');
        const srcEl = this.container.querySelector('#webcam-source-select');
        const posEl = this.container.querySelector('#webcam-position');
        const scaleEl = this.container.querySelector('#webcam-scale');
        const scaleLbl = this.container.querySelector('#lbl-webcam-scale');

        const setWebcamEnabled = (on) => {
            if (srcEl) srcEl.disabled = !on;
            if (posEl) posEl.disabled = !on;
            if (scaleEl) scaleEl.disabled = !on;
        };

        const chooseDefaultWebcamSource = () => {
            const activeClip = Number.isInteger(this.app.state.activeClipIndex)
                ? this.app.state.clips?.[this.app.state.activeClipIndex]
                : null;
            if (activeClip?.source_id && videoSources.includes(activeClip.source_id)) {
                return activeClip.source_id;
            }
            return videoSources[0] || '';
        };

        const applyWebcam = () => {
            debounce(async () => {
                try {
                    await this._applyWebcam();
                    this.app.setStatus('Webcam overlay updated', 1800);
                } catch (err) {
                    alert(err.message || 'Failed to update webcam overlay.');
                }
            });
        };

        webcamEnabledEl?.addEventListener('change', async (e) => {
            const on = e.target.checked;
            setWebcamEnabled(on);
            if (!on) {
                debounce(async () => {
                    try {
                        await this.app.api.deleteWebcam();
                        await this.app.refreshState();
                    } catch (err) {
                        alert(err.message || 'Failed to disable webcam overlay.');
                    }
                });
                return;
            }
            if (srcEl && !srcEl.value) {
                const fallback = chooseDefaultWebcamSource();
                if (!fallback) {
                    e.target.checked = false;
                    setWebcamEnabled(false);
                    alert('Add a video source before enabling the webcam overlay.');
                    return;
                }
                srcEl.value = fallback;
            }
            applyWebcam();
        });

        srcEl?.addEventListener('change', applyWebcam);
        posEl?.addEventListener('change', applyWebcam);
        scaleEl?.addEventListener('input', (e) => {
            if (scaleLbl) scaleLbl.textContent = Number(e.target.value).toFixed(2);
            applyWebcam();
        });

        const stickerEnabledEl = this.container.querySelector('#sticker-enabled');
        const stickerModeEl = this.container.querySelector('#sticker-mode');
        const stickerSourceEl = this.container.querySelector('#sticker-source-select');
        const stickerTextEl = this.container.querySelector('#sticker-text');
        const stickerPosEl = this.container.querySelector('#sticker-position');
        const stickerScaleEl = this.container.querySelector('#sticker-scale');
        const stickerOpacityEl = this.container.querySelector('#sticker-opacity');
        const stickerStartEl = this.container.querySelector('#sticker-start');
        const stickerEndEl = this.container.querySelector('#sticker-end');
        const stickerScaleLbl = this.container.querySelector('#lbl-sticker-scale');
        const stickerOpacityLbl = this.container.querySelector('#lbl-sticker-opacity');
        const stickerAssetWrap = this.container.querySelector('#sticker-asset-wrap');
        const stickerTextWrap = this.container.querySelector('#sticker-text-wrap');

        const setStickerEnabled = (on) => {
            [
                stickerModeEl,
                stickerSourceEl,
                stickerTextEl,
                stickerPosEl,
                stickerScaleEl,
                stickerOpacityEl,
                stickerStartEl,
                stickerEndEl
            ].forEach((node) => {
                if (node) node.disabled = !on;
            });
        };

        const syncStickerUi = () => {
            const mode = stickerModeEl?.value || 'asset';
            if (stickerAssetWrap) stickerAssetWrap.style.display = mode === 'asset' ? 'block' : 'none';
            if (stickerTextWrap) stickerTextWrap.style.display = mode === 'emoji' ? 'block' : 'none';
            if (stickerScaleLbl && stickerScaleEl) {
                stickerScaleLbl.textContent = Number(stickerScaleEl.value).toFixed(2);
            }
            if (stickerOpacityLbl && stickerOpacityEl) {
                stickerOpacityLbl.textContent = `${Math.round(Number(stickerOpacityEl.value) * 100)}%`;
            }
        };

        const chooseDefaultStickerSource = () => {
            const activeClip = Number.isInteger(this.app.state.activeClipIndex)
                ? this.app.state.clips?.[this.app.state.activeClipIndex]
                : null;
            if (activeClip?.source_id && visualSources.includes(activeClip.source_id)) {
                return activeClip.source_id;
            }
            return visualSources[0] || '';
        };

        const applySticker = () => {
            debounce(async () => {
                try {
                    await this._applySticker();
                    this.app.setStatus('Sticker overlay updated', 1800);
                } catch (err) {
                    alert(err.message || 'Failed to update sticker overlay.');
                }
            });
        };

        stickerEnabledEl?.addEventListener('change', async (e) => {
            const on = e.target.checked;
            setStickerEnabled(on);
            if (!on) {
                debounce(async () => {
                    try {
                        await this.app.api.deleteSticker();
                        await this.app.refreshState();
                    } catch (err) {
                        alert(err.message || 'Failed to disable sticker overlay.');
                    }
                });
                return;
            }
            if (stickerModeEl?.value === 'asset' && stickerSourceEl && !stickerSourceEl.value) {
                stickerSourceEl.value = chooseDefaultStickerSource();
            }
            if (stickerModeEl?.value === 'emoji' && stickerTextEl && !stickerTextEl.value.trim()) {
                stickerTextEl.value = '🔥';
            }
            syncStickerUi();
            applySticker();
        });

        stickerModeEl?.addEventListener('change', () => {
            if (stickerModeEl.value === 'asset' && stickerSourceEl && !stickerSourceEl.value) {
                stickerSourceEl.value = chooseDefaultStickerSource();
            }
            if (stickerModeEl.value === 'emoji' && stickerTextEl && !stickerTextEl.value.trim()) {
                stickerTextEl.value = '🔥';
            }
            syncStickerUi();
            applySticker();
        });

        [stickerSourceEl, stickerPosEl, stickerStartEl, stickerEndEl].forEach((node) => {
            node?.addEventListener('change', () => {
                syncStickerUi();
                applySticker();
            });
        });
        stickerTextEl?.addEventListener('input', applySticker);
        stickerScaleEl?.addEventListener('input', () => {
            syncStickerUi();
            applySticker();
        });
        stickerOpacityEl?.addEventListener('input', () => {
            syncStickerUi();
            applySticker();
        });

        this.container.querySelector('#btn-import-overlay-asset')?.addEventListener('click', async () => {
            const imported = await this.app.components?.sources?.promptImportUrl?.();
            if (!imported?.source_id) return;
            if (stickerEnabledEl) stickerEnabledEl.checked = true;
            setStickerEnabled(true);
            if (stickerModeEl) stickerModeEl.value = 'asset';
            if (stickerSourceEl) stickerSourceEl.value = imported.source_id;
            syncStickerUi();
            applySticker();
        });

        syncStickerUi();
        setStickerEnabled(Boolean(stickerEnabledEl?.checked));

        const capStyleEl = this.container.querySelector('#caption-style');
        const capPosEl = this.container.querySelector('#caption-position');
        const updateCaptions = () => {
            const style = capStyleEl?.value || 'clean';
            const position = capPosEl?.value || 'bottom';
            const current = this.app.state.overlays?.caption_style || this.app.state.project?.caption_style || {};
            return {
                ...current,
                style,
                position
            };
        };
        capStyleEl?.addEventListener('change', () => {
            debounce(async () => {
                try {
                    await this.app.api.updateCaptionStyle(updateCaptions());
                    await this.app.refreshState();
                } catch (err) {
                    alert(err.message || 'Failed to update caption style.');
                }
            });
        });
        capPosEl?.addEventListener('change', () => {
            debounce(async () => {
                try {
                    await this.app.api.updateCaptionStyle(updateCaptions());
                    await this.app.refreshState();
                } catch (err) {
                    alert(err.message || 'Failed to update caption position.');
                }
            });
        });

        const narrEl = this.container.querySelector('#role-narration');
        const musicEl = this.container.querySelector('#role-music');
        const updateRoles = () => ({
            narration: narrEl?.value || null,
            music: musicEl?.value || null
        });
        const rolesHandler = () => {
            debounce(async () => {
                try {
                    await this.app.api.setRoles(updateRoles());
                    await this.app.refreshState();
                } catch (err) {
                    alert(err.message || 'Failed to update roles.');
                }
            });
        };
        narrEl?.addEventListener('change', rolesHandler);
        musicEl?.addEventListener('change', rolesHandler);
    }

    async _applyWebcam() {
        const enabled = Boolean(this.container.querySelector('#webcam-enabled')?.checked);
        if (!enabled) return;

        const sourceId = this.container.querySelector('#webcam-source-select')?.value || '';
        if (!sourceId) {
            throw new Error('Choose a video source for the webcam overlay.');
        }

        const payload = {
            source_id: sourceId,
            position: this.container.querySelector('#webcam-position')?.value || 'bottom-right',
            scale: parseFloat(this.container.querySelector('#webcam-scale')?.value || '0.25'),
            border_width: 2,
            border_color: 'white',
            corner_radius: 0
        };
        await this.app.api.updateWebcam(payload);
        await this.app.refreshState();
    }

    async _applySticker() {
        const enabled = Boolean(this.container.querySelector('#sticker-enabled')?.checked);
        if (!enabled) return;

        const mode = this.container.querySelector('#sticker-mode')?.value || 'asset';
        const basePayload = {
            mode,
            position: this.container.querySelector('#sticker-position')?.value || 'top-right',
            scale: parseFloat(this.container.querySelector('#sticker-scale')?.value || '0.18'),
            opacity: parseFloat(this.container.querySelector('#sticker-opacity')?.value || '0.95'),
            start_time: parseFloat(this.container.querySelector('#sticker-start')?.value || '0'),
            end_time: this.container.querySelector('#sticker-end')?.value
                ? parseFloat(this.container.querySelector('#sticker-end')?.value)
                : null
        };

        let payload = basePayload;
        if (mode === 'emoji') {
            const text = this.container.querySelector('#sticker-text')?.value || '';
            payload = { ...basePayload, text, source_id: null };
        } else {
            const sourceId = this.container.querySelector('#sticker-source-select')?.value || '';
            if (!sourceId) {
                throw new Error('Choose a visual source for the sticker overlay.');
            }
            payload = { ...basePayload, source_id: sourceId, text: null };
        }

        await this.app.api.updateSticker(payload);
        await this.app.refreshState();
    }

    _labelPos(value) {
        const labels = {
            'bottom-right': 'Bottom Right',
            'bottom-left': 'Bottom Left',
            'top-right': 'Top Right',
            'top-left': 'Top Left',
            'side-by-side': 'Side By Side',
            'center': 'Center',
            'top-center': 'Top Center',
            'bottom-center': 'Bottom Center'
        };
        return labels[value] || value;
    }

    _escape(value) {
        return String(value).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
    }

    _escapeAttr(value) {
        return String(value).replaceAll('"', '&quot;');
    }
}
