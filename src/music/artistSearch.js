const CACHE_PREFIX = 'makemusic:artist:v1:'
const CACHE_TTL = 7 * 24 * 60 * 60 * 1000

function readCache(query) {
  try {
    const item = JSON.parse(localStorage.getItem(`${CACHE_PREFIX}${query.toLowerCase()}`))
    return item?.savedAt && Date.now() - item.savedAt < CACHE_TTL ? item.results : null
  } catch {
    return null
  }
}

function writeCache(query, results) {
  try {
    localStorage.setItem(`${CACHE_PREFIX}${query.toLowerCase()}`, JSON.stringify({ savedAt: Date.now(), results }))
  } catch {
    // Cache is optional on Safari private browsing.
  }
}

export async function searchMusicBrainzArtists(query) {
  const q = String(query || '').trim()
  if (!q || /^https?:\/\//i.test(q)) return []
  const cached = readCache(q)
  if (cached) return cached

  const response = await fetch(`/api/music?action=artist&q=${encodeURIComponent(q)}`, {
    headers: { Accept: 'application/json' },
  })
  if (!response.ok) throw new Error(`MusicBrainz API ${response.status}`)
  const payload = await response.json()
  const results = (payload.artists || []).slice(0, 5)
  writeCache(q, results)
  return results
}

