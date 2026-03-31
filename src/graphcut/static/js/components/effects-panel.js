const TRANSITIONS = [
    {
        id: 'cut',
        label: 'Cut',
        description: 'Instant jump for punchy pacing and meme-style edits.',
        defaultDuration: 0.0,
        helpTitle: 'Cut Demo',
        helpCopy: 'A cut switches shots on the exact frame boundary. Use it when you want the edit to feel fast, crisp, or intentionally abrupt.'
    },
    {
        id: 'fade',
        label: 'Fade',
        description: 'Soft dissolve that smooths the jump between related moments.',
        defaultDuration: 0.35,
        helpTitle: 'Fade Demo',
        helpCopy: 'Fades are gentle and forgiving. They work well when the clips are similar and you want a subtle handoff.'
    },
    {
        id: 'xfade',
        label: 'Crossfade',
        description: 'Longer overlap for a more cinematic or stylized handoff.',
        defaultDuration: 0.6,
        helpTitle: 'Crossfade Demo',
        helpCopy: 'Crossfades let one shot move through another for a beat. They are useful for montages, emotion, and polished pacing.'
    }
];

const TRANSITION_PRESETS = [
    {
        id: 'snappy',
        label: 'Snappy',
        transition: 'cut',
        duration: 0.0,
        copy: 'Fast social pacing with no overlap.'
    },
    {
        id: 'smooth',
        label: 'Smooth',
        transition: 'fade',
        duration: 0.25,
        copy: 'A soft handoff for explainers and interview beats.'
    },
    {
        id: 'cinematic',
        label: 'Cinematic',
        transition: 'xfade',
        duration: 0.55,
        copy: 'Slower, more stylized overlap for B-roll and reveals.'
    }
];

export class EffectsPanel {
    constructor(app) {
        this.app = app;
        this.container = document.getElementById('effects-list');
    }

    render() {
        if (!this.container) return;

        const clipIndex = this.app.state.activeClipIndex;
        const clip = Number.isInteger(clipIndex) ? this.app.state.clips?.[clipIndex] : null;
        const selectionLabel = clip
            ? `${clip.source_id} (#${clipIndex + 1})`
            : 'Choose a clip in the timeline';
        const transitionLabel = clip
            ? `${clip.transition} • ${Number(clip.transition_duration || 0).toFixed(2)}s`
            : 'Select a clip to edit';

        this.container.innerHTML = `
            <div class="gc-stack">
                <section class="gc-section-card">
                    <div class="gc-eyebrow">Clip Effects</div>
                    <div class="gc-title-row">
                        <strong class="text-sm text-on-surface">${selectionLabel}</strong>
                        <span class="gc-setting-value">${transitionLabel}</span>
                    </div>
                    <p class="gc-copy" style="margin-top:0.45rem;">
                        Transition controls are clip-aware. Pick the style, preview the feel, then choose whether to apply it to one cut or a whole run of clips.
                    </p>
                </section>

                <section class="gc-section-card">
                    <div class="gc-eyebrow">Transition Presets</div>
                    <div class="gc-pill-row" style="margin-top:0.75rem;">
                        ${TRANSITION_PRESETS.map((preset) => `
                            <button class="gc-pill-btn" data-transition-preset="${preset.id}" title="${this._escapeAttr(preset.copy)}">${preset.label}</button>
                        `).join('')}
                    </div>
                </section>

                ${TRANSITIONS.map((effect) => {
                    const active = clip ? clip.transition === effect.id : effect.id === 'cut';
                    return `
                        <section class="gc-setting-card ${active ? 'ring-1 ring-primary/40' : ''}">
                            <div class="gc-setting-head">
                                <div>
                                    <div class="gc-setting-label">${effect.label}</div>
                                    <div class="gc-setting-meta">${effect.description}</div>
                                </div>
                                <div class="gc-setting-value">${effect.defaultDuration.toFixed(2)}s</div>
                                ${this._helpBubble(effect.helpTitle, effect.helpCopy, this._demoFrame(effect.id))}
                            </div>
                            <button class="gc-scope-btn ${active ? 'active' : ''}" data-effect-id="${effect.id}" ${clip ? '' : 'disabled'}>${effect.label}</button>
                        </section>
                    `;
                }).join('')}

                <section class="gc-setting-card">
                    <div class="gc-setting-head">
                        <div>
                            <div class="gc-setting-label">Transition Duration</div>
                            <div class="gc-setting-meta">Dial in how long the overlap lasts for fade-based transitions.</div>
                        </div>
                        <div class="gc-setting-value" id="effect-duration-value">${clip ? Number(clip.transition_duration || 0).toFixed(2) : '0.00'}s</div>
                    </div>
                    <div class="gc-range-row">
                        <input type="range" id="effect-duration" min="0" max="1.5" step="0.05" value="${clip ? Number(clip.transition_duration || 0).toFixed(2) : '0.00'}" ${clip ? '' : 'disabled'}>
                        <input type="number" class="form-control" id="effect-duration-input" min="0" max="1.5" step="0.05" value="${clip ? Number(clip.transition_duration || 0).toFixed(2) : '0.00'}" style="width:88px" ${clip ? '' : 'disabled'}>
                    </div>
                </section>

                <section class="gc-section-card">
                    <div class="gc-eyebrow">Apply Scope</div>
                    <div class="gc-scope-row" style="margin-top:0.75rem;">
                        <button class="gc-scope-btn" data-apply-scope="selected" ${clip ? '' : 'disabled'}>Selected Clip</button>
                        <button class="gc-scope-btn" data-apply-scope="tail" ${clip ? '' : 'disabled'}>This Clip Forward</button>
                        <button class="gc-scope-btn" data-apply-scope="all" ${clip ? '' : 'disabled'}>Entire Timeline</button>
                        <button class="gc-scope-btn" data-apply-scope="reset" ${clip ? '' : 'disabled'}>Reset To Cut</button>
                    </div>
                </section>
            </div>
        `;

        this.bindEvents();
    }

    bindEvents() {
        if (!this.container) return;

        const activeClip = Number.isInteger(this.app.state.activeClipIndex)
            ? this.app.state.clips?.[this.app.state.activeClipIndex]
            : null;
        let selectedEffect = activeClip?.transition || 'cut';

        const durationRange = this.container.querySelector('#effect-duration');
        const durationInput = this.container.querySelector('#effect-duration-input');
        const durationLabel = this.container.querySelector('#effect-duration-value');

        const getDuration = () => Math.max(0, Number(durationRange?.value || durationInput?.value || 0));
        const syncDuration = (value) => {
            const clean = Math.max(0, Math.min(1.5, Number(value) || 0));
            if (durationRange) durationRange.value = clean.toFixed(2);
            if (durationInput) durationInput.value = clean.toFixed(2);
            if (durationLabel) durationLabel.textContent = `${clean.toFixed(2)}s`;
        };

        syncDuration(activeClip?.transition_duration || 0);

        const highlightSelected = () => {
            this.container.querySelectorAll('[data-effect-id]').forEach((button) => {
                button.classList.toggle('active', button.getAttribute('data-effect-id') === selectedEffect);
            });
        };

        const applyScope = async (scope) => {
            const clipIndex = this.app.state.activeClipIndex;
            const clips = Array.isArray(this.app.state.clips) ? this.app.state.clips : [];
            if (!Number.isInteger(clipIndex) || clips.length === 0) return;

            let indices = [clipIndex];
            if (scope === 'tail') {
                indices = Array.from({ length: clips.length - clipIndex }, (_, offset) => clipIndex + offset);
            } else if (scope === 'all') {
                indices = Array.from({ length: clips.length }, (_, index) => index);
            }

            const duration = selectedEffect === 'cut' ? 0.0 : getDuration();
            const payload = scope === 'reset'
                ? { transition: 'cut', transition_duration: 0.0 }
                : { transition: selectedEffect, transition_duration: duration };

            try {
                for (const index of indices) {
                    await this.app.api.updateClip(index, payload);
                }
                await this.app.refreshState();
                this.app.setStatus(
                    scope === 'reset'
                        ? 'Transition reset to cut'
                        : `Applied ${payload.transition} to ${indices.length} clip${indices.length === 1 ? '' : 's'}`,
                    2200
                );
            } catch (err) {
                alert(err.message || 'Failed to apply transition settings.');
            }
        };

        this.container.querySelectorAll('[data-effect-id]').forEach((button) => {
            button.addEventListener('click', () => {
                selectedEffect = button.getAttribute('data-effect-id') || 'cut';
                if (selectedEffect === 'cut') {
                    syncDuration(0);
                } else if (getDuration() === 0) {
                    const found = TRANSITIONS.find((item) => item.id === selectedEffect);
                    syncDuration(found?.defaultDuration || 0.35);
                }
                highlightSelected();
            });
        });

        this.container.querySelectorAll('[data-transition-preset]').forEach((button) => {
            button.addEventListener('click', () => {
                const presetId = button.getAttribute('data-transition-preset');
                const preset = TRANSITION_PRESETS.find((item) => item.id === presetId);
                if (!preset) return;
                selectedEffect = preset.transition;
                syncDuration(preset.duration);
                highlightSelected();
                this.app.setStatus(`${preset.label} preset loaded`, 1600);
            });
        });

        durationRange?.addEventListener('input', (event) => {
            syncDuration(event.target.value);
        });

        durationInput?.addEventListener('input', (event) => {
            syncDuration(event.target.value);
        });

        this.container.querySelectorAll('[data-apply-scope]').forEach((button) => {
            button.addEventListener('click', async () => {
                const scope = button.getAttribute('data-apply-scope') || 'selected';
                await applyScope(scope);
            });
        });

        highlightSelected();
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

    _demoFrame(type) {
        const leftOverlay = type === 'cut' ? 'opacity:1;' : type === 'fade' ? 'opacity:0.7;' : 'opacity:0.45;';
        const rightOverlay = type === 'cut' ? 'opacity:0;' : type === 'fade' ? 'opacity:0.45;' : 'opacity:0.7;';
        return `
            <div class="gc-demo-frame">
                <div class="gc-demo-shot" style="background:linear-gradient(135deg, rgba(37,226,235,0.32), rgba(149,249,255,0.06));">
                    <div style="position:absolute;inset:0;background:linear-gradient(90deg, rgba(149,249,255,0.2), transparent);${leftOverlay}"></div>
                </div>
                <div class="gc-demo-shot" style="background:linear-gradient(135deg, rgba(154,208,211,0.28), rgba(37,226,235,0.08));">
                    <div style="position:absolute;inset:0;background:linear-gradient(90deg, transparent, rgba(149,249,255,0.28));${rightOverlay}"></div>
                </div>
            </div>
        `;
    }

    _escapeAttr(value) {
        return String(value).replaceAll('"', '&quot;');
    }
}
