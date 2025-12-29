document.addEventListener('DOMContentLoaded', () => {
    loadFiles();

    // Auto-refresh every 5 seconds
    setInterval(() => {
        loadFiles();
    }, 5000);
});

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
            <table>
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
                    <button onclick="openPlayer('${file.name}')" class="btn btn-primary">Play & Review</button>
                    ${!file.hasTranscription && !file.isProcessing && !processingFiles.has(file.name) ?
                    `<button onclick="transcribe('${file.name}', this)" class="btn btn-info">Transcribe</button>` : ''}
                    ${file.isProcessing || processingFiles.has(file.name) ?
                    `<button class="btn btn-secondary" disabled>Processing...</button>` : ''}
                    <a href="${file.url}" download class="btn btn-secondary">Download</a>
                    <button onclick="deleteRecording('${file.name}')" class="btn btn-danger">Delete</button>
                </td>
                </tr>
            `;
        });

        html += '</tbody></table>';
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
            loadFiles();
        } else {
            alert('Failed to delete file');
        }
    } catch (error) {
        console.error('Error deleting file:', error);
        alert('Error deleting file');
    }
}

async function transcribe(filename, btn) {
    if (btn) {
        btn.textContent = 'Processing...';
        btn.disabled = true;
        btn.classList.remove('btn-info');
        btn.classList.add('btn-secondary');
    }

    processingFiles.add(filename);

    try {
        const response = await fetch(`/api/recordings/${filename}/transcribe`, { method: 'POST' });
        if (response.ok) {
            // Success - do nothing, let the polling update the UI
        } else {
            processingFiles.delete(filename);
            alert('Failed to start transcription');
            loadFiles(); // Restore state
        }
    } catch (error) {
        console.error('Error starting transcription:', error);
        processingFiles.delete(filename);
        alert('Error starting transcription');
        loadFiles(); // Restore state
    }
}

function openPlayer(filename) {
    window.open(`/player.html?recording=${encodeURIComponent(filename)}`, '_blank');
}

function formatDisplayName(filename) {
    const regex = /stream_(\d{4}-\d{2}-\d{2})T(\d{2})[-:](\d{2})[-:](\d{2})[-:](\d{3})Z/;
    const match = filename.match(regex);

    if (match) {
        const datePart = match[1];
        const hours = match[2];
        const minutes = match[3];
        const seconds = match[4];

        try {
            const dateStr = `${datePart}T${hours}:${minutes}:${seconds}Z`;
            const dateObj = new Date(dateStr);

            if (!isNaN(dateObj.getTime())) {
                return dateObj.toLocaleDateString(undefined, {
                    year: 'numeric',
                    month: 'short',
                    day: 'numeric'
                }) + ' - ' + dateObj.toLocaleTimeString(undefined, {
                    hour: '2-digit',
                    minute: '2-digit'
                });
            }
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

function uploadVideo(input) {
    const files = input.files;
    if (!files || files.length === 0) return;

    const uploadContainer = document.getElementById('uploadContainer');
    const statusEl = document.getElementById('uploadStatus');
    const percentEl = document.getElementById('uploadPercent');
    const progressBar = document.getElementById('uploadProgressBar');
    const resultEl = document.getElementById('uploadResult');
    const btn = document.querySelector('.upload-section button');

    // Validate file types
    for (let i = 0; i < files.length; i++) {
        if (!files[i].type.startsWith('video/')) {
            alert(`File "${files[i].name}" is not a video.`);
            input.value = '';
            return;
        }
    }

    const originalText = btn.textContent;
    btn.disabled = true;
    btn.textContent = 'Uploading...';

    // Reset UI
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
        resetBtn();
    });

    xhr.addEventListener('error', () => {
        handleError('Network error');
        resetBtn();
    });

    xhr.addEventListener('abort', () => {
        handleError('Upload aborted');
        resetBtn();
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

    function resetBtn() {
        btn.disabled = false;
        btn.textContent = originalText;
        input.value = '';
    }
}
