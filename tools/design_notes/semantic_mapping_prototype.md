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

### 4.1 成功：温度（範囲 vs 範囲の比較）（※v2.6以降はcomparisonMode明示が前提。5.2節参照）

```text
要求 vs 標準機種: satisfied=false, highGap=10   → 「10℃不足」
要求 vs 検討結果: satisfied=true,  highGap=0    → 「充足」
```

人間が手作業でPDF・Excelを見比べて対応付けていた組み合わせを、**タグ・プロファイルの事前準備なしに、概念候補の自動グルーピング経由で再現できた**。`abstraction_levels.md`で目標としていた「意味対応付けの候補生成」の最小限の実演になっている。

ただし、この結果は`coverageGap(req, baseline, { comparisonMode: 'actual_covers_requirement' })`のように、温度が「対応可能領域」を表すという前提を明示的に渡した場合のものである。v2.6でこの前提が必須になった経緯は5.2節を参照。4章冒頭の自動橋渡しループ自体はこの前提を持たないため、mode未指定では`comparable:false`を返す（`quantity_extraction_prototype.js`を`node`で実行した際のコンソール出力で確認できる）。

### 4.2 発見した問題：`coverageGap()`の比較方向が、片側閾値要求では逆転する（v2.4で修正済み）

グルーピングによって、これまで人間が選んだ1例（温度）だけでなく、**3章で生成した6概念グループのうち、PDF側の要求(requirement)を含む5グループすべてに`coverageGap()`を自動適用**した（`maintenance.access_space`はPDF側に対応要求がないため比較対象外。3章の表参照）結果、温度以外のほぼ全てのケースで疑わしい、あるいは明確に誤った結果が出た。この問題は、下記5章の検討を経て工程4a（`quantity_extraction_prototype.js`）v2.4で修正した。以下は発見時の記録として残す。

**発見時の再現手順**（`semantic_mapping_prototype.js`の完了条件チェック内には、修正後の正しい挙動を検証する回帰テストとして残している）：

```js
const req = extractQuantities('冷房能力12 kW以上を確保すること')[0];       // 要求: 12kW以上(片側閾値)
const farExceeding = extractQuantities('冷房能力999 kW')[0];              // 設計値: 999kW(要求を大幅に超過)
coverageGap(req, farExceeding);
// (修正前) → satisfied: false  （999kWは明らかに「12kW以上」を満たすはずなのに、未充足と誤判定されていた）
// (v2.4修正後) → satisfied: true, comparison_mode: 'point_in_region'
```

**原因**：`coverageGap()`は「実仕様の値の範囲が、要求の範囲を覆っているか（actual ⊇ requirement）」という1つの比較方向だけをハードコードしていた。

- 温度のように、要求も実仕様も両方とも**達成可能な範囲**を表す場合（「0〜50℃で動作できること」という要求に対し、「設計は0〜40℃までしか対応しない」という実仕様が、要求範囲を覆っているか）は、この方向で正しい。
- しかし冷房能力・電圧・周波数・騒音のように、要求が**片側閾値**（「12kW以上」＝下限だけを定め、上限には触れていない）で、実仕様が**単一の達成値**（設計はちょうど何kWを実現するか）である場合、必要なのは逆方向の比較（「達成値が、要求の許容範囲に収まっているか＝requirement ⊇ {actual}」）である。コードは`if (!rq.upper) return !ac.upper;`のように「要求に上限がなければ、実仕様にも上限がないことを要求する」というロジックになっており、これは範囲同士の比較では正しいが、達成値との比較では常に破綻する（達成値は必ず具体的な1点＝上下限を持つため）。

**影響範囲**：今回の6グループ中、範囲 vs 範囲の比較が成立するのは温度だけで、残り4グループ（冷房能力・電圧・周波数・騒音）は全て「片側閾値要求 vs 達成値」または「等号要求 vs 達成値」であり、**このバグの影響を受ける組み合わせの方が実データ上は多数派**だった。

## 5. 対応方針の検討と決定（v2.4で暫定決着、v2.5で外部レビューにより見直し）

当初、この問題はコードの一行修正では済まないと考えていた。比較の方向は、**要求側が「範囲（capability）」なのか「閾値（threshold）」なのか「厳密一致（exact）」なのかによって変わる**ように見えたため、次のいずれか（またはその組み合わせ）の設計判断が要ると想定していた。

- (a) 工程4aの数量抽出結果自体に、要求の種類（範囲／閾値／厳密一致）を推定するフラグを追加し、`coverageGap()`がそれに応じて比較方向を切り替える。
- (b) 工程3（本プロトタイプ）が、`role=requirement`のレコードに対し「この要求は範囲型か閾値型か」を追加の候補情報として持たせ、比較関数へ渡す。
- (c) `coverageGap()`を1つの関数に統合せず、範囲用・閾値用・厳密一致用で比較関数を分け、工程3のrole/構造から呼び分ける。

いずれも「要求側の種類」を新たに推定するロジックを要し、工程4a単体、工程3単体では閉じない、両工程にまたがる設計判断だった。

**採用した第4の案**：a〜cを検討する過程で、要求側ではなく**実仕様（`actual`）側の構造だけを見れば方向を判定できる**ことに気づいた。`actual.quantity`が「点」（`lower.value === upper.value`、単一の達成値）であれば`point_in_region`モード（達成値が要求の許容範囲内にあるかを判定）、そうでなければ`range_covers_range`モード（実仕様の範囲が要求の範囲を覆っているかを判定）とする。

この案がa〜cより優れている理由：

1. **新たな推定ロジックが不要**：要求の種類（範囲／閾値／厳密一致）を判定する必要がなく、`actual`側の`lower`/`upper`が既存のスキーマにすでに存在する値かどうかを比較するだけで済む。推定を追加しない分、誤推定によって比較全体が誤るリスクを増やさない。
2. **実データと整合する**：達成値（Excelの検討結果・標準機種情報）は、抽出時点で必ず単一の値（点）として表現される。要求側が範囲か閾値かに関わらず、「達成値 vs 何らかの許容範囲」という比較になるため、point側の構造だけで十分に判定できる。
3. **温度のケースも壊さない**：温度の要求「0〜50℃」と実仕様「0〜40℃」は両方とも`lower !== upper`の真の範囲なので、従来どおり`range_covers_range`モードのまま扱われる。

9件の実データケース（温度×2、冷房能力×3(999kW含む)、電圧×2、騒音×2）で事前検証し、全て期待どおりの`satisfied`値・`comparison_mode`になることを確認したうえで採用した。実装は`quantity_extraction_prototype.js` v2.4の`coverageGap()`（詳細は同ファイルおよび`quantity_extraction_prototype.md`5.7節を参照）。

### 5.1 外部レビューによる指摘：actualの形だけでは区間の意味を一意に決められない（v2.5）

v2.4案を外部レビューへ提出したところ、「actualが点か範囲か」の2値分類だけでは不十分という指摘を受けた。指摘は実際のコードで再現を確認済み（`quantity_extraction_prototype_review.md`0.4節）。

レビューが整理した区間の意味は、点・範囲の2種類ではなく少なくとも5種類ある。

| 区間の意味 | 例 | 必要な比較 |
|---|---|---|
| 対応可能領域 | 使用温度0〜50℃ | actualが要求領域を包含 |
| 達成値 | 冷房能力12.5kW | 点が要求条件内か |
| 保証下限 | 冷房能力15kW以上 | actual下限が要求下限以上か |
| 保証上限 | 騒音58dB以下 | actual上限が要求上限以下か |
| 変動・公差範囲 | 220V±5% | actual全体が要求許容領域内か |

v2.4の「actualが範囲」判定は、このうち「対応可能領域」と「保証下限／保証上限」を区別できず、後者2つを前者と同じ`range_covers_range`方向で誤って比較していた。具体的には、要求「騒音60dB以下」×実仕様「最大58dB」、要求「冷房能力12kW以上」×実仕様「最小15kW」のような、明らかに充足するケースが`satisfied:false`になることを確認した。あわせて、空集合（`50℃以上50℃未満`＝`[50,50)`）を点と誤認する不具合、`extraction.warnings`の警告が比較結果へ伝播していなかった不具合も指摘・確認した。

**恒久対応と暫定対応の切り分け**：レビューは、区間の意味候補（`interval_semantics`：`achieved_point`/`capability_domain`/`acceptable_region`/`guaranteed_minimum`/`guaranteed_maximum`/`outcome_range`/`unknown`）を工程3（本プロトタイプ）が生成し、`coverageGap()`が比較モードを明示的に選ぶ設計を恒久対応として提案した。この設計は本プロトタイプの`property_candidates`/`role_candidate`と同様の「候補生成、確定は人間」という構造に自然に乗る一方、規模が大きいため、まず安全策（片側区間は自動判定せず`comparable:false`を返す）をv2.5として工程4a側に反映し、恒久対応は次の検討候補として持ち越した（7章参照）。

### 5.2 外部レビューによる追加指摘：両側区間も意味が未確定（v2.6）

v2.5を外部レビューへ提出したところ、「片側区間だけでなく、**両側区間も区間の意味（対応可能領域か変動範囲か等）が一意に決まらない**」という追加指摘を受けた。指摘は実際のコードで再現を確認済み（`quantity_extraction_prototype_review.md`0.5節）。

v2.5は両側区間を無条件で「対応可能領域」（`actual ⊇ requirement`方向）として扱っていたが、4.1節の温度はこの解釈でたまたま正しかっただけで、公差表記のような「変動範囲」（`requirement ⊇ actual`方向、実仕様全体が要求の許容範囲に収まるか）には逆方向が必要である。具体的には、要求「電圧200〜240V」×実仕様「電圧220±10V」（変動範囲としてなら充足のはず）が`satisfied:false`になることを確認した。片側区間で発見した問題（v2.4→v2.5、4.2節）と全く同じ構造の問題が、両側区間にも存在していたことになる。

**採用した対応**：`coverageGap()`に第3引数`options.comparisonMode`（`'actual_covers_requirement'` | `'requirement_covers_actual'`）を追加し、両側区間もmode未指定では自動判定せず`comparable:false`を返すよう変更した（v2.6、詳細は`quantity_extraction_prototype.md`5.9節）。

この変更にともない、本プロトタイプも次のように更新した。

- 4章の自動橋渡しループ：意図的に変更しない（mode未指定のまま）。区間の意味候補を持たない現状のプロトタイプでは、温度の比較も含めて自動では判定できないという制約を、実際のコンソール出力で正直に示すため。
- 6章の完了条件チェック（温度の被覆判定）：`comparisonMode: 'actual_covers_requirement'`を明示的に渡すよう更新した。これは「温度は対応可能領域である」という、本来は工程3の`interval_semantics`候補生成が担うべき判断を、暫定的に固定値として与えているものであり、恒久解ではない。
- 新規アサーションを追加し、mode未指定では4章の自動橋渡しループ自体も比較不能を返すことを回帰確認した。

既存9件に1件を追加し、**合計10件の自動アサーションが全件成功**することを確認した。

この結果、外部レビューが指摘した「`interval_semantics`は将来の改善ではなく、工程5を安全に動かすための必須入力である」という結論が、本プロトタイプの実データでも裏付けられた形になる。

**付記（v2.7）**：`comparisonMode`実装自体にも、無限境界（下限・上限なし）の包含判定が逆という不具合が別途指摘され、`quantity_extraction_prototype.js` v2.7で修正された（`quantity_extraction_prototype.md`5.10節、`quantity_extraction_prototype_review.md`0.6節参照）。本プロトタイプが使う温度・冷房能力等の比較はいずれも有限境界のため、この修正による本プロトタイプの出力・アサーションへの影響はない（10件中10件成功のまま）。

## 6. 完了条件チェック

`node semantic_mapping_prototype.js`で次を確認できる（10件中10件成功）。

- [x] 温度概念グループが生成される
- [x] 温度概念グループにrequirement/baseline_design/resolved_designが揃う
- [x] 自動グルーピング経由で「標準機種は10℃不足」を再現する（comparisonMode明示時は正しく動く）
- [x] 自動グルーピング経由で「検討結果は充足」を再現する（comparisonMode明示時は正しく動く）
- [x] 冷房能力の概念グループも生成される
- [x] 冷房能力/検討結果が12.5kWのまま破損せず伝わる（工程4a v2.3で修正した不具合の回帰確認）
- [x] 候補は全て`confirmed:false`のまま（自動確定しない）
- [x] `quantity_record`は文字列でなく工程4aの構造化オブジェクト参照のまま
- [x] 【v2.4で修正済み】999kWは12kW以上の要求を満たす（`point_in_region`モードで正しく充足と判定される。4.2節・5章参照）
- [x] 【v2.6で追加確認】両側区間（温度）はcomparisonMode未指定では自動橋渡しループも比較不能を返す（5.2節、`quantity_extraction_prototype.md`5.9節参照）

## 7. 次の検討候補

5章の比較方向の設計判断は、v2.4での修正提案が外部レビューにより不十分と指摘され、v2.5で安全策（片側区間は自動判定しない）に見直され（5.1節）、さらにv2.6で両側区間にも同じ安全策が拡張された（5.2節）。恒久対応は次のとおり最優先で残っている。

1. **区間の意味候補（`interval_semantics`）の設計**（最優先。レビュー提案の`achieved_point`/`capability_domain`/`acceptable_region`/`guaranteed_minimum`/`guaranteed_maximum`/`outcome_range`/`unknown`を、本プロトタイプの`property_candidates`と同様の確信度付き候補として生成する設計。高確信度のみ自動採用、曖昧な場合は要確認とする方針で、人間の作業を増やさないことを目指す）
2. 概念辞書（`CONCEPT_DICTIONARY`）の運用方法：案件ごとの手動メンテナンスか、タグ辞書からの自動生成か
3. 概念候補の確信度スコアリング（現在は単位次元0.4+周辺語0.35+タグ0.25の単純加算）の妥当性検証。より多くの実データでの調整が必要
4. `unknown`ロール（出典列が標準機種情報・検討結果のいずれでもない場合）の扱い
5. 条件候補（`role=condition`）を、意味対応付けの観点でどう活用するか（現状はグルーピングに参加するだけで、比較には使われていない）
