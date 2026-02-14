import argparse
import sys
import os
import traceback

try:
    import nemo.collections.asr as nemo_asr
    import torch
except ImportError:
    print("Error: nemo_toolkit or torch not found.", file=sys.stderr)
    sys.exit(1)

def format_timestamp(seconds):
    hours = int(seconds // 3600)
    minutes = int((seconds % 3600) // 60)
    secs = seconds % 60
    return f"{hours:02d}:{minutes:02d}:{secs:06.3f}"

def get_wav_duration(path):
    import wave
    with wave.open(path, 'rb') as f:
        frames = f.getnframes()
        rate = f.getframerate()
        return frames / float(rate)

def format_timestamp_txt(seconds):
    hours = int(seconds // 3600)
    minutes = int((seconds % 3600) // 60)
    secs = int(seconds % 60)
    return f"{hours:02d}:{minutes:02d}:{secs:02d}"

def create_vtt(word_timestamps):
    vtt_content = ["WEBVTT\n"]
    
    # Simple grouping: just list words or group them
    # Let's group by simple chunks for readability
    current_segment = []
    current_start = None
    current_end = None
    
    for item in word_timestamps:
        # Check if item is dict or object (NeMo versions vary)
        if isinstance(item, dict):
            word = item.get('word', '')
            start = item.get('start_offset', 0.0)
            end = item.get('end_offset', 0.0)
        else:
            # Assuming object with attributes
            word = getattr(item, 'word', '')
            start = getattr(item, 'start_offset', 0.0)
            end = getattr(item, 'end_offset', 0.0)
            
        if current_start is None:
            current_start = start
        
        current_segment.append(word)
        current_end = end
        
        # Break segment if long enough
        if len(" ".join(current_segment)) > 40:
             vtt_content.append(f"\n{format_timestamp(current_start)} --> {format_timestamp(current_end)}")
             vtt_content.append(f"{' '.join(current_segment)}")
             current_segment = []
             current_start = None

    # Append remaining
    if current_segment:
        vtt_content.append(f"\n{format_timestamp(current_start)} --> {format_timestamp(current_end)}")
        vtt_content.append(f"{' '.join(current_segment)}")
        
    return "\n".join(vtt_content)

def chunk_audio(input_path, chunk_duration=300):
    """
    Converts audio to mono 16kHz wav and splits into chunks.
    Chunks are stored in a subdirectory to avoid clutter.
    """
    base_name = os.path.splitext(os.path.basename(input_path))[0]
    input_dir = os.path.dirname(input_path)
    # Create a temp directory for chunks
    temp_dir = os.path.join(input_dir, f"temp_chunks_{base_name}")
    
    if os.path.exists(temp_dir):
        import shutil
        try:
            shutil.rmtree(temp_dir)
        except:
            pass
    os.makedirs(temp_dir, exist_ok=True)
    
    chunk_pattern = os.path.join(temp_dir, f"{base_name}_chunk_%03d.wav")
    
    try:
        import glob
        print(f"Chunking audio {input_path} into {chunk_duration}s segments in {temp_dir}...", file=sys.stderr)
        cmd = [
            "ffmpeg",
            "-i", input_path,
            "-ac", "1",
            "-ar", "16000",
            "-f", "segment",
            "-segment_time", str(chunk_duration),
            "-vn",
            "-y",
            chunk_pattern
        ]
        
        import subprocess
        # Allow ffmpeg output to stderr to verify content
        subprocess.check_call(cmd, stdout=subprocess.DEVNULL)
        
        chunks = sorted(glob.glob(os.path.join(temp_dir, f"{base_name}_chunk_*.wav")))
        print(f"Created {len(chunks)} chunks.", file=sys.stderr)
        return chunks, temp_dir
    except Exception as e:
        print(f"Error chunking audio: {e}", file=sys.stderr)
        return [], temp_dir

def transcribe(video_path, output_path, vtt_path=None):
    print(f"Loading model nvidia/parakeet-tdt-0.6b-v3...", file=sys.stderr)
    audio_chunks = []
    temp_chunk_dir = None
    try:
        # Load the model
        asr_model = nemo_asr.models.EncDecRNNTBPEModel.from_pretrained(model_name="nvidia/parakeet-tdt-0.6b-v3")
        
        print(f"Preprocessing {video_path} into chunks...", file=sys.stderr)
        audio_chunks, temp_chunk_dir = chunk_audio(video_path)
        
        if not audio_chunks:
             print("Failed to preprocess audio.", file=sys.stderr)
             # Try to clean up temp dir if it exists but is empty
             if temp_chunk_dir and os.path.exists(temp_chunk_dir):
                 try:
                     import shutil
                     shutil.rmtree(temp_chunk_dir)
                 except:
                     pass
             sys.exit(1)
             
        full_text_lines = []
        all_words = []
        chunk_offset_seconds = 0.0
        
        for i, chunk_path in enumerate(audio_chunks):
            chunk_size = os.path.getsize(chunk_path)
            print(f"Transcribing chunk {i+1}/{len(audio_chunks)}: {chunk_path} (size={chunk_size} bytes)...", file=sys.stderr)
            
            try:
                transcriptions = asr_model.transcribe([chunk_path], return_hypotheses=True, timestamps=True)
                
                if transcriptions and len(transcriptions) > 0:
                    t = transcriptions[0]
                    
                     # Extract timestamps and accumulate words
                    if hasattr(t, 'timestamp') and isinstance(t.timestamp, dict) and 'word' in t.timestamp:
                         chunk_timestamps = t.timestamp['word']
                         for item in chunk_timestamps:
                             new_item = {}
                             if isinstance(item, dict):
                                 new_item['word'] = item.get('word', '')
                                 # Use 'start' (seconds) if available, otherwise fallback to start_offset but warn
                                 # Parakeet TDT returns 'start' in seconds and 'start_offset' in frames.
                                 t_start = item.get('start', item.get('start_offset', 0.0) * 0.08) 
                                 t_end = item.get('end', item.get('end_offset', 0.0) * 0.08)
                                 
                                 new_item['start_offset'] = t_start + chunk_offset_seconds
                                 new_item['end_offset'] = t_end + chunk_offset_seconds
                             else:
                                 new_item['word'] = getattr(item, 'word', '')
                                 t_start = getattr(item, 'start', getattr(item, 'start_offset', 0.0) * 0.08)
                                 t_end = getattr(item, 'end', getattr(item, 'end_offset', 0.0) * 0.08)
                                 
                                 new_item['start_offset'] = t_start + chunk_offset_seconds
                                 new_item['end_offset'] = t_end + chunk_offset_seconds
                             
                             all_words.append(new_item)
                    else:
                        # Fallback if no timestamps but text exists (unlikely with timestamps=True)
                        print(f"  > Warning: No timestamp data for chunk {i+1}", file=sys.stderr)

            except Exception as e:
                print(f"Error transcribing chunk {chunk_path}: {e}", file=sys.stderr)
                if "out of memory" in str(e).lower():
                     print("Critical OOM error. Attempting to clear cache...", file=sys.stderr)
            
            # Calculate exact duration of this chunk to avoid drift
            try:
                actual_duration = get_wav_duration(chunk_path)
            except Exception as e:
                print(f"Error getting duration for {chunk_path}, assuming 300s: {e}", file=sys.stderr)
                actual_duration = 300.0
            
            # Increment offset by actual duration
            chunk_offset_seconds += actual_duration
            
            # Manually trigger garbage collection between chunks to help memory
            import gc
            gc.collect()
            if torch.cuda.is_available():
                torch.cuda.empty_cache()

        # Process all words to generate formatted text lines
        # Format: [HH:MM:SS -> HH:MM:SS] Text
        if all_words:
            current_line_words = []
            current_line_start = all_words[0]['start_offset']
            last_word_end = all_words[0]['end_offset']
            
            # Configurable max duration per line (e.g. 10 seconds)
            MAX_LINE_DURATION = 10.0
            
            for word_item in all_words:
                word = word_item['word']
                start = word_item['start_offset']
                end = word_item['end_offset']
                
                # Check if we should start a new line
                # Break if:
                # 1. Line is too long in duration
                # 2. Significant pause (e.g. > 1s) - Optional, simpler logic for now
                
                if (end - current_line_start > MAX_LINE_DURATION) and current_line_words:
                    # Flush current line
                    start_str = format_timestamp_txt(current_line_start)
                    end_str = format_timestamp_txt(last_word_end)
                    text_content = " ".join(current_line_words)
                    full_text_lines.append(f"[{start_str} -> {end_str}] {text_content}")
                    
                    # Reset for next line
                    current_line_words = []
                    current_line_start = start
                
                current_line_words.append(word)
                last_word_end = end
                
            # Flush remaining
            if current_line_words:
                start_str = format_timestamp_txt(current_line_start)
                end_str = format_timestamp_txt(last_word_end)
                text_content = " ".join(current_line_words)
                full_text_lines.append(f"[{start_str} -> {end_str}] {text_content}")
        
        # Save formatted text
        final_text = "\n".join(full_text_lines)
        if not final_text.strip():
             print("Warning: Final transcription is empty!", file=sys.stderr)
        
        with open(output_path, 'w', encoding='utf-8') as f:
            f.write(final_text)
        print(f"Transcription saved to {output_path}", file=sys.stderr)
        
        # Save VTT (optional, but good to keep standard format too)
        if vtt_path and all_words:
            vtt_content = create_vtt(all_words)
            with open(vtt_path, 'w', encoding='utf-8') as f:
                f.write(vtt_content)
            print(f"VTT saved to {vtt_path}", file=sys.stderr)

    except Exception as e:
        print(f"An error occurred during transcription: {e}", file=sys.stderr)
        traceback.print_exc(file=sys.stderr)
        sys.exit(1)
    finally:
        # Cleanup temp dir
        if temp_chunk_dir and os.path.exists(temp_chunk_dir):
            try:
                import shutil
                shutil.rmtree(temp_chunk_dir)
                print(f"Cleaned up temp directory {temp_chunk_dir}", file=sys.stderr)
            except Exception as e:
                 print(f"Error cleaning up temp directory: {e}", file=sys.stderr)

if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Transcribe video using NVIDIA Parakeet model")
    parser.add_argument("video_path", help="Path to the video file")
    parser.add_argument("output_path", help="Path to save the transcription")
    parser.add_argument("--vtt_output", help="Path to save the VTT transcription", default=None)
    
    args = parser.parse_args()
    
    if not os.path.exists(args.video_path):
        print(f"Error: File {args.video_path} not found.", file=sys.stderr)
        sys.exit(1)
        
    transcribe(args.video_path, args.output_path, args.vtt_output)
