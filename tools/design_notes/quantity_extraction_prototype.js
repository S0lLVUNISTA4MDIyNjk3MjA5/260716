// 工程4a（数量抽出）たたき台プロトタイプ v2.8
// tools/design_notes/quantity_extraction_prototype_review.md の必須修正6項目
// （符号付き数値／区間統合／境界包含区分／原文保持／暫定判定明示／条件誤伝播防止）
// および、そのレビュー過程で追加発見した2件（±公差、桁区切りカンマ）を反映。
// v2.1: 境界包含を考慮した被覆判定と、約・最大・最小等の修飾語保持を追加。
// v2.2: 最大・最小由来の隣接する片側境界も1件の区間へ統合。
// v2.3: 文分割が小数点を文区切りと誤認識し数値が破損する不具合を修正
//       （工程3プロトタイプでの実データ検証中に発見。例: 「12.5 kW」が「5 kW」になっていた）。
// v2.4: coverageGap()の比較方向を、実仕様が「点」か「範囲」かで切り替えるよう修正
//       （片側閾値要求(Xkg以上等) vs 単一の達成値を常に誤判定していた不具合。詳細は
//        semantic_mapping_prototype.md参照）。
// v2.5: 外部レビューにより、v2.4の「actualが点か範囲か」だけでは比較方向を一意に決定できない
//       ケース（実仕様側も片側区間＝保証下限/保証上限の場合）が指摘され、安全策として片側区間は
//       自動判定せず比較不能を返すよう修正。あわせて、空区間([50,50)等)を点と誤認する不具合、
//       抽出時の警告を比較結果へ伝播していなかった不具合も修正。恒久対応（工程3による
//       interval_semantics候補生成）は今後の検討課題。詳細はquantity_extraction_prototype_review.md
//       0.4節を参照。
// v2.6: 外部レビューにより、片側区間だけでなく両側区間も意味(対応可能領域か変動範囲か等)が
//       未確定という追加指摘を受け、coverageGap()に第3引数options.comparisonMode
//       （'actual_covers_requirement' | 'requirement_covers_actual'）を追加。両側区間は
//       modeが明示されない限り自動判定せず比較不能を返すよう変更（内部名を
//       'range_covers_range'から改名）。あわせて、単位不一致等の早期returnで
//       extractionWarningsが失われていた不具合も修正（警告収集を関数冒頭へ移動）。
//       詳細はquantity_extraction_prototype_review.md 0.5節を参照。
// v2.7: 外部レビューにより、coversLower()/coversUpper()が無限境界(下限/上限なし)を誤って
//       扱う不具合が指摘され修正。「要求12kW以上×実仕様0〜20kW」のように、要求が無限に
//       広がる(上限なし)のに実仕様が有限区間の場合、実仕様は要求を覆えないはずが、旧実装は
//       inner側の境界がnullなら無条件でtrueを返していたため誤ってsatisfied:trueになっていた。
//       修正により、outer側もnullである場合に限り「無限境界を覆う」と判定するようにした。
//       あわせて、coversLower/coversUpperが無限境界を正しく扱えるようになったことで片側区間と
//       両側区間を区別する必要がなくなったため、comparisonMode指定時は実仕様が片側区間でも
//       比較できるよう統合した（modeが指定されない場合は従来どおり比較不能を返す）。
//       詳細はquantity_extraction_prototype_review.md 0.6節を参照。
// v2.8: 外部レビューにより、actualが真の点であってもcomparisonModeが明示されればそれを
//       尊重すべきという指摘を受け修正。v2.7までは、actualが点であればcomparisonModeの指定を
//       無視して常にpoint_in_regionへ入っていたため、明示的にactual_covers_requirement等を
//       渡してもAPI利用者の意図どおりに動かなかった（例: 要求0~50℃×実仕様25℃は、25℃を
//       「達成値」と見るか「対応可能領域」と見るかで結果が逆転するはずが、常に前者として
//       扱われていた）。mode未指定かつ点の場合は従来どおりpoint_in_regionを既定動作として
//       維持しつつ、mode明示時はそれに従うよう修正した。詳細はquantity_extraction_prototype_review.md
//       0.7節を参照。
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
// 区間が空集合(矛盾)かどうかを判定する。下限>上限、または下限===上限で
// 両端のいずれかが非包含(exclusive)の場合は、値を1つも含まない空集合になる。
// (レビュー指摘: 50℃以上50℃未満([50,50))を値だけ見て「点50℃」と誤認する不具合)
function isEmptyInterval(q) {
  if (!q.lower || !q.upper) return false;
  if (q.lower.value > q.upper.value) return true;
  if (q.lower.value === q.upper.value) return !(q.lower.inclusive && q.upper.inclusive);
  return false;
}

// 真の点(単一の達成値)かどうかを判定する。空集合を誤って点扱いしないよう、
// 値の一致に加えて両端が包含(inclusive)であることも要求する。
function isGenuinePoint(q) {
  return !!(q.lower && q.upper && q.lower.value === q.upper.value && q.lower.inclusive && q.upper.inclusive);
}

// outer側の区間がinner側の区間を覆っているか(inner ⊆ outer)を判定する共通ロジック。
// actual_covers_requirement(outer=actual, inner=requirement)にも
// requirement_covers_actual(outer=requirement, inner=actual)にも同じ形で使う。
function coversLower(outer, inner) {
  // inner.lowerがnull(下限なし=負の無限大まで広がる)場合、outerがそれを覆うには
  // outer.lowerもnullでなければならない(外部レビュー指摘。v2.6は無条件でtrueを返しており、
  // 要求[12,+∞)を実仕様[0,20]が誤って充足していると判定していた)。
  if (!inner.lower) return !outer.lower;
  if (!outer.lower) return true;
  if (outer.lower.value < inner.lower.value) return true;
  if (outer.lower.value > inner.lower.value) return false;
  return outer.lower.inclusive || !inner.lower.inclusive;
}
function coversUpper(outer, inner) {
  // 上限側も同様。inner.upperがnull(上限なし=正の無限大まで広がる)場合、
  // outerがそれを覆うにはouter.upperもnullでなければならない。
  if (!inner.upper) return !outer.upper;
  if (!outer.upper) return true;
  if (outer.upper.value > inner.upper.value) return true;
  if (outer.upper.value < inner.upper.value) return false;
  return outer.upper.inclusive || !inner.upper.inclusive;
}

// 達成値(v)が要求(rq)の許容範囲内にあるかを判定する(point_in_regionモードの実体)。
function pointInRegionResult(rq, v, extractionWarnings) {
  const lowerCovered = !rq.lower || v > rq.lower.value || (v === rq.lower.value && rq.lower.inclusive);
  const upperCovered = !rq.upper || v < rq.upper.value || (v === rq.upper.value && rq.upper.inclusive);
  const boundaryMismatch = {
    lower: !!(rq.lower && v === rq.lower.value && !rq.lower.inclusive),
    upper: !!(rq.upper && v === rq.upper.value && !rq.upper.inclusive),
  };
  return {
    comparable: true,
    provisional: true, // 意味対応付け(工程3)による同一設計特性・同一条件の確認を経ていない暫定結果
    comparison_mode: 'point_in_region',
    assumptions: ['同じ設計特性として選択済み', '同じ運転条件', '単位換算不要'],
    satisfied: lowerCovered && upperCovered,
    lowGap: rq.lower ? v - rq.lower.value : null,
    highGap: rq.upper ? rq.upper.value - v : null,
    boundaryMismatch,
    extractionWarnings,
  };
}

function coverageGap(requirement, actual, options = {}) {
  // v2.6: 抽出時の警告(修飾語の文脈未確定等)を、早期returnも含めた全ての結果へ伝播する。
  // 単位不一致・非interval形式で早期returnする経路では警告収集前に戻っていたため
  // 警告が失われていた不具合への対応(レビュー指摘。詳細はレビュー記録0.5節参照)。
  const extractionWarnings = [
    ...(requirement.extraction?.warnings || []).map(w => ({ side: 'requirement', warning: w })),
    ...(actual.extraction?.warnings || []).map(w => ({ side: 'actual', warning: w })),
  ];

  if (requirement.unit.canonical !== actual.unit.canonical) {
    return { comparable: false, reason: '単位不一致', extractionWarnings };
  }
  const rq = requirement.quantity, ac = actual.quantity;
  if (rq.kind !== 'interval' || ac.kind !== 'interval') {
    return { comparable: false, reason: '区間形式でない値は本デモでは比較しない', extractionWarnings };
  }

  if (isEmptyInterval(rq) || isEmptyInterval(ac)) {
    return {
      comparable: false,
      reason: '区間が空集合(矛盾する境界)の可能性があります。境界包含区分を確認してください',
      extractionWarnings,
    };
  }

  const mode = options.comparisonMode;

  // v2.8: actualが真の点であっても、意味は一意ではない(外部レビュー指摘)。
  // 「要求0~50℃に対し実仕様25℃」は、25℃が「試験で確認した1点(達成値)」なら要求範囲内の
  // 点として適合するが、「対応可能な温度が25℃だけ(能力領域)」という意味なら、0~50℃の
  // 要求範囲を覆っていないため未充足になる――同じ数値でも解釈で結果が逆転する。
  // v2.7までは、actualが点であればcomparisonModeの指定を無視して常にpoint_in_regionへ
  // 入っていたため、明示的にactual_covers_requirement等を渡してもAPI利用者の意図どおりに
  // 動かなかった。v2.8では、modeが明示された場合はそれを優先する。
  //   - mode未指定 かつ actualが真の点: 暫定的にpoint_in_regionとして扱う(達成値との比較が
  //     最も典型的なケースであるため。完全な安全策として比較不能にする案もあったが、既存の
  //     デモ・回帰テストとの互換性を優先し、軽い方の対応を採用した)。
  //   - mode: 'point_in_region'が明示された場合: actualが真の点であることを要求する
  //     (点でなければ、このmodeは意味を持たないため比較不能を返す)。
  //   - mode: 'actual_covers_requirement' / 'requirement_covers_actual'が明示された場合:
  //     actualが点であっても、その点を退化区間[v,v]とみなし、下記のcoversLower/coversUpperに
  //     よる一般的な区間包含判定へそのまま合流させる(点は単に幅0の区間である)。
  if (!mode && isGenuinePoint(ac)) {
    return pointInRegionResult(rq, ac.lower.value, extractionWarnings);
  }
  if (mode === 'point_in_region') {
    if (!isGenuinePoint(ac)) {
      return {
        comparable: false,
        reason: 'comparisonMode: point_in_regionはactualが真の点の場合のみ有効です',
        extractionWarnings,
      };
    }
    return pointInRegionResult(rq, ac.lower.value, extractionWarnings);
  }

  // v2.7: actualが点でない場合(片側区間・両側区間のいずれも)、その区間が何を意味するかは
  // 構造だけからは一意に決まらない(外部レビュー指摘。v2.5は片側区間だけ、v2.6は両側区間にも
  // 拡張してこの扱いにしていたが、coversLower/coversUpperが無限境界(lower/upper===null)を
  // 正しく扱えるようになったv2.7では、片側・両側を区別する必要自体がなくなった)。
  // 少なくとも次の2通りの意味があり、比較方向が逆になる。
  //   - actual_covers_requirement: actualが対応可能領域(温度0~50℃等)や保証範囲を表す場合。
  //     実仕様の範囲が要求範囲を覆っているか(actual ⊇ requirement)を判定する。
  //   - requirement_covers_actual: actualが変動・公差範囲(220±10V等)や測定結果のばらつき、
  //     保証下限・保証上限(Xkg以上/Xkg以下)を表す場合。実仕様の範囲全体が要求の許容範囲に
  //     収まっているか(requirement ⊇ actual)を判定する。
  //     例: 要求200~240V×実仕様220±10V(実質210~230V)は、変動範囲としてなら充足のはずだが、
  //     v2.5までは常にactual_covers_requirement方向(actual ⊇ requirement)で判定していたため、
  //     actualが要求範囲全体を覆っていないという理由で誤って未充足と判定していた。
  // どちらの意味かは工程3(意味対応付け)が候補として持つべき情報であり、工程4a単体では
  // 判定できない。comparisonModeが明示されない限り、自動で方向を決めず比較不能を返す。
  if (mode !== 'actual_covers_requirement' && mode !== 'requirement_covers_actual') {
    return {
      comparable: false,
      reason: '区間の意味(対応可能領域か、変動・公差範囲か、保証下限/保証上限か等)が未確定のため、comparisonModeの指定なしに比較方向を確定できません',
      extractionWarnings,
    };
  }
  const outer = mode === 'actual_covers_requirement' ? ac : rq;
  const inner = mode === 'actual_covers_requirement' ? rq : ac;
  const lowerCovered = coversLower(outer, inner);
  const upperCovered = coversUpper(outer, inner);
  const boundaryMismatch = {
    lower: !!(inner.lower && outer.lower && inner.lower.value === outer.lower.value && inner.lower.inclusive && !outer.lower.inclusive),
    upper: !!(inner.upper && outer.upper && inner.upper.value === outer.upper.value && inner.upper.inclusive && !outer.upper.inclusive),
  };
  return {
    comparable: true,
    provisional: true,
    comparison_mode: mode,
    assumptions: ['同じ設計特性として選択済み', '同じ運転条件', '単位換算不要'],
    satisfied: lowerCovered && upperCovered,
    lowGap: (rq.lower && ac.lower) ? ac.lower.value - rq.lower.value : null,
    highGap: (rq.upper && ac.upper) ? rq.upper.value - ac.upper.value : null,
    boundaryMismatch,
    extractionWarnings,
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
  // v2.6: 温度は要求・実仕様の両方とも「対応可能領域」を表すことが分かっているため、
  // comparisonMode: 'actual_covers_requirement' を明示する(この判断自体は本来、工程3の
  // interval_semantics候補生成が担うべきものであり、ここでは既知の前提として仮に固定している)。
  console.log('要求 vs 標準機種:', coverageGap(reqRange, stdRange, { comparisonMode: 'actual_covers_requirement' }));
  console.log('要求 vs 検討結果:', coverageGap(reqRange, resultRange, { comparisonMode: 'actual_covers_requirement' }));

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
    const g = coverageGap(reqClosed, actualOpen, { comparisonMode: 'actual_covers_requirement' });
    check('境界被覆: 要求上限を含み実仕様が含まない場合は未充足',
      g.satisfied === false && g.boundaryMismatch.upper === true);
  }
  {
    const reqOpen = extractQuantities('0℃以上50℃未満')[0];
    const actualClosed = extractQuantities('0℃以上50℃以下')[0];
    check('境界被覆: 実仕様が要求より広い包含境界なら充足',
      coverageGap(reqOpen, actualClosed, { comparisonMode: 'actual_covers_requirement' }).satisfied === true);
  }
  {
    // v2.4: 片側閾値要求(Xkg以上) vs 単一の達成値の比較方向修正の回帰テスト。
    // 「12kW以上」の要求に対し、要求を大幅に超える999kWは充足のはずが、
    // 旧実装は範囲比較の方向を固定していたため誤って未充足と判定していた。
    const req = extractQuantities('冷房能力12 kW以上を確保すること')[0];
    const farExceeding = extractQuantities('冷房能力999 kW')[0];
    const shortfall = extractQuantities('冷房能力10 kW')[0];
    const g1 = coverageGap(req, farExceeding);
    const g2 = coverageGap(req, shortfall);
    check('閾値vs達成値: 999kWは「12kW以上」を充足する(点in区間モード)',
      g1.comparison_mode === 'point_in_region' && g1.satisfied === true);
    check('閾値vs達成値: 10kWは「12kW以上」を充足しない',
      g2.comparison_mode === 'point_in_region' && g2.satisfied === false);
  }
  {
    // v2.6: 範囲vs範囲(温度)は、comparisonMode: 'actual_covers_requirement'を明示すれば
    // 従来通り動くことを確認する回帰テスト。
    const g = coverageGap(reqRange, stdRange, { comparisonMode: 'actual_covers_requirement' });
    check('範囲vs範囲: comparisonMode指定でcomparison_modeがactual_covers_requirementになる',
      g.comparison_mode === 'actual_covers_requirement');
  }
  {
    const g = coverageGap(reqRange, stdRange, { comparisonMode: 'actual_covers_requirement' });
    check('比較結果: provisional=trueが明示される', g.provisional === true && Array.isArray(g.assumptions));
  }
  {
    // v2.5: レビュー指摘(actualの形だけでは片側の意味を一意に決められない)への対応の回帰テスト。
    // 「Xkg以上」「X以下」のような要求に対し、実仕様が片側区間(最大/最小由来)の場合、
    // v2.4は誤ってrange_covers_range方向で比較し「未充足」を返していた。
    // 恒久対応(工程3のinterval_semantics)が入るまでは、自動で比較方向を決めず比較不能を返す。
    const reqNoise = extractQuantities('騒音値は60 dB(A)以下とすること')[0];
    const actNoiseMax = extractQuantities('騒音は最大58 dB(A)')[0];
    const g1 = coverageGap(reqNoise, actNoiseMax);
    check('片側区間(安全策): 要求60dB以下×実仕様最大58dB(片側)は自動判定せず比較不能を返す',
      g1.comparable === false && typeof g1.reason === 'string');

    const reqCooling = extractQuantities('冷房能力12 kW以上を確保すること')[0];
    const actCoolingMin = extractQuantities('冷房能力は最小15 kW')[0];
    const g2 = coverageGap(reqCooling, actCoolingMin);
    check('片側区間(安全策): 要求12kW以上×実仕様最小15kW(片側)は自動判定せず比較不能を返す',
      g2.comparable === false && typeof g2.reason === 'string');
  }
  {
    // v2.6: 要求が実質1点(220V)でも、実仕様が両側区間で actual_covers_requirement を
    // 明示すれば正しく動くことの確認。
    const reqVoltage = extractQuantities('定格電圧は220 Vとすること')[0];
    const actVoltageRange = extractQuantities('電源電圧は200 Vから240 Vまで対応')[0];
    const g = coverageGap(reqVoltage, actVoltageRange, { comparisonMode: 'actual_covers_requirement' });
    check('両側区間vs実質1点の要求: 220V要求は200〜240Vの実仕様範囲に含まれるため充足する',
      g.comparison_mode === 'actual_covers_requirement' && g.satisfied === true);
  }
  {
    // v2.5: 境界包含区分の食い違い(要求は50を含む閉区間、実仕様は50を含まない半開区間)の確認。
    const reqClosed = extractQuantities('温度は0 ℃から50 ℃まで対応すること')[0];
    const actHalfOpen = extractQuantities('温度は0 ℃以上50 ℃未満で使用可能')[0];
    const g = coverageGap(reqClosed, actHalfOpen, { comparisonMode: 'actual_covers_requirement' });
    check('境界包含区分: 要求[0,50](閉)×実仕様[0,50)(半開)は上限側で未充足になる',
      g.satisfied === false && g.boundaryMismatch.upper === true);
  }
  {
    // v2.5: 空区間([50,50)、50以上50未満)を「点50」と誤認しないことの回帰テスト。
    const reqRange2 = extractQuantities('温度は40 ℃以上60 ℃以下とすること')[0];
    const actEmpty = extractQuantities('温度は50 ℃以上50 ℃未満で使用可能')[0];
    const g = coverageGap(reqRange2, actEmpty);
    check('空区間: 50℃以上50℃未満([50,50))は点として扱われず比較不能を返す',
      g.comparable === false);
  }
  {
    // v2.6: 外部レビュー指摘への対応の回帰テスト。actualが両側区間でも、その意味
    // (対応可能領域か変動範囲か)が未確定なままでは自動で比較方向を決めない。
    const reqVoltageRange = extractQuantities('電源電圧は200 Vから240 Vまで対応すること')[0];
    const actTolerance = extractQuantities('電源電圧は220±10 Vとする')[0];
    const gNoMode = coverageGap(reqVoltageRange, actTolerance);
    check('両側区間(安全策): 要求200〜240V×実仕様220±10V(公差)はmode未指定では比較不能を返す',
      gNoMode.comparable === false && typeof gNoMode.reason === 'string');

    // v2.4までは「actualが範囲なら常にactual ⊇ requirement」の1方向しかなく、
    // 公差表記(変動範囲)のように実仕様全体が要求の許容範囲に収まるかを問うケースを
    // 表現できなかった(要求範囲を覆っていないという理由で誤って未充足になっていた)。
    const gReqCoversAct = coverageGap(reqVoltageRange, actTolerance, { comparisonMode: 'requirement_covers_actual' });
    check('両側区間: requirement_covers_actualを明示すれば220±10V(210〜230V)は200〜240Vの許容範囲内で充足する',
      gReqCoversAct.comparable === true && gReqCoversAct.satisfied === true);
    check('警告伝播: 公差表記由来の警告がextractionWarningsへ伝播する(comparable=trueの場合)',
      gReqCoversAct.extractionWarnings.some(w => w.side === 'actual' && w.warning.includes('公差表記')));
  }
  {
    // v2.6: 要求が厳密な1点(220V)で、実仕様が変動範囲(220±10V)の場合、
    // actual_covers_requirement方向では「充足」に見えるが、requirement_covers_actual方向
    // (実仕様が変動する可能性を要求が許容するか)では「未充足」になり、解釈次第で結果が
    // 変わることを確認する(どちらが正しいかは工程3のinterval_semantics候補が決めるべき問題)。
    const reqVoltagePoint = extractQuantities('定格電圧は220 Vとすること')[0];
    const actTolerance = extractQuantities('電源電圧は220±10 Vとする')[0];
    const gActualCovers = coverageGap(reqVoltagePoint, actTolerance, { comparisonMode: 'actual_covers_requirement' });
    const gReqCovers = coverageGap(reqVoltagePoint, actTolerance, { comparisonMode: 'requirement_covers_actual' });
    check('解釈依存: 220V要求×220±10V実仕様は、actual_covers_requirementでは充足になる',
      gActualCovers.satisfied === true);
    check('解釈依存: 同じ組み合わせでも、requirement_covers_actualでは未充足になる',
      gReqCovers.satisfied === false);
  }
  {
    // v2.6: 単位不一致で早期returnする経路でも、extractionWarningsが失われないことの確認。
    const reqTemp = extractQuantities('温度は0 ℃以上50 ℃以下とすること')[0];
    const actNoiseMax = extractQuantities('騒音は最大58 dB(A)')[0]; // 単位がdegCと不一致、かつwarningsあり
    const g = coverageGap(reqTemp, actNoiseMax);
    check('警告伝播: 単位不一致でcomparable:falseでもextractionWarningsは保持される',
      g.comparable === false && g.reason === '単位不一致' &&
      g.extractionWarnings.some(w => w.side === 'actual' && w.warning.includes('最大')));
  }
  {
    // v2.7: 外部レビュー指摘の回帰テスト。無限境界(下限/上限なし)の包含判定が逆だった不具合。
    // 要求[12,+∞)(12kW以上)は「20kWを超える領域」も要求しているのに、実仕様[0,20]は
    // そこまで対応していない。旧実装はinner(要求)側の上限がnullなら無条件でtrueを返しており、
    // 実仕様が要求の無限に広がる部分を覆えていないことを見逃し、誤ってsatisfied:trueにしていた。
    const req1 = extractQuantities('冷房能力12 kW以上を確保すること')[0]; // [12, +∞)
    const act1 = extractQuantities('冷房能力は0 kWから20 kWまで')[0]; // [0, 20]
    const g1 = coverageGap(req1, act1, { comparisonMode: 'actual_covers_requirement' });
    check('無限境界: 要求[12,+∞)を実仕様[0,20]は覆えないため未充足',
      g1.satisfied === false);

    const req2 = extractQuantities('冷房能力は60 kW以下とすること')[0]; // (-∞, 60]
    const act2 = extractQuantities('冷房能力は0 kWから100 kWまで')[0]; // [0, 100]
    const g2 = coverageGap(req2, act2, { comparisonMode: 'actual_covers_requirement' });
    check('無限境界: 要求(-∞,60]を実仕様[0,100]は覆えないため未充足',
      g2.satisfied === false);

    const req3 = extractQuantities('冷房能力12 kW以上を確保すること')[0]; // [12, +∞)
    const act3 = extractQuantities('冷房能力は12 kW以上を実現')[0]; // [12, +∞)
    const g3 = coverageGap(req3, act3, { comparisonMode: 'actual_covers_requirement' });
    check('無限境界: 要求[12,+∞)を同じ[12,+∞)の実仕様なら充足(片側区間でもmode指定で比較できる)',
      g3.satisfied === true);

    const req4 = extractQuantities('冷房能力は60 kW以下とすること')[0]; // (-∞, 60]
    const act4 = extractQuantities('冷房能力は58 kW以下で運転')[0]; // (-∞, 58]
    const g4 = coverageGap(req4, act4, { comparisonMode: 'requirement_covers_actual' });
    check('無限境界: 要求(-∞,60]は実仕様(-∞,58]をrequirement_covers_actualで充足と判定する',
      g4.satisfied === true);
  }
  {
    // v2.8: 外部レビュー指摘の回帰テスト。actualが真の点でも、comparisonModeが明示された場合は
    // それを優先する(v2.7まではmode指定を無視して常にpoint_in_regionへ入っていた)。
    // 「要求0~50℃×実仕様25℃」は、25℃を「試験で確認した1点」と見るか「対応可能領域が
    // 25℃だけ」と見るかで結果が逆転する典型例。
    const req = extractQuantities('温度は0 ℃から50 ℃まで対応すること')[0]; // [0, 50]
    const act = extractQuantities('使用温度は25 ℃')[0]; // 点25

    const gPoint = coverageGap(req, act, { comparisonMode: 'point_in_region' });
    check('点+mode明示: point_in_regionを明示すれば25℃は0~50℃の範囲内で充足する',
      gPoint.satisfied === true && gPoint.comparison_mode === 'point_in_region');

    const gActualCovers = coverageGap(req, act, { comparisonMode: 'actual_covers_requirement' });
    check('点+mode明示: actual_covers_requirementを明示すれば、点25℃は0~50℃全体を覆えず未充足になる',
      gActualCovers.satisfied === false && gActualCovers.comparison_mode === 'actual_covers_requirement');

    const gReqCovers = coverageGap(req, act, { comparisonMode: 'requirement_covers_actual' });
    check('点+mode明示: requirement_covers_actualを明示すれば、点25℃は0~50℃に収まるため充足する',
      gReqCovers.satisfied === true && gReqCovers.comparison_mode === 'requirement_covers_actual');

    check('点+mode明示: comparison_modeが指定したmodeと一致する(黙ってpoint_in_regionへ落ちない)',
      gPoint.comparison_mode === 'point_in_region' &&
      gActualCovers.comparison_mode === 'actual_covers_requirement' &&
      gReqCovers.comparison_mode === 'requirement_covers_actual');
  }

  assertions.forEach(a => console.log((a.pass ? '[OK] ' : '[FAIL] ') + a.name));
  const failCount = assertions.filter(a => !a.pass).length;
  console.log(`\n合計 ${assertions.length}件中 ${assertions.length - failCount}件成功 / ${failCount}件失敗`);
}
