# B-3d 引継ぎ資料

**作成日**: 2026-07-22
**引継ぎ元**: B-3c担当（Claude Sonnet 5 / claude-code）
**対象コミット**: `464061be5ca981e44320ec72f99ad644b5e2f367`（`claude/pdf-excel-json-overview-pigbne`ブランチHEAD、承認済み）
**このドキュメントの目的**: B-3dを新しい開発者AIが安全に着手できるよう、B-3cの成果物・契約・レビュー作法を要約する。詳細は本ドキュメントが指す一次資料（`shadow_mode_integration_design.md`本体、各コードファイルのコメント）を参照すること。このドキュメント自体は複製ではなく地図（どこに何が書いてあるか）として使うこと。

---

## 1. 今どこにいるか

`trace-comparison/1.0-rc2`の**Node側**二層検証器（`trace_comparison_record_set_validator.js`）が、7巡のレビューを経て承認された（Approve、2026-07-22）。レビュアーは「Request changes」を5回出しており、その都度コード上の具体的な脆弱性・欠陥（`producerでは生成不能なartifactがvalid:trueになる経路`）を指摘し、開発側は実際にそのexploitを再現した上で修正・恒久テスト追加・バグ注入検証・全回帰・design doc更新・コミット/プッシュを行う、というサイクルを7回繰り返した。最終承認コメントは以下の3点を残している。

1. **B-3dの範囲をここに限定すること**：browser schema生成／browser validator接続／opt-in UI／trace-comparison JSON download／browser・Node間のschema・validator drift検査。
2. **B-3dでも進んではいけないもの**：B-4（人間レビュー状態遷移）、`review.satisfaction`の状態拡張、B-5（永続化）、rc2 Schemaの暗黙な拡張。
3. **維持すべき契約**：検証・ダウンロード対象は`record_set`（正式artifact本体）のみであり、runtime envelope全体（`{ready, result_complete, diagnostics, record_set}`）ではない。

この制約はレビュアーが明示的に課したものであり、B-3d着手時に再確認・厳守すること。

---

## 2. B-3cが作ったもの（アーキテクチャ概要）

### 2.1 二層検証の構造

`validateTraceComparisonRecordSet(recordSet)` は**例外を投げない総関数**として `{valid, schema_errors, semantic_errors}` を返す。実行順序は次の3段階（この順序自体がレビュー6巡目で「Schemaより前に効かせる」よう修正された経緯があるので、順序を変えないこと）。

```
1. preflightJsonGraph()   … JSON data graphの構造的健全性(プロトタイプ・own property・循環・
                              深さ・ノード数・配列長・疎配列・非indexプロパティ)
2. Schema構造検証          … json_schema_minivalidator.js + trace_comparison_schema_v2.json
3. semantic検証            … Schemaでは表現できない相関・導出式・入力からの再計算
```

段階1か2が失敗したら、それ以降は実行しない（構造が壊れた文書に無意味なエラーを積み上げない）。

### 2.2 semantic検証が実際に確認していること（B-3d開発者が知っておくべき「正式artifactの意味」）

- ID系: `comparison_id`のUTF-8 netstring往復復号一致、`quantity_pair_id`の導出一致、文書内一意性
- 参照結合: `requirement_ref`/`actual_ref`のquantity_idとanalysis側quantity_idの一致
- **数値監査値の完全再計算**（B-3cレビュー5〜7巡目の中心）: `classifyUnitConversion()` → `applyLinearConversion()` → `comparePointInRegion()`/`compareIntervalCoverage()` → signed boundary delta固定式、をraw analysisの入力から独立に再実行し、record内の値とdeep-equalであることを確認する。**別実装を複製せず、producerが生成に使ったのと同じ純粋関数をvalidatorも再利用する**という設計方針が徹底されている。
- `comparison_mode`の固定対応表(`COMPARISON_MODE_DERIVATION_TABLE`)からの再導出
- `interval_semantics_resolution`の生candidatesへの結合（先頭候補・confidence降順+value昇順ソート・margin・opposing evidence・候補数上限64件）
- `provenance.ruleset_version`の`SUPPORTED_RULESETS`への完全タプル照合
- `auto_applicability.basis`の導出式、および「comparisons[]へ到達した候補は上流ゲートを通過済みのはず」という不変条件
- `mapping`（property resolution）の候補結合
- 数量構造契約（`validateQuantityValueStructure()`）を3つの数量値（requirement/actual original/actual normalized）すべてに適用し、違反時は後続の幾何再計算へ進まず`return`する
- 非有限数（NaN/Infinity）の全数値再帰走査、および`canonicalJson()`が`JSON.stringify(Infinity)==='null'`という仕様上`Infinity`と`null`を混同しうる箇所を個別に`Number.isFinite()`でガード

### 2.3 「別実装を複製しない」という一貫した設計原則

`quantity_sidecar_binding_core.js`は元々「公開APIはbinding経由のみ」という信頼境界を持っていたが、B-3cレビュー5〜6巡目で、semantic validatorがこれらの純粋関数を再利用する必要から、以下を新たにpublic APIへexportした（`quantity_sidecar_binding_core.js`末尾の`Object.freeze({...})`参照）。

```
classifyUnitConversion, applyLinearConversion, comparePointInRegion, compareIntervalCoverage,
validateQuantityValueStructure, MAX_INTERVAL_SEMANTICS_CANDIDATES_PER_QUANTITY
```

既存でexport済みのもの: `COMPARISON_MODE_DERIVATION_TABLE`, `validateRulesetCompatibility`, `canonicalJson`, `compareComparisonRecords`, `generateTraceComparisonRecordSet` 等（フルリストはファイル末尾参照）。

**B-3dで新しい機能を作る際も、この原則を踏襲すること**：同じ計算をbrowser側で別実装せず、`quantity_sidecar_binding_core.js`（既にUMDラップされておりbrowser/Node両対応）を`<script>`で読み込んで使う。

---

## 3. 主要ファイルマップ

| ファイル | 役割 | モジュール形式 |
|---|---|---|
| `tools/quantity_sidecar_binding_core.js` | 生成コア本体。`bindInputPair()`〜`generateTraceComparisonRecordSet()`まで全パイプライン＋B-3cで追加公開された純粋関数群 | **UMDラップ済み**（Node `require()` / browser `<script>` → `globalThis.QuantitySidecarBinding`両対応） |
| `tools/design_notes/trace_comparison_record_set_validator.js` | trace-comparison record_setの二層検証器本体（`validateTraceComparisonRecordSet()`） | **CommonJSのみ**（`require()`。UMDラップされていない） |
| `tools/design_notes/json_schema_minivalidator.js` | 依存ゼロの最小JSON Schema検証器（`validate(schema, value)`） | **CommonJSのみ** |
| `tools/design_notes/trace_comparison_schema_v2.json` | trace-comparison/1.0-rc2のJSON Schema定義（`record_set`のみが対象、runtime envelopeは対象外） | JSONデータファイル |
| `tools/design_notes/quantity_annotation_schema_v1.json` | quantity-annotation/1.0-rc1のJSON Schema定義 | JSONデータファイル |
| `tools/design_notes/generate_quantity_annotation_browser_schema.js` | `quantity_annotation_schema_v1.json`から`tools/generated/quantity_annotation_schema_v1.browser.js`(UMD)を生成するスクリプト | 生成器（**trace-comparison側にはまだ存在しない**、後述） |
| `tools/generated/quantity_annotation_schema_v1.browser.js` | 上記の生成物。`globalThis.QuantityAnnotationSchemaV1`として公開 | UMD |
| `tools/json_ab_trace_matching_tool_v12.1.15.html` | 照合エンジンのメインUI。既に`<script src="./quantity_sidecar_binding_core.js">`を読み込み、`globalThis.QuantitySidecarBinding`経由でbinding・candidate生成を呼んでいる | browser |
| `tools/design_notes/shadow_mode_integration_design.md` | 全フェーズの設計・レビュー履歴（B-2.x〜B-3cまでの全訂正ログ）。**一次資料**、本ドキュメントはこれの要約ではなくポインタ | Markdown |
| `tools/design_notes/trace_comparison_record_set_validator_verification.js` | Node側validatorの回帰テスト（127件、`node <file>`で実行） | Node |
| `tools/design_notes/trace_comparison_schema_check.js` | Schema単体テスト（31件） | Node |
| `tools/design_notes/trace_comparison_schema_drift_check.js` | rc1↔rc2 `$defs`構造同一性 + `json_schema_minivalidator.js`対応キーワード許可リスト検査（10件）。**browser側validatorができたら、この形式のdrift checkをNode↔browser間にも新設する必要がある** | Node |

---

## 4. B-3dで必ず新設が必要になるもの（レビュアー承認コメントの5項目の具体化）

### 4.1 browser schema生成
`trace_comparison_schema_v2.json`用の生成器を、`generate_quantity_annotation_browser_schema.js`と同じパターンで新設する（`generate_trace_comparison_browser_schema.js`のような名前を想定）。出力は`tools/generated/trace_comparison_schema_v2.browser.js`（UMD、`globalThis.TraceComparisonSchemaV2`のような命名）。

### 4.2 browser validator接続
`trace_comparison_record_set_validator.js`と`json_schema_minivalidator.js`は現在CommonJSのみで、`<script>`タグでは読み込めない。選択肢は主に2つ（未決定、実装時に選定）：
- 両ファイルをUMDラップする（`quantity_sidecar_binding_core.js`と同じパターン）。ただしminivalidatorはquantity-annotation側でも共有されているため、変更の影響範囲を全17回帰スイートで確認すること。
- ビルド時に browser用バンドルを生成するスクリプトを新設する（4.1のスキーマ生成器と同様のパターン）。

いずれの方式でも、**Node側の`trace_comparison_record_set_validator.js`本体を複製しない**（同じロジックを2箇所に手で書き写すと、これまでの7巡レビューで潰した欠陥がbrowser側に再発する）。

### 4.3 opt-in UI
`json_ab_trace_matching_tool_v12.1.15.html`が最有力の追加先（既に`QuantitySidecarBinding`を読み込み、`generateTraceComparisonRecordSet()`も呼び出し可能な状態）。**オプトインの原則**（design doc 4節）を厳守：新設ボタン・新設イベントハンドラは既存のボタン・ハンドラ・JSON生成関数を一切変更しない、追加のみの変更にする。クリックしなければ何も生成されず、既存ワークフローはそのまま動く。

### 4.4 trace-comparison JSON download
ダウンロード対象は**`record_set`のみ**（`generateTraceComparisonRecordSet()`が返す`{ready, result_complete, diagnostics, record_set}`のうち`record_set`だけ）。runtime envelope全体をダウンロード対象にしないこと（レビュアーが最終承認コメントで明示的に釘を刺した制約）。ダウンロード前に4.2のbrowser validatorで検証し、`valid:false`の場合の扱い（ブロックする／警告付きで許可する等）を設計判断として明示すること。

### 4.5 browser／Node間のschema・validator drift検査
`trace_comparison_schema_drift_check.js`と同じ形式で、新設するbrowser側schema/validatorがNode側と構造的に一致することを検査するテストを追加する。quantity-annotation側で既に`quantity_sidecar_binding_verification.js`内に「正本とブラウザの合否が一致する」という差分テスト（`schemaDifferentialMutations()`、80件以上の変異入力で両実装の合否を突き合わせる）の実例があるので、それを踏襲するのが最短経路。

---

## 5. レビュー作法（次のRequest changesサイクルに備えて）

このプロジェクトのレビュアーは自動化された非常に厳格なコードレビューを行う（B-3cで7巡）。観測されたパターン：

1. **指摘は必ず「producerでは生成不能なartifactがvalid:trueになる／逆に有効なartifactが誤って拒否される」という具体的なexploitシナリオを伴う**。コード修正だけでなく、そのexploitを実際に手元で再現してから塞ぐことが期待されている。
2. **バグ注入検証が必須**：修正を無効化した状態でテストを実行し、対応するテストが実際に失敗することを確認してから復元する。「テストが通っている」だけでは不十分で、「そのテストが本当にその防御を検証しているか」（他の既存チェックが偶然同じ入力を別理由で拒否していないか）まで確認する必要がある（B-3cレビュー5巡目で、basisへの伝播検査が偶然テストの部分文字列に一致して見かけ上パスしていた事例があった）。
3. **全回帰の実行と報告が必須**。`quantity_sidecar_binding_core.js`を変更した場合は、それを消費する全ファイル（現在17個のNodeスイート、5個のPlaywrightスイート）を再実行する。変更していない回でも、レビュアーは「対象コミットSHAに対して」全検証が完了しているかを毎回確認する。
4. **`shadow_mode_integration_design.md`への追記が必須**：各修正ラウンドごとに`> **訂正（コミットハッシュ`レビュー、日付、重大N件・中N件）**：...`という形式の段落を末尾に追記する（既存の記法を踏襲、複製せず追記のみ）。
5. **`git diff --check`・簡易secret scan・`git sync`確認（local HEAD = origin HEAD）も毎回求められる**。
6. **コミットメッセージは日本語で、「何が指摘されたか→なぜ問題か→どう直したか→テストで何を確認したか」の4段構成**を踏襲すると通りやすい（過去7回のコミットメッセージ参照）。

### Playwright実行環境の注意
Playwright依存の5ファイル（`hash_3paths_verification.js`, `quantity_annotation_pdf_verification.js`, `quantity_annotation_excel_verification.js`, `quantity_annotation_excel_xlsx_verification.js`, `quantity_sidecar_binding_browser_verification.js`）は`tools/design_notes/node_modules`にローカルインストールされたplaywrightを使う。実行は`tools/design_notes`ディレクトリ内から`node <file>.js`で行う（依存が無ければそのディレクトリで`npm ci`）。実行するとテスト内部で`tools/design_notes/runtime_fixtures/*.json`の`generated_at`タイムスタンプが更新されるため、コミット対象でなければ`git checkout -- <file>`で戻すこと。

---

## 6. 未着手・意図的に対象外の項目（手を出さないこと）

- B-4: レビュー状態遷移（`review.quantity_extraction`/`property_mapping`/`interval_semantics`/`comparison_mode`/`satisfaction`の状態遷移実装）
- `review.satisfaction`の状態拡張（現状B-3生成時点は全件`not_eligible`固定で、rc2 Schemaも`const`で固定している。B-4以降は新schema version（rc3等）で行い、rc2を暗黙に広げない）
- B-5: 永続化（レビュー状態の保存先は8節で「未定」のまま）
- rc2 Schemaの暗黙な拡張（新しいフィールドが必要になった場合も、rc2を書き換えず新schema versionを起こす方針が一貫している）

---

## 7. すぐに使えるコマンド集

```bash
# Node側validator回帰(127件)
node tools/design_notes/trace_comparison_record_set_validator_verification.js

# Schema単体テスト(31件)
node tools/design_notes/trace_comparison_schema_check.js

# rc1↔rc2 drift check(10件、browser側drift checkを作る際の参考実装)
node tools/design_notes/trace_comparison_schema_drift_check.js

# quantity-annotation側の正本⇔browser差分テストの実例(browser validator接続時の参考)
node tools/design_notes/quantity_sidecar_binding_verification.js

# 既存のbrowser schema生成パターン(trace-comparison版を作る際のひな形)
node tools/design_notes/generate_quantity_annotation_browser_schema.js

# Playwright 5スイート(tools/design_notes配下で実行)
cd tools/design_notes && node hash_3paths_verification.js
cd tools/design_notes && node quantity_annotation_pdf_verification.js
cd tools/design_notes && node quantity_annotation_excel_verification.js
cd tools/design_notes && node quantity_annotation_excel_xlsx_verification.js
cd tools/design_notes && node quantity_sidecar_binding_browser_verification.js
```

---

## 8. このドキュメントの位置づけ

このファイルは着手時の地図であり、実装が進むにつれて陳腐化する。B-3d完了後（または大きく状況が変わった時点）は、`shadow_mode_integration_design.md`側に正式な訂正段落として結果を追記し、このファイルは更新するか、役目を終えたら削除して構わない。
