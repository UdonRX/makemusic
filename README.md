# Make Music

コード進行を選びながら、伴奏と自動生成メロディをすぐ試聴できるiPhone向け作曲プロトタイプです。

## v0.2 Reference Analysis

- 「つくる / 参考曲解析」の2モード
- Songle公開APIから参考曲を検索（アーティスト名・曲名）
- YouTube / ニコニコ等のURLを直接指定可能
- 最大3曲の解析結果をMusic DNAとして統合
- 取得する特徴: BPM、推定Key/Mode、コード度数パターン、コード密度、メロディ音域、順次進行率、モチーフ反復、サビ位置
- 作りたい長さ（1:00〜4:00）から曲構成Blueprintを作成
- 「この特徴で曲を作る」で既存のコード・メロディ生成へ反映
- 解析済みデータはSafari localStorageへ7日キャッシュ

## Existing Composer

- C〜B / major・minor のキー選択
- BPM 80〜180
- Tonal.jsによるダイアトニックコード候補
- 最大8コードの進行作成
- Tone.jsによる Piano / Bass / Drum 伴奏ループ
- メロディ A / B / C 自動生成
- 参考曲Music DNA適用時は音域・順次進行率・反復率・音数密度をメロディ生成へ反映
- iPhone Safari優先UI

## Free / Vercel Hobby policy

このバージョンはViteの静的フロントエンドのみです。

- Vercel Functions: **0**
- Vercel API Routes: **0**
- バックエンド: **なし**
- APIキー: **なし**
- Songleへの通信: **ユーザーのブラウザから直接**
- 音源アップロード: **Vercelへ送信しない**

そのため重い音声解析や外部API呼び出しでVercel Function枠を消費しません。通常の静的配信帯域・ビルド枠以外のHobbyリソースは使わない設計です。

## Planned 3-layer architecture

1. **アーティスト情報を探す層** — 現在: Songle。将来は無料で使えるメタデータ源を追加。
2. **曲の設計図を作る層** — 現在: Music DNA + ローカルルール。将来: 無料AI枠が持続可能な場合のみAI Plannerを追加。
3. **編集可能なトラックへ変換する層** — 現在: Tone.js + Tonal.js。将来: Demucs + Basic Pitch + Essentiaを無料実行可能な構成で接続。

Demucs / Basic Pitch / Essentiaは、Vercel上の重い処理としては実行しません。ブラウザ実行または完全無料の外部計算環境を検証してから追加します。

## Development

```bash
npm install
npm run dev
npm run build
```

## External service note

Songle Widget / APIは産総研の研究実証サービスです。個人試作では無料で利用できますが、将来営利サービスとして公開する場合はSongleの最新利用規約を確認し、必要に応じて運営元へ相談してください。
