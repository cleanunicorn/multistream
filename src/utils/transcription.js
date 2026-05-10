import { spawn } from 'child_process';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import logger from './logger.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Track active transcription processes: videoPath -> { process, progress, startTime }
const activeTranscriptions = new Map();

/**
 * Returns an object containing all active transcriptions and their progress.
 */
export function getActiveTranscriptions() {
    const transcriptions = {};
    activeTranscriptions.forEach((data, videoPath) => {
        const filename = path.basename(videoPath);
        transcriptions[filename] = {
            progress: data.progress,
            startTime: data.startTime
        };
    });
    return transcriptions;
}

/**
 * Kills an active transcription process for a specific video file.
 * @param {string} videoPath - Absolute path to the video file.
 */
export function killTranscription(videoPath) {
    const data = activeTranscriptions.get(videoPath);
    if (data && data.process) {
        logger.info(`Killing active transcription for ${videoPath}`);
        // Use SIGKILL to ensure it stops immediately
        data.process.kill('SIGKILL');
        // Map deletion will happen in 'close' handler
        return true;
    }
    return false;
}

/**
 * Transcribes a video file using the NVIDIA Parakeet model via a Python script.
 * 
 * @param {string} videoPath - Absolute path to the video file.
 * @param {function} [callback] - Optional callback (error, stdout, stderr).
 */
export function transcribeFile(videoPath, callback) {
    if (activeTranscriptions.has(videoPath)) {
        logger.warn(`Transcription already in progress for ${videoPath}`);
        if (callback) callback(new Error('Transcription already in progress'));
        return;
    }

    const txtOutput = videoPath.substring(0, videoPath.lastIndexOf('.')) + '.txt';
    const tmpOutput = txtOutput + '.tmp';
    const vttOutput = videoPath.substring(0, videoPath.lastIndexOf('.')) + '.vtt';
    const tmpVttOutput = vttOutput + '.tmp';

    const pythonScript = path.join(__dirname, 'transcribe_parakeet.py');

    // Using uv run to execute the transcription script
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

    logger.info(`Starting transcription with Parakeet for ${videoPath}`);

    const child = spawn('uv', args);

    activeTranscriptions.set(videoPath, {
        process: child,
        progress: 0,
        startTime: new Date()
    });

    let stdoutData = '';
    let stderrData = '';

    child.stdout.on('data', (data) => {
        stdoutData += data.toString();
    });

    child.stderr.on('data', (data) => {
        const output = data.toString();
        stderrData += output;

        // Parse progress: "Transcribing chunk 1/10"
        const progressMatch = output.match(/Transcribing chunk (\d+)\/(\d+)/);
        if (progressMatch) {
            const current = parseInt(progressMatch[1]);
            const total = parseInt(progressMatch[2]);
            const progress = Math.round((current / total) * 100);

            const task = activeTranscriptions.get(videoPath);
            if (task) {
                task.progress = progress;
            }
        }
    });

    child.on('close', (code) => {
        activeTranscriptions.delete(videoPath);

        if (code !== 0) {
            logger.error(`Transcription error for ${videoPath} (exit code ${code}):`, stderrData);

            // Clean up temp files on error
            [tmpOutput, tmpVttOutput].forEach(file => {
                if (fs.existsSync(file)) {
                    try { fs.unlinkSync(file); } catch (e) { logger.error(`Cleanup error: ${e.message}`); }
                }
            });

            if (callback) callback(new Error(`Transcription failed with code ${code}`));
        } else {
            // Success: Atomic rename
            try {
                if (fs.existsSync(tmpOutput)) {
                    fs.renameSync(tmpOutput, txtOutput);
                    if (fs.existsSync(tmpVttOutput)) {
                        fs.renameSync(tmpVttOutput, vttOutput);
                    }
                    logger.info(`Transcription completed for ${videoPath}`);
                    if (callback) callback(null, stdoutData, stderrData);
                } else {
                    logger.error(`Transcription finished but ${tmpOutput} not found`);
                    if (callback) callback(new Error('Output file not found'));
                }
            } catch (error) {
                logger.error(`Rename error: ${error.message}`);
                if (callback) callback(error);
            }
        }
    });

    child.on('error', (err) => {
        activeTranscriptions.delete(videoPath);
        logger.error(`Failed to start transcription process: ${err.message}`);
        if (callback) callback(err);
    });
}
