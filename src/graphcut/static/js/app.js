import { GraphCutAPI } from './api.js';
import { SourcePanel } from './components/source-panel.js';
import { EffectsPanel } from './components/effects-panel.js';
import { ClipPanel } from './components/clip-panel.js';
import { TranscriptPanel } from './components/transcript-panel.js';
import { PreviewPanel } from './components/preview-panel.js';
import { AudioPanel } from './components/audio-panel.js';
import { OverlaysPanel } from './components/overlays-panel.js';
import { ScenesPanel } from './components/scenes-panel.js';
import { ExportPanel } from './components/export-panel.js';
import { TrimModal } from './components/trim-modal.js';

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
            activeJob: null,
            activeClipIndex: null,
            activeTopNav: null,
            activeSidebar: 'media',
            libraryTab: 'media',
            activeTab: 'export',
            timelineZoom: 1
        };
        this.components = {};
        this.progress = {
            container: null,
            fill: null,
            label: null,
            eta: null,
            hideTimer: null
        };
        this.topNavPanel = {
            wrap: null,
            eyebrow: null,
            title: null,
            body: null,
            close: null
        };
        this.statusResetTimer = null;
    }

    async init() {
        this.progress.container = document.getElementById('global-progress');
        this.progress.fill = document.getElementById('progress-fill');
        this.progress.label = document.getElementById('progress-label');
        this.progress.eta = document.getElementById('progress-eta');
        this.topNavPanel.wrap = document.getElementById('topnav-panel-wrap');
        this.topNavPanel.eyebrow = document.getElementById('topnav-panel-eyebrow');
        this.topNavPanel.title = document.getElementById('topnav-panel-title');
        this.topNavPanel.body = document.getElementById('topnav-panel-body');
        this.topNavPanel.close = document.getElementById('topnav-panel-close');

        this.api.connectProgressStream((data) => {
            this.updateProgress({
                action: data.action || 'Working',
                progress: data.progress ?? 0,
                eta: data.eta || '--:--',
                speed: data.speed || '0.0'
            });

            if ((data.progress ?? 0) >= 100) {
                const action = (data.action || '').toLowerCase();
                const hideDelay = action.includes('failed') ? 8000 : 1500;
                this.hideProgress(hideDelay);
                window.dispatchEvent(new CustomEvent('graphcut:job-complete', { detail: data }));
            }
        });

        // Resolve component dependencies 
        this.components.sources = new SourcePanel(this);
        this.components.effects = new EffectsPanel(this);
        this.components.clips = new ClipPanel(this);
        this.components.transcript = new TranscriptPanel(this);
        this.components.preview = new PreviewPanel(this);
        this.components.audio = new AudioPanel(this);
        this.components.overlays = new OverlaysPanel(this);
        this.components.scenes = new ScenesPanel(this);
        this.components.export = new ExportPanel(this);
        this.components.trimModal = new TrimModal(this);
        
        await this.refreshState();
        this.bindTabNavigation();
        this.bindSidebarNavigation();
        this.bindHeaderActions();
        this.bindTopNavigation();
        this.bindTimelineZoom();
        this.activateTab(this.state.activeTab);
        this.applyLibraryTabState();
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
            if (!Array.isArray(this.state.clips) || this.state.clips.length === 0) {
                this.state.activeClipIndex = null;
            } else if (this.state.activeClipIndex === null) {
                this.state.activeClipIndex = 0;
            } else if (
                this.state.activeClipIndex !== null
                && (this.state.activeClipIndex < 0 || this.state.activeClipIndex >= this.state.clips.length)
            ) {
                this.state.activeClipIndex = Math.max(0, this.state.clips.length - 1);
            }
            
            // Notify components cleanly mapping DOM updates across boundary limits.
            Object.values(this.components).forEach(c => c.render());

            document.getElementById('save-status').textContent = "All changes saved";
        } catch(e) {
            document.getElementById('save-status').textContent = "Disconnected from CLI";
            console.error("State refresh failed", e);
        }
    }

    bindTabNavigation() {
        const tabs = document.querySelectorAll('[data-tab]');
        tabs.forEach(tab => {
            tab.addEventListener('click', (e) => {
                const target = e.currentTarget.dataset.tab;
                if (!target) return;
                this.activateTab(target);
            });
        });
    }

    bindSidebarNavigation() {
        const buttons = document.querySelectorAll('[data-sidebar]');
        buttons.forEach((button) => {
            button.addEventListener('click', () => {
                const target = button.dataset.sidebar;
                this.state.activeSidebar = target;
                if (target === 'media' || target === 'effects') {
                    this.activateLibraryTab(target);
                    return;
                }
                if (target === 'audio' || target === 'scenes') {
                    this.activateTab(target);
                }
            });
        });
    }

    bindHeaderActions() {
        const exportBtn = document.getElementById('btn-header-export');
        exportBtn?.addEventListener('click', () => {
            this.activateTab('export');
            this.closeTopPanel();
            this.activateTopNav(null);
            this.setStatus('Export presets ready', 2200);
        });

        const shareBtn = document.getElementById('btn-share-project');
        shareBtn?.addEventListener('click', async () => {
            const shareUrl = window.location.href;
            try {
                if (navigator.clipboard?.writeText) {
                    await navigator.clipboard.writeText(shareUrl);
                    this.setStatus('Project link copied', 2500);
                    return;
                }
            } catch (err) {
                console.warn('Clipboard copy failed, falling back to prompt.', err);
            }
            window.prompt('Copy this project URL:', shareUrl);
        });
    }

    bindTopNavigation() {
        document.querySelectorAll('[data-topnav]').forEach((button) => {
            button.addEventListener('click', async () => {
                const target = button.dataset.topnav;
                if (!target) return;
                await this.handleTopNavigation(target);
            });
        });

        this.topNavPanel.close?.addEventListener('click', () => {
            this.closeTopPanel();
            this.activateTopNav(null);
        });
    }

    activateTopNav(target) {
        this.state.activeTopNav = target;
        document.querySelectorAll('[data-topnav]').forEach((button) => {
            button.classList.toggle('active', button.dataset.topnav === target);
        });
    }

    openTopPanel({ eyebrow = 'Workspace', title = '', body = '' } = {}) {
        if (!this.topNavPanel.wrap || !this.topNavPanel.eyebrow || !this.topNavPanel.title || !this.topNavPanel.body) {
            return;
        }

        this.topNavPanel.eyebrow.textContent = eyebrow;
        this.topNavPanel.title.textContent = title;
        this.topNavPanel.body.innerHTML = body;
        this.topNavPanel.wrap.style.display = 'block';
        this.bindTopPanelActions();
    }

    closeTopPanel() {
        if (!this.topNavPanel.wrap || !this.topNavPanel.body) return;
        this.topNavPanel.wrap.style.display = 'none';
        this.topNavPanel.body.innerHTML = '';
    }

    scrollIntoView(selector) {
        const node = typeof selector === 'string' ? document.querySelector(selector) : selector;
        node?.scrollIntoView({ behavior: 'smooth', block: 'center', inline: 'nearest' });
    }

    async handleTopNavigation(target) {
        if (!target) return;

        if (this.state.activeTopNav === target && this.topNavPanel.wrap?.style.display !== 'none') {
            this.closeTopPanel();
            this.activateTopNav(null);
            return;
        }

        if (target === 'assets') {
            this.activateLibraryTab('media');
            this.activateTab('export');
            this.closeTopPanel();
            this.activateTopNav(target);
            this.scrollIntoView('#source-list');
            this.setStatus('Media library ready', 1800);
            return;
        }

        if (target === 'scenes') {
            this.activateTab('scenes');
            this.closeTopPanel();
            this.activateTopNav(target);
            this.scrollIntoView('#tab-scenes');
            this.setStatus('Scenes ready', 1800);
            return;
        }

        if (target === 'projects') {
            this.activateTopNav(target);
            this.openTopPanel(this.buildProjectPanel());
            return;
        }

        if (target === 'history') {
            this.activateTopNav(target);
            await this.showHistoryPanel();
        }
    }

    buildProjectPanel() {
        const project = this.state.project || {};
        const sources = Object.keys(this.state.sources || {}).length;
        const clips = Array.isArray(this.state.clips) ? this.state.clips.length : 0;
        const scenes = Object.keys(project.scenes || {}).length;
        const presets = Array.isArray(this.state.presets) ? this.state.presets.map((preset) => preset.name).join(', ') : '--';

        return {
            eyebrow: 'Workspace',
            title: project.name || 'Project',
            body: `
                <div class="grid grid-cols-1 md:grid-cols-4 gap-3">
                    <div class="rounded-xl border border-outline-variant/15 bg-surface-container-low p-4">
                        <div class="text-[10px] uppercase tracking-[0.18em] text-on-surface-variant">Sources</div>
                        <div class="mt-2 text-2xl font-bold text-on-surface">${sources}</div>
                    </div>
                    <div class="rounded-xl border border-outline-variant/15 bg-surface-container-low p-4">
                        <div class="text-[10px] uppercase tracking-[0.18em] text-on-surface-variant">Timeline Clips</div>
                        <div class="mt-2 text-2xl font-bold text-on-surface">${clips}</div>
                    </div>
                    <div class="rounded-xl border border-outline-variant/15 bg-surface-container-low p-4">
                        <div class="text-[10px] uppercase tracking-[0.18em] text-on-surface-variant">Scenes</div>
                        <div class="mt-2 text-2xl font-bold text-on-surface">${scenes}</div>
                    </div>
                    <div class="rounded-xl border border-outline-variant/15 bg-surface-container-low p-4">
                        <div class="text-[10px] uppercase tracking-[0.18em] text-on-surface-variant">Updated</div>
                        <div class="mt-2 text-sm font-semibold text-on-surface">${project.updated_at || '--'}</div>
                    </div>
                </div>
                <div class="mt-4 rounded-xl border border-outline-variant/15 bg-surface-container-low p-4">
                    <div class="text-[10px] uppercase tracking-[0.18em] text-on-surface-variant">Export Presets</div>
                    <div class="mt-2 text-sm text-on-surface">${presets}</div>
                </div>
                <div class="mt-4 flex flex-wrap gap-2">
                    <button class="topnav-panel-action px-3 py-2 rounded-lg bg-primary-container text-on-primary font-semibold" data-topnav-action="open-assets">Open Assets</button>
                    <button class="topnav-panel-action px-3 py-2 rounded-lg bg-surface-container-low border border-outline-variant/20 text-on-surface" data-topnav-action="open-scenes">Open Scenes</button>
                    <button class="topnav-panel-action px-3 py-2 rounded-lg bg-surface-container-low border border-outline-variant/20 text-on-surface" data-topnav-action="copy-link">Copy Link</button>
                </div>
            `
        };
    }

    async showHistoryPanel() {
        this.openTopPanel({
            eyebrow: 'Activity',
            title: 'Render History',
            body: '<div class="text-sm text-on-surface-variant">Loading recent jobs...</div>'
        });

        try {
            const jobs = await this.api.listJobs(10);
            const items = Array.isArray(jobs) ? jobs : [];
            const body = items.length === 0
                ? '<div class="text-sm text-on-surface-variant">No render jobs have been started yet.</div>'
                : items.map((job) => {
                    const statusTone = job.status === 'failed'
                        ? 'text-red-300 bg-red-500/10 border-red-500/20'
                        : job.status === 'succeeded'
                            ? 'text-emerald-300 bg-emerald-500/10 border-emerald-500/20'
                            : 'text-primary bg-primary/10 border-primary/20';
                    return `
                        <div class="rounded-xl border border-outline-variant/15 bg-surface-container-low p-4">
                            <div class="flex items-start justify-between gap-3">
                                <div>
                                    <div class="text-sm font-semibold text-on-surface">${job.preset || job.type || 'Render'}</div>
                                    <div class="mt-1 text-xs text-on-surface-variant">${job.output_filename || job.job_id}</div>
                                </div>
                                <span class="px-2 py-1 rounded-full border text-[10px] uppercase tracking-[0.18em] ${statusTone}">${job.status || 'queued'}</span>
                            </div>
                            <div class="mt-3 text-xs text-on-surface-variant">
                                <div>Progress: ${Number(job.last_progress ?? 0).toFixed(1)}%</div>
                                <div class="mt-1">Updated: ${job.updated_at || job.created_at || '--'}</div>
                            </div>
                        </div>
                    `;
                }).join('<div class="h-3"></div>');

            this.openTopPanel({
                eyebrow: 'Activity',
                title: 'Render History',
                body: body + `
                    <div class="mt-4 flex flex-wrap gap-2">
                        <button class="topnav-panel-action px-3 py-2 rounded-lg bg-primary-container text-on-primary font-semibold" data-topnav-action="open-history">Open Export Tab</button>
                        <button class="topnav-panel-action px-3 py-2 rounded-lg bg-surface-container-low border border-outline-variant/20 text-on-surface" data-topnav-action="refresh-history">Refresh</button>
                    </div>
                `
            });
        } catch (err) {
            this.openTopPanel({
                eyebrow: 'Activity',
                title: 'Render History',
                body: `<div class="text-sm text-red-300">${err.message || 'Failed to load render history.'}</div>`
            });
        }
    }

    activateTab(target) {
        this.state.activeTab = target;
        if (target === 'audio' || target === 'scenes') {
            this.state.activeSidebar = target;
        }

        document.querySelectorAll('[data-tab]').forEach((tab) => {
            tab.classList.toggle('active', tab.dataset.tab === target);
        });
        document.querySelectorAll('.tab-content').forEach((content) => {
            content.classList.toggle('active', content.id === `tab-${target}`);
        });

        this.syncSidebarState();
    }

    activateLibraryTab(target) {
        this.state.libraryTab = target;
        this.applyLibraryTabState();
        this.components.sources.render();
        this.components.effects.render();
    }

    applyLibraryTabState() {
        const sourceList = document.getElementById('source-list');
        const effectsList = document.getElementById('effects-list');
        if (sourceList) sourceList.style.display = this.state.libraryTab === 'media' ? 'block' : 'none';
        if (effectsList) effectsList.style.display = this.state.libraryTab === 'effects' ? 'block' : 'none';
        this.syncSidebarState();
    }

    syncSidebarState() {
        const sidebarButtons = document.querySelectorAll('[data-sidebar]');
        sidebarButtons.forEach((button) => {
            button.classList.toggle('active', button.dataset.sidebar === this.state.activeSidebar);
        });
    }

    bindTimelineZoom() {
        const zoom = document.getElementById('timeline-zoom');
        if (!zoom) return;
        zoom.addEventListener('input', (e) => {
            this.state.timelineZoom = Number(e.target.value || 1);
            this.components.clips.render();
        });
    }

    setActiveClip(index) {
        this.state.activeClipIndex = index;
        this.components.clips.render();
        this.components.effects.render();
    }

    setStatus(message, resetMs = 0) {
        const status = document.getElementById('save-status');
        if (!status) return;

        if (this.statusResetTimer) {
            clearTimeout(this.statusResetTimer);
            this.statusResetTimer = null;
        }

        status.textContent = message;
        if (resetMs > 0) {
            this.statusResetTimer = setTimeout(() => {
                status.textContent = 'All changes saved';
            }, resetMs);
        }
    }

    bindTopPanelActions() {
        this.topNavPanel.body?.querySelectorAll('[data-topnav-action]').forEach((button) => {
            button.addEventListener('click', async () => {
                const action = button.dataset.topnavAction;
                if (action === 'open-assets') {
                    this.closeTopPanel();
                    await this.handleTopNavigation('assets');
                    return;
                }
                if (action === 'open-scenes') {
                    this.closeTopPanel();
                    await this.handleTopNavigation('scenes');
                    return;
                }
                if (action === 'copy-link') {
                    document.getElementById('btn-share-project')?.click();
                    return;
                }
                if (action === 'open-history') {
                    this.activateTab('export');
                    this.closeTopPanel();
                    this.setStatus('Export history ready', 1800);
                    return;
                }
                if (action === 'refresh-history') {
                    await this.showHistoryPanel();
                }
            });
        });
    }

    updateProgress({ action = 'Working', progress = 0, eta = '--:--', speed = '0.0' } = {}) {
        if (!this.progress.container || !this.progress.fill || !this.progress.label || !this.progress.eta) {
            return;
        }
        if (this.progress.hideTimer) {
            clearTimeout(this.progress.hideTimer);
            this.progress.hideTimer = null;
        }

        const pct = Math.max(0, Math.min(100, Number(progress) || 0));
        this.progress.container.style.display = 'flex';
        this.progress.fill.style.width = `${pct}%`;
        this.progress.label.textContent = `${action}: ${pct.toFixed(1)}%`;
        this.progress.eta.textContent = `ETA: ${eta} | Speed: ${speed}`;
    }

    hideProgress(delayMs = 0) {
        if (!this.progress.container) return;
        if (this.progress.hideTimer) {
            clearTimeout(this.progress.hideTimer);
            this.progress.hideTimer = null;
        }
        const hide = () => {
            if (this.progress.container) {
                this.progress.container.style.display = 'none';
            }
            if (this.progress.fill) {
                this.progress.fill.style.width = '0%';
            }
        };
        if (delayMs > 0) {
            this.progress.hideTimer = setTimeout(hide, delayMs);
            return;
        }
        hide();
    }
}

document.addEventListener('DOMContentLoaded', () => {
    window.app = new App();
    window.app.init();
});
