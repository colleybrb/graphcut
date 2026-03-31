export class ExportPanel {
    constructor(app) {
        this.app = app;
        this.container = document.getElementById('tab-export');
        this.trackedJobs = {};
        this.lastDebugJobId = null;
        
        window.addEventListener('graphcut:job-complete', (e) => {
            const data = e.detail;
            if (this.trackedJobs[data.job_id] && data.action === 'render') {
                const targetName = this.trackedJobs[data.job_id].preset;
                const filename = this.trackedJobs[data.job_id].filename;
                
                const btnNode = this.container.querySelector(`.btn-export[data-preset="${targetName}"]`);
                if (btnNode) {
                    const downloadBtn = document.createElement('a');
                    downloadBtn.href = `/api/export/download/${filename}`;
                    downloadBtn.download = filename;
                    downloadBtn.target = '_blank';
                    downloadBtn.className = "btn btn-outline";
                    downloadBtn.style.marginTop = "8px";
                    downloadBtn.style.display = "block";
                    downloadBtn.textContent = "Download " + filename;
                    
                    // Prevent duplicate injections
                    if (!btnNode.parentElement.querySelector(`a[download="${filename}"]`)) {
                        btnNode.parentElement.appendChild(downloadBtn);
                    }
                }
            }

            if (data.action === 'render failed') {
                this.lastDebugJobId = data.job_id;
                this.showJobDebug(data.job_id);
                alert(data.detail || `Render failed (${data.job_id}). Open Render Debug for details.`);
            }
        });
    }

    render() {
        if (!this.app.state.presets) return;

        let html = `
            <div class="h-full flex flex-col relative">
                <h2 class="text-sm font-bold text-on-surface mb-4 relative z-10 flex items-center gap-2">
                    <span class="material-symbols-outlined text-primary-container text-lg" style="font-variation-settings: 'FILL' 1;">ios_share</span>
                    Platform Presets
                </h2>
                <div class="space-y-3 relative z-10 overflow-y-auto flex-1 pr-2">
        `;

        this.app.state.presets.forEach(p => {
            let iconSvg = `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" class="text-on-surface-variant group-hover:text-primary transition-colors" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="18" height="18" rx="2" ry="2"/></svg>`;
            if (p.name.toLowerCase().includes('youtube')) {
                iconSvg = `<svg width="18" height="18" viewBox="0 0 24 24" fill="#ef4444" stroke="none"><rect x="2" y="5" width="20" height="14" rx="2"/><polygon points="10 9 15 12 10 15 10 9" fill="#fff"/></svg>`;
            } else if (p.name.toLowerCase().includes('shorts')) {
                iconSvg = `<svg width="18" height="18" viewBox="0 0 24 24" fill="#25e2eb" stroke="none"><rect x="6" y="2" width="12" height="20" rx="2"/></svg>`;
            } else if (p.name.toLowerCase().includes('square')) {
                iconSvg = `<svg width="18" height="18" viewBox="0 0 24 24" fill="rgba(37, 226, 235, 0.3)" stroke="#25e2eb" stroke-width="2"><rect x="4" y="4" width="16" height="16" rx="1"/></svg>`;
            }

            html += `
                <div class="group btn-export flex items-center justify-between p-3 rounded-lg border border-outline-variant/30 bg-surface-container-high hover:bg-surface-bright hover:border-primary/50 cursor-pointer transition-all" data-preset="${p.name}">
                    <div class="flex items-center gap-3">
                        <div class="w-8 h-8 rounded-full bg-surface-container flex items-center justify-center">
                            ${iconSvg}
                        </div>
                        <div>
                            <p class="text-xs font-bold text-on-surface group-hover:text-primary transition-colors">${p.name}</p>
                            <p class="text-[10px] text-on-surface-variant">${p.width}x${p.height} (${p.aspect_ratio})</p>
                        </div>
                    </div>
                    <span class="material-symbols-outlined text-outline-variant group-hover:text-primary group-hover:translate-x-1 transition-all text-sm">arrow_forward_ios</span>
                </div>
            `;
        });

        html += `
                </div>
                <div class="mt-4 pt-4 border-t border-outline-variant/10 relative z-10 flex-shrink-0">
                    <div class="space-y-4">
                        <div>
                            <label class="block text-[11px] font-bold text-on-surface-variant uppercase tracking-wider mb-2">Export Quality (CRF)</label>
                            <select id="export-quality" class="w-full bg-surface-container-high border border-outline-variant/30 text-on-surface text-xs rounded p-2 outline-none focus:border-primary">
                                <option value="draft">Draft (Ultrafast, Low Q)</option>
                                <option value="preview">Preview (Fast, Med Q)</option>
                                <option value="final" selected>Final (Slow, High Q)</option>
                            </select>
                        </div>
                        <button id="btn-export-all" class="w-full py-3 bg-primary-container text-on-primary font-extrabold rounded-lg shadow-[0_0_15px_rgba(37,226,235,0.2)] hover:shadow-[0_0_20px_rgba(37,226,235,0.4)] hover:bg-[#95f9ff] transition-all transform hover:-translate-y-0.5 flex items-center justify-center gap-2">
                            Export All Formats <span class="material-symbols-outlined text-sm font-bold">rocket_launch</span>
                        </button>
                    </div>

                    <details class="mt-6 text-xs text-on-surface-variant" id="render-debug">
                        <summary class="cursor-pointer font-bold uppercase tracking-wider flex items-center gap-1 hover:text-primary"><span class="material-symbols-outlined text-[14px]">code</span> Render Debug</summary>
                        <div class="mt-2 bg-surface-container-low border border-outline-variant/20 rounded p-2">
                            <div class="flex justify-between items-center mb-2">
                                <span>Recent FFmpeg Logs</span>
                                <button id="btn-debug-refresh" class="text-primary hover:underline">Refresh</button>
                            </div>
                            <pre id="render-debug-pre" class="h-32 overflow-auto font-mono text-[10px] bg-black/60 p-2 rounded break-all">No render failures yet.</pre>
                        </div>
                    </details>
                </div>
            </div>
        `;

        this.container.innerHTML = html;
        this.bindEvents();
    }

    bindEvents() {
        const quality = () => document.getElementById('export-quality').value;
        const hasClips = () => Array.isArray(this.app.state.clips) && this.app.state.clips.length > 0;

        this.container.querySelectorAll('.btn-export').forEach(btn => {
            btn.addEventListener('click', async (e) => {
                if (!hasClips()) {
                    alert('No clips in timeline. Add at least one source using the + button in Sources before rendering.');
                    return;
                }
                const target = e.currentTarget.dataset.preset;
                try {
                    const res = await this.app.api.triggerExport(target, quality());
                    this.trackedJobs[res.job_id] = { preset: target, filename: res.filename };
                    alert(`Export for ${target} started! See bottom bar for progress.`);
                } catch (err) {
                    alert(err.message || `Export failed for ${target}.`);
                }
            });
        });

        document.getElementById('btn-export-all')?.addEventListener('click', async () => {
            if (!hasClips()) {
                alert('No clips in timeline. Add at least one source using the + button in Sources before rendering.');
                return;
            }
            try {
                for (const p of this.app.state.presets) {
                    const res = await this.app.api.triggerExport(p.name, quality());
                    this.trackedJobs[res.job_id] = { preset: p.name, filename: res.filename };
                }
                alert("Export queue started!");
            } catch (err) {
                alert(err.message || 'Export queue failed to start.');
            }
        });

        this.container.querySelector('#btn-debug-refresh')?.addEventListener('click', async () => {
            const jobId = this.lastDebugJobId;
            if (!jobId) {
                alert('No render failure captured yet.');
                return;
            }
            await this.showJobDebug(jobId);
        });

        // On first render, try to show most recent failed job (if any).
        this.bootstrapDebug();
    }

    async showJobDebug(jobId) {
        const pre = this.container.querySelector('#render-debug-pre');
        const details = this.container.querySelector('#render-debug');
        if (!pre || !details) return;

        try {
            const job = await this.app.api.getJob(jobId);
            pre.textContent = JSON.stringify(job, null, 2);
            details.open = true;
        } catch (err) {
            pre.textContent = err.message || `Failed to load job ${jobId}`;
            details.open = true;
        }
    }

    async bootstrapDebug() {
        if (this.lastDebugJobId) return;
        const pre = this.container.querySelector('#render-debug-pre');
        if (!pre || pre.textContent !== 'No render failures yet.') return;

        try {
            const jobs = await this.app.api.listJobs(20);
            const failed = Array.isArray(jobs) ? jobs.find(j => j && j.status === 'failed') : null;
            if (failed && failed.job_id) {
                this.lastDebugJobId = failed.job_id;
                pre.textContent = JSON.stringify(failed, null, 2);
            }
        } catch {
            // Ignore bootstrap failures.
        }
    }
}
