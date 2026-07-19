# shadow-mode挿入点の設計（`-rc1`）

`trace_comparison_schema_v1.md`で確定したスキーマを、本体3ツールのどの処理の後に生成するかを設計する。**本節はコード変更を行わず、挿入点・データフロー・未解決事項を確定するのみ**（`trace_comparison_schema_v1.md` §0の「本節で決定しないこと」の続き）。

> **改訂履歴**：初版（コミット`22c5e24`）へのレビューで6件の必須修正が指摘された（数量と意味候補の対応の曖昧さ／照合行から元レコードを引く契約の未確定／入力の取り違え・陳腐化の未検出／`quantity_pair_id`等の順序依存／`quantity_columns`必須指定の方針不一致／全組み合わせ生成の絞り込み未設計）。本改訂でこれらに対応し、`quantity-annotation/1.0`・`trace-comparison/1.0`の両スキーマを`-rc1`（修正完了までの暫定版）とする。修正完了の判定基準は9節。

## 1. 生成を2フェーズへ分割する理由

`trace-comparison/1.0-rc1`のレコードは、（a）要求側・実仕様側それぞれ単独で計算できる部分（`requirement_analysis`/`actual_analysis`＝数量抽出＋意味候補）と、（b）A-B対応が確定してから初めて計算できる部分（`relationship`＝どのA-Bペアか、`mapping`/`automation`/`comparison`＝そのペアの比較結果）に分かれる。この2つは実行タイミングが異なる既存ツールにまたがるため、1回の処理では生成できない。

- （a）は`spec_to_json_conversion_tool_v1.18.html`・`excel_to_json_conversion_tool_v2.0.8.html`側で、照合用JSON（`chapter-section-trace-v1`/`excel-row-trace-v1`）を生成した**直後**に計算できる（照合エンジンを一切必要としない）。
- （b）は`json_ab_trace_matching_tool_v12.1.15.html`側で、A-B照合が完了した**直後**にしか計算できない（`relationship`が照合結果そのものに依存するため）。

したがって、挿入点は本体3ツールそれぞれに1箇所ずつ、計3箇所になる（この構成自体はレビューで承認済み）。

## 2. 挿入点A・B：PDF/Excel側での「数量注釈シャドー出力」（`quantity-annotation/1.0-rc1`）

### 2.0 数量単位でまとめる構造（必須修正1への対応）

初版の`quantities[]`と`semantics_candidates[]`を独立配列にする設計は、1つの文章・セルに複数の数量がある場合にどちらがどちらに属するか判別できないという欠陥があった。`semantic_mapping_prototype.js`の`buildPropertyCandidateRecords()`（552行目）が、まさに同じ問題を「1つの数量＝1レコード」の`analyses[]`的な配列（`quantity_ref`＋`quantity_record`＋`property_candidates`＋`interval_semantics_candidates`を1件にまとめる形）で既に解決している。これをそのまま踏襲する。

`quantity_id`の生成規則（必須修正4「順序依存の`quantity_pair_id`」への対応も兼ねる）：**内容から一意に定まる識別子とし、抽出順序（配列のインデックス）には依存させない。** `json_ab_trace_matching_tool_v12.1.15.html`の`simpleHash(text)`（10451行目、FNV-1aベースの同期ハッシュ）を3ツール共通のユーティリティとして再利用する（9節の「core共通化」の第一歩として、この関数だけを先に3ファイルへ複製するのが最小の一歩になる）。

```
quantity_id = "q-" + simpleHash([trace_id, source_field, occurrence_index, normalized_text].join(""))
```

`occurrence_index`は`buildPropertyCandidateRecords()`が既に持つ「同じ`source_text`がセル内に複数回現れる場合の出現順カウンタ」をそのまま使う。`semantic_mapping_prototype.js` 559〜569行目が明記する通り、これは「`extractQuantities()`の出力順序が原文の出現順序と一致する」という**暗黙の前提**に依存する既知の弱点であり、正式な解決には`source_span`（原文内の開始・終了オフセット）が必要とされている。本設計でも同じ制約を引き継ぐため、`source_span`フィールドを**今は`null`のまま予約し**、`source_field + occurrence_index + normalized_text`を当面の正式なデータ契約として明記する（レビュー指摘のとおり）。

### 2.1 出力形（`quantity-annotation/1.0-rc1`）

```json
{
  "schema_version": "quantity-annotation/1.0-rc1",
  "side": "requirement",
  "source_trace_file": "customer_hvac_requirements_trace.json",
  "dataset_signature": "QA:9f1c2ab0:N4",
  "generated_at": "2026-07-19T07:00:00Z",
  "generator": { "tool": "quantity_extraction_prototype.js + semantic_mapping_prototype.js", "version": "v2.13 / v2.19" },
  "ruleset_version": {
    "unit_defs": "v2.13",
    "semantics_rules": "v2.19",
    "auto_applicable_thresholds": { "modeConfidence": 0.4, "margin": 0.2, "propertyConfidence": 0.7 }
  },
  "records": [
    {
      "trace_id": "req-cooling-capacity",
      "content_hash": "a1b2c3d4",
      "analyses": [
        {
          "quantity_id": "q-7e2f9a01",
          "source_field": "source_raw_text",
          "occurrence_index": 0,
          "source_span": null,
          "normalized_text": "12 kW",
          "quantity": { "...": "extractQuantities()の1件分の出力そのもの" },
          "interval_semantics_candidates": [ { "value": "acceptable_region", "confidence": 0.6, "...": "..." } ]
        }
      ]
    }
  ]
}
```

- `dataset_signature`：元trace JSON（`_trace_records`全体）から`simpleHash()`で導出する（`currentDatasetSignature()`と同じ設計パターン、10458行目）。**取り違え検出の第一段階**：突き合わせ時に、参照した`sysList`/`plmList`から再計算した`dataset_signature`と一致しない場合、そのファイル全体を`source_mismatch`として扱う（3.3節）。
- `records[].content_hash`：レコード単位（`trace_id`単位）の内容ハッシュ。`source_field`の生テキスト全体から`simpleHash()`で算出する。**取り違え検出の第二段階**：ファイル全体は一致していても個別レコードが編集されている場合に検出する。
- `generator`/`ruleset_version`：どのバージョンの抽出ロジック・語彙・閾値で生成されたかを記録する。`AUTO_APPLICABLE_THRESHOLDS`のような閾値が変わると、同じ入力でも`automation.auto_applicable`の結果が変わり得るため、再現性の根拠として必須とする。

### 2.2 PDF側（`spec_to_json_conversion_tool_v1.18.html`）

- 既存の生成関数：`buildTraceExport(obj, profile, adapterSide)`（2396行目）が`{..., _trace_records: built.records}`を組み立て、`downloadTraceJsonObject(obj, filename)`（2438行目）でダウンロードする。この2つの関数は**変更しない**。
- 新設する関数（案）：`buildQuantityAnnotationSidecar(traceExport)` — `traceExport._trace_records`を読み取り専用の入力として受け取り、各レコードの`source_raw_text`に対して`extractQuantities()`を適用し、2.0節の`quantity_id`規則で`analyses[]`を組み立てる。
- 呼び出し位置：新しい別ボタン（例：`downloadQuantityAnnotationBtn`）のハンドラ内で`buildQuantityAnnotationSidecar(buildTraceExport(...))`を呼ぶ。
- **推奨修正「再実行の同一性保証」への対応**：この設計は、直前に`downloadTraceJsonBtn`でダウンロードした`_trace_records`と、`buildQuantityAnnotationSidecar()`が読む`_trace_records`が同一であることを前提にする。`buildTraceExport()`自体に非決定的な要素（現在時刻由来の`generated_at`以外）がないことをコードレベルで確認する必要がある（未実施、9節のテスト項目に追加）。同一性が保証できない場合は、2つのボタンを1回の生成結果から両方書き出す単一ボタン（`_trace_records`と数量注釈を同時にダウンロードする）に設計変更する。

### 2.3 Excel側（`excel_to_json_conversion_tool_v2.0.8.html`）— 列指定の非対称設計（必須修正5への対応）

初版で提案した「利用者が`quantity_columns`を明示的に指定する」運用は、ユーザーの一貫した方針（人間の事前準備を最小化する）に反するため撤回する。代わりに次の非対称設計を採用する。

1. **既定動作**：`buildTraceOutput()`が返す各レコードの`source_record`（元Excel行を丸ごと保持したオブジェクト、既存機能）に含まれる全フィールドのうち、文字列型・数値型の値を自動走査し、`extractQuantities()`を適用する。
2. **明らかな管理列の自動除外**：列名が`trace_id`/`stable_uid`/`stable_key`/`*_hash`/`No`/`ID`/`行番号`等のIDパターン、または`tags`/`unregistered_tags`/`review_status`等の既存の管理用フィールド名と一致する列は自動的にスキャン対象から除く（`json_ab_trace_matching_tool_v12.1.15.html` 3240〜3247行目に、既に同種の「id/trace_id/stable_uid/stable_key/*_hash等の名前パターンを持つ列は別扱いする」ロジックが実装されており、そのパターンをそのまま流用できる）。
3. **`quantity_columns`は任意のoverride**：自動走査でノイズが多い場合に、利用者が明示的に対象列を絞り込むための任意設定として残す（必須ではない）。
4. **列候補の提示**：初回の自動走査結果から「数量が検出された列」の一覧と検出件数を集計し、UI上に参考情報として表示する（「列Xで12件、列Yで1件検出」等）。これにより、利用者が`quantity_columns`で絞り込むかどうかを、実データを見てから判断できるようにする。

この設計により、事前の様式準備・辞書登録は一切不要になり、初回実行の結果を見てから任意で絞り込む、という順序になる。

## 3. 挿入点C：照合エンジン側での「比較レコード組み立て」

### 3.1 位置

`json_ab_trace_matching_tool_v12.1.15.html`の照合完了後（`mergedResult`が populate された後）に、新しいオプトインのボタン（例：`downloadComparisonSidecarBtn`）を追加する。

### 3.2 照合行から元レコードを引く契約（必須修正2への対応）

初版の「`_sysRowId`/`_plmRowId`等の内部キーで引き当てる」という記述を、実装可能な形に確定する。

**`traceMatrixRows`を生成する時点で、各行に次の4フィールドを内部的に保持させる**（表示用の`A_ID`/`B_ID`は従来どおり変更しない。これは表示専用の別フィールドとして併存させる）：

```js
{
  requirement_trace_id,   // sysList側レコードのtrace_idそのもの
  actual_trace_id,        // plmList側レコードのtrace_idそのもの
  matcher_a_id,            // 現行のA_ID(表示用、従来通り)
  matcher_b_id             // 現行のB_ID(表示用、従来通り)
}
```

取得元：`traceMatrixRows`の生成ロジック（`json_ab_trace_matching_tool_v12.1.15.html`、`matchPlmParts()`・`traceMatrixRows`組み立て箇所）が、既に`sysRowId()`/`plmUniqueKey()`を呼んで`A_ID`/`B_ID`を決定している。その同じ呼び出し箇所で、対応する`sysList`/`plmList`エントリの`row.trace_id`を追加で保持させるだけでよく、新しい突き合わせロジックを別途書く必要はない。

**未定義だった4つの挙動を確定する**：

| ケース | 挙動 |
|---|---|
| `trace_id`重複（同一側に同じ`trace_id`が複数） | `relationship.source`を`"ambiguous_trace_id"`とし、`comparison`は生成しない（`null`）。人間確認を必須にする。重複自体は`baseline_v1_handoff.md`の既存不変条件（本体側の`trace_id`一意性検証、`excel_to_json_conversion_tool_v2.0.8.html`の「`trace_id`が重複していない」検証、§10）に反する入力であり、sidecar側で無理に解決しようとしない。 |
| 元レコードが見つからない（`quantity-annotation`側に該当`trace_id`がない） | `comparison`は`null`。`automation.auto_applicable`は生成せず、代わりにレコード自体を生成しない（3.4節の`not_analyzed`集計へ回す）。 |
| A未対応／B未参照（`traceMatrixRows`上でペアが存在しない） | そもそも`requirement_ref`×`actual_ref`のペアが存在しないため、`trace-comparison/1.0-rc1`のレコード自体を作らない。既存UIの「A未対応」「B未参照」集計（`baseline_v1_handoff.md` §7.2.4）とは別の関心事として扱う。 |
| 同じA-Bペアが複数行に現れる（重複マッチ） | `comparison_id`は`requirement_ref.trace_id + actual_ref.trace_id + quantity_pair_id`から決まるため、複数行があっても同じ`comparison_id`に収束する。後勝ち・先勝ちの優先順位は決めず、**生成時点で重複を検出したら警告として記録し、両方は生成しない**（どちらの`relationship`情報を採用すべきか自明でないため、人間確認へ回す）。 |

### 3.3 取り違え・陳腐化の検出（必須修正3への対応）

突き合わせ時に、次の順で整合性を確認する：

1. `quantity-annotation`ファイルの`dataset_signature`を、現在ロード中の`sysList`/`plmList`から再計算した値と比較する。不一致なら、そのファイル全体を`source_mismatch`として扱い、そのファイルに由来する比較レコードは一切生成しない（部分的に使わない）。
2. 個別レコードの`content_hash`を、`mergedResult.sysList`/`plmList`の該当レコードの`source_raw_text`/`source_record`から再計算した値と比較する。不一致なら、その`trace_id`のレコードだけを`stale_annotation`として扱う。
3. 1・2のいずれにも該当しない場合のみ、通常の比較処理へ進む。

**`source_mismatch`・`stale_annotation`は、「該当数量なし」（3.4節の`not_analyzed`）とは明確に区別する**。前者は「入力が信頼できない」ことを示し、後者は「入力は信頼できるが対象がない」ことを示すため、UI上の扱いも診断上の重大度も異なるべきである。

### 3.4 全組み合わせ生成の絞り込み（必須修正6への対応）

要求側`analyses[]`×実仕様側`analyses[]`の全直積をそのまま候補にするのではなく、次の順で段階的に絞り込む。各段階で除外された件数と理由を診断情報として保持し、単に非表示にはしない。

1. **canonical dimension一致**：`quantity.unit.dimension`が一致しないペアを除外する（`power`と`temperature`は最初から比較不能）。
2. **設計特性候補の一致**：`generatePropertyCandidates()`の出力上位候補の`concept_id`が一致しないペアを除外する（7節の「候補配列から単一`mapping`への縮約」を参照。ここでは縮約前の候補集合同士の重なりで足切りする）。
3. **条件候補の整合**：`condition_candidates`が双方にある場合、次元・値が大きく矛盾するペア（例：要求側は「50 °Cで」、実仕様側は「10 °Cで」）を除外する。
4. **意味ペアからcomparison mode導出可能**：`deriveComparisonModeCandidate()`が`null`を返すペア（`COMPARISON_MODE_DERIVATION_TABLE`に未登録の組み合わせ）を除外する。これは新しい絞り込みではなく、既存の安全設計（`baseline_v1_handoff.md` §4不変条件2・3）をそのまま候補削減にも使うということ。
5. 1〜4を通過してなお複数ペアが残る場合のみ、`review.status: "unreviewed"`の候補として`trace-comparison/1.0-rc1`レコードを生成する。

除外されたペアは、削除するのではなく`not_analyzed`集計（トップレベルの診断情報、レコードとしては生成しない）へ、除外段階（1〜4のどこで落ちたか）と件数を記録する。「sidecarが見つからないペア」（3.2節）も同じ`not_analyzed`集計に含め、理由コード（`no_annotation`/`source_mismatch`/`stale_annotation`/`dimension_mismatch`/`concept_mismatch`/`condition_mismatch`/`no_comparison_mode`）で区別する。

## 4. UIへの影響（オプトインの原則）

3箇所の新設ボタンはいずれも、既存のボタン・既存のイベントハンドラ・既存のJSON生成関数を変更しない、**追加のみ**の変更にする。利用者がクリックしなければ何も生成されず、既存のワークフロー（PDF/Excel変換→照合→レビュー）は現状のまま動作する。

## 5. コードの重複を避ける（推奨修正への対応）

`extractQuantities()`・`simpleHash()`・`generatePropertyCandidates()`等のロジックを3つのHTMLへ個別にコピーすると、修正が3箇所に分散し、`ruleset_version`の整合性も崩れやすくなる。共有方法の候補（未決定、実装時に選定）：

- 3ファイルが`<script>`で読み込む共通の外部JSファイル（`tools/shared/quantity_core.js`のような単一ソース）に切り出す。単一HTMLファイルという既存の配布方式（ネットワーク接続なしで動作する前提）を崩さないよう、ビルド時にインライン化する手順が必要になる可能性がある。
- 最低限、`ruleset_version`に記録するバージョン文字列だけは3ファイルで確実に同期させる（コードは別々でも、フィンガープリントで不整合を検出できるようにする）。

## 6. 回帰テスト（推奨修正への対応、実装前に用意する）

sidecar結合処理（2〜3節）自体は、既存5スイート（プロトタイプ側の数量抽出・意味候補生成）ではカバーされない新規ロジックのため、実装時に少なくとも次のケースをテストする：

1. 1文に複数数量がある場合に、正しい`quantity_id`で`analyses[]`が分かれること
2. 同一表記の数量（例：「50 °C」が同じ文に2回出現）が異なる`occurrence_index`で区別されること
3. 重複`trace_id`が3.2節の表のとおり`ambiguous_trace_id`として扱われ、`comparison`が生成されないこと
4. `quantity-annotation`の原文ハッシュ不一致が`stale_annotation`として検出され、通常の比較と混同されないこと
5. 数量が存在しないレコードが`not_analyzed`（理由: `no_annotation`）として集計され、エラーにならないこと
6. 単位次元が不一致のペアが3.4節の段階1で除外され、`not_analyzed`（理由: `dimension_mismatch`）に計上されること
7. A未対応／B未参照のケースで、そもそも`trace-comparison/1.0-rc1`レコードが生成されないこと
8. `_trace_records`の再生成後（同一入力での再実行）も`quantity_id`・`comparison_id`が変化しないこと（2.0節の内容ベースID規則の安定性そのものの検証）

## 7. 候補配列から単一`mapping`への縮約（必須修正4の一部への対応）

`generatePropertyCandidates()`は候補の配列を返す（`semantic_mapping_prototype.js` 484行目）。`trace_comparison_schema_v1.md`の`mapping`セクションは単一の`concept_id`を想定していたが、複数候補がある場合にどれを採用するかの規則が未定義だった。

`evaluateAutoApplicable()`が`requirementCandidates`/`actualCandidates`に既に適用している「上位候補と次点候補の差（`marginOf()`）が閾値`AUTO_APPLICABLE_THRESHOLDS.margin`（現行0.2）以上かどうか」という同じ判定パターンを、`property_candidates`にもそのまま適用する：

- 上位候補と次点候補の差が閾値以上 → `mapping.status: "resolved"`、上位候補を`mapping.concept_id`として採用。
- 差が閾値未満、または候補が1件もしくは0件 → `mapping.status: "ambiguous"`、`mapping.concept_id`は`null`とし、`mapping.candidates`に全候補を残す（消さない）。この場合、その比較レコードは`automation.auto_applicable.applicable`の計算に進まず、`fail_reasons`に`"設計特性の対応が一意に決まらない"`を追加する。

これは新しい閾値を発明するのではなく、既存の`marginOf()`パターンを一貫して適用するだけであり、`propertyConfidence`という単一スカラー値を前提にしていた現行の`evaluateAutoApplicable()`のシグネチャ変更（`propertyConfidence`→`propertyCandidates`配列を渡す形へ）が必要になる。この関数シグネチャ変更は本体統合時のプロトタイプ側の修正事項として`trace_comparison_schema_v1.md`側にも記録する。

## 8. 未解決事項

- **レビュー状態の永続化先の一本化**：`trace-comparison/1.0-rc1`の`review`セクションをファイルに書き戻す運用にするか、既存の`localStorage`（`v11_trace_review_store`）に相乗りさせるかは未決定。後者は`_reviewKey`のキー形式（`matcher_id`ベース）が`comparison_id`（`trace_id`ベース）とキー空間が異なるため、素直には統合できない。
- **コード共有方式**（5節）：単一HTMLファイル配布という制約下での共通化方法が未決定。
- **`generatePropertyCandidates()`の概念辞書**：本体統合の前提条件であり、これ単体でも相応の設計・実データ収集作業になる（HVACサンプル限定の`CONCEPT_DICTIONARY`を実データから作り直す必要がある）。
- **`evaluateAutoApplicable()`のシグネチャ変更**（7節）：`propertyConfidence`（スカラー）→`propertyCandidates`（配列＋margin判定）への変更は、既存86件のテストスイートに新規ケースを追加する必要がある。

## 9. `-rc1`から正式版への昇格条件

次がすべて満たされた時点で、`quantity-annotation/1.0-rc1`・`trace-comparison/1.0-rc1`から`-rc1`を外して正式版とする：

1. 6節の回帰テスト8項目が実装・全件成功していること
2. 7節の`evaluateAutoApplicable()`シグネチャ変更とそれに伴うテスト追加が完了していること
3. 3.2節の4ケース（`trace_id`重複・元レコード欠落・A未対応/B未参照・重複マッチ）が実データまたは合成データで一度は再現・確認されていること
4. 8節の未解決事項のうち、少なくとも概念辞書とコード共有方式について実装方針が決まっていること（完全解決までは求めないが、「未定」のままでの正式版化はしない）

## 10. 次工程の推奨順序

1. 対象帳票（本体で実際に使われているPDF/Excelサンプル、可能なら匿名化済みのもの）を用いて、概念辞書の中身を実データから作る。
2. `simpleHash()`の3ファイル間共通化（5節）と、2節の数量注釈シャドー出力（PDF/Excel側、既存コードへの影響ゼロ）を先に実装・検証する。6節の回帰テストのうち1・2・8番はこの段階で検証できる。
3. 7節の`evaluateAutoApplicable()`シグネチャ変更をプロトタイプ側（`semantic_mapping_prototype.js`）に先行実装し、86件のテストスイートを更新する（本体へ移植する前にプロトタイプ側で安全性を確認する、という既存の開発順序を踏襲）。
4. 3節の比較レコード組み立てを実装し、6節の回帰テストのうち3〜7番を検証する。
5. レビュー状態の永続化先を決定する（8節）。
