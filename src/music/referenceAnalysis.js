import { Chord, Note, Scale } from 'tonal'

const SONGLE_API = 'https://widget.songle.jp/api/v1'
const CACHE_PREFIX = 'makemusic:reference:v1:'
const CACHE_TTL = 7 * 24 * 60 * 60 * 1000
const CHROMATIC_TONICS = ['C', 'Db', 'D', 'Eb', 'E', 'F', 'Gb', 'G', 'Ab', 'A', 'Bb', 'B']

const clamp = (value, min, max) => Math.min(max, Math.max(min, value))
const round = (value, digits = 2) => Number(Number(value || 0).toFixed(digits))

function median(values) {
  if (!values.length) return 0
  const sorted = [...values].sort((a, b) => a - b)
  const middle = Math.floor(sorted.length / 2)
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2
}

function average(values) {
  const valid = values.filter((value) => Number.isFinite(value))
  return valid.length ? valid.reduce((sum, value) => sum + value, 0) / valid.length : 0
}

function asArray(payload, keys) {
  for (const key of keys) {
    if (Array.isArray(payload?.[key])) return payload[key]
    if (Array.isArray(payload?.scene?.[key])) return payload.scene[key]
    if (Array.isArray(payload?.song?.scene?.[key])) return payload.song.scene[key]
  }
  return []
}

function normalizeSourceUrl(url = '') {
  let value = String(url).trim()
  try {
    const parsed = new URL(value)
    if (parsed.hostname === 'youtu.be') {
      const videoId = parsed.pathname.replace(/^\//, '')
      if (videoId) value = `https://www.youtube.com/watch?v=${videoId}`
    } else if (parsed.hostname === 'music.youtube.com') {
      parsed.hostname = 'www.youtube.com'
      value = parsed.toString()
    }
  } catch {
    // Songle also accepts URLs without scheme.
  }
  return value.replace(/^https?:\/\//i, '')
}

function normalizeChordName(rawName = '') {
  const raw = String(rawName).trim()
  if (!raw || /^(N|NC|no[_ -]?chord)$/i.test(raw)) return null

  const normalized = raw
    .replace(/:maj(?!\d)/gi, '')
    .replace(/:min/gi, 'm')
    .replace(/:dim/gi, 'dim')
    .replace(/:aug/gi, 'aug')
    .replace(/:sus/gi, 'sus')
    .replace(/\(.*?\)/g, '')

  const chord = Chord.get(normalized)
  if (chord?.tonic) return normalized

  const simple = normalized.match(/^([A-G](?:#|b)?)(m|dim|aug)?/i)
  return simple ? `${simple[1]}${simple[2] || ''}` : null
}

function readCache(key) {
  try {
    const raw = localStorage.getItem(`${CACHE_PREFIX}${key}`)
    if (!raw) return null
    const parsed = JSON.parse(raw)
    if (!parsed?.savedAt || Date.now() - parsed.savedAt > CACHE_TTL) {
      localStorage.removeItem(`${CACHE_PREFIX}${key}`)
      return null
    }
    return parsed.value
  } catch {
    return null
  }
}

function writeCache(key, value) {
  try {
    localStorage.setItem(`${CACHE_PREFIX}${key}`, JSON.stringify({ savedAt: Date.now(), value }))
  } catch {
    // Safari private mode / storage pressure: caching is optional.
  }
}

async function fetchSongle(path, params) {
  const query = new URLSearchParams(params)
  const response = await fetch(`${SONGLE_API}${path}?${query.toString()}`, {
    method: 'GET',
    mode: 'cors',
    credentials: 'omit',
    headers: { Accept: 'application/json' },
  })

  if (!response.ok) {
    const error = new Error(response.status === 404 ? 'Songleに解析結果がありません' : `Songle API error: ${response.status}`)
    error.status = response.status
    throw error
  }
  return response.json()
}

export async function searchSongleSongs(query) {
  const q = String(query || '').trim()
  if (!q) return []
  const payload = await fetchSongle('/songs/search.json', { q })
  return (Array.isArray(payload) ? payload : []).slice(0, 10).map((song) => ({
    id: String(song.id || song.code || song.permalink),
    title: song.title || 'タイトル不明',
    artist: song.artist?.name || 'アーティスト不明',
    permalink: song.permalink || song.url,
    durationMs: Number(song.duration) || 0,
    rmsAmplitude: Number(song.rmsAmplitude) || 0,
  }))
}

function deriveBpm(beats) {
  const starts = beats
    .map((beat) => Number(beat.start))
    .filter(Number.isFinite)
    .sort((a, b) => a - b)
  const intervals = []
  for (let index = 1; index < starts.length; index += 1) {
    const delta = starts[index] - starts[index - 1]
    if (delta >= 250 && delta <= 1500) intervals.push(delta)
  }
  if (!intervals.length) return 120
  let bpm = 60000 / median(intervals)
  while (bpm < 70) bpm *= 2
  while (bpm > 190) bpm /= 2
  return Math.round(bpm)
}

function inferKey(chords) {
  const usable = chords.filter((item) => item.name && item.duration > 0)
  if (!usable.length) return { tonic: 'C', mode: 'major', confidence: 0 }

  const candidates = []
  for (const tonic of CHROMATIC_TONICS) {
    for (const mode of ['major', 'minor']) {
      const scaleChromas = new Set(Scale.get(`${tonic} ${mode}`).notes.map((note) => Note.chroma(note)))
      let score = 0
      let total = 0

      usable.forEach((item) => {
        const chord = Chord.get(item.name)
        const notes = chord.notes || []
        const weight = Math.max(120, item.duration)
        total += weight
        if (!notes.length) return
        const fit = notes.filter((note) => scaleChromas.has(Note.chroma(note))).length / notes.length
        score += fit * weight
        if (Note.chroma(chord.tonic) === Note.chroma(tonic)) {
          const isMinor = /m(?!aj)/.test(item.name)
          if ((mode === 'minor' && isMinor) || (mode === 'major' && !isMinor)) score += weight * 0.14
        }
      })
      candidates.push({ tonic, mode, score: total ? score / total : 0 })
    }
  }

  candidates.sort((a, b) => b.score - a.score)
  const best = candidates[0]
  const second = candidates[1]
  return {
    tonic: best.tonic,
    mode: best.mode,
    confidence: round(clamp((best.score - second.score) * 3 + 0.45, 0.25, 0.98), 2),
  }
}

function chordDegreeSequence(chords, key) {
  const scale = Scale.get(`${key.tonic} ${key.mode}`).notes
  const scaleChromas = scale.map((note) => Note.chroma(note))
  const compressed = []
  chords.forEach((item) => {
    const chord = Chord.get(item.name)
    if (!chord?.tonic) return
    const degree = scaleChromas.indexOf(Note.chroma(chord.tonic))
    if (degree < 0) return
    if (compressed[compressed.length - 1] !== degree) compressed.push(degree)
  })
  return compressed
}

function strongestPattern(degrees) {
  if (degrees.length < 4) return degrees.slice(0, 4)
  const counts = new Map()
  for (let index = 0; index <= degrees.length - 4; index += 1) {
    const pattern = degrees.slice(index, index + 4)
    const key = pattern.join('-')
    const entry = counts.get(key) || { pattern, count: 0, first: index }
    entry.count += 1
    counts.set(key, entry)
  }
  return [...counts.values()].sort((a, b) => b.count - a.count || a.first - b.first)[0]?.pattern || degrees.slice(0, 4)
}

function deriveMelody(notes, beatCount) {
  const usable = notes
    .map((note) => ({
      number: Number(note.number ?? note.pitch),
      duration: Number(note.duration) || 0,
    }))
    .filter((note) => Number.isFinite(note.number) && note.number > 0 && note.duration > 0)

  if (!usable.length) {
    return { rangeSemitones: 12, stepwiseRatio: 0.7, repetitionRatio: 0.45, notesPerBeat: 1 }
  }

  const pitches = usable.map((note) => note.number).sort((a, b) => a - b)
  const low = pitches[Math.floor((pitches.length - 1) * 0.08)]
  const high = pitches[Math.floor((pitches.length - 1) * 0.92)]
  const intervals = usable.slice(1).map((note, index) => Math.abs(note.number - usable[index].number))
  const stepwise = intervals.length ? intervals.filter((interval) => interval <= 2).length / intervals.length : 0.7
  let repeated = 0
  let comparable = 0
  for (let index = 4; index < usable.length; index += 1) {
    comparable += 1
    if (Math.abs(usable[index].number - usable[index - 4].number) <= 1) repeated += 1
  }

  return {
    rangeSemitones: Math.round(clamp(high - low, 7, 24)),
    stepwiseRatio: round(stepwise, 2),
    repetitionRatio: round(comparable ? repeated / comparable : 0.45, 2),
    notesPerBeat: round(clamp(usable.length / Math.max(1, beatCount), 0.25, 2), 2),
  }
}

function deriveStructure(chorusPayload, durationMs) {
  const chorusSegments = asArray(chorusPayload, ['chorusSegments'])
  const repeats = chorusSegments.flatMap((segment) => Array.isArray(segment.repeats) ? segment.repeats : [])
  const validRepeats = repeats
    .map((repeat) => ({ start: Number(repeat.start) || 0, duration: Number(repeat.duration) || 0 }))
    .filter((repeat) => repeat.duration > 0)

  const chorusMs = validRepeats.reduce((sum, repeat) => sum + repeat.duration, 0)
  const firstStart = validRepeats.length ? Math.min(...validRepeats.map((repeat) => repeat.start)) : durationMs * 0.55
  return {
    chorusCount: validRepeats.length || chorusSegments.length,
    firstChorusRatio: round(clamp(firstStart / Math.max(1, durationMs), 0.1, 0.85), 2),
    chorusShare: round(clamp(chorusMs / Math.max(1, durationMs), 0, 0.7), 2),
  }
}

export async function analyzeSongleReference(reference) {
  const source = normalizeSourceUrl(reference.permalink)
  if (!source) throw new Error('参考曲URLがありません')
  const cacheKey = encodeURIComponent(source).slice(0, 220)
  const cached = readCache(cacheKey)
  if (cached) return cached

  const [songInfo, beatPayload, chordPayload, melodyPayload, chorusPayload] = await Promise.all([
    fetchSongle('/song.json', { url: source }).catch(() => null),
    fetchSongle('/song/beat.json', { url: source }),
    fetchSongle('/song/chord.json', { url: source }),
    fetchSongle('/song/melody.json', { url: source }),
    fetchSongle('/song/chorus.json', { url: source }).catch(() => ({})),
  ])

  const beats = asArray(beatPayload, ['beats'])
  const rawChords = asArray(chordPayload, ['chords'])
  const notes = asArray(melodyPayload, ['notes'])
  const chords = rawChords
    .map((chord) => ({
      name: normalizeChordName(chord.name),
      start: Number(chord.start) || 0,
      duration: Number(chord.duration) || 0,
    }))
    .filter((chord) => chord.name)

  const durationMs = Number(songInfo?.duration || reference.durationMs) || Math.max(
    ...chords.map((item) => item.start + item.duration),
    ...beats.map((item) => Number(item.start) || 0),
    1,
  )
  const key = inferKey(chords)
  const degrees = chordDegreeSequence(chords, key)
  const melody = deriveMelody(notes, beats.length)
  const structure = deriveStructure(chorusPayload, durationMs)
  const bpm = deriveBpm(beats)
  const uniqueChanges = chords.filter((item, index) => index === 0 || item.name !== chords[index - 1].name)

  const result = {
    schemaVersion: 1,
    provider: 'songle',
    reference: {
      title: songInfo?.title || reference.title || 'タイトル不明',
      artist: songInfo?.artist?.name || reference.artist || 'アーティスト不明',
      permalink: reference.permalink,
      durationSec: round(durationMs / 1000, 1),
      rmsAmplitude: Number(reference.rmsAmplitude) || Number(songInfo?.rmsAmplitude) || 0,
    },
    rhythm: {
      bpm,
      beatCount: beats.length,
      chordChangesPerMinute: round(uniqueChanges.length / Math.max(1, durationMs / 60000), 2),
    },
    harmony: {
      key,
      degreeSequence: degrees.slice(0, 64),
      signatureDegrees: strongestPattern(degrees),
      chordPreview: uniqueChanges.slice(0, 12).map((item) => item.name),
    },
    melody,
    structure,
    instrumentation: {
      status: 'pending',
      message: 'Demucs + Basic Pitch + Essentia の無料解析レイヤーを後続で接続',
    },
    providers: {
      artistInfo: 'songle-search',
      musicalMap: 'songle',
      stems: null,
      transcription: null,
      audioFeatures: null,
    },
  }

  writeCache(cacheKey, result)
  return result
}

function majority(values, fallback) {
  const counts = new Map()
  values.filter(Boolean).forEach((value) => counts.set(value, (counts.get(value) || 0) + 1))
  return [...counts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] || fallback
}

function allocateSections(totalBars, firstChorusRatio) {
  const templates = [
    { name: 'Intro', ratio: 0.1 },
    { name: 'Verse', ratio: Math.max(0.18, firstChorusRatio - 0.2) },
    { name: 'Pre', ratio: 0.1 },
    { name: 'Chorus', ratio: 0.22 },
    { name: 'Bridge', ratio: 0.12 },
    { name: 'Chorus', ratio: 0.2 },
    { name: 'Outro', ratio: 0.08 },
  ]
  const ratioSum = templates.reduce((sum, item) => sum + item.ratio, 0)
  const sections = templates.map((item) => ({
    name: item.name,
    bars: Math.max(4, Math.round((totalBars * item.ratio / ratioSum) / 4) * 4),
  }))
  let delta = totalBars - sections.reduce((sum, item) => sum + item.bars, 0)
  while (Math.abs(delta) >= 4) {
    const target = delta > 0 ? sections.find((item) => item.name === 'Verse') : [...sections].reverse().find((item) => item.bars > 4)
    if (!target) break
    target.bars += delta > 0 ? 4 : -4
    delta += delta > 0 ? -4 : 4
  }
  return sections
}

export function aggregateMusicDna(analyses, targetDurationSec = 120) {
  if (!analyses.length) return null
  const bpm = Math.round(clamp(average(analyses.map((item) => item.rhythm.bpm)), 80, 180))
  const mode = majority(analyses.map((item) => item.harmony.key.mode), 'major')
  const tonic = majority(analyses.map((item) => item.harmony.key.tonic), 'C')
  const patternKeys = analyses
    .map((item) => item.harmony.signatureDegrees)
    .filter((pattern) => pattern?.length >= 3)
    .map((pattern) => pattern.join('-'))
  const signatureKey = majority(patternKeys, mode === 'minor' ? '0-5-3-4' : '0-4-5-3')
  const signatureDegrees = signatureKey.split('-').map(Number).filter(Number.isFinite)
  const firstChorusRatio = average(analyses.map((item) => item.structure.firstChorusRatio)) || 0.52
  const secondsPerBar = (60 / bpm) * 4
  const totalBars = Math.max(24, Math.round((targetDurationSec / secondsPerBar) / 4) * 4)

  return {
    schemaVersion: 1,
    kind: 'music-dna',
    references: analyses.map((item) => item.reference),
    targetDurationSec,
    rhythm: {
      bpm,
      chordChangesPerMinute: round(average(analyses.map((item) => item.rhythm.chordChangesPerMinute)), 2),
    },
    harmony: {
      tonic,
      mode,
      confidence: round(average(analyses.map((item) => item.harmony.key.confidence)), 2),
      signatureDegrees,
    },
    melody: {
      rangeSemitones: Math.round(average(analyses.map((item) => item.melody.rangeSemitones)) || 12),
      stepwiseRatio: round(average(analyses.map((item) => item.melody.stepwiseRatio)) || 0.7, 2),
      repetitionRatio: round(average(analyses.map((item) => item.melody.repetitionRatio)) || 0.45, 2),
      notesPerBeat: round(average(analyses.map((item) => item.melody.notesPerBeat)) || 1, 2),
    },
    structure: {
      firstChorusRatio: round(firstChorusRatio, 2),
      chorusShare: round(average(analyses.map((item) => item.structure.chorusShare)), 2),
      sections: allocateSections(totalBars, firstChorusRatio),
      totalBars,
    },
    instrumentation: {
      status: 'pending',
      layers: ['drums', 'bass', 'harmony', 'melody'],
    },
    pipeline: {
      artistInfo: { provider: 'Songle', status: 'active', cost: 0 },
      blueprint: { provider: 'local-rules', status: 'active', cost: 0, future: 'AI planner' },
      editableTracks: { provider: 'Tone.js + Tonal.js', status: 'active', cost: 0 },
      demucs: { status: 'future-free-worker' },
      basicPitch: { status: 'future-browser-or-free-worker' },
      essentia: { status: 'future-browser' },
    },
  }
}
