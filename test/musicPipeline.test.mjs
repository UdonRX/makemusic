import test from 'node:test'
import assert from 'node:assert/strict'
import { aggregateMusicDna, analysisFromUploadedAudio } from '../src/music/referenceAnalysis.js'
import { BASS_PRESETS, createLocalBlueprint, DRUM_PRESETS, normalizeBlueprint } from '../src/music/songBlueprint.js'

const localAudio = {
  fileName: 'owned-reference.m4a',
  originalDurationSec: 210,
  clipDurationSec: 30,
  features: {
    provider: 'essentia.js',
    bpm: 126,
    key: 'F#',
    scale: 'minor',
    keyStrength: 0.78,
    loudnessDb: -12.4,
    dynamicComplexity: 3.2,
    danceability: 1.14,
  },
}

const zeroGpu = {
  provider: 'huggingface-zerogpu',
  stems: {
    drums: { relativeLevel: 0.32, onsetsPerSecond: 3.8 },
    bass: { relativeLevel: 0.23, noteDensity: 1.4, pitchLow: 36, pitchHigh: 48 },
    other: { relativeLevel: 0.29, noteDensity: 2.2, pitchLow: 50, pitchHigh: 78, stepwiseRatio: 0.62 },
    vocals: { relativeLevel: 0.16, noteDensity: 1.1, pitchLow: 59, pitchHigh: 73, stepwiseRatio: 0.76, noteCount: 33 },
  },
}

test('uploaded audio becomes compact Music DNA v2 without raw audio', () => {
  const analysis = analysisFromUploadedAudio(localAudio, zeroGpu)
  assert.equal(analysis.schemaVersion, 2)
  assert.equal(analysis.harmony.key.tonic, 'Gb')
  assert.equal(analysis.harmony.key.mode, 'minor')
  assert.equal(analysis.instrumentation.status, 'analyzed')
  assert.equal(analysis.stems.melody.noteDensity, 1.1)
  assert.equal('wavBlob' in analysis, false)

  const dna = aggregateMusicDna([analysis], 120, { id: 'artist-1', name: 'Reference Artist', tags: ['electronic'] })
  assert.equal(dna.schemaVersion, 2)
  assert.equal(dna.artist.name, 'Reference Artist')
  assert.equal(dna.stems.provider, 'demucs + basic-pitch')
  assert.equal(dna.pipeline.essentia.status, 'active')
})

test('local blueprint and AI normalization always produce editable track presets', () => {
  const analysis = analysisFromUploadedAudio(localAudio, zeroGpu)
  const dna = aggregateMusicDna([analysis], 120)
  const fallback = createLocalBlueprint(dna, '夜に踊れる曲')
  assert.ok(DRUM_PRESETS[fallback.tracks.drums.preset])
  assert.ok(BASS_PRESETS[fallback.tracks.bass.preset])
  assert.ok(fallback.harmony.degreePattern.length >= 3)

  const normalized = normalizeBlueprint({
    provider: 'gemini',
    key: { tonic: 'A', mode: 'major' },
    tracks: { drums: { preset: 'invalid' }, bass: { preset: 'invalid', octave: 9 }, melody: {} },
    sections: [{ name: 'Unknown', bars: 999, energy: 7 }],
    harmony: { degreePattern: [0, 4, 5, 3] },
  }, dna, '')
  assert.equal(normalized.provider, 'gemini')
  assert.equal(normalized.key.mode, 'major')
  assert.ok(DRUM_PRESETS[normalized.tracks.drums.preset])
  assert.ok(BASS_PRESETS[normalized.tracks.bass.preset])
  assert.equal(normalized.tracks.bass.octave, 3)
  assert.equal(normalized.sections[0].bars, 32)
})

test('all drum presets have a complete 16-step contract', () => {
  for (const preset of Object.values(DRUM_PRESETS)) {
    for (const part of ['kick', 'snare', 'hat']) {
      assert.equal(preset[part].length, 16)
      assert.ok(preset[part].every((value) => value === 0 || value === 1))
    }
  }
})
