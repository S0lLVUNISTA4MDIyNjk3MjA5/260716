// 工程4a（数量抽出）たたき台プロトタイプ v2.3
// tools/design_notes/quantity_extraction_prototype_review.md の必須修正6項目
// （符号付き数値／区間統合／境界包含区分／原文保持／暫定判定明示／条件誤伝播防止）
// および、そのレビュー過程で追加発見した2件（±公差、桁区切りカンマ）を反映。
// v2.1: 境界包含を考慮した被覆判定と、約・最大・最小等の修飾語保持を追加。
// v2.2: 最大・最小由来の隣接する片側境界も1件の区間へ統合。
// v2.3: 文分割が小数点を文区切りと誤認識し数値が破損する不具合を修正
//       （工程3プロトタイプでの実データ検証中に発見。例: 「12.5 kW」が「5 kW」になっていた）。
// 依存ライブラリなし。 `node quantity_extraction_prototype.js` で単体実行できる。

const UNIT_DEFS = [
  { source: '°C', canonical: 'degC', dimension: 'temperature' },
  { source: '℃', canonical: 'degC', dimension: 'temperature' },
  { source: 'kW', canonical: 'kW', dimension: 'power' },
  { source: 'V', canonical: 'V', dimension: 'voltage' },
  { source: 'Hz', canonical: 'Hz', dimension: 'frequency' },
  { source: 'dB(A)', canonical: 'dB(A)', dimension: 'sound_pressure_level' },
  { source: 'mm', canonical: 'mm', dimension: 'length' },
];
const UNIT_ALT = '°C|℃|kW|V|Hz|dB\\(A\\)|mm';

function unitInfo(raw) {
  const def = UNIT_DEFS.find(u => u.source === raw);
  return def ? { source: raw, canonical: def.canonical, dimension: def.dimension }
             : { source: raw, canonical: raw, dimension: 'unknown' };
}

// 文脈トークン(周辺語)。将来はドメイン別に拡張する前提の暫定リスト。
const CONTEXT_TOKENS = ['三相', '単相', 'AC', 'DC', '交流', '直流', '定格'];

// 全角→半角の1:1文字置換のみ行う(文字数・位置を変えない)。
// これにより、抽出したspanをそのまま元のtextへ適用してsource_textを取り出せる
// （正規化前の原文と、正規化後の文字列を両方保持できる＝レビュー2.4への対応）。
function normalizeText1to1(text) {
  return text
    .replace(/[０-９．]/g, ch => '0123456789.'['０１２３４５６７８９．'.indexOf(ch)])
    .replace(/[－−]/g, '-')
    .replace(/[～〜]/g, '~');
}

function parseNumber(numStr) {
  return Number(numStr.replace(/,/g, ''));
}

// 符号・桁区切りカンマ・小数に対応した数値トークン（レビュー2.1、および追加発見のカンマ区切りバグへの対応）
const NUM = '(-?\\d{1,3}(?:,\\d{3})*(?:\\.\\d+)?|-?\\d+(?:\\.\\d+)?)';

function splitSentences(text) {
  // 句点等の直後で分割し、各文の絶対オフセットを保持する。
  // 条件節の付与(後述)をこの文単位に限定することで、文をまたいだ誤伝播を防ぐ（レビュー2.6への対応）。
  // v2.3: ASCIIピリオド"."は、数字に挟まれている場合(小数点)は文区切りとみなさない。
  // 修正前は「周囲温度50 °Cで12.5 kW」の小数点を文区切りと誤認識し、
  // 「12.5 kW」が「5 kW」に破損する不具合があった(工程3プロトタイプの実データ検証で発見)。
  const parts = [];
  let start = 0;
  const re = /(?<!\d)\.(?!\d)|[。!?！？]/g;
  let m;
  while ((m = re.exec(text))) {
    parts.push({ text: text.slice(start, m.index + 1), offset: start });
    start = m.index + 1;
  }
  if (start < text.length) parts.push({ text: text.slice(start), offset: start });
  return parts;
}

function contextTokensBefore(sentenceNorm, localIndex) {
  const windowStart = Math.max(0, localIndex - 12);
  const before = sentenceNorm.slice(windowStart, localIndex);
  return CONTEXT_TOKENS.filter(tok => before.includes(tok));
}

function boundFromOperatorWord(word) {
  // "以上"/"以下"等の直後語から、単一制約(lower-only or upper-only)を作る
  if (word === '以上') return { side: 'lower', inclusive: true };
  if (word === '以下') return { side: 'upper', inclusive: true };
  if (word === '未満') return { side: 'upper', inclusive: false };
  if (word === '超える' || word === '超え') return { side: 'lower', inclusive: false };
  return null;
}

function makeIntervalExact(value) {
  return { kind: 'interval', lower: { value, inclusive: true }, upper: { value, inclusive: true } };
}

function extractFromSentence(sentenceText, sentenceOffset, fullOriginal) {
  const norm = normalizeText1to1(sentenceText);
  const raws = []; // 中間表現: {startLocal, endLocal, quantity, unit, warnings, _boundSide}
  const consumed = new Array(norm.length).fill(false);
  const markConsumed = (s, e) => { for (let i = s; i < e; i++) consumed[i] = true; };
  const isFree = (s, e) => { for (let i = s; i < e; i++) if (consumed[i]) return false; return true; };

  // 1. 範囲: "X~Y unit"（unitはX側にあってもなくてもよい。canonicalで比較。レビュー3.1への対応）
  {
    const re = new RegExp(`${NUM}\\s*(${UNIT_ALT})?\\s*~\\s*${NUM}\\s*(${UNIT_ALT})`, 'g');
    let m;
    while ((m = re.exec(norm))) {
      const [full, lo, uLo, hi, uHi] = m;
      const s = m.index, e = m.index + full.length;
      if (!isFree(s, e)) continue;
      const uHiInfo = unitInfo(uHi);
      const warnings = [];
      if (uLo && unitInfo(uLo).canonical !== uHiInfo.canonical) warnings.push('範囲前後で単位が食い違う');
      const loVal = parseNumber(lo), hiVal = parseNumber(hi);
      const reversed = loVal > hiVal;
      if (reversed) warnings.push('下限が上限を超えている(逆転範囲)'); // レビュー3.4: 自動修正せず警告のみ
      raws.push({
        startLocal: s, endLocal: e,
        quantity: { kind: 'interval', lower: { value: loVal, inclusive: true }, upper: { value: hiVal, inclusive: true } },
        unit: uHiInfo, warnings,
      });
      markConsumed(s, e);
    }
  }

  // 1b. "Xunitから Yunitまで"（両側とも単位あり、canonicalで比較。まで、は任意）
  {
    const re = new RegExp(`${NUM}\\s*(${UNIT_ALT})\\s*から\\s*${NUM}\\s*(${UNIT_ALT})\\s*(まで)?`, 'g');
    let m;
    while ((m = re.exec(norm))) {
      const [full, lo, uLo, hi, uHi] = m;
      const s = m.index, e = m.index + full.length;
      if (!isFree(s, e)) continue;
      const uLoInfo = unitInfo(uLo), uHiInfo = unitInfo(uHi);
      const warnings = [];
      if (uLoInfo.canonical !== uHiInfo.canonical) warnings.push('範囲前後で単位が食い違う');
      const loVal = parseNumber(lo), hiVal = parseNumber(hi);
      if (loVal > hiVal) warnings.push('下限が上限を超えている(逆転範囲)');
      raws.push({
        startLocal: s, endLocal: e,
        quantity: { kind: 'interval', lower: { value: loVal, inclusive: true }, upper: { value: hiVal, inclusive: true } },
        unit: uHiInfo, warnings,
      });
      markConsumed(s, e);
    }
  }

  // 2. ±公差: "X±Y unit" → 区間[X-Y, X+Y]。レビュー後の追加発見バグ(値の取り違え)への対応。
  {
    const re = new RegExp(`${NUM}\\s*±\\s*${NUM}\\s*(${UNIT_ALT})`, 'g');
    let m;
    while ((m = re.exec(norm))) {
      const [full, nominal, tol, u] = m;
      const s = m.index, e = m.index + full.length;
      if (!isFree(s, e)) continue;
      const nomVal = parseNumber(nominal), tolVal = parseNumber(tol);
      raws.push({
        startLocal: s, endLocal: e,
        quantity: { kind: 'interval', lower: { value: nomVal - tolVal, inclusive: true }, upper: { value: nomVal + tolVal, inclusive: true } },
        unit: unitInfo(u),
        warnings: [`公差表記(中心値${nomVal}, 公差±${tolVal})から区間を算出`],
      });
      markConsumed(s, e);
    }
  }

  // 3. 並列値: "X/Y unit"（意味は未確定のまま保持。レビュー3.2への対応）
  {
    const re = new RegExp(`${NUM}\\s*/\\s*${NUM}\\s*(${UNIT_ALT})`, 'g');
    let m;
    while ((m = re.exec(norm))) {
      const [full, a, b, u] = m;
      const s = m.index, e = m.index + full.length;
      if (!isFree(s, e)) continue;
      raws.push({
        startLocal: s, endLocal: e,
        quantity: { kind: 'alternatives', options: [parseNumber(a), parseNumber(b)], selection_semantics: 'unknown' },
        unit: unitInfo(u),
        warnings: ['スラッシュの意味(択一/両対応/比率等)は文脈判定が必要'],
      });
      markConsumed(s, e);
    }
  }

  // 4. 単一値 + 比較演算子(以上/以下/未満/超える) + 約
  {
    const re = new RegExp(`${NUM}\\s*(${UNIT_ALT})`, 'g');
    let m;
    while ((m = re.exec(norm))) {
      const [full, numStr, u] = m;
      const s = m.index, e = m.index + full.length;
      if (!isFree(s, e)) continue;
      const after = norm.slice(e, e + 8);
      const beforeStart = Math.max(0, s - 8);
      const before = norm.slice(beforeStart, s);
      let opWord = null;
      if (/^\s*以上/.test(after)) opWord = '以上';
      else if (/^\s*以下/.test(after)) opWord = '以下';
      else if (/^\s*未満/.test(after)) opWord = '未満';
      else if (/^\s*を?超え/.test(after)) opWord = '超える';

      // v2.1: 修飾語を数量表現の一部として保持する。
      // 「最大・最小」は片側境界の候補、「約・およそ・程度・公称」は曖昧性情報として保持する。
      const prefixMatch = before.match(/(約|およそ|最大|最小|公称)\s*$/);
      const suffixMatch = after.match(/^\s*(程度)/);
      const prefix = prefixMatch ? prefixMatch[1] : null;
      const suffix = suffixMatch ? suffixMatch[1] : null;
      const spanStart = prefixMatch ? s - prefixMatch[0].length : s;
      const spanEnd = suffixMatch ? e + suffixMatch[0].length : e;
      const qualifiers = [];
      if (prefix === '約' || prefix === 'およそ' || suffix === '程度') {
        qualifiers.push({ type: 'approximate', source_text: prefix || suffix });
      }
      if (prefix === '最大') qualifiers.push({ type: 'maximum', source_text: prefix });
      if (prefix === '最小') qualifiers.push({ type: 'minimum', source_text: prefix });
      if (prefix === '公称') qualifiers.push({ type: 'nominal', source_text: prefix });

      const value = parseNumber(numStr);
      const warnings = [];
      let quantity;
      let bound = opWord ? boundFromOperatorWord(opWord) : null;
      if (!bound && prefix === '最大') bound = { side: 'upper', inclusive: true };
      if (!bound && prefix === '最小') bound = { side: 'lower', inclusive: true };
      if (bound) {
        // レビュー2.3: 境界の包含/非包含を保持する
        quantity = bound.side === 'lower'
          ? { kind: 'interval', lower: { value, inclusive: bound.inclusive }, upper: null }
          : { kind: 'interval', lower: null, upper: { value, inclusive: bound.inclusive } };
      } else {
        quantity = makeIntervalExact(value); // レビュー4章: 単一値も区間モデルへ統一(lower=upper)
      }
      if (qualifiers.some(q => q.type === 'approximate')) warnings.push('概数表記のため、境界値は厳密値として扱わない');
      if (prefix === '最大' || prefix === '最小') warnings.push(`「${prefix}」を片側境界候補として抽出。文脈による確定が必要`);
      if (prefix === '公称') warnings.push('「公称」表記のため、実測値・保証値との混同に注意');
      raws.push({
        // v2.2: 最大/最小由来の境界も_boundSideへ反映し、以上/以下と同様に隣接統合の対象にする
        // （統合後も qualifiers/warnings は引き継がれ、confidenceは自動的に低いまま保たれる）。
        startLocal: spanStart, endLocal: spanEnd, quantity, unit: unitInfo(u), warnings,
        qualifiers, _boundSide: bound ? bound.side : null,
      });
      markConsumed(spanStart, spanEnd);
    }
  }

  raws.sort((a, b) => a.startLocal - b.startLocal);

  // 5. 片側制約の隣接ペアをひとつの区間へ統合(例: "0℃以上50℃以下" → 2件 → 1件。レビュー2.2への対応)
  const merged = [];
  for (let i = 0; i < raws.length; i++) {
    const cur = raws[i];
    const next = raws[i + 1];
    if (
      cur._boundSide === 'lower' && next && next._boundSide === 'upper' &&
      cur.unit.canonical === next.unit.canonical &&
      cur.quantity.lower && next.quantity.upper
    ) {
      merged.push({
        startLocal: cur.startLocal, endLocal: next.endLocal,
        quantity: { kind: 'interval', lower: cur.quantity.lower, upper: next.quantity.upper },
        unit: cur.unit,
        warnings: [...cur.warnings, ...next.warnings],
        qualifiers: [...(cur.qualifiers || []), ...(next.qualifiers || [])],
      });
      i++; // next を消費済みにする
      continue;
    }
    merged.push(cur);
  }

  // 6. 条件節付与(同一文内限定。レビュー2.6への対応)。
  // 直後に「において」「で」が続く数量を、後続数量の condition_candidates にする(確信度付き、自動確定しない)。
  for (let i = 0; i < merged.length; i++) {
    const q = merged[i];
    const tail = norm.slice(q.endLocal, q.endLocal + 6);
    const isMarker = /^\s*(において|で)/.test(tail);
    if (isMarker && merged[i + 1]) {
      merged[i + 1]._condition = q;
      q._isConditionOnly = true;
    }
  }

  // 7. 出力形へ整形。source_text/normalized_textは同一spanで元テキストから切り出す(1:1マッピングのため安全)。
  return merged
    .filter(q => !q._isConditionOnly)
    .map(q => {
      const absStart = sentenceOffset + q.startLocal;
      const absEnd = sentenceOffset + q.endLocal;
      const contextTokens = contextTokensBefore(norm, q.startLocal);
      const warnings = [...q.warnings];
      const out = {
        source_text: fullOriginal.slice(absStart, absEnd),
        normalized_text: norm.slice(q.startLocal, q.endLocal),
        quantity: q.quantity,
        unit: q.unit,
        ...(q.qualifiers && q.qualifiers.length ? { qualifiers: q.qualifiers } : {}),
        // property/subject/state は工程3(意味対応付け)が埋める領域であり、本プロトタイプ(工程4a)では確定しない
        context: { property: null, subject: null, state: null, tokens: contextTokens },
        extraction: { confidence: warnings.length ? 0.6 : 0.95, warnings },
      };
      if (q._condition) {
        const cAbsStart = sentenceOffset + q._condition.startLocal;
        const cAbsEnd = sentenceOffset + q._condition.endLocal;
        out.condition_candidates = [{
          source_text: fullOriginal.slice(cAbsStart, cAbsEnd),
          quantity: q._condition.quantity,
          unit: q._condition.unit,
          confidence: 0.7,
        }];
      }
      return out;
    });
}

function extractQuantities(text) {
  const sentences = splitSentences(text);
  const all = [];
  for (const sent of sentences) {
    all.push(...extractFromSentence(sent.text, sent.offset, text));
  }
  return all;
}

// ── 工程5デモ: 区間の被覆判定(レビュー2.5: 暫定判定であることを明示する) ──
function coverageGap(requirement, actual) {
  if (requirement.unit.canonical !== actual.unit.canonical) {
    return { comparable: false, reason: '単位不一致' };
  }
  const rq = requirement.quantity, ac = actual.quantity;
  if (rq.kind !== 'interval' || ac.kind !== 'interval') {
    return { comparable: false, reason: '区間形式でない値は本デモでは比較しない' };
  }
  // v2.1: 境界値が等しい場合はinclusive/exclusiveも含めて被覆を判定する。
  const lowerCovered = (() => {
    if (!rq.lower) return !ac.lower;       // 要求が-∞までなら、実仕様も-∞まで必要
    if (!ac.lower) return true;            // 実仕様が-∞までなら要求下限を被覆
    if (ac.lower.value < rq.lower.value) return true;
    if (ac.lower.value > rq.lower.value) return false;
    return ac.lower.inclusive || !rq.lower.inclusive;
  })();
  const upperCovered = (() => {
    if (!rq.upper) return !ac.upper;       // 要求が+∞までなら、実仕様も+∞まで必要
    if (!ac.upper) return true;            // 実仕様が+∞までなら要求上限を被覆
    if (ac.upper.value > rq.upper.value) return true;
    if (ac.upper.value < rq.upper.value) return false;
    return ac.upper.inclusive || !rq.upper.inclusive;
  })();
  const boundaryMismatch = {
    lower: !!(rq.lower && ac.lower && rq.lower.value === ac.lower.value && rq.lower.inclusive && !ac.lower.inclusive),
    upper: !!(rq.upper && ac.upper && rq.upper.value === ac.upper.value && rq.upper.inclusive && !ac.upper.inclusive),
  };
  return {
    comparable: true,
    provisional: true, // 意味対応付け(工程3)による同一設計特性・同一条件の確認を経ていない暫定結果
    assumptions: ['同じ設計特性として選択済み', '同じ運転条件', '単位換算不要', '抽出結果に要確認事項なし'],
    satisfied: lowerCovered && upperCovered,
    lowGap: (rq.lower && ac.lower) ? ac.lower.value - rq.lower.value : null,
    highGap: (rq.upper && ac.upper) ? rq.upper.value - ac.upper.value : null,
    boundaryMismatch,
  };
}

module.exports = { extractQuantities, coverageGap, unitInfo, normalizeText1to1 };

// ── 単体実行時のデモ・テスト出力 ──
if (require.main === module) {
  console.log('########## 1. HVACサンプルでの抽出結果 ##########');
  const hvacSamples = [
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
  for (const [label, text] of hvacSamples) {
    console.log(`\n--- ${label} ---`);
    console.log('原文:', text);
    console.log(JSON.stringify(extractQuantities(text), null, 1));
  }

  console.log('\n\n########## 2. 工程5デモ: 使用温度範囲の充足判定 ##########');
  const rangeOf = text => extractQuantities(text).find(q => q.quantity.kind === 'interval');
  const reqRange = rangeOf('空調ユニットは、周囲温度0 °Cから50 °Cの環境で正常に運転できること。');
  const stdRange = rangeOf('0 °C～40 °C');
  const resultRange = rangeOf('0 °C～50 °Cで使用可能');
  console.log('要求 vs 標準機種:', coverageGap(reqRange, stdRange));
  console.log('要求 vs 検討結果:', coverageGap(reqRange, resultRange));

  console.log('\n\n########## 3. レビュー提示テストケース(正常系・境界系・失敗系) ##########');
  const reviewCases = [
    '-10～50℃', '－10℃以上', '0℃以上50℃以下', '0℃以上50℃未満', '0°Cから50℃', '0℃から50°C',
    '50±2℃', '約50℃', '最大50℃', '50℃を超える', '50℃以下で運転し、220Vを使用する',
    '50℃で停止する。電源は220Vとする', 'AC 220V', 'DC 24V', '三相AC 200V', '1 m', '1m',
    '1,500 mm', '５０℃～６０℃', '50～0℃', '50/60 Hz',
  ];
  for (const c of reviewCases) {
    console.log(`\n--- "${c}" ---`);
    console.log(JSON.stringify(extractQuantities(c), null, 1));
  }

  console.log('\n\n########## 4. 完了条件チェック(自動アサーション) ##########');
  const assertions = [];
  const check = (name, cond) => assertions.push({ name, pass: !!cond });

  check('符号付き数値: -10~50℃ の下限が-10',
    extractQuantities('-10～50℃')[0]?.quantity.lower.value === -10);
  check('全角マイナス: -10℃以上 の下限が-10',
    extractQuantities('－10℃以上')[0]?.quantity.lower.value === -10);
  {
    const rs = extractQuantities('0℃以上50℃以下');
    check('区間統合: 0℃以上50℃以下 が1件のintervalになる',
      rs.length === 1 && rs[0].quantity.lower.value === 0 && rs[0].quantity.upper.value === 50);
  }
  {
    const r = extractQuantities('0℃以上50℃未満')[0];
    check('境界包含: 以上=inclusive true', r.quantity.lower.inclusive === true);
    check('境界非包含: 未満=inclusive false', r.quantity.upper.inclusive === false);
  }
  {
    const r = extractQuantities('５０℃～６０℃')[0];
    check('原文保持: source_textは全角のまま', r.source_text === '５０℃～６０℃');
    check('正規化文字列: normalized_textは半角', r.normalized_text === '50℃~60℃');
  }
  {
    const merged = extractQuantities('0°Cから50℃').find(q => q.quantity.lower && q.quantity.upper);
    check('単位混在でも範囲として認識される(0°Cから50℃)',
      !!merged && merged.quantity.lower.value === 0 && merged.quantity.upper.value === 50);
  }
  {
    const v220 = extractQuantities('50℃で停止する。電源は220Vとする').find(q => q.unit.canonical === 'V');
    check('条件誤伝播防止: 文をまたいだ220Vにconditionが付かない', v220 && !v220.condition_candidates);
  }
  {
    const kw = extractQuantities('周囲温度50 °Cにおいて、冷房能力12 kW以上を確保すること。').find(q => q.unit.canonical === 'kW');
    check('条件伝播: 同一文内の条件は正しく付く',
      kw?.condition_candidates?.[0]?.quantity.lower.value === 50);
  }
  check('逆転範囲: warningsに逆転の指摘がある',
    extractQuantities('50～0℃')[0]?.extraction.warnings.some(w => w.includes('逆転')));
  {
    const r = extractQuantities('三相AC 200V')[0];
    check('周辺語保持: 三相・ACがcontext.tokensに入る',
      r.context.tokens.includes('三相') && r.context.tokens.includes('AC'));
  }
  check('過検出防止: "1 m"を抽出しない(既知の保留事項)', extractQuantities('1 m').length === 0);
  check('過検出防止: "1m"を抽出しない(既知の保留事項)', extractQuantities('1m').length === 0);
  check('カンマ区切り: 1,500 mmが1500として抽出される',
    extractQuantities('1,500 mm')[0]?.quantity.lower.value === 1500);
  {
    const r = extractQuantities('50±2℃')[0];
    check('公差表記: 50±2℃が[48,52]の区間になる',
      r?.quantity.lower.value === 48 && r?.quantity.upper.value === 52);
  }
  {
    // v2.3: 小数点が文区切りと誤認識され数値が破損する不具合の回帰テスト
    // （工程3プロトタイプでの実データ検証で発見。"周囲温度50 °Cで12.5 kW"の".5"以降が
    //   独立した「新しい文」として扱われ、"12.5 kW"が"5 kW"に破損していた）
    const r = extractQuantities('周囲温度50 °Cで12.5 kW').find(q => q.unit.canonical === 'kW');
    check('小数点の文区切り誤認識防止: 12.5 kWが破損せず抽出される',
      r?.source_text === '12.5 kW' && r?.quantity.lower.value === 12.5);
    check('小数点の文区切り誤認識防止: 条件(50°C)も正しく紐づく',
      r?.condition_candidates?.[0]?.quantity.lower.value === 50);
  }
  check('スラッシュ: selection_semanticsがunknown',
    extractQuantities('50/60 Hz')[0]?.quantity.selection_semantics === 'unknown');
  {
    const r = extractQuantities('約50℃')[0];
    check('修飾語保持: 約50℃のsource_textに「約」を含む',
      r?.source_text === '約50℃' && r?.qualifiers?.[0]?.type === 'approximate');
  }
  {
    const r = extractQuantities('最大50℃')[0];
    check('最大値候補: 最大50℃を上限50の片側区間として保持',
      r?.source_text === '最大50℃' && r?.quantity.lower === null &&
      r?.quantity.upper?.value === 50 && r?.qualifiers?.[0]?.type === 'maximum');
  }
  {
    const r = extractQuantities('最小10kW')[0];
    check('最小値候補: 最小10kWを下限10の片側区間として保持',
      r?.source_text === '最小10kW' && r?.quantity.lower?.value === 10 &&
      r?.quantity.upper === null && r?.qualifiers?.[0]?.type === 'minimum');
  }
  {
    // v2.2: 最大/最小由来の隣接した片側境界も、以上/以下と同様に1つの区間へ統合する
    const rs = extractQuantities('最小0℃最大50℃');
    check('最大/最小の統合: 隣接する最小・最大が1件のintervalになる',
      rs.length === 1 && rs[0].quantity.lower?.value === 0 && rs[0].quantity.upper?.value === 50);
    check('最大/最小の統合: 統合後も確信度は低いまま(qualifiers由来のwarningsが残る)',
      rs[0]?.extraction.confidence === 0.6 && rs[0]?.extraction.warnings.length === 2);
  }
  {
    const reqClosed = extractQuantities('0℃以上50℃以下')[0];
    const actualOpen = extractQuantities('0℃以上50℃未満')[0];
    const g = coverageGap(reqClosed, actualOpen);
    check('境界被覆: 要求上限を含み実仕様が含まない場合は未充足',
      g.satisfied === false && g.boundaryMismatch.upper === true);
  }
  {
    const reqOpen = extractQuantities('0℃以上50℃未満')[0];
    const actualClosed = extractQuantities('0℃以上50℃以下')[0];
    check('境界被覆: 実仕様が要求より広い包含境界なら充足',
      coverageGap(reqOpen, actualClosed).satisfied === true);
  }
  {
    const g = coverageGap(reqRange, stdRange);
    check('比較結果: provisional=trueが明示される', g.provisional === true && Array.isArray(g.assumptions));
  }

  assertions.forEach(a => console.log((a.pass ? '[OK] ' : '[FAIL] ') + a.name));
  const failCount = assertions.filter(a => !a.pass).length;
  console.log(`\n合計 ${assertions.length}件中 ${assertions.length - failCount}件成功 / ${failCount}件失敗`);
}
