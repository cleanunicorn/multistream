import path from 'path';
import fs from 'fs';
import logger from './logger.js';

/**
 * Resolves the recording path from the configuration.
 * @param {Object} config - The application configuration.
 * @returns {string} Absolute path to the recordings directory.
 */
export function getRecordingPath(config) {
    const relativePath = config.recording?.path || './recordings';
    return path.resolve(process.cwd(), relativePath);
}

/**
 * Generates a consistent filename based on local time.
 * @param {string} format - The file extension (e.g., 'mp4', 'mkv').
 * @returns {string} The generated filename.
 */
export function generateRecordingFilename(format = 'mp4') {
    const n = new Date();
    const year = n.getFullYear();
    const month = String(n.getMonth() + 1).padStart(2, '0');
    const day = String(n.getDate()).padStart(2, '0');
    const hours = String(n.getHours()).padStart(2, '0');
    const minutes = String(n.getMinutes()).padStart(2, '0');
    const seconds = String(n.getSeconds()).padStart(2, '0');

    return `recording_${year}-${month}-${day}_${hours}-${minutes}-${seconds}.${format}`;
}

/**
 * Ensures the recording directory exists.
 * @param {string} recPath - The path to ensure.
 * @returns {string} The verified path.
 */
export function ensureRecordingDir(recPath) {
    if (!fs.existsSync(recPath)) {
        fs.mkdirSync(recPath, { recursive: true });
        logger.info(`Created recording directory: ${recPath}`);
    }
    return recPath;
}
