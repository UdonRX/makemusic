# Make Music

コード進行を選びながら、伴奏と自動生成メロディをすぐ試聴できるiPhone向け最小プロトタイプです。

## MVP

- C〜B / major・minor のキー選択
- BPM 80〜180
- Tonal.jsによるダイアトニックコード候補
- 最大8コードの進行作成
- Tone.jsによる Piano / Bass / Drum 伴奏ループ
- ルールベースのメロディ A / B / C 自動生成
- iPhone Safari優先の1カラムUI

## Development

```bash
npm install
npm run dev
npm run build
```

バックエンド・APIキーは不要です。Vercelでは静的Viteアプリとして動作します。
