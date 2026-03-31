export class TrimModal {
    constructor(app) {
        this.app = app;
        this.root = document.getElementById('trim-modal-root');
        this.body = document.getElementById('trim-modal-body');
        this.titleEl = document.getElementById('trim-modal-title');
        this.closeBtn = document.getElementById('trim-modal-close');

        this.state = null; // {mode, sourceId, clipIndex, insertPosition, trimStart, trimEnd}

        this.closeBtn?.addEventListener('click', () => this.close());
        this.root?.querySelector('[data-modal-close="1"]')?.addEventListener('click', () => this.close());
    }

    openForSource(sourceId, opts = {}) {
        this.state = {
            mode: 'add',
            sourceId,
            clipIndex: null,
            insertPosition: opts.insertPosition ?? null,
            trimStart: 0,
            trimEnd: null
        };
        this.render();
        this.show();
    }

    openForClip(clipIndex) {
        const clip = this.app.state.clips?.[clipIndex];
        if (!clip) return;
        const sourceId = clip.source_id;
        const info = this.app.state.sources?.[sourceId];
        if (!info) return;

        this.state = {
            mode: 'edit',
            sourceId,
            clipIndex,
            insertPosition: null,
            trimStart: clip.trim_start ?? 0,
            trimEnd: clip.trim_end ?? (info.duration_seconds ?? null)
        };
        this.render();
        this.show();
    }

    openSplit(clipIndex) {
        const clip = this.app.state.clips?.[clipIndex];
        if (!clip) return;
        const sourceId = clip.source_id;
        this.state = {
            mode: 'split',
            sourceId,
            clipIndex,
            insertPosition: null,
            trimStart: clip.trim_start ?? 0,
            trimEnd: clip.trim_end ?? null
        };
        this.render();
        this.show();
    }

    show() {
        if (this.root) this.root.style.display = 'flex';
    }

    close() {
        if (this.root) this.root.style.display = 'none';
        if (this.body) this.body.innerHTML = '';
        this.state = null;
    }

    render() {
        if (!this.state || !this.body) return;
        const { mode, sourceId } = this.state;
        const info = this.app.state.sources?.[sourceId];
        const duration = Number(info?.duration_seconds || 0);

        const title = mode === 'edit'
            ? `Trim Clip (#${(this.state.clipIndex ?? 0) + 1})`
            : mode === 'split'
                ? `Split Clip (#${(this.state.clipIndex ?? 0) + 1})`
                : `Trim Source (${sourceId})`;
        if (this.titleEl) this.titleEl.textContent = title;

        const mediaUrl = this.app.api.getSourceMedia(sourceId);
        const initialIn = Number(this.state.trimStart || 0);
        const initialOut = this.state.trimEnd ?? (duration || null);

        this.body.innerHTML = `
            <div class="grid grid-cols-1 md:grid-cols-[1.4fr_1fr] gap-6">
                <!-- Video Section -->
                <div class="space-y-4">
                    <div class="bg-black rounded-lg border border-outline-variant/30 overflow-hidden shadow-inner">
                        <video id="trim-video" src="${mediaUrl}" controls class="w-full max-h-[360px] object-contain"></video>
                    </div>
                    <div class="flex flex-wrap gap-2 items-center">
                        <button class="px-3 py-1.5 bg-surface-container hover:bg-surface-container-high border border-outline-variant/50 rounded text-sm text-on-surface-variant hover:text-primary transition-colors flex items-center gap-1 shadow-sm" id="btn-trim-start"><span class="material-symbols-outlined text-[16px]">arrow_drop_down</span> Set In</button>
                        <button class="px-3 py-1.5 bg-surface-container hover:bg-surface-container-high border border-outline-variant/50 rounded text-sm text-on-surface-variant hover:text-primary transition-colors flex items-center gap-1 shadow-sm" id="btn-trim-stop"><span class="material-symbols-outlined text-[16px]">arrow_drop_up</span> Set Out</button>
                        ${mode === 'split' ? `<button class="px-3 py-1.5 bg-primary-container text-on-primary font-bold rounded shadow-sm hover:scale-105 transition-transform" id="btn-split-here">Split Here</button>` : ``}
                    </div>
                    <p class="text-xs text-on-surface-variant/70">Play the source, click Set In then Set Out. You can repeat “Add Segment” multiple times.</p>
                </div>
                
                <!-- Controls Section -->
                <div class="flex flex-col gap-4 bg-surface-container-lowest p-4 rounded-lg border border-outline-variant/10">
                    <div>
                        <label class="block text-xs font-bold text-on-surface-variant uppercase tracking-wider mb-1">In (seconds)</label>
                        <input type="number" id="trim-in" class="w-full bg-surface-container-high border border-outline-variant/30 text-on-surface text-sm rounded p-2 outline-none focus:border-primary mono" min="0" step="0.05" value="${initialIn.toFixed(2)}">
                    </div>
                    <div>
                        <label class="block text-xs font-bold text-on-surface-variant uppercase tracking-wider mb-1">Out (seconds)</label>
                        <input type="number" id="trim-out" class="w-full bg-surface-container-high border border-outline-variant/30 text-on-surface text-sm rounded p-2 outline-none focus:border-primary mono" min="0" step="0.05" value="${(initialOut ?? 0).toFixed(2)}">
                    </div>
                    <div>
                        <label class="block text-xs font-bold text-on-surface-variant uppercase tracking-wider mb-1">Current Time</label>
                        <div id="trim-cur" class="w-full bg-surface-container-high/50 border border-outline-variant/20 text-primary font-bold text-sm rounded p-2 mono tabular-nums text-center">0.00</div>
                    </div>
                    
                    <div class="flex flex-col gap-2 mt-4 pt-4 border-t border-outline-variant/10">
                        ${mode === 'edit' ? `<button id="btn-apply-trim" class="w-full py-2 bg-primary-container text-on-primary font-bold rounded shadow-[0_0_10px_rgba(37,226,235,0.2)] hover:bg-[#95f9ff] transition-all">Apply To Clip</button>` : ``}
                        ${mode === 'add' ? `<button id="btn-add-segment" class="w-full py-2 bg-primary-container text-on-primary font-bold rounded shadow-[0_0_10px_rgba(37,226,235,0.2)] hover:bg-[#95f9ff] transition-all">Add Segment</button>` : ``}
                        <button id="btn-close-trim" class="w-full py-2 bg-surface-container hover:bg-surface-container-high border border-outline-variant/30 text-on-surface-variant rounded transition-colors">Cancel</button>
                    </div>
                    <div id="trim-msg" class="text-xs text-primary font-medium text-center h-4"></div>
                </div>
            </div>
        `;

        this.bind(duration);
    }

    bind(duration) {
        const video = this.body.querySelector('#trim-video');
        const inEl = this.body.querySelector('#trim-in');
        const outEl = this.body.querySelector('#trim-out');
        const curEl = this.body.querySelector('#trim-cur');
        const msgEl = this.body.querySelector('#trim-msg');

        const clamp = (v) => {
            const n = Number(v);
            if (!Number.isFinite(n)) return 0;
            if (duration > 0) return Math.max(0, Math.min(duration, n));
            return Math.max(0, n);
        };
        const readInOut = () => {
            const tin = clamp(inEl?.value);
            const tout = clamp(outEl?.value);
            return { tin, tout };
        };
        const writeInOut = (tin, tout) => {
            if (inEl) inEl.value = clamp(tin).toFixed(2);
            if (outEl) outEl.value = clamp(tout).toFixed(2);
        };

        const updateCur = () => {
            if (!video || !curEl) return;
            curEl.textContent = Number(video.currentTime || 0).toFixed(2);
        };
        video?.addEventListener('timeupdate', updateCur);
        video?.addEventListener('loadedmetadata', () => {
            // Default Out to duration if not set.
            if (duration > 0 && outEl && Number(outEl.value) === 0) {
                outEl.value = duration.toFixed(2);
            }
        });

        this.body.querySelector('#btn-trim-start')?.addEventListener('click', () => {
            if (!video) return;
            const t = clamp(video.currentTime);
            const { tout } = readInOut();
            writeInOut(t, Math.max(tout, t));
            msgEl.textContent = `In set to ${t.toFixed(2)}s`;
        });
        this.body.querySelector('#btn-trim-stop')?.addEventListener('click', () => {
            if (!video) return;
            const t = clamp(video.currentTime);
            const { tin } = readInOut();
            writeInOut(Math.min(tin, t), t);
            msgEl.textContent = `Out set to ${t.toFixed(2)}s`;
        });

        this.body.querySelector('#btn-close-trim')?.addEventListener('click', () => this.close());

        this.body.querySelector('#btn-apply-trim')?.addEventListener('click', async () => {
            if (!this.state) return;
            const { tin, tout } = readInOut();
            if (tout <= tin) {
                alert('Out must be greater than In.');
                return;
            }
            try {
                await this.app.api.updateClip(this.state.clipIndex, { trim_start: tin, trim_end: tout });
                await this.app.refreshState();
                msgEl.textContent = 'Trim applied to clip.';
            } catch (e) {
                alert(e.message || 'Failed to apply trim.');
            }
        });

        this.body.querySelector('#btn-add-segment')?.addEventListener('click', async () => {
            if (!this.state) return;
            const { tin, tout } = readInOut();
            if (tout <= tin) {
                alert('Out must be greater than In.');
                return;
            }
            try {
                await this.app.api.insertClip({
                    source_id: this.state.sourceId,
                    trim_start: tin,
                    trim_end: tout,
                    position: this.state.insertPosition
                });
                if (this.state.insertPosition !== null) {
                    this.state.insertPosition += 1;
                }
                await this.app.refreshState();
                msgEl.textContent = `Added segment ${tin.toFixed(2)}s → ${tout.toFixed(2)}s`;
            } catch (e) {
                alert(e.message || 'Failed to add segment.');
            }
        });

        this.body.querySelector('#btn-split-here')?.addEventListener('click', async () => {
            if (!this.state || !video) return;
            const t = clamp(video.currentTime);
            try {
                await this.app.api.splitClip(this.state.clipIndex, t);
                await this.app.refreshState();
                msgEl.textContent = `Split at ${t.toFixed(2)}s`;
                this.close();
            } catch (e) {
                alert(e.message || 'Failed to split clip.');
            }
        });
    }
}
