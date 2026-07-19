# shadow-mode挿入点の設計

`trace_comparison_schema_v1.md`で確定したスキーマを、本体3ツールのどの処理の後に生成するかを設計する。**本節はコード変更を行わず、挿入点・データフロー・未解決事項を確定するのみ**（`trace_comparison_schema_v1.md` §0の「本節で決定しないこと」の続き）。

## 1. 生成を2フェーズへ分割する理由

`trace-comparison/1.0`のレコードは、（a）要求側・実仕様側それぞれ単独で計算できる部分（`requirement_analysis`/`actual_analysis`＝数量抽出＋意味候補）と、（b）A-B対応が確定してから初めて計算できる部分（`relationship`＝どのA-Bペアか、`mapping`/`automation`/`comparison`＝そのペアの比較結果）に分かれる。この2つは実行タイミングが異なる既存ツールにまたがるため、1回の処理では生成できない。

- （a）は`spec_to_json_conversion_tool_v1.18.html`・`excel_to_json_conversion_tool_v2.0.8.html`側で、照合用JSON（`chapter-section-trace-v1`/`excel-row-trace-v1`）を生成した**直後**に計算できる（照合エンジンを一切必要としない）。
- （b）は`json_ab_trace_matching_tool_v12.1.15.html`側で、A-B照合が完了した**直後**にしか計算できない（`relationship`が照合結果そのものに依存するため）。

したがって、挿入点は本体3ツールそれぞれに1箇所ずつ、計3箇所になる。

## 2. 挿入点A・B：PDF/Excel側での「数量注釈シャドー出力」

### 2.1 PDF側（`spec_to_json_conversion_tool_v1.18.html`）

- 既存の生成関数：`buildTraceExport(obj, profile, adapterSide)`（2396行目）が`{..., _trace_records: built.records}`を組み立て、`downloadTraceJsonObject(obj, filename)`（2438行目）でダウンロードする。この2つの関数は**変更しない**。
- 新設する関数（案）：`buildQuantityAnnotationSidecar(traceExport)` — `traceExport._trace_records`を読み取り専用の入力として受け取り、各レコードの`source_raw_text`（または`trace_text`）に対して`extractQuantities()`（`quantity_extraction_prototype.js`から移植）を適用し、`trace_id`をキーにした注釈配列を返す。
- 呼び出し位置：`buildTraceExport()`の**戻り値を使う側**（既存のダウンロードボタンのイベントハンドラ）に、新しい別ボタン（例：`downloadQuantityAnnotationBtn`）を追加し、そのハンドラ内で`buildQuantityAnnotationSidecar(buildTraceExport(...))`を呼ぶ。既存の`downloadTraceJsonObject()`呼び出し・既存ボタンには一切触れない。

出力形（案）：

```json
{
  "schema_version": "quantity-annotation/1.0",
  "side": "requirement",
  "source_trace_file": "customer_hvac_requirements_trace.json",
  "generated_at": "2026-07-19T07:00:00Z",
  "records": [
    { "trace_id": "req-cooling-capacity",
      "quantities": [ { "source_text": "12 kW", "kind": "interval", "...": "extractQuantitiesの出力そのもの" } ],
      "semantics_candidates": [ { "value": "acceptable_region", "confidence": 0.6, "...": "..." } ]
    }
  ]
}
```

### 2.2 Excel側（`excel_to_json_conversion_tool_v2.0.8.html`）

- 既存の生成関数：`buildTraceOutput(records, profile)`（1904行目）が`excel-row-trace-v1`形式を組み立てる。ダウンロードは`downloadJson()`（2961行目）→`downloadJsonBtn`のクリックハンドラ（3960行目）。この経路は**変更しない**。
- 新設する関数：PDF側と対称に`buildQuantityAnnotationSidecar(traceOutput)`（`side: "actual"`）を新設し、`traceOutput._trace_records`の各レコードの`source_record`から対象列（`検討結果`等、プロファイルで指定された数量を含む列）のテキストを取り出して`extractQuantities()`を適用する。
- 課題（未解決、3節参照）：**どの列に数量が含まれるかは帳票ごとに異なる**（本セッションのサンプルでは「検討結果」列だが、汎用的な規則ではない）。プロファイルJSON（`EXCEL_PROFILE_SPEC_MD`）に新しい任意項目（例：`quantity_columns`）を追加し、利用者が明示的に指定する運用が現実的（`text_columns`と同じ設計パターンを踏襲できる）。

## 3. 挿入点C：照合エンジン側での「比較レコード組み立て」

### 3.1 位置

`json_ab_trace_matching_tool_v12.1.15.html`の照合完了後（`mergedResult`が populate された後、既存の`downloadJsonBtn`・`traceReviewExportBtn`が有効化されるのと同じタイミング）に、新しいオプトインのボタン（例：`downloadComparisonSidecarBtn`）を追加する。

### 3.2 入力

1. 2節で生成した2つの`quantity-annotation/1.0`ファイル（要求側・実仕様側）を、新しいファイル入力欄からアップロードする。
2. 既存の`traceMatrixRows`（`relationship`の元データ：`A_ID`/`B_ID`/`分類`/`方式`/`信頼度`）。
3. 既存の`mergedResult.sysList`/`plmList`（`trace_id`の突き合わせ用。`baseline_v1_handoff.md` §7.4のID契約により、`traceMatrixRows`の`A_ID`/`B_ID`ではなく、`sysList`/`plmList`内の`trace_id`フィールドを直接読む）。

### 3.3 組み立て手順（案）

1. `traceMatrixRows`の各行について、対応する`sysList`エントリ・`plmList`エントリを`_sysRowId`/`_plmRowId`等の内部キーで引き当て、両者の`trace_id`を取得する（`A_ID`/`B_ID`は使わない）。
2. 取得した`trace_id`の組で、アップロード済みの2つの`quantity-annotation/1.0`ファイルから該当レコードを検索する。片方または両方が見つからない場合、そのペアはスキップする（比較対象になる数量がないだけであり、エラーではない）。
3. 見つかった場合、要求側の`quantities[]`×実仕様側の`quantities[]`の**全組み合わせ**について、`quantity_pair_id`（例：`q1`, `q2`...）を振り、`generatePropertyCandidates()`→`deriveComparisonModeCandidate()`→`evaluateAutoApplicable()`→（`applicable`なら）`coverageGap()`を実行して`mapping`/`automation`/`comparison`を組み立てる。
4. `relationship`は`traceMatrixRows`の`方式`（`matchMethod`）・`信頼度`（`confidence`）・`分類`（`review_category`）をそのまま転記する。
5. `review`は常に`{status:"unreviewed", confirmed:false, ...}`で初期化する（既存のレビュー状態`localStorage`とは別物として扱う。統合方針は5節）。

### 3.4 課題

- `generatePropertyCandidates()`が依存する`CONCEPT_DICTIONARY`はHVACサンプル限定のたたき台（`baseline_v1_handoff.md` §8末尾）であり、本体の実データに対応する概念辞書がまだ存在しない。**この関数を本体へ移植する前に、対象帳票の実データから概念辞書を作り直す必要がある**（これも「実データで検証できない拡張は行わない」という原則に従う）。
- 要求側×実仕様側の数量の「全組み合わせ」を試すと、無関係な数量ペアにも候補が生成されてしまう可能性がある。`mapping.confidence`が低い組み合わせを候補生成の時点で足切りするか、生成はするがUI表示側で隠すか（`trace_comparison_schema_v1.md` §12の4区分と連動）は未決定。

## 4. UIへの影響（オプトインの原則）

3箇所の新設ボタンはいずれも、既存のボタン・既存のイベントハンドラ・既存のJSON生成関数を変更しない、**追加のみ**の変更にする。利用者がクリックしなければ何も生成されず、既存のワークフロー（PDF/Excel変換→照合→レビュー）は現状のまま動作する。これは`baseline_v1_handoff.md` §7.1〜§7.3で確認した「未知フィールド・元データが保持される」という性質を前提にした設計ではなく、**そもそも既存の出力に一切触れない**、より保守的な統合方式である。

## 5. 未解決事項

- **レビュー状態の永続化先の一本化**（`trace_comparison_schema_v1.md` §13から継続）：`trace-comparison/1.0`の`review`セクションをファイルに書き戻す運用にするか、既存の`localStorage`（`v11_trace_review_store`）に相乗りさせるかは未決定。後者は`_reviewKey`のキー形式（`traceReviewKeyFromValues(A_ID, B_ID, category)`、`baseline_v1_handoff.md` §7.2.4）が`matcher_id`ベースであり、`trace-comparison/1.0`の`comparison_id`（`trace_id`ベース）とキー空間が異なるため、素直には統合できない。
- **quantity_columnsのプロファイル拡張**（2.2節）：Excel側のプロファイル仕様変更が必要で、既存プロファイルとの後方互換性（`quantity_columns`省略時は数量注釈を生成しない、という既定動作）を確認する必要がある。
- **全組み合わせ候補生成のノイズ**（3.4節）：実データでの誤検出率を測らないまま本体へ組み込むと、8.21節で修正したのと同種の「候補ノイズ」が再発する可能性がある。本体側の実データが手に入った時点で、`vocabulary_negation_fuzz_test.js`と同様の摂動テストを行うことを推奨する。
- **`generatePropertyCandidates()`の概念辞書**（3.4節）：本体統合の前提条件であり、これ単体でも相応の設計・実データ収集作業になる。

## 6. 次工程の推奨順序

1. 対象帳票（本体で実際に使われているPDF/Excelサンプル、可能なら匿名化済みのもの）を用いて、`quantity_columns`拡張の要否・概念辞書の中身を実データから作る。
2. 2節の数量注釈シャドー出力（PDF/Excel側、既存コードへの影響ゼロ）を先に実装・検証する。3節（照合エンジン側の組み立て）より依存が少なく、単独でテストできるため。
3. 3節の比較レコード組み立てを実装し、`trace_comparison_schema_v1.md` §11と同じ形の実データ版の出力例を作る。
4. レビュー状態の永続化先を決定する（5節）。
