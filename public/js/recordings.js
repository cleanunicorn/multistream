document.addEventListener('DOMContentLoaded', () => {
    loadFiles();

    // Auto-refresh every 5 seconds
    setInterval(() => {
        // Only refresh if no modal is open to avoid disrupting user
        const textModal = document.getElementById('textModal');
        const videoModal = document.getElementById('videoModal');

        if (textModal.style.display !== 'flex' && videoModal.style.display !== 'flex') {
            loadFiles();
        }
    }, 5000);

    // Close modal on click outside
    window.onclick = function (event) {
        const videoModal = document.getElementById('videoModal');
        const textModal = document.getElementById('textModal');
        if (event.target == videoModal) {
            closeModal('videoModal');
        }
        if (event.target == textModal) {
            closeModal('textModal');
        }
    }
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

            let transcriptionBtn = '';
            if (file.hasTranscription) {
                transcriptionBtn = `<button onclick="viewTranscription('${file.name}')" class="btn btn-info">View Transcription</button>`;
            } else if (file.isProcessing || processingFiles.has(file.name)) {
                transcriptionBtn = `<button class="btn btn-secondary" disabled>Processing...</button>`;
            } else {
                transcriptionBtn = `<button onclick="transcribe('${file.name}', this)" class="btn btn-info">Transcribe</button>`;
            }

            const displayName = formatDisplayName(file.name);

            html += `
                <tr>
                <td>${displayName}</td>
                <td>${date}</td>
                <td>${size}</td>
                <td class="actions">
                    <button onclick="playVideo('${file.url}', '${file.name}')" class="btn btn-primary">Play</button>
                    <a href="${file.url}" download class="btn btn-secondary">Download</a>
                    ${transcriptionBtn}
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

async function viewTranscription(filename) {
    const modal = document.getElementById('textModal');
    const contentDiv = document.getElementById('textContent');
    const highlightsDiv = document.getElementById('highlightsContent');
    const titleEl = document.getElementById('textTitle');

    titleEl.textContent = `Transcription: ${filename}`;
    contentDiv.innerHTML = 'Loading...';
    highlightsDiv.innerHTML = 'Loading...';
    modal.style.display = 'flex';

    try {
        const response = await fetch(`/api/recordings/${filename}/transcription`);
        const data = await response.json();

        if (data.success) {
            // Fix formatting by using a pre element
            contentDiv.innerHTML = '';
            const pre = document.createElement('pre');
            pre.style.whiteSpace = 'pre-wrap';
            pre.style.margin = '0';
            pre.style.fontFamily = 'monospace';
            pre.style.border = 'none';
            pre.style.background = 'transparent';
            pre.textContent = data.content;
            contentDiv.appendChild(pre);

            if (data.highlights && data.highlights.length > 0) {
                let highlightsHtml = '<h3>Highlights ("clip that")</h3>';
                data.highlights.forEach(h => {
                    highlightsHtml += `
                    <div class="highlight-item">
                    <div class="highlight-time">${h.timestamp}</div>
                    <div class="highlight-text">${h.text}</div>
                    <button onclick="previewClip('${filename}', '${h.timestamp}', this)" class="btn btn-info" style="margin-top:5px; font-size: 12px; padding: 3px 8px; margin-right: 5px;">Preview Clip</button>
                    <button onclick="downloadClip('${filename}', '${h.timestamp}', this)" class="btn btn-secondary" style="margin-top:5px; font-size: 12px; padding: 3px 8px;">Download Clip</button>
                    </div>
                `;
                });
                highlightsDiv.innerHTML = highlightsHtml;
            } else {
                highlightsDiv.innerHTML = '<h3>Highlights</h3><div style="font-style:italic; color:#666;">No "clip that" moments found.</div>';
            }
        } else {
            contentDiv.innerHTML = 'Failed to load transcription.';
            highlightsDiv.innerHTML = '';
        }
    } catch (error) {
        console.error('Error loading transcription:', error);
        contentDiv.innerHTML = 'Error loading transcription.';
        highlightsDiv.innerHTML = '';
    }
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

function playVideo(url, title) {
    const modal = document.getElementById('videoModal');
    const video = document.getElementById('player');
    const titleEl = document.getElementById('videoTitle');

    titleEl.textContent = title;
    video.src = url;
    modal.style.display = 'flex';

    // Try to play
    video.play().catch(e => console.error('Play error:', e));
}

function closeModal(modalId) {
    const modal = document.getElementById(modalId);

    if (modalId === 'videoModal') {
        const video = document.getElementById('player');
        video.pause();
        video.src = '';
    }

    modal.style.display = 'none';
}

async function previewClip(filename, timestamp, btn) {
    const originalText = btn.textContent;
    btn.disabled = true;
    btn.textContent = 'Preparing...';

    try {
        const response = await fetch(`/api/recordings/${filename}/clip`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ timestamp })
        });

        const result = await response.json();

        if (result.success) {
            playVideo(result.url, `Preview: ${timestamp}`);
            btn.textContent = 'Playing...';
            setTimeout(() => {
                btn.textContent = originalText;
                btn.disabled = false;
            }, 1000);
        } else {
            alert('Failed to preview clip: ' + (result.error || 'Unknown error'));
            btn.textContent = originalText;
            btn.disabled = false;
        }
    } catch (error) {
        console.error('Error previewing clip:', error);
        alert('Error previewing clip');
        btn.textContent = originalText;
        btn.disabled = false;
    }
}

async function downloadClip(filename, timestamp, btn) {
    const originalText = btn.textContent;
    btn.disabled = true;
    btn.textContent = 'Generating...';

    try {
        const response = await fetch(`/api/recordings/${filename}/clip`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
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
            btn.textContent = 'Done!';
            setTimeout(() => {
                btn.textContent = originalText;
                btn.disabled = false;
            }, 3000);
        } else {
            alert('Failed to generate clip: ' + (result.error || 'Unknown error'));
            btn.textContent = originalText;
            btn.disabled = false;
        }
    } catch (error) {
        console.error('Error generating clip:', error);
        alert('Error generating clip');
        btn.textContent = originalText;
        btn.disabled = false;
    }
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
