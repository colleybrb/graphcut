function formatSeconds(value) {
    const total = Math.max(0, Number(value) || 0);
    const hours = Math.floor(total / 3600);
    const minutes = Math.floor((total % 3600) / 60);
    const seconds = Math.floor(total % 60);
    const frames = Math.floor((total - Math.floor(total)) * 30);
    const base = [minutes, seconds].map((part) => String(part).padStart(2, '0')).join(':');
    return hours > 0
        ? `${String(hours).padStart(2, '0')}:${base}:${String(frames).padStart(2, '0')}`
        : `${base}:${String(frames).padStart(2, '0')}`;
}

export class ClipPanel {
    constructor(app) {
        this.app = app;
        this.container = document.getElementById('clip-list');
        this._saveTimers = new Map();
    }

    _escapeHtml(value) {
        return String(value)
            .replaceAll('&', '&amp;')
            .replaceAll('<', '&lt;')
            .replaceAll('>', '&gt;');
    }

    _escapeAttr(value) {
        return this._escapeHtml(value).replaceAll('"', '&quot;');
    }

    _clearDropIndicators() {
        this.container?.querySelectorAll('[data-drop-slot]').forEach((slot) => {
            slot.classList.remove('bg-primary/20', 'border-primary/70', 'shadow-[0_0_18px_rgba(37,226,235,0.22)]');
            slot.classList.add('border-outline-variant/20');
        });
    }

    _readDragPayload(event) {
        const transfer = event.dataTransfer;
        if (!transfer) return null;

        const sourceId = transfer.getData('application/x-graphcut-source-id');
        if (sourceId) {
            return { kind: 'source', sourceId };
        }

        const clipIndexRaw = transfer.getData('application/x-graphcut-clip-index');
        if (clipIndexRaw !== '') {
            const clipIndex = Number(clipIndexRaw);
            if (Number.isInteger(clipIndex)) {
                return { kind: 'clip', clipIndex };
            }
        }

        const text = transfer.getData('text/plain') || '';
        if (text.startsWith('graphcut-source:')) {
            return { kind: 'source', sourceId: text.slice('graphcut-source:'.length) };
        }
        if (text.startsWith('graphcut-clip:')) {
            const clipIndex = Number(text.slice('graphcut-clip:'.length));
            if (Number.isInteger(clipIndex)) {
                return { kind: 'clip', clipIndex };
            }
        }

        return null;
    }

    _buildReorderIndices(length, fromIndex, dropPosition) {
        if (!Number.isInteger(fromIndex) || fromIndex < 0 || fromIndex >= length) return null;

        const indices = Array.from({ length }, (_, index) => index);
        const [moved] = indices.splice(fromIndex, 1);
        const normalizedTarget = Math.max(0, Math.min(length, dropPosition));
        const insertAt = fromIndex < normalizedTarget ? normalizedTarget - 1 : normalizedTarget;
        indices.splice(insertAt, 0, moved);

        const unchanged = indices.every((value, index) => value === index);
        return unchanged ? null : indices;
    }

    _createDropSlot(position, { empty = false } = {}) {
        const slot = document.createElement('div');
        slot.dataset.dropSlot = String(position);
        slot.dataset.position = String(position);

        if (empty) {
            slot.className = 'h-full min-h-[112px] rounded-xl border-2 border-dashed border-outline-variant/30 bg-surface-container-low flex items-center justify-center px-4 text-center text-sm text-on-surface-variant transition-all';
            slot.innerHTML = `
                <div>
                    <div class="font-semibold text-on-surface">Drag media here to start the timeline</div>
                    <div class="mt-1 text-[11px] text-on-surface-variant/80">Drop from the library to insert a clip, then drag clips here to reorder.</div>
                </div>
            `;
            slot.style.minWidth = '100%';
        } else {
            slot.className = 'h-20 w-4 rounded-lg border border-dashed border-outline-variant/20 bg-surface-container-low/60 transition-all duration-150 flex-shrink-0';
            slot.title = 'Drop to insert or reorder';
        }

        const activate = () => {
            slot.classList.remove('border-outline-variant/20');
            slot.classList.add('bg-primary/20', 'border-primary/70', 'shadow-[0_0_18px_rgba(37,226,235,0.22)]');
            if (!empty) slot.style.width = '28px';
        };
        const deactivate = () => {
            slot.classList.remove('bg-primary/20', 'border-primary/70', 'shadow-[0_0_18px_rgba(37,226,235,0.22)]');
            slot.classList.add('border-outline-variant/20');
            if (!empty) slot.style.width = '16px';
        };

        slot.addEventListener('dragover', (event) => {
            const payload = this._readDragPayload(event);
            if (!payload) return;
            event.preventDefault();
            if (event.dataTransfer) {
                event.dataTransfer.dropEffect = payload.kind === 'clip' ? 'move' : 'copy';
            }
            activate();
        });

        slot.addEventListener('dragleave', (event) => {
            if (slot.contains(event.relatedTarget)) return;
            deactivate();
        });

        slot.addEventListener('drop', async (event) => {
            const payload = this._readDragPayload(event);
            deactivate();
            this._clearDropIndicators();
            if (!payload) return;

            event.preventDefault();

            try {
                if (payload.kind === 'source') {
                    await this.app.api.insertClip({
                        source_id: payload.sourceId,
                        position
                    });
                    this.app.setStatus(`Inserted ${payload.sourceId} into the timeline`, 2200);
                    await this.app.refreshState();
                    this.app.setActiveClip(Math.min(position, (this.app.state.clips?.length || 1) - 1));
                    return;
                }

                const clips = Array.isArray(this.app.state.clips) ? this.app.state.clips : [];
                const reordered = this._buildReorderIndices(clips.length, payload.clipIndex, position);
                if (!reordered) return;

                await this.app.api.reorderClips(reordered);
                this.app.setStatus('Timeline order updated', 1800);
                await this.app.refreshState();

                const newIndex = reordered.indexOf(payload.clipIndex);
                if (newIndex >= 0) {
                    this.app.setActiveClip(newIndex);
                }
            } catch (err) {
                alert(err.message || 'Failed to update the timeline.');
            }
        });

        return slot;
    }

    render() {
        if (!this.container) return;

        const clips = Array.isArray(this.app.state.clips) ? this.app.state.clips : [];
        const zoom = Number(this.app.state.timelineZoom || 1);

        if (clips.length === 0) {
            this.container.innerHTML = '';
            this.container.appendChild(this._createDropSlot(0, { empty: true }));
            return;
        }

        const timeline = document.createElement('div');
        timeline.className = 'w-full h-full flex items-center gap-1';
        timeline.appendChild(this._createDropSlot(0));

        clips.forEach((clip, index) => {
            const sid = clip.source_id;
            const info = this.app.state.sources?.[sid];
            if (!info) return;

            const fullDur = Number(info.duration_seconds || 0);
            const tStart = clip.trim_start ?? 0;
            const tEnd = clip.trim_end ?? fullDur;
            const clipDur = Math.max(0, (tEnd || 0) - (tStart || 0));
            const visualWidth = Math.max(180, Math.min(560, clipDur * 130 * zoom));
            const selected = this.app.state.activeClipIndex === index;
            const transitionLabel = clip.transition === 'cut'
                ? 'Cut'
                : `${clip.transition} ${Number(clip.transition_duration || 0).toFixed(2)}s`;

            const el = document.createElement('div');
            el.className = `group h-16 rounded border-l-4 p-2 flex items-center gap-3 relative transition-all ${selected ? 'bg-secondary-container border-primary shadow-[0_0_10px_rgba(37,226,235,0.2)]' : 'bg-surface-container-high border-outline-variant hover:border-primary/50'}`;
            el.dataset.index = index;
            el.draggable = true;
            el.style.width = `${visualWidth}px`;
            el.style.flexShrink = '0';
            el.title = 'Drag to reorder this clip in the timeline';

            el.addEventListener('dragstart', (event) => {
                if (!event.dataTransfer) return;
                event.dataTransfer.effectAllowed = 'move';
                event.dataTransfer.setData('application/x-graphcut-clip-index', String(index));
                event.dataTransfer.setData('text/plain', `graphcut-clip:${index}`);
                el.classList.add('opacity-50', 'scale-[0.98]');
            });
            el.addEventListener('dragend', () => {
                el.classList.remove('opacity-50', 'scale-[0.98]');
                this._clearDropIndicators();
            });

            const thumbHtml = info.thumbnail
                ? `<img src="${this._escapeAttr(info.thumbnail)}" class="w-12 h-8 object-cover rounded border border-outline-variant/30">`
                : `<div class="w-12 h-8 bg-surface-container rounded border border-outline-variant/30 flex items-center justify-center"><span class="material-symbols-outlined text-[10px] text-on-surface-variant">movie</span></div>`;

            el.innerHTML = `
                <div class="flex h-full items-center text-on-surface-variant/70">
                    <span class="material-symbols-outlined text-sm">drag_indicator</span>
                </div>
                ${thumbHtml}
                <div class="flex-1 min-w-0 pr-8">
                    <p class="text-[10px] font-bold ${selected ? 'text-primary' : 'text-on-surface'} truncate" title="${this._escapeAttr(sid)}">${this._escapeHtml(sid)}</p>
                    <div class="flex items-center gap-2 mt-0.5">
                        <span class="text-[9px] ${clip.transition === 'cut' ? 'bg-primary/20 text-primary' : 'bg-secondary/20 text-secondary'} px-1 rounded uppercase font-bold">${transitionLabel}</span>
                        <span class="mono text-[9px] text-on-surface-variant/70">${clipDur.toFixed(1)}s</span>
                    </div>
                    <p class="mono text-[8px] text-on-surface-variant/50 mt-1">${formatSeconds(tStart)} -> ${formatSeconds(tEnd)}</p>
                </div>

                <div class="absolute inset-x-0 bottom-full pb-2 z-50 transition-all opacity-0 pointer-events-none group-hover:opacity-100 group-hover:pointer-events-auto">
                    <div class="p-2 bg-surface-container-highest rounded border border-outline-variant/30 shadow-xl flex flex-col gap-2">
                        <div class="flex gap-2 text-[10px]">
                            <label class="flex items-center gap-1 text-on-surface-variant">In <input type="number" class="w-12 bg-surface-container px-1 py-0.5 rounded border border-outline-variant/50 text-white focus:border-primary focus:outline-none" data-trim-start="${index}" min="0" step="0.05" value="${Number(tStart).toFixed(2)}"></label>
                            <label class="flex items-center gap-1 text-on-surface-variant">Out <input type="number" class="w-12 bg-surface-container px-1 py-0.5 rounded border border-outline-variant/50 text-white focus:border-primary focus:outline-none" data-trim-end="${index}" min="0" step="0.05" value="${Number(tEnd).toFixed(2)}"></label>
                        </div>
                        <div class="flex items-center gap-1">
                            <button class="px-1.5 py-0.5 bg-surface-container hover:bg-surface-container-low border border-outline-variant/50 rounded text-on-surface-variant hover:text-primary transition-colors text-[9px] flex items-center gap-1" data-trim-open="${index}" title="Open trim window"><span class="material-symbols-outlined text-[10px]">cut</span> UI</button>
                            <button class="px-1.5 py-0.5 bg-surface-container hover:bg-surface-container-low border border-outline-variant/50 rounded text-on-surface-variant hover:text-primary transition-colors text-[9px]" data-dup="${index}">Dup</button>
                            <button class="px-1.5 py-0.5 bg-surface-container hover:bg-surface-container-low border border-outline-variant/50 rounded text-on-surface-variant hover:text-primary transition-colors text-[9px]" data-split="${index}">Split</button>
                        </div>
                        <div class="flex items-center gap-1 border-t border-outline-variant/30 pt-1 mt-1">
                            <button class="px-1.5 py-0.5 text-on-surface-variant hover:text-primary transition-colors" data-move-up="${index}"><span class="material-symbols-outlined text-[10px]">arrow_back</span></button>
                            <button class="px-1.5 py-0.5 text-on-surface-variant hover:text-primary transition-colors" data-move-down="${index}"><span class="material-symbols-outlined text-[10px]">arrow_forward</span></button>
                            <div class="flex-1"></div>
                            <button class="btn-remove px-1.5 py-0.5 bg-red-500/20 text-red-400 hover:bg-red-500 hover:text-white rounded transition-colors text-[9px] flex items-center gap-1" data-index="${index}"><span class="material-symbols-outlined text-[10px]">delete</span> Delete</button>
                        </div>
                    </div>
                </div>
            `;

            el.addEventListener('click', () => this.app.setActiveClip(index));

            const stopClick = (event) => event.stopPropagation();
            el.querySelectorAll('input, button').forEach((node) => {
                node.addEventListener('click', stopClick);
            });

            el.querySelector('.btn-remove')?.addEventListener('click', async () => {
                try {
                    await this.app.api.deleteClip(index);
                    await this.app.refreshState();
                } catch (err) {
                    alert(err.message || 'Failed to remove clip.');
                }
            });

            const startEl = el.querySelector(`[data-trim-start="${index}"]`);
            const endEl = el.querySelector(`[data-trim-end="${index}"]`);
            const resetEl = el.querySelector(`[data-trim-reset="${index}"]`);

            const clamp = (value) => {
                const parsed = Number(value);
                if (!Number.isFinite(parsed)) return 0;
                if (fullDur > 0) return Math.max(0, Math.min(fullDur, parsed));
                return Math.max(0, parsed);
            };

            const scheduleSave = () => {
                const key = String(index);
                const existing = this._saveTimers.get(key);
                if (existing) clearTimeout(existing);
                this._saveTimers.set(key, setTimeout(async () => {
                    try {
                        const nextStart = clamp(startEl?.value);
                        const nextEnd = clamp(endEl?.value);
                        await this.app.api.updateClip(index, {
                            trim_start: nextStart,
                            trim_end: nextEnd
                        });
                        await this.app.refreshState();
                    } catch (err) {
                        alert(err.message || 'Failed to update trim.');
                    }
                }, 260));
            };

            startEl?.addEventListener('input', scheduleSave);
            endEl?.addEventListener('input', scheduleSave);
            resetEl?.addEventListener('click', async () => {
                try {
                    await this.app.api.updateClip(index, { trim_start: null, trim_end: null });
                    await this.app.refreshState();
                } catch (err) {
                    alert(err.message || 'Failed to reset trim.');
                }
            });

            el.querySelector(`[data-trim-open="${index}"]`)?.addEventListener('click', () => {
                this.app.components?.trimModal?.openForClip(index);
            });
            el.querySelector(`[data-split="${index}"]`)?.addEventListener('click', () => {
                this.app.components?.trimModal?.openSplit(index);
            });
            el.querySelector(`[data-dup="${index}"]`)?.addEventListener('click', async () => {
                try {
                    await this.app.api.duplicateClip(index);
                    await this.app.refreshState();
                } catch (err) {
                    alert(err.message || 'Failed to duplicate clip.');
                }
            });
            el.querySelector(`[data-move-up="${index}"]`)?.addEventListener('click', async () => {
                if (index <= 0) return;
                try {
                    await this.app.api.moveClip(index, index - 1);
                    await this.app.refreshState();
                } catch (err) {
                    alert(err.message || 'Failed to move clip.');
                }
            });
            el.querySelector(`[data-move-down="${index}"]`)?.addEventListener('click', async () => {
                if (index >= (clips.length - 1)) return;
                try {
                    await this.app.api.moveClip(index, index + 1);
                    await this.app.refreshState();
                } catch (err) {
                    alert(err.message || 'Failed to move clip.');
                }
            });

            timeline.appendChild(el);
            timeline.appendChild(this._createDropSlot(index + 1));
        });

        this.container.innerHTML = '';
        this.container.appendChild(timeline);
    }
}
