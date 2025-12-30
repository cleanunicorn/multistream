import { exec } from 'child_process';
import fs from 'fs';
import logger from './logger.js';
import { loadConfig } from '../config/config.js';

/**
 * Transcribes a video file using Quill with atomic output creation.
 * 
 * @param {string} videoPath - Absolute path to the video file.
 * @param {function} [callback] - Optional callback (error, stdout, stderr).
 */
export function transcribeFile(videoPath, callback) {
    const txtOutput = videoPath.substring(0, videoPath.lastIndexOf('.')) + '.txt';
    const tmpOutput = txtOutput + '.tmp';

    // Load config to get model
    const config = loadConfig();
    let model = 'large';

    if (config.transcription && config.transcription.model) {
        const validModels = ['tiny', 'base', 'small', 'medium', 'large'];
        if (validModels.includes(config.transcription.model)) {
            model = config.transcription.model;
        } else {
            logger.warn(`Invalid transcription model '${config.transcription.model}', falling back to 'large'`);
        }
    }

    // Quill command: output to temp file first
    const quillCommand = `quill -m ${model} -t "${videoPath}" "${tmpOutput}" --language en`;

    logger.info(`Starting transcription: ${quillCommand}`);

    exec(quillCommand, (error, stdout, stderr) => {
        if (error) {
            logger.error(`Transcription error for ${videoPath}:`, error);

            // Clean up temp file on error
            if (fs.existsSync(tmpOutput)) {
                try {
                    fs.unlinkSync(tmpOutput);
                } catch (unlinkError) {
                    logger.error(`Failed to clean up temp file ${tmpOutput}:`, unlinkError);
                }
            }

            if (callback) callback(error);
        } else {
            // Success: Atomic rename
            try {
                if (fs.existsSync(tmpOutput)) {
                    fs.renameSync(tmpOutput, txtOutput);
                    logger.info(`Transcription completed and saved to ${txtOutput}`);
                    if (callback) callback(null, stdout, stderr);
                } else {
                    const msg = `Transcription finished but temp file ${tmpOutput} not found`;
                    logger.error(msg);
                    if (callback) callback(new Error(msg));
                }
            } catch (renameError) {
                logger.error(`Failed to rename transcription file:`, renameError);
                if (callback) callback(renameError);
            }
        }
    });
}
