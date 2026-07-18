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
// 【対応状況】本プロトタイプで工程4aのcoverageGap()を概念グループ単位に自動適用したところ、
// coverageGap()自体に比較方向の設計上の欠陥が見つかった（片側閾値要求 vs 単一の達成値が
// 誤判定されていた）。工程4a v2.4で、実仕様側の値が「点」か「範囲」かにより比較方向を切り替える
// 修正を行ったが、外部レビューにより「両側区間もその意味(対応可能領域か変動範囲か)が未確定」
// という追加指摘を受け、v2.5〜v2.6でcoverageGap()に第3引数optionsを追加し、明示的なmode指定が
// ない両側区間は自動判定せず比較不能を返すよう変更した。この結果、本プロトタイプの4章の自動
// 橋渡しループは、温度(両側区間どうしの比較)をmodeなしでは比較できなくなっている
// （5章のアサーションでは、既知の前提としてmodeを明示的に渡して数値ロジックを検証している）。
// これは「区間の意味候補(interval_semantics)を工程3が生成しない限り、工程5の自動橋渡しは
// 安全に動かせない」という、レビューの最終的な結論を実データで裏付けている。
// 詳細は quantity_extraction_prototype.md 5.8〜5.9節、quantity_extraction_prototype_review.md
// 0.4〜0.5節を参照。
//
// v2.9でinterval_semantics候補生成に着手した後、外部レビューで2件の必須修正を受けv2.10で対応した。
//   (1) required_capability_domain(要求は対応可能領域全体を求める) × achieved_point(実仕様は
//       単一の達成値)をpoint_in_regionへ対応させていた誤り。1点が範囲内にあることは、その範囲
//       全域への対応を証明しない。この組み合わせは導出規則なしに変更した。
//   (2) 「B側(実仕様側)の点である」ことだけでachieved_pointがほぼ自動確定(確信度0.6)していた
//       問題。設定値・公称値・試験条件・参考値との区別がつかないため、役割根拠の重みを削減し、
//       「設定」「公称」「試験」を否定根拠の語彙へ追加した。
// 詳細は8.8節を参照。

const { extractQuantities, coverageGap, isGenuinePoint, isEmptyInterval } = require('./quantity_extraction_prototype.js');

// ── interval_semantics 候補生成(v2.9で着手、v2.10で必須修正2件を反映) ──
// 区間の「形」(点/片側/両側)だけでは、その区間が何を意味するかを一意に決定できない
// (quantity_extraction_prototype_review.md 0.4〜0.7節のレビュー指摘、および今回のレビューで
// 明示的に依頼された設計条件)。役割(要求/実仕様)・周辺語・数量の形・修飾語・否定語を
// 独立した根拠として積み上げ、複数候補を生成する(最上位候補だけを残さない)。
function isTwoSidedRange(q) {
  return q.kind === 'interval' && !!q.lower && !!q.upper && !isGenuinePoint(q) && !isEmptyInterval(q);
}
function isOneSidedLower(q) { return q.kind === 'interval' && !!q.lower && !q.upper; }
function isOneSidedUpper(q) { return q.kind === 'interval' && !q.lower && !!q.upper; }

// 要求側(PDF=A側、role='requirement')の意味候補。
const REQUIREMENT_SEMANTICS_RULES = [
  { value: 'required_capability_domain', weight: 0.5, evidenceType: 'keyword',
    match: (text) => /運転できること|使用できること|動作できること|対応できること/.test(text) },
  { value: 'required_capability_domain', weight: 0.15, evidenceType: 'quantity_shape',
    match: (text, quantity) => isTwoSidedRange(quantity) },
  { value: 'acceptable_region', weight: 0.45, evidenceType: 'keyword',
    match: (text) => /確保すること|以下とすること|以上とすること/.test(text) },
  { value: 'acceptable_region', weight: 0.3, evidenceType: 'keyword',
    // 「〜とすること」で終わる一般的な目標値表現(能力表現の語彙とは重複させない)
    match: (text) => /とすること/.test(text) &&
      !/確保すること|以下とすること|以上とすること|運転できること|使用できること|動作できること|対応できること/.test(text) },
  { value: 'acceptable_region', weight: 0.15, evidenceType: 'quantity_shape',
    match: (text, quantity) => isOneSidedLower(quantity) || isOneSidedUpper(quantity) || isGenuinePoint(quantity) },
];

// 実仕様側(Excel=B側、role='baseline_design'/'resolved_design')の意味候補。
const ACTUAL_SEMANTICS_RULES = [
  { value: 'achieved_point', weight: 0.3, evidenceType: 'quantity_shape',
    match: (text, quantity) => isGenuinePoint(quantity) && !text.includes('±') },
  // v2.10: レビュー指摘により0.3→0.15へ減衰。「B側(実仕様側)である」ことは役割を表すだけで、
  // その点が達成値なのか設定値・公称値・試験条件・代表値なのかを識別する独立根拠にはならない。
  // 「点である」根拠と合わせても、キーワード等の裏付けがない場合は自動適用の閾値に届かない
  // 水準へ抑えた(8.4節のauto_applicable判定を参照)。
  { value: 'achieved_point', weight: 0.15, evidenceType: 'source_role',
    match: (text, quantity, record, ctx) => isGenuinePoint(quantity) && ctx.side === 'B' },
  { value: 'capability_domain', weight: 0.55, evidenceType: 'keyword',
    match: (text, quantity) => isTwoSidedRange(quantity) && /使用可能|対応可能|運転可能/.test(text) },
  { value: 'capability_domain', weight: 0.1, evidenceType: 'quantity_shape',
    match: (text, quantity) => isTwoSidedRange(quantity) },
  // 点であっても、能力キーワードが伴う場合はcapability_domainの可能性も残す
  // (「点だから自動的にachieved_pointにしない」というレビュー指摘への対応。
  //  例:「対応可能温度は25℃のみ」は達成値・能力領域のどちらの解釈もあり得る)
  { value: 'capability_domain', weight: 0.4, evidenceType: 'keyword',
    match: (text, quantity) => isGenuinePoint(quantity) && /使用可能|対応可能|運転可能/.test(text) },
  { value: 'outcome_range', weight: 0.6, evidenceType: 'keyword',
    match: (text) => text.includes('±') },
  { value: 'outcome_range', weight: 0.5, evidenceType: 'keyword',
    match: (text) => /変動|ばらつき|測定結果|測定値/.test(text) },
  { value: 'guaranteed_minimum', weight: 0.55, evidenceType: 'qualifier',
    match: (text, quantity, record) => (record.qualifiers || []).some(q => q.type === 'minimum') },
  { value: 'guaranteed_minimum', weight: 0.1, evidenceType: 'quantity_shape',
    // 片側区間というだけでは弱い根拠に留める(「片側区間だけで保証下限を確定しない」)
    match: (text, quantity) => isOneSidedLower(quantity) },
  { value: 'guaranteed_maximum', weight: 0.55, evidenceType: 'qualifier',
    match: (text, quantity, record) => (record.qualifiers || []).some(q => q.type === 'maximum') },
  { value: 'guaranteed_maximum', weight: 0.1, evidenceType: 'quantity_shape',
    match: (text, quantity) => isOneSidedUpper(quantity) },
];

// 条件節(role='condition')の意味候補。レビュー8節の対照テスト例に基づく最小限の語彙。
const CONDITION_SEMANTICS_RULES = [
  { value: 'test_condition', weight: 0.5, evidenceType: 'keyword',
    match: (text) => /試験|測定/.test(text) },
];

// 否定根拠: どの候補にも一律に確信度を下げる方向で働く(特定候補だけを狙い撃ちしない)。
// v2.10: レビュー指摘により「設定」「公称」「試験」を追加。これらは「実仕様側の点＝達成値」
// という既定の解釈に疑問を投げかける語であり(設定値・公称値・試験条件は、必ずしも
// 実測された達成値ではない)、参考値・目安と同じ性質の否定根拠として扱う。重みも
// -0.3→-0.4へ強化し、「参考値58dB(A)」のようなケースでunknownと確実に差が付くようにした。
const NEGATIVE_KEYWORD_RULES = [
  { pattern: /参考値|目安|概算|設定|公称|試験/, weight: -0.4, label: '達成値との混同に注意を要する語' },
];

const UNKNOWN_BASELINE_CONFIDENCE = 0.15;

// ルール群を1レコードへ適用し、根拠付きの候補配列(確信度降順)を返す。
// 候補は複数保持する(単一候補にすると代替解釈と曖昧性の情報が失われるというレビュー指摘に対応)。
//
// 【重要】ここでの`confidence`は、ルール重みの単純加算値であり、統計的に校正された確率ではない
// (レビュー推奨修正4)。本プロトタイプでは検証用の相対スコアとして扱い、閾値との比較にのみ使う。
// 本体統合時は、名称を`score`へ改める、または`{score, score_model, calibrated:false}`のような
// 構造へ分離することを検討する(詳細はsemantic_mapping_prototype.md 8.8節参照)。
function scoreSemantics(rules, text, record, ctx) {
  const quantity = record.quantity;
  const shortText = text.length > 80 ? text.slice(0, 80) + '…' : text;
  const scores = new Map();
  const bump = (value, weight, evidenceType, effect) => {
    if (!scores.has(value)) scores.set(value, { score: 0, evidence: [] });
    const s = scores.get(value);
    s.score += weight;
    s.evidence.push({ type: evidenceType, value, source_text: shortText, effect, weight });
  };
  for (const rule of rules) {
    if (rule.match(text, quantity, record, ctx)) bump(rule.value, rule.weight, rule.evidenceType, 'supports');
  }
  // 条件節(role='condition')では「試験」「測定」がtest_conditionの正の根拠として使われるため、
  // 実仕様側向けの否定根拠(達成値との混同注意語)はここでは適用しない。
  if (!ctx.isConditionValue) {
    for (const neg of NEGATIVE_KEYWORD_RULES) {
      if (neg.pattern.test(text)) {
        for (const value of [...scores.keys()]) bump(value, neg.weight, 'negative_keyword', 'opposes');
      }
    }
  }
  if (!scores.has('unknown')) {
    scores.set('unknown', {
      score: UNKNOWN_BASELINE_CONFIDENCE,
      evidence: [{ type: 'baseline', value: 'unknown', source_text: '(既定の受け皿。他候補が弱い場合の下限)', effect: 'supports', weight: UNKNOWN_BASELINE_CONFIDENCE }],
    });
  }
  return [...scores.entries()]
    .map(([value, s]) => ({ value, confidence: Math.max(0, Math.min(0.99, s.score)), evidence: s.evidence }))
    .filter(c => c.confidence > 0.02)
    .sort((a, b) => b.confidence - a.confidence);
}

// ── 1レコード分のinterval_semantics候補を生成する ──
function generateIntervalSemanticsCandidates(record, ctx) {
  const text = ctx.nearbyText || record.source_text || '';
  if (ctx.isConditionValue) return scoreSemantics(CONDITION_SEMANTICS_RULES, text, record, ctx);
  if (ctx.side === 'A') return scoreSemantics(REQUIREMENT_SEMANTICS_RULES, text, record, ctx);
  if (ctx.side === 'B') return scoreSemantics(ACTUAL_SEMANTICS_RULES, text, record, ctx);
  return scoreSemantics([], text, record, ctx);
}

// ── 要求側semanticsと実仕様側semanticsの組み合わせから、comparisonMode候補を導出する ──
// 単一レコードだけからcomparisonModeを決めない(レビュー指摘)。未定義の組み合わせや
// 片方でもunknownの場合は導出しない(推測しない)。
//
// v2.10: レビュー指摘により、required_capability_domain × achieved_point の対応
// (point_in_region)を削除した。要求が「対応可能領域全体」を求めている(例:「0〜50℃で
// 運転できること」)のに対し、実仕様が単一の達成値(例:「25℃」)しかない場合、その1点が
// 要求範囲内にあっても、要求範囲全域に対応できることの証明にはならない。この組み合わせは
// 当面「導出規則なし」とし、comparisonMode候補を返さない(comparable:falseのまま要確認とする)。
// acceptable_region × achieved_point (「騒音60dB以下」に対する「58dB」等、達成値が
// 許容範囲内かを問う関係)は、この問題を持たないため引き続きpoint_in_regionを対応させる。
const COMPARISON_MODE_DERIVATION_TABLE = [
  { requirement: 'acceptable_region', actual: 'achieved_point', mode: 'point_in_region' },
  { requirement: 'required_capability_domain', actual: 'capability_domain', mode: 'actual_covers_requirement' },
  { requirement: 'acceptable_region', actual: 'outcome_range', mode: 'requirement_covers_actual' },
  { requirement: 'acceptable_region', actual: 'guaranteed_minimum', mode: 'requirement_covers_actual' },
  { requirement: 'acceptable_region', actual: 'guaranteed_maximum', mode: 'requirement_covers_actual' },
];

function deriveComparisonModeCandidate(requirementCandidates, actualCandidates) {
  const reqTop = requirementCandidates?.[0];
  const actTop = actualCandidates?.[0];
  if (!reqTop || !actTop || reqTop.value === 'unknown' || actTop.value === 'unknown') return null;
  const entry = COMPARISON_MODE_DERIVATION_TABLE.find(e => e.requirement === reqTop.value && e.actual === actTop.value);
  if (!entry) return null;
  return {
    value: entry.mode,
    confidence: Math.min(reqTop.confidence, actTop.confidence), // たたき台: 保守的にminを採用。要調整
    derived_from: { requirement_semantics: reqTop.value, actual_semantics: actTop.value },
    confirmed: false,
  };
}

// ── 高確信度候補を暫定比較へ自動利用してよいかを判定する ──
// confirmed(人間が確定したか)とauto_applicable(暫定比較へ自動利用してよいか)は分離する。
// 自動適用しても、人間が確定したことにはならない。閾値は検証用パラメータであり、
// 本体統合前に実データでの再調整を要する(たたき台)。
const AUTO_APPLICABLE_THRESHOLDS = {
  modeConfidence: 0.4,
  margin: 0.2,
  propertyConfidence: 0.7,
};

function marginOf(candidates) {
  if (!candidates || candidates.length === 0) return 0;
  if (candidates.length === 1) return candidates[0].confidence;
  return candidates[0].confidence - candidates[1].confidence;
}
function hasOpposingEvidence(candidates) {
  const top = candidates?.[0];
  return !!(top && top.evidence.some(e => e.effect === 'opposes'));
}

function evaluateAutoApplicable({ modeCandidate, requirementCandidates, actualCandidates, propertyConfidence, extractionWarningsCount }) {
  const th = AUTO_APPLICABLE_THRESHOLDS;
  const reasons = [];
  const failReasons = [];
  if (!modeCandidate) {
    failReasons.push('comparison_mode候補を導出できない(片方がunknown、または未定義の組み合わせ)');
  } else if (modeCandidate.confidence >= th.modeConfidence) {
    reasons.push(`comparison_mode確信度${modeCandidate.confidence.toFixed(2)}が閾値${th.modeConfidence}以上`);
  } else {
    failReasons.push(`comparison_mode確信度${modeCandidate.confidence.toFixed(2)}が閾値${th.modeConfidence}未満`);
  }
  const reqMargin = marginOf(requirementCandidates);
  const actMargin = marginOf(actualCandidates);
  if (reqMargin >= th.margin) reasons.push(`要求側候補の差${reqMargin.toFixed(2)}が閾値${th.margin}以上`);
  else failReasons.push(`要求側候補の差${reqMargin.toFixed(2)}が閾値${th.margin}未満`);
  if (actMargin >= th.margin) reasons.push(`実仕様側候補の差${actMargin.toFixed(2)}が閾値${th.margin}以上`);
  else failReasons.push(`実仕様側候補の差${actMargin.toFixed(2)}が閾値${th.margin}未満`);
  if (!hasOpposingEvidence(requirementCandidates) && !hasOpposingEvidence(actualCandidates)) reasons.push('否定根拠なし');
  else failReasons.push('否定根拠あり');
  if (extractionWarningsCount === 0) reasons.push('抽出警告なし');
  else failReasons.push(`抽出警告${extractionWarningsCount}件`);
  if (propertyConfidence >= th.propertyConfidence) reasons.push(`設計特性の対応確信度${propertyConfidence.toFixed(2)}が閾値${th.propertyConfidence}以上`);
  else failReasons.push(`設計特性の対応確信度${(propertyConfidence || 0).toFixed(2)}が閾値${th.propertyConfidence}未満`);

  return { applicable: failReasons.length === 0, reasons, fail_reasons: failReasons };
}

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
      interval_semantics_candidates: generateIntervalSemanticsCandidates(q, { ...ctx, isConditionValue: false }),
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
        interval_semantics_candidates: generateIntervalSemanticsCandidates(ccRecord, { ...ctx, isConditionValue: true }),
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
      interval_semantics_candidates: r.interval_semantics_candidates,
    });
  }
  return [...groups.values()];
}

// ── 概念グループ単位で、要求×実仕様(baseline_design/resolved_design)の比較を自動導出する ──
// interval_semantics候補→comparisonMode候補→auto_applicable判定→(適用可能な場合のみ)coverageGap()
// の順で処理する。確信度不足の場合はcoverageGap()を呼ばず「要確認」のまま留める。
function autoCompareGroup(group) {
  const req = group.members.find(m => m.role === 'requirement');
  if (!req) return { concept_id: group.concept_id, label: group.label, comparisons: [] };
  const comparisons = [];
  for (const role of ['baseline_design', 'resolved_design']) {
    const actual = group.members.find(m => m.role === role);
    if (!actual) continue;
    const modeCandidate = deriveComparisonModeCandidate(req.interval_semantics_candidates, actual.interval_semantics_candidates);
    const extractionWarningsCount =
      (req.quantity_record.extraction?.warnings.length || 0) + (actual.quantity_record.extraction?.warnings.length || 0);
    const autoApplicable = evaluateAutoApplicable({
      modeCandidate,
      requirementCandidates: req.interval_semantics_candidates,
      actualCandidates: actual.interval_semantics_candidates,
      propertyConfidence: Math.min(req.concept_confidence, actual.concept_confidence),
      extractionWarningsCount,
    });
    const comparison = autoApplicable.applicable
      ? coverageGap(req.quantity_record, actual.quantity_record, { comparisonMode: modeCandidate.value })
      : { comparable: false, reason: '確信度不足のため自動適用を見送り(要確認)' };
    comparisons.push({ role, requirement_top: req.interval_semantics_candidates[0], actual_top: actual.interval_semantics_candidates[0], modeCandidate, autoApplicable, comparison });
  }
  return { concept_id: group.concept_id, label: group.label, comparisons };
}

module.exports = {
  generatePropertyCandidates, inferRole, buildPropertyCandidateRecords, groupByTopConcept, CONCEPT_DICTIONARY,
  generateIntervalSemanticsCandidates, deriveComparisonModeCandidate, evaluateAutoApplicable, autoCompareGroup,
  COMPARISON_MODE_DERIVATION_TABLE,
};

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

  console.log('\n\n########## 4. 工程5への自動橋渡し: interval_semantics候補→comparisonMode候補→auto_applicable判定 ##########');
  console.log('区間の形(点/片側/両側)だけでは意味を確定しない。役割・周辺語・修飾語等から');
  console.log('interval_semantics候補を生成し、要求側×実仕様側の組み合わせからcomparisonMode候補を');
  console.log('導出する。確信度・候補間の差・否定根拠・抽出警告・設計特性の対応確信度が全て基準を');
  console.log('満たす場合のみcoverageGap()を自動実行し、そうでなければ「要確認」のまま留める。');
  const autoResults = groups.map(autoCompareGroup);
  for (const gr of autoResults) {
    if (gr.comparisons.length === 0) continue;
    console.log(`\n--- ${gr.label} (${gr.concept_id}) ---`);
    for (const c of gr.comparisons) {
      const roleLabel = c.role === 'baseline_design' ? '要求 vs 標準機種' : '要求 vs 検討結果';
      console.log(`  ${roleLabel}:`);
      console.log(`    要求側top候補: ${c.requirement_top?.value}(${c.requirement_top?.confidence.toFixed(2)}) / 実仕様側top候補: ${c.actual_top?.value}(${c.actual_top?.confidence.toFixed(2)})`);
      console.log(`    comparisonMode候補: ${c.modeCandidate ? `${c.modeCandidate.value}(${c.modeCandidate.confidence.toFixed(2)})` : '(導出不可)'}`);
      console.log(`    auto_applicable: ${c.autoApplicable.applicable} ${c.autoApplicable.applicable ? '['+c.autoApplicable.reasons.join('; ')+']' : '['+c.autoApplicable.fail_reasons.join('; ')+']'}`);
      console.log(`    比較結果: ${JSON.stringify(c.comparison)}`);
    }
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

  // v2.9: interval_semantics候補生成→comparisonMode自動導出のパイプラインを、温度概念グループで検証する。
  // 標準機種情報「0 °C～40 °C」にはcapability_domainを示す明示的な語(使用可能等)がなく、
  // 実仕様側のtop候補が'unknown'になるため、comparisonModeを導出できず「要確認」のまま
  // 留まる(誤った自動判定より安全)。検討結果「0 °C～50 °Cで使用可能」は「使用可能」という
  // 明示語があるためcapability_domainとして自動導出でき、要求側の「運転できること」と
  // 組み合わさってactual_covers_requirementが導出され、自動適用される。
  const tempAuto = autoCompareGroup(tempGroup);
  const tempBaselineResult = tempAuto.comparisons.find(c => c.role === 'baseline_design');
  const tempResolvedResult = tempAuto.comparisons.find(c => c.role === 'resolved_design');
  check('温度/標準機種: キーワードなしの両側区間はinterval_semanticsがunknownとなり、要確認のまま留まる(自動判定しない)',
    tempBaselineResult && tempBaselineResult.actual_top.value === 'unknown' &&
    tempBaselineResult.modeCandidate === null && tempBaselineResult.comparison.comparable === false);
  check('温度/検討結果: 「使用可能」を根拠にcapability_domainが自動導出され、要求と組み合わせてactual_covers_requirementが自動適用される',
    tempResolvedResult && tempResolvedResult.actual_top.value === 'capability_domain' &&
    tempResolvedResult.modeCandidate?.value === 'actual_covers_requirement' &&
    tempResolvedResult.autoApplicable.applicable === true &&
    tempResolvedResult.comparison.satisfied === true && tempResolvedResult.comparison.highGap === 0);

  // 冷房能力・電圧・騒音は、達成値(点)であることの構造的根拠と実仕様側であることの役割根拠
  // だけで、明示的なキーワードがなくてもpoint_in_regionが自動導出されることを確認する
  // (このパイプラインが温度以外の実データでも自動化を進められることの実演)。
  const coolingAuto = autoCompareGroup(groups.find(g => g.concept_id === 'performance.cooling_capacity'));
  const coolingResolvedResult = coolingAuto.comparisons.find(c => c.role === 'resolved_design');
  check('冷房能力/検討結果: キーワードなしの達成値でもpoint_in_regionが自動導出・自動適用される',
    coolingResolvedResult?.modeCandidate?.value === 'point_in_region' &&
    coolingResolvedResult.autoApplicable.applicable === true && coolingResolvedResult.comparison.satisfied === true);

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

  // v2.6: 外部レビュー指摘の回帰テスト。両側区間どうしの比較(温度)は、区間の意味候補を
  // 持たないこの工程3プロトタイプ単体では、comparisonModeを明示しない限り自動判定できない
  // ことを、4章の自動橋渡しループと同じ呼び出し方(mode未指定)で確認する。
  if (tempReq && tempBaseline) {
    const g = coverageGap(tempReq.quantity_record, tempBaseline.quantity_record);
    check('【v2.6で追加確認】両側区間(温度)はcomparisonMode未指定では自動橋渡しループも比較不能を返す',
      g.comparable === false);
  }

  // ── v2.9: interval_semantics 対照テスト(同じ数量形状でも文脈が変われば候補が変わることの確認) ──
  function actTop(text) {
    const r = extractQuantities(text)[0];
    return generateIntervalSemanticsCandidates(r, { side: 'B', nearbyText: text })[0];
  }
  function condTop(text) {
    const r = extractQuantities(text)[0];
    return generateIntervalSemanticsCandidates(r, { side: 'B', isConditionValue: true, nearbyText: text })[0];
  }
  check('対照: 「0～50℃で使用可能」→capability_domainが最上位候補になる',
    actTop('0 ℃から50 ℃で使用可能').value === 'capability_domain');
  check('対照: 「試験温度は0～50℃」→test_conditionが最上位候補になる',
    condTop('試験温度は0 ℃から50 ℃')?.value === 'test_condition');
  check('対照: 「測定結果は0～50℃」→outcome_rangeが最上位候補になる',
    actTop('測定結果は0 ℃から50 ℃').value === 'outcome_range');
  check('対照: 「電圧は220±10Vで変動する」→outcome_rangeが最上位候補になる',
    actTop('電圧は220±10Vで変動する').value === 'outcome_range');
  check('対照: 「冷房能力は最低15kW」→guaranteed_minimumが最上位候補になる(最低=最小の同義語、工程4a v2.9対応)',
    actTop('冷房能力は最低15kW').value === 'guaranteed_minimum');
  check('対照: 「騒音は最大58dB(A)」→guaranteed_maximumが最上位候補になる',
    actTop('騒音は最大58dB(A)').value === 'guaranteed_maximum');
  check('対照: 文脈のない「0～50℃」はunknownが最上位候補になる(形だけでcapability_domainを確定しない)',
    actTop('0 ℃から50 ℃').value === 'unknown');

  // ── v2.9: comparisonMode導出の対照テスト(ペアの組み合わせで結果が変わることの確認) ──
  function pairMode(reqText, actText, reqCtx = { side: 'A' }, actCtx = { side: 'B' }) {
    const reqRecord = extractQuantities(reqText)[0];
    const actRecord = extractQuantities(actText)[0];
    const reqC = generateIntervalSemanticsCandidates(reqRecord, { ...reqCtx, nearbyText: reqText });
    const actC = generateIntervalSemanticsCandidates(actRecord, { ...actCtx, nearbyText: actText });
    return deriveComparisonModeCandidate(reqC, actC);
  }
  check('ペア導出: required_capability_domain×capability_domain→actual_covers_requirement',
    pairMode('装置は0 ℃から50 ℃の環境で正常に運転できること。', '0 ℃から50 ℃で使用可能')?.value === 'actual_covers_requirement');
  check('ペア導出: acceptable_region×achieved_point→point_in_region',
    pairMode('冷房能力12 kW以上を確保すること。', '冷房能力は12.5 kW')?.value === 'point_in_region');
  check('ペア導出: acceptable_region×outcome_range→requirement_covers_actual',
    pairMode('電源電圧は200 Vから240 Vの範囲とすること。', '電源電圧は220±10 Vで変動する')?.value === 'requirement_covers_actual');
  check('ペア導出: unknownを含むペアはcomparison_mode候補を導出しない(comparable:falseへ)',
    pairMode('冷房能力12 kW以上を確保すること。', '冷房能力は0 kWから20 kWまで')?.value === undefined ||
    pairMode('冷房能力12 kW以上を確保すること。', '冷房能力は0 kWから20 kWまで') === null);

  // ── v2.9: 誤判定防止テスト(レビュー9節。工程3でも過去の教訓を再発防止として固定する) ──
  check('誤判定防止: 片側区間(15kW以上)だけでは保証下限を確定しない(unknownが最上位のまま)',
    actTop('15 kW以上').value === 'unknown');
  check('誤判定防止: 両側区間(0～50℃)だけでは能力領域を確定しない(unknownが最上位のまま、既出だが明示的に再確認)',
    actTop('0 ℃から50 ℃').value === 'unknown');
  {
    // 点であっても能力キーワードが伴う場合は、achieved_pointだけでなくcapability_domainも
    // 候補として残ることを確認する(「点だから自動的にachieved_pointにしない」)。
    const c = actTop('対応可能温度は25 ℃のみ');
    const c2 = generateIntervalSemanticsCandidates(extractQuantities('対応可能温度は25 ℃のみ')[0], { side: 'B', nearbyText: '対応可能温度は25 ℃のみ' });
    check('誤判定防止: 点+能力キーワードでは、achieved_pointだけでなくcapability_domainも候補として残る',
      c2.some(x => x.value === 'achieved_point') && c2.some(x => x.value === 'capability_domain'));
  }
  {
    // ±があっても、要求側(許容差)と実仕様側(変動・ばらつき)で扱いが分かれることを確認する。
    const reqSide = generateIntervalSemanticsCandidates(extractQuantities('電源電圧は220±10 Vとすること。')[0],
      { side: 'A', nearbyText: '電源電圧は220±10 Vとすること。' });
    check('誤判定防止: ±が要求側にある場合、outcome_range固定ではなくacceptable_region候補が生成される(側によって扱いが分かれる)',
      reqSide[0]?.value === 'acceptable_region');
  }
  {
    // 否定根拠(参考値・目安等)がある場合、確信度が下がりunknownへ寄ることを確認する。
    const c = actTop('参考値として0 ℃から50 ℃');
    check('誤判定防止: 「参考値」等の否定根拠があると、候補の確信度が下がりunknownが最上位のままになる',
      c.value === 'unknown');
  }
  check('誤判定防止: comparison_mode確信度が閾値未満の場合はauto_applicableにならない(冷房能力の閾値vs超過値ペアで確認)',
    (() => {
      const reqRecord = extractQuantities('冷房能力12 kW以上を確保すること。')[0];
      const actRecord = extractQuantities('冷房能力は0 kWから20 kWまで')[0];
      const reqC = generateIntervalSemanticsCandidates(reqRecord, { side: 'A', nearbyText: '冷房能力12 kW以上を確保すること。' });
      const actC = generateIntervalSemanticsCandidates(actRecord, { side: 'B', nearbyText: '冷房能力は0 kWから20 kWまで' });
      const modeCandidate = deriveComparisonModeCandidate(reqC, actC);
      const evalResult = evaluateAutoApplicable({ modeCandidate, requirementCandidates: reqC, actualCandidates: actC, propertyConfidence: 0.99, extractionWarningsCount: 0 });
      return modeCandidate === null && evalResult.applicable === false;
    })());

  // ── v2.10: 外部レビュー必須修正1の回帰テスト ──
  // required_capability_domain(要求が対応可能領域全体を求める) × achieved_point(実仕様は
  // 単一の達成値)は、point_in_regionへ対応させてはいけない。「0~50℃で運転できること」という
  // 要求に対し「25℃」という1点の実仕様は、その1点で運転できることを示すだけで、要求範囲
  // 全域への対応を証明しない。この組み合わせは導出規則なしとし、要確認のまま留める。
  {
    const reqText = '装置は0 ℃から50 ℃の環境で正常に運転できること。';
    const actText = '使用温度は25 ℃';
    const reqRecord = extractQuantities(reqText)[0];
    const actRecord = extractQuantities(actText)[0];
    const reqC = generateIntervalSemanticsCandidates(reqRecord, { side: 'A', nearbyText: reqText });
    const actC = generateIntervalSemanticsCandidates(actRecord, { side: 'B', nearbyText: actText });
    check('必須修正1: 要求側がrequired_capability_domainと判定される(「運転できること」)',
      reqC[0].value === 'required_capability_domain');
    check('必須修正1: 実仕様側がachieved_pointと判定される(単一の点)',
      actC[0].value === 'achieved_point');
    const modeCandidate = deriveComparisonModeCandidate(reqC, actC);
    check('必須修正1: required_capability_domain×achieved_pointはcomparisonMode候補を導出しない(point_in_regionにしない)',
      modeCandidate === null);
    const evalResult = evaluateAutoApplicable({ modeCandidate, requirementCandidates: reqC, actualCandidates: actC, propertyConfidence: 0.99, extractionWarningsCount: 0 });
    check('必須修正1: 上記の組み合わせはauto_applicable:falseになる(capability_domainを示す実仕様が必要)',
      evalResult.applicable === false);
  }

  // ── v2.10: 外部レビュー必須修正2の回帰テスト ──
  // 「B側(実仕様側)の点である」ことだけでは、その点が達成値なのか設定値・公称値・試験条件・
  // 参考値なのかを識別できない。以下4例は、いずれもachieved_pointが自動適用されないことを
  // 確認する(achieved_pointが最上位候補から外れる、またはunknownとの差が閾値未満になる)。
  {
    const disambiguousCases = ['設定温度25 ℃', '試験温度25 ℃', '公称電圧220 V', '参考値58 dB(A)'];
    for (const t of disambiguousCases) {
      const r = extractQuantities(t)[0];
      const c = generateIntervalSemanticsCandidates(r, { side: 'B', nearbyText: t });
      check(`必須修正2: 「${t}」はachieved_pointが自動適用されない(unknownが最上位、またはachieved_pointとの差が閾値未満)`,
        c[0].value === 'unknown' || marginOf(c) < AUTO_APPLICABLE_THRESHOLDS.margin);
    }
  }

  assertions.forEach(a => console.log((a.pass ? '[OK] ' : '[FAIL] ') + a.name));
  const failCount = assertions.filter(a => !a.pass).length;
  console.log(`\n合計 ${assertions.length}件中 ${assertions.length - failCount}件成功 / ${failCount}件失敗`);
}
