// 工程3 interval_semantics候補生成 摂動テスト(ミューテーションテスト)
//
// 背景: quantity_extraction_prototype_review.md / semantic_mapping_prototype.md 8章の
// 一連のレビュー(v2.9〜v2.15)で、achieved_point等の候補スコアリングは
// 「数量の形(点/片側/両側)＋列名だけの構造的根拠は、自動適用の閾値を決して超えない」
// という設計原則で固めてきた(8.11節「肯定的根拠」の設計)。この原則が本当に例外なく
// 成立しているかを、実際の否定語辞書・肯定語辞書に載っていない「未知の語」を含む
// 大量の組み合わせで機械的に検証する。
//
// 手法: samples/hvac_trace_sample_small/の実データに現れる4種類の単位(℃/kW/V/dB(A))を
// 軸に、(a)周辺語(肯定語辞書/否定語辞書/能力キーワード/未知語/文脈なし)、(b)数量の形
// (点/両側区間/片側下限/片側上限)、(c)修飾語(なし/最大/最小/約)、(d)出典列(検討結果/なし)
// の直積でミュータント文を生成し、それぞれについて次の不変条件を確認する。
//
//   【不変条件】actual側のinterval_semantics最上位候補が、
//   (a) 値がunknownでなく、かつ
//   (b) 確信度がauto_applicableのmodeConfidence閾値(0.4)以上
//   ならば、その候補の根拠(evidence)には少なくとも1件、type='keyword'または'qualifier'
//   (=セル内容に基づく根拠)が含まれていなければならない。type='quantity_shape'や
//   'column_role'(構造的根拠)だけでこの閾値を超えることがあってはならない。
//
// この不変条件が破られるミュータントが見つかれば、それは「未知の語＋構造的根拠だけで
// 誤って自動適用されてしまう」具体的な弱点であり、レビューが求めていた
// 「どの単語の組み合わせが誤昇格を起こしやすいか」を実際に特定できたことになる。
//
// 依存ライブラリなし。 `node interval_semantics_fuzz_test.js` で単体実行できる。

const { extractQuantities } = require('./quantity_extraction_prototype.js');
const { generateIntervalSemanticsCandidates } = require('./semantic_mapping_prototype.js');

const MODE_CONFIDENCE_THRESHOLD = 0.4; // semantic_mapping_prototype.jsのAUTO_APPLICABLE_THRESHOLDS.modeConfidenceと同じ値

// ── (a) 周辺語プール ──
// 肯定語・否定語・能力キーワードは、ACTUAL_SEMANTICS_RULES/NEGATIVE_KEYWORD_RULESに
// 実際に登録されている語をそのまま使う(辞書が正しく機能しているかの確認を兼ねる)。
// 未知語は、既存のどちらの辞書にも含まれない、しかし実務文書にありそうな語を独自に選定した
// (「呼称値」「表示値」等。8.12節の調査で確認した公称値・規格値等とは意図的に別の語にしている)。
const CONTEXT_WORD_POOL = {
  positive: ['実測', '達成値は', '検討の結果、', '試験結果は', '検査結果は', '実績値は', '成績値は', '試験の結果、', '検査の結果、'],
  negative: ['参考値として', '目安として', '概算で', '設定', '公称', '規格値は', '基準値は', '目標値は', '設計値は'],
  capability: ['使用可能温度は', '対応可能な範囲は', '運転可能領域は', '使用可能な', '対応可能'],
  neutral_unknown: [
    '呼称値は', '参照値は', '表示値は', '計測点は', '判定値は', '確認値は', '観測値は', '記録値は',
    '想定値は', '適用値は', '選定値は', '採用値は', '規定値は', '暫定値は', '評価値は',
    '基本値は', '既定値は', '推奨値は', '公表値は', '申告値は',
  ],
  none: [''],
};

// ── (b) 数量の形の生成器。samples/hvac_trace_sample_small/の実データにある4単位を軸にする ──
const UNIT_SPECS = [
  { unit: '℃', point: 25, low: 0, high: 50, oneSided: 12 },
  { unit: 'kW', point: 12.5, low: 0, high: 20, oneSided: 12 },
  { unit: 'V', point: 220, low: 200, high: 240, oneSided: 200 },
  { unit: 'dB(A)', point: 58, low: 50, high: 65, oneSided: 60 },
];
const SHAPE_GENERATORS = {
  point: (u) => `${u.point}${u.unit}`,
  range: (u) => `${u.low}${u.unit}から${u.high}${u.unit}`,
  oneSidedLower: (u) => `${u.oneSided}${u.unit}以上`,
  oneSidedUpper: (u) => `${u.oneSided}${u.unit}以下`,
};

// ── (c) 修飾語プール(quantity_extraction_prototype.jsが認識する接頭辞) ──
const QUALIFIER_POOL = ['', '最大', '最小', '約'];

// ── (d) 出典列(列根拠との相互作用も確認する) ──
const SOURCE_COLUMN_POOL = [undefined, '検討結果'];

function* generateMutants() {
  for (const unitSpec of UNIT_SPECS) {
    for (const [shapeName, shapeFn] of Object.entries(SHAPE_GENERATORS)) {
      const valueStr = shapeFn(unitSpec);
      for (const qualifier of QUALIFIER_POOL) {
        const qualifiedValue = qualifier + valueStr;
        for (const [category, words] of Object.entries(CONTEXT_WORD_POOL)) {
          for (const contextWord of words) {
            for (const sourceColumn of SOURCE_COLUMN_POOL) {
              const text = contextWord + qualifiedValue;
              yield { text, unit: unitSpec.unit, shape: shapeName, qualifier, contextCategory: category, contextWord, sourceColumn };
            }
          }
        }
      }
    }
  }
}

function runFuzzTest() {
  const stats = {
    total: 0,
    extractedZero: 0,
    // category -> { total, crossedThreshold, hasContentEvidence,
    //               crossedViaKeyword, crossedViaQualifierOnly, crossedWithoutQualifierWord }
    byCategory: {},
  };
  const violations = [];

  for (const mutant of generateMutants()) {
    stats.total++;
    if (!stats.byCategory[mutant.contextCategory]) {
      stats.byCategory[mutant.contextCategory] = {
        total: 0, crossedThreshold: 0, hasContentEvidence: 0,
        crossedViaKeyword: 0, crossedViaQualifierOnly: 0, crossedWithoutQualifierWord: 0,
      };
    }
    const catStats = stats.byCategory[mutant.contextCategory];
    catStats.total++;

    const records = extractQuantities(mutant.text);
    // 修飾語が接頭辞として数値の直前に付くケース(最大/最小/約)を優先して評価対象にする。
    // quantity_extraction_prototype.jsは修飾語付きの数量を含む複数の候補を返すことがあるため、
    // 「対象の数量表現」に最も近いものを選ぶ: 元のvalueStr(修飾語なし部分)を含むsource_textを探す。
    const target = records.find(r => mutant.text.endsWith(r.source_text)) || records[records.length - 1];
    if (!target) { stats.extractedZero++; continue; }

    const candidates = generateIntervalSemanticsCandidates(target, {
      side: 'B',
      nearbyText: mutant.text,
      sourceColumn: mutant.sourceColumn,
    });
    const top = candidates[0];
    if (!top || top.value === 'unknown') continue;
    if (top.confidence < MODE_CONFIDENCE_THRESHOLD) continue;

    catStats.crossedThreshold++;
    // 「最大/最小」等の明示的な修飾語(qualifier)自体もセル内容に基づく正当な根拠であり、
    // 周辺の文脈語(未知語かどうか)とは独立して閾値を超えてよい。そのため、閾値超えの原因を
    // (1) keyword由来(周辺文脈語の辞書マッチ) と (2) qualifier由来のみ(修飾語だけ) に分けて集計する。
    const hasKeywordEvidence = top.evidence.some(e => e.type === 'keyword');
    const hasQualifierEvidence = top.evidence.some(e => e.type === 'qualifier');
    const hasContentEvidence = hasKeywordEvidence || hasQualifierEvidence;
    if (hasContentEvidence) {
      catStats.hasContentEvidence++;
      if (hasKeywordEvidence) catStats.crossedViaKeyword++;
      else catStats.crossedViaQualifierOnly++;
    } else {
      violations.push({ ...mutant, topValue: top.value, topConfidence: top.confidence, evidence: top.evidence });
    }
    // 明示的な修飾語(最大/最小/約)を伴わないミュータントが閾値を超えた場合、それは
    // 周辺の文脈語(またはshape/column_role)だけが原因である。これを別枠で数える。
    if (mutant.qualifier === '') {
      catStats.crossedWithoutQualifierWord++;
    }
  }

  return { stats, violations };
}

if (require.main === module) {
  console.log('########## 工程3 interval_semantics 摂動テスト ##########');
  const { stats, violations } = runFuzzTest();

  console.log(`\n生成・検証したミュータント数: ${stats.total}件`);
  console.log(`数量抽出に失敗したミュータント: ${stats.extractedZero}件(除外)`);

  console.log('\n周辺語カテゴリ別の内訳:');
  console.log(
    'カテゴリ'.padEnd(20) + '総数'.padEnd(8) + '閾値超え'.padEnd(10) +
    'keyword由来'.padEnd(14) + 'qualifier由来'.padEnd(16) + '修飾語なしで超え'.padEnd(18) + '不変条件違反'
  );
  for (const [category, s] of Object.entries(stats.byCategory)) {
    const violationCount = s.crossedThreshold - s.hasContentEvidence;
    console.log(
      category.padEnd(20) + String(s.total).padEnd(8) + String(s.crossedThreshold).padEnd(10) +
      String(s.crossedViaKeyword).padEnd(14) + String(s.crossedViaQualifierOnly).padEnd(16) +
      String(s.crossedWithoutQualifierWord).padEnd(18) + String(violationCount)
    );
  }
  console.log('  ※「修飾語なしで超え」= 最大/最小/約のいずれも付かないミュータントで閾値を超えた件数。');
  console.log('    周辺文脈語やshape/column_roleなど、修飾語以外の要因だけで閾値を超えた件数を示す。');

  console.log(`\n########## 不変条件違反: ${violations.length}件 ##########`);
  if (violations.length === 0) {
    console.log('違反は見つからなかった。全てのミュータントで、閾値(0.4)以上の確信度に達した候補は');
    console.log('必ずkeyword/qualifier由来の内容根拠を持っていた(構造的根拠だけでは閾値を超えなかった)。');
  } else {
    // 違反の詳細を、周辺語カテゴリ・形状ごとに集計して表示する(「どの組み合わせが弱いか」の特定)。
    const byShape = {};
    for (const v of violations) {
      const key = `${v.contextCategory}/${v.shape}/qualifier=${v.qualifier || '(なし)'}/col=${v.sourceColumn || '(なし)'}`;
      byShape[key] = (byShape[key] || 0) + 1;
    }
    console.log('\n違反の組み合わせ別内訳:');
    for (const [key, count] of Object.entries(byShape).sort((a, b) => b[1] - a[1])) {
      console.log(`  ${key}: ${count}件`);
    }
    console.log('\n違反の具体例(先頭10件):');
    violations.slice(0, 10).forEach(v => {
      console.log(`  "${v.text}" -> ${v.topValue}(${v.topConfidence.toFixed(2)}) 根拠:`, JSON.stringify(v.evidence));
    });
  }

  console.log('\n\n########## 完了条件チェック(自動アサーション) ##########');
  const assertions = [];
  const check = (name, cond) => assertions.push({ name, pass: !!cond });

  check(`ミュータントを1000件以上生成した(実際: ${stats.total}件)`, stats.total >= 1000);
  check('数量抽出に失敗したミュータントは全体の一部に留まる(50%未満)', stats.extractedZero < stats.total * 0.5);
  check('不変条件違反はゼロ件(構造的根拠だけで閾値を超えるミュータントはなかった)', violations.length === 0);
  check('肯定語カテゴリのミュータントは、閾値超えのほぼ全件が内容根拠を持つ(誤検出なし)',
    stats.byCategory.positive.crossedThreshold === stats.byCategory.positive.hasContentEvidence);
  check(
    '未知語カテゴリのミュータントは、最大/最小/約のいずれも伴わない場合は閾値超えが1件もない' +
    `(構造的根拠＋未知の周辺文脈語だけでは安全。実際: ${stats.byCategory.neutral_unknown.crossedThreshold}件中` +
    `${stats.byCategory.neutral_unknown.crossedWithoutQualifierWord}件が修飾語なしで超えた。` +
    `残り${stats.byCategory.neutral_unknown.crossedViaQualifierOnly}件は最大/最小修飾語という正当な内容根拠による)`,
    stats.byCategory.neutral_unknown.crossedWithoutQualifierWord === 0);
  check('能力キーワードカテゴリは、両側区間の形と組み合わさったときに閾値を超える(capability_domain)',
    stats.byCategory.capability.crossedThreshold > 0);

  assertions.forEach(a => console.log((a.pass ? '[OK] ' : '[FAIL] ') + a.name));
  const failCount = assertions.filter(a => !a.pass).length;
  console.log(`\n合計 ${assertions.length}件中 ${assertions.length - failCount}件成功 / ${failCount}件失敗`);
  // レビュー指摘: 失敗時にも終了コードが0のままだとCIで失敗を見逃す。非ゼロで終了する。
  process.exitCode = failCount > 0 ? 1 : 0;
}

module.exports = { generateMutants, runFuzzTest, CONTEXT_WORD_POOL, UNIT_SPECS, SHAPE_GENERATORS, QUALIFIER_POOL };
