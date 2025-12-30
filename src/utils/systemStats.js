import { exec } from 'child_process';
import os from 'os';

/**
 * Get statistics for specific PIDs using ps command
 * @param {Array<number>} pids 
 * @returns {Promise<Object>} Map of pid -> stats
 */
export function getProcessStats(pids) {
    return new Promise((resolve) => {
        if (!pids || pids.length === 0) {
            resolve({});
            return;
        }

        const pidList = pids.join(',');
        // rss = Resident Set Size (memory) in KB
        // pcpu = CPU usage percentage
        const command = `ps -p ${pidList} -o pid,pcpu,rss,comm`;

        exec(command, (error, stdout) => {
            if (error) {
                // Some processes might have exited
                resolve({});
                return;
            }

            const stats = {};
            const lines = stdout.trim().split('\n');

            // Skip header
            for (let i = 1; i < lines.length; i++) {
                const line = lines[i].trim();
                if (!line) continue;

                // Split by whitespace
                const parts = line.split(/\s+/);
                if (parts.length >= 4) {
                    const pid = parseInt(parts[0]);
                    const cpu = parseFloat(parts[1]);
                    const memory = parseInt(parts[2]) * 1024; // Convert KB to Bytes

                    stats[pid] = {
                        cpu,
                        memory
                    };
                }
            }

            resolve(stats);
        });
    });
}

/**
 * Get overall system stats
 */
export function getSystemStats() {
    return {
        totalMemory: os.totalmem(),
        freeMemory: os.freemem(),
        loadAvg: os.loadavg(),
        uptime: os.uptime()
    };
}
