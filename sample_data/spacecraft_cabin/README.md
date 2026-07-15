# 宇宙船キャビン設計 サンプルデータ

要求仕様書、部品購入仕様書、設計検討項目一覧の対応確認に使用するサンプル帳票です。説明用の機械的なID列は設けず、通常の設計業務で使う文書番号、章節名、対象部位を用いています。

## 仕様書JSON変換ツールへの入力

- `cabin_system_customer_requirements.pdf`: キャビン全体の顧客要求
- `cabin_pressure_control_valve_purchase_specification.pdf`: 圧力制御弁アセンブリの購買仕様
- `cabin_thermal_humidity_control_unit_purchase_specification.pdf`: 温湿度調整ユニットの購買仕様
- `crew_energy_absorbing_seat_purchase_specification.pdf`: 座席モジュールの購買仕様

各PDFには温度条件と圧力条件を含みます。上位要求と購入仕様では表現や粒度を少し変えており、意味照合の確認に使用できます。

## Excel JSON変換ツールへの入力

- `cabin_design_review_items.xlsx`
- 対象シート: `設計検討項目`
- ヘッダー行: 3
- データ開始行: 4
- 変換範囲: `A3:K27`

## JSON A/Bトレース照合ツールでの使い方

1. `cabin_system_customer_requirements.pdf`を仕様書JSON変換ツールへ読み込み、上流側JSONを出力します。
2. `cabin_design_review_items.xlsx`をExcel JSON変換ツールへ読み込み、設計側JSONを出力します。
3. 上記2件をA/B照合し、顧客要求と設計検討項目の対応を確認します。
4. 各購入仕様書も仕様書JSONへ変換し、設計側JSONと購入仕様書JSONを照合します。

帳票内の参照表記は照合の補助になりますが、同一の専用IDを埋め込んではいません。温度・圧力・耐圧・気密・熱負荷などの技術語と数値条件による候補生成を確認できます。
