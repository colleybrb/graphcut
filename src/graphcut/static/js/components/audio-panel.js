const AUDIO_PRESETS = {
    dialog: {
        label: 'Dialogue Focus',
        copy: 'Pushes speech forward and tucks music underneath it.',
        values: {
            source_gain_db: 1,
            narration_gain_db: 3,
            music_gain_db: -18,
            ducking_strength: 0.85,
            silence_threshold_db: -34,
            normalize: true,
            target_lufs: -16
        }
    },
    social: {
        label: 'Social Punch',
        copy: 'Hotter master for short-form edits with a stronger music bed.',
        values: {
            source_gain_db: 2,
            narration_gain_db: 2,
            music_gain_db: -12,
            ducking_strength: 0.55,
            silence_threshold_db: -28,
            normalize: true,
            target_lufs: -14
        }
    },
    balanced: {
        label: 'Balanced Mix',
        copy: 'Cleaner overall loudness for explainers and longer-form pieces.',
        values: {
            source_gain_db: 0,
            narration_gain_db: 1,
            music_gain_db: -15,
            ducking_strength: 0.65,
            silence_threshold_db: -36,
            normalize: true,
            target_lufs: -18
        }
    }
};

export class AudioPanel {
    constructor(app) {
        this.app = app;
        this.container = document.getElementById('tab-audio');
        this._timeout = null;
    }

    render() {
        const mix = this.app.state.audioConfig;
        if (!mix || !this.container) return;

        this.container.innerHTML = `
            <div class="gc-stack">
                <section class="gc-section-card">
                    <div class="gc-eyebrow">Audio Direction</div>
                    <div class="gc-title-row">
                        <strong class="text-sm text-on-surface">Voice, music, and loudness</strong>
                        <span class="gc-setting-value">${mix.normalize ? 'Normalized' : 'Manual'}</span>
                    </div>
                    <p class="gc-copy" style="margin-top:0.5rem;">
                        These controls shape how the edit feels before export. Hover the info bubbles for a quick visual demo of each setting.
                    </p>
                    <div class="gc-pill-row" style="margin-top:0.8rem;">
                        ${Object.entries(AUDIO_PRESETS).map(([id, preset]) => `
                            <button class="gc-pill-btn" data-audio-preset="${id}" title="${this._escapeAttr(preset.copy)}">${preset.label}</button>
                        `).join('')}
                    </div>
                </section>

                ${this._renderRangeCard({
                    id: 'source',
                    label: 'Source Gain',
                    desc: 'Lift or reduce the original clip audio before narration and music are added.',
                    value: `${Number(mix.source_gain_db).toFixed(0)} dB`,
                    input: `<input type="range" id="audio-source" min="-18" max="12" step="1" value="${mix.source_gain_db}">`,
                    helpTitle: 'Source Gain Demo',
                    helpCopy: 'Think of this as the base layer. Higher values make the original camera audio feel more present before anything else is mixed in.',
                    demo: this._demoBars([26, 42, 36, 58, 30, 50])
                })}

                ${this._renderRangeCard({
                    id: 'narration',
                    label: 'Narration Lift',
                    desc: 'Adds extra clarity to voice-over or talking-head tracks assigned as narration.',
                    value: `${Number(mix.narration_gain_db).toFixed(0)} dB`,
                    input: `<input type="range" id="audio-narration" min="-12" max="12" step="1" value="${mix.narration_gain_db}">`,
                    helpTitle: 'Narration Lift Demo',
                    helpCopy: 'The bright center bars represent speech. Raising narration gain makes those peaks win the mix more often.',
                    demo: this._demoBars([18, 48, 78, 92, 70, 38])
                })}

                ${this._renderRangeCard({
                    id: 'music',
                    label: 'Music Bed',
                    desc: 'Controls how loud the background music feels under dialogue and scene audio.',
                    value: `${Number(mix.music_gain_db).toFixed(0)} dB`,
                    input: `<input type="range" id="audio-music" min="-32" max="2" step="1" value="${mix.music_gain_db}">`,
                    helpTitle: 'Music Bed Demo',
                    helpCopy: 'Lower settings keep the soundtrack under the story. Higher settings make the edit feel more trailer-like or hype-driven.',
                    demo: this._demoBars([64, 58, 46, 52, 44, 40])
                })}

                ${this._renderRangeCard({
                    id: 'ducking',
                    label: 'Ducking Strength',
                    desc: 'Automatically dips the music when narration becomes active.',
                    value: `${Math.round(Number(mix.ducking_strength) * 100)}%`,
                    input: `<input type="range" id="audio-ducking" min="0" max="1" step="0.05" value="${mix.ducking_strength}">`,
                    helpTitle: 'Ducking Demo',
                    helpCopy: 'The outer bars are the music bed. Stronger ducking pushes them down when the middle narration peaks arrive.',
                    demo: this._demoBars([72, 54, 30, 88, 34, 58])
                })}

                ${this._renderRangeCard({
                    id: 'threshold',
                    label: 'Narration Trigger Threshold',
                    desc: 'Sets how much voice is needed before the music starts ducking.',
                    value: `${Number(mix.silence_threshold_db).toFixed(0)} dB`,
                    input: `<input type="range" id="audio-threshold" min="-60" max="-12" step="1" value="${mix.silence_threshold_db}">`,
                    helpTitle: 'Trigger Threshold Demo',
                    helpCopy: 'Move this closer to zero to require louder speech before ducking kicks in. Lower values react to quieter voice passages.',
                    demo: this._demoBars([14, 28, 42, 56, 72, 86])
                })}

                <section class="gc-setting-card">
                    <div class="gc-setting-head">
                        <div>
                            <div class="gc-setting-label">Loudness Mastering</div>
                            <div class="gc-setting-meta">Normalize the final export and choose a target loudness profile.</div>
                        </div>
                        ${this._helpBubble(
                            'Normalization Demo',
                            'Normalization keeps the overall export from swinging too quiet or too loud. Lower LUFS numbers sound louder.',
                            this._demoBars([28, 34, 40, 54, 70, 84])
                        )}
                    </div>
                    <div class="gc-toggle-row">
                        <label class="text-sm text-on-surface">LUFS Normalization</label>
                        <input type="checkbox" id="audio-normalize" ${mix.normalize ? 'checked' : ''} style="width:20px;height:20px;">
                    </div>
                    <div class="gc-inline-fields" style="margin-top:0.85rem;">
                        <label class="text-xs uppercase tracking-[0.16em] text-on-surface-variant">Target LUFS</label>
                        <input type="number" id="audio-lufs" value="${mix.target_lufs}" min="-30" max="-8" step="1" class="form-control" style="width:92px" ${mix.normalize ? '' : 'disabled'}>
                        <span class="text-xs text-on-surface-variant">Typical targets: -18 for explainers, -14 for punchier social clips.</span>
                    </div>
                </section>
            </div>
        `;

        this.bindEvents();
    }

    bindEvents() {
        if (!this.container) return;

        const saveMix = (payload) => {
            window.clearTimeout(this._timeout);
            this.app.state.audioConfig = { ...payload };
            this._timeout = window.setTimeout(async () => {
                try {
                    await this.app.api.updateAudio(payload);
                    this.app.setStatus('Audio mix updated', 1800);
                } catch (err) {
                    alert(err.message || 'Failed to update audio settings.');
                }
            }, 320);
        };

        const currentPayload = () => ({
            source_gain_db: Number(this.container.querySelector('#audio-source')?.value || 0),
            narration_gain_db: Number(this.container.querySelector('#audio-narration')?.value || 0),
            music_gain_db: Number(this.container.querySelector('#audio-music')?.value || 0),
            ducking_strength: Number(this.container.querySelector('#audio-ducking')?.value || 0),
            silence_threshold_db: Number(this.container.querySelector('#audio-threshold')?.value || -40),
            normalize: Boolean(this.container.querySelector('#audio-normalize')?.checked),
            target_lufs: Number(this.container.querySelector('#audio-lufs')?.value || -23)
        });

        const syncDisplayValues = () => {
            const payload = currentPayload();
            this.container.querySelector('[data-audio-value="source"]')?.replaceChildren(document.createTextNode(`${payload.source_gain_db.toFixed(0)} dB`));
            this.container.querySelector('[data-audio-value="narration"]')?.replaceChildren(document.createTextNode(`${payload.narration_gain_db.toFixed(0)} dB`));
            this.container.querySelector('[data-audio-value="music"]')?.replaceChildren(document.createTextNode(`${payload.music_gain_db.toFixed(0)} dB`));
            this.container.querySelector('[data-audio-value="ducking"]')?.replaceChildren(document.createTextNode(`${Math.round(payload.ducking_strength * 100)}%`));
            this.container.querySelector('[data-audio-value="threshold"]')?.replaceChildren(document.createTextNode(`${payload.silence_threshold_db.toFixed(0)} dB`));
            const lufsInput = this.container.querySelector('#audio-lufs');
            if (lufsInput) {
                lufsInput.disabled = !payload.normalize;
            }
            return payload;
        };

        this.container.querySelectorAll('#audio-source, #audio-narration, #audio-music, #audio-ducking, #audio-threshold').forEach((input) => {
            input.addEventListener('input', () => {
                saveMix(syncDisplayValues());
            });
        });

        this.container.querySelector('#audio-normalize')?.addEventListener('change', () => {
            saveMix(syncDisplayValues());
        });

        this.container.querySelector('#audio-lufs')?.addEventListener('input', () => {
            saveMix(syncDisplayValues());
        });

        this.container.querySelectorAll('[data-audio-preset]').forEach((button) => {
            button.addEventListener('click', async () => {
                const presetId = button.getAttribute('data-audio-preset');
                const preset = presetId ? AUDIO_PRESETS[presetId] : null;
                if (!preset) return;

                this.app.state.audioConfig = { ...preset.values };
                this.render();
                try {
                    await this.app.api.updateAudio(preset.values);
                    this.app.setStatus(`${preset.label} preset applied`, 2200);
                } catch (err) {
                    alert(err.message || 'Failed to apply audio preset.');
                }
            });
        });
    }

    _renderRangeCard({ id, label, desc, value, input, helpTitle, helpCopy, demo }) {
        return `
            <section class="gc-setting-card">
                <div class="gc-setting-head">
                    <div>
                        <div class="gc-setting-label">${label}</div>
                        <div class="gc-setting-meta">${desc}</div>
                    </div>
                    <div class="gc-setting-value" data-audio-value="${id}">${value}</div>
                    ${this._helpBubble(helpTitle, helpCopy, demo)}
                </div>
                ${input}
            </section>
        `;
    }

    _helpBubble(title, copy, demo) {
        return `
            <div class="gc-info-wrap">
                <button class="gc-info-dot" type="button" tabindex="0">i</button>
                <div class="gc-help-pop">
                    <strong>${title}</strong>
                    <p>${copy}</p>
                    <div style="margin-top:0.65rem;">${demo}</div>
                </div>
            </div>
        `;
    }

    _demoBars(heights) {
        return `
            <div class="gc-demo-strip">
                ${heights.map((height) => `<span class="gc-demo-bar" style="height:${height}%"></span>`).join('')}
            </div>
        `;
    }

    _escapeAttr(value) {
        return String(value).replaceAll('"', '&quot;');
    }
}
