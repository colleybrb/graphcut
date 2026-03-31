export class SourcePanel {
    constructor(app) {
        this.app = app;
        this.container = document.getElementById('source-list');

        document.getElementById('btn-add-source')?.addEventListener('click', () => {
            const input = document.createElement('input');
            input.type = 'file';
            input.accept = 'video/*,audio/*,image/*';
            input.multiple = true;
            input.onchange = async (e) => {
                const files = Array.from(e.target.files || []);
                if (files.length === 0) return;

                document.getElementById('save-status').textContent = `Uploading ${files.length} file(s)...`;
                try {
                    this.app.updateProgress({
                        action: 'upload',
                        progress: 0,
                        eta: '--:--',
                        speed: `${files.length} file(s)`
                    });
                    for (let i = 0; i < files.length; i += 1) {
                        const file = files[i];
                        await this.app.api.uploadSource(file);
                        this.app.updateProgress({
                            action: 'upload',
                            progress: ((i + 1) / files.length) * 100,
                            eta: '--:--',
                            speed: `${i + 1}/${files.length}`
                        });
                    }
                    this.app.setStatus(`Uploaded ${files.length} asset${files.length === 1 ? '' : 's'}`, 2200);
                } finally {
                    this.app.hideProgress(900);
                }
                await this.app.refreshState();
            };
            input.click();
        });

        document.getElementById('btn-import-source-url')?.addEventListener('click', async () => {
            await this.promptImportUrl();
        });
    }

    async promptImportUrl(prefill = '') {
        const url = window.prompt(
            'Paste a direct public media URL (mp4, webm, mp3, gif, png, jpg).',
            prefill
        );
        if (!url) return null;

        document.getElementById('save-status').textContent = 'Importing remote media...';
        this.app.updateProgress({
            action: 'import',
            progress: 15,
            eta: '--:--',
            speed: 'downloading'
        });

        try {
            const imported = await this.app.api.importSourceUrl(url.trim());
            this.app.updateProgress({
                action: 'import',
                progress: 100,
                eta: '00:00',
                speed: imported?.media_type || 'ready'
            });
            await this.app.refreshState();
            this.app.setStatus(`Imported ${imported?.source_id || 'remote asset'}`, 2600);
            return imported;
        } catch (err) {
            alert(err.message || 'Failed to import the remote media.');
            return null;
        } finally {
            this.app.hideProgress(1000);
        }
    }

    render() {
        if (!this.app.state.sources || !this.container) return;
        this.container.innerHTML = '';

        const entries = Object.entries(this.app.state.sources);
        if (entries.length === 0) {
            this.container.innerHTML = `
                <div class="gc-section-card">
                    <div class="gc-eyebrow">Get Started</div>
                    <div class="gc-title-row">
                        <strong class="text-sm text-on-surface">Add footage, audio, or overlay assets</strong>
                    </div>
                    <p class="gc-copy" style="margin-top:0.45rem;">
                        Upload files from your machine or use the link button to pull in a direct public media URL.
                    </p>
                </div>
            `;
            return;
        }

        entries.forEach(([id, info]) => {
            const mediaType = info.media_type || 'video';
            const isVideo = mediaType === 'video';
            const isAudio = mediaType === 'audio';
            const isImage = mediaType === 'image';
            const isVisualAsset = isVideo || isImage;

            const el = document.createElement('div');
            el.className = 'group relative bg-surface-container rounded-lg overflow-hidden border border-transparent hover:border-primary/30 transition-all';
            el.draggable = isVideo;
            if (isVideo) {
                el.classList.add('cursor-grab', 'active:cursor-grabbing');
                el.title = 'Drag this video into the timeline to insert a clip';
            } else if (isImage) {
                el.title = 'Use this asset as a sticker or overlay';
            } else {
                el.title = 'Assign this source as narration or music';
            }

            const meta = this._sourceMeta(info);
            const thumbHtml = info.thumbnail
                ? `<img src="${info.thumbnail}" class="w-full h-full object-cover grayscale group-hover:grayscale-0 transition-all duration-500" />`
                : this._fallbackPreview(mediaType);

            const primaryAction = isVideo
                ? `
                    <button class="btn-trim-add p-1 text-on-surface-variant hover:text-primary bg-surface-container-high rounded shadow-sm" data-id="${this._escapeAttr(id)}" title="Trim before inserting">
                        <span class="material-symbols-outlined text-sm" style="font-size: 14px;">content_cut</span>
                    </button>
                    <button class="btn-add-clip p-1 bg-primary text-on-primary rounded font-bold hover:bg-primary-container shadow-sm" data-id="${this._escapeAttr(id)}" title="Add to timeline">
                        <span class="material-symbols-outlined text-sm" style="font-size: 14px;">add</span>
                    </button>
                `
                : '';

            const overlayAction = isVisualAsset
                ? `
                    <button class="btn-use-overlay p-1 bg-secondary-container/70 text-secondary rounded shadow-sm hover:text-primary" data-id="${this._escapeAttr(id)}" title="Use as sticker overlay">
                        <span class="material-symbols-outlined text-sm" style="font-size: 14px;">layers</span>
                    </button>
                `
                : `
                    <button class="btn-assign-audio p-1 bg-secondary-container/70 text-secondary rounded shadow-sm hover:text-primary" data-id="${this._escapeAttr(id)}" title="Assign in audio roles">
                        <span class="material-symbols-outlined text-sm" style="font-size: 14px;">graphic_eq</span>
                    </button>
                `;

            el.innerHTML = `
                <div class="aspect-video relative">
                    ${thumbHtml}
                    <span class="absolute top-1 left-1 bg-black/70 text-[10px] px-1.5 py-0.5 rounded mono text-white uppercase">${this._escape(mediaType)}</span>
                    <span class="absolute bottom-1 right-1 bg-black/70 text-[10px] px-1.5 py-0.5 rounded mono text-white">${this._escape(meta)}</span>
                </div>
                <div class="p-2">
                    <p class="text-[11px] font-medium truncate text-on-surface-variant group-hover:text-primary">${this._escape(id)}</p>
                </div>
                <div class="absolute inset-x-0 bottom-0 p-2 opacity-0 group-hover:opacity-100 transition-opacity flex justify-end gap-1 bg-gradient-to-t from-black/80 to-transparent">
                    ${primaryAction}
                    ${overlayAction}
                    <button class="btn-delete-source p-1 bg-red-500/20 text-red-500 rounded shadow-sm" data-id="${this._escapeAttr(id)}" title="Delete">
                        <span class="material-symbols-outlined text-sm" style="font-size: 14px;">delete</span>
                    </button>
                </div>
            `;

            if (isVideo) {
                el.addEventListener('dragstart', (event) => {
                    if (!event.dataTransfer) return;
                    event.dataTransfer.effectAllowed = 'copy';
                    event.dataTransfer.setData('application/x-graphcut-source-id', id);
                    event.dataTransfer.setData('text/plain', `graphcut-source:${id}`);
                    el.classList.add('opacity-60', 'scale-[0.98]');
                    this.app.setStatus(`Drop ${id} into the timeline to add a clip`, 1800);
                });
                el.addEventListener('dragend', () => {
                    el.classList.remove('opacity-60', 'scale-[0.98]');
                });
            }

            el.querySelector('.btn-add-clip')?.addEventListener('click', async () => {
                await this.app.api.addClip(id);
                await this.app.refreshState();
            });

            el.querySelector('.btn-trim-add')?.addEventListener('click', () => {
                this.app.components?.trimModal?.openForSource(id);
            });

            el.querySelector('.btn-use-overlay')?.addEventListener('click', async () => {
                try {
                    await this.app.api.updateSticker({
                        mode: 'asset',
                        source_id: id,
                        position: 'top-right',
                        scale: isImage ? 0.16 : 0.22,
                        opacity: 0.95,
                        start_time: 0,
                        end_time: null
                    });
                    await this.app.refreshState();
                    this.app.activateTab('overlays');
                    this.app.setStatus(`${id} is now ready as a sticker overlay`, 2400);
                } catch (err) {
                    alert(err.message || 'Failed to use this source as an overlay.');
                }
            });

            el.querySelector('.btn-assign-audio')?.addEventListener('click', () => {
                this.app.activateTab('overlays');
                this.app.setStatus('Pick narration or music in the right-side panel', 2400);
            });

            el.querySelector('.btn-delete-source')?.addEventListener('click', async () => {
                if (!confirm(`Delete ${id} from this project and remove its media file from disk (if it is inside this project)?`)) {
                    return;
                }
                document.getElementById('save-status').textContent = `Deleting ${id}...`;
                try {
                    this.app.updateProgress({
                        action: 'delete',
                        progress: 20,
                        eta: '--:--',
                        speed: 'working'
                    });
                    await this.app.api.removeSource(id, { deleteFile: true });
                    this.app.updateProgress({
                        action: 'delete',
                        progress: 100,
                        eta: '00:00',
                        speed: 'done'
                    });
                    await this.app.refreshState();
                } finally {
                    this.app.hideProgress(700);
                }
            });

            this.container.appendChild(el);
        });
    }

    _sourceMeta(info) {
        if (!info) return '';
        const duration = Number(info.duration_seconds || 0);
        if (info.media_type === 'audio') {
            return `${duration.toFixed(1)}s audio`;
        }
        if (info.media_type === 'image') {
            const dims = info.width && info.height ? `${info.width}x${info.height}` : 'overlay asset';
            return dims;
        }
        return `${duration.toFixed(1)}s clip`;
    }

    _fallbackPreview(mediaType) {
        const icon = mediaType === 'audio' ? 'audiotrack' : mediaType === 'image' ? 'image' : 'movie';
        return `
            <div class="w-full h-full bg-surface-container-high flex flex-col items-center justify-center text-on-surface-variant">
                <span class="material-symbols-outlined">${icon}</span>
            </div>
        `;
    }

    _escape(value) {
        return String(value).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
    }

    _escapeAttr(value) {
        return String(value).replaceAll('"', '&quot;');
    }
}
