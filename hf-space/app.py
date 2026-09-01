from __future__ import annotations

import math
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path

import gradio as gr
import numpy as np
import soundfile as sf
import spaces
from basic_pitch.inference import predict

MAX_BYTES = 6 * 1024 * 1024
MAX_SECONDS = 31.0
ALLOWED_SUFFIXES = {'.wav'}


def _round(value: float, digits: int = 3) -> float:
    return round(float(value or 0), digits)


def _validate_audio(path: Path) -> tuple[np.ndarray, int]:
    if not path.exists() or path.suffix.lower() not in ALLOWED_SUFFIXES:
        raise gr.Error('ブラウザで整形されたWAVだけを受け付けます')
    if path.stat().st_size > MAX_BYTES:
        raise gr.Error('解析区間が大きすぎます（最大6MB）')
    audio, sample_rate = sf.read(path, dtype='float32', always_2d=True)
    duration = len(audio) / max(1, sample_rate)
    if duration <= 0 or duration > MAX_SECONDS:
        raise gr.Error('解析区間は30秒以下にしてください')
    mono = audio.mean(axis=1)
    sf.write(path, mono, sample_rate, subtype='PCM_16')
    return mono, sample_rate


def _audio_stats(path: Path) -> dict:
    audio, sample_rate = sf.read(path, dtype='float32', always_2d=True)
    mono = audio.mean(axis=1)
    rms = math.sqrt(float(np.mean(np.square(mono))) + 1e-12)
    peak = float(np.max(np.abs(mono))) if mono.size else 0
    frame = max(1, sample_rate // 20)
    envelope = np.array([
        math.sqrt(float(np.mean(np.square(mono[index:index + frame]))) + 1e-12)
        for index in range(0, len(mono), frame)
    ])
    threshold = max(0.012, float(np.median(envelope) * 1.65)) if envelope.size else 0.012
    onsets = int(np.sum((envelope[1:] >= threshold) & (envelope[:-1] < threshold))) if len(envelope) > 1 else 0
    return {
        'rms': _round(rms, 4),
        'peak': _round(peak, 4),
        'loudnessDb': _round(20 * math.log10(max(rms, 1e-6)), 2),
        'onsetsPerSecond': _round(onsets / max(0.1, len(mono) / sample_rate), 2),
    }


def _note_stats(path: Path) -> dict:
    _, _, note_events = predict(str(path))
    compact = []
    pitches = []
    durations = []
    for event in note_events[:256]:
        start, end, pitch, amplitude = event[:4]
        pitches.append(int(pitch))
        durations.append(float(end - start))
        if len(compact) < 64:
            compact.append({
                'start': _round(start, 3),
                'duration': _round(end - start, 3),
                'midi': int(pitch),
                'velocity': _round(amplitude, 3),
            })
    intervals = [abs(pitches[index] - pitches[index - 1]) for index in range(1, len(pitches))]
    duration = max(0.1, sf.info(path).duration)
    return {
        'noteCount': len(note_events),
        'noteDensity': _round(len(note_events) / duration, 2),
        'pitchLow': int(np.percentile(pitches, 8)) if pitches else None,
        'pitchHigh': int(np.percentile(pitches, 92)) if pitches else None,
        'stepwiseRatio': _round(sum(interval <= 2 for interval in intervals) / len(intervals), 2) if intervals else 0,
        'meanDuration': _round(float(np.mean(durations)), 3) if durations else 0,
        'notes': compact,
    }


@spaces.GPU(duration=120)
def analyze(audio_file: str, label: str = '') -> dict:
    if not audio_file:
        raise gr.Error('音源を選んでください')
    source = Path(audio_file)
    with tempfile.TemporaryDirectory(prefix='makemusic-') as temp_name:
        temp = Path(temp_name)
        input_path = temp / 'reference.wav'
        shutil.copy2(source, input_path)
        mono, sample_rate = _validate_audio(input_path)
        output_dir = temp / 'separated'
        command = [
            sys.executable, '-m', 'demucs.separate',
            '-n', 'htdemucs', '--device', 'cuda',
            '--out', str(output_dir), str(input_path),
        ]
        completed = subprocess.run(command, capture_output=True, text=True, timeout=82)
        if completed.returncode != 0:
            raise gr.Error(f'Demucs error: {completed.stderr[-500:]}')
        stem_dir = output_dir / 'htdemucs' / input_path.stem
        stem_paths = {name: stem_dir / f'{name}.wav' for name in ('drums', 'bass', 'vocals', 'other')}
        if not all(path.exists() for path in stem_paths.values()):
            raise gr.Error('Demucsのstem出力を確認できませんでした')

        stems = {}
        for name, path in stem_paths.items():
            stats = _audio_stats(path)
            if name in {'bass', 'vocals', 'other'}:
                stats.update(_note_stats(path))
            stems[name] = stats

        total_rms = sum(item['rms'] for item in stems.values()) or 1
        for item in stems.values():
            item['relativeLevel'] = _round(item['rms'] / total_rms, 3)

        return {
            'schemaVersion': 1,
            'provider': 'huggingface-zerogpu',
            'models': {'separation': 'demucs/htdemucs', 'transcription': 'spotify/basic-pitch-0.4.0'},
            'source': {
                'label': str(label or '')[:120],
                'durationSec': _round(len(mono) / sample_rate, 1),
                'sampleRate': sample_rate,
                'retained': False,
            },
            'stems': stems,
        }


with gr.Blocks(title='MakeMusic Audio DNA') as demo:
    gr.Markdown('## MakeMusic Audio DNA\n権利を持つ30秒以下のWAVから、保存せずMusic DNAだけを返します。')
    audio_input = gr.File(label='30秒WAV', file_types=['.wav'], type='filepath')
    label_input = gr.Textbox(label='曲名（任意）', max_lines=1)
    output = gr.JSON(label='Music DNA')
    run = gr.Button('Demucs + Basic Pitchで解析', variant='primary')
    run.click(analyze, inputs=[audio_input, label_input], outputs=output, api_name='analyze')

demo.queue(default_concurrency_limit=1, max_size=8)
demo.launch()
