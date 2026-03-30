export class AudioPanel {
    constructor(app) {
        this.app = app;
        this.container = document.getElementById('tab-audio');
    }

    render() {
        const mix = this.app.state.audioConfig;
        if (!mix) return;
        
        this.container.innerHTML = `
            <div class="form-group">
                <label>Source Gain (<span id="lbl-source-gain">${mix.source_gain_db} dB</span>)</label>
                <input type="range" id="ch-source" min="-30" max="10" step="1" value="${mix.source_gain_db}">
            </div>
            
            <div class="form-group">
                <label>Music Gain (<span id="lbl-music-gain">${mix.music_gain_db} dB</span>)</label>
                <input type="range" id="ch-music" min="-40" max="0" step="1" value="${mix.music_gain_db}">
            </div>

            <div class="form-group" style="flex-direction:row;align-items:center;margin-top:20px;justify-content:space-between">
                <label>LUFS Normalization</label>
                <input type="checkbox" id="ch-norm" ${mix.normalize ? 'checked' : ''} style="width:20px;height:20px;">
            </div>
            <div class="form-group">
                <label>Target LUFS</label>
                <input type="number" id="ch-lufs" value="${mix.target_lufs}" class="form-control" style="width:100px" disabled>
            </div>
        `;

        this.bindEvents();
    }

    bindEvents() {
        let timeout = null;
        const debounceSave = (payload) => {
            clearTimeout(timeout);
            timeout = setTimeout(async () => {
                await this.app.api.updateAudio(payload);
                this.app.refreshState();
            }, 500);
        };

        const currentPayload = () => ({
            source_gain_db: parseFloat(document.getElementById('ch-source').value),
            music_gain_db: parseFloat(document.getElementById('ch-music').value),
            normalize: document.getElementById('ch-norm').checked,
            target_lufs: parseFloat(document.getElementById('ch-lufs').value)
        });

        document.getElementById('ch-source').addEventListener('input', (e) => {
            document.getElementById('lbl-source-gain').innerText = `${e.target.value} dB`;
            debounceSave(currentPayload());
        });
        
        document.getElementById('ch-music').addEventListener('input', (e) => {
            document.getElementById('lbl-music-gain').innerText = `${e.target.value} dB`;
            debounceSave(currentPayload());
        });

        document.getElementById('ch-norm').addEventListener('change', (e) => {
            document.getElementById('ch-lufs').disabled = !e.target.checked;
            debounceSave(currentPayload());
        });
    }
}
