// 語彙(肯定語/否定語/能力キーワード)の妥当性に対する ランダム摂動テスト
//
// 背景: semantic_mapping_prototype.md 8.12節は、JIS計測用語・検査成績書の実務慣行調査に
// 基づき肯定語(実測/達成値/検討結果等)・否定語(規格値/基準値/目標値/設計値等)の辞書を
// 拡張したが、「公的定義に基づく語彙の妥当性は検証できたが、実際の客先文書における出現頻度や、
// 実コーパスに対する誤昇格率の統計的測定には至っていない」という限界が残っていた
// (実際の客先文書サンプルが手元にないため)。8.16節の摂動テスト(interval_semantics_fuzz_test.js)
// は「構造的根拠だけでは閾値を超えない」という設計原則を検証したが、語彙そのものの頑健性
// (否定表現・複数語の同時出現といった、実文書にありがちな「ノイズ」に対して安全か)は
// 対象にしていなかった。
//
// このテストは、実文書を用意できない制約の中で「誤昇格率の統計的測定」に代わる合成的な
// 代理指標を得るため、肯定語・否定語・能力キーワードを軸に、(a)否定表現の有無、
// (b)肯定語と否定語の同時出現(混在信号)、(c)周辺語・数量の形・修飾語・出典列のランダムな
// 組み合わせ、をシード付き乱数で大量に生成し、次の不変条件を統計的に検証する。
//
//   【不変条件】非否定の肯定語(または能力キーワード)を1つも含まないミュータントは、
//   achieved_point(またはcapability_domain)の確信度が自動適用閾値(0.4)以上になっては
//   ならない。逆に言えば、非否定の肯定語を含むミュータントが閾値を超えるのは正当な昇格であり、
//   違反ではない(否定語が同時にあって相殺され昇格しない場合も、安全側なので違反ではない)。
//
// 実際に「実測ではない25℃」(達成値ではないと明言する文)が、修正前は確信度0.70で
// achieved_pointとして自動適用閾値を超えてしまうことを発見した(semantic_mapping_prototype.js
// のACHIEVED_POINT_KEYWORD_PATTERN等が、否定表現の直後でも文字列として一致していたため)。
// v2.16でhasUnnegatedKeywordMatch()による簡易的な否定スコープ検出を追加して修正した。
// このテストは、その修正が手書きの回帰テスト(6件)を超えて、ランダムな組み合わせでも
// 例外なく機能するかを大量件数で検証する。
//
// 依存ライブラリなし。 `node vocabulary_negation_fuzz_test.js` で単体実行できる。

const { extractQuantities, isGenuinePoint, isEmptyInterval } = require('./quantity_extraction_prototype.js');
const { generateIntervalSemanticsCandidates } = require('./semantic_mapping_prototype.js');
const { UNIT_SPECS, SHAPE_GENERATORS, QUALIFIER_POOL, CONTEXT_WORD_POOL } = require('./interval_semantics_fuzz_test.js');

// semantic_mapping_prototype.jsのisTwoSidedRange()と同じ定義(exportされていないため複製)。
// achieved_pointの肯定語ルールはisGenuinePoint()、capability_domainの肯定語ルールは
// isGenuinePoint()またはisTwoSidedRange()が前提条件になっているため、修飾語(最大/最小)が
// 数量の形自体を片側区間へ変えてしまうケース(例:「最大25℃」はisGenuinePointがfalseになる)を
// 正しく除外するには、生成パラメータからの予測ではなく、実際の抽出結果(quantity)から
// 構造的な適合性を判定する必要がある。

const MODE_CONFIDENCE_THRESHOLD = 0.4;

// semantic_mapping_prototype.jsのACHIEVED_POINT_KEYWORD_PATTERN / CAPABILITY_KEYWORD_PATTERNを
// 個別の語へ展開したもの。正規表現の別解析はできないため、辞書と手動で同期させる必要がある
// (この点は8.12節の語彙拡張時と同じ制約)。
const POSITIVE_KEYWORDS = ['実測', '達成値', '検討結果', '検討の結果', '測定した結果', '試験結果', '試験の結果', '検査結果', '検査の結果', '実績値', '成績値'];
const CAPABILITY_KEYWORDS = ['使用可能', '対応可能', '運転可能'];
// NEGATIVE_KEYWORD_RULESから「試験」を除いたもの(「試験結果」と字面上重なり、意味が曖昧になるため)。
const NEGATIVE_KEYWORDS = ['参考値', '目安', '概算', '設定', '公称', '規格値', '基準値', '目標値', '設計値'];
const NEGATION_SUFFIXES = ['ではない', 'ではなく', 'ではありません', 'ではございません', 'とは言えない'];
const FILLER_WORDS = ['', ...CONTEXT_WORD_POOL.neutral_unknown];

// ── シード付き乱数(mulberry32)。再現性のため固定シードを使う ──
function mulberry32(seed) {
  return function () {
    seed |= 0; seed = (seed + 0x6D2B79F5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const RNG_SEED = 20260718;
const rng = mulberry32(RNG_SEED);
const pick = (arr) => arr[Math.floor(rng() * arr.length)];
const chance = (p) => rng() < p;

const SAMPLE_COUNT = 4000;

// 1件のランダムなミュータントを生成する。
// 「信号」は、肯定語・能力キーワード・否定語のうちランダムに0〜2個選び、各々を否定するかどうかも
// ランダムに決める(元の提案「否定語や修飾語をランダムに付与・削除する」に対応)。
function generateRandomMutant() {
  const unitSpec = pick(UNIT_SPECS);
  const shapeNames = Object.keys(SHAPE_GENERATORS);
  const shapeName = pick(shapeNames);
  const valueStr = SHAPE_GENERATORS[shapeName](unitSpec);
  const qualifier = pick(QUALIFIER_POOL);
  const sourceColumn = chance(0.5) ? '検討結果' : undefined;
  const filler = pick(FILLER_WORDS);

  const signals = [];
  // 肯定語信号: 0〜2個
  const positiveCount = chance(0.6) ? (chance(0.5) ? 1 : 2) : 0;
  for (let i = 0; i < positiveCount; i++) {
    signals.push({ kind: 'positive', word: pick(POSITIVE_KEYWORDS), negated: chance(0.5) });
  }
  // 能力キーワード信号: 0〜1個
  if (chance(0.3)) {
    signals.push({ kind: 'capability', word: pick(CAPABILITY_KEYWORDS), negated: chance(0.5) });
  }
  // 否定語辞書信号(参考値・設計値等): 0〜2個。これらは元々「否定」の意味を持つ語であり、
  // ここでは意図的に「ではない」等を付けない(「設計値ではない」は別の意味の合成になるため、
  // 肯定語・能力キーワードの否定スコープ検出のテストに専念する)。
  const negativeCount = chance(0.5) ? (chance(0.5) ? 1 : 2) : 0;
  for (let i = 0; i < negativeCount; i++) {
    signals.push({ kind: 'negative_dict', word: pick(NEGATIVE_KEYWORDS) });
  }

  // 信号をランダムな順序で連結し、否定される信号には直後に否定表現を付ける。
  const shuffled = [...signals];
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }
  const signalText = shuffled.map(s => s.word + (s.negated ? pick(NEGATION_SUFFIXES) : '')).join('');

  const text = filler + signalText + qualifier + valueStr;
  return { text, unitSpec, shapeName, qualifier, sourceColumn, signals };
}

function isTwoSidedRange(q) {
  return q.kind === 'interval' && !!q.lower && !!q.upper && !isGenuinePoint(q) && !isEmptyInterval(q);
}

function evaluateMutant(mutant) {
  const records = extractQuantities(mutant.text);
  const target = records.find(r => mutant.text.endsWith(r.source_text)) || records[records.length - 1];
  if (!target) return { extractedZero: true };

  const candidates = generateIntervalSemanticsCandidates(target, {
    side: 'B',
    nearbyText: mutant.text,
    sourceColumn: mutant.sourceColumn,
  });
  const top = candidates[0];

  const isPoint = isGenuinePoint(target.quantity);
  const isRange = isTwoSidedRange(target.quantity);
  // 修飾語(最大/最小)は数量の形自体を片側区間へ変え、isGenuinePointをfalseにする
  // (例:「最大25℃」)。achieved_pointの肯定語ルールはisGenuinePointが前提のため、
  // シグナルの否定有無だけでなく、この構造的な適合性も満たして初めて「昇格してよい」とみなす。
  const hasNonNegatedPositive = isPoint && mutant.signals.some(s => s.kind === 'positive' && !s.negated);
  const hasNonNegatedCapability = (isPoint || isRange) && mutant.signals.some(s => s.kind === 'capability' && !s.negated);

  const crossedThreshold = !!top && top.value !== 'unknown' && top.confidence >= MODE_CONFIDENCE_THRESHOLD;
  const isFalsePromotion =
    crossedThreshold &&
    ((top.value === 'achieved_point' && !hasNonNegatedPositive) ||
      (top.value === 'capability_domain' && !hasNonNegatedCapability));
  const isLegitimatePromotion =
    crossedThreshold &&
    ((top.value === 'achieved_point' && hasNonNegatedPositive) ||
      (top.value === 'capability_domain' && hasNonNegatedCapability));
  const hasNegativeDictSignal = mutant.signals.some(s => s.kind === 'negative_dict');

  return {
    extractedZero: false, top, crossedThreshold, isFalsePromotion, isLegitimatePromotion,
    hasNonNegatedPositive, hasNonNegatedCapability, hasNegativeDictSignal,
    hasAnyPositiveSignal: mutant.signals.some(s => s.kind === 'positive' || s.kind === 'capability'),
  };
}

function runVocabularyFuzzTest() {
  const stats = {
    total: 0,
    extractedZero: 0,
    // 「非否定の肯定語/能力語を含まない」母集団(=誤昇格してはいけない母集団)
    shouldNotPromote: { total: 0, falsePromotions: 0 },
    // 「非否定の肯定語/能力語を含む」母集団(=正しく昇格してよい母集団、機能確認用)。
    // さらに、否定語辞書の語(参考値・設計値等)を同時に含むかどうかで内訳を分ける。
    // 含む場合は、否定根拠(-0.4)により正当に相殺されて閾値を超えないケースがあり得るため
    // (混在信号は安全側に倒れる設計、8.11節)、「含まない(clean)」場合のみ高い昇格率を期待する。
    shouldBeEligible: { total: 0, crossedThreshold: 0 },
    shouldBeEligibleClean: { total: 0, crossedThreshold: 0 },
    shouldBeEligibleMixed: { total: 0, crossedThreshold: 0 },
  };
  const violations = [];

  for (let i = 0; i < SAMPLE_COUNT; i++) {
    const mutant = generateRandomMutant();
    stats.total++;
    const result = evaluateMutant(mutant);
    if (result.extractedZero) { stats.extractedZero++; continue; }

    const eligible = result.hasNonNegatedPositive || result.hasNonNegatedCapability;
    if (eligible) {
      stats.shouldBeEligible.total++;
      if (result.crossedThreshold) stats.shouldBeEligible.crossedThreshold++;
      const bucket = result.hasNegativeDictSignal ? stats.shouldBeEligibleMixed : stats.shouldBeEligibleClean;
      bucket.total++;
      if (result.crossedThreshold) bucket.crossedThreshold++;
    } else {
      stats.shouldNotPromote.total++;
      if (result.isFalsePromotion) {
        stats.shouldNotPromote.falsePromotions++;
        violations.push({ text: mutant.text, signals: mutant.signals, top: result.top });
      }
    }
  }

  return { stats, violations };
}

if (require.main === module) {
  console.log('########## 語彙(肯定語/否定語/能力キーワード) ランダム摂動テスト ##########');
  console.log(`乱数シード: ${RNG_SEED}(再現性のため固定)`);
  const { stats, violations } = runVocabularyFuzzTest();

  console.log(`\n生成・検証したミュータント数: ${stats.total}件`);
  console.log(`数量抽出に失敗したミュータント: ${stats.extractedZero}件(除外)`);

  const rate = stats.shouldNotPromote.total > 0
    ? (100 * stats.shouldNotPromote.falsePromotions / stats.shouldNotPromote.total).toFixed(2)
    : 'N/A';
  console.log('\n── 誤昇格率(非否定の肯定語/能力語を含まないミュータントのうち、');
  console.log('    achieved_point/capability_domainへ自動適用閾値以上で誤って昇格した割合) ──');
  console.log(`  母集団: ${stats.shouldNotPromote.total}件`);
  console.log(`  誤昇格件数: ${stats.shouldNotPromote.falsePromotions}件`);
  console.log(`  誤昇格率: ${rate}%`);

  const eligibleRate = stats.shouldBeEligible.total > 0
    ? (100 * stats.shouldBeEligible.crossedThreshold / stats.shouldBeEligible.total).toFixed(2)
    : 'N/A';
  const cleanRate = stats.shouldBeEligibleClean.total > 0
    ? (100 * stats.shouldBeEligibleClean.crossedThreshold / stats.shouldBeEligibleClean.total).toFixed(2)
    : 'N/A';
  const mixedRate = stats.shouldBeEligibleMixed.total > 0
    ? (100 * stats.shouldBeEligibleMixed.crossedThreshold / stats.shouldBeEligibleMixed.total).toFixed(2)
    : 'N/A';
  console.log('\n── (対照)正しく昇格してよいミュータントのうち、実際に閾値を超えた割合(語彙が機能しているかの確認) ──');
  console.log(`  全体: ${stats.shouldBeEligible.crossedThreshold}/${stats.shouldBeEligible.total}件 (${eligibleRate}%)`);
  console.log(`  否定語辞書の語を同時に含まない(clean): ${stats.shouldBeEligibleClean.crossedThreshold}/${stats.shouldBeEligibleClean.total}件 (${cleanRate}%)`);
  console.log(`  否定語辞書の語を同時に含む(mixed、相殺されて閾値未満になり得る): ${stats.shouldBeEligibleMixed.crossedThreshold}/${stats.shouldBeEligibleMixed.total}件 (${mixedRate}%)`);

  console.log(`\n########## 誤昇格の具体例(先頭10件、全${violations.length}件中) ##########`);
  if (violations.length === 0) {
    console.log('誤昇格は見つからなかった。');
  } else {
    violations.slice(0, 10).forEach(v => {
      console.log(`  "${v.text}" -> ${v.top.value}(${v.top.confidence.toFixed(2)}) 信号:`, JSON.stringify(v.signals));
    });
  }

  console.log('\n\n########## 完了条件チェック(自動アサーション) ##########');
  const assertions = [];
  const check = (name, cond) => assertions.push({ name, pass: !!cond });

  check(`ミュータントを1000件以上生成した(実際: ${stats.total}件)`, stats.total >= 1000);
  check('数量抽出に失敗したミュータントは全体の一部に留まる(30%未満)', stats.extractedZero < stats.total * 0.3);
  check(`「非否定の肯定語/能力語を含まない」母集団が十分な件数ある(実際: ${stats.shouldNotPromote.total}件、100件以上)`,
    stats.shouldNotPromote.total >= 100);
  check(`誤昇格率は0%である(実際: ${rate}%、${stats.shouldNotPromote.falsePromotions}/${stats.shouldNotPromote.total}件)`,
    stats.shouldNotPromote.falsePromotions === 0);
  check(`「正しく昇格してよい」母集団が十分な件数ある(実際: ${stats.shouldBeEligible.total}件、100件以上)`,
    stats.shouldBeEligible.total >= 100);
  check(`否定語辞書の語を伴わない(clean)場合、非否定の肯定語/能力語だけで高い割合(80%以上)が実際に閾値を超える` +
    `(語彙が機能している。実際: ${stats.shouldBeEligibleClean.crossedThreshold}/${stats.shouldBeEligibleClean.total}件 ${cleanRate}%)`,
    stats.shouldBeEligibleClean.total > 0 && stats.shouldBeEligibleClean.crossedThreshold / stats.shouldBeEligibleClean.total >= 0.8);

  assertions.forEach(a => console.log((a.pass ? '[OK] ' : '[FAIL] ') + a.name));
  const failCount = assertions.filter(a => !a.pass).length;
  console.log(`\n合計 ${assertions.length}件中 ${assertions.length - failCount}件成功 / ${failCount}件失敗`);

  console.log('\n【重要な限界】このテストは合成的なミュータントによる代理指標であり、レビューが本来');
  console.log('求めていた「実際の客先文書における語彙の出現頻度」「実コーパスに対する誤昇格率」を');
  console.log('直接測定するものではない。実文書に本テストが想定していない語彙・構文パターンが');
  console.log('含まれていれば、この検証は捕捉できない。匿名化した実文書コーパスが確保できた時点で、');
  console.log('本来の測定に置き換えることが望ましい(8.15節・8.16節と同じ限界)。');
}

module.exports = { generateRandomMutant, runVocabularyFuzzTest, POSITIVE_KEYWORDS, CAPABILITY_KEYWORDS, NEGATIVE_KEYWORDS, NEGATION_SUFFIXES };
