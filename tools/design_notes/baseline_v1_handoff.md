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
6. **照合エンジンが表示する`B_ID`を永続的な主キーとして扱わない**（7.2.4節の訂正・7.4節）：`B_ID`はB側`trace_id`と一致するとは限らない（`plmBusinessKey()`が他項目を優先するため）。sidecarレコードの`actual_ref`は、B側レコード自身が持つ`trace_id`フィールドを直接参照して引き当てる。`B_ID`は既存UIとの表示対応にのみ用いる。
7. **`extractRecordList()`は明示的な`_trace_records`を最優先で採用する**（7.2.1節・7.3節、`json_ab_trace_matching_tool_v12.1.15.html`の`extractRecordList()`に実装済み）：入力データが`{_trace_records: [...]}`の形（PDF/Excel側の照合用JSONの実際の形）であれば、`findRecordArrays()`によるスキーマ非依存の「最大配列」探索へフォールバックする前に、必ずこの明示形式を採用する。`source_record`等の内部に`_trace_records`より要素数の多い配列が混入しても、選択が誤って乗っ取られないことを保証する（回帰テスト: `_trace_records`5件＋`source_record.nested_array`200件→必ず5件を選ぶ、Playwright実行で確認済み）。

この6条件のうち1〜5は、`interval_semantics_fuzz_test.js`・`vocabulary_negation_fuzz_test.js`・`real_corpus_validation.js`の3スイートが継続的に検証している内容そのものである。本体統合時にロジックを移植・改修する際は、この3スイートも一緒に移植し、CI等で回し続けることを推奨する。6は`json_ab_trace_matching_tool_v12.1.15.html`側のデータ契約であり、上記3スイートの対象外（別途、本体側のテストで担保する）。

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
- `spec_to_json_conversion_tool_v1.18.html`は、PDF→「通常文書JSON」（DocumentModel 2.0形式）への変換に加え、`json_ab_trace_matching_tool`向けの「照合用JSON」（フォーマット名`chapter-section-trace-v1`）を出力する機能を持つ（該当コード: 同ファイル`makeTraceRecord()`・`buildTraceRecords()`、2228行目以降）。
- この「照合用JSON」の各レコードは、`{id, trace_id, trace_title, trace_text, trace_key_text, chapter_number, chapter_title, section_number, section_title, source_raw_text, content_hash, ...}`のような章・節単位の構造化テキスト情報を持つ。**`quantity`・`interval_semantics_candidates`・`comparisonMode`に相当するフィールドは、現状の本体スキーマには一切存在しない**。
- `json_ab_trace_matching_tool_v12.1.15.html`（12,355行）は、テキスト・タグベースの照合（信頼度スコアリング、ナレッジグラフ、トレースマトリクス）を行っており、数値の充足判定（`coverageGap()`相当の機能）は行っていない。

**この調査から言えること**：本体統合は「既存の数値比較フックに新ロジックを差し込む」作業ではなく、「本体のtrace record（chapter-section-trace-v1形式）とは別に、数量・意味候補・比較結果を表す新しいレコード群を追加する」設計作業になる。

> **判断確定（`trace_comparison_schema_v1.md`）**：ユーザー提案の`schema_version: "trace-comparison/1.0"`は、既存の`chapter-section-trace-v1`とは別レイヤーの独立したsidecarファイルとして設計することに決定した（`chapter-section-trace-v1`自体の拡張は採用しない）。理由・詳細なフィールド定義・具体例は`tools/design_notes/trace_comparison_schema_v1.md`を参照。

### 7.1 Excel側の照合用JSON調査（完了）

`excel_to_json_conversion_tool_v2.0.8.html`側を調査した。ツール自身が埋め込んでいる仕様書（`EXCEL_PROFILE_SPEC_MD`、3700行目）と、実際のレコード生成関数`buildTraceOutput()`（1904行目）の両方を確認し、内容が一致することを確かめた。

Excel側は`excel-row-trace-v1`形式で、Excelの1行を1レコードとする。実際のコードにおけるレコードの完全な形（`buildTraceOutput()`の戻り値、1924〜1943行目）：

```js
{
  trace_id, parent_id, trace_title, trace_text, trace_content,
  trace_category, trace_key_text,
  source_file, source_sheet, source_row, source_path,
  source_section_id, source_section_title, block_type,
  tags, unregistered_tags, review_status,
  source_record: row   // ★元のExcel行オブジェクトを丸ごと保持
}
```

PDF側（`makeTraceRecord()`、2228行目）もほぼ同型で、`source_raw_text: rawText`という形で元のテキストを丸ごと保持している。

**PDF側・Excel側で共通して確認できた、統合設計上重要な事実**：
1. **PDF側・Excel側ともに、`quantity`・単位・数量意味候補に相当するフィールドは一切存在しない。** 両方とも「テキストをどう寄せ集めて1レコードの`trace_text`にするか」という粒度の設計であり、数値比較の概念は最初から入っていない。
2. **一方で、PDF側・Excel側ともに、元の生データを（`source_record`／`source_raw_text`として）レコードに保持している。** これは、既存のJSON生成パイプライン自体を改修しなくても、**この生データに対して`extractQuantities()`等を後から適用する後処理ステップを追加できる**ことを意味する。既存の`buildTraceOutput()`・`makeTraceRecord()`のフィールド構成を変更・追加する改修（リスクが本体全体に及ぶ）と、既存の出力へ外付けで新フィールドを付加する改修（リスクが局所化できる）の2通りの設計が考えられ、後者の方が既存機能への影響が小さい可能性が高い（ただし実際の改修コストの見積もりはまだ行っていない）。

**未実施の調査（次工程で必要）**：
- ユーザー提案の`trace-comparison/1.0`の正式スキーマ設計（7.2節・7.3節を踏まえた、後付け方式か拡張方式かの判断を含む）。

> **補足（7.3節で一部実施）**：「実際に`spec_to_json_conversion_tool`・`excel_to_json_conversion_tool`を動かしてリアルな出力を取得する」こと自体は、別セッションの`samples/hvac_trace_sample_small/verification_report.md`（2026-07-17付）で既に実施・検証済みだったため、本セッションでは新規のPDF/Excel生成は行わず、その検証済みサンプルを再利用した（7.3節）。したがって「未実施」なのは、そのサンプルを使った**照合エンジンの実行検証**ではなく、あくまで`trace-comparison/1.0`の正式スキーマ設計のみである。

### 7.2 照合エンジン（json_ab_trace_matching_tool_v12.1.15.html）の調査（完了）

ユーザー指定の4段階（入力・正規化／候補ペア生成／スコア構造／結果の保存・再読込）に沿って、実際のコードを読んで確認した。**本節自体はすべて実行はせず、静的にコードを読んだ結果である**（実ブラウザでの裏取りは7.3節を参照。7.3節で1件、本節の結論を訂正している）。

#### 7.2.1 入力・正規化

読込パイプラインは`prepareInputData(rawData, schemaName)`（2654行目）で、次の順に処理する。

```
adaptDocumentJsonToTraceRecords()  // 2613行目：文書JSON(sections配列等)を trace_records へ変換するアダプタ
  → extractRecordList()            // 2385行目：JSON内から候補となる配列を探索
  → canonicalizeRows()             // 2402行目：フィールド名のゆらぎを吸収
  → annotateGranularity()          // 粒度注釈(表示・集計専用、照合ロジックには不使用)
```

**`chapter-section-trace-v1`／`excel-row-trace-v1`のような、既に`_trace_records`を持つ「照合用JSON」（本体が主に受け取る入力）に対しては、`adaptDocumentJsonToTraceRecords()`は素通りする。** `detectDocumentJsonKind()`（2438行目）は`document_type`・`requirements`配列・`purchase_spec_items`／`target_parts`配列・`sections`配列の有無だけで判定しており、`_trace_records`や`trace_format`は一切見ていない。したがって`_trace_records`を持つ入力はこのアダプタでは検出されず（`kind === ''`）、素の`rawData`のまま次段へ渡る。

次段の`extractRecordList()`は`findRecordArrays()`（2360行目）でJSON内の**あらゆる配列**を再帰的に列挙し、`arrayScoreForSchema()`（2375行目）で最もそれらしい配列を選ぶ。ただし**`INPUT_FIELD_SCHEMAS.sys.fields`・`INPUT_FIELD_SCHEMAS.plm.fields`はいずれも空オブジェクト`{}`**（2292〜2295行目）であり、フィールド名に基づく意味的なスコアリングは実質機能していない（`arrayScoreForSchema()`の計算式は主に配列サイズで決まる）。`_trace_records`は通常最大の配列になるため、これが自動選択される可能性が高い。

続く`canonicalizeRows()`（2402行目）は`const out = {...row}`で**元の行の全フィールドをまず複製し**、その後スキーマに定義された既知フィールド（今回は空なので実質何もしない）だけを上書きする。

**結論：`_trace_records`配下の各レコードが持つ未知フィールド（`source_record`・`source_raw_text`を含む）は、入力・正規化の全段階を通じて変更されずに残る。** レビューが指摘した「照合エンジンが未知フィールドや`source_record`を保持するか、正規化時に捨てるか」という分岐点について、**「保持する」側であることをコードで確認した**。これにより、PDF/Excel側の生成パイプラインを一切変更せず、生データに対する後付けの数量抽出ステップを追加できる、という7.1節の見立てが裏付けられた。

#### 7.2.2 候補ペア生成

`candidateEntriesForSys(sysItem, plmList)`（5274行目）が担う。B側件数が閾値（`settings.smallDataThreshold`）以下の小規模データでは、**全A×B総当たり**（候補の絞り込みなし）で処理する。閾値を超える場合は、`buildCandidateIndex()`で構築した転置インデックス（コード・タグ・fuzzy語による索引）を使い、該当しそうなB側行だけに候補を絞り込む。この絞り込みは完全にテキスト・タグベースであり、数量やその他の構造化データは一切関与しない。

`matchPlmParts(sysItem, plmList)`（5378行目）が実際の照合を統括する：候補ごとに`bestMatchForPlm()`（タグ一致があれば`evaluateTagMatch()`優先）でスコアを求め、MLモデルが有効なら確信度を置き換え、`applyFieldGates()`で調整し、`matchLogic.minConfidence`（既定`0.7`）未満を除外し、B側の安定キーで重複排除、`applyHierarchyGate()`で階層フィルタをかけ、最終的にもう一度確信度で足切りする。

#### 7.2.3 スコア構造

`bestMatchForPlm(sysItem, plm)`（4980行目）は、有効な列ペア（`activeKeyPairs()`）ごとに`calcPairMatch(keyword, plm, pair)`（4542行目）を呼び、最良のものを採用する。`calcPairMatch()`は完全一致・コード一致・型番一致・同義語一致・ファジー一致（bigram類似度）・ベクトル一致（tfidfコサイン類似度・トークンJaccard）等、**すべてテキスト類似度に基づく手法**でスコアを出す。数量・単位・充足判定に相当する処理は存在しない。

最終的な照合レコード（`matchPlmParts()`内、5429行目）は次の形：

```js
{ ...c.plm, matchedKeyword, confidence: c.conf, matchMethod, _features, _matchedSysField, _matchedPlmField, /* +非表示プロパティ */ }
```

**`{...c.plm, ...}`によりB側行の全フィールドがそのまま照合レコードへスプレッドされる。** これも7.2.1と同じく、B側行に将来`quantity`・`interval_semantics_candidates`等のフィールドがあれば、そのまま照合レコードにも引き継がれることを意味する。また、`confidence`（表示上は「信頼度」列）は本調査で確認した通り**純粋にテキスト一致度のスコアであり、数値要求の充足可否とは無関係**。レビューが懸念した「関連度が高いから要求を満たすという誤解」を避けるには、数量比較の結果をこの`confidence`計算式へ混ぜ込まず、別フィールドとして持たせる設計が、既存コードの構造からも自然である（ユーザー提案の並行レイヤー方式を支持する結果）。

#### 7.2.4 結果の保存・再読込

- 照合結果一覧・トレースマトリクスの行は、内部の`{...c.plm, confidence, ...}`形式とは別に、`A_ID`・`B_表示名`・`信頼度`・`方式`・`根拠`・`レビュー判定`等、**日本語ラベルのフラットな表示用行**（`traceMatrixRows`）へ変換される。
- **`A_ID`／`B_ID`の解決**：`sysRowId()`（4459行目）→`rowStableId()`（4440行目）を辿ると、`rowStableId()`は候補フィールドの優先順位で「フィールド名を正規化して`traceid`と一致するもの」を最優先で採用する（4444行目・4454行目）。A側（`sysRowId()`）はこの`rowStableId()`を直接呼ぶため、**元のPDF側`trace_id`の値がそのまま`A_ID`として使われる。**

  > **訂正（`runtime_fixtures/runtime_verification.md`で判明）**：上記の「`trace_id`同士の対応を保持している」という結論は、B側（`B_ID`）には当てはまらないことを実ブラウザ実行で確認した。B側は`plmUniqueKey()`→`plmBusinessKey()`が`plmCode`／有効なコード列／`plmText`等の項目を`rowStableId()`のtrace_id優先ロジックより**先に**試すため、実行結果では`B_ID`が`"5"`〜`"9"`のような`source_row`風の値になり、B側`trace_id`（`"design-use-temperature"`等）とは一致しなかった。**したがって`trace_id`同士の対応は保持されているとは言えない。** sidecarスキーマの`actual_trace_id`は、照合エンジンが表示する`B_ID`ではなく、B側レコード自身が持つ`trace_id`フィールドを直接参照して引き当てる設計にする必要がある。
- **レビュー状態の永続化**：ブラウザの`localStorage`（キー`v11_trace_review_store`、6913〜6917行目）に、`_reviewKey`（`traceReviewKeyFromValues(A_ID, B_ID, category)`で生成）をキーとして保存される。JSONファイルへの直接の書き出しではなく、ブラウザのローカルストレージが一次保存先である点に注意（レビューパッケージとしてエクスポート・インポートする機能も別途存在する`importTraceReviewPackage()`、9733行目、詳細な調査は未実施）。
- **前回との差分表示**：`normalizeTraceSnapshot()`（6990行目）・`applyTraceDiff()`（6997行目）が、`A_ID`＋`B_ID`＋分類から求めたキーで前回スナップショットと突き合わせ、「新規」「変更」「変化なし」「消滅」を判定する。この差分判定は「分類」「方式」「信頼度」の3項目だけを見ており、将来`quantity_comparison`のような新フィールドを追加しても、既存の差分ロジックはそのフィールドの変化を検知しない（表示上の差分機能を拡張したい場合は別途対応が必要）。
- **簡易版（`json_ab_trace_matching_tool_lite_v1.5.html`）との関係**：`tools/README.md`の記載によれば、簡易版は「フル版と同じ自動照合エンジン（信頼度ルールは既定値で内部固定、UIでの編集は不可）」を維持しているとされる。この記載を確認根拠としており、簡易版のコードそのものは今回読んでいない。

#### 7.2.5 この調査から導かれる設計方針

ユーザー提案の並行レイヤー方式（`trace-comparison/1.0`を独立したレコードとし、既存のA/B trace recordを変更しない）は、次の3つの事実によって具体的に裏付けられる。

1. 入力正規化は未知フィールドを保持する（7.2.1）ため、既存レコードへ後付けでフィールドを追加しても壊れない。実ブラウザ実行でも、合成フィールド（`quantity_analysis`）が正規化・照合・エクスポートの全段階を通じて欠落しないことを確認した（`runtime_fixtures/runtime_verification.md` §3.3）。
2. 照合レコードもB側の全フィールドをスプレッドする（7.2.3）ため、後付けフィールドは照合結果にも自然に伝播する（同上で確認）。
3. ~~`trace_id`が`A_ID`／`B_ID`として一貫して使われる（7.2.4）~~ → **上記の訂正の通り、A側は`trace_id`と一致するがB側（`B_ID`）は一致しない。** そのため`requirement_trace_id`（A側）は既存の`A_ID`とみなせるが、`actual_trace_id`（B側）は照合エンジンの`B_ID`に頼らず、B側レコード自身の`trace_id`フィールドを直接引き当てる設計にする。

一方で、次の点は既存コードへの追加対応が必要になる（未着手）。
- 差分表示（`applyTraceDiff()`）は「分類」「方式」「信頼度」の3項目しか見ておらず、`quantity_comparison`の変化を検知しない。
- 照合結果一覧・トレースマトリクスのUI（`traceMatrixRows`等の日本語ラベル行）に、数量比較結果を表示する列を追加するには、別途UI改修が要る。
- レビュー状態の永続化は`localStorage`が一次的であり、`quantity_comparison`のreview状態をどこに persist するか（既存の`_reviewKey`と同じ仕組みに相乗りするか、別のキー空間にするか）は未検討。
- **配列選択リスク（実ブラウザ実行で確認、修正済み）**：`findRecordArrays()`／`arrayScoreForSchema()`は`INPUT_FIELD_SCHEMAS.sys/plm.fields`が空オブジェクトのため意味的な判定を行わず、実質「JSON内で最大の配列を選ぶ」動作になっている。B側レコード内に`_trace_records`（実データでは5件）より要素数の多いネスト配列が存在すると、そちらが誤って選択されデータソースが丸ごと入れ替わることを閾値実験で確認した（trapSize 5以下は安全、6以上でハイジャック。`runtime_fixtures/array_selection_risk_results.json`）。**この本体側の脆弱性そのものを`extractRecordList()`の修正で解消済み**（7.3節・7.4節、`json_ab_trace_matching_tool_v12.1.15.html`）。sidecar設計上も、候補配列（例：`interval_semantics_candidates`）をB側レコード直下に生の配列として置く構成は引き続き避け、オブジェクト内にネストするのが望ましい（本体側の修正は「今回確認した特定の混入パターン」への対処であり、あらゆる配列混入パターンを一般的に無害化するものではないため、多重の防御として両方を維持する）。

### 7.3 実ブラウザ出力による検証（完了、一部制約あり）

7.2節までの調査はすべて静的なコード読解によるものだったため、Playwright（CDNライブラリはローカルのnpmパッケージへ差し替えて読み込む手法。手法自体は`samples/hvac_trace_sample_small/verification_report.md`が先行して確立していたものを再利用）を使い、`json_ab_trace_matching_tool_v12.1.15.html`を実際にブラウザで実行して裏取りを行った。詳細な手順・全結果は`tools/design_notes/runtime_fixtures/runtime_verification.md`に記録している。

**スコープ上の判断**：PDF/Excel側の新規出力生成はこのセッションでは行わず、既に検証済みの`samples/hvac_trace_sample_small/JSON_A_customer_requirements_trace.json`／`JSON_B_design_review_trace.json`を入力として再利用した（理由は上記7.1節末尾の補足を参照）。したがって、本節の検証範囲は**照合エンジン側の実行時挙動**に限られ、PDF/Excel生成ツール自体の実ブラウザ出力の再検証は含まない。

確認できたこと：
1. **未知フィールドの生存**：B側レコードへ注入した合成フィールド`quantity_analysis`と、元々の`source_record`は、いずれも正規化・照合・エクスポート（`mergedResult.plmList`）の全段階で欠落せず残ることを確認した（7.2.1・7.2.3の静的解析を裏付ける）。
2. **配列選択リスク（発見・修正済み）**：`_trace_records`より要素数の多いネスト配列がB側レコード内に存在すると、照合エンジンのデータソース選択がそちらへ完全にハイジャックされることを、しきい値実験（trapSize 0/4/5/6/10/50/200）で確認した。実データ件数（5件）に対し、trapSize 5以下は安全、6以上でハイジャックという正確な境界を確認した（`array_selection_risk_results.json`）。`extractRecordList()`に`_trace_records`を最優先で採用する分岐を追加して修正し、`source_record`配下にtrapSize 200の配列を仕込んでも実データ5件が正しく選ばれることを回帰テストで確認した（`array_selection_fix_verification.json`）。
3. **B_IDの訂正（重要）**：A_IDはA側`trace_id`と一致するが、**B_IDはB側`trace_id`と一致しない**（`plmBusinessKey()`が`trace_id`優先ロジックより先に他項目を試すため）。7.2.4節の該当箇所を訂正済み。
4. **レビューパッケージの構造**：`window.exportTraceReviewPackage()`の実出力を確認した（キー: `schemaVersion`/`tool`/`exportedAt`/`profile`/`reviews`/`manualRelations`/`replacements`/`trainingFeedback`/`traceSnapshot`/`resultMode`/`mlFeatureVersion`/`datasetSignature`/`overviewScopeDecisions`/`phase7Version`）。

**未確認のまま残った点（今回の検証で埋まらなかったギャップ、後回しでよいと判断）**：
- ダウンロードボタン（`#downloadJsonBtn`／`#traceReviewExportBtn`）のクリック→ダウンロードという実際のUI経路そのものは検証できていない。両ボタンとも、タブを開いた後も`disabled`のままだったため、代わりに内部データ（`mergedResult`・`window.exportTraceReviewPackage()`）を`page.evaluate()`経由で直接取得する方法（`samples/hvac_trace_sample_small/verification_report.md`が先行して用いた手法と同じ）で代替した。原因は未特定（ボタンを再バインドする`cloneAndBind()`パターンが影響している可能性はあるが未確認）。
- レビューパッケージの再取り込み（`importTraceReviewPackage()`）によるレビュー状態の復元は未検証。
- quantity比較の差分表示・UI列追加・localStorageのキー設計・簡易版のコード確認：いずれも`trace-comparison/1.0`の`review`構造が固まってから検証する方が効率的なため、正式スキーマ設計後に回す。

PDF側`source_raw_text`の生存確認は、スキーマ設計に直接影響する項目のため、後回しにせず7.4節で実施した。

### 7.4 スキーマ設計に直接影響する3点の先行対応

正式スキーマ設計に着手する前に、レビューで指摘された「配列選択のハイジャック」「ペアIDのデータ契約」「PDF側原文保持」の3点を先行して処理した。

**1. 配列選択の明示的優先（修正済み）**：上記7.3節2番目の通り、`extractRecordList()`へ`_trace_records`最優先の分岐を追加し、回帰テストで確認した（`json_ab_trace_matching_tool_v12.1.15.html`、コミット済み）。

**2. ペアIDのデータ契約（確定）**：7.2.4節の訂正（A_ID=A側trace_id、B_ID≠B側trace_id）を踏まえ、次の契約を`trace-comparison/1.0`の不変条件として確定する（§4の6番目にも追記済み）。

```json
{
  "requirement_ref": {
    "trace_id": "req-use-temperature",
    "matcher_id": "req-use-temperature"
  },
  "actual_ref": {
    "trace_id": "design-use-temperature",
    "matcher_id": "5",
    "source_row": 5
  }
}
```

- 主キー（sidecarレコードが要求側・実仕様側のどのレコードを指すかの一意な参照）には、必ず元レコード自身の`trace_id`（`requirement_ref.trace_id`／`actual_ref.trace_id`）を使う。
- `matcher_id`は照合エンジンが表示する`A_ID`／`B_ID`をそのまま保持するフィールドとし、既存UI（トレースマトリクス等）との対応付けにのみ用いる。A側は`matcher_id === trace_id`が常に成立するが、B側は成立するとは限らない（`source_row`等、別の値になり得る）ことを前提にする。
- `comparison_id`は`requirement_ref.trace_id + actual_ref.trace_id + quantity_pair_id`から生成する（`matcher_id`は使わない）。これにより、照合エンジンの内部ID割当が変わっても（例：行の並び順が変わり`B-5`が別レコードを指すようになっても）sidecarの参照は安定する。

**3. PDF側`source_raw_text`の生存確認（完了）**：Excel側（`source_record`）と同じ手法で、PDF側の`source_raw_text`が入力JSON→`canonicalizeRows`→照合エンジン内部→`mergedResult`の全段階で一致することを確認した。使用した入力は`samples/hvac_trace_sample_small/JSON_A_customer_requirements_trace.json`（A側、`chapter-section-trace-v1`形式で`source_raw_text`を保持）。結果：`mergedResult.sysList`の各レコードで`source_raw_text`が入力JSONの値と完全一致することを確認した（`runtime_fixtures/pdf_source_raw_text_verification.json`）。これにより、7.1節で確認した「PDF側・Excel側ともに元の生データを保持する」という静的解析の結論は、B側（`source_record`）に続きA側（`source_raw_text`）についても実行時に裏付けられた。

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
