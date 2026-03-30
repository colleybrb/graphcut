export class SourcePanel {
    constructor(app) {
        this.app = app;
        this.container = document.getElementById('source-list');
        // Add source handler
        document.getElementById('btn-add-source').addEventListener('click', () => {
            alert("File picker integration here depending on native browser extensions.");
        });
    }

    render() {
        if (!this.app.state.sources) return;
        this.container.innerHTML = '';
        Object.entries(this.app.state.sources).forEach(([id, info]) => {
            if (info.media_type !== 'video' && info.media_type !== 'audio') return;
            const el = document.createElement('div');
            el.className = 'media-item';
            el.innerHTML = `
                ${info.thumbnail ? `<img src="${info.thumbnail}" class="thumbnail" />` : `<div class="thumbnail"></div>`}
                <div class="media-info">
                    <div class="media-name">${id}</div>
                    <div class="media-meta">${(info.duration_seconds || 0).toFixed(1)}s • ${info.width}x${info.height}</div>
                </div>
                <button class="btn btn-sm btn-icon btn-add-clip" data-id="${id}">+</button>
            `;
            el.querySelector('.btn-add-clip').addEventListener('click', async () => {
                await this.app.api.addClip(id);
                this.app.refreshState();
            });
            this.container.appendChild(el);
        });
    }
}
