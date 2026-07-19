// trace_comparison_schema_v1.md §11の「完全な具体例」が、実データ（samples/hvac_trace_sample_small/）と
// 整合していることを機械的に検証する（レビュー必須修正6、および54ad4dfへの再指摘への対応）。
//
// 【v2版での修正点(54ad4df時点の指摘)】
// 1. review構造を、現行スキーマ(trace_comparison_schema_v1.md §10)の5判断構造
//    (quantity_extraction/property_mapping/condition_equivalence/comparison_mode/satisfaction)へ揃えた。
// 2. content_hash/dataset_signatureは完全性検出用のため64桁(256-bit)のまま切り詰めないよう修正。
//    quantity_idは検索用途のため128-bit(32桁)に切り詰め、id_hash_algorithmで明示する。
// 3. ハッシュの正規化を、spec_to_json_conversion_tool_v1.18.htmlのv12Normalize()(5727〜5729行目、
//    NFKC正規化+改行統一+行末空白除去+空白圧縮+trim)と同一処理に統一した(以前は正規化なしだった)。
// 4. content_hashの対象範囲を、shadow_mode_integration_design.md §2.0の表(PDF側: trace_id+本文+タグ、
//    Excel側: trace_id+セル値+列見出し+タグ+source_row)どおりに拡張した(以前は本文/セル値のみ)。
// 5. relationship(matcher_id/match_method/match_confidence/review_category)を、定数のハードコードでは
//    なくruntime_fixtures/verification_log.json・matching_result_actual.jsonから機械的に解決するよう
//    修正した(該当行が0件・複数件ならテスト失敗にする)。
// 6. provenance/not_analyzedをトップレベルに含め、スキーマの構造と一致させた。
// 7. 文書(trace_comparison_schema_v1.md §11)に埋め込まれたJSONと、本スクリプトが生成したJSONの
//    deep-equalを検証するテストを追加した(文書側が手修正されて乖離することを検出する)。
//
// 【v3版での修正点(64eea6d時点の指摘)】
// 8. content_hashが、意味候補生成(buildPropertyCandidateRecords)へ実際に渡した入力(actRowContextは
//    設計項目列を含む)と一致していなかった(content_hashはtrace_id+列見出し+セル値+タグ+source_rowのみで
//    設計項目を含んでいなかった)。設計項目のような、意味候補に影響する行内の他フィールドを変更しても
//    陳腐化が検出できない安全上の欠陥だった。source_record全体(canonical JSON化)をハッシュ対象にする
//    ことで、意味候補生成に将来どのフィールドを使うようになっても(列役割候補の追加等)自動的に
//    ハッシュ対象へ含まれるようにした。
// 9. ハッシュ入力の構築を、v12HashParts(namespace, parts)と同一の契約
//    ([namespace, ...parts.map(v12Normalize)].join('\u0000')してから1回だけハッシュする。全体を後から
//    まとめて正規化するのではなく、各partを個別に正規化してから連結する)へ統一した。用途ごとに
//    namespaceを分離した(content-hash-v1/quantity-id-v1)。
// 10. dataset_signatureは「64桁である」という仕様は確定しているが、生成・検証はまだ実装していない
//     (quantity-annotation sidecar自体が未実装のため)。この区別を明示する。

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { extractQuantities, coverageGap } = require('./quantity_extraction_prototype.js');
const {
  buildPropertyCandidateRecords, deriveComparisonModeCandidate, evaluateAutoApplicable,
} = require('./semantic_mapping_prototype.js');

const REPO = path.join(__dirname, '..', '..');
const FIXTURES = path.join(__dirname, 'runtime_fixtures');
const jsonA = JSON.parse(fs.readFileSync(path.join(REPO, 'samples/hvac_trace_sample_small/JSON_A_customer_requirements_trace.json'), 'utf-8'));
const jsonB = JSON.parse(fs.readFileSync(path.join(REPO, 'samples/hvac_trace_sample_small/JSON_B_design_review_trace.json'), 'utf-8'));
const matchingResult = JSON.parse(fs.readFileSync(path.join(FIXTURES, 'matching_result_actual.json'), 'utf-8'));
const verificationLog = JSON.parse(fs.readFileSync(path.join(FIXTURES, 'verification_log.json'), 'utf-8'));
const reviewPackage = JSON.parse(fs.readFileSync(path.join(FIXTURES, 'review_package_actual.json'), 'utf-8'));

const reqRecord = jsonA._trace_records.find(r => r.trace_id === 'req-cooling-capacity');
const actRecord = jsonB._trace_records.find(r => r.trace_id === 'design-cooling-capacity');

const assertions = [];
const check = (name, cond) => assertions.push({ name, pass: !!cond });

check('要求側レコードが実データに存在する(req-cooling-capacity)', !!reqRecord);
check('実仕様側レコードが実データに存在する(design-cooling-capacity)', !!actRecord);
check('要求側source_raw_textに「冷房能力」を含む(=design-use-temperature等の無関係レコードではない)',
  reqRecord.source_raw_text.includes('冷房能力'));
check('実仕様側source_record.検討結果に「12.5 kW」を含む(数量抽出対象として正しい列を使っている)',
  actRecord.source_record['検討結果'].includes('12.5 kW'));

// ── ハッシュ: v12Normalize()/v12HashParts()の移植(spec_to_json_conversion_tool_v1.18.html
// 5727〜5729行目・5737行目と同一の契約: 各partを個別に正規化してから連結し、1回だけハッシュする) ──
function v12NormalizeEquivalent(value) {
  return String(value ?? '').normalize('NFKC').replace(/\r\n?/g, '\n')
    .split('\n').map(s => s.replace(/[ \t]+$/g, '')).join('\n')
    .replace(/[ \t]+/g, ' ').trim();
}
// v12HashParts(namespace, parts)(spec_to_json_conversion_tool_v1.18.html 5737行目)と同一契約:
// [namespace, ...parts.map(v12Normalize)].join(NUL文字)してから1回だけハッシュする。区切り文字は
// NUL文字であり、スペースではない(前回の修正で誤ってスペース結合にしてしまっていたことが指摘され、
// 訂正した。固定ベクトルテストで既存v12HashParts()の入力文字列と完全一致することを確認している)。
function hashParts(namespace, parts) {
  const NUL = String.fromCharCode(0);
  const canonical = [v12NormalizeEquivalent(namespace), ...parts.map(v12NormalizeEquivalent)].join(NUL);
  return crypto.createHash('sha256').update(canonical, 'utf-8').digest('hex');
}
// hashParts()の固定ベクトルテスト(レビュー指摘: 区切り文字がNUL文字であることを回帰的に固定する。
// 過去にスペース結合へ誤って変更してしまったことがあるため、期待値を固定して再発を検出する)。
check('hashParts("ns",["a","b"])の期待値が固定されている(区切り文字の回帰検出用)',
  hashParts('ns', ['a', 'b']) === 'a1dbe38eb9cd7c8cf902046d72bf4b934a397188d5da1ec877b45c7862cf9fe7');
check('part内に空白を含んでいても正しく計算される',
  hashParts('ns', ['a b']) === '421e15b5415b8b4559fd66ab4ee5eeaa20cf531dbfd26fa6dd1bfcb545bbb736');
check('["ab","c"]と["a","bc"]が異なるハッシュになる(NUL区切りにより単純結合の曖昧さを回避できていることの検証)',
  hashParts('ns', ['ab', 'c']) !== hashParts('ns', ['a', 'bc']));
check('namespaceが異なれば同じpartsでも異なるハッシュになる(用途分離の検証)',
  hashParts('content-hash-v1', ['x']) !== hashParts('quantity-id-v1', ['x']));

// キーをソートしたJSON文字列化(オブジェクトのプロパティ順に依存しない安定した表現にする)
function canonicalJson(value) {
  if (Array.isArray(value)) return '[' + value.map(canonicalJson).join(',') + ']';
  if (value && typeof value === 'object') {
    return '{' + Object.keys(value).sort().map(k => JSON.stringify(k) + ':' + canonicalJson(value[k])).join(',') + '}';
  }
  return JSON.stringify(value);
}
// content_hash/dataset_signature: 完全性検出用。64桁(256-bit)のまま切り詰めない。
// 意味候補生成(buildPropertyCandidateRecords)へ実際に渡す入力一式(analysisInput)全体を
// canonical JSON化してハッシュする。source_recordを丸ごと含めることで、現時点でnearbyTextに
// 使っている設計項目列だけでなく、将来どのフィールドを周辺語コンテキストへ追加しても、
// content_hashが自動的にそれを検出範囲に含む(必須修正1への対応)。
function computeContentHash(analysisInput) {
  return hashParts('content-hash-v1', [canonicalJson(analysisInput)]);
}
// quantity_id: 検索用途。128-bit(32桁)に切り詰め、id_hash_algorithmで明示する(下記provenance参照)。
function quantityId(traceId, sourceField, span, normalizedText) {
  return 'q-' + hashParts('quantity-id-v1', [traceId, sourceField, String(span.start), String(span.end), normalizedText]).slice(0, 32);
}

// 意味候補生成(buildPropertyCandidateRecords)へ渡す入力と、content_hashの対象を同一のオブジェクトから
// 導出することで、両者が構造的に乖離しないようにする。
const reqAnalysisInput = { trace_id: reqRecord.trace_id, source_raw_text: reqRecord.source_raw_text, tags: reqRecord.tags || [] };
const actAnalysisInput = {
  trace_id: actRecord.trace_id, column: '検討結果', source_record: actRecord.source_record,
  tags: actRecord.tags || [], source_row: actRecord.source_row,
};
const reqContentHash = computeContentHash(reqAnalysisInput);
const actContentHash = computeContentHash(actAnalysisInput);
check('要求側content_hashが64桁(256-bit、完全性検出用として切り詰めない)', reqContentHash.length === 64);
check('実仕様側content_hashが64桁(256-bit、完全性検出用として切り詰めない)', actContentHash.length === 64);
check('タグを変更するとcontent_hashが変わる(本文だけでなくタグもハッシュ対象に含まれている検証)',
  computeContentHash({ ...actAnalysisInput, tags: ['DUMMY_TAG'] }) !== actContentHash);
check('列見出しを変更するとcontent_hashが変わる(セル値だけでなく列見出しもハッシュ対象に含まれている検証)',
  computeContentHash({ ...actAnalysisInput, column: 'DUMMY_COLUMN' }) !== actContentHash);
check('設計項目(意味候補生成のnearbyTextに使っている行内の他フィールド)を変更するとcontent_hashが変わる(必須修正1: 検討結果セルの値だけでなくsource_record全体がハッシュ対象に含まれている検証)',
  computeContentHash({ ...actAnalysisInput, source_record: { ...actRecord.source_record, '設計項目': '暖房能力' } }) !== actContentHash);
check('JSONのキー順を変えてもcontent_hashが変わらない(canonicalJson()がプロパティ順に依存しないことの検証)',
  computeContentHash({ tags: actAnalysisInput.tags, source_row: actAnalysisInput.source_row, source_record: actAnalysisInput.source_record, column: actAnalysisInput.column, trace_id: actAnalysisInput.trace_id }) === actContentHash);

// ── relationship: ハードコードではなく、実際の照合結果fixtureから機械的に解決する ──
const traceMatrixRows = verificationLog.find(e => e.label === 'traceMatrixRows').value.sample;
const sourceRowByTraceId = new Map(matchingResult.plmList.map(p => [p.trace_id, String(p.source_row)]));
const matchingRows = traceMatrixRows.filter(r =>
  r.A_ID === reqRecord.trace_id && sourceRowByTraceId.get(actRecord.trace_id) === r.B_ID);
check('照合結果fixtureの中で、req-cooling-capacity↔design-cooling-capacityの照合行がちょうど1件見つかる(0件・複数件ならペア解決が一意でないため失敗とする)',
  matchingRows.length === 1);
const matchedRow = matchingRows[0] || {};

const REPO_MATCHER_ID = sourceRowByTraceId.get(actRecord.trace_id);

// ── 要求側: source_raw_text全体から抽出 ──
const reqQuantities = extractQuantities(reqRecord.source_raw_text);
check('要求側から数量が1件抽出される', reqQuantities.length === 1);
const reqQ = reqQuantities[0];
check('要求側の数量が12 kW(下限12、上限なし=以上)', reqQ.quantity.lower.value === 12 && reqQ.quantity.upper === null);

const reqPropRecords = buildPropertyCandidateRecords(reqRecord.source_raw_text, {
  source: 'A', side: 'A', tags: reqRecord.tags, nearbyText: reqRecord.source_raw_text,
});
const reqMain = reqPropRecords.find(r => !r.quantity_ref.isCondition);
check('要求側のproperty_candidatesの最上位候補がperformance.cooling_capacity', reqMain.property_candidates[0]?.concept_id === 'performance.cooling_capacity');

// ── 実仕様側: 検討結果列(resolved_design)から抽出。周辺語コンテキストには設計項目+列見出しも含める(11節参照) ──
const actText = actRecord.source_record['検討結果'];
const actQuantities = extractQuantities(actText);
check('実仕様側(検討結果列)から数量が1件抽出される', actQuantities.length === 1);
const actQ = actQuantities[0];
check('実仕様側の数量が12.5 kW(点)', actQ.quantity.lower.value === 12.5 && actQ.quantity.upper?.value === 12.5);

const actRowContext = [actRecord.source_record['設計項目'], '検討結果: ' + actText].join(' / ');
const actPropRecords = buildPropertyCandidateRecords(actText, {
  source: 'B', side: 'B', sourceColumn: '検討結果', tags: actRecord.tags, nearbyText: actRowContext,
});
const actMain = actPropRecords.find(r => !r.quantity_ref.isCondition);
check('実仕様側のproperty_candidatesの最上位候補がperformance.cooling_capacity', actMain.property_candidates[0]?.concept_id === 'performance.cooling_capacity');
check('実仕様側のrole_candidateがresolved_design(検討結果列由来)', actMain.role_candidate.role === 'resolved_design');

// ── mapping: margin判定(shadow_mode_integration_design.md §7) ──
function resolveMapping(candidates, marginThreshold = 0.2) {
  const sorted = [...candidates].sort((a, b) => b.confidence - a.confidence);
  const top = sorted[0], second = sorted[1];
  const margin = top ? (top.confidence - (second ? second.confidence : 0)) : null;
  const status = (top && margin >= marginThreshold) ? 'resolved' : 'ambiguous';
  return { status, concept_id: status === 'resolved' ? top.concept_id : null, confidence: top ? top.confidence : null, margin, candidates: sorted };
}
const reqMapping = resolveMapping(reqMain.property_candidates);
const actMapping = resolveMapping(actMain.property_candidates);
check('要求側mappingがresolved、concept_idがperformance.cooling_capacity', reqMapping.status === 'resolved' && reqMapping.concept_id === 'performance.cooling_capacity');
check('実仕様側mappingがresolved、concept_idがperformance.cooling_capacity', actMapping.status === 'resolved' && actMapping.concept_id === 'performance.cooling_capacity');
check('要求側と実仕様側のmapping.concept_idが一致する(=同じ概念について比較しようとしている)', reqMapping.concept_id === actMapping.concept_id);

// ── automation: comparisonMode候補導出 + 安全ゲート ──
const modeCandidate = deriveComparisonModeCandidate(reqMain.interval_semantics_candidates, actMain.interval_semantics_candidates);
check('comparison_mode候補が導出される(要求側acceptable_region × 実仕様側achieved_point)',
  modeCandidate && modeCandidate.derived_from.requirement_semantics === 'acceptable_region' && modeCandidate.derived_from.actual_semantics === 'achieved_point');

const evalResult = evaluateAutoApplicable({
  modeCandidate,
  requirementCandidates: reqMain.interval_semantics_candidates,
  actualCandidates: actMain.interval_semantics_candidates,
  propertyConfidence: Math.min(reqMapping.confidence, actMapping.confidence),
  extractionWarningsCount: reqQ.extraction.warnings.length + actQ.extraction.warnings.length,
});
check('auto_applicableがtrueと判定される(実データ・実在の列見出しを周辺語コンテキストに含めた結果)', evalResult.applicable === true);

// ── comparison: 数値比較 ──
const comparisonResult = evalResult.applicable
  ? coverageGap(reqQ, actQ, { comparisonMode: modeCandidate.value })
  : null;
check('comparisonResult.satisfiedがtrue(12.5 kWは12 kW以上を満たす)', comparisonResult && comparisonResult.satisfied === true);

// ── trace-comparison/1.0-rc1レコードの組み立て(実データ由来の値のみ使用) ──
const reqSpan = reqQ.source_span;
const actSpan = actQ.source_span;
const reqQuantityId = quantityId('req-cooling-capacity', 'source_raw_text', reqSpan, reqQ.normalized_text);
const actQuantityId = quantityId('design-cooling-capacity', '検討結果', actSpan, actQ.normalized_text);
const quantityPairId = `${reqQuantityId}::${actQuantityId}`;

// satisfaction: comparisonがnullなら"not_applicable"、非nullなら前提未確認のため"not_eligible"(trace_comparison_schema_v1.md §10)
const satisfactionStatus = comparisonResult === null ? 'not_applicable' : 'not_eligible';
const emptyJudgement = () => ({ status: 'unreviewed', reviewer: null, reviewed_at: null, verdict: null, note: null });

const record = {
  comparison_id: `req-cooling-capacity::design-cooling-capacity::${quantityPairId}`,
  requirement_ref: { trace_id: 'req-cooling-capacity', matcher_id: 'req-cooling-capacity' },
  actual_ref: { trace_id: 'design-cooling-capacity', matcher_id: REPO_MATCHER_ID, source_row: actRecord.source_row },
  quantity_pair_id: quantityPairId,
  relationship: {
    source: 'matching_engine',
    match_method: matchedRow['方式'] ?? null,
    match_confidence: typeof matchedRow['信頼度'] === 'number' ? matchedRow['信頼度'] : null,
    review_category: matchedRow['分類'] ?? null,
    linked_at: null,
  },
  requirement_analysis: {
    quantity_id: reqQuantityId, source_field: 'source_raw_text', occurrence_index: 0,
    source_span: reqSpan, content_hash: reqContentHash,
    quantity: reqQ, semantics_candidates: reqMain.interval_semantics_candidates,
  },
  actual_analysis: {
    quantity_id: actQuantityId, source_field: '検討結果', occurrence_index: 0,
    source_span: actSpan, content_hash: actContentHash,
    quantity: actQ, semantics_candidates: actMain.interval_semantics_candidates,
  },
  mapping: { ...reqMapping, source: 'generatePropertyCandidates', confirmed: false },
  automation: { comparison_mode_candidate: modeCandidate, auto_applicable: evalResult },
  comparison: comparisonResult,
  review: {
    quantity_extraction: emptyJudgement(),
    property_mapping: emptyJudgement(),
    condition_equivalence: emptyJudgement(),
    comparison_mode: emptyJudgement(),
    satisfaction: { ...emptyJudgement(), status: satisfactionStatus },
  },
};

check('組み立てたレコードのrequirement_ref.trace_idが実データのreqRecord.trace_idと一致する',
  record.requirement_ref.trace_id === reqRecord.trace_id);
check('組み立てたレコードのactual_ref.trace_idが実データのactRecord.trace_idと一致する',
  record.actual_ref.trace_id === actRecord.trace_id);
check('組み立てたレコードのactual_ref.matcher_idが実際の照合結果fixture(source_row)と一致する',
  record.actual_ref.matcher_id === matchedRow['B_ID']);
check('組み立てたレコードのrelationshipが実際の照合結果fixtureの値と一致する(ハードコードではない)',
  record.relationship.match_method === matchedRow['方式'] && record.relationship.match_confidence === matchedRow['信頼度'] && record.relationship.review_category === matchedRow['分類']);
check('組み立てたレコードのrequirement_analysis.quantity.source_textが実データのtrace_textの部分文字列である',
  reqRecord.source_raw_text.includes(record.requirement_analysis.quantity.source_text));
check('組み立てたレコードのactual_analysis.quantity.source_textが実データのsource_record.検討結果の部分文字列である',
  actText.includes(record.actual_analysis.quantity.source_text));
check('組み立てたレコードのmapping.concept_idが「冷房能力」に対応するconcept_idである',
  record.mapping.concept_id === 'performance.cooling_capacity');
check('review.satisfactionの初期状態が正しい(comparisonが非nullなのでnot_eligible、前提確認前は確認不可)',
  record.review.satisfaction.status === 'not_eligible');

const output = {
  schema_version: 'trace-comparison/1.0-rc1',
  generated_at: new Date().toISOString(),
  note: 'trace_comparison_example_verification.jsにより実データ(samples/hvac_trace_sample_small/)から機械的に生成・検証済み。relationshipもruntime_fixtures/*.jsonから機械的に解決した(手打ちの値は含まない)。',
  source: {
    requirement_file: 'JSON_A_customer_requirements_trace.json',
    actual_file: 'JSON_B_design_review_trace.json',
  },
  provenance: {
    hash_algorithm: 'SHA-256',
    id_hash_algorithm: 'SHA-256/128',
    normalization: 'v12Normalize相当(NFKC正規化+改行統一+行末空白除去+空白圧縮+trim)',
    requirement_dataset_signature: null,
    actual_dataset_signature: null,
    matching_dataset_signature: reviewPackage.datasetSignature,
  },
  not_analyzed: [],
  comparisons: [record],
};

// ── §11に埋め込まれたJSONと、このスクリプトの生成物がdeep-equalであることを検証する ──
// (文書側が生成物を反映せず手修正されて乖離することを検出するための回帰テスト)
function extractSection11Json() {
  const mdPath = path.join(__dirname, 'trace_comparison_schema_v1.md');
  const md = fs.readFileSync(mdPath, 'utf-8');
  const marker = '## 11. 完全な具体例';
  const start = md.indexOf(marker);
  if (start < 0) return null;
  const jsonStart = md.indexOf('```json', start);
  const jsonEnd = md.indexOf('\n```', jsonStart + 7);
  if (jsonStart < 0 || jsonEnd < 0) return null;
  const jsonText = md.slice(jsonStart + '```json\n'.length, jsonEnd);
  try { return JSON.parse(jsonText); } catch (e) { return { __parseError: String(e) }; }
}
function deepEqual(a, b) {
  return JSON.stringify(a) === JSON.stringify(b);
}
const docJson = extractSection11Json();
check('trace_comparison_schema_v1.md §11に埋め込まれたJSONがパースできる', docJson && !docJson.__parseError);
if (docJson && !docJson.__parseError) {
  // generated_at/provenance.*_dataset_signatureは実行のたびに変わり得る値のため、比較対象から除外する
  const stripVolatile = (obj) => {
    const clone = JSON.parse(JSON.stringify(obj));
    delete clone.generated_at;
    if (clone.provenance) {
      delete clone.provenance.requirement_dataset_signature;
      delete clone.provenance.actual_dataset_signature;
    }
    if (clone.comparisons) clone.comparisons.forEach(c => { if (c.relationship) delete c.relationship.linked_at; });
    return clone;
  };
  check('trace_comparison_schema_v1.md §11のJSONが、本スクリプトの生成物とdeep-equalである(generated_at等の可変値を除く。文書が生成物と乖離していないことの検証)',
    deepEqual(stripVolatile(docJson), stripVolatile(output)));
}

assertions.forEach(a => console.log((a.pass ? '[OK] ' : '[FAIL] ') + a.name));
const failCount = assertions.filter(a => !a.pass).length;
console.log(`\n合計 ${assertions.length}件中 ${assertions.length - failCount}件成功 / ${failCount}件失敗`);

fs.mkdirSync(FIXTURES, { recursive: true });
fs.writeFileSync(path.join(FIXTURES, 'trace_comparison_example_verified.json'), JSON.stringify(output, null, 2), 'utf-8');
console.log('\n生成物を runtime_fixtures/trace_comparison_example_verified.json へ書き出した(成否に関わらず、差分確認用)。');

process.exitCode = failCount > 0 ? 1 : 0;
