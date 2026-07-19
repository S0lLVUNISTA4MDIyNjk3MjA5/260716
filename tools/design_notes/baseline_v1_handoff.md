# 基準版v1 引き継ぎ資料

工程4a（数量抽出）・工程3（意味対応付け）プロトタイプを「実験途中」から「再現可能な基準版」として固定するための資料。次工程（本体JSONスキーマ設計・シャドーモード統合）を担当するAI・人間への引き継ぎを目的とする。

## 1. 基準コミット

コードと引き継ぎ資料は別のコミットで追加されたため、2つのSHAを区別して記録する。

- **`code_baseline_sha`**（プロトタイプのコード・テスト・実データコーパスが完成した時点、以降変更なし）: `b55b5218cbe4c1b632cadcbf5125511d659a834e`（「Freeze UNIT_DEFS as truly immutable master data (v2.13)」）
- **`handoff_snapshot_sha`（変更履歴）**: 下記コマンドは「現在のブランチ上で、この文書を最後に変更したコミット」を返すため、この文書自体を将来編集すると値が変わる（＝厳密には「固定」ではない）。**基準版v1が完成と判断された時点のコミットは`f0b8e7f`（「Drop baseline-v1 tag reference: push blocked by this session's egress policy」）に固定で記録する。** それ以降の本資料の更新は、下記コマンドで都度最新のものを追える。
  ```bash
  git log -1 --format=%H -- tools/design_notes/baseline_v1_handoff.md
  ```
- **ブランチ**: `claude/pdf-excel-json-overview-pigbne`
- **タグでの固定について**: 当初`baseline-v1`タグを付与しリモートへpushする予定だったが、このセッションの送信先ポリシーにより`git push origin refs/tags/baseline-v1`が`403`で拒否された（ブランチへのpushは許可されているが、タグは対象外の模様。このセッション特有の制約であり、次工程の担当者の環境では`git tag baseline-v1 <code_baseline_sha>`が普通に通る可能性が高い）。そのため、本資料では上記2つのSHAを直接参照する方式とし、タグへの依存はしていない。
- **確認事項**: この資料を作成した時点で`git status`はクリーン（未コミットの変更なし）。次工程の担当者は、`code_baseline_sha`をチェックアウトすればコードとテストを再現できる。

## 2. 動作確認済み環境

- **Node.js**: v22.22.2（動作確認環境。プロトタイプは外部ライブラリに依存しないため、ES2018以降のlookbehind正規表現(`(?<!...)`)をサポートするNode 10+であれば動作すると推定されるが、v22.22.2以外では未検証）
- **依存パッケージ**: なし（`package.json`は存在しない。全プロトタイプが`require()`のみで完結する自己完結スクリプト）
- **実行方法**: `node tools/design_notes/<ファイル名>.js`

## 3. テストスイート一括実行コマンドと期待件数

```bash
node tools/design_notes/quantity_extraction_prototype.js    # 期待: 64件中64件成功
node tools/design_notes/semantic_mapping_prototype.js       # 期待: 86件中86件成功
node tools/design_notes/interval_semantics_fuzz_test.js     # 期待: 6件中6件成功
node tools/design_notes/vocabulary_negation_fuzz_test.js    # 期待: 6件中6件成功
node tools/design_notes/real_corpus_validation.js           # 期待: 3件中3件成功
```

一括実行・件数確認:

```bash
for f in quantity_extraction_prototype.js semantic_mapping_prototype.js \
         interval_semantics_fuzz_test.js vocabulary_negation_fuzz_test.js \
         real_corpus_validation.js; do
  echo "=== $f ==="
  node tools/design_notes/$f 2>&1 | tail -1
done
```

いずれのスクリプトも、`[FAIL]`が0件かつ末尾行が「◯件中◯件成功 / 0件失敗」であることを確認する。5スクリプトとも終了コードでの成否判定はしていない（`console.log`の出力を見て判断する設計）ため、CI化する場合は出力の`0件失敗`をパースするか、各ファイルの`assertions`配列を関数として切り出す改修が必要。

## 4. 自動判定の安全条件（統合後も回帰テストとして守るべき不変条件）

v2.9〜v2.19の7回の外部レビュー往復・2種類の摂動テスト（5,632件＋3,616件の合成ミュータント）・実データ検証（105文・147数量）を通じて確立し、実証してきた不変条件。本体統合後もこれらは形を変えずに維持されるべきであり、崩す変更を行う場合は摂動テスト・実データ検証の再実行で裏付けを取ること。

1. **構造的根拠だけではauto_applicableにならない**（8.11節）：数量の形（点/範囲）や列名だけでは、`evaluateAutoApplicable()`が`applicable:true`を返さない。セル内容に基づく肯定語キーワードまたは修飾語（最大/最小）が必須。
2. **unknownを含む組み合わせは比較しない**（`deriveComparisonModeCandidate()`）：要求側・実仕様側どちらかの最上位候補が`unknown`なら、comparisonMode候補は導出されない。
3. **定義されていない意味ペアは比較しない**（`COMPARISON_MODE_DERIVATION_TABLE`）：`required_capability_domain × achieved_point`（v2.10で除外）、`* × aggregated_representative_value`（v2.18で意図的に不登録）等、明示的にテーブルへ登録した組み合わせ以外はcomparisonModeを導出しない。
4. **抽出警告があれば自動比較しない**（`evaluateAutoApplicable()`の`extractionWarningsCount`）。
5. **統計的集約値（代表値/平均値/中央値/最頻値）は単一達成値として比較しない**（8.21節）：`aggregated_representative_value`は`COMPARISON_MODE_DERIVATION_TABLE`に一切登録されていないため、要求側とのペアで常にcomparisonMode候補なし＝`applicable:false`になる。

この5条件は、`interval_semantics_fuzz_test.js`・`vocabulary_negation_fuzz_test.js`・`real_corpus_validation.js`の3スイートが継続的に検証している内容そのものである。本体統合時にロジックを移植・改修する際は、この3スイートも一緒に移植し、CI等で回し続けることを推奨する。

## 5. 次工程で変更してよい部分・変更してはいけない部分

**変更してよい（設計判断の余地がある）**：
- JSONスキーマの形（フィールド名・ネスト構造）そのもの。プロトタイプの戻り値はそのまま本体JSONの形と一致させる必要はない。
- `AUTO_APPLICABLE_THRESHOLDS`の具体的な数値（`modeConfidence: 0.4`等）。実案件での誤昇格率測定の結果次第で調整する前提。
- UI側の確認要否の出し分け（今回提案された4区分の運用等）。

**変更してはいけない（安全性の根拠が失われる）**：
- 「構造的根拠（quantity_shape/column_role）の重みだけでは、`achieved_point`等の確信度が自動適用閾値を超えない」という非対称設計そのもの（8.11節）。個々の重み数値は調整可としても、この非対称性を壊す変更（例：構造的根拠に0.4以上の重みを与える）は、摂動テストで検出されるはずの誤昇格を再び許すことになる。
- `COMPARISON_MODE_DERIVATION_TABLE`への安易な追加。追加する場合は、なぜそのペアが安全に比較可能と言えるかの根拠（v2.10〜v2.18の除外判断の記録）を`semantic_mapping_prototype.md`と同水準で残すこと。
- `NEGATIVE_KEYWORD_RULES`の適用範囲（`ctx.side==='B' && !ctx.isConditionValue`のみ）。

## 6. 既知の限界

**コード側（プロトタイプの設計上の限界）**：
- 単位辞書は10単位のみ対応（℃/kW/V/Hz/dB(A)/mm/MPa/kPa/Pa/kVA）。実データ検証（国交省仕様書）では、これで数値+単位を含む文の約95%（106/112件）をカバーできたが、A・L等の単一アルファベット単位、kgf/cm²等のSI以前の単位、CJK互換文字（㎡等）は未対応（詳細は5.14〜5.15節）。
- 要求側キーワード語彙は「とする」「なければならない」「とすること」「確保すること」「以下/以上とすること」「運転/使用/動作/対応できること」のみ。JIS Z 8301の「望ましい」（推奨事項）・「してもよい」（許容事項）は未対応（8.20節）。
- `occurrenceIndex`方式（同一セル内の同一表記の数量を区別する暫定策）は、工程4aの出力順序が原文の出現順序と一致することに暗黙に依存している（8.15節の設計上の制約）。
- `confidence`は統計的に較正された確率ではなく、ルール重みの単純加算値（`scoreSemantics()`のコメント参照）。

**データ側（実データ検証の限界）**：
- 実コーパスは1文書（国交省「公共建築工事標準仕様書」）のみ。JIS Z 8301の要求語彙拡張・単位拡張はこの1文書での検証に基づいており、他業種・他文体の文書での再現性は未検証。
- B側（実仕様側）の安全性は実データで確認済みだが、これは「この文書には達成値を示す語彙が実際には登場しなかった」ことも一因であり、`実測`等のキーワードが実際に登場する実データでの検証はまだ行っていない（合成テストでは確認済み）。

## 7. 本体（production HTML tools）との関係

**現状、本体には未統合**。`tools/`直下の4つの単体HTMLツール（`spec_to_json_conversion_tool_v1.18.html`・`excel_to_json_conversion_tool_v2.0.8.html`・`json_ab_trace_matching_tool_v12.1.15.html`・`json_ab_trace_matching_tool_lite_v1.5.html`、計31,752行）が実際に稼働している本体であり、`tools/design_notes/`配下のプロトタイプ群とは完全に独立したコードベースである。

調査した範囲で分かったこと：
- `spec_to_json_conversion_tool_v1.18.html`は、PDF→「通常文書JSON」（DocumentModel 2.0形式）への変換に加え、`json_ab_trace_matching_tool`向けの「照合用JSON」（フォーマット名`chapter-section-trace-v1`）を出力する機能を持つ（該当コード: 同ファイル2136行目以降`/* ================= knowledge_tool_v12向け照合用JSON出力 ================= */`）。
- この「照合用JSON」の各レコードは、`{id, content_hash, chapter_number, chapter_title, section_number, section_title, ...}`のような章・節単位の構造化テキスト情報を持つ。**`quantity`・`interval_semantics_candidates`・`comparisonMode`に相当するフィールドは、現状の本体スキーマには一切存在しない**。
- `json_ab_trace_matching_tool_v12.1.15.html`（12,355行）は、テキスト・タグベースの照合（信頼度スコアリング、ナレッジグラフ、トレースマトリクス）を行っており、数値の充足判定（`coverageGap()`相当の機能）は行っていない。

**この調査から言えること**：本体統合は「既存の数値比較フックに新ロジックを差し込む」作業ではなく、「本体のtrace record（chapter-section-trace-v1形式）に、数量・意味候補・比較結果を表す新しいフィールド群を追加する」設計作業になる。ユーザー提案の`schema_version: "trace-comparison/1.0"`は、既存の`chapter-section-trace-v1`とは別レイヤーの追加スキーマとして設計するか、`chapter-section-trace-v1`自体を拡張するかの判断が必要（この判断はまだ行っていない）。

**未実施の調査（次工程で必要）**：
- `excel_to_json_conversion_tool_v2.0.8.html`側の照合用JSON出力フォーマットの詳細（B側／実仕様側の対応する形）。
- `json_ab_trace_matching_tool_v12.1.15.html`のマッチングキー選定・信頼度スコアリングロジックの内部実装（照合エンジンの、テキスト一致とは別に数値比較を追加する余地の有無）。
- 実際に`spec_to_json_conversion_tool`・`excel_to_json_conversion_tool`を（ブラウザ上で）動かして、リアルな照合用JSON出力例を1件取得すること（本資料のNode.js実行環境では、ブラウザ依存のこれらのHTMLツールを直接実行できないため未取得）。

## 8. プロトタイプから本体へ移植する関数一覧

`quantity_extraction_prototype.js`（`module.exports`より）:
- `extractQuantities(text)` — 文中の数量表現を抽出する中核関数
- `coverageGap(requirement, actual, options)` — 数値の被覆判定
- `unitInfo(rawUnit)` — 単位の正規化・JIS Z 8000参照情報の取得
- `normalizeText1to1(text)` — 全角→半角の1:1正規化
- `isGenuinePoint(quantity)` / `isEmptyInterval(quantity)` — 区間の形の判定
- `UNIT_DEFS` — 単位マスターデータ（凍結済み、`standard_ref`付き）

`semantic_mapping_prototype.js`（`module.exports`より）:
- `generatePropertyCandidates(...)` / `inferRole(...)` — 設計特性・役割の候補生成
- `buildPropertyCandidateRecords(...)` — レコード単位の候補生成の統合
- `groupByTopConcept(...)` / `CONCEPT_DICTIONARY` — 概念グループ化（HVACサンプル限定のたたき台、本体統合時は要拡張）
- `generateIntervalSemanticsCandidates(record, ctx)` — 区間の意味候補生成（本資料6節の安全設計の中核）
- `deriveComparisonModeCandidate(requirementCandidates, actualCandidates)` — comparisonMode候補導出
- `evaluateAutoApplicable({...})` — 自動適用可否判定（安全ゲート）
- `autoCompareGroup(group)` — 概念グループ単位の自動橋渡し（デモ用、本体では別の粒度になる可能性が高い）
- `COMPARISON_MODE_DERIVATION_TABLE` — 導出テーブル（安全性の根拠そのもの、5節参照）

`CONCEPT_DICTIONARY`・`groupByTopConcept`・`autoCompareGroup`はHVACサンプル1件を前提としたデモ用の実装であり、本体統合時にそのまま使えるものではない（既存の本体照合エンジンが担う「どの要求とどの設計項目が対応するか」の判断とは別の粒度・目的で作られている）。

## 9. 具体的な入出力例（プロトタイプ側、実行確認済み、5段階パイプライン全段を含む）

要求文「周囲温度50 °Cにおいて、冷房能力12 kW以上を確保すること。」と実仕様文「周囲温度50 °Cで実測12.5 kW」（検討結果列）を、実際に現在のプロトタイプへ通した結果。3節に記載した5段階パイプライン（数量抽出→interval_semantics候補生成→comparisonMode候補導出→auto_applicable安全ゲート→数値比較）の**最終段（`coverageGap()`）まで到達させた結果**を示す。

```json
{
  "reqCands": [
    { "value": "acceptable_region", "confidence": 0.6,
      "evidence": [
        { "type": "keyword", "weight": 0.45 },
        { "type": "quantity_shape", "weight": 0.15 }
      ] },
    { "value": "unknown", "confidence": 0.15 }
  ],
  "actCands": [
    { "value": "achieved_point", "confidence": 0.75,
      "evidence": [
        { "type": "quantity_shape", "weight": 0.3 },
        { "type": "column_role", "weight": 0.05 },
        { "type": "keyword", "weight": 0.4 }
      ] },
    { "value": "unknown", "confidence": 0.15 }
  ],
  "modeCandidate": {
    "value": "point_in_region", "confidence": 0.6,
    "derived_from": { "requirement_semantics": "acceptable_region", "actual_semantics": "achieved_point" },
    "confirmed": false
  },
  "evalResult": {
    "applicable": true,
    "reasons": [
      "comparison_mode確信度0.60が閾値0.4以上",
      "要求側候補の差0.45が閾値0.2以上",
      "実仕様側候補の差0.60が閾値0.2以上",
      "否定根拠なし", "抽出警告なし",
      "設計特性の対応確信度0.90が閾値0.7以上"
    ]
  },
  "comparisonResult": {
    "comparable": true,
    "provisional": true,
    "comparison_mode": "point_in_region",
    "assumptions": ["同じ設計特性として選択済み", "同じ運転条件", "単位換算不要"],
    "satisfied": true,
    "lowGap": 0.5,
    "highGap": null,
    "boundaryMismatch": { "lower": false, "upper": false },
    "extractionWarnings": []
  },
  "fixtureAssumptions": {
    "property_mapping": {
      "concept_id": "performance.cooling_capacity",
      "confidence": 0.9,
      "source": "sample_fixture",
      "note": "設計特性対応付け部分は本例の対象外なので既知の仮定として付与。実際の値はgeneratePropertyCandidates()の出力を使う。"
    }
  }
}
```

**`fixtureAssumptions`について**：`evalResult`（`evaluateAutoApplicable()`）へ渡した`propertyConfidence: 0.9`は、この例では`generatePropertyCandidates()`を実際には呼び出さず、サンプル用に仮定した値である。工程3の設計特性対応付け（「この数量がどの概念[冷房能力等]を指すか」の判定）は本例の対象外としたため、この仮定を明示しておく。本体統合時に実際の`property_candidates`を使う場合は、`generatePropertyCandidates()`の出力から`confidence`を取得すること。

**`comparisonResult`について**：`evalResult.applicable === true`の場合のみ`coverageGap(reqRec, actRec, { comparisonMode: modeCandidate.value })`を呼び出し、`applicable === false`の場合は`{ comparable: false, reason: 'auto_applicable=false' }`を保存する（安全ゲートを通過しなかった照合は、数値比較そのものを行わない）。`lowGap`/`highGap`は要求の境界と実仕様値との差（3節参照）、`boundaryMismatch`は境界の包含/非包含（inclusive/exclusive）の食い違いを示す。`provisional: true`は、この結果が`confirmed`（人間確認済み）ではなく暫定であることを表す1節の原則そのものを反映している。

完全な出力（`quantity`・`unit.standard_ref`・`condition_candidates`等を含む）は`tools/design_notes/baseline_v1_example_pipeline_output.json`に保存済み。再現するコマンド：

```js
const { extractQuantities, coverageGap } = require('./tools/design_notes/quantity_extraction_prototype.js');
const { generateIntervalSemanticsCandidates, deriveComparisonModeCandidate, evaluateAutoApplicable } =
  require('./tools/design_notes/semantic_mapping_prototype.js');
// reqText/actTextを与えてextractQuantities→generateIntervalSemanticsCandidates→
// deriveComparisonModeCandidate→evaluateAutoApplicable→(applicableならば)coverageGap()の順に通す
```

ユーザー提案の`trace-comparison/1.0`スキーマにおける`requirement.interval_semantics_candidates`・`actual.interval_semantics_candidates`・`mapping.comparison_mode_candidate`・`automation`・`comparison`は、この出力の`reqCands`・`actCands`・`modeCandidate`・`evalResult`・`comparisonResult`にほぼ1:1で対応させられる（フィールド名の付け替えのみで済む見込みだが、実際のマッピング作業は未実施）。

## 10. 本資料の位置づけ

本資料は「今後の変更を禁止する」ものではなく、「ここまでの到達点と、その根拠となったテスト・実データを一箇所から追跡できるようにする」ためのものである。個々の設計判断の詳細・レビュー往復の経緯は、`quantity_extraction_prototype.md`・`quantity_extraction_prototype_review.md`・`semantic_mapping_prototype.md`の該当節（本資料中の節番号を参照）にすべて記録されている。
