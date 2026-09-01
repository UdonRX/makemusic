---
title: MakeMusic Audio DNA
emoji: 🎧
colorFrom: purple
colorTo: green
sdk: gradio
sdk_version: 6.26.0
python_version: 3.10
app_file: app.py
pinned: false
license: apache-2.0
suggested_hardware: zero-a10g
short_description: 30秒の所有音源から編集用Music DNAだけを返す
---

# MakeMusic Audio DNA worker

MakeMusicの公開ZeroGPUワーカーです。アップロードされた30秒以下のWAVを一時ディレクトリだけで処理し、Demucsで`drums / bass / vocals / other`へ分離、Basic Pitchで音符傾向を抽出してMusic DNA JSONを返します。

- 音源や分離stemは保存しません。
- 処理終了時に一時ディレクトリを削除します。
- 出力は集約統計と最大64件/パートの短いnote eventだけです。
- 権利を持つ音源、または解析許可を得た音源だけを投入してください。

ZeroGPUは共有無料枠なので、混雑・日次上限・cold startで失敗することがあります。その場合もMakeMusic側はEssentia.jsとSongleの解析結果で継続します。

