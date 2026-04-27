import { exec } from 'child_process';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import logger from './logger.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/**
 * Transcribes a video file using the NVIDIA Parakeet model via a Python script.
 * 
 * @param {string} videoPath - Absolute path to the video file.
 * @param {function} [callback] - Optional callback (error, stdout, stderr).
 */
export function transcribeFile(videoPath, callback) {
    const txtOutput = videoPath.substring(0, videoPath.lastIndexOf('.')) + '.txt';
    const tmpOutput = txtOutput + '.tmp';
    const vttOutput = videoPath.substring(0, videoPath.lastIndexOf('.')) + '.vtt';
    const tmpVttOutput = vttOutput + '.tmp';

    const pythonScript = path.join(__dirname, 'transcribe_parakeet.py');

    // Construct the command to run the python script using uv
    // We use --with to ensure dependencies are present in the ephemeral environment.
    // Pinned Python 3.10 and lhotse<1.27 for NeMo 2.0 compatibility.
    // cmake is needed for some extensions build.
    const command = `uv run --python 3.10 --with "cmake" --with "torch" --with "torchaudio" --with "nemo_toolkit[asr]" --with "lhotse<1.27" "${pythonScript}" "${videoPath}" "${tmpOutput}" --vtt_output "${tmpVttOutput}"`;

    logger.info(`Starting transcription with Parakeet: ${command}`);

    exec(command, { maxBuffer: 10 * 1024 * 1024 }, (error, stdout, stderr) => {
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
            if (fs.existsSync(tmpVttOutput)) {
                try {
                    fs.unlinkSync(tmpVttOutput);
                } catch (unlinkError) {
                    logger.error(`Failed to clean up temp VTT file ${tmpVttOutput}:`, unlinkError);
                }
            }

            if (callback) callback(error);
        } else {
            // Success: Atomic rename
            try {
                if (fs.existsSync(tmpOutput)) {
                    fs.renameSync(tmpOutput, txtOutput);
                    logger.info(`Transcription completed and saved to ${txtOutput}`);

                    // Rename VTT if it exists
                    if (fs.existsSync(tmpVttOutput)) {
                        fs.renameSync(tmpVttOutput, vttOutput);
                        logger.info(`VTT Transcription completed and saved to ${vttOutput}`);
                    }

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
