function formatBytes(bytes) {
    if (!bytes) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}

function formatDuration(seconds) {
    const d = Math.floor(seconds / (3600 * 24));
    const h = Math.floor(seconds % (3600 * 24) / 3600);
    const m = Math.floor(seconds % 3600 / 60);
    const s = Math.floor(seconds % 60);

    const parts = [];
    if (d > 0) parts.push(`${d}d`);
    if (h > 0) parts.push(`${h}h`);
    if (m > 0) parts.push(`${m}m`);
    parts.push(`${s}s`);

    return parts.join(' ');
}

async function fetchStats() {
    try {
        const response = await fetch('/api/resources');
        const data = await response.json();

        updateUI(data);
    } catch (error) {
        console.error('Error fetching stats:', error);
    }
}

function updateUI(data) {
    // System Stats
    const memUsed = data.system.totalMemory - data.system.freeMemory;
    const memPercent = ((memUsed / data.system.totalMemory) * 100).toFixed(1);

    document.getElementById('systemMem').textContent = memPercent + '%';
    document.getElementById('memDetail').textContent = `${formatBytes(memUsed)} / ${formatBytes(data.system.totalMemory)}`;

    document.getElementById('systemLoad').textContent = data.system.loadAvg[0].toFixed(2);
    document.getElementById('uptime').textContent = formatDuration(data.system.uptime);

    // Process Table
    const tbody = document.getElementById('processList');
    tbody.innerHTML = '';

    // Main Process
    const mainRow = createProcessRow(
        'Main Service',
        data.processes.main.pid,
        'Multistream Server',
        data.processes.main.stats
    );
    tbody.appendChild(mainRow);

    // Stream Processes
    if (data.processes.streams && data.processes.streams.length > 0) {
        data.processes.streams.forEach(proc => {
            const name = proc.platform === 'recording' ? 'Recording' : `Stream (${proc.platform})`;
            const identity = proc.streamKey;
            const row = createProcessRow(name, proc.pid, identity, proc.stats);
            tbody.appendChild(row);
        });
    } else {
        const row = document.createElement('tr');
        row.innerHTML = `<td colspan="5" style="text-align: center; color: #888; font-style: italic;">No active streams</td>`;
        tbody.appendChild(row);
    }
}

function createProcessRow(type, pid, identity, stats) {
    const tr = document.createElement('tr');
    const cpuClass = stats.cpu > 50 ? 'color: #dc3545; font-weight: bold;' : '';

    tr.innerHTML = `
    <td><strong>${type}</strong></td>
    <td><code>${pid}</code></td>
    <td>${identity}</td>
    <td style="${cpuClass}">${stats.cpu.toFixed(1)}%</td>
    <td>${formatBytes(stats.memory)}</td>
  `;
    return tr;
}

// Start polling
document.addEventListener('DOMContentLoaded', () => {
    fetchStats();
    setInterval(fetchStats, 2000);
});
