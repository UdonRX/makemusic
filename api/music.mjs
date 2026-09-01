const GEMINI_MODEL = process.env.GEMINI_MODEL || 'gemini-2.5-flash-lite'
const APP_USER_AGENT = 'makemusic/0.3 (https://makemusic-brown.vercel.app)'

export const config = { maxDuration: 10 }

const json = (response, status, body, headers = {}) => {
  response.status(status)
  Object.entries({ 'Content-Type': 'application/json; charset=utf-8', ...headers }).forEach(([key, value]) => response.setHeader(key, value))
  response.end(JSON.stringify(body))
}

const asText = (value, max = 240) => String(value || '').trim().slice(0, max)
const clamp = (value, min, max) => Math.min(max, Math.max(min, Number(value) || 0))

function compactDna(dna) {
  return {
    targetDurationSec: Math.round(clamp(dna?.targetDurationSec || 120, 45, 300)),
    references: (dna?.references || []).slice(0, 3).map((item) => ({ title: asText(item.title, 80), artist: asText(item.artist, 80) })),
    artist: dna?.artist ? {
      name: asText(dna.artist.name, 80),
      country: asText(dna.artist.country, 8),
      tags: (dna.artist.tags || []).slice(0, 8).map((item) => asText(item, 32)),
    } : null,
    rhythm: dna?.rhythm,
    harmony: dna?.harmony,
    melody: dna?.melody,
    structure: dna?.structure,
    audioFeatures: dna?.audioFeatures,
    stems: dna?.stems,
  }
}

const blueprintSchema = {
  type: 'object',
  properties: {
    title: { type: 'string' },
    bpm: { type: 'integer', minimum: 70, maximum: 190 },
    key: {
      type: 'object',
      properties: { tonic: { type: 'string' }, mode: { type: 'string', enum: ['major', 'minor'] } },
      required: ['tonic', 'mode'],
    },
    sections: {
      type: 'array',
      minItems: 3,
      maxItems: 9,
      items: {
        type: 'object',
        properties: {
          name: { type: 'string', enum: ['Intro', 'Verse', 'Pre', 'Chorus', 'Bridge', 'Break', 'Solo', 'Outro'] },
          bars: { type: 'integer', minimum: 4, maximum: 32 },
          energy: { type: 'number', minimum: 0.1, maximum: 1 },
        },
        required: ['name', 'bars', 'energy'],
      },
    },
    harmony: {
      type: 'object',
      properties: { degreePattern: { type: 'array', minItems: 3, maxItems: 8, items: { type: 'integer', minimum: 0, maximum: 6 } } },
      required: ['degreePattern'],
    },
    tracks: {
      type: 'object',
      properties: {
        drums: { type: 'object', properties: { preset: { type: 'string', enum: ['fourFloor', 'pop', 'halfTime', 'syncopated'] } }, required: ['preset'] },
        bass: { type: 'object', properties: { preset: { type: 'string', enum: ['halfNotes', 'eighthRoots', 'octave', 'syncopated'] }, octave: { type: 'integer', minimum: 1, maximum: 3 } }, required: ['preset', 'octave'] },
        melody: {
          type: 'object',
          properties: {
            rangeSemitones: { type: 'integer', minimum: 7, maximum: 24 },
            stepwiseRatio: { type: 'number', minimum: 0.2, maximum: 0.98 },
            repetitionRatio: { type: 'number', minimum: 0.05, maximum: 0.95 },
            notesPerBeat: { type: 'number', minimum: 0.25, maximum: 2 },
          },
          required: ['rangeSemitones', 'stepwiseRatio', 'repetitionRatio', 'notesPerBeat'],
        },
      },
      required: ['drums', 'bass', 'melody'],
    },
    rationale: { type: 'array', maxItems: 4, items: { type: 'string' } },
  },
  required: ['title', 'bpm', 'key', 'sections', 'harmony', 'tracks', 'rationale'],
}

async function searchArtist(request, response) {
  const url = new URL(request.url, 'https://makemusic.local')
  const query = asText(url.searchParams.get('q'), 100)
  if (!query) return json(response, 400, { error: 'q is required' })
  const mbUrl = new URL('https://musicbrainz.org/ws/2/artist')
  mbUrl.searchParams.set('query', `artist:${query}`)
  mbUrl.searchParams.set('fmt', 'json')
  mbUrl.searchParams.set('limit', '5')
  const upstream = await fetch(mbUrl, { headers: { Accept: 'application/json', 'User-Agent': APP_USER_AGENT } })
  if (!upstream.ok) return json(response, upstream.status, { error: `MusicBrainz ${upstream.status}` })
  const payload = await upstream.json()
  const artists = (payload.artists || []).map((artist) => ({
    id: artist.id,
    name: artist.name,
    disambiguation: artist.disambiguation || '',
    country: artist.country || artist.area?.['iso-3166-1-codes']?.[0] || '',
    type: artist.type || '',
    score: Number(artist.score) || 0,
    tags: (artist.tags || []).sort((a, b) => (b.count || 0) - (a.count || 0)).slice(0, 8).map((tag) => tag.name),
  }))
  return json(response, 200, { artists }, { 'Cache-Control': 's-maxage=86400, stale-while-revalidate=604800' })
}

async function planSong(request, response) {
  let body
  try {
    body = typeof request.body === 'string' ? JSON.parse(request.body) : request.body
  } catch {
    return json(response, 400, { error: 'Invalid JSON' })
  }
  if (!body?.dna || body.action !== 'plan') return json(response, 400, { error: 'dna is required' })
  if (!process.env.GEMINI_API_KEY) {
    return json(response, 200, { provider: 'local-fallback', blueprint: null, warning: 'GEMINI_API_KEYが未設定です' })
  }

  const prompt = [
    'You are a music arranger. Create a new song blueprint from aggregate statistical Music DNA.',
    'Do not copy any identifiable melody, lyric, recording, or long chord sequence from a reference song.',
    'Keep bars multiples of 4, use degree indexes 0-6, and optimize for an editable browser synthesizer.',
    `User intent: ${asText(body.intent, 240) || 'No extra instruction'}`,
    `Music DNA: ${JSON.stringify(compactDna(body.dna))}`,
  ].join('\n')
  const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(GEMINI_MODEL)}:generateContent`
  const upstream = await fetch(endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-goog-api-key': process.env.GEMINI_API_KEY },
    body: JSON.stringify({
      contents: [{ role: 'user', parts: [{ text: prompt }] }],
      generationConfig: { responseMimeType: 'application/json', responseJsonSchema: blueprintSchema, temperature: 0.78, maxOutputTokens: 1800 },
    }),
  })
  if (!upstream.ok) {
    const detail = await upstream.text()
    console.error('[MakeMusic Gemini]', upstream.status, detail.slice(0, 500))
    return json(response, 200, { provider: 'local-fallback', blueprint: null, warning: `Gemini ${upstream.status}` })
  }
  const payload = await upstream.json()
  const text = payload?.candidates?.[0]?.content?.parts?.map((part) => part.text || '').join('')
  if (!text) return json(response, 200, { provider: 'local-fallback', blueprint: null, warning: 'Geminiの応答が空でした' })
  try {
    return json(response, 200, { provider: 'gemini', blueprint: { ...JSON.parse(text), provider: 'gemini' } })
  } catch {
    return json(response, 200, { provider: 'local-fallback', blueprint: null, warning: 'Gemini JSONを解釈できませんでした' })
  }
}

export default async function handler(request, response) {
  try {
    if (request.method === 'GET') return searchArtist(request, response)
    if (request.method === 'POST') return planSong(request, response)
    response.setHeader('Allow', 'GET, POST')
    return json(response, 405, { error: 'Method not allowed' })
  } catch (error) {
    console.error('[MakeMusic API]', error)
    return json(response, 500, { error: 'Temporary service error' })
  }
}
