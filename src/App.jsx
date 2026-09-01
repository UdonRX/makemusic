import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import * as Tone from 'tone'
import { Chord, Scale } from 'tonal'
import { aggregateMusicDna, analyzeSongleReference, searchSongleSongs } from './music/referenceAnalysis'

const KEYS = ['C', 'D', 'E', 'F', 'G', 'A', 'B']
const MAX_CHORDS = 8
const MELODY_LABELS = ['A', 'B', 'C']

const MAJOR_QUALITIES = ['', 'm', 'm', '', '', 'm', 'dim']
const MINOR_QUALITIES = ['m', 'dim', '', 'm', 'm', '', '']

const TRANSITIONS = {
  major: [
    [5, 3, 4, 1, 2],
    [4, 3, 6, 0],
    [5, 3, 1, 0],
    [4, 0, 1, 5],
    [0, 5, 3, 1],
    [3, 1, 4, 0],
    [0, 2, 4],
  ],
  minor: [
    [5, 3, 4, 2, 6],
    [4, 0, 2, 5],
    [5, 3, 6, 0],
    [4, 0, 5, 2],
    [0, 5, 6, 3],
    [2, 6, 3, 0],
    [0, 2, 5, 4],
  ],
}

const FIRST_CHOICES = {
  major: [0, 5, 3, 4, 1],
  minor: [0, 5, 3, 4, 6],
}

const clamp = (value, min, max) => Math.min(max, Math.max(min, value))
const normalizePc = (note) => note.replace(/-?\d+/g, '')
const displayChord = (chord) => chord.replace('dim', '°')

function formatDuration(seconds) {
  const total = Math.max(0, Math.round(Number(seconds) || 0))
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`
}

function getDiatonicChords(keyName, mode) {
  const scale = Scale.get(`${keyName} ${mode}`)
  const roots = scale.notes.slice(0, 7)
  const qualities = mode === 'major' ? MAJOR_QUALITIES : MINOR_QUALITIES
  return roots.map((root, index) => `${root}${qualities[index]}`)
}

function midiPoolForPitchClasses(pitchClasses, min = 60, max = 77) {
  const wanted = new Set(pitchClasses)
  const result = []
  for (let midi = min; midi <= max; midi += 1) {
    const pc = normalizePc(Tone.Frequency(midi, 'midi').toNote())
    if (wanted.has(pc)) result.push(midi)
  }
  return result
}

function nearestMidi(candidates, target, jitter = 0) {
  if (!candidates.length) return target
  const ranked = [...candidates].sort((a, b) => Math.abs(a - target) - Math.abs(b - target))
  const pickWindow = Math.min(ranked.length, Math.max(1, jitter + 1))
  return ranked[Math.floor(Math.random() * pickWindow)]
}

function generateMelody(keyName, mode, progression, profile = null) {
  const scalePcs = Scale.get(`${keyName} ${mode}`).notes
  const range = clamp(profile?.rangeSemitones || 17, 8, 21)
  const centerMidi = mode === 'minor' ? 67 : 69
  const minMidi = Math.round(centerMidi - range / 2)
  const maxMidi = Math.round(centerMidi + range / 2)
  const scaleMidi = midiPoolForPitchClasses(scalePcs, minMidi, maxMidi)
  if (!scaleMidi.length || !progression.length) return []

  const stepwiseRatio = clamp(profile?.stepwiseRatio ?? 0.7, 0.2, 0.98)
  const repetitionRatio = clamp(profile?.repetitionRatio ?? 0.45, 0.1, 0.9)
  const notesPerBeat = clamp(profile?.notesPerBeat ?? 1.4, 0.25, 2)
  const restChance = clamp(1 - notesPerBeat / 2, 0.04, 0.55)
  const movePool = stepwiseRatio > 0.68 ? [-1, 0, 1, 1] : [-2, -1, 1, 2]
  const motif = [
    0,
    movePool[Math.floor(Math.random() * movePool.length)],
    movePool[Math.floor(Math.random() * movePool.length)],
    Math.random() < repetitionRatio ? 0 : movePool[Math.floor(Math.random() * movePool.length)],
  ]

  const notes = []
  let previous = scaleMidi[Math.floor(scaleMidi.length * 0.45)]

  progression.forEach((chordName, barIndex) => {
    const chordPcs = Chord.get(chordName).notes
    const chordMidi = midiPoolForPitchClasses(chordPcs, minMidi, maxMidi)
    let anchorIndex = clamp(scaleMidi.indexOf(nearestMidi(scaleMidi, previous)), 0, scaleMidi.length - 1)

    for (let step = 0; step < 8; step += 1) {
      const strongBeat = step === 0 || step === 4
      if (!strongBeat && Math.random() < restChance) {
        notes.push(null)
        continue
      }

      let nextMidi
      if (strongBeat && chordMidi.length) {
        const target = previous + (Math.random() < 0.55 ? 0 : Math.random() < 0.5 ? 2 : -2)
        nextMidi = nearestMidi(chordMidi, target, 1)
        anchorIndex = clamp(scaleMidi.indexOf(nearestMidi(scaleMidi, nextMidi)), 0, scaleMidi.length - 1)
      } else {
        const motifStep = motif[step % 4]
        const vary = barIndex % 2 === 1 && Math.random() > repetitionRatio ? (Math.random() < 0.5 ? -1 : 1) : 0
        const targetIndex = clamp(anchorIndex + motifStep + vary, 0, scaleMidi.length - 1)
        nextMidi = scaleMidi[targetIndex]
      }

      if (Math.abs(nextMidi - previous) > 7) {
        nextMidi = nearestMidi(scaleMidi, previous + Math.sign(nextMidi - previous) * 4)
      }

      notes.push(Tone.Frequency(nextMidi, 'midi').toNote())
      previous = nextMidi
    }
  })

  return notes
}

function chordVoicing(chordName) {
  const pcs = Chord.get(chordName).notes
  let previousMidi = 47
  return pcs.slice(0, 4).map((pc) => {
    let midi = Tone.Frequency(`${pc}3`).toMidi()
    while (midi < 48) midi += 12
    while (midi <= previousMidi) midi += 12
    if (midi > 72) midi -= 12
    previousMidi = midi
    return Tone.Frequency(midi, 'midi').toNote()
  })
}

function progressionFromDna(dna, targetKey) {
  const chords = getDiatonicChords(targetKey, dna.harmony.mode)
  const degrees = dna.harmony.signatureDegrees.filter((degree) => degree >= 0 && degree < chords.length)
  const base = degrees.length >= 3 ? degrees : dna.harmony.mode === 'minor' ? [0, 5, 3, 4] : [0, 4, 5, 3]
  const expanded = [...base, ...base]
  return expanded.slice(0, MAX_CHORDS).map((degree) => chords[degree]).filter(Boolean)
}

function App() {
  const [workspace, setWorkspace] = useState('create')
  const [keyName, setKeyName] = useState('C')
  const [mode, setMode] = useState('major')
  const [bpm, setBpm] = useState(120)
  const [progression, setProgression] = useState([])
  const [melodies, setMelodies] = useState([[], [], []])
  const [selectedMelody, setSelectedMelody] = useState(0)
  const [isPlaying, setIsPlaying] = useState(false)
  const [audioReady, setAudioReady] = useState(false)
  const [activeDna, setActiveDna] = useState(null)

  const [referenceQuery, setReferenceQuery] = useState('')
  const [referenceResults, setReferenceResults] = useState([])
  const [selectedReferences, setSelectedReferences] = useState([])
  const [referenceLoading, setReferenceLoading] = useState(false)
  const [referenceStatus, setReferenceStatus] = useState('')
  const [referenceError, setReferenceError] = useState('')
  const [targetDurationSec, setTargetDurationSec] = useState(120)
  const [musicDna, setMusicDna] = useState(null)

  const instrumentsRef = useRef(null)

  const diatonicChords = useMemo(() => getDiatonicChords(keyName, mode), [keyName, mode])

  const candidates = useMemo(() => {
    if (progression.length >= MAX_CHORDS) return []
    const current = progression[progression.length - 1]
    const indexes = current
      ? TRANSITIONS[mode][Math.max(0, diatonicChords.indexOf(current))]
      : FIRST_CHOICES[mode]
    return indexes.map((index) => diatonicChords[index]).filter(Boolean)
  }, [diatonicChords, mode, progression])

  const initAudio = useCallback(async () => {
    await Tone.start()
    if (instrumentsRef.current) return

    const piano = new Tone.PolySynth(Tone.Synth, {
      oscillator: { type: 'triangle8' },
      envelope: { attack: 0.01, decay: 0.18, sustain: 0.24, release: 0.8 },
    }).toDestination()
    piano.volume.value = -13

    const bass = new Tone.MonoSynth({
      oscillator: { type: 'sine' },
      envelope: { attack: 0.01, decay: 0.15, sustain: 0.45, release: 0.25 },
      filterEnvelope: { attack: 0.01, decay: 0.2, sustain: 0.1, baseFrequency: 80, octaves: 2 },
    }).toDestination()
    bass.volume.value = -10

    const kick = new Tone.MembraneSynth({
      pitchDecay: 0.04,
      octaves: 6,
      oscillator: { type: 'sine' },
      envelope: { attack: 0.001, decay: 0.3, sustain: 0.01, release: 0.1 },
    }).toDestination()
    kick.volume.value = -8

    const snare = new Tone.NoiseSynth({
      noise: { type: 'white' },
      envelope: { attack: 0.001, decay: 0.11, sustain: 0 },
    }).toDestination()
    snare.volume.value = -19

    const hat = new Tone.NoiseSynth({
      noise: { type: 'pink' },
      envelope: { attack: 0.001, decay: 0.025, sustain: 0 },
    }).toDestination()
    hat.volume.value = -24

    const lead = new Tone.Synth({
      oscillator: { type: 'sine' },
      envelope: { attack: 0.01, decay: 0.08, sustain: 0.18, release: 0.12 },
    }).toDestination()
    lead.volume.value = -12

    instrumentsRef.current = { piano, bass, kick, snare, hat, lead }
    setAudioReady(true)
  }, [])

  const configureTransport = useCallback(() => {
    const instruments = instrumentsRef.current
    if (!instruments || !progression.length) return

    Tone.Transport.stop()
    Tone.Transport.cancel(0)
    Tone.Transport.position = '0:0:0'
    Tone.Transport.bpm.value = bpm
    Tone.Transport.loop = true
    Tone.Transport.loopStart = 0
    Tone.Transport.loopEnd = `${progression.length}m`

    const activeMelody = melodies[selectedMelody] || []

    progression.forEach((chordName, bar) => {
      const voicing = chordVoicing(chordName)
      const root = Chord.get(chordName).tonic || normalizePc(chordName)
      const bassNote = `${root}2`

      Tone.Transport.schedule((time) => instruments.piano.triggerAttackRelease(voicing, '2n', time, 0.62), `${bar}:0:0`)

      ;[0, 2].forEach((beat) => {
        Tone.Transport.schedule((time) => instruments.bass.triggerAttackRelease(bassNote, '8n', time, 0.8), `${bar}:${beat}:0`)
        Tone.Transport.schedule((time) => instruments.kick.triggerAttackRelease('C1', '8n', time, 0.9), `${bar}:${beat}:0`)
      })

      ;[1, 3].forEach((beat) => {
        Tone.Transport.schedule((time) => instruments.snare.triggerAttackRelease('16n', time, 0.5), `${bar}:${beat}:0`)
      })

      for (let eighth = 0; eighth < 8; eighth += 1) {
        const beat = Math.floor(eighth / 2)
        const sixteenth = eighth % 2 === 0 ? 0 : 2
        Tone.Transport.schedule((time) => instruments.hat.triggerAttackRelease('32n', time, 0.24), `${bar}:${beat}:${sixteenth}`)

        const melodyNote = activeMelody[bar * 8 + eighth]
        if (melodyNote) {
          Tone.Transport.schedule((time) => instruments.lead.triggerAttackRelease(melodyNote, '8n', time, 0.52), `${bar}:${beat}:${sixteenth}`)
        }
      }
    })

    Tone.Transport.start('+0.04')
  }, [bpm, melodies, progression, selectedMelody])

  useEffect(() => {
    Tone.Transport.bpm.rampTo(bpm, 0.05)
  }, [bpm])

  useEffect(() => {
    if (isPlaying && audioReady && progression.length) configureTransport()
  }, [audioReady, configureTransport, isPlaying, progression.length])

  useEffect(() => () => {
    Tone.Transport.stop()
    Tone.Transport.cancel(0)
    if (instrumentsRef.current) Object.values(instrumentsRef.current).forEach((instrument) => instrument.dispose())
  }, [])

  const stopPlayback = () => {
    Tone.Transport.stop()
    Tone.Transport.cancel(0)
    setIsPlaying(false)
  }

  const resetForHarmonyChange = (nextKey = keyName, nextMode = mode) => {
    if (nextKey === keyName && nextMode === mode) return
    setKeyName(nextKey)
    setMode(nextMode)
    setProgression([])
    setMelodies([[], [], []])
    setSelectedMelody(0)
    setActiveDna(null)
    if (isPlaying) stopPlayback()
  }

  const addChord = (chord) => {
    if (progression.length >= MAX_CHORDS) return
    setProgression((current) => [...current, chord])
    setMelodies([[], [], []])
  }

  const undoChord = () => {
    setProgression((current) => current.slice(0, -1))
    setMelodies([[], [], []])
  }

  const clearChords = () => {
    setProgression([])
    setMelodies([[], [], []])
    setSelectedMelody(0)
    setActiveDna(null)
    if (isPlaying) stopPlayback()
  }

  const generateAllMelodies = () => {
    if (!progression.length) return
    setMelodies(MELODY_LABELS.map(() => generateMelody(keyName, mode, progression, activeDna?.melody)))
    setSelectedMelody(0)
  }

  const togglePlayback = async () => {
    if (!progression.length) return
    if (isPlaying) {
      stopPlayback()
      return
    }
    await initAudio()
    setIsPlaying(true)
  }

  const addReference = (song) => {
    setSelectedReferences((current) => {
      if (current.some((item) => item.id === song.id || item.permalink === song.permalink) || current.length >= 3) return current
      return [...current, song]
    })
    setMusicDna(null)
    setReferenceError('')
  }

  const runReferenceSearch = async (event) => {
    event?.preventDefault()
    const query = referenceQuery.trim()
    if (!query) return
    setReferenceError('')
    setMusicDna(null)

    if (/^https?:\/\//i.test(query)) {
      addReference({
        id: query,
        title: 'URLから解析',
        artist: 'Songle登録曲',
        permalink: query,
        durationMs: 0,
        rmsAmplitude: 0,
      })
      setReferenceResults([])
      return
    }

    setReferenceLoading(true)
    setReferenceStatus('Songleで検索中…')
    try {
      const results = await searchSongleSongs(query)
      setReferenceResults(results)
      if (!results.length) setReferenceError('Songleで候補が見つからなかった。YouTube / ニコニコのURLを直接貼る方法も使える。')
    } catch (error) {
      setReferenceError(`検索できなかった: ${error.message}`)
    } finally {
      setReferenceLoading(false)
      setReferenceStatus('')
    }
  }

  const analyzeReferences = async () => {
    if (!selectedReferences.length) return
    setReferenceLoading(true)
    setReferenceError('')
    setMusicDna(null)

    try {
      const analyses = []
      for (let index = 0; index < selectedReferences.length; index += 1) {
        setReferenceStatus(`${index + 1} / ${selectedReferences.length} 曲を解析中…`)
        analyses.push(await analyzeSongleReference(selectedReferences[index]))
      }
      const dna = aggregateMusicDna(analyses, targetDurationSec)
      setMusicDna(dna)
      setReferenceStatus('解析完了')
    } catch (error) {
      setReferenceError(`${error.message}。Songleに解析済みの曲を選ぶか、別の参考曲を試してみて。`)
      setReferenceStatus('')
    } finally {
      setReferenceLoading(false)
    }
  }

  const applyMusicDna = () => {
    if (!musicDna) return
    const targetKey = KEYS.includes(musicDna.harmony.tonic) ? musicDna.harmony.tonic : keyName
    const nextMode = musicDna.harmony.mode
    const nextProgression = progressionFromDna(musicDna, targetKey)
    if (!nextProgression.length) return

    if (isPlaying) stopPlayback()
    setKeyName(targetKey)
    setMode(nextMode)
    setBpm(musicDna.rhythm.bpm)
    setProgression(nextProgression)
    setActiveDna(musicDna)
    setMelodies(MELODY_LABELS.map(() => generateMelody(targetKey, nextMode, nextProgression, musicDna.melody)))
    setSelectedMelody(0)
    setWorkspace('create')
  }

  return (
    <main className="app-shell">
      <header className="topbar">
        <div>
          <p className="eyebrow">MAKE MUSIC</p>
          <h1>{workspace === 'create' ? 'コードを選んで、すぐ鳴らす。' : '実際の曲から、作り方を借りる。'}</h1>
        </div>
        <div className={`status-dot ${isPlaying ? 'is-live' : ''}`} aria-label={isPlaying ? '再生中' : '停止中'} />
      </header>

      <nav className="workspace-tabs" aria-label="作曲モード">
        <button className={workspace === 'create' ? 'active' : ''} onClick={() => setWorkspace('create')}>つくる</button>
        <button className={workspace === 'reference' ? 'active' : ''} onClick={() => setWorkspace('reference')}>参考曲解析</button>
      </nav>

      {workspace === 'reference' ? (
        <>
          <section className="panel reference-intro">
            <div className="section-head">
              <span>REFERENCE ANALYSIS</span>
              <strong>完全無料モード</strong>
            </div>
            <p className="reference-lead">アーティスト名や曲名で探して、最大3曲の「コード・テンポ・メロディ・構成」の共通点をMusic DNAにする。</p>
            <form className="reference-search" onSubmit={runReferenceSearch}>
              <input
                type="search"
                value={referenceQuery}
                onChange={(event) => setReferenceQuery(event.target.value)}
                placeholder="例：サカナクション / 新宝島 / YouTube URL"
                aria-label="参考曲を検索"
              />
              <button disabled={referenceLoading || !referenceQuery.trim()}>探す</button>
            </form>
            <p className="microcopy">Songleの公開解析結果をブラウザから直接取得。音源ファイルをVercelへ送らず、Vercel Functionも使わない。</p>
          </section>

          {referenceResults.length > 0 && (
            <section className="panel">
              <div className="section-head"><span>SEARCH RESULTS</span><span>最大3曲</span></div>
              <div className="reference-results">
                {referenceResults.map((song) => {
                  const selected = selectedReferences.some((item) => item.id === song.id || item.permalink === song.permalink)
                  return (
                    <button key={song.id} className={`reference-result ${selected ? 'selected' : ''}`} onClick={() => addReference(song)} disabled={!selected && selectedReferences.length >= 3}>
                      <span className="reference-result-copy">
                        <strong>{song.title}</strong>
                        <small>{song.artist} · {formatDuration(song.durationMs / 1000)}</small>
                      </span>
                      <b>{selected ? '✓' : '+'}</b>
                    </button>
                  )
                })}
              </div>
            </section>
          )}

          <section className="panel">
            <div className="section-head"><span>SELECTED</span><span>{selectedReferences.length} / 3</span></div>
            {selectedReferences.length ? (
              <div className="selected-references">
                {selectedReferences.map((song, index) => (
                  <div className="selected-reference" key={song.id}>
                    <span className="reference-number">{index + 1}</span>
                    <div><strong>{song.title}</strong><small>{song.artist}</small></div>
                    <button aria-label={`${song.title}を外す`} onClick={() => {
                      setSelectedReferences((current) => current.filter((item) => item.id !== song.id))
                      setMusicDna(null)
                    }}>×</button>
                  </div>
                ))}
              </div>
            ) : <div className="reference-empty">上の検索から参考曲を1〜3曲選ぶ</div>}

            <div className="target-length">
              <div><span>作りたい長さ</span><strong>{formatDuration(targetDurationSec)}</strong></div>
              <input type="range" min="60" max="240" step="15" value={targetDurationSec} onChange={(event) => {
                setTargetDurationSec(Number(event.target.value))
                setMusicDna(null)
              }} />
            </div>

            <button className="analyze-button" onClick={analyzeReferences} disabled={referenceLoading || !selectedReferences.length}>
              {referenceLoading ? referenceStatus || '解析中…' : '✦ 参考曲を解析する'}
            </button>
            {referenceStatus && !referenceLoading && <p className="success-text">{referenceStatus}</p>}
            {referenceError && <p className="error-text">{referenceError}</p>}
          </section>

          {musicDna && (
            <>
              <section className="panel dna-panel">
                <div className="section-head"><span>MUSIC DNA</span><strong>{musicDna.references.length}曲から抽出</strong></div>
                <div className="dna-grid">
                  <div><small>BPM</small><strong>{musicDna.rhythm.bpm}</strong></div>
                  <div><small>KEY傾向</small><strong>{musicDna.harmony.tonic} {musicDna.harmony.mode}</strong></div>
                  <div><small>音域</small><strong>{musicDna.melody.rangeSemitones} 半音</strong></div>
                  <div><small>順次進行</small><strong>{Math.round(musicDna.melody.stepwiseRatio * 100)}%</strong></div>
                  <div><small>モチーフ反復</small><strong>{Math.round(musicDna.melody.repetitionRatio * 100)}%</strong></div>
                  <div><small>コード密度</small><strong>{musicDna.rhythm.chordChangesPerMinute}/分</strong></div>
                </div>
                <div className="degree-row">
                  <small>特徴的なコード度数</small>
                  <div>{musicDna.harmony.signatureDegrees.map((degree, index) => <span key={`${degree}-${index}`}>{degree + 1}</span>)}</div>
                </div>
              </section>

              <section className="panel blueprint-panel">
                <div className="section-head"><span>SONG BLUEPRINT</span><strong>{formatDuration(musicDna.targetDurationSec)}</strong></div>
                <div className="section-track">
                  {musicDna.structure.sections.map((section, index) => (
                    <div key={`${section.name}-${index}`} className="section-block" style={{ flexGrow: section.bars }}>
                      <strong>{section.name}</strong><small>{section.bars} bars</small>
                    </div>
                  ))}
                </div>
                <p className="microcopy">今は無料のルールベース設計図。将来ここをAI Plannerへ差し替え、Demucs / Basic Pitch / Essentiaの楽器・リズム解析も同じMusic DNAへ追加する。</p>
                <button className="apply-dna-button" onClick={applyMusicDna}>この特徴で曲を作る →</button>
              </section>

              <section className="panel pipeline-panel">
                <div className="section-head"><span>3 LAYER PIPELINE</span><span>将来拡張</span></div>
                <div className="pipeline-steps">
                  <div><b>1</b><span><strong>アーティスト情報</strong><small>Songle · 稼働中</small></span></div>
                  <i>→</i>
                  <div><b>2</b><span><strong>曲の設計図</strong><small>Local Rules → AI</small></span></div>
                  <i>→</i>
                  <div><b>3</b><span><strong>編集可能トラック</strong><small>Tone.js · 稼働中</small></span></div>
                </div>
                <p className="microcopy">Demucs＝楽器分離、Basic Pitch＝音符化、Essentia＝音響特徴。無料で実行できる方法が確認できたものから順に接続する。</p>
              </section>
            </>
          )}
        </>
      ) : (
        <>
          {activeDna && (
            <section className="reference-active-banner">
              <span>REFERENCE DNA</span>
              <strong>{activeDna.references.map((item) => item.artist).filter((value, index, array) => array.indexOf(value) === index).join(' / ')}</strong>
              <button onClick={() => setWorkspace('reference')}>解析を見る</button>
            </section>
          )}

          <section className="panel setup-panel">
            <div className="section-head"><span>KEY</span><strong>{keyName} {mode}</strong></div>
            <div className="key-grid">
              {KEYS.map((key) => (
                <button className={`small-key ${keyName === key ? 'active' : ''}`} key={key} onClick={() => resetForHarmonyChange(key, mode)}>{key}</button>
              ))}
            </div>
            <div className="mode-switch" role="group" aria-label="major minor">
              {['major', 'minor'].map((item) => (
                <button key={item} className={mode === item ? 'active' : ''} onClick={() => resetForHarmonyChange(keyName, item)}>{item}</button>
              ))}
            </div>
            <div className="bpm-row">
              <div><span className="label">BPM</span><strong>{bpm}</strong></div>
              <input aria-label="BPM" type="range" min="80" max="180" step="1" value={bpm} onChange={(event) => setBpm(Number(event.target.value))} />
            </div>
          </section>

          <section className="panel">
            <div className="section-head"><span>CHORDS</span><span>{progression.length} / {MAX_CHORDS}</span></div>
            <div className={`progression ${progression.length ? '' : 'empty'}`}>
              {progression.length ? progression.map((chord, index) => (
                <div className="progression-chip" key={`${chord}-${index}`}><small>{index + 1}</small><strong>{displayChord(chord)}</strong></div>
              )) : <p>下の候補から最初のコードを選ぶ</p>}
            </div>
            <div className="utility-row">
              <button className="ghost-button" onClick={undoChord} disabled={!progression.length}>1つ戻す</button>
              <button className="ghost-button danger" onClick={clearChords} disabled={!progression.length}>全部消す</button>
            </div>
          </section>

          <section className="panel candidate-panel">
            <div className="section-head"><span>{progression.length ? 'NEXT CHORD' : 'FIRST CHORD'}</span><span>{progression.length >= MAX_CHORDS ? '完成！' : '自然につながる候補'}</span></div>
            <div className="candidate-grid">
              {candidates.length ? candidates.map((chord) => (
                <button className="chord-button" key={chord} onClick={() => addChord(chord)}>{displayChord(chord)}</button>
              )) : <div className="max-message">8コードできた。まず鳴らしてみよう。</div>}
            </div>
          </section>

          <section className="panel transport-panel">
            <div className="section-head"><span>PLAY</span><span>{melodies[selectedMelody]?.length ? `Melody ${MELODY_LABELS[selectedMelody]}` : '伴奏のみでもOK'}</span></div>
            <button className={`play-button ${isPlaying ? 'playing' : ''}`} onClick={togglePlayback} disabled={!progression.length}>
              <span className="play-icon">{isPlaying ? '■' : '▶'}</span>{isPlaying ? '停止' : '伴奏を再生'}
            </button>
            <p className="microcopy">Piano + Bass + Drum。コード追加やBPM変更も再生に反映。</p>
          </section>

          <section className="panel melody-panel">
            <div className="section-head"><span>MELODY</span><span>{activeDna ? '参考曲DNAを反映' : '毎回ちがう3案'}</span></div>
            <button className="generate-button" onClick={generateAllMelodies} disabled={!progression.length}>✦ メロディ A / B / C を生成</button>
            <div className="melody-tabs">
              {MELODY_LABELS.map((label, index) => {
                const ready = melodies[index]?.length > 0
                return (
                  <button key={label} className={selectedMelody === index && ready ? 'active' : ''} disabled={!ready} onClick={() => setSelectedMelody(index)}>
                    <span>{label}</span><small>{ready ? '聴く' : '未生成'}</small>
                  </button>
                )
              })}
            </div>
            <p className="microcopy">{activeDna ? '参考曲の音域・順次進行率・モチーフ反復・音数密度をメロディ生成へ反映。' : '強拍はコード構成音を優先し、近い音域で短いモチーフを繰り返す。'}</p>
          </section>
        </>
      )}

      <footer>v0.2 · static only · Vercel Functions 0 · Tone.js + Tonal.js + Songle</footer>
    </main>
  )
}

export default App
