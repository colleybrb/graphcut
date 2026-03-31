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
            pipelineCapabilities: null,
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
            const [proj, srcs, clps, trx, aud, ovr, exp, pipeline] = await Promise.all([
                this.api.getProject(),
                this.api.getSources(),
                this.api.getClips(),
                this.api.getTranscript(),
                this.api.getAudio(),
                this.api.getOverlays(),
                this.api.getExportPresets(),
                this.api.getPipelineCapabilities(),
            ]);

            this.state.project = proj;
            this.state.sources = srcs;
            this.state.clips = clps;
            this.state.transcript = trx;
            this.state.audioConfig = aud;
            this.state.overlays = ovr;
            this.state.presets = exp;
            this.state.pipelineCapabilities = pipeline;
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

        if (target === 'pipeline') {
            this.activateTopNav(target);
            this.openTopPanel(this.buildPipelinePanel());
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

    buildPipelinePanel() {
        const pipeline = this.state.pipelineCapabilities || {};
        const providers = Array.isArray(pipeline.providers) && pipeline.providers.length > 0 ? pipeline.providers : ['mock'];
        const platforms = Array.isArray(pipeline.platforms) ? pipeline.platforms : [];
        const recipes = Array.isArray(pipeline.recipes) ? pipeline.recipes : [];
        const features = pipeline.features || {};
        const inspectorPayload = this.buildNodeInspectorPayload();
        const inspectorJson = this.escapeHtml(JSON.stringify(inspectorPayload, null, 2));
        const commandRows = [
            {
                command: 'storyboard',
                detail: 'Script to provider-agnostic shot prompts with visual prompt, camera move, on-screen text, and aspect ratio.'
            },
            {
                command: 'generate',
                detail: 'Submits a storyboard or raw script to a video provider and can wait plus fetch in one pass.'
            },
            {
                command: 'queue submit/list/status/wait/fetch',
                detail: 'Full job lifecycle control for generation tasks from submission through download.'
            },
            {
                command: 'package',
                detail: 'Turns a source asset into publish-ready metadata: titles, descriptions, hashtags, and hook variants.'
            },
            {
                command: 'viralize',
                detail: 'Plans or renders short-form cuts and emits the publishing bundle in the same workflow.'
            },
            {
                command: 'creator-brief',
                detail: 'Recommends the best GraphCut workflow for a given source file and content shape.'
            }
        ];
        const featureRoutes = {
            source_files: { action: 'open-assets' },
            scene_detection: { action: 'copy-command', command: 'graphcut detect-scenes <project_dir>' },
            transcription: { action: 'open-transcript' },
            timeline_builder: { action: 'open-assets' },
            audio_normalization: { action: 'open-audio' },
            caption_overlay: { action: 'open-overlays' },
            transitions: { action: 'open-effects' },
            platform_presets: { action: 'open-export' },
            ffmpeg_render: { action: 'open-export' },
            multi_format_export: { action: 'open-export' },
            generation_queue: { action: 'copy-command', command: 'graphcut queue list --json' },
            provider_adapters: { action: 'copy-command', command: 'graphcut providers list --json' },
            agent_templates: { action: 'copy-command', command: 'graphcut agent template viralize --json' },
            creator_brief: { action: 'copy-command', command: 'graphcut creator brief <source_file> --json' },
            preview_surface: { action: 'open-preview' },
            node_inspector: { action: 'copy-inspector' },
        };
        const featureColumns = {
            ingest: ['source_files', 'scene_detection', 'transcription'],
            compose: ['timeline_builder', 'audio_normalization', 'caption_overlay', 'transitions'],
            deliver: ['platform_presets', 'ffmpeg_render', 'multi_format_export'],
        };
        const agentCards = [
            { label: 'Storyboard Agent', sub: 'CLI live', copy: 'graphcut storyboard, provider-agnostic shot planning.' },
            { label: 'Generate Queue', sub: 'CLI live', copy: 'graphcut generate + queue lifecycle backed by the mock provider today.' },
            { label: 'Creator Brief', sub: 'CLI live', copy: 'Recommended workflow + next actions from source analysis.' },
            { label: 'External Agents', sub: 'Integration-ready', copy: 'JSON in/out contracts for orchestrators or custom SDK agents.' },
        ];
        const recipeSummary = recipes.slice(0, 3).map((recipe) => recipe.label).join(' • ') || 'Podcast Clips • Talking Head • Reaction Clips';
        const platformSummary = platforms.slice(0, 4).map((platform) => platform.label).join(' • ') || 'TikTok • Reels • Shorts • YouTube';

        return {
            eyebrow: 'Creator System',
            title: 'Creator Agent Pipeline',
            body: `
                <div class="gc-stack">
                    <div class="gc-panel-anchorbar">
                        <button class="topnav-panel-action gc-scope-btn active" data-topnav-action="scroll-panel" data-section="workspace">Console Shell</button>
                        <button class="topnav-panel-action gc-scope-btn" data-topnav-action="scroll-panel" data-section="architecture">Architecture</button>
                        <button class="topnav-panel-action gc-scope-btn" data-topnav-action="scroll-panel" data-section="inspector">Node Inspector</button>
                        <button class="topnav-panel-action gc-scope-btn" data-topnav-action="scroll-panel" data-section="toolfit">Tool Fit</button>
                    </div>

                    <section class="gc-section-card" data-pipeline-section="workspace">
                        <div class="gc-eyebrow">Console Workspace</div>
                        <div class="gc-title-row">
                            <strong class="text-sm text-on-surface">A cohesive home for the CLI-first creator workflow</strong>
                            <span class="gc-setting-value">${providers.length} provider${providers.length === 1 ? '' : 's'}</span>
                        </div>
                        <p class="gc-copy" style="margin-top:0.45rem;">
                            This workspace frames the actual GraphCut agent flow inside the GUI: terminal-first commands, queue lifecycle control, publishing recipes, and clear jump points back into the editor.
                        </p>
                        <div class="gc-shell-layout" style="margin-top:1rem;">
                            <aside class="gc-sidebar-shell">
                                <div class="gc-sidebar-logo">
                                    <strong>GraphCut CLI</strong>
                                    <span>Workflow Agent v4.1</span>
                                </div>
                                <div class="gc-side-nav">
                                    <button class="topnav-panel-action active" data-topnav-action="scroll-panel" data-section="workspace"><span class="material-symbols-outlined text-sm">folder_open</span> Root</button>
                                    <button class="topnav-panel-action" data-topnav-action="open-assets"><span class="material-symbols-outlined text-sm">inventory_2</span> Assets</button>
                                    <button class="topnav-panel-action" data-topnav-action="copy-command" data-command="graphcut storyboard --text &quot;Hook first. Then show the payoff.&quot; --json"><span class="material-symbols-outlined text-sm">terminal</span> Scripts</button>
                                    <button class="topnav-panel-action" data-topnav-action="scroll-panel" data-section="architecture"><span class="material-symbols-outlined text-sm">settings</span> Environment</button>
                                    <button class="topnav-panel-action" data-topnav-action="open-history"><span class="material-symbols-outlined text-sm">receipt_long</span> Logs</button>
                                </div>
                                <button class="topnav-panel-action gc-exec-btn" data-topnav-action="copy-command" data-command="graphcut generate --text &quot;Hook first. Then show the payoff.&quot; --provider mock --fetch --json">Execute</button>
                            </aside>

                            <div class="gc-shell-main">
                                <div class="gc-shell-topnav">
                                    <div class="gc-shell-tabs">
                                        <button class="topnav-panel-action gc-shell-tab" data-topnav-action="scroll-panel" data-section="workspace">Console</button>
                                        <button class="topnav-panel-action gc-shell-tab" data-topnav-action="scroll-panel" data-section="architecture">Docs</button>
                                        <button class="topnav-panel-action gc-shell-tab" data-topnav-action="open-assets">Assets</button>
                                        <button class="topnav-panel-action gc-shell-tab" data-topnav-action="open-export">Deployment</button>
                                    </div>
                                    <div class="gc-shell-tools">
                                        <input class="gc-shell-search" value="" placeholder="Search cluster..." readonly>
                                        <button class="gc-shell-mini-btn topnav-panel-action" data-topnav-action="copy-inspector"><span class="material-symbols-outlined text-sm">code</span></button>
                                        <button class="gc-shell-mini-btn topnav-panel-action" data-topnav-action="scroll-panel" data-section="inspector"><span class="material-symbols-outlined text-sm">visibility</span></button>
                                        <button class="gc-shell-mini-btn topnav-panel-action" data-topnav-action="scroll-panel" data-section="architecture"><span class="material-symbols-outlined text-sm">settings</span></button>
                                        <button class="topnav-panel-action gc-exec-btn" data-topnav-action="copy-command" data-command="graphcut viralize podcast.mp4 --recipe podcast --clips 8 --render">Execute</button>
                                    </div>
                                </div>

                                <section class="gc-terminal-card">
                                    <div class="gc-terminal-topbar">
                                        <div class="gc-terminal-dots">
                                            <span class="gc-terminal-dot red"></span>
                                            <span class="gc-terminal-dot yellow"></span>
                                            <span class="gc-terminal-dot green"></span>
                                        </div>
                                        <div class="gc-terminal-label">graphcut-cli • workflow-agent • node v20.10.0</div>
                                    </div>
                                    <div class="gc-terminal-body">
                                        <span class="gc-terminal-line"><span class="gc-terminal-prompt">$</span> graphcut storyboard --text "Hook first. Then show the payoff." --json &gt; storyboard.json</span>
                                        <span class="gc-terminal-line gc-terminal-comment">Generating narrative structural metadata...</span>
                                        <span class="gc-terminal-line" style="margin-top:0.7rem;"><span class="gc-terminal-prompt">$</span> graphcut generate --storyboard storyboard.json --provider mock --fetch --json</span>
                                        <span class="gc-terminal-line">{</span>
                                        <span class="gc-terminal-line">  <span class="gc-terminal-json-key">"status"</span>: <span class="gc-terminal-json-string">"success"</span>,</span>
                                        <span class="gc-terminal-line">  <span class="gc-terminal-json-key">"workflow_id"</span>: <span class="gc-terminal-json-string">"gen-bf-99"</span>,</span>
                                        <span class="gc-terminal-line">  <span class="gc-terminal-json-key">"artifacts"</span>: [</span>
                                        <span class="gc-terminal-line">    { <span class="gc-terminal-json-key">"type"</span>: <span class="gc-terminal-json-string">"video clip"</span>, <span class="gc-terminal-json-key">"path"</span>: <span class="gc-terminal-json-string">"./assets/hook_01.mp4"</span> },</span>
                                        <span class="gc-terminal-line">    { <span class="gc-terminal-json-key">"type"</span>: <span class="gc-terminal-json-string">"metadata"</span>, <span class="gc-terminal-json-key">"path"</span>: <span class="gc-terminal-json-string">"./build/manifest.json"</span> }</span>
                                        <span class="gc-terminal-line">  ]</span>
                                        <span class="gc-terminal-line">}</span>
                                        <span class="gc-terminal-line" style="margin-top:0.8rem;"><span class="gc-terminal-prompt">$</span> graphcut viralize podcast.mp4 --recipe podcast --clips 8 --render</span>
                                        <span class="gc-terminal-line gc-terminal-comment">• Analyzing spatial audio cues...</span>
                                        <span class="gc-terminal-line gc-terminal-comment">• Processing viral hooks with Kinetic Engine...</span>
                                        <span class="gc-terminal-line gc-terminal-comment">• Rendering 4K H.265 frames...</span>
                                        <div class="gc-terminal-progress">
                                            <span>rendering</span>
                                            <div class="gc-terminal-progressbar"><span></span></div>
                                            <span>82%</span>
                                        </div>
                                    </div>
                                </section>

                                <section class="gc-feature-grid">
                                    <article class="gc-feature-card">
                                        <span class="material-symbols-outlined text-primary" style="font-size:18px;">flash_on</span>
                                        <strong>Instant Storyboarding</strong>
                                        <p>Convert text prompts into structured visual arcs using provider-agnostic shot planning.</p>
                                    </article>
                                    <article class="gc-feature-card">
                                        <span class="material-symbols-outlined text-primary" style="font-size:18px;">movie</span>
                                        <strong>Kinetic Rendering</strong>
                                        <p>Headless generation plus queue control for clips, storyboards, and packaging workflows.</p>
                                    </article>
                                    <article class="gc-feature-card">
                                        <span class="material-symbols-outlined text-primary" style="font-size:18px;">cloud_upload</span>
                                        <strong>Deployment Hooks</strong>
                                        <p>Publish bundles and local outputs are ready to hand off to external storage or social pipelines.</p>
                                    </article>
                                </section>
                            </div>
                        </div>
                    </section>

                    <section class="gc-section-card">
                        <div class="gc-eyebrow">Command Map</div>
                        <div class="mt-3 overflow-x-auto">
                            <table class="gc-command-table">
                                <thead>
                                    <tr>
                                        <th>Command</th>
                                        <th>What It Does</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    ${commandRows.map((row) => `
                                        <tr>
                                            <td><span class="gc-command-name">${row.command}</span></td>
                                            <td>${row.detail}</td>
                                        </tr>
                                    `).join('')}
                                </tbody>
                            </table>
                        </div>
                        <div class="gc-copy" style="margin-top:0.85rem;">Recipes in this build: ${this.escapeHtml(recipeSummary)}. Platform presets: ${this.escapeHtml(platformSummary)}.</div>
                    </section>

                    <section class="gc-section-card" data-pipeline-section="architecture">
                        <div class="gc-eyebrow">Protocol Architecture</div>
                        <div class="gc-title-row">
                            <strong class="text-sm text-on-surface">Automate cinematic assembly with generative intelligence</strong>
                            <span class="gc-setting-value">JSON in / out</span>
                        </div>
                        <p class="gc-copy" style="margin-top:0.45rem;">
                            This view translates the architecture diagram into actual product surfaces. Every claimed capability is either linked into the GUI, exposed through the CLI, or labeled integration-ready when it depends on external adapters.
                        </p>
                        <div class="gc-architecture-grid" style="margin-top:1rem;">
                            <div>
                                <div class="gc-arch-frame">
                                    <div class="gc-arch-title">Agent Layer</div>
                                    <div class="gc-agent-row">
                                        ${agentCards.map((card) => `
                                            <div class="gc-agent-card">
                                                <strong>${card.label}</strong>
                                                <span>${card.sub}</span>
                                                <span>${card.copy}</span>
                                            </div>
                                        `).join('')}
                                    </div>
                                    <div class="gc-json-bridge">JSON in/out</div>
                                </div>

                                <div class="gc-core-board">
                                    <div class="gc-core-header">GraphCut Core</div>
                                    <div class="gc-core-columns">
                                        ${Object.entries(featureColumns).map(([column, keys]) => `
                                            <div class="gc-core-col">
                                                <h4>${column}</h4>
                                                <div class="gc-core-list">
                                                    ${keys.map((key) => this.renderPipelineFeature(features[key], featureRoutes[key])).join('')}
                                                </div>
                                            </div>
                                        `).join('')}
                                    </div>
                                    <div class="gc-core-footer">
                                        <div><strong style="color:#e2e2ea;">Generation Queue (Provider-agnostic)</strong></div>
                                        <div class="gc-provider-row">
                                            ${providers.map((provider) => `<span class="gc-provider-chip">${this.escapeHtml(provider)}</span>`).join('')}
                                            <span class="gc-provider-chip">Adapters plug in</span>
                                        </div>
                                    </div>
                                </div>
                            </div>

                            <aside class="gc-interface-card" data-pipeline-section="inspector">
                                <div class="gc-arch-title">Interface</div>
                                <div class="gc-interface-preview"></div>
                                <ul class="gc-interface-list">
                                    <li><span class="material-symbols-outlined text-primary" style="font-size:16px;">check_circle</span><span><strong style="color:#e2e2ea;">Preview Surface</strong><br>Mapped to the existing preview panel and draft render flow.</span></li>
                                    <li><span class="material-symbols-outlined text-primary" style="font-size:16px;">check_circle</span><span><strong style="color:#e2e2ea;">Node Inspector</strong><br>Live project graph snapshot from the current GUI state.</span></li>
                                    <li><span class="material-symbols-outlined text-primary" style="font-size:16px;">check_circle</span><span><strong style="color:#e2e2ea;">Launch Dashboard</strong><br>Jump back into the editor surfaces that own each pipeline step.</span></li>
                                </ul>
                                <div class="flex flex-wrap gap-2">
                                    <button class="topnav-panel-action px-3 py-2 rounded-lg bg-primary-container text-on-primary font-semibold" data-topnav-action="open-preview">Launch Dashboard</button>
                                    <button class="topnav-panel-action px-3 py-2 rounded-lg bg-surface-container-low border border-outline-variant/20 text-on-surface" data-topnav-action="copy-inspector">Copy Node JSON</button>
                                </div>
                                <pre class="gc-json-view">${inspectorJson}</pre>
                            </aside>
                        </div>
                    </section>

                    <section class="gc-toolfit-panel" data-pipeline-section="toolfit">
                        <div class="gc-eyebrow">Pick The Right Tool</div>
                        <div class="gc-title-row">
                            <strong class="text-sm text-on-surface">Technical placement for engineering clarity</strong>
                            <span class="gc-setting-value">GraphCut highlighted</span>
                        </div>
                        <p class="gc-copy" style="margin-top:0.45rem;">
                            GraphCut sits in the creator-outcomes / batch-processing quadrant: agent-first post-production automation, not a full streaming stack or a low-level NLE primitive layer.
                        </p>
                        <div class="gc-toolfit-chart" style="margin-top:1rem;">
                            <div class="gc-toolfit-axis top">Creator Outcomes</div>
                            <div class="gc-toolfit-axis bottom">Engine Primitives</div>
                            <div class="gc-toolfit-axis left">Batch / Offline</div>
                            <div class="gc-toolfit-axis right">Real-time / Streaming</div>

                            <div class="gc-tool-node active" style="left:28%;top:28%;">
                                <div class="dot">G</div>
                                <strong>GraphCut</strong>
                                <span>Agent-first creator automation</span>
                            </div>
                            <div class="gc-tool-node secondary" style="left:43%;top:38%;">
                                <div class="dot">&lt;/&gt;</div>
                                <strong>Remotion</strong>
                                <span>Video as React code</span>
                            </div>
                            <div class="gc-tool-node other" style="left:74%;top:30%;">
                                <div class="dot">C</div>
                                <strong>ComfyUI</strong>
                                <span>Generative graph workflows</span>
                            </div>
                            <div class="gc-tool-node muted" style="left:26%;top:49%;">
                                <div class="dot"></div>
                                <strong>auto-editor</strong>
                                <span>Silence removal specialist</span>
                            </div>
                            <div class="gc-tool-node muted" style="left:22%;top:78%;">
                                <div class="dot"></div>
                                <strong>MLT</strong>
                                <span>NLE engine primitives</span>
                            </div>
                            <div class="gc-tool-node muted" style="left:77%;top:82%;">
                                <div class="dot"></div>
                                <strong>GStreamer</strong>
                                <span>Live media systems</span>
                            </div>
                        </div>

                        <div class="gc-feature-grid" style="margin-top:1rem;">
                            <article class="gc-feature-card" style="border-color:rgba(37,226,235,0.24);">
                                <strong>Use GraphCut When...</strong>
                                <p>You need an AI agent to go from raw footage or script to posted content without living in a full NLE. This is the autonomous rendering layer.</p>
                            </article>
                            <article class="gc-feature-card">
                                <strong>Compose With...</strong>
                                <p>ComfyUI for generation, Remotion for deterministic code-driven motion, and external storage or publish queues for deployment handoff.</p>
                            </article>
                            <article class="gc-feature-card" style="border-color:rgba(255, 107, 107, 0.18);">
                                <strong>Use Something Else When...</strong>
                                <p>You need real-time streaming, native Premiere interoperability, multitrack NLE semantics, or ultra-low-level media graph control.</p>
                            </article>
                        </div>
                    </section>
                </div>
            `
        };
    }

    renderPipelineFeature(feature, route = {}) {
        if (!feature) return '';
        const statusClass = feature.status === 'gui'
            ? 'gc-status-gui'
            : feature.status === 'cli'
                ? 'gc-status-cli'
                : 'gc-status-integration';
        const statusLabel = feature.status === 'gui'
            ? 'GUI'
            : feature.status === 'cli'
                ? 'CLI'
                : 'Adapter';
        const actionAttr = route.action ? `data-topnav-action="${route.action}"` : '';
        const commandAttr = route.command ? `data-command="${this.escapeAttr(route.command)}"` : '';
        return `
            <button class="gc-core-item topnav-panel-action" style="width:100%; text-align:left;" ${actionAttr} ${commandAttr}>
                <strong>${this.escapeHtml(feature.label)}</strong>
                <span class="gc-status-badge ${statusClass}">${statusLabel}</span>
            </button>
        `;
    }

    buildNodeInspectorPayload() {
        const project = this.state.project || {};
        const sources = this.state.sources || {};
        const clips = Array.isArray(this.state.clips) ? this.state.clips : [];
        const activeClipIndex = Number.isInteger(this.state.activeClipIndex) ? this.state.activeClipIndex : null;
        const selectedClip = activeClipIndex !== null ? clips[activeClipIndex] || null : null;
        return {
            project: {
                name: project.name || null,
                updated_at: project.updated_at || null,
                active_scene: project.active_scene || null,
                sources: Object.keys(sources).length,
                clips: clips.length,
            },
            selection: {
                active_clip_index: activeClipIndex,
                selected_clip: selectedClip,
            },
            source_manifest: Object.entries(sources).slice(0, 8).map(([id, info]) => ({
                id,
                media_type: info.media_type,
                duration_seconds: Number(info.duration_seconds || 0),
            })),
            overlays: this.state.overlays,
            audio_mix: this.state.audioConfig,
            pipeline: {
                providers: this.state.pipelineCapabilities?.providers || [],
                workflows: this.state.pipelineCapabilities?.workflows || [],
            },
        };
    }

    escapeHtml(value) {
        return String(value)
            .replaceAll('&', '&amp;')
            .replaceAll('<', '&lt;')
            .replaceAll('>', '&gt;');
    }

    escapeAttr(value) {
        return String(value)
            .replaceAll('&', '&amp;')
            .replaceAll('"', '&quot;')
            .replaceAll('<', '&lt;');
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
                if (action === 'copy-command') {
                    const command = button.dataset.command || '';
                    if (!command) return;
                    await this.copyText(command, 'Pipeline command copied');
                    return;
                }
                if (action === 'copy-inspector') {
                    await this.copyText(JSON.stringify(this.buildNodeInspectorPayload(), null, 2), 'Node inspector JSON copied');
                    return;
                }
                if (action === 'scroll-panel') {
                    const section = button.dataset.section;
                    if (!section) return;
                    this.topNavPanel.body?.querySelector(`[data-pipeline-section="${section}"]`)?.scrollIntoView({
                        behavior: 'smooth',
                        block: 'start'
                    });
                    return;
                }
                if (action === 'open-effects') {
                    this.closeTopPanel();
                    this.state.activeSidebar = 'effects';
                    this.activateLibraryTab('effects');
                    this.setStatus('Effects panel ready', 1800);
                    return;
                }
                if (action === 'open-audio') {
                    this.closeTopPanel();
                    this.activateTab('audio');
                    this.scrollIntoView('#tab-audio');
                    this.setStatus('Audio controls ready', 1800);
                    return;
                }
                if (action === 'open-overlays') {
                    this.closeTopPanel();
                    this.activateTab('overlays');
                    this.scrollIntoView('#tab-overlays');
                    this.setStatus('Overlay controls ready', 1800);
                    return;
                }
                if (action === 'open-export') {
                    this.closeTopPanel();
                    this.activateTab('export');
                    this.scrollIntoView('#tab-export');
                    this.setStatus('Export controls ready', 1800);
                    return;
                }
                if (action === 'open-preview') {
                    this.closeTopPanel();
                    this.scrollIntoView('#preview-container');
                    this.setStatus('Preview surface ready', 1800);
                    return;
                }
                if (action === 'open-transcript') {
                    this.closeTopPanel();
                    this.scrollIntoView('#transcript-content');
                    this.setStatus('Transcript editor ready', 1800);
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

    async copyText(text, successMessage = 'Copied to clipboard') {
        try {
            if (navigator.clipboard?.writeText) {
                await navigator.clipboard.writeText(text);
                this.setStatus(successMessage, 2200);
                return true;
            }
        } catch (err) {
            console.warn('Clipboard copy failed, falling back to prompt.', err);
        }
        window.prompt('Copy this text:', text);
        return false;
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
