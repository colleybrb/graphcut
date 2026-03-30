export class TranscriptPanel {
    constructor(app) {
        this.app = app;
        this.container = document.getElementById('transcript-content');
        this.selectedWords = new Set();
        this.deletedWords = new Set();
        this.wordsMap = new Map(); // Global index map 

        document.getElementById('btn-clear-cuts').addEventListener('click', async () => {
            await this.app.api.applyTranscriptCuts([]);
            this.app.refreshState();
        });

        document.getElementById('btn-apply-cuts').addEventListener('click', async () => {
            // Cut format: { source_id: str, word_index: int }
            const payload = Array.from(this.deletedWords).map(idx => {
                const w = this.wordsMap.get(idx);
                return { source_id: w.source_id, word_index: w.local_index };
            });
            await this.app.api.applyTranscriptCuts(payload);
            this.app.refreshState();
        });

        document.addEventListener('keydown', (e) => {
            if (e.key === 'Backspace' || e.key === 'Delete') {
                if (this.selectedWords.size > 0) {
                    this.selectedWords.forEach(idx => {
                        this.deletedWords.add(idx);
                        const el = document.querySelector(`.word[data-gidx="${idx}"]`);
                        if(el) el.classList.add('cut');
                    });
                    this.selectedWords.clear();
                    document.querySelectorAll('.word.selected').forEach(el => el.classList.remove('selected'));
                }
            }
        });
    }

    render() {
        if (!this.app.state.transcript || Object.keys(this.app.state.transcript).length === 0) {
            this.container.innerHTML = `<div class="empty-state">No transcript found. Try generating one.</div>`;
            return;
        }

        // Initialize state arrays
        this.wordsMap.clear();
        this.selectedWords.clear();
        this.deletedWords.clear();
        
        // Parse applied cuts from API into local state hash maps
        const serverCuts = new Set((this.app.state.project.transcript_cuts || []).map(c => `${c.source_id}_${c.word_index}`));

        this.container.innerHTML = '';
        let globalIndexCounter = 0;

        Object.entries(this.app.state.transcript).forEach(([sid, data]) => {
            const block = document.createElement('div');
            block.style.marginBottom = '20px';
            block.innerHTML = `<h3 style="font-size:0.8rem;color:var(--text-muted);border-bottom:1px solid var(--border-color);margin-bottom:8px">${sid}</h3>`;
            
            const wordsContainer = document.createElement('div');
            
            data.all_words?.forEach((word, localIndex) => {
                const gIdx = globalIndexCounter++;
                this.wordsMap.set(gIdx, { source_id: sid, local_index: localIndex, word });
                
                const span = document.createElement('span');
                span.className = 'word';
                span.dataset.gidx = gIdx;
                span.textContent = word.text;
                
                if (serverCuts.has(`${sid}_${localIndex}`)) {
                    this.deletedWords.add(gIdx);
                    span.classList.add('cut');
                }

                span.addEventListener('click', (e) => {
                    if (e.shiftKey) {
                        // Range select simple mock 
                        const last = Math.max(...Array.from(this.selectedWords));
                        if(last > -1) {
                            const min = Math.min(last, gIdx);
                            const max = Math.max(last, gIdx);
                            for (let i = min; i <= max; i++) {
                                this.selectedWords.add(i);
                                document.querySelector(`.word[data-gidx="${i}"]`)?.classList.add('selected');
                            }
                        }
                    } else if (e.metaKey || e.ctrlKey) {
                        if (this.selectedWords.has(gIdx)) {
                            this.selectedWords.delete(gIdx);
                            span.classList.remove('selected');
                        } else {
                            this.selectedWords.add(gIdx);
                            span.classList.add('selected');
                        }
                    } else {
                        this.selectedWords.clear();
                        document.querySelectorAll('.word.selected').forEach(el => el.classList.remove('selected'));
                        this.selectedWords.add(gIdx);
                        span.classList.add('selected');
                    }
                });
                
                wordsContainer.appendChild(span);
                wordsContainer.appendChild(document.createTextNode(' '));
            });
            
            block.appendChild(wordsContainer);
            this.container.appendChild(block);
        });
    }
}
