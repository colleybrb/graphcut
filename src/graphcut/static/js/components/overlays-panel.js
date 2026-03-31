export class OverlaysPanel {
    constructor(app) {
        this.app = app;
        this.container = document.getElementById('tab-overlays');
        this._timeout = null;
    }

    render() {
        const proj = this.app.state.project;
        const sources = this.app.state.sources || {};
        if (!proj) return;

        const webcam = this.app.state.overlays?.webcam || null;
        const captionStyle = this.app.state.overlays?.caption_style || proj.caption_style || {};

        const videoSources = Object.entries(sources)
            .filter(([, info]) => info && info.media_type === 'video')
            .map(([id]) => id);
        const avSources = Object.entries(sources)
            .filter(([, info]) => info && (info.media_type === 'video' || info.media_type === 'audio'))
            .map(([id]) => id);

        const webcamEnabled = Boolean(webcam && webcam.source_id);
        const webcamSourceId = webcam?.source_id || '';
        const webcamPosition = webcam?.position || 'bottom-right';
        const webcamScale = webcam?.scale ?? 0.25;

        const narration = proj.narration || '';
        const music = proj.music || '';

        const capStyle = captionStyle?.style || 'clean';
        const capPos = captionStyle?.position || 'bottom';
        const webcamUnavailable = videoSources.length === 0 && !webcamEnabled;

        this.container.innerHTML = `
            <div class="form-group" style="flex-direction:row;align-items:center;justify-content:space-between">
                <label style="margin:0">Webcam Overlay</label>
                <input type="checkbox" id="webcam-enabled" ${webcamEnabled ? 'checked' : ''} ${webcamUnavailable ? 'disabled' : ''} style="width:20px;height:20px;">
            </div>
            ${webcamUnavailable ? '<div style="margin-top:-8px;color:var(--text-muted);font-size:0.8rem;">Add a video source to enable webcam picture-in-picture.</div>' : ''}

            <div class="form-group">
                <label>Webcam Source</label>
                <select id="webcam-source-select" class="form-control" ${webcamEnabled ? '' : 'disabled'}>
                    <option value="">${videoSources.length > 0 ? 'Choose a video source' : 'No video sources available'}</option>
                    ${videoSources.map(id => `<option value="${this._escapeAttr(id)}" ${id === webcamSourceId ? 'selected' : ''}>${this._escape(id)}</option>`).join('')}
                </select>
            </div>
            <div class="form-group">
                <label>Position</label>
                <select id="webcam-position" class="form-control" ${webcamEnabled ? '' : 'disabled'}>
                    ${['bottom-right','bottom-left','top-right','top-left','side-by-side'].map(p => `<option value="${p}" ${p===webcamPosition?'selected':''}>${this._labelPos(p)}</option>`).join('')}
                </select>
            </div>
            <div class="form-group">
                <label>Scale factor (<span id="lbl-webcam-scale">${Number(webcamScale).toFixed(2)}</span>)</label>
                <input type="range" id="webcam-scale" min="0.1" max="0.5" step="0.05" value="${webcamScale}" ${webcamEnabled ? '' : 'disabled'}>
            </div>

            <hr style="border:none;border-top:1px solid var(--border-color);margin: 10px 0;">

            <div class="form-group">
                <label>Captions</label>
                <select id="caption-style" class="form-control">
                    <option value="clean" ${capStyle === 'clean' ? 'selected' : ''}>Clean</option>
                    <option value="social" ${capStyle === 'social' ? 'selected' : ''}>Social</option>
                </select>
            </div>
            <div class="form-group">
                <label>Caption Position</label>
                <select id="caption-position" class="form-control">
                    <option value="bottom" ${capPos === 'bottom' ? 'selected' : ''}>Bottom</option>
                    <option value="top" ${capPos === 'top' ? 'selected' : ''}>Top</option>
                    <option value="center" ${capPos === 'center' ? 'selected' : ''}>Center</option>
                </select>
            </div>

            <hr style="border:none;border-top:1px solid var(--border-color);margin: 10px 0;">

            <div class="form-group">
                <label>Narration Source</label>
                <select id="role-narration" class="form-control">
                    <option value="">None</option>
                    ${avSources.map(id => `<option value="${this._escapeAttr(id)}" ${id === narration ? 'selected' : ''}>${this._escape(id)}</option>`).join('')}
                </select>
            </div>
            <div class="form-group">
                <label>Music Source</label>
                <select id="role-music" class="form-control">
                    <option value="">None</option>
                    ${avSources.map(id => `<option value="${this._escapeAttr(id)}" ${id === music ? 'selected' : ''}>${this._escape(id)}</option>`).join('')}
                </select>
            </div>
        `;

        this.bindEvents();
    }

    bindEvents() {
        const debounce = (fn) => {
            clearTimeout(this._timeout);
            this._timeout = setTimeout(fn, 250);
        };

        const enabledEl = this.container.querySelector('#webcam-enabled');
        const srcEl = this.container.querySelector('#webcam-source-select');
        const posEl = this.container.querySelector('#webcam-position');
        const scaleEl = this.container.querySelector('#webcam-scale');
        const scaleLbl = this.container.querySelector('#lbl-webcam-scale');
        const videoSources = Object.entries(this.app.state.sources || {})
            .filter(([, info]) => info && info.media_type === 'video')
            .map(([id]) => id);

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

        enabledEl?.addEventListener('change', async (e) => {
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

        srcEl?.addEventListener('change', () => applyWebcam());
        posEl?.addEventListener('change', () => applyWebcam());
        scaleEl?.addEventListener('input', (e) => {
            if (scaleLbl) scaleLbl.textContent = Number(e.target.value).toFixed(2);
            applyWebcam();
        });

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

    _labelPos(p) {
        if (p === 'bottom-right') return 'Bottom Right';
        if (p === 'bottom-left') return 'Bottom Left';
        if (p === 'top-right') return 'Top Right';
        if (p === 'top-left') return 'Top Left';
        if (p === 'side-by-side') return 'Side By Side';
        return p;
    }

    _escape(s) {
        return String(s).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
    }

    _escapeAttr(s) {
        return String(s).replaceAll('"', '&quot;');
    }
}
