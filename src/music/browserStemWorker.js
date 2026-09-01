const DEMUCS_MODEL_URL = 'https://huggingface.co/timcsy/demucs-web-onnx/resolve/main/htdemucs_embedded.onnx'
const BASIC_PITCH_MODEL_URL = 'https://cdn.jsdelivr.net/npm/@spotify/basic-pitch@1.0.1/model/model.json'
const ORT_WASM_URL = 'https://cdn.jsdelivr.net/npm/onnxruntime-web@1.21.0/dist/'
const ORT_MODULE_URL = `${ORT_WASM_URL}ort.webgpu.min.mjs`

let runtimePromise = null

const round = (value, digits = 3) => Number(Number(value || 0).toFixed(digits))

function report(id, message, progress = null) {
  self.postMessage({ type: 'progress', id, message, progress })
}

async function fetchModel(id) {
  report(id, 'Demucsモデルを取得中… 初回のみ約172MB', 0.02)
  const response = await fetch(DEMUCS_MODEL_URL, { cache: 'force-cache' })
  if (!response.ok) throw new Error(`Demucs model ${response.status}`)
  const total = Number(response.headers.get('content-length')) || 0
  if (!response.body || !total) {
    const buffer = await response.arrayBuffer()
    report(id, 'Demucsモデルを取得しました', 0.2)
    return buffer
  }

  const bytes = new Uint8Array(total)
  const reader = response.body.getReader()
  let offset = 0
  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    bytes.set(value, offset)
    offset += value.length
    report(id, `Demucsモデルを取得中… ${Math.round(offset / 1024 / 1024)} / ${Math.round(total / 1024 / 1024)}MB`, 0.02 + (offset / total) * 0.18)
  }
  return offset === total ? bytes.buffer : bytes.slice(0, offset).buffer
}

async function loadRuntime(id) {
  if (runtimePromise) return runtimePromise
  runtimePromise = (async () => {
    if (!self.navigator?.gpu) throw new Error('この端末ではWebGPUを利用できません。iOS 26以降のSafariで試してください')
    const adapter = await self.navigator.gpu.requestAdapter({ powerPreference: 'high-performance' })
    if (!adapter) throw new Error('WebGPUアダプターを開始できませんでした')

    const [ort, demucsModule, pitchModule] = await Promise.all([
      import(/* @vite-ignore */ ORT_MODULE_URL),
      import('demucs-web'),
      import('@spotify/basic-pitch'),
    ])
    ort.env.wasm.numThreads = 1
    ort.env.wasm.wasmPaths = ORT_WASM_URL
    ort.env.logLevel = 'warning'

    const modelBuffer = await fetchModel(id)
    report(id, 'DemucsをWebGPUへ読み込み中…', 0.21)
    const processor = new demucsModule.DemucsProcessor({
      ort,
      sessionOptions: {
        executionProviders: ['webgpu', 'wasm'],
        graphOptimizationLevel: 'basic',
      },
      onProgress: ({ progress, currentSegment, totalSegments }) => {
        report(id, `Demucsで4パートへ分離中… ${currentSegment} / ${totalSegments}`, 0.25 + progress * 0.47)
      },
    })
    await processor.loadModel(modelBuffer)
    const basicPitch = new pitchModule.BasicPitch(BASIC_PITCH_MODEL_URL)
    await basicPitch.model
    return { processor, pitchModule, basicPitch }
  })()
  return runtimePromise
}

function monoFromTrack(track) {
  const length = Math.min(track.left.length, track.right.length)
  const mono = new Float32Array(length)
  for (let index = 0; index < length; index += 1) mono[index] = (track.left[index] + track.right[index]) * 0.5
  return mono
}

function audioStats(track) {
  const mono = monoFromTrack(track)
  let squareSum = 0
  let peak = 0
  for (const value of mono) {
    squareSum += value * value
    peak = Math.max(peak, Math.abs(value))
  }
  const rms = Math.sqrt(squareSum / Math.max(1, mono.length))
  const frameSize = 2205
  const envelope = []
  for (let start = 0; start < mono.length; start += frameSize) {
    let frameSquares = 0
    const end = Math.min(mono.length, start + frameSize)
    for (let index = start; index < end; index += 1) frameSquares += mono[index] * mono[index]
    envelope.push(Math.sqrt(frameSquares / Math.max(1, end - start)))
  }
  const sorted = [...envelope].sort((a, b) => a - b)
  const median = sorted[Math.floor(sorted.length / 2)] || 0
  const threshold = Math.max(0.012, median * 1.65)
  let onsets = 0
  for (let index = 1; index < envelope.length; index += 1) {
    if (envelope[index] >= threshold && envelope[index - 1] < threshold) onsets += 1
  }
  return {
    mono,
    rms: round(rms, 4),
    peak: round(peak, 4),
    loudnessDb: round(20 * Math.log10(Math.max(rms, 1e-6)), 2),
    onsetsPerSecond: round(onsets / Math.max(0.1, mono.length / 44100), 2),
  }
}

function resampleForBasicPitch(samples) {
  const output = new Float32Array(Math.floor(samples.length / 2))
  for (let index = 0; index < output.length; index += 1) {
    output[index] = (samples[index * 2] + samples[index * 2 + 1]) * 0.5
  }
  return output
}

function percentile(sorted, ratio) {
  if (!sorted.length) return null
  return sorted[Math.min(sorted.length - 1, Math.floor((sorted.length - 1) * ratio))]
}

async function noteStats(id, name, mono, runtime, progressStart, minFrequency, maxFrequency) {
  if (!mono.length) return { noteCount: 0, noteDensity: 0, pitchLow: null, pitchHigh: null, stepwiseRatio: 0, repetitionRatio: 0, meanDuration: 0 }
  const frames = []
  const onsets = []
  const input = resampleForBasicPitch(mono)
  await runtime.basicPitch.evaluateModel(
    input,
    (frameBatch, onsetBatch) => {
      frames.push(...frameBatch)
      onsets.push(...onsetBatch)
    },
    (progress) => report(id, `Basic Pitchで${name}を音符化中…`, progressStart + progress * 0.11),
  )
  const events = runtime.pitchModule.noteFramesToTime(
    runtime.pitchModule.outputToNotesPoly(frames, onsets, 0.5, 0.3, 5, true, maxFrequency, minFrequency, false),
  )
  const pitches = events.map((event) => Math.round(event.pitchMidi)).sort((a, b) => a - b)
  const chronological = events.map((event) => Math.round(event.pitchMidi))
  const intervals = chronological.slice(1).map((pitch, index) => Math.abs(pitch - chronological[index]))
  let repeated = 0
  for (let index = 4; index < chronological.length; index += 1) {
    if (Math.abs(chronological[index] - chronological[index - 4]) <= 1) repeated += 1
  }
  const duration = Math.max(0.1, mono.length / 44100)
  return {
    noteCount: events.length,
    noteDensity: round(events.length / duration, 2),
    pitchLow: percentile(pitches, 0.08),
    pitchHigh: percentile(pitches, 0.92),
    stepwiseRatio: intervals.length ? round(intervals.filter((interval) => interval <= 2).length / intervals.length, 2) : 0,
    repetitionRatio: chronological.length > 4 ? round(repeated / (chronological.length - 4), 2) : 0,
    meanDuration: events.length ? round(events.reduce((sum, event) => sum + event.durationSeconds, 0) / events.length, 3) : 0,
  }
}

async function analyze(id, payload) {
  const runtime = await loadRuntime(id)
  const left = new Float32Array(payload.left)
  const right = new Float32Array(payload.right)
  report(id, '端末内で音源分離を開始…', 0.24)
  const separated = await runtime.processor.separate(left, right)
  const stats = {}
  for (const name of ['drums', 'bass', 'other', 'vocals']) stats[name] = audioStats(separated[name])

  Object.assign(stats.bass, await noteStats(id, 'Bass', stats.bass.mono, runtime, 0.73, 30, 330))
  Object.assign(stats.vocals, await noteStats(id, 'Melody', stats.vocals.mono, runtime, 0.85, 70, 1800))
  const totalRms = Object.values(stats).reduce((sum, item) => sum + item.rms, 0) || 1
  const stems = {}
  for (const name of ['drums', 'bass', 'other', 'vocals']) {
    const { mono, ...compact } = stats[name]
    stems[name] = { ...compact, relativeLevel: round(compact.rms / totalRms, 3) }
  }
  stems.other.noteDensity = stems.other.onsetsPerSecond

  report(id, '端末内Music DNA解析完了', 1)
  return {
    schemaVersion: 2,
    provider: 'browser-webgpu',
    models: { separation: 'demucs-web/htdemucs', transcription: 'spotify/basic-pitch-ts' },
    source: {
      label: String(payload.label || '').slice(0, 120),
      durationSec: round(left.length / 44100, 1),
      sampleRate: 44100,
      retained: false,
    },
    stems,
  }
}

self.onmessage = async (event) => {
  const { id, payload } = event.data || {}
  if (!id || !payload) return
  try {
    const result = await analyze(id, payload)
    self.postMessage({ type: 'result', id, result })
  } catch (error) {
    self.postMessage({ type: 'error', id, message: error?.message || String(error) })
  }
}
