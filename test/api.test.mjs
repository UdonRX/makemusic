import test from 'node:test'
import assert from 'node:assert/strict'
import handler, { config } from '../api/music.mjs'

function responseMock() {
  return {
    statusCode: 200,
    headers: {},
    body: '',
    status(value) { this.statusCode = value; return this },
    setHeader(key, value) { this.headers[key] = value },
    end(value) { this.body = value || '' },
  }
}

test('planner API has a hard 10-second duration and safe no-key fallback', async () => {
  assert.equal(config.maxDuration, 10)
  const originalKey = process.env.GEMINI_API_KEY
  delete process.env.GEMINI_API_KEY
  const response = responseMock()
  await handler({ method: 'POST', body: { action: 'plan', dna: { rhythm: { bpm: 120 } } } }, response)
  if (originalKey) process.env.GEMINI_API_KEY = originalKey
  assert.equal(response.statusCode, 200)
  const payload = JSON.parse(response.body)
  assert.equal(payload.provider, 'local-fallback')
  assert.match(payload.warning, /GEMINI_API_KEY/)
})

test('planner API rejects malformed input before external calls', async () => {
  const response = responseMock()
  await handler({ method: 'POST', body: { action: 'plan' } }, response)
  assert.equal(response.statusCode, 400)
})
