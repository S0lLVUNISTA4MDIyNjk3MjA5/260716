# Tools

Standalone single-file HTML tools for requirements ⇔ design traceability work.

- `spec_to_json_conversion_tool_v1.18.html`: 仕様書JSON変換・確認ツール v1.18（取扱説明書準拠UI版）。PDF仕様書から照合用JSONを作成し、様式登録・版間比較・タグ付けを行う。v1.16で確認状態の色分け表示を追加、v1.17でツールバー初期化不具合（作業中JSON・確認済みJSON・検証結果・文書版情報・一括確認・元に戻す・作業復旧ボタンが消える）を修正、v1.18で同梱の様式プロファイル仕様書・生成AI用作成プロンプトをより詳細な版へ更新（ツール内「AIで様式作成」から参照可能）。
- `excel_to_json_conversion_tool_v2.0.3.html`: Excel → JSON変換・確認ツール v2.0.3。Excelの設計検証項目一覧をJSONに変換し、様式定義・タグ辞書に基づき検証する。v2.0.2で確認状態の色分け表示を追加、v2.0.3で「様式・タグ」メニューに「AIで様式作成」を追加してプロファイル仕様書・生成AI用プロンプトを参照可能にし、モーダルの無地ボタンが見えなくなる不具合を修正。
- `json_ab_trace_matching_tool_v12.1.3.html`: JSON A/Bトレース照合ツール v12.1.3。上記2ツールで生成したJSON（要求側A／設計側B）を照合し、ナレッジグラフ・トレースマトリクスを生成する。
