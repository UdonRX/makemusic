const DEFAULT_SPACE_ID = import.meta.env.VITE_HF_SPACE_ID || ''

export function getZeroGpuSpaceId() {
  try {
    return localStorage.getItem('makemusic:hf-space-id') || DEFAULT_SPACE_ID
  } catch {
    return DEFAULT_SPACE_ID
  }
}

export function saveZeroGpuSpaceId(value) {
  const normalized = String(value || '').trim().replace(/^https?:\/\/huggingface\.co\/spaces\//, '').replace(/\/$/, '')
  if (normalized && !/^[\w.-]+\/[\w.-]+$/.test(normalized)) throw new Error('Space IDは owner/space-name の形式です')
  try {
    if (normalized) localStorage.setItem('makemusic:hf-space-id', normalized)
    else localStorage.removeItem('makemusic:hf-space-id')
  } catch {
    // The in-memory value can still be used by the current action.
  }
  return normalized
}

export async function analyzeWithZeroGpu(wavBlob, label, onStatus = () => {}, overrideSpaceId = '') {
  const spaceId = overrideSpaceId || getZeroGpuSpaceId()
  if (!spaceId) throw new Error('Hugging Face Spaceが未接続です')
  const { Client, handle_file } = await import('@gradio/client')
  onStatus('ZeroGPU Spaceを起動中…')
  const app = await Client.connect(spaceId, {
    status_callback: (status) => onStatus(status?.message || `ZeroGPU: ${status?.status || '準備中'}`),
  })
  onStatus('Demucsで楽器分離、Basic Pitchで音符化中…')
  const result = await app.predict('/analyze', {
    audio_file: handle_file(new File([wavBlob], 'reference-30s.wav', { type: 'audio/wav' })),
    label: String(label || '').slice(0, 120),
  })
  const payload = result?.data?.[0]
  if (!payload) throw new Error('ZeroGPUから解析結果が返りませんでした')
  return typeof payload === 'string' ? JSON.parse(payload) : payload
}
