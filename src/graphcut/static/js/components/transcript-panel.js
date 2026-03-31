export class TranscriptPanel {
    constructor(app) {
        this.app = app;
        this.container = document.getElementById('transcript-content');
        this.selectedWords = new Set();
        this.deletedWords = new Set();
        this.wordsMap = new Map(); // Global index map 
        this.anchorWord = null;

        document.getElementById('btn-clear-cuts').addEventListener('click', async () => {
            await this.app.api.applyTranscriptCuts([]);
            this.app.setStatus('Transcript cuts cleared', 2000);
            await this.app.refreshState();
        });

        document.getElementById('btn-apply-cuts').addEventListener('click', async () => {
            // Cut format: { source_id: str, word_index: int }
            const payload = Array.from(this.deletedWords)
                .map(idx => this.wordsMap.get(idx))
                .filter(Boolean)
                .map(w => ({ source_id: w.source_id, word_index: w.local_index }));
            await this.app.api.applyTranscriptCuts(payload);
            this.app.setStatus(`Saved ${payload.length} transcript cut${payload.length === 1 ? '' : 's'}`, 2200);
            await this.app.refreshState();
        });

        document.querySelector('[data-tool="ai-clean"]')?.addEventListener('click', () => {
            this.runAIClean();
        });

        document.querySelector('[data-tool="find"]')?.addEventListener('click', () => {
            this.runFindSelection();
        });

        document.addEventListener('keydown', (e) => {
            if (e.key === 'Backspace' || e.key === 'Delete') {
                if (this.selectedWords.size > 0) {
                    // Toggle: if selection is already cut, uncut it; else cut it.
                    const selected = Array.from(this.selectedWords);
                    const allCut = selected.every(idx => this.deletedWords.has(idx));

                    selected.forEach(idx => {
                        this._setCut(idx, !allCut);
                    });

                    this._clearSelection();
                    this._updateCutButtons();
                }
            }
        });
    }

    _updateCutButtons() {
        const applyBtn = document.getElementById('btn-apply-cuts');
        if (applyBtn) {
            const n = this.deletedWords.size;
            applyBtn.textContent = n > 0 ? `Apply Cuts (${n})` : 'Apply Cuts';
            applyBtn.disabled = n === 0;
        }
    }

    _flattenWords(data) {
        // Supports either legacy `{all_words: [...]}` or Transcript JSON `{segments:[{words:[...]}]}`.
        if (Array.isArray(data?.all_words)) return data.all_words;
        const out = [];
        const segments = Array.isArray(data?.segments) ? data.segments : [];
        segments.forEach(seg => {
            const words = Array.isArray(seg?.words) ? seg.words : [];
            words.forEach(w => out.push(w));
        });
        return out;
    }

    _normalizeToken(token) {
        return String(token || '')
            .trim()
            .toLowerCase()
            .replace(/^[^a-z0-9']+|[^a-z0-9']+$/g, '');
    }

    _clearSelection() {
        this.selectedWords.clear();
        document.querySelectorAll('.word.selected').forEach(el => el.classList.remove('selected'));
        this.anchorWord = null;
    }

    _setSelected(index, selected) {
        const el = document.querySelector(`.word[data-gidx="${index}"]`);
        if (selected) {
            this.selectedWords.add(index);
            el?.classList.add('selected');
            return;
        }
        this.selectedWords.delete(index);
        el?.classList.remove('selected');
    }

    _setCut(index, cut) {
        const el = document.querySelector(`.word[data-gidx="${index}"]`);
        if (cut) {
            this.deletedWords.add(index);
            el?.classList.add('cut');
            return;
        }
        this.deletedWords.delete(index);
        el?.classList.remove('cut');
    }

    _findPhraseMatches(tokens) {
        if (!tokens.length) return [];

        const words = Array.from(this.wordsMap.entries()).map(([gIdx, entry]) => ({
            gIdx,
            token: this._normalizeToken(entry?.word?.word ?? entry?.word?.text ?? '')
        }));

        const matches = [];
        for (let i = 0; i <= words.length - tokens.length; i += 1) {
            const slice = words.slice(i, i + tokens.length);
            const matched = slice.every((item, idx) => item.token === tokens[idx]);
            if (matched) {
                matches.push(slice.map((item) => item.gIdx));
            }
        }
        return matches;
    }

    runAIClean() {
        if (this.wordsMap.size === 0) {
            alert('Generate a transcript before using AI Clean.');
            return;
        }

        const fillerWords = new Set(['um', 'uh', 'erm', 'ah', 'mm', 'mmm', 'hmm']);
        const fillerPhrases = [
            ['you', 'know'],
            ['i', 'mean'],
            ['kind', 'of'],
            ['sort', 'of'],
        ];

        let marked = 0;
        const words = Array.from(this.wordsMap.entries()).map(([gIdx, entry]) => ({
            gIdx,
            token: this._normalizeToken(entry?.word?.word ?? entry?.word?.text ?? '')
        }));

        words.forEach((item, index) => {
            if (!item.token) return;

            if (fillerWords.has(item.token) && !this.deletedWords.has(item.gIdx)) {
                this._setCut(item.gIdx, true);
                marked += 1;
            }

            const prev = words[index - 1];
            if (prev && item.token === prev.token && item.token.length > 1 && !this.deletedWords.has(item.gIdx)) {
                this._setCut(item.gIdx, true);
                marked += 1;
            }
        });

        fillerPhrases.forEach((phrase) => {
            this._findPhraseMatches(phrase).forEach((match) => {
                match.forEach((gIdx) => {
                    if (!this.deletedWords.has(gIdx)) {
                        this._setCut(gIdx, true);
                        marked += 1;
                    }
                });
            });
        });

        this._updateCutButtons();
        this.app.setStatus(
            marked > 0
                ? `AI Clean marked ${marked} word${marked === 1 ? '' : 's'} for removal`
                : 'AI Clean found no common filler words',
            3200
        );
    }

    runFindSelection() {
        if (this.wordsMap.size === 0) {
            alert('Generate a transcript before using Find & Replace.');
            return;
        }

        const raw = window.prompt('Find text to select for cutting:', '');
        const tokens = String(raw || '')
            .split(/\s+/)
            .map((token) => this._normalizeToken(token))
            .filter(Boolean);

        if (tokens.length === 0) return;

        const matches = this._findPhraseMatches(tokens);
        if (matches.length === 0) {
            this.app.setStatus(`No transcript match for "${raw}"`, 2600);
            return;
        }

        this._clearSelection();
        matches.forEach((match) => {
            match.forEach((gIdx) => this._setSelected(gIdx, true));
        });
        this.anchorWord = matches[0][0] ?? null;
        this.app.setStatus(
            `Selected ${matches.length} match${matches.length === 1 ? '' : 'es'} for "${raw}". Press Delete to cut.`,
            4200
        );
    }

    async _pollForTranscript(button) {
        const deadline = Date.now() + 60000;
        while (Date.now() < deadline) {
            await new Promise((resolve) => setTimeout(resolve, 2000));
            await this.app.refreshState();
            if (this.app.state.transcript && Object.keys(this.app.state.transcript).length > 0) {
                this.app.setStatus('Transcript ready', 2500);
                return;
            }
        }

        if (button?.isConnected) {
            button.textContent = 'Still Processing...';
            button.disabled = false;
        }
        this.app.setStatus('Transcription is still running in the background', 3200);
    }

    render() {
        if (!this.app.state.transcript || Object.keys(this.app.state.transcript).length === 0) {
            const hasSources = Object.keys(this.app.state.sources || {}).length > 0;
            this.container.innerHTML = `
                <div class="empty-state">
                    <p style="margin-bottom: 15px;">${hasSources ? 'No transcript found. Try generating one.' : 'Add audio or video sources to generate a transcript.'}</p>
                    <button class="btn btn-primary" id="btn-generate-transcript" ${hasSources ? '' : 'disabled'}>${hasSources ? 'Generate Transcript' : 'Add Media First'}</button>
                </div>
            `;
            const btn = document.getElementById('btn-generate-transcript');
            if (btn) {
                btn.addEventListener('click', async () => {
                    btn.textContent = 'Generating...';
                    btn.disabled = true;
                    try {
                        await this.app.api.generateTranscript();
                        this.app.setStatus('Transcription started', 2400);
                        this._pollForTranscript(btn);
                    } catch (err) {
                        btn.textContent = 'Generate Transcript';
                        btn.disabled = false;
                        alert(err.message || 'Failed to start transcription.');
                    }
                });
            }
            this._updateCutButtons();
            return;
        }

        // Initialize state arrays
        this.wordsMap.clear();
        this.selectedWords.clear();
        this.deletedWords.clear();
        this.anchorWord = null;
        
        // Parse applied cuts from API into local state hash maps
        const serverCuts = new Set(
            (this.app.state.project.transcript_cuts || [])
                .filter(c => c && typeof c.source_id === 'string' && Number.isInteger(c.word_index))
                .map(c => `${c.source_id}_${c.word_index}`)
        );

        this.container.innerHTML = `
            <div style="color: var(--text-muted); font-size: 0.85rem; margin-bottom: 10px;">
                Tip: Click a word. Shift-click to range select. Delete/Backspace toggles cut/un-cut. Use “Apply Cuts” to save.
            </div>
        `;
        let globalIndexCounter = 0;

        Object.entries(this.app.state.transcript).forEach(([sid, data]) => {
            const block = document.createElement('div');
            block.style.marginBottom = '20px';
            block.innerHTML = `<h3 style="font-size:0.8rem;color:var(--text-muted);border-bottom:1px solid var(--border-color);margin-bottom:8px">${sid}</h3>`;
            
            const wordsContainer = document.createElement('div');
            
            const flatWords = this._flattenWords(data);
            flatWords.forEach((word, localIndex) => {
                const gIdx = globalIndexCounter++;
                this.wordsMap.set(gIdx, { source_id: sid, local_index: localIndex, word });
                
                const span = document.createElement('span');
                span.className = 'word';
                span.dataset.gidx = gIdx;
                span.textContent = (word?.word ?? word?.text ?? '').trim();
                
                if (serverCuts.has(`${sid}_${localIndex}`)) {
                    this.deletedWords.add(gIdx);
                    span.classList.add('cut');
                }

                span.addEventListener('click', (e) => {
                    if (e.shiftKey) {
                        // Range select from anchor.
                        if (this.anchorWord !== null) {
                            const min = Math.min(this.anchorWord, gIdx);
                            const max = Math.max(this.anchorWord, gIdx);
                            for (let i = min; i <= max; i++) {
                                this._setSelected(i, true);
                            }
                        } else {
                            this._setSelected(gIdx, true);
                        }
                    } else if (e.metaKey || e.ctrlKey) {
                        if (this.selectedWords.has(gIdx)) {
                            this._setSelected(gIdx, false);
                        } else {
                            this._setSelected(gIdx, true);
                        }
                        this.anchorWord = gIdx;
                    } else {
                        this._clearSelection();
                        this._setSelected(gIdx, true);
                        this.anchorWord = gIdx;
                    }
                });
                
                wordsContainer.appendChild(span);
                wordsContainer.appendChild(document.createTextNode(' '));
            });
            
            block.appendChild(wordsContainer);
            this.container.appendChild(block);
        });

        this._updateCutButtons();
    }
}
