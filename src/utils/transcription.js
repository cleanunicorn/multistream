import { spawn } from 'child_process';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import logger from './logger.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Track active transcription processes and their progress
const activeTranscriptions = new Map();

/**
 * Returns the currently active transcription tasks.
 * @returns {Map}
 */
export function getActiveTranscriptions() {
    return activeTranscriptions;
}

/**
 * Transcribes a video file using the NVIDIA Parakeet model via a Python script.
 * 
 * @param {string} videoPath - Absolute path to the video file.
 * @param {function} [callback] - Optional callback (error, stdout, stderr).
 */
export function transcribeFile(videoPath, callback) {
    const filename = path.basename(videoPath);

    // Prevent duplicate transcription for the same file
    if (activeTranscriptions.has(filename)) {
        logger.warn(`Transcription already in progress for ${filename}`);
        if (callback) callback(new Error('Transcription already in progress'));
        return;
    }

    const txtOutput = videoPath.substring(0, videoPath.lastIndexOf('.')) + '.txt';
    const tmpOutput = txtOutput + '.tmp';
    const vttOutput = videoPath.substring(0, videoPath.lastIndexOf('.')) + '.vtt';
    const tmpVttOutput = vttOutput + '.tmp';

    const pythonScript = path.join(__dirname, 'transcribe_parakeet.py');

    // uv run command split into arguments for spawn
    const args = [
        'run',
        '--python', '3.10',
        '--with', 'cmake',
        '--with', 'torch',
        '--with', 'torchaudio',
        '--with', 'nemo_toolkit[asr]',
        '--with', 'lhotse<1.27',
        pythonScript,
        videoPath,
        tmpOutput,
        '--vtt_output', tmpVttOutput
    ];

    logger.info(`Starting transcription with Parakeet: uv ${args.join(' ')}`);

    const child = spawn('uv', args);

    // Store in active map
    activeTranscriptions.set(filename, {
        progress: 0,
        status: 'Starting...',
        startTime: new Date()
    });

    let stdoutData = '';
    let stderrData = '';

    child.stdout.on('data', (data) => {
        stdoutData += data.toString();
    });

    child.stderr.on('data', (data) => {
        const message = data.toString();
        stderrData += message;

        // Parse progress from stderr
        // Format: Transcribing chunk X/Y: ...
        const progressMatch = message.match(/Transcribing chunk (\d+)\/(\d+)/);
        if (progressMatch) {
            const current = parseInt(progressMatch[1]);
            const total = parseInt(progressMatch[2]);
            const percent = Math.round((current / total) * 100);

            const task = activeTranscriptions.get(filename);
            if (task) {
                task.progress = percent;
                task.status = `Transcribing chunk ${current}/${total}`;
                activeTranscriptions.set(filename, task);
            }
        }
    });

    child.on('close', (code) => {
        activeTranscriptions.delete(filename);

        if (code !== 0) {
            logger.error(`Transcription error for ${videoPath} (exit code ${code}):`, stderrData);

            // Clean up temp files on error
            [tmpOutput, tmpVttOutput].forEach(tmp => {
                if (fs.existsSync(tmp)) {
                    try {
                        fs.unlinkSync(tmp);
                    } catch (err) {
                        logger.error(`Failed to clean up temp file ${tmp}:`, err);
                    }
                }
            });

            if (callback) callback(new Error(`Transcription failed with code ${code}`), stdoutData, stderrData);
        } else {
            // Success: Atomic rename
            try {
                if (fs.existsSync(tmpOutput)) {
                    fs.renameSync(tmpOutput, txtOutput);
                    logger.info(`Transcription completed and saved to ${txtOutput}`);

                    if (fs.existsSync(tmpVttOutput)) {
                        fs.renameSync(tmpVttOutput, vttOutput);
                        logger.info(`VTT Transcription completed and saved to ${vttOutput}`);
                    }

                    if (callback) callback(null, stdoutData, stderrData);
                } else {
                    const msg = `Transcription finished but temp file ${tmpOutput} not found`;
                    logger.error(msg);
                    if (callback) callback(new Error(msg), stdoutData, stderrData);
                }
            } catch (renameError) {
                logger.error(`Failed to rename transcription file:`, renameError);
                if (callback) callback(renameError, stdoutData, stderrData);
            }
        }
    });

    child.on('error', (err) => {
        activeTranscriptions.delete(filename);
        logger.error(`Failed to spawn transcription process:`, err);
        if (callback) callback(err);
    });
}
