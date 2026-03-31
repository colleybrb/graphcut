export class SourcePanel {
    constructor(app) {
        this.app = app;
        this.container = document.getElementById('source-list');
        // Add source handler via hidden file input
        document.getElementById('btn-add-source').addEventListener('click', () => {
            const input = document.createElement('input');
            input.type = 'file';
            input.accept = 'video/*,audio/*';
            input.multiple = true;
            input.onchange = async (e) => {
                const files = Array.from(e.target.files);
                if (files.length === 0) return;
                
                document.getElementById('save-status').textContent = `Uploading ${files.length} file(s)...`;
                try {
                    this.app.updateProgress({
                        action: 'upload',
                        progress: 0,
                        eta: '--:--',
                        speed: `${files.length} file(s)`
                    });
                    for (let i = 0; i < files.length; i++) {
                        const f = files[i];
                        await this.app.api.uploadSource(f);
                        this.app.updateProgress({
                            action: 'upload',
                            progress: ((i + 1) / files.length) * 100,
                            eta: '--:--',
                            speed: `${i + 1}/${files.length}`
                        });
                    }
                } finally {
                    this.app.hideProgress(900);
                }
                this.app.refreshState();
            };
            input.click();
        });
    }

    render() {
        if (!this.app.state.sources) return;
        this.container.innerHTML = '';
        Object.entries(this.app.state.sources).forEach(([id, info]) => {
            if (info.media_type !== 'video' && info.media_type !== 'audio') return;
            const el = document.createElement('div');
            el.className = 'group relative bg-surface-container rounded-lg overflow-hidden border border-transparent hover:border-primary/30 transition-all cursor-grab active:cursor-grabbing';
            el.draggable = true;
            el.title = 'Drag this source into the timeline to insert a clip';

            const meta = info.media_type === 'audio'
                ? `${(info.duration_seconds || 0).toFixed(1)}s`
                : `${(info.duration_seconds || 0).toFixed(1)}s`;

            const thumbHtml = info.thumbnail 
                ? `<img src="${info.thumbnail}" class="w-full h-full object-cover grayscale group-hover:grayscale-0 transition-all duration-500" />` 
                : `<div class="w-full h-full bg-surface-container-high flex flex-col items-center justify-center text-on-surface-variant"><span class="material-symbols-outlined">audiotrack</span></div>`;

            el.innerHTML = `
                <div class="aspect-video relative">
                    ${thumbHtml}
                    <span class="absolute bottom-1 right-1 bg-black/70 text-[10px] px-1.5 py-0.5 rounded mono text-white">${meta}</span>
                </div>
                <div class="p-2">
                    <p class="text-[11px] font-medium truncate text-on-surface-variant group-hover:text-primary">${id}</p>
                </div>
                <div class="absolute inset-x-0 bottom-0 p-2 opacity-0 group-hover:opacity-100 transition-opacity flex justify-end gap-1 bg-gradient-to-t from-black/80 to-transparent">
                    <button class="btn-trim-add p-1 text-on-surface-variant hover:text-primary bg-surface-container-high rounded shadow-sm" data-id="${id}" title="Trim"><span class="material-symbols-outlined text-sm" style="font-size: 14px;">content_cut</span></button>
                    <button class="btn-add-clip p-1 bg-primary text-on-primary rounded font-bold hover:bg-primary-container shadow-sm" data-id="${id}" title="Add to Timeline"><span class="material-symbols-outlined text-sm" style="font-size: 14px;">add</span></button>
                    <button class="btn-delete-source p-1 bg-red-500/20 text-red-500 rounded shadow-sm" data-id="${id}" title="Delete"><span class="material-symbols-outlined text-sm" style="font-size: 14px;">delete</span></button>
                </div>
            `;
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
            el.querySelector('.btn-add-clip').addEventListener('click', async () => {
                await this.app.api.addClip(id);
                this.app.refreshState();
            });
            el.querySelector('.btn-trim-add').addEventListener('click', async () => {
                this.app.components?.trimModal?.openForSource(id);
            });
            el.querySelector('.btn-delete-source').addEventListener('click', async () => {
                if (confirm(`Delete ${id} from this project and remove its media file from disk (if it is inside this project)?`)) {
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
                    } finally {
                        this.app.hideProgress(700);
                    }
                    this.app.refreshState();
                }
            });
            this.container.appendChild(el);
        });
    }
}
