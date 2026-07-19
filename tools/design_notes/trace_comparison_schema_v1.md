# `trace-comparison/1.0-rc1` 正式スキーマ設計

## 0. 位置づけ

`baseline_v1_handoff.md`で完了と判断された基準版v1（プロトタイプ側5スイート・実データ検証・実ブラウザ検証）、および同資料§7.4で確定した3点（配列選択の修正・ペアIDのデータ契約・PDF側`source_raw_text`生存確認）を踏まえ、`trace-comparison/1.0`の正式スキーマを設計する。

**本節で決定すること**：JSONスキーマの形そのもの。
**本節で決定しないこと**：本体への具体的な組み込み手順（shadow-mode挿入点）。これは`shadow_mode_integration_design.md`で扱う。

> **改訂履歴**：初版（コミット`22c5e24`）へのレビューで、順序依存の`quantity_pair_id`・単一`review.confirmed`による確認範囲の混同・候補配列から単一`mapping`への縮約過程の欠落・再現性情報（source hash・ruleset・閾値）の欠落、の4点が未解決として指摘された。本改訂でこれらに対応し、`-rc1`（修正完了までの暫定版）とする。`quantity-annotation/1.0-rc1`との対応関係、および`-rc1`から正式版への昇格条件は`shadow_mode_integration_design.md` §9に記録した。

## 1. 設計原則

1. **並行レイヤー方式（sidecar）を採用し、既存スキーマは変更しない**。`chapter-section-trace-v1`・`excel-row-trace-v1`のフィールド構成には一切手を加えない。根拠は`baseline_v1_handoff.md` §7.1〜§7.3で実証済み（未知フィールドの生存・元データの生存を静的解析＋実ブラウザ実行の両方で確認済み）。
2. **「設計特性一致・数量意味・比較方向・充足判定・人間確認」を1つのフィールドに混在させない**（プロジェクト全体を通じて維持してきた原則）。この原則を、スキーマのトップレベルを独立したセクション（`mapping`・`requirement_analysis`/`actual_analysis`・`automation`・`comparison`・`review`）に分けることで構造的に強制する（3節）。
3. **候補は生成してよいが確定はしない**。`automation`セクションの`comparison_mode_candidate.confirmed`は常に`false`のまま自動生成される。人間が確認した場合のみ、`review`セクション側で`confirmed: true`にする（両者は独立フィールドであり、`automation`側の値を書き換えない）。
4. **B側の表示ID（`matcher_id`）を永続キーにしない**（`baseline_v1_handoff.md` §7.4・§4不変条件6）。
5. **候補配列をB側レコード直下に生の配列として埋め込まない**（`baseline_v1_handoff.md` §4不変条件7・§7.3）。この原則から、格納方式を2節で決定する。
6. **識別子はすべて内容から導出し、抽出順序・処理順序に依存させない**（`-rc1`で追加。2.0節参照）。

## 2. 格納方式の決定：独立ファイルとしてのsidecar

`trace-comparison/1.0-rc1`のレコード群は、**B側（あるいはA側）の照合用JSONに埋め込む配列フィールドとしてではなく、独立した1つのJSONファイル（あるいはトップレベルオブジェクト）として格納する**。

理由：
- `json_ab_trace_matching_tool_v12.1.15.html`の`findRecordArrays()`は、`_trace_records`を最優先で採用するよう修正済み（`baseline_v1_handoff.md` §7.4・コミット`1044efb`）だが、これは「今回確認した特定の混入パターン」への対処であり、一般にB側レコード直下へ大きな配列を追加すること自体を安全と保証するものではない（多重防御の観点から、独立ファイルにする方が確実）。
- 独立ファイルであれば、`trace-comparison/1.0-rc1`は照合エンジンの読み込みパス（`prepareInputData()`→`extractRecordList()`）を一切通らない。既存の照合結果に影響を与えず、後付け・削除・再生成が自由にできる。
- `requirement_ref.trace_id`／`actual_ref.trace_id`でA側・B側の元レコードを直接参照するため（4節）、独立ファイルであっても対応関係は失われない。

### 2.0 再現性情報（必須修正：source hash・ruleset・閾値の欠落への対応）

トップレベルに、この`trace-comparison/1.0-rc1`ファイルがどの入力・どのルールセットから生成されたかを記録する`provenance`を持たせる。`quantity-annotation/1.0-rc1`（`shadow_mode_integration_design.md` §2.1）の`dataset_signature`・`generator`・`ruleset_version`をそのまま引き継ぐ。

```json
{
  "schema_version": "trace-comparison/1.0-rc1",
  "generated_at": "2026-07-19T06:30:00Z",
  "generator": { "tool": "quantity_extraction_prototype.js + semantic_mapping_prototype.js", "version": "v2.13 / v2.19" },
  "source": {
    "requirement_file": "customer_hvac_requirements_trace.json",
    "actual_file": "JSON_B_design_review_trace.json"
  },
  "provenance": {
    "requirement_dataset_signature": "QA:9f1c2ab0:N4",
    "actual_dataset_signature": "QA:2e7bb114:N5",
    "matching_dataset_signature": "DS:4b6ad0e9:A4:B5",
    "ruleset_version": {
      "unit_defs": "v2.13",
      "semantics_rules": "v2.19",
      "auto_applicable_thresholds": { "modeConfidence": 0.4, "margin": 0.2, "propertyConfidence": 0.7 }
    }
  },
  "not_analyzed": [ /* shadow_mode_integration_design.md §3.4。除外・未解析の集計。レコードとしては生成しないペアの理由コード集計 */ ],
  "comparisons": [ /* 3節のレコード形。1要求数量×1実仕様数量 = 1レコード */ ]
}
```

- `requirement_dataset_signature`/`actual_dataset_signature`：要求側・実仕様側それぞれの`quantity-annotation/1.0-rc1`ファイルの`dataset_signature`をそのまま転記する。取り違え検出の根拠として、生成時点の値を固定で残す（後から照合エンジン側で再計算した値と比較することで、5節で述べる整合性チェックの記録にもなる）。
- `matching_dataset_signature`：`json_ab_trace_matching_tool_v12.1.15.html`の`currentDatasetSignature()`（10458行目）が返す値をそのまま転記する。
- `ruleset_version`：`AUTO_APPLICABLE_THRESHOLDS`のような閾値を含む。閾値が変わると同じ入力でも`automation.auto_applicable`の結果が変わり得るため、どの閾値で生成された結果かを追跡できるようにする。

## 3. レコード形（フィールド定義）

1レコードは、ある要求側数量とある実仕様側数量の1ペアに対応する。

```
comparison_id           string        必須。 requirement_ref.trace_id + "::" + actual_ref.trace_id + "::" + quantity_pair_id
requirement_ref          object        必須。4節参照
actual_ref                object        必須。4節参照
quantity_pair_id         string        必須。2.1節参照（内容から導出、順序に依存しない）
relationship              object        必須。5節参照（このA-Bペアがどう結び付けられたか。数量の意味・比較結果は含まない）
requirement_analysis      object        必須。6節参照（要求側の数量抽出＋意味候補。confirmedしない）
actual_analysis            object        必須。6節参照（実仕様側の数量抽出＋意味候補。confirmedしない）
mapping                    object        必須。7節参照（設計特性対応。候補配列＋縮約結果。confirmedしない）
automation                 object        必須。8節参照（comparisonMode候補導出＋auto_applicable安全ゲート。confirmedしない）
comparison                  object|null   9節参照（automation.auto_applicable.applicable===trueの場合のみ非null）
review                       object        必須。10節参照（人間確認状態。confirmed:trueを持てるのはここだけだが、確認範囲を明示する）
```

### 2.1 `quantity_pair_id`の導出規則（必須修正：順序依存の解消）

初版では`"q1"`, `"q2"`のような連番を例示していたが、これは抽出順序が変わると同じ内容のペアでも別IDになってしまう欠陥があった。`shadow_mode_integration_design.md` §2.0で定義した`quantity_id`（`quantity-annotation/1.0-rc1`側で内容ハッシュから導出する識別子）をそのまま使い、次の規則にする：

```
quantity_pair_id = requirement_analysis.quantity_id + "::" + actual_analysis.quantity_id
comparison_id     = requirement_ref.trace_id + "::" + actual_ref.trace_id + "::" + quantity_pair_id
```

`quantity_id`自体が`[trace_id, source_field, occurrence_index, normalized_text]`の内容ハッシュであるため（`shadow_mode_integration_design.md` §2.0）、`_trace_records`や数量の再抽出順序が変わっても、同じ内容の数量ペアには同じ`comparison_id`が振られる（`shadow_mode_integration_design.md` §6の回帰テスト8番で検証する）。

### 4. `requirement_ref` / `actual_ref`（`baseline_v1_handoff.md` §7.4で確定済みの契約をそのまま採用）

```json
{
  "requirement_ref": {
    "trace_id": "req-cooling-capacity",
    "matcher_id": "req-cooling-capacity"
  },
  "actual_ref": {
    "trace_id": "design-use-temperature",
    "matcher_id": "5",
    "source_row": 5
  }
}
```

- `trace_id`：主キー。元のPDF/Excel照合用JSON（`chapter-section-trace-v1`/`excel-row-trace-v1`）の`trace_id`をそのまま使う。
- `matcher_id`：照合エンジンが表示する`A_ID`/`B_ID`。表示対応にのみ用いる、永続参照には使わない。
- `source_row`（`actual_ref`のみ、あれば）：Excel側`source_row`。人間がレビュー時に元のExcel行を探す助けとして残す（任意）。
- **照合行から元レコードを引く具体的な契約**（`traceMatrixRows`側にどの4フィールドを保持させるか等）は`shadow_mode_integration_design.md` §3.2に記録した。`trace_id`重複・元レコード欠落・A未対応/B未参照・重複マッチの4ケースの挙動も同節を参照。

### 5. `relationship`（A-Bペアの結び付き。数量の意味・比較結果は含まない）

このA側レコードとB側レコードがなぜペアとして扱われているかの由来を記録する。**既存の照合エンジンの「分類」（対応あり/要確認/etc.、`traceMatrixRows`の`分類`列）と同じ語彙を再利用する**が、これは「テキスト・タグの類似度に基づく対応判定」であり、数量比較の充足可否とは無関係（`baseline_v1_handoff.md` §7.2.3で確認済み）。この区別を保つため、`relationship`と`comparison`は別フィールドのままにする。

```json
{
  "relationship": {
    "source": "matching_engine",
    "match_method": "fuzzy",
    "match_confidence": 0.72,
    "review_category": "対応あり",
    "linked_at": "2026-07-19T06:00:00Z"
  }
}
```

- `source`：`"matching_engine"`（既存照合結果から自動導出）／`"manual"`（人間が個別に対応付けた場合）／`"ambiguous_trace_id"`（`trace_id`重複を検出、`shadow_mode_integration_design.md` §3.2）。
- `match_method`/`match_confidence`：`source==="matching_engine"`の場合、`calcPairMatch()`が返した値をそのまま転記する（`exact`/`code`/`model`/`synonym`/`fuzzy`/`vector`/`tfidf`/`tokenJaccard`）。テキスト類似度スコアであり、数量が満たされているかとは無関係であることに注意（誤解を招くフィールド名を避けるため、あえて`confidence`ではなく`match_confidence`という名前にしている）。
- `review_category`：既存UIの「分類」列の値（`未レビュー`/`対応あり`/`部分対応`/`要確認`/`誤対応`/`未対応`/`対象外`）をそのまま参照用に持つ（このsidecarが上書きすることはない。読み取り専用の参照）。

### 6. `requirement_analysis` / `actual_analysis`（数量抽出＋意味候補。confirmedフィールドを持たない）

`quantity-annotation/1.0-rc1`（`shadow_mode_integration_design.md` §2.1）の`analyses[]`の1件をそのまま転記する。

```json
{
  "requirement_analysis": {
    "quantity_id": "q-7e2f9a01",
    "source_field": "source_raw_text",
    "occurrence_index": 0,
    "source_span": null,
    "content_hash": "a1b2c3d4",
    "quantity": {
      "source_text": "12 kW",
      "kind": "interval",
      "lower": { "value": 12, "inclusive": true },
      "upper": null,
      "unit": { "source": "kW", "canonical": "kW", "dimension": "power",
                 "standard_ref": { "standard": "JIS Z 8000-4", "category": "mechanics" } },
      "condition_candidates": [
        { "source_text": "50 °C", "quantity": { "kind": "interval",
            "lower": { "value": 50, "inclusive": true }, "upper": { "value": 50, "inclusive": true } },
          "unit": { "source": "°C", "canonical": "degC", "dimension": "temperature",
                     "standard_ref": { "standard": "JIS Z 8000-5", "category": "thermodynamics" } },
          "confidence": 0.7 }
      ],
      "extraction": { "confidence": 0.95, "warnings": [] }
    },
    "semantics_candidates": [
      { "value": "acceptable_region", "confidence": 0.6,
        "evidence": [ { "type": "keyword", "weight": 0.45 }, { "type": "quantity_shape", "weight": 0.15 } ] },
      { "value": "unknown", "confidence": 0.15,
        "evidence": [ { "type": "baseline", "weight": 0.15 } ] }
    ]
  }
}
```

`actual_analysis`も同型（`実測`側）。**このセクションは`quantity-annotation/1.0-rc1`の生出力であり、`confirmed`フィールドを持たない**（候補は候補のまま、確定は`review`セクションでのみ行う、という1節原則2の直接的な実装）。`content_hash`は`shadow_mode_integration_design.md` §3.3の取り違え・陳腐化検出にそのまま使う（比較レコード組み立て時点の再計算値と突き合わせる）。

### 7. `mapping`（設計特性対応。候補配列から単一結論への縮約過程を明示する）

初版は単一の`concept_id`を直接持つ設計だったが、`generatePropertyCandidates()`（`semantic_mapping_prototype.js` 484行目）は候補の配列を返すため、複数候補がある場合にどれを採用するかの規則が必要だった。`evaluateAutoApplicable()`が`requirementCandidates`/`actualCandidates`に既に適用している「上位候補と次点候補の差（`marginOf()`）が閾値以上かどうか」という判定パターンを、`property_candidates`にもそのまま適用する（`shadow_mode_integration_design.md` §7）。

```json
{
  "mapping": {
    "status": "resolved",
    "concept_id": "performance.cooling_capacity",
    "confidence": 0.9,
    "margin": 0.55,
    "candidates": [
      { "concept_id": "performance.cooling_capacity", "confidence": 0.9, "evidence": ["単位次元一致: power", "周辺語: 冷房能力"] },
      { "concept_id": "performance.heating_capacity", "confidence": 0.35, "evidence": ["単位次元一致: power"] }
    ],
    "source": "generatePropertyCandidates",
    "confirmed": false
  }
}
```

- `status`：`"resolved"`（上位候補と次点候補の差が閾値`AUTO_APPLICABLE_THRESHOLDS.margin`以上）または`"ambiguous"`（差が閾値未満、または候補が1件以下）。
- `status: "ambiguous"`の場合、`concept_id`は`null`、`margin`は算出できた値のみ入れる（候補0件なら`null`）。この場合、`automation.auto_applicable`の計算へは進まず、`fail_reasons`に`"設計特性の対応が一意に決まらない"`を追加する（8節）。
- `candidates`：`generatePropertyCandidates()`の全候補を保持する（縮約前の情報を消さない。監査・再レビュー用）。
- `source`：本体統合時は`generatePropertyCandidates()`の実出力を使う（`CONCEPT_DICTIONARY`・`groupByTopConcept()`はHVACサンプル限定のたたき台であり、本体の概念辞書は別途用意する必要がある、`baseline_v1_handoff.md` §8末尾の注記を参照）。

この`margin`ベースの縮約を使うには、`evaluateAutoApplicable()`のシグネチャを`propertyConfidence`（スカラー）から`propertyCandidates`（配列）へ変更する必要がある（プロトタイプ側の未実装事項、`shadow_mode_integration_design.md` §7・§8に記録）。

### 8. `automation`（comparisonMode候補導出＋安全ゲート。ここで初めて「比較してよいか」を判定する）

```json
{
  "automation": {
    "comparison_mode_candidate": {
      "value": "point_in_region",
      "confidence": 0.6,
      "derived_from": { "requirement_semantics": "acceptable_region", "actual_semantics": "achieved_point" },
      "confirmed": false
    },
    "auto_applicable": {
      "applicable": true,
      "reasons": [
        "comparison_mode確信度0.60が閾値0.4以上",
        "要求側候補の差0.45が閾値0.2以上",
        "実仕様側候補の差0.60が閾値0.2以上",
        "否定根拠なし", "抽出警告なし",
        "設計特性の対応が一意に決まっている(margin 0.55が閾値0.2以上)"
      ],
      "fail_reasons": []
    }
  }
}
```

`deriveComparisonModeCandidate()`・`evaluateAutoApplicable()`の出力をそのまま転記する。`baseline_v1_handoff.md` §4の安全条件は、すべてこの`auto_applicable.applicable`の計算過程で保証される。**このセクションのどのフィールドも`confirmed: true`にはならない**（`comparison_mode_candidate.confirmed`は常に`false`で生成され、書き換えは行わない。人間確認は`review`セクションで別に記録する）。

### 9. `comparison`（数値比較結果。`automation.auto_applicable.applicable===true`の場合のみ存在）

```json
{
  "comparison": {
    "comparable": true,
    "provisional": true,
    "comparison_mode": "point_in_region",
    "assumptions": ["同じ設計特性として選択済み", "同じ運転条件", "単位換算不要"],
    "satisfied": true,
    "lowGap": 0.5,
    "highGap": null,
    "boundaryMismatch": { "lower": false, "upper": false },
    "extractionWarnings": []
  }
}
```

`coverageGap()`の出力をそのまま転記する。`automation.auto_applicable.applicable === false`の場合、このフィールドは`null`とする（理由は`automation.auto_applicable.fail_reasons`側だけを参照させる）。`provisional: true`は常にこの値のまま自動生成され、`review.confirmed`とは独立している。

### 10. `review`（人間確認状態。確認範囲を明示する）

初版は`confirmed: true/false`の単一フラグだったが、これは「何を確認したか」を区別できないという問題があった（例：`mapping`の対応付けだけを確認し、`comparison.satisfied`の妥当性はまだ見ていない、という状態を表現できない）。`confirmed_targets`で確認済みの範囲を明示する。

```json
{
  "review": {
    "status": "unreviewed",
    "confirmed": false,
    "confirmed_targets": [],
    "reviewer": null,
    "reviewed_at": null,
    "verdict": null,
    "note": null
  }
}
```

- `status`：`"unreviewed"` / `"reviewed"` / `"overridden"`のいずれか。
- `confirmed_targets`：確認済みの対象を列挙する配列。取り得る値は`"mapping"`（`mapping.concept_id`の妥当性を確認済み）／`"comparison_mode"`（`automation.comparison_mode_candidate.value`の妥当性を確認済み）／`"satisfied"`（`comparison.satisfied`の妥当性を確認済み）。空配列は「まだ何も確認していない」ことを表す。
- `verdict`：人間が下した最終判断。既存UIの「分類」語彙とは別の語彙にする（`relationship.review_category`はA-Bペアの対応可否についての語彙であり、`review.verdict`は「この数量比較結果を採用してよいか」についての語彙のため、意味が異なる）：`"accept"`（`comparison.satisfied`をそのまま採用）／`"override_satisfied"`（人間が満たすと判断）／`"override_unsatisfied"`（人間が満たさないと判断）／`"not_applicable"`（この比較自体が無意味と判断）。
- `confirmed`：`confirmed_targets`が`["mapping", "comparison_mode", "satisfied"]`の3つ全てを含む場合のみ`true`にする（部分確認だけでは`true`にしない）。**この`confirmed`は、既存プロジェクトの「`confirmed`（人間確認済み）と`auto_applicable`（自動適用安全）は独立したフィールド」という原則そのものの実装であり、`automation`セクションのどのフィールドとも連動しない。**

## 11. 完全な具体例（実行済みの実データから機械的に変換）

`baseline_v1_example_pipeline_output.json`（実行確認済み、`baseline_v1_handoff.md` §9）の内容を、本スキーマへそのまま変換した例：

```json
{
  "schema_version": "trace-comparison/1.0-rc1",
  "generated_at": "2026-07-19T06:30:00Z",
  "generator": { "tool": "quantity_extraction_prototype.js + semantic_mapping_prototype.js", "version": "v2.13 / v2.19" },
  "source": {
    "requirement_file": "JSON_A_customer_requirements_trace.json",
    "actual_file": "JSON_B_design_review_trace.json"
  },
  "provenance": {
    "requirement_dataset_signature": "QA:9f1c2ab0:N4",
    "actual_dataset_signature": "QA:2e7bb114:N5",
    "matching_dataset_signature": "DS:4b6ad0e9:A4:B5",
    "ruleset_version": {
      "unit_defs": "v2.13", "semantics_rules": "v2.19",
      "auto_applicable_thresholds": { "modeConfidence": 0.4, "margin": 0.2, "propertyConfidence": 0.7 }
    }
  },
  "not_analyzed": [],
  "comparisons": [
    {
      "comparison_id": "req-cooling-capacity::design-use-temperature::q-7e2f9a01::q-3c8d5b12",
      "requirement_ref": { "trace_id": "req-cooling-capacity", "matcher_id": "req-cooling-capacity" },
      "actual_ref": { "trace_id": "design-use-temperature", "matcher_id": "5", "source_row": 5 },
      "quantity_pair_id": "q-7e2f9a01::q-3c8d5b12",
      "relationship": {
        "source": "matching_engine", "match_method": "fuzzy", "match_confidence": 0.72,
        "review_category": "対応あり", "linked_at": "2026-07-19T06:00:00Z"
      },
      "requirement_analysis": {
        "quantity_id": "q-7e2f9a01", "source_field": "source_raw_text", "occurrence_index": 0,
        "source_span": null, "content_hash": "a1b2c3d4",
        "quantity": {
          "source_text": "12 kW", "kind": "interval",
          "lower": { "value": 12, "inclusive": true }, "upper": null,
          "unit": { "source": "kW", "canonical": "kW", "dimension": "power",
                     "standard_ref": { "standard": "JIS Z 8000-4", "category": "mechanics" } },
          "condition_candidates": [
            { "source_text": "50 °C",
              "quantity": { "kind": "interval", "lower": { "value": 50, "inclusive": true }, "upper": { "value": 50, "inclusive": true } },
              "unit": { "source": "°C", "canonical": "degC", "dimension": "temperature",
                         "standard_ref": { "standard": "JIS Z 8000-5", "category": "thermodynamics" } },
              "confidence": 0.7 }
          ],
          "extraction": { "confidence": 0.95, "warnings": [] }
        },
        "semantics_candidates": [
          { "value": "acceptable_region", "confidence": 0.6,
            "evidence": [ { "type": "keyword", "weight": 0.45 }, { "type": "quantity_shape", "weight": 0.15 } ] },
          { "value": "unknown", "confidence": 0.15, "evidence": [ { "type": "baseline", "weight": 0.15 } ] }
        ]
      },
      "actual_analysis": {
        "quantity_id": "q-3c8d5b12", "source_field": "検討結果", "occurrence_index": 0,
        "source_span": null, "content_hash": "9a8b7c6d",
        "quantity": {
          "source_text": "12.5 kW", "kind": "interval",
          "lower": { "value": 12.5, "inclusive": true }, "upper": { "value": 12.5, "inclusive": true },
          "unit": { "source": "kW", "canonical": "kW", "dimension": "power",
                     "standard_ref": { "standard": "JIS Z 8000-4", "category": "mechanics" } },
          "condition_candidates": [
            { "source_text": "50 °C",
              "quantity": { "kind": "interval", "lower": { "value": 50, "inclusive": true }, "upper": { "value": 50, "inclusive": true } },
              "unit": { "source": "°C", "canonical": "degC", "dimension": "temperature",
                         "standard_ref": { "standard": "JIS Z 8000-5", "category": "thermodynamics" } },
              "confidence": 0.7 }
          ],
          "extraction": { "confidence": 0.95, "warnings": [] }
        },
        "semantics_candidates": [
          { "value": "achieved_point", "confidence": 0.75,
            "evidence": [ { "type": "quantity_shape", "weight": 0.3 }, { "type": "column_role", "weight": 0.05 }, { "type": "keyword", "weight": 0.4 } ] },
          { "value": "unknown", "confidence": 0.15, "evidence": [ { "type": "baseline", "weight": 0.15 } ] }
        ]
      },
      "mapping": {
        "status": "resolved", "concept_id": "performance.cooling_capacity", "confidence": 0.9, "margin": 0.55,
        "candidates": [
          { "concept_id": "performance.cooling_capacity", "confidence": 0.9, "evidence": ["単位次元一致: power", "周辺語: 冷房能力"] },
          { "concept_id": "performance.heating_capacity", "confidence": 0.35, "evidence": ["単位次元一致: power"] }
        ],
        "source": "generatePropertyCandidates", "confirmed": false
      },
      "automation": {
        "comparison_mode_candidate": {
          "value": "point_in_region", "confidence": 0.6,
          "derived_from": { "requirement_semantics": "acceptable_region", "actual_semantics": "achieved_point" },
          "confirmed": false
        },
        "auto_applicable": {
          "applicable": true,
          "reasons": [
            "comparison_mode確信度0.60が閾値0.4以上", "要求側候補の差0.45が閾値0.2以上",
            "実仕様側候補の差0.60が閾値0.2以上", "否定根拠なし", "抽出警告なし",
            "設計特性の対応が一意に決まっている(margin 0.55が閾値0.2以上)"
          ],
          "fail_reasons": []
        }
      },
      "comparison": {
        "comparable": true, "provisional": true, "comparison_mode": "point_in_region",
        "assumptions": ["同じ設計特性として選択済み", "同じ運転条件", "単位換算不要"],
        "satisfied": true, "lowGap": 0.5, "highGap": null,
        "boundaryMismatch": { "lower": false, "upper": false }, "extractionWarnings": []
      },
      "review": {
        "status": "unreviewed", "confirmed": false, "confirmed_targets": [], "reviewer": null,
        "reviewed_at": null, "verdict": null, "note": null
      }
    }
  ]
}
```

`match_method`/`match_confidence`/`linked_at`／`provenance`内の各`dataset_signature`／`quantity_id`／`content_hash`／`mapping.candidates`は、実際の照合結果・ハッシュ計算から取得する値であるため、`baseline_v1_example_pipeline_output.json`には存在しない仮の値を補って例示している（実データではないことに注意）。それ以外のフィールドはすべて実行確認済みの値をそのまま転記した、無損失の変換であることを確認した。

## 12. 4区分UI classification（人間確認の最小化）との対応

以前提案された4区分（確信度に応じたUI表示の出し分け）は、本スキーマの`automation.auto_applicable.applicable`と`mapping.status`／`mapping.confidence`の組から導出できる：

| UI区分 | 条件 |
|---|---|
| 自動非表示（確認不要） | `applicable===false` かつ（`mapping.status==="ambiguous"` または `mapping.confidence < 0.4`） |
| 参考表示のみ | `applicable===false` かつ `mapping.status==="resolved"` かつ `mapping.confidence >= 0.4`（対応はありそうだが比較モードが決まらない） |
| 確認推奨 | `applicable===true`（自動比較はしたが`review.confirmed`は常にfalseから始まる） |
| 優先確認 | `applicable===true` かつ `comparison.satisfied===false`（不適合の可能性、優先度を上げる） |

このUI区分自体はスキーマのフィールドではなく、上記フィールドからの派生値（表示層の責務）とする。スキーマに`ui_priority`のような専用フィールドを持たせないのは、1節原則2（候補は生成してよいが確定はしない）を守るため——UI優先度は表示のたびに再計算すればよく、永続化して確定させる理由がない。

## 13. 未確定・次工程

- **shadow-mode挿入点**：`shadow_mode_integration_design.md`で設計済み（挿入点3箇所、いずれも既存コードへの追加のみ）。同資料§9に、`-rc1`から正式版への昇格条件（回帰テスト・シグネチャ変更・実データ確認・未解決事項の整理）を記録した。
- **ファイル命名・保存場所の規約**：`{requirement_file}_{actual_file}_comparison.json`のような命名規則、保存先ディレクトリは未検討。
- **スキーマのバージョニング方針**：`schema_version`のインクリメント規則（フィールド追加は何もしなくてよいか、破壊的変更のみ上げるか）は未検討。
- **`review`セクションの永続化先**：既存のレビュー状態が`localStorage`（`v11_trace_review_store`）を一次保存先としている（`baseline_v1_handoff.md` §7.2.4）のに対し、本スキーマの`review`はファイル内にフィールドとして持たせる設計にした。この不一致（一次保存先が二重に存在する）を統合時にどう扱うかは`shadow_mode_integration_design.md` §8で未解決のまま記録している。
- **`evaluateAutoApplicable()`のシグネチャ変更**：7節の`mapping`縮約に必要な`propertyCandidates`配列対応は、プロトタイプ側（`semantic_mapping_prototype.js`）の未実装事項。
