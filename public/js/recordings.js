// Initialize drag and drop
function initDragAndDrop() {
    const uploadArea = document.querySelector('.upload-files-container');
    const fileInput = document.getElementById('videoUpload');

    if (!uploadArea || !fileInput) return;

    ['dragenter', 'dragover', 'dragleave', 'drop'].forEach(eventName => {
        uploadArea.addEventListener(eventName, preventDefaults, false);
    });

    function preventDefaults(e) {
        e.preventDefault();
        e.stopPropagation();
    }

    ['dragenter', 'dragover'].forEach(eventName => {
        uploadArea.addEventListener(eventName, highlight, false);
    });

    ['dragleave', 'drop'].forEach(eventName => {
        uploadArea.addEventListener(eventName, unhighlight, false);
    });

    function highlight(e) {
        uploadArea.classList.add('drag-active');
    }

    function unhighlight(e) {
        uploadArea.classList.remove('drag-active');
    }

    uploadArea.addEventListener('drop', handleDrop, false);

    function handleDrop(e) {
        const dt = e.dataTransfer;
        const files = dt.files;

        // Update file input (optional, but good for form handling if we used one)
        // fileInput.files = files; // Use DataTransfer to set files if needed, but we can just call uploadVideo directly

        // Or better, just pass these files to uploadVideo
        // Since uploadVideo expects an input element, let's adapt it slightly or create a helper
        // Ideally we refactor uploadVideo to accept a FileList

        handleFiles(files);
    }

    // Also make the whole dashed area clickable to trigger input
    // (Existing label logic handles this mostly, but good to be explicit)
}

function handleFiles(files) {
    if (!files || files.length === 0) return;

    // Validate
    for (let i = 0; i < files.length; i++) {
        if (!files[i].type.startsWith('video/')) {
            UI.showToast(`File "${files[i].name}" is not a video.`, 'error');
            return;
        }
    }

    // Call upload logic
    performUpload(files);
}

document.addEventListener('DOMContentLoaded', () => {
    loadFiles();
    initDragAndDrop();

    // Auto-refresh every 5 seconds
    setInterval(() => {
        loadFiles();
    }, 5000);
});

// Refactored uploadVideo to use performUpload
function uploadVideo(input) {
    const files = input.files;
    performUpload(files);
}

function performUpload(files) {
    console.log('performUpload called', files);
    if (!files || files.length === 0) return;

    const uploadContainer = document.getElementById('uploadContainer');
    const statusEl = document.getElementById('uploadStatus');
    const percentEl = document.getElementById('uploadPercent');
    const progressBar = document.getElementById('uploadProgressBar');
    const resultEl = document.getElementById('uploadResult');

    // Reset UI


    // Let's assume we want to show loading state.

    // Reset UI
    uploadContainer.classList.remove('hidden');
    uploadContainer.style.display = 'block';
    statusEl.textContent = `Uploading ${files.length} file(s)...`;
    percentEl.textContent = '0%';
    progressBar.style.width = '0%';
    resultEl.textContent = '';
    resultEl.style.color = '';

    const formData = new FormData();
    for (let i = 0; i < files.length; i++) {
        formData.append('video', files[i]);
    }

    const xhr = new XMLHttpRequest();

    xhr.upload.addEventListener('progress', (e) => {
        if (e.lengthComputable) {
            const percent = Math.round((e.loaded / e.total) * 100);
            percentEl.textContent = `${percent}%`;
            progressBar.style.width = `${percent}%`;
        }
    });

    xhr.addEventListener('load', () => {
        if (xhr.status >= 200 && xhr.status < 300) {
            try {
                const result = JSON.parse(xhr.responseText);
                statusEl.textContent = 'Upload complete!';
                progressBar.style.backgroundColor = '#4CAF50';

                let message = 'Upload successful!';
                if (result.errors) {
                    message += ' (Some files failed)';
                }

                resultEl.textContent = message;
                resultEl.style.color = 'green';

                setTimeout(() => {
                    uploadContainer.style.display = 'none';
                    resultEl.textContent = '';
                    loadFiles(); // Refresh list
                }, 2000);
            } catch (e) {
                console.error('Error parsing response:', e);
                handleError('Invalid server response');
            }
        } else {
            handleError('Upload failed');
        }
    });

    xhr.addEventListener('error', () => {
        handleError('Network error');
    });

    xhr.addEventListener('abort', () => {
        handleError('Upload aborted');
    });

    xhr.open('POST', '/api/recordings/upload');
    xhr.send(formData);

    function handleError(msg) {
        statusEl.textContent = 'Error';
        percentEl.textContent = '';
        progressBar.style.backgroundColor = 'red';
        resultEl.textContent = msg;
        resultEl.style.color = 'red';
        console.error(msg);
    }
}

const processingFiles = new Set();

async function loadFiles() {
    try {
        const response = await fetch('/api/recordings');
        const data = await response.json();

        const listDiv = document.getElementById('fileList');

        if (data.files.length === 0) {
            listDiv.innerHTML = '<div class="empty-state">No recordings found</div>';
            return;
        }

        let html = `
            <div class="table-container">
            <table class="table">
                <thead>
                <tr>
                    <th>Filename</th>
                    <th>Date</th>
                    <th>Size</th>
                    <th>Actions</th>
                </tr>
                </thead>
                <tbody>
                `;

        data.files.forEach(file => {
            const date = new Date(file.created).toLocaleString();
            const size = formatSize(file.size);

            if (file.hasTranscription && processingFiles.has(file.name)) {
                processingFiles.delete(file.name);
            }

            const displayName = formatDisplayName(file.name);

            // Consolidated Actions
            html += `
                <tr>
                <td>${displayName}</td>
                <td>${date}</td>
                <td>${size}</td>
                <td class="actions">
                    <button onclick="openPlayer('${file.name}')" class="btn btn-primary btn-sm" title="Play & Review">▶️</button>
                    ${!file.hasTranscription && !file.isProcessing && !processingFiles.has(file.name) ?
                    `<button onclick="transcribe('${file.name}', this)" class="btn btn-info btn-sm" title="Transcribe">📝</button>` : ''}
                    ${file.isProcessing || processingFiles.has(file.name) ?
                    `<button class="btn btn-secondary btn-sm" disabled title="Processing...">⏳</button>` : ''}
                    <a href="${file.url}" download class="btn btn-secondary btn-sm" title="Download">⬇️</a>
                    <button onclick="deleteRecording('${file.name}')" class="btn btn-danger btn-sm" title="Delete">🗑️</button>
                </td>
                </tr>
            `;
        });

        html += '</tbody></table></div>';
        listDiv.innerHTML = html;
    } catch (error) {
        document.getElementById('fileList').innerHTML = 'Error loading recordings';
        console.error(error);
    }
}

async function deleteRecording(filename) {
    if (!confirm(`Are you sure you want to delete ${filename}?`)) {
        return;
    }

    try {
        const response = await fetch(`/api/recordings/${filename}`, {
            method: 'DELETE'
        });

        if (response.ok) {
            UI.showToast('Recording deleted', 'success');
            loadFiles();
        } else {
            UI.showToast('Failed to delete file', 'error');
        }
    } catch (error) {
        console.error('Error deleting file:', error);
        UI.showToast('Error deleting file', 'error');
    }
}

async function transcribe(filename, btn) {
    if (btn) {
        btn.innerText = '⏳';
        btn.title = 'Processing...';
        btn.disabled = true;
        btn.classList.remove('btn-info');
        btn.classList.add('btn-secondary');
    }

    processingFiles.add(filename);

    try {
        const response = await fetch(`/api/recordings/${filename}/transcribe`, { method: 'POST' });
        if (response.ok) {
            UI.showToast('Transcription started', 'success');
        } else {
            processingFiles.delete(filename);
            UI.showToast('Failed to start transcription', 'error');
            loadFiles(); // Restore state
        }
    } catch (error) {
        console.error('Error starting transcription:', error);
        processingFiles.delete(filename);
        UI.showToast('Error starting transcription', 'error');
        loadFiles(); // Restore state
    }
}

function openPlayer(filename) {
    const modal = document.getElementById('videoModal');
    const video = document.getElementById('videoPlayerModal');
    const title = document.getElementById('modalTitle');
    const transText = document.getElementById('transcriptionText');

    title.textContent = `Preview: ${filename}`;
    modal.style.display = 'flex';

    // Clear previous
    transText.innerHTML = 'Loading transcription...';

    // Fetch file details to get URL
    fetch('/api/recordings')
        .then(res => res.json())
        .then(data => {
            const file = data.files.find(f => f.name === filename);
            if (file) {
                video.src = file.url;
                video.play().catch(e => console.log('Autoplay blocked'));

                if (file.hasTranscription) {
                    loadTranscriptionForModal(filename);
                } else {
                    transText.innerHTML = '<div class="text-secondary p-4 text-center">No transcription available.</div>';
                }
            }
        });
}

function closeModal() {
    const modal = document.getElementById('videoModal');
    const video = document.getElementById('videoPlayerModal');
    if (modal) modal.style.display = 'none';
    if (video) {
        video.pause();
        video.src = '';
    }
}

async function loadTranscriptionForModal(filename) {
    const transText = document.getElementById('transcriptionText');
    try {
        const res = await fetch(`/api/recordings/${filename}/transcription`);
        const data = await res.json();

        if (data.success) {
            transText.innerHTML = '';
            const lines = data.content.split('\n');
            const regex = /^\[(\d{2}:\d{2}:\d{2}) -> \d{2}:\d{2}:\d{2}\] (.*)$/;

            lines.forEach(line => {
                const match = line.match(regex);
                if (match) {
                    const timestamp = match[1];
                    const text = match[2];

                    const row = document.createElement('div');
                    row.className = 'transcription-row';

                    const timeBtn = document.createElement('span');
                    timeBtn.className = 'timestamp-btn';
                    timeBtn.textContent = `[${timestamp}]`;
                    timeBtn.onclick = () => {
                        const parts = timestamp.split(':').map(Number);
                        const seconds = parts[0] * 3600 + parts[1] * 60 + parts[2];
                        document.getElementById('videoPlayerModal').currentTime = seconds;
                    };

                    const textSpan = document.createElement('span');
                    textSpan.textContent = text;

                    row.appendChild(timeBtn);
                    row.appendChild(textSpan);
                    transText.appendChild(row);
                }
            });
        } else {
            transText.innerHTML = 'Failed to load transcription.';
        }
    } catch (e) {
        transText.innerHTML = 'Error loading transcription.';
    }
}

// Close modal on click outside
window.onclick = function (event) {
    const modal = document.getElementById('videoModal');
    if (event.target == modal) {
        closeModal();
    }
};

function formatDisplayName(filename) {
    // New format: recording_YYYY-MM-DD_HH-MM-SS.ext
    const newRegex = /recording_(\d{4}-\d{2}-\d{2})_(\d{2})-(\d{2})-(\d{2})/;
    // Legacy format: stream_YYYY-MM-DDTHH-MM-SS-mmmZ
    const legacyRegex = /stream_(\d{4}-\d{2}-\d{2})T(\d{2})[-:](\d{2})[-:](\d{2})[-:](\d{3})Z/;

    let dateObj = null;

    const newMatch = filename.match(newRegex);
    if (newMatch) {
        const [, date, hh, mm, ss] = newMatch;
        dateObj = new Date(`${date}T${hh}:${mm}:${ss}`);
    }

    if (!dateObj) {
        const legacyMatch = filename.match(legacyRegex);
        if (legacyMatch) {
            const [, date, hh, mm, ss] = legacyMatch;
            dateObj = new Date(`${date}T${hh}:${mm}:${ss}Z`);
        }
    }

    if (dateObj && !isNaN(dateObj.getTime())) {
        try {
            return 'Recording — ' + dateObj.toLocaleDateString(undefined, {
                year: 'numeric',
                month: 'short',
                day: 'numeric'
            }) + ' ' + dateObj.toLocaleTimeString(undefined, {
                hour: '2-digit',
                minute: '2-digit'
            });
        } catch (e) {
            console.error('Date parsing error:', e);
        }
    }

    return filename;
}

function formatSize(bytes) {
    if (bytes === 0) return '0 Bytes';
    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}


