document.addEventListener('DOMContentLoaded', () => {
    // Parse query params
    const urlParams = new URLSearchParams(window.location.search);
    const filename = urlParams.get('recording');

    if (!filename) {
        alert('No recording specified');
        window.close();
        return;
    }

    // Initialize player
    initPlayer(filename);
});

let currentFilename = '';
let currentTranscriptionData = [];

async function initPlayer(filename) {
    currentFilename = filename;
    document.getElementById('videoTitle').textContent = `Playing: ${filename}`;

    // Construct file URL - assuming standard path
    // We might need to fetch file info first if URL isn't just /recordings-files/filename
    // But based on recordings.js, we passed 'fileUrl' around. 
    // We can fetch /api/recordings to find the URL or just guess it.
    // Ideally we should pass URL in query param too or fetch metadata.
    // Let's fetch metadata to be safe and get the URL.

    try {
        const response = await fetch('/api/recordings');
        const data = await response.json();
        const file = data.files.find(f => f.name === filename);

        if (file) {
            const video = document.getElementById('player');
            video.src = file.url;

            // Setup sync listeners
            video.addEventListener('timeupdate', syncTranscript);

            // Load transcript
            if (file.hasTranscription) {
                loadTranscription(filename, file.url);
            } else {
                document.getElementById('textContent').innerHTML = '<div style="padding:20px; color:#666;">No transcription available.</div>';
            }

            video.play().catch(e => console.error('Auto-play failed:', e));
        } else {
            alert('Recording not found');
        }
    } catch (e) {
        console.error('Error initializing player:', e);
        alert('Error loading recording metadata');
    }
}

async function loadTranscription(filename, fileUrl) {
    const contentDiv = document.getElementById('textContent');
    const highlightsDiv = document.getElementById('highlightsContent');

    contentDiv.innerHTML = 'Loading transcript...';

    try {
        const response = await fetch(`/api/recordings/${filename}/transcription`);
        const data = await response.json();

        if (data.success) {
            contentDiv.innerHTML = '';
            currentTranscriptionData = [];

            // Parse content
            const lines = data.content.split('\n');
            const regex = /^\[(\d{2}:\d{2}:\d{2}) -> \d{2}:\d{2}:\d{2}\] (.*)$/;

            const listContainer = document.createElement('div');
            listContainer.className = 'transcription-lines';

            lines.forEach((line, index) => {
                const match = line.match(regex);
                if (match) {
                    const timestamp = match[1];
                    const text = match[2];

                    const parts = timestamp.split(':').map(Number);
                    const seconds = parts[0] * 3600 + parts[1] * 60 + parts[2];

                    const rowId = `tx-row-${index}`;
                    currentTranscriptionData.push({
                        id: rowId,
                        time: seconds,
                        text: text
                    });

                    const row = document.createElement('div');
                    row.className = 'transcription-row';
                    row.id = rowId;

                    const timeBtn = document.createElement('span');
                    timeBtn.className = 'timestamp-btn';
                    timeBtn.textContent = `[${timestamp}]`;
                    timeBtn.onclick = () => seekTo(seconds);

                    const textSpan = document.createElement('span');
                    textSpan.className = 'transcription-content';
                    textSpan.textContent = text;

                    const clipBtn = document.createElement('button');
                    clipBtn.className = 'clip-btn';
                    clipBtn.textContent = '🎬';
                    clipBtn.title = 'Clip this (+/- 2 mins)';
                    clipBtn.onclick = (e) => previewClip(filename, timestamp, e.target);

                    row.appendChild(clipBtn);
                    row.appendChild(timeBtn);
                    row.appendChild(textSpan);
                    listContainer.appendChild(row);
                } else if (line.trim()) {
                    const row = document.createElement('div');
                    row.className = 'transcription-row';
                    row.textContent = line;
                    listContainer.appendChild(row);
                }
            });
            contentDiv.appendChild(listContainer);

            // Load highlights
            if (data.highlights && data.highlights.length > 0) {
                let highlightsHtml = '';
                data.highlights.forEach(h => {
                    highlightsHtml += `
                    <div class="highlight-item" style="border-bottom: 1px solid #444; padding: 10px;">
                        <div class="highlight-time" style="color: #5bc0de; font-weight: bold; cursor: pointer;" onclick="seekToTimestamp('${h.timestamp}')">${h.timestamp}</div>
                        <div class="highlight-text" style="color: #ccc; margin: 5px 0;">${h.text}</div>
                        <div class="highlight-actions">
                            <button onclick="previewClip('${filename}', '${h.timestamp}', this)" class="btn btn-sm btn-info">Clip</button>
                            <button onclick="downloadClip('${filename}', '${h.timestamp}', this)" class="btn btn-sm btn-secondary">Download</button>
                        </div>
                    </div>`;
                });
                highlightsDiv.innerHTML = highlightsHtml;
            } else {
                highlightsDiv.innerHTML = '<div style="text-align: center; color: #888; padding: 20px;">No highlights found.</div>';
            }

        } else {
            contentDiv.innerHTML = 'Failed to load transcription.';
        }
    } catch (error) {
        console.error('Error loading transcription:', error);
        contentDiv.innerHTML = 'Error loading transcription.';
    }
}

function syncTranscript() {
    if (!currentTranscriptionData.length) return;

    const video = document.getElementById('player');
    const currentTime = video.currentTime;

    let activeItem = null;
    for (let i = 0; i < currentTranscriptionData.length; i++) {
        if (currentTranscriptionData[i].time <= currentTime) {
            activeItem = currentTranscriptionData[i];
        } else {
            break;
        }
    }

    document.querySelectorAll('.active-transcript-line').forEach(el => {
        el.classList.remove('active-transcript-line');
    });

    if (activeItem) {
        const row = document.getElementById(activeItem.id);
        if (row) {
            row.classList.add('active-transcript-line');
            row.scrollIntoView({ behavior: 'smooth', block: 'center' });
        }
    }
}

function adjustTime(seconds) {
    const video = document.getElementById('player');
    if (video) video.currentTime += seconds;
}

function setPlaybackSpeed(speed) {
    const video = document.getElementById('player');
    if (video) video.playbackRate = parseFloat(speed);
}

function seekTo(seconds) {
    const video = document.getElementById('player');
    video.currentTime = seconds;
    video.play();
}

function seekToTimestamp(timestamp) {
    const parts = timestamp.split(':').map(Number);
    const seconds = parts[0] * 3600 + parts[1] * 60 + parts[2];
    seekTo(seconds);
}

function clipCurrentTime() {
    const video = document.getElementById('player');
    if (!video || !currentFilename) return;

    const currentTime = video.currentTime;
    const date = new Date(currentTime * 1000);
    const hh = String(Math.floor(currentTime / 3600)).padStart(2, '0');
    const mm = String(date.getUTCMinutes()).padStart(2, '0');
    const ss = String(date.getUTCSeconds()).padStart(2, '0');
    const timestamp = `${hh}:${mm}:${ss}`;

    downloadClip(currentFilename, timestamp, null);
}

async function previewClip(filename, timestamp, btn) {
    let originalText = '';
    if (btn) {
        originalText = btn.textContent;
        btn.disabled = true;
        btn.textContent = 'Preparing...';
    } else {
        const clipCurrentBtn = document.querySelector('button[onclick="clipCurrentTime()"]');
        if (clipCurrentBtn) {
            originalText = clipCurrentBtn.textContent;
            clipCurrentBtn.disabled = true;
            clipCurrentBtn.textContent = 'Generating...';
            btn = clipCurrentBtn;
        }
    }

    try {
        const response = await fetch(`/api/recordings/${filename}/clip`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ timestamp })
        });

        const result = await response.json();

        if (result.success) {
            if (btn) {
                btn.textContent = 'Clip Ready!';
                setTimeout(() => {
                    btn.textContent = originalText;
                    btn.disabled = false;
                }, 2000);
            }
            window.open(result.url, '_blank');
        } else {
            alert('Failed: ' + (result.error || 'Unknown error'));
            if (btn) {
                btn.textContent = originalText;
                btn.disabled = false;
            }
        }
    } catch (error) {
        console.error('Error:', error);
        alert('Error generating clip');
        if (btn) {
            btn.textContent = originalText;
            btn.disabled = false;
        }
    }
}

async function downloadClip(filename, timestamp, btn) {
    let originalText = '';
    if (btn) {
        originalText = btn.textContent;
        btn.disabled = true;
        btn.textContent = 'Generating...';
    } else {
        // Fallback to finding the main clip button
        const clipCurrentBtn = document.querySelector('button[onclick="clipCurrentTime()"]');
        if (clipCurrentBtn) {
            originalText = clipCurrentBtn.innerText; // Use innerText to capture icon if present
            // But simpler to just save what it was
            originalText = clipCurrentBtn.innerHTML;

            clipCurrentBtn.disabled = true;
            clipCurrentBtn.textContent = 'Generating...';
            btn = clipCurrentBtn;
        }
    }

    // If we still don't have text, use default
    if (!originalText) originalText = 'Download';

    try {
        const response = await fetch(`/api/recordings/${filename}/clip`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ timestamp })
        });

        const result = await response.json();

        if (result.success) {
            const a = document.createElement('a');
            a.href = result.url;
            a.download = '';
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);

            if (btn) {
                btn.textContent = 'Done!';
                setTimeout(() => {
                    btn.innerHTML = originalText;
                    btn.disabled = false;
                }, 3000);
            }
        } else {
            alert('Failed: ' + (result.error || 'Unknown error'));
            if (btn) {
                btn.innerHTML = originalText;
                btn.disabled = false;
            }
        }
    } catch (error) {
        console.error('Error:', error);
        alert('Error generating clip');
        if (btn) {
            btn.innerHTML = originalText;
            btn.disabled = false;
        }
    }
}
