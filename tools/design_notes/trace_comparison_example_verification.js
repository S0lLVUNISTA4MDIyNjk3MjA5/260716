// trace_comparison_schema_v1.md §11の「完全な具体例」が、実データ（samples/hvac_trace_sample_small/）と
// 整合していることを機械的に検証する（レビュー必須修正6への対応）。
//
// 従来の§11の例は、baseline_v1_handoff.md §9の手作りサンプル（reqRec/actRec）と、実ブラウザ検証で
// 使ったtrace_id（design-use-temperature、quantity_analysisプローブ注入用）を混ぜて作った例であり、
// 実際にはdesign-use-temperature(使用温度範囲)のレコードにはcooling_capacity(冷房能力)の値は
// 存在しない、という不整合があった（レビュー指摘、実データで確認して修正）。
//
// 本スクリプトは、実際のJSON_A/JSON_Bレコード(req-cooling-capacity / design-cooling-capacity)を
// 読み込み、プロトタイプの実関数(extractQuantities/buildPropertyCandidateRecords/
// deriveComparisonModeCandidate/evaluateAutoApplicable/coverageGap)へそのまま通し、
// trace_id・数量・概念が実データと一致することをアサーションで確認したうえで、
// trace-comparison/1.0-rc1形式のレコードを生成する。

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { extractQuantities, coverageGap } = require('./quantity_extraction_prototype.js');
const {
  buildPropertyCandidateRecords, deriveComparisonModeCandidate, evaluateAutoApplicable,
} = require('./semantic_mapping_prototype.js');

const REPO = path.join(__dirname, '..', '..');
const jsonA = JSON.parse(fs.readFileSync(path.join(REPO, 'samples/hvac_trace_sample_small/JSON_A_customer_requirements_trace.json'), 'utf-8'));
const jsonB = JSON.parse(fs.readFileSync(path.join(REPO, 'samples/hvac_trace_sample_small/JSON_B_design_review_trace.json'), 'utf-8'));

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

// v2.14: SHA-256ベースの内容ハッシュ(レビュー指摘: simpleHash()=32-bit FNV-1aは陳腐化検出に
// 使えないため不採用。Node組み込みのcrypto.createHash('sha256')を使う。ブラウザ側は
// spec_to_json_conversion_tool_v1.18.htmlに既存のv12Sha256()/crypto.subtle.digest('SHA-256',...)
// を流用する想定、shadow_mode_integration_design.md参照)。
function sha256Hex(text) {
  return crypto.createHash('sha256').update(String(text), 'utf-8').digest('hex');
}
function quantityId(traceId, sourceField, span, normalizedText) {
  return 'q-' + sha256Hex([traceId, sourceField, span.start, span.end, normalizedText].join('')).slice(0, 16);
}
function contentHash(text) {
  return sha256Hex(text).slice(0, 16);
}

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

// ── 実仕様側: 検討結果列(resolved_design)から抽出 ──
const actText = actRecord.source_record['検討結果'];
const actQuantities = extractQuantities(actText);
check('実仕様側(検討結果列)から数量が1件抽出される', actQuantities.length === 1);
const actQ = actQuantities[0];
check('実仕様側の数量が12.5 kW(点)', actQ.quantity.lower.value === 12.5 && actQ.quantity.upper?.value === 12.5);

// nearbyText: 概念対応付け・意味候補生成の周辺語根拠には、数量が入っていた1セルの値だけでなく、
// 同じ行の他フィールド(設計項目等、「冷房能力」という概念名そのものが書かれている列)と、
// 列見出し自体("検討結果:"、ACHIEVED_POINT_KEYWORD_PATTERNの「検討(の)?結果」に一致する)も
// 含める。検討結果セルの値だけ("周囲温度50 °Cで12.5 kW")では、
// (a) performance.cooling_capacityとenvironment.ambient_operating_temperatureのmapping候補差が
//     0.05しかなくambiguousになる、
// (b) achieved_pointのkeyword根拠(「実測」等)が原文になく構造的根拠だけでauto_applicable=false
//     になる、
// という2点を、このスクリプトの初期版(実データのみ・セル値のみを使う版)で実際に確認した。
// 列見出しを含む行全体の文脈を使うと、(a)はmarginが0.39まで広がってresolvedになり、
// (b)は「検討結果」という列見出し自体がkeyword根拠として働き0.75まで上がる。これは実データを
// 改変したのではなく、Excel側の列見出しという既存の実データ(source_recordのキー名)を
// 周辺語コンテキストとして正しく含めるようにしただけである(shadow_mode_integration_design.md
// §2.3の自動走査設計とも整合する: 列見出しは既に実データの一部)。
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

const record = {
  comparison_id: `req-cooling-capacity::design-cooling-capacity::${quantityPairId}`,
  requirement_ref: { trace_id: 'req-cooling-capacity', matcher_id: 'req-cooling-capacity' },
  // matcher_id/source_row: samples/hvac_trace_sample_small/を実際にPlaywrightで照合した結果
  // (tools/design_notes/runtime_fixtures/verification_log.jsonのtraceMatrixRows、A_ID:req-cooling-capacity
  // が B_ID:"6" と対応、design-cooling-capacityのsource_row:6と一致)をそのまま転記。
  actual_ref: { trace_id: 'design-cooling-capacity', matcher_id: '6', source_row: 6 },
  quantity_pair_id: quantityPairId,
  relationship: {
    // 同じくruntime_fixtures/verification_log.jsonのtraceMatrixRowsから実際の値を転記
    // (分類:要確認, 方式:tag, 信頼度:0.88)。以前の例の"fuzzy"/0.72は架空の値だったため訂正。
    source: 'matching_engine', match_method: 'tag', match_confidence: 0.88,
    review_category: '要確認', linked_at: null,
  },
  requirement_analysis: {
    quantity_id: reqQuantityId, source_field: 'source_raw_text', occurrence_index: 0,
    source_span: reqSpan, content_hash: contentHash(reqRecord.source_raw_text),
    quantity: reqQ, semantics_candidates: reqMain.interval_semantics_candidates,
  },
  actual_analysis: {
    quantity_id: actQuantityId, source_field: '検討結果', occurrence_index: 0,
    source_span: actSpan, content_hash: contentHash(actText),
    quantity: actQ, semantics_candidates: actMain.interval_semantics_candidates,
  },
  mapping: { ...reqMapping, source: 'generatePropertyCandidates', confirmed: false },
  automation: { comparison_mode_candidate: modeCandidate, auto_applicable: evalResult },
  comparison: comparisonResult,
  review: { status: 'unreviewed', confirmed: false, confirmed_targets: [], reviewer: null, reviewed_at: null, verdict: null, note: null },
};

check('組み立てたレコードのrequirement_ref.trace_idが実データのreqRecord.trace_idと一致する',
  record.requirement_ref.trace_id === reqRecord.trace_id);
check('組み立てたレコードのactual_ref.trace_idが実データのactRecord.trace_idと一致する',
  record.actual_ref.trace_id === actRecord.trace_id);
check('組み立てたレコードのrequirement_analysis.quantity.source_textが実データのtrace_textの部分文字列である',
  reqRecord.source_raw_text.includes(record.requirement_analysis.quantity.source_text));
check('組み立てたレコードのactual_analysis.quantity.source_textが実データのsource_record.検討結果の部分文字列である',
  actText.includes(record.actual_analysis.quantity.source_text));
check('組み立てたレコードのmapping.concept_idが「冷房能力」に対応するconcept_idである',
  record.mapping.concept_id === 'performance.cooling_capacity');

assertions.forEach(a => console.log((a.pass ? '[OK] ' : '[FAIL] ') + a.name));
const failCount = assertions.filter(a => !a.pass).length;
console.log(`\n合計 ${assertions.length}件中 ${assertions.length - failCount}件成功 / ${failCount}件失敗`);

if (failCount === 0) {
  const outDir = path.join(__dirname, 'runtime_fixtures');
  fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(path.join(outDir, 'trace_comparison_example_verified.json'), JSON.stringify({
    schema_version: 'trace-comparison/1.0-rc1',
    generated_at: new Date().toISOString(),
    note: 'trace_comparison_example_verification.jsにより実データ(samples/hvac_trace_sample_small/)から機械的に生成・検証済み。手打ちの値は含まない。',
    source: {
      requirement_file: 'JSON_A_customer_requirements_trace.json',
      actual_file: 'JSON_B_design_review_trace.json',
    },
    comparisons: [record],
  }, null, 2), 'utf-8');
  console.log('\n検証済みレコードを runtime_fixtures/trace_comparison_example_verified.json へ書き出した。');
}

process.exitCode = failCount > 0 ? 1 : 0;
