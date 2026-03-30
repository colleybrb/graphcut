export class ClipPanel {
    constructor(app) {
        this.app = app;
        this.container = document.getElementById('clip-list');
        this.dragSrcEl = null;
    }

    render() {
        if (!this.app.state.clips) return;
        this.container.innerHTML = '';
        
        this.app.state.clips.forEach((clip, index) => {
            const sid = clip.source_id;
            const info = this.app.state.sources?.[sid];
            if (!info) return;

            const el = document.createElement('div');
            el.className = 'media-item';
            el.draggable = true;
            el.dataset.index = index;

            let durStr = '?s';
            if (clip.end_time_seconds) {
                durStr = (clip.end_time_seconds - (clip.start_time_seconds || 0)).toFixed(1) + 's';
            } else if (info.duration_seconds) {
                durStr = info.duration_seconds.toFixed(1) + 's';
            }

            el.innerHTML = `
                <div style="font-size:0.8rem;color:var(--text-muted);font-weight:bold">${index + 1}</div>
                ${info.thumbnail ? `<img src="${info.thumbnail}" class="thumbnail" />` : `<div class="thumbnail"></div>`}
                <div class="media-info">
                    <div class="media-name">${sid}</div>
                    <div class="media-meta">${durStr}</div>
                </div>
                <button class="btn btn-sm btn-icon btn-remove" data-index="${index}">x</button>
            `;

            // Drag behaviors
            el.addEventListener('dragstart', (e) => this.dragStart(e));
            el.addEventListener('dragover', (e) => this.dragOver(e));
            el.addEventListener('drop', (e) => this.drop(e));
            el.addEventListener('dragenter', (e) => e.target.closest('.media-item')?.classList.add('drag-over'));
            el.addEventListener('dragleave', (e) => e.target.closest('.media-item')?.classList.remove('drag-over'));

            el.querySelector('.btn-remove').addEventListener('click', async () => {
                // Mock deletion by re-saving without index
                const newOrder = [...this.app.state.clips];
                newOrder.splice(index, 1);
                await this.app.api.reorderClips(newOrder.map((_, i) => i)); // Assuming API handles direct payload replacement if indices mapped
                this.app.refreshState();
            });

            this.container.appendChild(el);
        });
    }

    dragStart(e) {
        this.dragSrcEl = e.currentTarget;
        e.dataTransfer.effectAllowed = 'move';
        e.dataTransfer.setData('text/plain', this.dragSrcEl.dataset.index);
    }

    dragOver(e) {
        e.preventDefault();
        e.dataTransfer.dropEffect = 'move';
        return false;
    }

    async drop(e) {
        e.stopPropagation();
        e.preventDefault();
        
        const target = e.currentTarget;
        target.classList.remove('drag-over');

        if (this.dragSrcEl !== target) {
            const dragIndex = parseInt(this.dragSrcEl.dataset.index);
            const dropIndex = parseInt(target.dataset.index);
            
            // Generate basic new list by swapping array pos
            const current = [...this.app.state.clips];
            const item = current.splice(dragIndex, 1)[0];
            current.splice(dropIndex, 0, item);
            
            // Map the old indices to new layout simply sending raw arrays. 
            // The API expects indices.
            const newIndices = current.map(x => this.app.state.clips.indexOf(x));
            
            await this.app.api.reorderClips(newIndices);
            this.app.refreshState();
        }
    }
}
