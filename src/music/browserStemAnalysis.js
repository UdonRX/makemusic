export const STEM_ANALYSIS_SECONDS = 12

export function getBrowserStemCapabilities() {
  const webGpu = typeof navigator !== 'undefined' && Boolean(navigator.gpu)
  return {
    webGpu,
    supported: webGpu,
    label: webGpu ? 'WebGPU対応' : 'WebGPU非対応',
    message: webGpu
      ? 'DemucsとBasic PitchをこのiPhone内で実行できます'
      : 'iOS 26以降のSafariでは端末内Demucsを利用できます',
  }
}

export function analyzeStemsInBrowser(channels, label, onStatus = () => {}) {
  if (!getBrowserStemCapabilities().supported) {
    return Promise.reject(new Error('WebGPUを利用できないため、Essentia.jsだけで解析します'))
  }
  if (!channels?.left?.length || !channels?.right?.length) {
    return Promise.reject(new Error('端末内解析用の音声データがありません'))
  }

  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL('./browserStemWorker.js', import.meta.url), { type: 'module' })
    const id = globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random()}`
    const timeout = window.setTimeout(() => {
      worker.terminate()
      reject(new Error('端末内解析が8分を超えたため停止しました'))
    }, 8 * 60 * 1000)

    const finish = () => {
      window.clearTimeout(timeout)
      worker.terminate()
    }
    worker.onerror = (event) => {
      finish()
      reject(new Error(event.message || '端末内解析Workerを開始できませんでした'))
    }
    worker.onmessage = (event) => {
      const message = event.data || {}
      if (message.id !== id) return
      if (message.type === 'progress') onStatus(message.message, message.progress)
      if (message.type === 'result') {
        finish()
        resolve(message.result)
      }
      if (message.type === 'error') {
        finish()
        reject(new Error(message.message || '端末内解析に失敗しました'))
      }
    }

    const left = channels.left.slice(0, Math.round(STEM_ANALYSIS_SECONDS * 44100))
    const right = channels.right.slice(0, Math.round(STEM_ANALYSIS_SECONDS * 44100))
    worker.postMessage({ id, payload: { left: left.buffer, right: right.buffer, label } }, [left.buffer, right.buffer])
  })
}
