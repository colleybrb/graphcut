/** GraphCut REST API and WebSocket wrapper encapsulating Python endpoints into JS promises */

export class GraphCutAPI {
    constructor() {
        this.baseUrl = window.location.origin + '/api';
        this.wsUrl = `ws://${window.location.host}/ws/progress`;
        this.ws = null;
    }

    // -- Internal Fetch Wrapper --
    async _fetch(endpoint, options = {}) {
        const url = `${this.baseUrl}${endpoint}`;
        try {
            const res = await fetch(url, {
                ...options,
                headers: {
                    'Content-Type': 'application/json',
                    ...options.headers
                }
            });
            if (!res.ok) throw new Error(`API Error: ${res.statusText}`);
            return await res.json();
        } catch (err) {
            console.error('API Error:', err);
            throw err;
        }
    }

    // -- Project --
    getProject() { return this._fetch('/project'); }

    // -- Sources --
    getSources() { return this._fetch('/sources'); }

    /** Returns absolute path to thumbnail image or null natively */
    getSourceThumbnail(sourceId) {
        return `${this.baseUrl}/sources/${sourceId}/thumbnail`;
    }

    // -- Clips --
    getClips() { return this._fetch('/clips'); }
    addClip(sourceId) { return this._fetch('/clips/add', { method: 'POST', body: JSON.stringify({ source_id: sourceId }) }); }
    reorderClips(indices) { return this._fetch('/clips/reorder', { method: 'PUT', body: JSON.stringify(indices) }); }

    // -- Transcripts --
    getTranscript() { return this._fetch('/transcript'); }
    generateTranscript() { return this._fetch('/transcript/generate', { method: 'POST' }); }
    
    // -- Audio & Overlays --
    getAudio() { return this._fetch('/audio'); }
    updateAudio(payload) { return this._fetch('/audio', { method: 'PUT', body: JSON.stringify(payload) }); }
    
    getOverlays() { return this._fetch('/overlays'); }
    updateWebcam(payload) { return this._fetch('/overlays/webcam', { method: 'PUT', body: JSON.stringify(payload) }); }
    
    // -- Export --
    getExportPresets() { return this._fetch('/export/presets'); }
    triggerExport(presetName, quality) { return this._fetch('/export/render', { method: 'POST', body: JSON.stringify({ preset: presetName, quality: quality }) }); }

    // -- Websocket streams --
    connectProgressStream(onProgressUpdate) {
        if (this.ws) {
            this.ws.close();
        }
        
        this.ws = new WebSocket(this.wsUrl);
        this.ws.onmessage = (event) => {
            try {
                const data = JSON.parse(event.data);
                if (onProgressUpdate) onProgressUpdate(data);
            } catch (err) {
                console.error("Failed parsing WS msg", err);
            }
        };

        this.ws.onopen = () => console.log('WebSocket connected');
        this.ws.onerror = (e) => console.error('WebSocket error:', e);
        this.ws.onclose = () => {
            console.log('WebSocket closed, attempting reconnect...');
            setTimeout(() => this.connectProgressStream(onProgressUpdate), 5000);
        };
    }
}
