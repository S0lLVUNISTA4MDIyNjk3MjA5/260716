# 小型空調ユニット トレース照合サンプル

## 内容

- `customer_hvac_requirements.pdf`：顧客要求仕様書。第2章に要求4件を収録。
- `design_review_matrix.xlsx`：1行1設計項目の設計検討表。設計項目5件を収録。
- `JSON_A_customer_requirements_trace.json`：PDF要求を模擬した照合用JSON A。
- `JSON_B_design_review_trace.json`：Excel設計項目を模擬した照合用JSON B。
- `profile_pdf_customer_requirements.json`：仕様書PDF→JSON変換ツール用の様式プロファイル。既定の「標準（章・節様式）」に、本サンプル用のタグ辞書（`tag_policy.allowed_tags`）を追加登録済み。
- `profile_excel_design_review.json`：Excel→JSON変換ツール用の様式プロファイル。照合本文を4列（設計項目/標準機種情報/顧客対応・検討内容/検討結果）に絞り、キーワード自動タグ付けルール（`tag_policy.rules`）を設定済み。

`profile_*.json`の2件は、各ツールの「様式ファイル登録」からそのまま読み込める。両ツールでPDFとExcelをこの様式で変換・タグ付け・出力すると、`JSON_A_customer_requirements_trace.json`／`JSON_B_design_review_trace.json`と同一内容（`trace_text`・`tags`）を再現できることを確認済み（`tools/usage_guide.md`「事前準備」節、および本ディレクトリの`verification_report.md`を参照）。

## Excel変換時の設定

- 対象シート：`設計検討表`
- ヘッダー行：4
- データ開始行：5
- データ終了行：9
- 1行を1設計項目として扱う

照合本文へ含める推奨列：

1. 設計項目
2. 標準機種情報
3. 顧客対応・検討内容
4. 検討結果

## 期待する主な対応関係

| PDF要求 | Excel設計項目 | 共通タグ | 確認ポイント |
|---|---|---|---|
| 2.1 使用環境 | 使用温度範囲 | 使用温度 | 0 °C～50 °Cで運転可能か |
| 2.2 冷房性能 | 冷房能力 | 冷房能力、使用温度 | 50 °Cで12 kW以上か |
| 2.3 電源仕様 | 電源電圧・周波数 | 電源電圧、周波数 | 三相AC 220 V、50 Hzか |
| 2.4 騒音 | 運転騒音 | 騒音 | 正面1 mで60 dB(A)以下か |

Excelの「保守作業スペース」行は、PDF側に直接対応する要求がない設計側項目として収録している。

## 推奨操作順

1. 各変換ツールの「様式ファイル登録」で`profile_pdf_customer_requirements.json`／`profile_excel_design_review.json`を事前登録する（省略も可能。省略した場合、既定様式のままでも変換自体は成功するが、`trace_text`の構成列やタグが本サンプルのJSON A/Bとは異なるものになる）。
2. PDF変換ツールでPDFを読み込み、章・節・文章を確認する。
3. Excel変換ツールでExcelを読み込み、上記の範囲を指定する。
4. 付属JSON A/Bを照合ツールへ読み込む。またはPDF/Excelから自分で照合用JSONを出力し、A/Bを照合する。
5. 共通タグと照合本文による候補を確認する。
6. PDF原文とExcel行を比較し、人間が最終判断する。

## 注意

このデータは操作確認用であり、実製品の設計・安全判断には使用しないこと。
