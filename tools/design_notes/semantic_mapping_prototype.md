# 検討文書：工程3（意味対応付けの候補生成）たたき台プロトタイプ

**位置づけ:** 将来の自動化方針に関する検討メモ。**未実装・未決定**（本ツール群のHTMLには未統合）。他AI・他メンバーによるレビューを想定した論点整理。
**作成日:** 2026-07-18
**版:** 2.1（1〜7章：概念候補・役割候補・比較方向の設計判断。8章：`interval_semantics`候補生成をv2.9で追加、外部レビューの必須修正2件をv2.10で反映）
**関連文書:** `tools/design_notes/abstraction_levels.md`（6工程モデル）、`tools/design_notes/quantity_extraction_prototype.md`（工程4a。本文書はその続きとして工程3を扱う）、`tools/design_notes/quantity_extraction_prototype_review.md`（0.3節で工程3への着手を提案、0.7節で`interval_semantics`候補生成への着手と設計条件を提示）
**付属ファイル:** `tools/design_notes/semantic_mapping_prototype.js`（Node.js、依存ライブラリなし。工程4aを`require`する。`node semantic_mapping_prototype.js`で実行可能。完了条件アサーション36件を出力する）

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

**付記（v2.7〜v2.8）**：`comparisonMode`実装自体にも、無限境界（下限・上限なし）の包含判定が逆という不具合（v2.7で修正）、および`actual`が真の点でも`comparisonMode`の指定が無視されるという不具合（v2.8で修正）が別途指摘・修正された（`quantity_extraction_prototype.md`5.10〜5.11節、`quantity_extraction_prototype_review.md`0.6〜0.7節参照）。この時点で比較エンジン（`coverageGap()`）側の基盤は一旦完成と評価された。本プロトタイプが使う温度・冷房能力等の比較はいずれも有限境界で、かつmode明示は使っていないため、これらの修正による本プロトタイプの出力・アサーションへの影響はない（10件中10件成功のまま）。

## 6. 完了条件チェック（4〜5章：概念候補・比較方向の設計判断部分）

`node semantic_mapping_prototype.js`で次を確認できる（8章の`interval_semantics`関連を含め、全体で36件中36件成功。この節は4〜5章に対応する10件）。

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

## 7. 次の検討候補（4〜5章の範囲に閉じた残課題）

5章の比較方向の設計判断は、v2.4での修正提案が外部レビューにより不十分と指摘され、v2.5で安全策（片側区間は自動判定しない）に見直され（5.1節）、さらにv2.6で両側区間にも同じ安全策が拡張された（5.2節）。「区間の意味候補（`interval_semantics`）の設計」は8章で着手した。残る検討候補は次のとおり。

1. 概念辞書（`CONCEPT_DICTIONARY`）の運用方法：案件ごとの手動メンテナンスか、タグ辞書からの自動生成か
2. 概念候補の確信度スコアリング（現在は単位次元0.4+周辺語0.35+タグ0.25の単純加算）の妥当性検証。より多くの実データでの調整が必要
3. `unknown`ロール（出典列が標準機種情報・検討結果のいずれでもない場合）の扱い
4. 条件候補（`role=condition`）を、意味対応付けの観点でどう活用するか（8章で`test_condition`/`unknown`の候補生成だけは着手したが、比較にはまだ使われていない）

## 8. 工程3拡張：interval_semantics候補生成（v2.9で着手）

### 8.1 経緯と設計条件

`quantity_extraction_prototype_review.md`0.7節でコメントされたとおり、比較エンジン（`coverageGap()`）側の基盤はv2.8で一旦完成と評価された。外部レビューは続けて、次工程（`interval_semantics`候補生成）に着手してよいと判断したうえで、次の設計条件を提示した。

1. 単一候補ではなく候補配列にする（曖昧性・代替解釈を失わない）
2. `acceptable_region`は要求側の意味として扱う（要求側は`acceptable_region`/`required_capability_domain`、実仕様側は`achieved_point`/`capability_domain`/`outcome_range`/`guaranteed_minimum`/`guaranteed_maximum`のように、値空間を側ごとに分ける）
3. `comparisonMode`は単独レコードではなく、要求側×実仕様側のペアから導出する
4. 根拠は`{type, value, source_text, effect, weight}`のように構造化して保存する（否定根拠`effect:'opposes'`も持つ）
5. 数量の形だけで意味を決めない
6. 高確信度でも`confirmed`はfalseのまま（`confirmed`＝人間が確定したか、`auto_applicable`＝暫定比較へ自動利用してよいか、を分離する）
7. 自動適用条件は確信度の単純な閾値だけでなく、候補間の差・否定根拠の有無・抽出警告・設計特性の対応確信度等を組み合わせる
8. 対照テスト（同じ数量形状で文脈だけを変える）・誤判定防止テストを用意する
9. 実装順序：意味候補スキーマ→根拠スキーマ→HVACサンプル限定ルール→候補配列生成→ペアからのmode導出→auto_applicable判定→`coverageGap()`接続→対照/誤判定テスト→設計文書記録

本節はこの条件に沿って実装した内容を記録する。付属ファイルは`semantic_mapping_prototype.js`のまま（新規ファイルを作らず、工程3の拡張として同一ファイルに追加した）。

### 8.2 スキーマ

`buildPropertyCandidateRecords`の各レコードに`interval_semantics_candidates`を追加した。

```js
{
  // ...(property_candidates, role_candidate等は既存のまま)
  interval_semantics_candidates: [
    {
      value: 'capability_domain',
      confidence: 0.65,
      evidence: [
        { type: 'keyword', value: 'capability_domain', source_text: '0 ℃から50 ℃で使用可能', effect: 'supports', weight: 0.55 },
        { type: 'quantity_shape', value: 'capability_domain', source_text: '0 ℃から50 ℃で使用可能', effect: 'supports', weight: 0.1 },
      ],
    },
    { value: 'unknown', confidence: 0.15, evidence: [ /* ... */ ] },
  ],
}
```

候補は確信度降順の配列で保持し、最上位候補だけを残さない（設計条件1）。`unknown`は常に最低限の確信度（0.15、`UNKNOWN_BASELINE_CONFIDENCE`）で候補に含め、他の候補が弱い場合の受け皿にする。

意味の語彙は側ごとに分離した（設計条件2）。

| 側 | 語彙 |
|---|---|
| 要求側（role='requirement'、side='A'） | `required_capability_domain`（製品が対応すべき条件領域）／`acceptable_region`（達成値が収まるべき許容範囲）／`unknown` |
| 実仕様側（role='baseline_design'/'resolved_design'、side='B'） | `achieved_point`（達成値）／`capability_domain`（対応可能領域）／`outcome_range`（変動・ばらつき・公差範囲）／`guaranteed_minimum`（保証下限）／`guaranteed_maximum`（保証上限）／`unknown` |
| 条件節（role='condition'） | `test_condition`（試験・測定条件）／`unknown` |

`comparisonMode`候補は、要求側と実仕様側それぞれの最上位候補のペアから導出する（設計条件3）。

```js
{
  comparison_mode_candidate: {
    value: 'actual_covers_requirement',
    confidence: 0.65, // たたき台: min(要求側確信度, 実仕様側確信度)
    derived_from: { requirement_semantics: 'required_capability_domain', actual_semantics: 'capability_domain' },
    confirmed: false,
  },
}
```

### 8.3 候補生成ルール（HVACサンプル限定のたたき台）

`generatePropertyCandidates`（既存の概念候補生成）と同じ「複数の独立した根拠を積み上げる」設計を踏襲した。役割（要求側/実仕様側/条件節）ごとに、周辺語・数量の形・修飾語(`qualifiers`)・否定語を根拠として`REQUIREMENT_SEMANTICS_RULES`/`ACTUAL_SEMANTICS_RULES`/`CONDITION_SEMANTICS_RULES`（いずれも`semantic_mapping_prototype.js`内で宣言）に定義した。

重要な設計判断は、**数量の形（点/片側/両側）だけの根拠は、`unknown`の既定確信度（0.15）を上回らない重みに抑える**ことである（設計条件5、レビュー9節の誤判定防止指摘に対応）。

- 両側区間であることだけ（周辺語なし）→`capability_domain`重み0.1（`unknown`0.15未満）
- 片側区間であることだけ（修飾語なし）→`guaranteed_minimum`/`guaranteed_maximum`重み0.1（`unknown`0.15未満）
- 点であることと実仕様側であること（周辺語なし）→`achieved_point`重み0.3+0.3=0.6（実仕様側の点は最も曖昧性が低いケースであるため、他より高めに設定）

一方、周辺語や修飾語という明示的な根拠があれば、はっきり`unknown`を上回る（例：「使用可能」があれば`capability_domain`重み0.55、`最大`修飾語があれば`guaranteed_maximum`重み0.55）。

点であっても能力キーワードが伴う場合は、`achieved_point`だけでなく`capability_domain`も候補として残るようにした（「対応可能温度は25℃のみ」等。「点だから自動的にachieved_pointにしない」というレビュー指摘への対応）。否定語（「参考値」「目安」「概算」）は、その時点で得点しているすべての候補に一律で負の重みを加える（特定候補だけを狙い撃ちしない設計）。

`comparisonMode`の導出テーブルは、レビューが例示した組み合わせをそのまま採用した。

| 要求側semantics | 実仕様側semantics | comparisonMode |
|---|---|---|
| `required_capability_domain` | `achieved_point` | `point_in_region` |
| `acceptable_region` | `achieved_point` | `point_in_region` |
| `required_capability_domain` | `capability_domain` | `actual_covers_requirement` |
| `acceptable_region` | `outcome_range` | `requirement_covers_actual` |
| `acceptable_region` | `guaranteed_minimum` | `requirement_covers_actual` |
| `acceptable_region` | `guaranteed_maximum` | `requirement_covers_actual` |

テーブルにない組み合わせ、またはどちらかの最上位候補が`unknown`の場合は`comparisonMode`を導出しない（`null`を返す。推測しない）。

### 8.4 auto_applicable判定

`confirmed`（人間が確定したか）と`auto_applicable`（暫定比較へ自動利用してよいか）を分離した（設計条件6）。`evaluateAutoApplicable()`は次をすべて満たす場合のみ`applicable:true`を返す（たたき台の閾値。要調整）。

- `comparisonMode`候補が導出できている、かつ確信度が0.4以上
- 要求側候補・実仕様側候補それぞれについて、最上位候補と次点候補の差が0.2以上
- 否定根拠（`effect:'opposes'`）が最上位候補に付いていない
- 抽出時の警告（`extraction.warnings`）が要求側・実仕様側ともにゼロ件
- 設計特性（`property_candidates`）の対応確信度が0.7以上

満たさない場合は`coverageGap()`を呼ばず、`{comparable:false, reason:'確信度不足のため自動適用を見送り(要確認)'}`を返す。誤った「未充足/充足」を返すより、「要確認」に留める方が安全という、これまでの`coverageGap()`側の設計判断（v2.5〜v2.7）と一貫させた。

### 8.5 実データでの検証結果

HVACサンプルの6概念グループ（PDF要求を持つ5グループ）に、`interval_semantics`候補生成→`comparisonMode`導出→`auto_applicable`判定→（適用可能な場合のみ）`coverageGap()`のパイプラインを適用した結果は次のとおり。

| 概念 | 比較 | 実仕様側top候補 | comparisonMode | auto_applicable | 結果 |
|---|---|---|---|---|---|
| 周囲使用温度 | 要求 vs 標準機種 | `unknown`（0.15、キーワードなし） | 導出不可 | false | 要確認 |
| 周囲使用温度 | 要求 vs 検討結果 | `capability_domain`（0.65、「使用可能」） | `actual_covers_requirement`（0.65） | true | 充足（従来どおり10℃不足なし） |
| 冷房能力 | 要求 vs 標準機種／検討結果 | `achieved_point`（0.60） | `point_in_region`（0.60） | true | 従来どおり（標準機種は2kW不足、検討結果は充足） |
| 電源電圧 | 要求 vs 標準機種／検討結果 | `achieved_point`（0.60） | `point_in_region`（0.45） | true | 従来どおり（標準機種は不一致、検討結果は充足） |
| 周波数 | 要求 vs 標準機種／検討結果 | — | — | false | 要確認（下記参照） |
| 運転騒音 | 要求 vs 標準機種／検討結果 | `achieved_point`（0.60） | `point_in_region`（0.60） | true | 従来どおり（標準機種は超過、検討結果は充足） |

温度の「要求 vs 標準機種」（Excel原文「0 °C～40 °C」）は、`使用可能`等の明示語を含まないため`interval_semantics`が`unknown`となり、`comparisonMode`を導出できず「要確認」のまま留まった。これは**バグではなく意図した挙動**であり、v2.5〜v2.6で確立した「区間の意味が確定できない場合は自動判定しない」という原則を、`interval_semantics`候補生成の入力データそのものが薄い場合にも一貫して適用した結果である。人間が最終確認する対象として提示されることになる。

周波数（要求 vs 標準機種）が「要確認」になったのは、`interval_semantics`ではなく別の基準（設計特性の対応確信度）が理由だった。要求文「定格電源は三相AC 220 V、50 Hzとすること。」には「周波数」という語が literal に出現しないため、`property_candidates`（工程3の概念候補、4章のスコアリング）の段階で50Hzの対応確信度が0.65（単位次元一致0.4+タグ一致0.25。周辺語一致0.35が付かない）に留まり、`auto_applicable`のPROPERTY_CONFIDENCE_THRESHOLD（0.7）を下回った。**この判定は、interval_semantics候補生成より前段の概念候補スコアリング自体が持っていた既存の弱さを、auto_applicableゲートが正しく検出した例**であり、意図どおりの安全側の停止である。

### 8.6 対照テスト・ペア導出テスト・誤判定防止テスト

レビュー提示の対照テスト（8節）・ペア導出テスト（8節）・誤判定防止テスト（9節）を、いずれも実際に`node semantic_mapping_prototype.js`で実行して確認した（v2.9時点で28件中28件成功。8章関連は18件）。

- 対照テスト7件：同じ数量形状（`0～50℃`等）でも、周辺語（使用可能／試験／測定結果／変動）や修飾語（最低／最大）が変われば最上位候補が変わることを確認。文脈のない`0～50℃`は`unknown`が最上位のまま（形だけで確定しない）
- ペア導出テスト4件：`required_capability_domain×capability_domain→actual_covers_requirement`等、レビュー提示の組み合わせが正しく導出されること、`unknown`を含むペアは導出されないことを確認
- 誤判定防止テスト6件：片側区間だけでは保証下限を確定しない／両側区間だけでは能力領域を確定しない／点+能力キーワードでは`achieved_point`と`capability_domain`が両方候補に残る／±が要求側にある場合は`outcome_range`固定にならず`acceptable_region`候補になる（側によって扱いが分かれることの確認）／「参考値」等の否定根拠があると確信度が下がり`unknown`のままになる／`comparisonMode`確信度が閾値未満なら`auto_applicable`にならない、をそれぞれ確認

対照テストの作成中に、工程4aの修飾語辞書に「最低」（「最小」の同義語）が含まれておらず、単なる点として誤抽出される不具合を発見した。`quantity_extraction_prototype.js` v2.9で「最高・最低」を「最大・最小」の同義語として追加した（詳細は`quantity_extraction_prototype.md`5.12節）。

### 8.7 残課題（v2.9時点。v2.10で対応した2件は8.8節を参照）

- ~~**確信度の重み・閾値の妥当性**~~：v2.10でachieved_pointの重み付けを見直した（8.8節）。他の重み・閾値は引き続きたたき台であり、より多くの実データでの調整を要する
- **要求側の`±`表記**：要求側に`±`（公差）がある場合、`outcome_range`固定にせず`acceptable_region`寄りの候補になることは確認したが、実仕様側の`outcome_range`との組み合わせ（`acceptable_region`×`outcome_range`→`requirement_covers_actual`）以外の、要求側自体が公差表記であるケースの扱いは未検証（HVACサンプルに実例がないため）
- **概念辞書・確信度スコアリングとの相互作用**：8.5節で見たとおり、`interval_semantics`側が高確信度でも、概念候補（`property_candidates`）側が閾値未満であれば`auto_applicable`にならない。両者の閾値をどう組み合わせるべきかは、より多くの実データで検証が必要
- **条件節（`role=condition`）の活用**：`test_condition`/`unknown`の候補生成だけ着手し、比較へはまだ使っていない（7章の残課題と同じ）
- **`lowGap`/`highGap`の表現見直し**：`quantity_extraction_prototype_review.md`0.6節でレビューから提案された`boundaryDelta`/`deltaInterpretation`への変更は未着手のまま

### 8.8 外部レビューによる必須修正2件（v2.10）

v2.9を外部レビューへ提出したところ、「設計の方向性は良いが、自動適用に関する必須修正が2件あり、本体統合可能とはせず安全側へ補正すべき」との判定を受けた。指摘は着手前に実際のコードで再現を確認した（推測で対応せず、レビューの主張を裏取りした上で着手）。**指摘は全て実際に再現した。**

**必須修正1：`required_capability_domain × achieved_point`を`point_in_region`にしてはいけない**

`COMPARISON_MODE_DERIVATION_TABLE`に`{requirement:'required_capability_domain', actual:'achieved_point', mode:'point_in_region'}`という対応があり、要求「0〜50℃で運転できること」（`required_capability_domain`）×実仕様「25℃」（`achieved_point`）が`point_in_region`で自動導出され、25℃が0〜50℃内にあることをもって`satisfied:true`（誤って充足）を返すことを確認した。25℃という1点で運転できることは、要求範囲全域（0〜50℃）への対応を証明しない——`acceptable_region`×`achieved_point`（「騒音60dB以下」に対する「58dB」のような、達成値が許容範囲内かを問う関係）とは意味が異なる。

**対応**：`COMPARISON_MODE_DERIVATION_TABLE`から該当行を削除した。この組み合わせは当面「導出規則なし」とし、`comparisonMode`候補が`null`のまま`comparable:false`（要確認）に留まる。恒久対応（要求側semanticsをさらに細分化し、達成値1点では証明にならない「全域対応要求」と、達成値で足りる「性能目標要求」を区別する等）は、より多くの実データを見てから検討する。

**必須修正2：`achieved_point`の確信度が「点という形＋B側という役割」だけで0.6になる**

`achieved_point`は「点である」（0.3）と「B側=実仕様側である」（0.3、`source_role`）の2規則が同時加算され、周辺語や修飾語による裏付けが一切なくても確信度0.6に達していた。しかし「B側である」ことは役割を表すだけで、その点が達成値なのか、設定値・公称値・試験条件・参考値なのかを識別する独立根拠にはならない——「設定温度25℃」「試験温度25℃」「公称電圧220V」「参考値58dB」のいずれも`achieved_point:0.6`（`unknown:0.15`を大きく上回る）になり、周辺語による区別が事実上機能していないことを確認した。

**対応**：レビュー提案の2案のうち、`source_role`の重みを下げる案を採用した（0.3→0.15）。あわせて、否定根拠の語彙（`NEGATIVE_KEYWORD_RULES`）へ「設定」「公称」「試験」を追加し、重みも-0.3→-0.4へ強化した。これにより、上記4例はいずれも`achieved_point`が候補から実質的に排除される（`0.3(形)+0.15(役割)-0.4(否定根拠)`で負値となり閾値`0.02`未満でフィルタされる）か、`unknown`（0.15）を下回るようになった。条件節（`role='condition'`）では「試験」「測定」が`test_condition`の正の根拠として使われるため、否定根拠の適用を実仕様側（`role='condition'`でない場合）に限定した（対照テストの「試験温度は0～50℃→test_condition」は影響を受けない）。

一方、HVACサンプルの実データ（周辺語のないキーワードなしの達成値：冷房能力12.5kW、電圧220V、騒音58dB等）は、`achieved_point`確信度が0.6→0.45へ下がったものの、`auto_applicable`の閾値（modeConfidence0.4、margin0.2）は引き続き満たし、自動適用の挙動は変わらないことを確認した。

既存28件に、必須修正1の回帰テスト4件（要求側・実仕様側それぞれの候補確認、`comparisonMode`が導出されないこと、`auto_applicable:false`になること）と必須修正2の回帰テスト4件（レビュー提示の4例がいずれも`achieved_point`を自動適用しないこと）の計8件を追加し、**合計36件の自動アサーションが全件成功**することを確認した。

**推奨修正への対応**：レビューは必須ではない改善として2点提案した。

- （推奨3）`comparisonMode`候補を要求側×実仕様側候補の直積から生成し、確信度順の配列として保持する設計。現状の安全性（誤判定を防ぐこと）は保たれているため、今回は対応せず次の検討候補とした（8.7節）
- （推奨4）`confidence`が統計的な確率ではなく、ルール重みの加算値（未校正の相対スコア）であることの明記。フィールド名は変更せず、コード内コメントと本節に明記する対応とした（`scoreSemantics()`のコメント参照）

**レビューの結論**：v2.9は候補生成基盤として妥当だが、2件の必須修正により「誤った充足判定」「根拠の薄い自動確定」という、これまでの`coverageGap()`側の一連の修正（v2.4〜v2.8）と同種のリスクが`interval_semantics`層にも存在していた。修正後はv2.10として扱う。
