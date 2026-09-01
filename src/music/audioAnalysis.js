const MAX_FILE_BYTES = 12 * 1024 * 1024
export const ANALYSIS_SECONDS = 30
const TARGET_SAMPLE_RATE = 44100

const clamp = (value, min, max) => Math.min(max, Math.max(min, Number(value) || 0))
const round = (value, digits = 3) => Number(Number(value || 0).toFixed(digits))

function assertAudioFile(file) {
  if (!(file instanceof File)) throw new Error('音源ファイルを選んでください')
  if (file.size > MAX_FILE_BYTES) throw new Error('音源は12MB以下にしてください')
  if (!file.type.startsWith('audio/') && !/\.(mp3|m4a|aac|wav|flac|ogg)$/i.test(file.name)) {
    throw new Error('MP3 / M4A / WAV / FLAC / OGGを選んでください')
  }
}

function mixToMono(audioBuffer) {
  const mono = new Float32Array(audioBuffer.length)
  for (let channel = 0; channel < audioBuffer.numberOfChannels; channel += 1) {
    const input = audioBuffer.getChannelData(channel)
    for (let index = 0; index < input.length; index += 1) mono[index] += input[index] / audioBuffer.numberOfChannels
  }
  return mono
}

async function cropAndResample(audioBuffer) {
  const clipDuration = Math.min(ANALYSIS_SECONDS, audioBuffer.duration)
  const clipStart = Math.max(0, (audioBuffer.duration - clipDuration) * 0.5)
  const sourceStart = Math.floor(clipStart * audioBuffer.sampleRate)
  const sourceLength = Math.max(1, Math.floor(clipDuration * audioBuffer.sampleRate))
  const mono = mixToMono(audioBuffer).slice(sourceStart, sourceStart + sourceLength)
  const offline = new OfflineAudioContext(1, Math.ceil(clipDuration * TARGET_SAMPLE_RATE), TARGET_SAMPLE_RATE)
  const sourceBuffer = offline.createBuffer(1, mono.length, audioBuffer.sampleRate)
  sourceBuffer.copyToChannel(mono, 0)
  const source = offline.createBufferSource()
  source.buffer = sourceBuffer
  source.connect(offline.destination)
  source.start()
  const rendered = await offline.startRendering()
  return {
    samples: new Float32Array(rendered.getChannelData(0)),
    clipStart,
    clipDuration: rendered.duration,
  }
}

function writeText(view, offset, value) {
  for (let index = 0; index < value.length; index += 1) view.setUint8(offset + index, value.charCodeAt(index))
}

function samplesToWav(samples, sampleRate = TARGET_SAMPLE_RATE) {
  const buffer = new ArrayBuffer(44 + samples.length * 2)
  const view = new DataView(buffer)
  writeText(view, 0, 'RIFF')
  view.setUint32(4, 36 + samples.length * 2, true)
  writeText(view, 8, 'WAVE')
  writeText(view, 12, 'fmt ')
  view.setUint32(16, 16, true)
  view.setUint16(20, 1, true)
  view.setUint16(22, 1, true)
  view.setUint32(24, sampleRate, true)
  view.setUint32(28, sampleRate * 2, true)
  view.setUint16(32, 2, true)
  view.setUint16(34, 16, true)
  writeText(view, 36, 'data')
  view.setUint32(40, samples.length * 2, true)
  samples.forEach((sample, index) => {
    const value = Math.max(-1, Math.min(1, sample))
    view.setInt16(44 + index * 2, value < 0 ? value * 0x8000 : value * 0x7fff, true)
  })
  return new Blob([buffer], { type: 'audio/wav' })
}

function simpleFeatures(samples) {
  let squareSum = 0
  let peak = 0
  let crossings = 0
  for (let index = 0; index < samples.length; index += 1) {
    const value = samples[index]
    squareSum += value * value
    peak = Math.max(peak, Math.abs(value))
    if (index && (value >= 0) !== (samples[index - 1] >= 0)) crossings += 1
  }
  const rms = Math.sqrt(squareSum / Math.max(1, samples.length))
  return {
    rms: round(rms, 4),
    peak: round(peak, 4),
    zeroCrossingRate: round(crossings / Math.max(1, samples.length), 5),
    loudnessDb: round(20 * Math.log10(Math.max(rms, 1e-6)), 2),
  }
}

async function runEssentia(samples) {
  const [{ default: Essentia }, { EssentiaWASM }] = await Promise.all([
    import('essentia.js/dist/essentia.js-core.es.js'),
    import('essentia.js/dist/essentia-wasm.es.js'),
  ])
  const essentia = new Essentia(EssentiaWASM)
  const signal = essentia.arrayToVector(samples)
  try {
    const [rhythm, key, dynamics, danceability] = [
      essentia.RhythmExtractor2013(signal, 208, 'multifeature', 40),
      essentia.KeyExtractor(signal, true, 4096, 2048, 12, 3500, 60, 25, 0.2, 'bgate', TARGET_SAMPLE_RATE, 0.0001, 440, 'cosine', 'hann'),
      essentia.DynamicComplexity(signal, 0.2, TARGET_SAMPLE_RATE),
      essentia.Danceability(signal, 8800, 310, TARGET_SAMPLE_RATE, 1.1),
    ]
    let bpm = Number(rhythm.bpm) || 0
    while (bpm && bpm < 70) bpm *= 2
    while (bpm > 190) bpm /= 2
    return {
      provider: 'essentia.js',
      bpm: Math.round(clamp(bpm || 120, 70, 190)),
      bpmConfidence: round(rhythm.confidence, 3),
      key: key.key || 'C',
      scale: String(key.scale || 'major').toLowerCase().includes('minor') ? 'minor' : 'major',
      keyStrength: round(key.strength, 3),
      dynamicComplexity: round(dynamics.dynamicComplexity, 3),
      loudnessDb: round(dynamics.loudness, 2),
      danceability: round(danceability.danceability, 3),
    }
  } finally {
    signal.delete?.()
    essentia.shutdown?.()
  }
}

export async function analyzeAudioFileLocally(file, onStatus = () => {}) {
  assertAudioFile(file)
  onStatus('音源を30秒へ整形中…')
  const context = new AudioContext()
  try {
    const decoded = await context.decodeAudioData(await file.arrayBuffer())
    if (decoded.duration > 600) throw new Error('iPhoneのメモリ保護のため、音源は10分以内にしてください')
    const clip = await cropAndResample(decoded)
    const base = simpleFeatures(clip.samples)
    onStatus('Essentia.jsでBPM・Key・音響特徴を解析中…')
    let essentiaFeatures
    try {
      essentiaFeatures = await runEssentia(clip.samples)
    } catch (error) {
      console.warn('[MakeMusic Essentia]', error)
      essentiaFeatures = { provider: 'browser-fallback', bpm: 120, key: 'C', scale: 'major', warning: error.message }
    }
    return {
      fileName: file.name,
      originalDurationSec: round(decoded.duration, 1),
      clipStartSec: round(clip.clipStart, 1),
      clipDurationSec: round(clip.clipDuration, 1),
      sampleRate: TARGET_SAMPLE_RATE,
      features: { ...base, ...essentiaFeatures },
      wavBlob: samplesToWav(clip.samples),
    }
  } finally {
    await context.close().catch(() => {})
  }
}
