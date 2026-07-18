// たたき台プロトタイプ: 工程4a（単一記録内での数量抽出）
// 依存ライブラリなし。単位カテゴリ・比較演算子・範囲表現の辞書ベース抽出。

const UNIT_TABLE = [
  // [正規表現(raw表記), canonical, category]
  { re: /°C|℃/g, canonical: 'degC', category: 'temperature' },
  { re: /kW/g, canonical: 'kW', category: 'power' },
  { re: /\bV\b/g, canonical: 'V', category: 'voltage' },
  { re: /Hz/g, canonical: 'Hz', category: 'frequency' },
  { re: /dB\(A\)/g, canonical: 'dB(A)', category: 'sound_pressure_level' },
  { re: /mm/g, canonical: 'mm', category: 'length' },
];

// 全角数字→半角、範囲記号の正規化
function normalizeDigits(s) {
  return s.replace(/[０-９．]/g, ch => '0123456789.'['０１２３４５６７８９．'.indexOf(ch)])
           .replace(/[～〜]/g, '~');
}

// 数値+単位の1トークンを拾う正規表現（例: "50 °C", "12 kW", "220 V", "60 dB(A)"）
const NUM_UNIT = /(\d+(?:\.\d+)?)\s*(°C|℃|kW|V|Hz|dB\(A\)|mm)/g;

function unitInfo(raw) {
  for (const u of UNIT_TABLE) {
    u.re.lastIndex = 0;
    if (u.re.test(raw)) return { raw, canonical: u.canonical, category: u.category };
  }
  return { raw, canonical: raw, category: 'unknown' };
}

function extractQuantities(text) {
  const norm = normalizeDigits(text);
  const results = [];
  const consumed = new Set();

  // 1. 範囲表現: "X~Y unit" または "X unit~Y unit"（単位が片側/両側どちらの表記も許容。例: "0 °C～40 °C"）
  const rangeRe = /(\d+(?:\.\d+)?)\s*(°C|℃|kW|V|Hz|dB\(A\)|mm)?\s*~\s*(\d+(?:\.\d+)?)\s*(°C|℃|kW|V|Hz|dB\(A\)|mm)/g;
  let m;
  while ((m = rangeRe.exec(norm))) {
    const unitToken = m[4]; // 後半の単位を正とする。前半に単位がある場合は一致確認のみ(食い違いは要検証フラグ)
    const mismatched = m[2] && unitInfo(m[2]).canonical !== unitInfo(unitToken).canonical;
    results.push({
      raw_text: m[0],
      value: { kind: 'range', min: Number(m[1]), max: Number(m[3]) },
      unit: unitInfo(unitToken),
      operator: 'range',
      span: [m.index, m.index + m[0].length],
      ...(mismatched ? { needs_review: '範囲前後で単位表記が食い違う' } : {}),
    });
    for (let i = m.index; i < m.index + m[0].length; i++) consumed.add(i);
  }

  // 1b. "XからYまで unit" 形式（例: "周囲温度0 °Cから50 °Cの環境"）
  const fromToRe = /(\d+(?:\.\d+)?)\s*(°C|℃|kW|V|Hz|dB\(A\)|mm)\s*から\s*(\d+(?:\.\d+)?)\s*(°C|℃|kW|V|Hz|dB\(A\)|mm)\s*(まで)?/g;
  while ((m = fromToRe.exec(norm))) {
    if (m[2] !== m[4]) continue; // 単位が食い違う場合はスキップ(要検証フラグ)
    const overlapsConsumed = [...Array(m[0].length).keys()].some(i => consumed.has(m.index + i));
    if (overlapsConsumed) continue;
    results.push({
      raw_text: m[0],
      value: { kind: 'range', min: Number(m[1]), max: Number(m[3]) },
      unit: unitInfo(m[2]),
      operator: 'range',
      span: [m.index, m.index + m[0].length],
    });
    for (let i = m.index; i < m.index + m[0].length; i++) consumed.add(i);
  }

  // 2. 並列値: "X/Y unit" (例: "50/60 Hz" = どちらか一方、範囲ではない)
  const altRe = /(\d+(?:\.\d+)?)\s*\/\s*(\d+(?:\.\d+)?)\s*(°C|℃|kW|V|Hz|dB\(A\)|mm)/g;
  while ((m = altRe.exec(norm))) {
    const overlapsConsumed = [...Array(m[0].length).keys()].some(i => consumed.has(m.index + i));
    if (overlapsConsumed) continue;
    results.push({
      raw_text: m[0],
      value: { kind: 'alternatives', options: [Number(m[1]), Number(m[2])] },
      unit: unitInfo(m[3]),
      operator: 'alt',
      span: [m.index, m.index + m[0].length],
      note: '範囲ではなく択一(この帳票では両対応の意味)。範囲表現との混同に注意。',
    });
    for (let i = m.index; i < m.index + m[0].length; i++) consumed.add(i);
  }

  // 3. 単一値 + 比較演算子/条件語 (残りのトークンから抽出)
  NUM_UNIT.lastIndex = 0;
  while ((m = NUM_UNIT.exec(norm))) {
    const overlapsConsumed = [...Array(m[0].length).keys()].some(i => consumed.has(m.index + i));
    if (overlapsConsumed) continue;

    const after = norm.slice(m.index + m[0].length, m.index + m[0].length + 6);
    const before = norm.slice(Math.max(0, m.index - 8), m.index);
    let operator = 'exact';
    if (/^\s*以上/.test(after)) operator = 'at_least';
    else if (/^\s*以下/.test(after)) operator = 'at_most';
    else if (/^\s*未満/.test(after)) operator = 'less_than';
    else if (/^\s*を?超え/.test(after)) operator = 'more_than';
    if (/約\s*$/.test(before)) operator += '_approx';

    results.push({
      raw_text: m[0],
      value: { kind: 'single', amount: Number(m[1]) },
      unit: unitInfo(m[2]),
      operator,
      span: [m.index, m.index + m[0].length],
    });
  }

  // 条件節の付与: 「〜において」「〜で」の前にある温度等の値を、後続の値の condition として紐付ける簡易ルール
  results.sort((a, b) => a.span[0] - b.span[0]);
  for (let i = 0; i < results.length; i++) {
    const q = results[i];
    const tailAfterQ = norm.slice(q.span[1], q.span[1] + 6);
    const isConditionMarker = /^\s*(において|で)/.test(tailAfterQ);
    if (isConditionMarker && i + 1 < results.length) {
      results[i + 1].condition = { raw_text: q.raw_text, unit: q.unit.canonical, value: q.value };
      q._isConditionOnly = true;
    }
  }

  return results.map(({ span, _isConditionOnly, ...rest }) => rest);
}

const samples = [
  ['PDF 2.1', '空調ユニットは、周囲温度0 °Cから50 °Cの環境で正常に運転できること。'],
  ['PDF 2.2', '周囲温度50 °Cにおいて、冷房能力12 kW以上を確保すること。'],
  ['PDF 2.3', '定格電源は三相AC 220 V、50 Hzとすること。'],
  ['PDF 2.4', '定格運転時の装置正面1 mにおける騒音値は60 dB(A)以下とすること。'],
  ['Excel 使用温度範囲/標準', '0 °C～40 °C'],
  ['Excel 使用温度範囲/検討結果', '0 °C～50 °Cで使用可能'],
  ['Excel 冷房能力/標準', '周囲温度40 °Cで10 kW'],
  ['Excel 冷房能力/検討結果', '周囲温度50 °Cで12.5 kW'],
  ['Excel 電源電圧・周波数/標準', '三相AC 200 V、50/60 Hz'],
  ['Excel 電源電圧・周波数/検討結果', '三相AC 220 V、50 Hzに対応'],
  ['Excel 運転騒音/標準', '装置正面1 mで65 dB(A)'],
  ['Excel 運転騒音/検討結果', '定格運転時、装置正面1 mで58 dB(A)'],
  ['Excel 保守作業スペース/標準', '前面600 mm'],
  ['Excel 保守作業スペース/検討結果', '前面600 mmを確保'],
];

for (const [label, text] of samples) {
  console.log(`\n=== ${label} ===`);
  console.log('原文:', text);
  const qs = extractQuantities(text);
  console.log(JSON.stringify(qs, null, 2));
}

// ── 工程5への橋渡し: 抽出した数量同士を比較するデモ(使用温度範囲) ──
console.log('\n=== 工程5デモ: 使用温度範囲の横断比較 ===');
function rangeOf(text) { return extractQuantities(text).find(q => q.value.kind === 'range'); }
const reqRange = rangeOf('空調ユニットは、周囲温度0 °Cから50 °Cの環境で正常に運転できること。');
const stdRange = rangeOf('0 °C～40 °C');
const resultRange = rangeOf('0 °C～50 °Cで使用可能');

function coverageGap(requirement, actual) {
  if (requirement.unit.canonical !== actual.unit.canonical) return { comparable: false, reason: '単位不一致' };
  const lowGap = actual.value.min - requirement.value.min; // 正なら要求範囲を覆えていない(下限側)
  const highGap = requirement.value.max - actual.value.max; // 正なら要求範囲を覆えていない(上限側)
  const satisfied = lowGap <= 0 && highGap <= 0;
  return { comparable: true, satisfied, lowGap, highGap };
}

console.log('PDF要求:', reqRange.value, '/ Excel標準機種:', stdRange.value, '/ Excel検討結果:', resultRange.value);
console.log('要求 vs 標準機種:', coverageGap(reqRange, stdRange));
console.log('要求 vs 検討結果:', coverageGap(reqRange, resultRange));
