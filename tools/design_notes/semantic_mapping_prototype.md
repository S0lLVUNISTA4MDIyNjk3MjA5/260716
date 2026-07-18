# 検討文書：工程3（意味対応付けの候補生成）たたき台プロトタイプ

**位置づけ:** 将来の自動化方針に関する検討メモ。**未実装・未決定**（本ツール群のHTMLには未統合）。他AI・他メンバーによるレビューを想定した論点整理。
**作成日:** 2026-07-18
**関連文書:** `tools/design_notes/abstraction_levels.md`（6工程モデル）、`tools/design_notes/quantity_extraction_prototype.md`（工程4a。本文書はその続きとして工程3を扱う）、`tools/design_notes/quantity_extraction_prototype_review.md`（0.3節で工程3への着手を提案）
**付属ファイル:** `tools/design_notes/semantic_mapping_prototype.js`（Node.js、依存ライブラリなし。工程4aを`require`する。`node semantic_mapping_prototype.js`で実行可能）

---

## 1. 経緯

`quantity_extraction_prototype_review.md`の追加レビュー（0.3節）で、工程4a（数量抽出）を基準版として固定し、次は工程3「意味対応付けの候補生成」へ進むことが提案された。あわせて、候補は確定せず、`property_candidates`として提示するという最小プロトタイプのJSON例が示された。

これを受け、`samples/hvac_trace_sample_small/`の実データ（PDF要求4件、Excel設計項目5件×2列）を使って、実際に動くたたき台を作成した。

レビュー提案からの変更点は次の2つ。

1. `property_candidates`内の`quantity`を表示用文字列（例:`"50℃"`）ではなく、工程4aが生成した構造化オブジェクトへの参照（`quantity_record`）に変更した。文字列へ戻すと、境界包含・出典・確信度などの情報が失われるため。
2. `role`の語彙を、レビュー例の2種類（`condition`/`requirement_value`）から、実データに合わせて`requirement`（PDF要求）／`baseline_design`（Excel標準機種情報）／`resolved_design`（Excel検討結果）／`condition`（条件節）の4種類へ拡張した。`abstraction_levels.md`4章の温度比較（要求・標準機種・検討結果を独立に判断する）を再現するには、この3区分が最低限必要だった。

## 2. スキーマ

```js
{
  source: "Excel 冷房能力/検討結果",
  quantity_ref: { index: 0, source_text: "12.5 kW", isCondition: false },
  quantity_record: { /* 工程4aの完全な構造化オブジェクト。文字列化しない */ },
  property_candidates: [
    { concept_id: "performance.cooling_capacity", label: "冷房能力", confidence: 0.99,
      evidence: ["単位次元一致: power", "タグ: 冷房能力"] },
  ],
  role_candidate: { role: "resolved_design", confidence: 0.85, evidence: ["出典列: 検討結果"] },
  confirmed: false,
}
```

概念候補（`property_candidates`）は、次の3種類の根拠を独立に積み上げるスコアリングで生成する（レビュー提案の「保持すべき根拠」に対応）。

- 単位次元一致（`unit.dimension`が概念辞書の`expected_dimension`と一致）
- 周辺語一致（列名・章節タイトル等の近傍テキストに概念辞書のキーワードが含まれる）
- タグ一致（案件の統制タグ辞書と一致）

役割候補（`role_candidate`）は、条件節由来かどうかを最優先で判定し、次に文書側（PDF=A／Excel=B）と出典列（標準機種情報／検討結果）から推定する。

## 3. 実データでの検証結果

PDF要求4件・Excel設計項目5件×2列＝14テキストから、概念候補と役割候補を生成し、`concept_id`が一致するものを自動的にグルーピングした。

| concept_id | 件数 | 内訳 |
|---|---|---|
| environment.ambient_operating_temperature | 6 | requirement×1, condition×3, baseline_design×1, resolved_design×1 |
| performance.cooling_capacity | 3 | requirement×1, baseline_design×1, resolved_design×1 |
| power_supply.voltage | 3 | requirement×1, baseline_design×1, resolved_design×1 |
| power_supply.frequency | 3 | requirement×1, baseline_design×1, resolved_design×1 |
| acoustics.operating_noise | 3 | requirement×1, baseline_design×1, resolved_design×1 |
| maintenance.access_space | 2 | baseline_design×1, resolved_design×1（PDF側に対応要求なし） |

**タグ辞書・様式プロファイルを一切使わず**、PDF/Excelの生テキストと単位次元・案件タグだけから、6つの設計特性グループが自動生成された。これは、これまでの検証（`verification_report.md`）で確認した「タグ辞書・様式プロファイルを人間が事前に用意しないと照合が成立しない」という制約に対し、**候補生成の入り口だけは自動化できる**ことを実データで示した最初の成果である。

## 4. 工程5への自動橋渡し：成功したケースと、新たに見つかった重大な問題

概念グループごとに、`role=requirement`のレコードと`role=baseline_design`/`resolved_design`のレコードを自動抽出し、工程4aの`coverageGap()`をそのまま適用した。

### 4.1 成功：温度（範囲 vs 範囲の比較）

```text
要求 vs 標準機種: satisfied=false, highGap=10   → 「10℃不足」
要求 vs 検討結果: satisfied=true,  highGap=0    → 「充足」
```

人間が手作業でPDF・Excelを見比べて対応付けていた組み合わせを、**タグ・プロファイルの事前準備なしに、概念候補の自動グルーピング経由で再現できた**。`abstraction_levels.md`で目標としていた「意味対応付けの候補生成」の最小限の実演になっている。

### 4.2 新たに発見した問題：`coverageGap()`の比較方向が、片側閾値要求では逆転する

グルーピングによって、これまで人間が選んだ1例（温度）だけでなく、**5つの概念グループすべてに`coverageGap()`を自動適用**した結果、温度以外のほぼ全てのケースで疑わしい、あるいは明確に誤った結果が出た。

**再現手順**（`semantic_mapping_prototype.js`の完了条件チェック内にも検出用アサーションとして常設）：

```js
const req = extractQuantities('冷房能力12 kW以上を確保すること')[0];       // 要求: 12kW以上(片側閾値)
const farExceeding = extractQuantities('冷房能力999 kW')[0];              // 設計値: 999kW(要求を大幅に超過)
coverageGap(req, farExceeding);
// → satisfied: false  （999kWは明らかに「12kW以上」を満たすはずなのに、未充足と誤判定される）
```

**原因**：`coverageGap()`は「実仕様の値の範囲が、要求の範囲を覆っているか（actual ⊇ requirement）」という1つの比較方向だけをハードコードしている。

- 温度のように、要求も実仕様も両方とも**達成可能な範囲**を表す場合（「0〜50℃で動作できること」という要求に対し、「設計は0〜40℃までしか対応しない」という実仕様が、要求範囲を覆っているか）は、この方向で正しい。
- しかし冷房能力・電圧・周波数・騒音のように、要求が**片側閾値**（「12kW以上」＝下限だけを定め、上限には触れていない）で、実仕様が**単一の達成値**（設計はちょうど何kWを実現するか）である場合、必要なのは逆方向の比較（「達成値が、要求の許容範囲に収まっているか＝requirement ⊇ {actual}」）である。コードは`if (!rq.upper) return !ac.upper;`のように「要求に上限がなければ、実仕様にも上限がないことを要求する」というロジックになっており、これは範囲同士の比較では正しいが、達成値との比較では常に破綻する（達成値は必ず具体的な1点＝上下限を持つため）。

**影響範囲**：今回の6グループ中、範囲 vs 範囲の比較が成立するのは温度だけで、残り4グループ（冷房能力・電圧・周波数・騒音）は全て「片側閾値要求 vs 達成値」または「等号要求 vs 達成値」であり、**このバグの影響を受ける組み合わせの方が実データ上は多数派**だった。

## 5. 対応方針の相談

この問題は、コードの一行修正では済まない。比較の方向は、**要求側が「範囲（capability）」なのか「閾値（threshold）」なのか「厳密一致（exact）」なのかによって変わる**ため、修正には次のいずれか（またはその組み合わせ）の設計判断が要る。

- (a) 工程4aの数量抽出結果自体に、要求の種類（範囲／閾値／厳密一致）を推定するフラグを追加し、`coverageGap()`がそれに応じて比較方向を切り替える。
- (b) 工程3（本プロトタイプ）が、`role=requirement`のレコードに対し「この要求は範囲型か閾値型か」を追加の候補情報として持たせ、比較関数へ渡す。
- (c) `coverageGap()`を1つの関数に統合せず、範囲用・閾値用・厳密一致用で比較関数を分け、工程3のrole/構造から呼び分ける。

いずれも工程4a単体、工程3単体では閉じない、両工程にまたがる設計判断であるため、実装前に方針を確認したい。

## 6. 完了条件チェック

`node semantic_mapping_prototype.js`で次を確認できる（9件中9件成功）。

- [x] 温度概念グループが生成される
- [x] 温度概念グループにrequirement/baseline_design/resolved_designが揃う
- [x] 自動グルーピング経由で「標準機種は10℃不足」を再現する（範囲vs範囲は正しく動く）
- [x] 自動グルーピング経由で「検討結果は充足」を再現する（範囲vs範囲は正しく動く）
- [x] 冷房能力の概念グループも生成される
- [x] 冷房能力/検討結果が12.5kWのまま破損せず伝わる（工程4a v2.3で修正した不具合の回帰確認）
- [x] 候補は全て`confirmed:false`のまま（自動確定しない）
- [x] `quantity_record`は文字列でなく工程4aの構造化オブジェクト参照のまま
- [x] 【既知の不具合・未修正】999kWが12kW以上の要求を満たすはずが、現行`coverageGap()`は`false`を返す（4.2節の不具合を検出し続けるための常設アサーション。修正が入ればこの行はFAILに変わる想定）

## 7. 次の検討候補

1. **5章の比較方向の設計判断**（最優先。これを決めないと工程5の自動化が誤った結果を出し続ける）
2. 概念辞書（`CONCEPT_DICTIONARY`）の運用方法：案件ごとの手動メンテナンスか、タグ辞書からの自動生成か
3. 概念候補の確信度スコアリング（現在は単位次元0.4+周辺語0.35+タグ0.25の単純加算）の妥当性検証。より多くの実データでの調整が必要
4. `unknown`ロール（出典列が標準機種情報・検討結果のいずれでもない場合）の扱い
5. 条件候補（`role=condition`）を、意味対応付けの観点でどう活用するか（現状はグルーピングに参加するだけで、比較には使われていない）
