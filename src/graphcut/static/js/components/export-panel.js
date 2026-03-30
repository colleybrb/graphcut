export class ExportPanel {
    constructor(app) {
        this.app = app;
        this.container = document.getElementById('tab-export');
    }

    render() {
        if (!this.app.state.presets) return;

        let html = `
            <div class="form-group mb-lg" style="margin-bottom:20px">
                <label>Export Quality (CRF/Bitrate target)</label>
                <select id="export-quality" class="form-control">
                    <option value="draft">Draft (Ultrafast, Low Q)</option>
                    <option value="preview">Preview (Fast, Med Q)</option>
                    <option value="final" selected>Final (Slow, High Q)</option>
                </select>
            </div>
            <div class="export-grid">
        `;

        this.app.state.presets.forEach(p => {
            html += `
                <button class="btn btn-export" data-preset="${p.name}">
                    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path><polyline points="7 10 12 15 17 10"></polyline><line x1="12" y1="15" x2="12" y2="3"></line></svg>
                    <strong>${p.name}</strong>
                    <div class="export-meta">${p.width}x${p.height} (${p.aspect_ratio})</div>
                </button>
            `;
        });

        html += `</div>
            <button class="btn btn-primary" style="margin-top:20px;width:100%" id="btn-export-all">Export All Presets</button>
        `;

        this.container.innerHTML = html;
        this.bindEvents();
    }

    bindEvents() {
        const quality = () => document.getElementById('export-quality').value;

        this.container.querySelectorAll('.btn-export').forEach(btn => {
            btn.addEventListener('click', async (e) => {
                const target = e.currentTarget.dataset.preset;
                await this.app.api.triggerExport(target, quality());
                alert(`Export for ${target} started! See bottom bar for progress.`);
            });
        });

        document.getElementById('btn-export-all')?.addEventListener('click', async () => {
            for (const p of this.app.state.presets) {
                await this.app.api.triggerExport(p.name, quality());
            }
            alert("Export queue started!");
        });
    }
}
