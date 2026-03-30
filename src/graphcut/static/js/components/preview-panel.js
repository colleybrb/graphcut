export class PreviewPanel {
    constructor(app) {
        this.app = app;
        this.container = document.getElementById('preview-container');
        document.getElementById('btn-render-preview').addEventListener('click', async () => {
            const btn = document.getElementById('btn-render-preview');
            btn.textContent = "Rendering Initial Preview...";
            btn.disabled = true;
            try {
                // Mock functionality triggering backend render for preview config
                await this.app.api.triggerExport("YouTube", "draft");
                btn.textContent = "Check Progress Bar";
            } catch(e) {
                btn.textContent = "Failed";
            }
        });
    }

    render() {
        // In a real app we would query the build_dir for existing preview MP4s.
        // For now, if active job triggers, we just display the loading bounds
        const p = this.app.state.project;
        if (!p) return;
        
        // This handles preview hydration via DOM injections
        // <video src="/api/export/download/preview.mp4" controls></video>
    }
}
