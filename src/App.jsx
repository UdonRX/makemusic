import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import * as Tone from 'tone'
import { Chord, Scale } from 'tonal'

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

function generateMelody(keyName, mode, progression) {
  const scalePcs = Scale.get(`${keyName} ${mode}`).notes
  const scaleMidi = midiPoolForPitchClasses(scalePcs)
  if (!scaleMidi.length || !progression.length) return []

  const motif = [0, [-1, 1][Math.floor(Math.random() * 2)], [-2, -1, 1, 2][Math.floor(Math.random() * 4)], 0]
  const notes = []
  let previous = scaleMidi[Math.floor(scaleMidi.length * 0.45)]

  progression.forEach((chordName, barIndex) => {
    const chordPcs = Chord.get(chordName).notes
    const chordMidi = midiPoolForPitchClasses(chordPcs)
    let anchorIndex = clamp(scaleMidi.indexOf(nearestMidi(scaleMidi, previous)), 0, scaleMidi.length - 1)

    for (let step = 0; step < 8; step += 1) {
      const strongBeat = step === 0 || step === 4
      let nextMidi

      if (strongBeat && chordMidi.length) {
        const target = previous + (Math.random() < 0.5 ? 0 : Math.random() < 0.5 ? 2 : -2)
        nextMidi = nearestMidi(chordMidi, target, 1)
        anchorIndex = clamp(scaleMidi.indexOf(nearestMidi(scaleMidi, nextMidi)), 0, scaleMidi.length - 1)
      } else {
        const motifStep = motif[step % 4]
        const variation = barIndex % 2 === 1 && step === 7 && Math.random() < 0.7 ? (Math.random() < 0.5 ? -1 : 1) : 0
        const targetIndex = clamp(anchorIndex + motifStep + variation, 0, scaleMidi.length - 1)
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
  return pcs.slice(0, 4).map((pc, index) => {
    let midi = Tone.Frequency(`${pc}${index === 0 ? 3 : 3}`).toMidi()
    while (midi < 48) midi += 12
    while (midi <= previousMidi) midi += 12
    if (midi > 72) midi -= 12
    previousMidi = midi
    return Tone.Frequency(midi, 'midi').toNote()
  })
}

function App() {
  const [keyName, setKeyName] = useState('C')
  const [mode, setMode] = useState('major')
  const [bpm, setBpm] = useState(120)
  const [progression, setProgression] = useState([])
  const [melodies, setMelodies] = useState([[], [], []])
  const [selectedMelody, setSelectedMelody] = useState(0)
  const [isPlaying, setIsPlaying] = useState(false)
  const [audioReady, setAudioReady] = useState(false)

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

      Tone.Transport.schedule((time) => {
        instruments.piano.triggerAttackRelease(voicing, '2n', time, 0.62)
      }, `${bar}:0:0`)

      ;[0, 2].forEach((beat) => {
        Tone.Transport.schedule((time) => {
          instruments.bass.triggerAttackRelease(bassNote, '8n', time, 0.8)
        }, `${bar}:${beat}:0`)
      })

      ;[0, 2].forEach((beat) => {
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
    if (instrumentsRef.current) {
      Object.values(instrumentsRef.current).forEach((instrument) => instrument.dispose())
    }
  }, [])

  const resetForHarmonyChange = (nextKey = keyName, nextMode = mode) => {
    if (nextKey === keyName && nextMode === mode) return
    setKeyName(nextKey)
    setMode(nextMode)
    setProgression([])
    setMelodies([[], [], []])
    setSelectedMelody(0)
    if (isPlaying) {
      Tone.Transport.stop()
      Tone.Transport.cancel(0)
      setIsPlaying(false)
    }
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
    if (isPlaying) {
      Tone.Transport.stop()
      Tone.Transport.cancel(0)
      setIsPlaying(false)
    }
  }

  const generateAllMelodies = () => {
    if (!progression.length) return
    setMelodies(MELODY_LABELS.map(() => generateMelody(keyName, mode, progression)))
    setSelectedMelody(0)
  }

  const togglePlayback = async () => {
    if (!progression.length) return
    if (isPlaying) {
      Tone.Transport.stop()
      Tone.Transport.cancel(0)
      setIsPlaying(false)
      return
    }

    await initAudio()
    setIsPlaying(true)
  }

  return (
    <main className="app-shell">
      <header className="topbar">
        <div>
          <p className="eyebrow">MAKE MUSIC</p>
          <h1>コードを選んで、すぐ鳴らす。</h1>
        </div>
        <div className={`status-dot ${isPlaying ? 'is-live' : ''}`} aria-label={isPlaying ? '再生中' : '停止中'} />
      </header>

      <section className="panel setup-panel">
        <div className="section-head">
          <span>KEY</span>
          <strong>{keyName} {mode}</strong>
        </div>
        <div className="key-grid">
          {KEYS.map((key) => (
            <button
              className={`small-key ${keyName === key ? 'active' : ''}`}
              key={key}
              onClick={() => resetForHarmonyChange(key, mode)}
            >
              {key}
            </button>
          ))}
        </div>
        <div className="mode-switch" role="group" aria-label="major minor">
          {['major', 'minor'].map((item) => (
            <button key={item} className={mode === item ? 'active' : ''} onClick={() => resetForHarmonyChange(keyName, item)}>
              {item}
            </button>
          ))}
        </div>

        <div className="bpm-row">
          <div>
            <span className="label">BPM</span>
            <strong>{bpm}</strong>
          </div>
          <input
            aria-label="BPM"
            type="range"
            min="80"
            max="180"
            step="1"
            value={bpm}
            onChange={(event) => setBpm(Number(event.target.value))}
          />
        </div>
      </section>

      <section className="panel">
        <div className="section-head">
          <span>CHORDS</span>
          <span>{progression.length} / {MAX_CHORDS}</span>
        </div>
        <div className={`progression ${progression.length ? '' : 'empty'}`}>
          {progression.length ? progression.map((chord, index) => (
            <div className="progression-chip" key={`${chord}-${index}`}>
              <small>{index + 1}</small>
              <strong>{displayChord(chord)}</strong>
            </div>
          )) : <p>下の候補から最初のコードを選ぶ</p>}
        </div>
        <div className="utility-row">
          <button className="ghost-button" onClick={undoChord} disabled={!progression.length}>1つ戻す</button>
          <button className="ghost-button danger" onClick={clearChords} disabled={!progression.length}>全部消す</button>
        </div>
      </section>

      <section className="panel candidate-panel">
        <div className="section-head">
          <span>{progression.length ? 'NEXT CHORD' : 'FIRST CHORD'}</span>
          <span>{progression.length >= MAX_CHORDS ? '完成！' : '自然につながる候補'}</span>
        </div>
        <div className="candidate-grid">
          {candidates.length ? candidates.map((chord) => (
            <button className="chord-button" key={chord} onClick={() => addChord(chord)}>
              {displayChord(chord)}
            </button>
          )) : <div className="max-message">8コードできた。まず鳴らしてみよう。</div>}
        </div>
      </section>

      <section className="panel transport-panel">
        <div className="section-head">
          <span>PLAY</span>
          <span>{melodies[selectedMelody]?.length ? `Melody ${MELODY_LABELS[selectedMelody]}` : '伴奏のみでもOK'}</span>
        </div>
        <button className={`play-button ${isPlaying ? 'playing' : ''}`} onClick={togglePlayback} disabled={!progression.length}>
          <span className="play-icon">{isPlaying ? '■' : '▶'}</span>
          {isPlaying ? '停止' : '伴奏を再生'}
        </button>
        <p className="microcopy">Piano + Bass + Drum。コード追加やBPM変更も再生に反映。</p>
      </section>

      <section className="panel melody-panel">
        <div className="section-head">
          <span>MELODY</span>
          <span>毎回ちがう3案</span>
        </div>
        <button className="generate-button" onClick={generateAllMelodies} disabled={!progression.length}>
          ✦ メロディ A / B / C を生成
        </button>
        <div className="melody-tabs">
          {MELODY_LABELS.map((label, index) => {
            const ready = melodies[index]?.length > 0
            return (
              <button
                key={label}
                className={selectedMelody === index && ready ? 'active' : ''}
                disabled={!ready}
                onClick={() => setSelectedMelody(index)}
              >
                <span>{label}</span>
                <small>{ready ? '聴く' : '未生成'}</small>
              </button>
            )
          })}
        </div>
        <p className="microcopy">強拍はコード構成音を優先し、近い音域で短いモチーフを繰り返す。</p>
      </section>

      <footer>最小試作 v0.1 · Tone.js + Tonal.js</footer>
    </main>
  )
}

export default App
