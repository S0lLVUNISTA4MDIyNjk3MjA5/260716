# Tools

Standalone single-file HTML tools for requirements ⇔ design traceability work.

- `spec_to_json_conversion_tool_v1.17.html`: 仕様書JSON変換・確認ツール v1.17（取扱説明書準拠UI版）。PDF仕様書から照合用JSONを作成し、様式登録・版間比較・タグ付けを行う。v1.16で確認状態の色分け表示、v1.17で確認済み／照合用JSONの再読込時に確認状態・タグを継承（複数人作業・一時保存用）。
- `excel_to_json_conversion_tool_v2.0.3.html`: Excel → JSON変換・確認ツール v2.0.3。Excelの設計検証項目一覧をJSONに変換し、様式定義・タグ辞書に基づき検証する。v2.0.2で確認状態の色分け表示、v2.0.3で確認済み／照合用JSONの再読込時に確認状態・タグ・照合キーを継承（複数人作業・一時保存用）。
- `json_ab_trace_matching_tool_v12.1.3.html`: JSON A/Bトレース照合ツール v12.1.3。上記2ツールで生成したJSON（要求側A／設計側B）を照合し、ナレッジグラフ・トレースマトリクスを生成する。
