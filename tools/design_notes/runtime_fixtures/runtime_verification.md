# 実ブラウザ検証記録（照合エンジンの動的挙動）

`baseline_v1_handoff.md`§7.2の静的読解（コードを読んだだけの推測）を、実際にブラウザで動かして裏付ける・修正するための検証記録。レビューで指摘された5項目（`findRecordArrays()`の実データでの選択、`source_record`内の配列による誤選択リスク、export/import往復での未知フィールド保持、実際の`A_ID`／`B_ID`と`trace_id`の対応、レビューパッケージの内容）を対象とする。

## 1. 検証方法

### 1.1 実行環境

- Playwright 1.56.1、Chromium 141.0.7390.37（`/opt/pw-browsers`にプリインストール済みのもの）
- Node.js v22.22.2
- 検証スクリプトは本ディレクトリではなく、セッションのスクラッチパス（`/tmp/.../scratchpad/pw_verify/`）に置いて実行した。スクリプト自体はリポジトリに含めていない（使い捨てのため）。再現する場合は本ファイルの3節のコード片を元に再構成すること。

### 1.2 CDN代替（既存の`samples/hvac_trace_sample_small/verification_report.md`と同じ手法）

このセッションのネットワークポリシーでも、`unpkg.com`・`cdn.jsdelivr.net`への直接アクセスが拒否されることを確認した（前回検証と同じ制約）。前回と同じ対処＝npm registry（アクセス許可対象）から同一バージョンのライブラリを取得し、Playwrightの`route()`でCDN URLをローカルファイルへ差し替えた。

| ライブラリ | バージョン | 用途 |
|---|---|---|
| xlsx (SheetJS) | 0.18.5 | 照合ツールのExcel入出力 |
| cytoscape | 3.26.0 | ナレッジグラフ描画 |
| tiny-segmenter | 0.2.0 | 日本語分かち書き |

`json_ab_trace_matching_tool_v12.1.15.html`はJSON入力のみを使うため、この3ライブラリだけで動作した（pdf.js・tesseract.jsは対象外）。

### 1.3 今回の検証範囲についての重要な注記

**PDF→`chapter-section-trace-v1`・Excel→`excel-row-trace-v1`の新規生成は、このセッションでは行っていない。** 代わりに、既存の`samples/hvac_trace_sample_small/JSON_A_customer_requirements_trace.json`・`JSON_B_design_review_trace.json`を入力として使った。これらのサンプルJSONが実際のツール生成物と（様式プロファイル・タグ辞書を適切に設定した場合に）内容一致することは、同ディレクトリの`verification_report.md`（2026-07-17付、本セッションより前に別途実施済み）3.2節・3.4節で、実際にPDF/Excelから生成した結果と突き合わせて既に確認されている（`trace_text`・タグが一字一句完全一致）。この既存確認に重複する検証を今回は行わず、**今回は照合エンジン（`json_ab_trace_matching_tool_v12.1.15.html`）の入力・正規化・スコアリング・出力という、前回のレポートでは深掘りしていなかった内部動作に絞って検証した。**

## 2. 検証手順

1. `samples/hvac_trace_sample_small/JSON_B_design_review_trace.json`をコピーし、先頭レコード（`trace_id: "design-use-temperature"`）へ合成フィールド`quantity_analysis: {probe:"quantity_analysis_survives_v1", value:12.5, unit:"kW"}`を注入した（`excel_trace_input_with_probe.json`として本ディレクトリに保存）。将来`trace-comparison/1.0`が持つであろうフィールドの生存確認用プローブである。
2. Playwrightで`json_ab_trace_matching_tool_v12.1.15.html`を`file://`で開き、`#sysFile`へ`JSON_A_customer_requirements_trace.json`、`#plmFile`へ上記のプローブ入りJSONを`setInputFiles()`でセットし、`#loadBtn`をクリックした。
3. `page.evaluate()`でページのJavaScriptコンテキストへ直接アクセスし、`rowsForSchema('plm')`（正規化直後の内部データ）、`traceMatrixRows`（表示用行）、`mergedResult`（`downloadJsonBtn`が出力するのと同じ内容）、`window.exportTraceReviewPackage()`（`traceReviewExportBtn`が出力するのと同じ内容）を取得した。
4. 別途、`nested_array_trap`という合成配列（要素数0/4/5/6/10/50/200）をB側先頭レコードへ注入したバリエーションを7パターン作り、それぞれ同じ手順で読み込み、`rowsForSchema('plm')`が本来の`_trace_records`（5件）と`nested_array_trap`のどちらを選んだかを確認した。

### 2.1 ダウンロードボタンの実クリックについて（未達成の点）

`#downloadJsonBtn`・`#traceReviewExportBtn`は、実際の照合結果一覧・トレースマトリクスタブを一度開かないと有効化されない仕様だった（`ensureLazyTabRenderedAsync()`による遅延描画）。`page.click('[data-tab="tabDetail"]')`等でタブを開く操作は行ったが、非同期の描画完了を待っても両ボタンの`disabled`が`false`にならなかった（原因は未特定。同ファイル10315行目付近の`cloneAndBind()`によるボタンの後差し替えが影響している可能性があるが、確認しきれていない）。

そのため、**ボタンのクリック→実際のファイルダウンロードという経路そのものは、今回未検証**である。代替として、両ボタンのクリックハンドラが実際に呼び出しているのと同じ内部関数（`mergedResult`変数の参照、`window.exportTraceReviewPackage()`の呼び出し）を`page.evaluate()`で直接呼び、出力内容を取得した。データの中身（正規化・照合・エクスポートのロジック）は検証できたが、UIのボタン活性化ロジック自体に未確認のバグがある可能性は残る。前回の`verification_report.md`も同様の代替手法を一部で使っており（1.2節）、今回もその前例に倣った。

## 3. 検証結果

### 3.1 `findRecordArrays()`は実データで`_trace_records`を正しく選ぶか

トラップなし（`nested_array_trap`なし）の場合、`rowsForSchema('plm')`は5件、フィールド構成は`trace_id`・`source_record`等、期待どおりの`_trace_records`の内容だった。**実データでの選択は正しい。**

### 3.2 `source_record`内に配列がある場合の誤選択リスク

`nested_array_trap`の要素数を変えて7回実行した結果（`array_selection_risk_results.json`）：

| trapSize | 選択された配列 | plmCount |
|---|---|---|
| 0（トラップなし） | `_trace_records` | 5 |
| 4 | `_trace_records` | 5 |
| 5（本来の配列と同数） | `_trace_records` | 5 |
| **6**（本来の配列より1件多いだけ） | **`nested_array_trap`（誤選択）** | 6 |
| 10 | `nested_array_trap`（誤選択） | 10 |
| 50 | `nested_array_trap`（誤選択） | 50 |
| 200 | `nested_array_trap`（誤選択） | 200 |

**誤選択リスクは実際に確認された。** `INPUT_FIELD_SCHEMAS.plm.fields`が空である現状の実装（`baseline_v1_handoff.md`§7.2.1参照）では、配列選択が実質的に要素数の大小だけで決まるため、**レコード内のどこかのフィールドに`_trace_records`より要素数が多い配列が入っていると、その配列が丸ごと「B側の行データ」として誤って扱われる。** 閾値は「本来の配列と同数ならセーフ、1件でも多ければアウト」という際どいものだった。

この結果は、`trace-comparison/1.0`をB側レコードへ後付けする設計において、**数量抽出候補（`interval_semantics_candidates`等、複数件になりうる配列）を安易にB側レコード自身のフィールドとして埋め込むと、実データ次第でこの誤選択を誘発しうる**ことを意味する。対策の方向性としては、(a) 後付けフィールドをトップレベル配列ではなく別のオブジェクト（sidecarレコード）に分離する、(b) 埋め込む場合も配列ではなくオブジェクトでラップする、のいずれかが考えられる。ユーザー提案の並行レイヤー方式（sidecarレコードとして独立させる）は、この誤選択リスクを構造的に回避できる点でも優位性がある。

### 3.3 export/import往復での未知フィールド保持

- 正規化直後（`rowsForSchema('plm')[0]`）: `quantity_analysis`・`source_record`とも完全な内容で存在。
- 照合完了後、`mergedResult.plmList`（`downloadJsonBtn`が出力するのと同じデータ）内の該当レコード（`trace_id: "design-use-temperature"`）を確認したところ、**`quantity_analysis`・`source_record`とも、注入した内容のまま完全に保持されていた。**

```json
"quantity_analysis": {"probe": "quantity_analysis_survives_v1", "value": 12.5, "unit": "kW"},
"source_record": {
  "分類": "環境", "設計項目": "使用温度範囲",
  "標準機種情報": "0 °C～40 °C",
  "顧客対応・検討内容": "高温側の使用限界を50 °Cまで拡張する。",
  "検討結果": "0 °C～50 °Cで使用可能",
  "根拠・備考": "圧縮機・ファン・制御部品の定格を確認済み。",
  "照合タグ": "使用温度", "確認状態": "確認済み"
}
```

**入力から照合結果出力まで、未知フィールドは欠落しなかった。** ただし2.1節で述べたとおり、`downloadJsonBtn`ボタンの実クリック経路そのものは検証できておらず、`mergedResult`変数を直接参照した結果である点に注意。実際にファイルとして書き出されるJSON.stringify(mergedResult)の内容は理論上同一のはずだが、完全な同一性は未確認。

`source_record.検討結果`の値（`"0 °C～50 °Cで使用可能"`）は、現行の`extractQuantities()`プロトタイプでそのまま処理できる形であることも確認した（`0 °C`・`50 °C`を含む範囲表現）。後付けの数量抽出ステップが、この実データに対して現実に機能する見込みがあることを、実際のexport結果に基づいて確認できた。

### 3.4 実際の`A_ID`／`B_ID`と`trace_id`の対応

```
A_ID: "req-use-temperature"   B_ID: "5"   分類: 要確認  方式: tag   信頼度: 0.88
A_ID: "req-use-temperature"   B_ID: "8"   分類: 要確認  方式: vector 信頼度: 0.80
A_ID: "req-cooling-capacity"  B_ID: "6"   分類: 要確認  方式: tag   信頼度: 0.88
A_ID: "req-power-supply"      B_ID: "7"   分類: 要確認  方式: tag   信頼度: 0.88
A_ID: "req-noise"             B_ID: "8"   分類: 要確認  方式: tag   信頼度: 0.88
A_ID: ""                      B_ID: "9"   分類: B未参照
```

**訂正が必要な点を発見した。** `baseline_v1_handoff.md`§7.2.4では、静的読解に基づき「`trace_id`が`A_ID`／`B_ID`として一貫して使われる」と記録したが、**これはA側（`A_ID`）のみで正しく、B側（`B_ID`）では成立しなかった。** 実際のB側レコードは`trace_id: "design-use-temperature"`のような値を持つが、`B_ID`には`"5"`〜`"9"`という**Excelの元データの行番号（`source_row`）に相当する値**が使われていた。

原因はコード上明確である：`sysRowId()`（A側）は`rowStableId()`を直接使い、`trace_id`という名前のフィールドを最優先で採用する。一方`plmUniqueKey()`（B側）が呼ぶ`plmBusinessKey()`は、`rowStableId()`（＝`trace_id`優先ロジック）に辿り着く**前**に、「コード的な列」「本文列」等のヒューリスティックな列選択（`chooseJsonField('plm', 'plmCode'/'plmText')`）を試す。今回のサンプルデータでは、そのヒューリスティックが`source_row`のような数値列を先に拾ってしまい、`trace_id`まで到達しなかったと考えられる（`chooseJsonField()`自体の詳細な選定ロジックは今回未調査）。

**設計上の含意**：`trace-comparison/1.0`を`requirement_trace_id`／`actual_trace_id`で構成する場合、`requirement_trace_id`（A側）は`A_ID`表示と一致すると期待してよいが、`actual_trace_id`（B側）は**照合エンジンが画面表示に使う`B_ID`とは異なる値になりうる**。sidecarレコードのキーには、画面表示用の`B_ID`ではなく、元の`_trace_records`が持つ`trace_id`フィールドの値そのものを直接参照する設計にすべきである（`B_ID`はあくまで照合エンジン内部の表示・重複排除用キーであり、`trace-comparison/1.0`が依拠すべき安定キーとしては信頼できない）。

### 3.5 レビューパッケージの内容

`window.exportTraceReviewPackage()`の戻り値（`review_package_actual.json`）のトップレベルキー：

```
schemaVersion (=2), tool, exportedAt, profile (="generic"),
reviews, manualRelations, replacements, trainingFeedback,
traceSnapshot ({tool, profile, created_at, pairs}),
resultMode, mlFeatureVersion, datasetSignature (例:"DS:4b6ad0e9:A4:B5"),
overviewScopeDecisions, phase7Version
```

今回はレビュー操作（レビュー判定の入力）を実施しなかったため（UIのレビュー入力欄をクリックする自動化は今回のスクリプトに含めていない。`setTraceReview`のようなグローバル関数も見つからなかった）、`reviews`は空だった。`traceSnapshot.pairs`には、今回の照合結果（`A_ID`×`B_ID`のペア）がスナップショットとして保存されていることを確認した。`datasetSignature`（`"DS:4b6ad0e9:A4:B5"`、A側4件・B側5件を含むハッシュ）は、レビューパッケージが特定のデータセットに紐づいていることを示す整合性チェック用の値と推測される（詳細な生成ロジックは今回未調査）。

**未確認のまま残った点**：実際にレビュー判定を1件以上入力した状態でのエクスポート内容（`reviews`オブジェクトの実際のレコード形）、および「レビューJSON読込」でこのファイルを再インポートした際に、レビュー状態・`quantity_analysis`等の後付けフィールドが正しく復元されるかどうかの往復確認は、今回のセッションでは行っていない。

## 4. 完了条件との対応

| 完了条件（依頼事項） | 結果 |
|---|---|
| PDF/Excelの入力レコード数 | 前回検証で確認済み（PDF4件・Excel5件）を流用。今回はB側5件で実行 |
| matcherが選択した配列 | 3.1・3.2節。実データでは正しいが、隣接する配列が本来の配列より要素数が多いと誤選択する |
| 正規化後レコード数 | plmCount=5（トラップなし時） |
| `source_raw_text`／`source_record`が保持されたか | 保持された（3.3節）。ただし`source_raw_text`（PDF側）は今回未検証、`source_record`（Excel側）のみ確認 |
| `trace_id`と`A_ID`／`B_ID`の対応 | **A_ID=trace_id、B_ID≠trace_id（source_row相当）という非対称性を発見**（3.4節） |
| 照合前後のフィールド欠落 | 欠落なし（3.3節） |
| export/import後のフィールド欠落 | exportまでは確認、reimportでの復元は未確認（2.1節・3.5節） |
| review状態の復元結果 | 未確認（3.5節） |
| 使用ブラウザと操作手順 | 1節・2節に記載 |

## 5. 総括：並行レイヤー方式（`trace-comparison/1.0`）の実現可能性への影響

前回セッション末の結論（未知フィールド保持・`confidence`分離・候補ペア生成後の挿入余地・A/B JSON非改変でのID参照）は、いずれも**実データで裏付けられた**。加えて、今回新たに2つの具体的な設計制約が判明した。

1. **B側の安定キーには`B_ID`ではなく元の`trace_id`フィールド値を直接使うこと**（3.4節）。`plmUniqueKey()`のヒューリスティックに依存すると、sidecarレコードのキーが画面表示のB_IDと食い違う。
2. **後付けフィールドを配列としてB側レコードへ直接埋め込むのは避けること**（3.2節）。`_trace_records`より要素数が多い配列を埋め込むと、`findRecordArrays()`の配列選択を誤らせるリスクが実証された。sidecarレコード（B側から独立した別レコード）として持たせる設計であれば、この問題は構造的に発生しない。

これらは、ユーザー提案の並行レイヤー方式（`trace-comparison/1.0`を独立したsidecarとする設計）を後押しする材料であると同時に、その設計を「なぜそうすべきか」の具体的根拠として記録しておく。
