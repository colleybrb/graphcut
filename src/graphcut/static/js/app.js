import { GraphCutAPI } from './api.js';
import { SourcePanel } from './components/source-panel.js';
import { ClipPanel } from './components/clip-panel.js';
import { TranscriptPanel } from './components/transcript-panel.js';
import { PreviewPanel } from './components/preview-panel.js';
import { AudioPanel } from './components/audio-panel.js';
import { ExportPanel } from './components/export-panel.js';

class App {
    constructor() {
        this.api = new GraphCutAPI();
        this.state = {
            project: null,
            sources: null,
            clips: null,
            transcript: null,
            audioConfig: null,
            overlays: null,
            presets: null,
            activeJob: null
        };
        this.components = {};
    }

    async init() {
        // Setup Progress tracking natively inside GUI state bounding WS configs dynamically
        const progressEl = document.getElementById('global-progress');
        const fillEl = document.getElementById('progress-fill');
        const textEl = document.getElementById('progress-label');
        const etaEl = document.getElementById('progress-eta');

        this.api.connectProgressStream((data) => {
            progressEl.style.display = 'flex';
            fillEl.style.width = `${data.progress}%`;
            textEl.textContent = `Rendering [${data.job_id}]... ${Math.round(data.progress)}%`;
            etaEl.textContent = `ETA: ${data.eta}`;
            
            if (data.progress >= 100) {
                setTimeout(() => { progressEl.style.display = 'none'; }, 2000);
            }
        });

        // Resolve component dependencies 
        this.components.sources = new SourcePanel(this);
        this.components.clips = new ClipPanel(this);
        this.components.transcript = new TranscriptPanel(this);
        this.components.preview = new PreviewPanel(this);
        this.components.audio = new AudioPanel(this);
        this.components.export = new ExportPanel(this);
        
        await this.refreshState();
        this.bindTabNavigation();
        console.log("App Initialized", this.state);
    }

    async refreshState() {
        try {
            document.getElementById('save-status').textContent = "Syncing with GraphCut CLI...";
            
            // Parallel fetches
            const [proj, srcs, clps, trx, aud, ovr, exp] = await Promise.all([
                this.api.getProject(),
                this.api.getSources(),
                this.api.getClips(),
                this.api.getTranscript(),
                this.api.getAudio(),
                this.api.getOverlays(),
                this.api.getExportPresets(),
            ]);

            this.state.project = proj;
            this.state.sources = srcs;
            this.state.clips = clps;
            this.state.transcript = trx;
            this.state.audioConfig = aud;
            this.state.overlays = ovr;
            this.state.presets = exp;
            
            // Notify components cleanly mapping DOM updates across boundary limits.
            Object.values(this.components).forEach(c => c.render());

            document.getElementById('save-status').textContent = "All changes saved";
        } catch(e) {
            document.getElementById('save-status').textContent = "Disconnected from CLI";
            console.error("State refresh failed", e);
        }
    }

    bindTabNavigation() {
        const tabs = document.querySelectorAll('.tab-btn');
        tabs.forEach(tab => {
            tab.addEventListener('click', (e) => {
                const target = e.target.dataset.tab;
                
                document.querySelectorAll('.tab-btn').forEach(t => t.classList.remove('active'));
                document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));
                
                e.target.classList.add('active');
                document.getElementById(`tab-${target}`).classList.add('active');
            });
        });
    }
}

document.addEventListener('DOMContentLoaded', () => {
    window.app = new App();
    window.app.init();
});
