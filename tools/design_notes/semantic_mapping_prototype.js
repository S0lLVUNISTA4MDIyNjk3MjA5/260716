// 工程3（意味対応付けの候補生成）たたき台プロトタイプ
// 工程4a(quantity_extraction_prototype.js)の抽出結果に対し、
// 「どの設計特性(concept_id)を表すか」「その文書内でどんな役割(role)を持つか」の
// 候補を生成する。候補は必ず確信度付きであり、確定はしない。
//
// 設計原則(quantity_extraction_prototype_review.md 7章と同じ):
//   数量抽出(工程4a)は、その値が何の設計特性を表すかを確定する工程ではない。
//   意味対応付け(工程3)も、候補提示までであり、最終確定は人間が行う。
//
// 依存ライブラリなし。 `node semantic_mapping_prototype.js` で単体実行できる。
//
// 【解決済みの問題】本プロトタイプで工程4aのcoverageGap()を概念グループ単位に
// 自動適用したところ、coverageGap()自体に比較方向の設計上の欠陥が見つかった
// （片側閾値要求 vs 単一の達成値の比較方向が、範囲vs範囲の比較方向のまま固定されていた）。
// 工程4a v2.4で、実仕様側の値が「点」か「範囲」かにより比較方向を切り替える修正を行い、解決済み。
// 詳細は quantity_extraction_prototype.md 5.7節、quantity_extraction_prototype_review.md
// の追加レビュー依頼を参照。

const { extractQuantities, coverageGap } = require('./quantity_extraction_prototype.js');

// ── 概念辞書(たたき台)。案件の共通タグ辞書と同じ語彙をここでも利用する ──
const CONCEPT_DICTIONARY = [
  {
    concept_id: 'environment.ambient_operating_temperature',
    label: '周囲使用温度',
    expected_dimension: 'temperature',
    keywords: ['周囲温度', '使用温度', '運転温度'],
    tags: ['使用温度'],
  },
  {
    concept_id: 'performance.cooling_capacity',
    label: '冷房能力',
    expected_dimension: 'power',
    keywords: ['冷房能力', '冷却能力'],
    tags: ['冷房能力'],
  },
  {
    concept_id: 'power_supply.voltage',
    label: '電源電圧',
    expected_dimension: 'voltage',
    keywords: ['電源電圧', '定格電圧', '電源'],
    tags: ['電源電圧'],
  },
  {
    concept_id: 'power_supply.frequency',
    label: '周波数',
    expected_dimension: 'frequency',
    keywords: ['周波数'],
    tags: ['周波数'],
  },
  {
    concept_id: 'acoustics.operating_noise',
    label: '運転騒音',
    expected_dimension: 'sound_pressure_level',
    keywords: ['騒音値', '運転騒音', '騒音'],
    tags: ['騒音'],
  },
  {
    concept_id: 'maintenance.access_space',
    label: '保守作業スペース',
    expected_dimension: 'length',
    keywords: ['保守作業スペース', '保守スペース', '保守'],
    tags: ['保守性'],
  },
];

// ── 概念候補の生成: unit.dimension一致 + 周辺語一致 + タグ一致を独立した根拠として積み上げる ──
function generatePropertyCandidates(quantity, ctx) {
  const nearbyText = ctx.nearbyText || '';
  const tags = ctx.tags || [];
  const candidates = [];
  for (const concept of CONCEPT_DICTIONARY) {
    let score = 0;
    const evidence = [];
    if (quantity.unit.dimension === concept.expected_dimension) {
      score += 0.4;
      evidence.push(`単位次元一致: ${quantity.unit.dimension}`);
    }
    const kwHit = concept.keywords.find(k => nearbyText.includes(k));
    if (kwHit) {
      score += 0.35;
      evidence.push(`周辺語: ${kwHit}`);
    }
    const tagHit = concept.tags.find(t => tags.includes(t));
    if (tagHit) {
      score += 0.25;
      evidence.push(`タグ: ${tagHit}`);
    }
    if (score > 0) {
      candidates.push({ concept_id: concept.concept_id, label: concept.label, confidence: Math.min(0.99, score), evidence });
    }
  }
  candidates.sort((a, b) => b.confidence - a.confidence);
  return candidates;
}

// ── 役割候補の生成: 文書側(A/B)と出典列から推定する。確定はしない ──
function inferRole(ctx) {
  // 条件節由来かどうかを、文書側(A/B)より先に判定する。
  // 条件値(例: 「周囲温度40 °Cで10 kW」の40°C)は、どちら側の文書に出てきても
  // 役割としては同じ「条件」であり、A/B・列の違いは条件"値"自体の役割を変えない。
  if (ctx.isConditionValue) {
    return { role: 'condition', confidence: 0.75, evidence: ['条件節(〜において/〜で)由来の値'] };
  }
  if (ctx.side === 'A') {
    return { role: 'requirement', confidence: 0.7, evidence: ['PDF要求文書側(JSON A)からの抽出'] };
  }
  if (ctx.side === 'B') {
    if (ctx.sourceColumn === '標準機種情報') {
      return { role: 'baseline_design', confidence: 0.85, evidence: ['出典列: 標準機種情報'] };
    }
    if (ctx.sourceColumn === '検討結果') {
      return { role: 'resolved_design', confidence: 0.85, evidence: ['出典列: 検討結果'] };
    }
    return { role: 'unknown', confidence: 0.3, evidence: [] };
  }
  return { role: 'unknown', confidence: 0.2, evidence: [] };
}

// 条件候補(工程4aのcondition_candidates要素)を、通常のquantityレコードと同じ形へ整形する。
// cc自体は{source_text, quantity, unit, confidence}であり、工程4aの完全なレコード形
// {source_text, normalized_text, quantity, unit, context, extraction}とは形が異なるため、
// 下流(表示・coverageGap等)で一律に扱えるよう補完する。
function normalizeConditionAsRecord(cc) {
  return {
    source_text: cc.source_text,
    normalized_text: cc.source_text,
    quantity: cc.quantity,
    unit: cc.unit,
    context: { property: null, subject: null, state: null, tokens: [] },
    extraction: { confidence: cc.confidence, warnings: ['工程4aのcondition_candidatesから補完した値'] },
  };
}

// ── 1レコード分の意味対応候補を生成する。quantity_recordは工程4aのオブジェクトをそのまま参照する(文字列化しない) ──
function buildPropertyCandidateRecords(text, ctx) {
  const quantities = extractQuantities(text);
  const out = [];
  quantities.forEach((q, idx) => {
    out.push({
      source: ctx.source,
      quantity_ref: { index: idx, source_text: q.source_text, isCondition: false }, // 参照情報(indexとsource_textで元quantityへ戻れる)
      quantity_record: q, // 工程4aの構造化オブジェクトをそのまま保持(文字列化しない)
      property_candidates: generatePropertyCandidates(q, ctx),
      role_candidate: inferRole({ ...ctx, isConditionValue: false }),
      confirmed: false, // 候補のみ。人間が確認するまでfalseのまま
    });
    // 条件候補(condition_candidates)も、それ自体が別の意味対応付け対象になり得るため候補化する
    (q.condition_candidates || []).forEach(cc => {
      const ccRecord = normalizeConditionAsRecord(cc);
      out.push({
        source: ctx.source + '(条件節)',
        quantity_ref: { index: idx, source_text: cc.source_text, isCondition: true },
        quantity_record: ccRecord,
        property_candidates: generatePropertyCandidates(ccRecord, ctx),
        role_candidate: inferRole({ ...ctx, isConditionValue: true }),
        confirmed: false,
      });
    });
  });
  return out;
}

// ── 概念候補でグルーピングする(最上位候補のconcept_idが一致するものをまとめる) ──
function groupByTopConcept(records, minConfidence = 0.5) {
  const groups = new Map();
  for (const r of records) {
    const top = r.property_candidates[0];
    if (!top || top.confidence < minConfidence) continue;
    if (!groups.has(top.concept_id)) groups.set(top.concept_id, { concept_id: top.concept_id, label: top.label, members: [] });
    groups.get(top.concept_id).members.push({
      source: r.source,
      role: r.role_candidate.role,
      role_confidence: r.role_candidate.confidence,
      concept_confidence: top.confidence,
      quantity_record: r.quantity_record,
    });
  }
  return [...groups.values()];
}

module.exports = { generatePropertyCandidates, inferRole, buildPropertyCandidateRecords, groupByTopConcept, CONCEPT_DICTIONARY };

// ── 単体実行時のデモ・テスト出力 ──
if (require.main === module) {
  // 実データ(samples/hvac_trace_sample_small/)そのまま。PDF要求4件 + Excel設計項目5件(標準機種情報/検討結果)。
  const pdfRequirements = [
    { source: 'PDF 2.1 使用環境', text: '空調ユニットは、周囲温度0 °Cから50 °Cの環境で正常に運転できること。', tags: ['使用温度'] },
    { source: 'PDF 2.2 冷房性能', text: '周囲温度50 °Cにおいて、冷房能力12 kW以上を確保すること。', tags: ['使用温度', '冷房能力'] },
    { source: 'PDF 2.3 電源仕様', text: '定格電源は三相AC 220 V、50 Hzとすること。', tags: ['電源電圧', '周波数'] },
    { source: 'PDF 2.4 騒音', text: '定格運転時の装置正面1 mにおける騒音値は60 dB(A)以下とすること。', tags: ['騒音'] },
  ];

  const excelRows = [
    { 設計項目: '使用温度範囲', tags: ['使用温度'], 標準機種情報: '0 °C～40 °C', 検討結果: '0 °C～50 °Cで使用可能' },
    { 設計項目: '冷房能力', tags: ['冷房能力', '使用温度'], 標準機種情報: '周囲温度40 °Cで10 kW', 検討結果: '周囲温度50 °Cで12.5 kW' },
    { 設計項目: '電源電圧・周波数', tags: ['電源電圧', '周波数'], 標準機種情報: '三相AC 200 V、50/60 Hz', 検討結果: '三相AC 220 V、50 Hzに対応' },
    { 設計項目: '運転騒音', tags: ['騒音'], 標準機種情報: '装置正面1 mで65 dB(A)', 検討結果: '定格運転時、装置正面1 mで58 dB(A)' },
    { 設計項目: '保守作業スペース', tags: ['保守性'], 標準機種情報: '前面600 mm', 検討結果: '前面600 mmを確保' },
  ];

  console.log('########## 1. PDF側の意味対応候補 ##########');
  let allRecords = [];
  for (const req of pdfRequirements) {
    const recs = buildPropertyCandidateRecords(req.text, { side: 'A', source: req.source, tags: req.tags, nearbyText: req.text });
    allRecords = allRecords.concat(recs);
    console.log(`\n--- ${req.source} ---`);
    recs.forEach(r => console.log(`  [${r.quantity_record.source_text}] top候補: ${r.property_candidates[0]?.concept_id || '(なし)'} (conf ${r.property_candidates[0]?.confidence.toFixed(2) || '-'}) / role: ${r.role_candidate.role}(${r.role_candidate.confidence})`));
  }

  console.log('\n\n########## 2. Excel側の意味対応候補(列ごとに個別抽出) ##########');
  for (const row of excelRows) {
    for (const col of ['標準機種情報', '検討結果']) {
      const text = row[col];
      const recs = buildPropertyCandidateRecords(text, {
        side: 'B', source: `Excel ${row.設計項目}/${col}`, tags: row.tags, nearbyText: `${row.設計項目} ${text}`, sourceColumn: col,
      });
      allRecords = allRecords.concat(recs);
      console.log(`\n--- Excel ${row.設計項目}/${col} ("${text}") ---`);
      recs.forEach(r => console.log(`  [${r.quantity_record.source_text}] top候補: ${r.property_candidates[0]?.concept_id || '(なし)'} (conf ${r.property_candidates[0]?.confidence.toFixed(2) || '-'}) / role: ${r.role_candidate.role}(${r.role_candidate.confidence})`));
    }
  }

  console.log('\n\n########## 3. concept_idでグルーピング ##########');
  const groups = groupByTopConcept(allRecords);
  for (const g of groups) {
    console.log(`\n=== ${g.concept_id} (${g.label}) — ${g.members.length}件 ===`);
    g.members.forEach(m => console.log(`  role=${m.role.padEnd(16)} concept_conf=${m.concept_confidence.toFixed(2)} source=${m.source} quantity=${JSON.stringify(m.quantity_record.quantity)}`));
  }

  console.log('\n\n########## 4. 工程5への自動橋渡し: グループ内でrequirement×baseline_design×resolved_designを自動比較 ##########');
  console.log('【v2.4で解決済み】coverageGap()は、実仕様側の値が「点」(単一の達成値)か「範囲」(能力レンジ)かで');
  console.log('比較方向を自動的に切り替える(comparison_modeフィールドで明示)。温度のような範囲vs範囲の比較も、');
  console.log('冷房能力・電圧・周波数・騒音のような片側閾値要求vs達成値の比較も、どちらも正しく動く。');
  for (const g of groups) {
    const req = g.members.find(m => m.role === 'requirement');
    const baseline = g.members.find(m => m.role === 'baseline_design');
    const resolved = g.members.find(m => m.role === 'resolved_design');
    if (!req) continue;
    console.log(`\n--- ${g.label} (${g.concept_id}) ---`);
    if (baseline) console.log('  要求 vs 標準機種:', coverageGap(req.quantity_record, baseline.quantity_record));
    if (resolved) console.log('  要求 vs 検討結果:', coverageGap(req.quantity_record, resolved.quantity_record));
    if (!baseline && !resolved) console.log('  (Excel側の対応候補なし)');
  }

  console.log('\n\n########## 5. 完了条件チェック(自動アサーション) ##########');
  const assertions = [];
  const check = (name, cond) => assertions.push({ name, pass: !!cond });

  const tempGroup = groups.find(g => g.concept_id === 'environment.ambient_operating_temperature');
  check('温度概念グループが生成される', !!tempGroup);
  check('温度概念グループにrequirement/baseline_design/resolved_designが揃う',
    tempGroup && ['requirement', 'baseline_design', 'resolved_design'].every(role => tempGroup.members.some(m => m.role === role)));

  const tempReq = tempGroup?.members.find(m => m.role === 'requirement');
  const tempBaseline = tempGroup?.members.find(m => m.role === 'baseline_design');
  const tempResolved = tempGroup?.members.find(m => m.role === 'resolved_design');
  if (tempReq && tempBaseline) {
    const g1 = coverageGap(tempReq.quantity_record, tempBaseline.quantity_record);
    check('自動グルーピング経由でも「標準機種は10℃不足」を再現(範囲vs範囲は正しく動く)', g1.satisfied === false && g1.highGap === 10);
  }
  if (tempReq && tempResolved) {
    const g2 = coverageGap(tempReq.quantity_record, tempResolved.quantity_record);
    check('自動グルーピング経由でも「検討結果は充足」を再現(範囲vs範囲は正しく動く)', g2.satisfied === true && g2.highGap === 0);
  }

  const coolingGroup = groups.find(g => g.concept_id === 'performance.cooling_capacity');
  check('冷房能力の概念グループも生成される', !!coolingGroup);
  const coolingResolved = coolingGroup?.members.find(m => m.role === 'resolved_design');
  check('冷房能力/検討結果が12.5kWのまま破損せず伝わる(工程4a v2.3バグの回帰確認)',
    coolingResolved?.quantity_record.quantity.lower.value === 12.5);

  check('候補は全てconfirmed:falseのまま(自動確定しない)',
    allRecords.every(r => r.confirmed === false));
  check('quantity_recordは文字列でなく工程4aの構造化オブジェクト参照のまま',
    allRecords.every(r => typeof r.quantity_record === 'object' && r.quantity_record.quantity && typeof r.quantity_record.quantity === 'object'));

  // coverageGap()の方向性バグの回帰テスト(v2.4で修正済み)。
  // 「12kW以上」という片側閾値要求に対し、要求を大幅に超える999kWの設計値を比較すると、
  // 達成値が点(point)であるためpoint_in_regionモードで比較され、正しく充足(true)と判定される。
  {
    const req = extractQuantities('冷房能力12 kW以上を確保すること')[0];
    const farExceeding = extractQuantities('冷房能力999 kW')[0];
    const g = coverageGap(req, farExceeding);
    check('【v2.4で修正済み】999kWは12kW以上の要求を満たす(point_in_regionモードで正しく充足と判定される)',
      g.satisfied === true && g.comparison_mode === 'point_in_region');
  }

  assertions.forEach(a => console.log((a.pass ? '[OK] ' : '[FAIL] ') + a.name));
  const failCount = assertions.filter(a => !a.pass).length;
  console.log(`\n合計 ${assertions.length}件中 ${assertions.length - failCount}件成功 / ${failCount}件失敗`);
}
