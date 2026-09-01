const SECTION_NAMES = new Set(['Intro', 'Verse', 'Pre', 'Chorus', 'Bridge', 'Break', 'Solo', 'Outro'])

export const DRUM_PRESETS = {
  fourFloor: {
    label: '4つ打ち',
    kick: [1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0],
    snare: [0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0],
    hat: [1, 0, 1, 0, 1, 0, 1, 0, 1, 0, 1, 0, 1, 0, 1, 0],
  },
  pop: {
    label: 'Pop',
    kick: [1, 0, 0, 0, 0, 0, 1, 0, 1, 0, 0, 0, 0, 0, 1, 0],
    snare: [0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0],
    hat: [1, 0, 1, 0, 1, 0, 1, 0, 1, 0, 1, 0, 1, 0, 1, 0],
  },
  halfTime: {
    label: 'Half time',
    kick: [1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0],
    snare: [0, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0],
    hat: [1, 0, 1, 0, 1, 0, 1, 0, 1, 0, 1, 0, 1, 0, 1, 0],
  },
  syncopated: {
    label: 'Syncopated',
    kick: [1, 0, 0, 1, 0, 0, 1, 0, 1, 0, 0, 1, 0, 0, 1, 0],
    snare: [0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 1, 0, 1, 0, 0, 0],
    hat: [1, 0, 1, 1, 1, 0, 1, 0, 1, 0, 1, 1, 1, 0, 1, 0],
  },
}

export const BASS_PRESETS = {
  halfNotes: { label: '2分ルート', steps: [0, 8], octaveSteps: [] },
  eighthRoots: { label: '8分ルート', steps: [0, 2, 4, 6, 8, 10, 12, 14], octaveSteps: [] },
  octave: { label: 'オクターブ', steps: [0, 2, 4, 6, 8, 10, 12, 14], octaveSteps: [2, 6, 10, 14] },
  syncopated: { label: 'シンコペ', steps: [0, 3, 6, 8, 11, 14], octaveSteps: [6, 14] },
}

const clamp = (value, min, max) => Math.min(max, Math.max(min, Number(value) || 0))
const asMode = (value, fallback = 'major') => {
  const mode = String(value || '').toLowerCase()
  if (mode.startsWith('min')) return 'minor'
  if (mode.startsWith('maj')) return 'major'
  return fallback
}
const toDegrees = (value, fallback) => {
  const degrees = (Array.isArray(value) ? value : []).map(Number).filter((item) => Number.isInteger(item) && item >= 0 && item <= 6)
  return degrees.length >= 3 ? degrees.slice(0, 8) : fallback
}

function normalizeSections(value, fallback) {
  const input = Array.isArray(value) && value.length ? value : fallback
  return input.slice(0, 9).map((item, index) => ({
    name: SECTION_NAMES.has(item?.name) ? item.name : (fallback[index]?.name || 'Verse'),
    bars: Math.round(clamp(item?.bars || fallback[index]?.bars || 4, 4, 32) / 4) * 4,
    energy: Number(clamp(item?.energy ?? fallback[index]?.energy ?? 0.5, 0.1, 1).toFixed(2)),
  }))
}

export function createLocalBlueprint(dna, intent = '') {
  const mode = asMode(dna?.harmony?.mode)
  const fallbackDegrees = mode === 'minor' ? [0, 5, 3, 4] : [0, 4, 5, 3]
  const sourceSections = dna?.structure?.sections || [
    { name: 'Intro', bars: 4 },
    { name: 'Verse', bars: 8 },
    { name: 'Chorus', bars: 8 },
    { name: 'Outro', bars: 4 },
  ]
  const sections = sourceSections.map((section, index) => ({
    name: SECTION_NAMES.has(section.name) ? section.name : 'Verse',
    bars: Math.round(clamp(section.bars, 4, 32) / 4) * 4,
    energy: Number(clamp(index / Math.max(1, sourceSections.length - 1) * 0.55 + (section.name === 'Chorus' ? 0.42 : 0.25), 0.18, 1).toFixed(2)),
  }))
  const notesPerBeat = clamp(dna?.melody?.notesPerBeat || 1, 0.25, 2)
  const drumPreset = dna?.stems?.drums?.fourOnFloorRatio > 0.62 ? 'fourFloor' : notesPerBeat > 1.3 ? 'syncopated' : 'pop'
  const bassPreset = dna?.stems?.bass?.noteDensity > 1.25 ? 'eighthRoots' : 'halfNotes'

  return {
    schemaVersion: 1,
    kind: 'song-blueprint',
    provider: 'local-fallback',
    title: intent.trim().slice(0, 48) || 'Music DNA Sketch',
    intent: intent.trim().slice(0, 240),
    bpm: Math.round(clamp(dna?.rhythm?.bpm || 120, 70, 190)),
    key: {
      tonic: dna?.harmony?.tonic || 'C',
      mode,
    },
    timeSignature: '4/4',
    durationSec: Math.round(clamp(dna?.targetDurationSec || 120, 45, 300)),
    sections,
    harmony: {
      degreePattern: toDegrees(dna?.harmony?.signatureDegrees, fallbackDegrees),
      chordRhythm: 'one-per-bar',
    },
    tracks: {
      drums: { preset: drumPreset },
      bass: { preset: bassPreset, octave: 2 },
      melody: {
        rangeSemitones: Math.round(clamp(dna?.melody?.rangeSemitones || 14, 7, 24)),
        stepwiseRatio: Number(clamp(dna?.melody?.stepwiseRatio || 0.7, 0.2, 0.98).toFixed(2)),
        repetitionRatio: Number(clamp(dna?.melody?.repetitionRatio || 0.45, 0.05, 0.95).toFixed(2)),
        notesPerBeat: Number(notesPerBeat.toFixed(2)),
      },
    },
    rationale: ['Music DNAの統計値を優先', '無料枠切れでも編集と再生を継続'],
  }
}

export function normalizeBlueprint(candidate, dna, intent = '') {
  const fallback = createLocalBlueprint(dna, intent)
  const mode = asMode(candidate?.key?.mode, fallback.key.mode)
  return {
    ...fallback,
    provider: candidate?.provider === 'gemini' ? 'gemini' : fallback.provider,
    title: String(candidate?.title || fallback.title).slice(0, 48),
    bpm: Math.round(clamp(candidate?.bpm || fallback.bpm, 70, 190)),
    key: {
      tonic: /^[A-G](?:#|b)?$/.test(candidate?.key?.tonic || '') ? candidate.key.tonic : fallback.key.tonic,
      mode,
    },
    sections: normalizeSections(candidate?.sections, fallback.sections),
    harmony: {
      degreePattern: toDegrees(candidate?.harmony?.degreePattern, fallback.harmony.degreePattern),
      chordRhythm: 'one-per-bar',
    },
    tracks: {
      drums: { preset: DRUM_PRESETS[candidate?.tracks?.drums?.preset] ? candidate.tracks.drums.preset : fallback.tracks.drums.preset },
      bass: {
        preset: BASS_PRESETS[candidate?.tracks?.bass?.preset] ? candidate.tracks.bass.preset : fallback.tracks.bass.preset,
        octave: Math.round(clamp(candidate?.tracks?.bass?.octave || 2, 1, 3)),
      },
      melody: {
        rangeSemitones: Math.round(clamp(candidate?.tracks?.melody?.rangeSemitones || fallback.tracks.melody.rangeSemitones, 7, 24)),
        stepwiseRatio: Number(clamp(candidate?.tracks?.melody?.stepwiseRatio ?? fallback.tracks.melody.stepwiseRatio, 0.2, 0.98).toFixed(2)),
        repetitionRatio: Number(clamp(candidate?.tracks?.melody?.repetitionRatio ?? fallback.tracks.melody.repetitionRatio, 0.05, 0.95).toFixed(2)),
        notesPerBeat: Number(clamp(candidate?.tracks?.melody?.notesPerBeat || fallback.tracks.melody.notesPerBeat, 0.25, 2).toFixed(2)),
      },
    },
    rationale: (Array.isArray(candidate?.rationale) ? candidate.rationale : fallback.rationale).map(String).slice(0, 4),
  }
}

export async function requestSongBlueprint(dna, intent = '') {
  const fallback = createLocalBlueprint(dna, intent)
  try {
    const quotaKey = `makemusic:planner:${new Date().toISOString().slice(0, 10)}`
    let dailyCount = 0
    try {
      dailyCount = Number(localStorage.getItem(quotaKey) || 0)
    } catch {
      // A missing browser cache must not block composition.
    }
    if (dailyCount >= 8) {
      return { blueprint: fallback, status: 'ローカル設計図を使用', warning: 'Vercel Hobby保護のため、この端末のGemini呼び出しは1日8回までです。' }
    }
    try {
      localStorage.setItem(quotaKey, String(dailyCount + 1))
    } catch {
      // Continue without persistence when Safari storage is unavailable.
    }
    const response = await fetch('/api/music', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'plan', dna, intent: intent.trim().slice(0, 240) }),
    })
    if (!response.ok) throw new Error(`Planner API ${response.status}`)
    const payload = await response.json()
    const normalized = normalizeBlueprint(payload.blueprint, dna, intent)
    return {
      blueprint: normalized,
      status: payload.provider === 'gemini' ? 'Gemini無料枠で設計図を作成' : 'ローカル設計図を使用',
      warning: payload.warning || '',
    }
  } catch (error) {
    return {
      blueprint: fallback,
      status: 'ローカル設計図を使用',
      warning: `Geminiへ接続できなかったため安全な代替を使用: ${error.message}`,
    }
  }
}
