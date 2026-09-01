# Make Music

iPhone Safari向けの、参考曲解析 → 曲設計 → 編集・再生までをつなぐ作曲プロトタイプです。

## v0.3 — 3-layer reference pipeline

### 1. アーティスト情報を探す層

- MusicBrainz: アーティスト候補、国、種別、タグ
- Songle: Beat、コード、メロディ、サビ・繰り返し構造
- ユーザー所有音源: 12MB・10分以内のMP3 / M4A / WAV等から中央30秒だけを端末内で整形
- Spotify / YouTube等から音源を抽出する処理はありません

### 2. 曲の設計図を作る層

- Music DNA v2: BPM、Key/Mode、コード度数、メロディ傾向、構成、音響特徴、stem統計
- Gemini API無料枠: Music DNA JSONとユーザー指示だけからSong Blueprint v1を生成
- APIキー未設定、無料枠終了、通信失敗時は同じschemaのローカル設計図へ自動フォールバック
- 端末ごとのGemini呼び出しは1日8回に制限

### 3. 編集可能トラックへ変換する層

- Chord: 8小節を個別に変更
- Drum: Kick / Snare / Hatを16ステップ編集
- Bass: 4パターンとオクターブを編集
- Melody: A / B / C生成後、各小節8ステップを上下・休符編集
- Tone.js / Tonal.jsで変更を即時再生へ反映
- iPhone消音モード用HTMLMediaElement + Web Audio解除と端末内診断ログを維持

## Architecture

```text
iPhone Safari
  ├─ Vercel static: React / Tone.js / Tonal.js
  ├─ browser WASM: Essentia.js（解析操作時だけlazy load）
  ├─ Songle: browser direct
  ├─ Vercel Function 1本: MusicBrainz proxy + Gemini planner
  └─ Hugging Face public ZeroGPU Space
       ├─ Demucs htdemucs
       └─ Spotify Basic Pitch
```

Vercelへ音源をアップロードしません。音源はブラウザからHugging Face Spaceへ直接送られ、Space内の一時ディレクトリで処理後に削除されます。Make Musicへ戻るのは集約済みMusic DNA JSONだけです。

## Vercel Hobby protection

- Vercel Functions: **1** (`api/music.mjs`)
- Function最大実行時間: **10秒**
- 音源処理、Demucs、Basic Pitch、Essentia.js: **Vercel Functionで実行しない**
- MusicBrainz結果: CDN 1日キャッシュ + Safari 7日キャッシュ
- Gemini: ユーザー操作時のみ、端末ごとに1日8回まで
- Geminiへ音源・stem・大量note eventは送らず、圧縮したMusic DNAだけを送信
- ZeroGPU失敗はVercelへ再試行せず、ブラウザ内解析へフォールバック

Hobbyには静的転送量やFunction利用量の上限があるため、無制限の第三者アクセスまで含む「絶対に上限へ到達しない」保証はできません。ただし通常の個人試作で重い処理がVercel消費へ加算されない設計です。Hobbyではオンデマンド超過課金を使わず、上限時は機能制限になります。

## Environment variables

VercelのServer側だけに設定します。`VITE_`へ秘密情報を入れないでください。

```bash
GEMINI_API_KEY=...
GEMINI_MODEL=gemini-2.5-flash-lite
```

公開ZeroGPU Space IDは秘密ではないため、Vercel build variableまたはアプリの接続欄へ設定できます。

```bash
VITE_HF_SPACE_ID=owner/makemusic-audio-dna
```

## Hugging Face Space

`hf-space/`を新しいPublic Gradio Spaceへそのまま配置し、HardwareでZeroGPUを選択します。

- Python 3.10
- Demucs 4.1.0 / htdemucs
- Basic Pitch 0.4.0
- 30秒以下、6MB以下のmono WAVのみ
- 同時実行1、GPU処理最大120秒
- 一時ファイルは関数終了時に削除

ZeroGPUは共有無料枠のため、account eligibility、日次GPU時間、混雑、cold startに左右されます。接続できない場合もSongle + Essentia.js + ローカル設計図で作曲を続けられます。

## Development

```bash
npm install
npm run dev
npm run build
```

## Licensing notes

- Essentia.js: AGPL-3.0
- Demucs code: MIT（モデル・学習データの条件は用途ごとに要確認）
- Basic Pitch: Apache-2.0
- Songle: 研究実証サービス。営利利用へ進む前に最新規約を確認し、必要に応じて運営元へ相談

このリポジトリは公開プロトタイプを前提にしています。ユーザーは権利を持つ音源、または解析許可を得た音源だけをアップロードしてください。
