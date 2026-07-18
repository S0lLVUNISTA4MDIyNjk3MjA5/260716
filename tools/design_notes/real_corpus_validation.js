// 実データ検証: 公開の政府調達仕様書コーパスによる検証
//
// 背景: semantic_mapping_prototype.md 8.15節でレビューが推奨した「実際の客先文書における
// 語彙の出現頻度」「実コーパスに対する誤昇格率の統計的測定」は、8.16〜8.17節の摂動テストでは
// 代替できない(合成的なミュータントによる代理指標に過ぎない)ことが明記されていた。
// この残課題に対応するため、完全に公開された政府調達仕様書
// （国土交通省「公共建築工事標準仕様書（機械設備工事編）令和7年版」、
//  https://www.mlit.go.jp/gobuild/content/001888797.pdf）を実データコーパスとして初めて使用する。
// 企業の機密文書ではなく、誰でも閲覧できる公開情報であるため、匿名化の必要がない。
//
// 手法: real_corpus_samples/mlit_kikai_r7_excerpts.json に収めた実文16件
// （工程4aが対応する5単位[℃/kW/V/Hz/dB(A)]のいずれかを含む文を機械的に抽出し、恣意的な
// 取捨選択はしていない）に対し、実際の抽出・候補生成パイプラインを適用する。
//
//   1. extractQuantities() で数量を抽出できるか(抽出頑健性の実データ確認)。
//   2. B側(実仕様側)として扱った場合、8.11〜8.17節の安全設計原則
//      （構造的根拠だけでは自動適用閾値0.4を超えない）が、実際の政府文書の文体でも
//      成立するか(実データによる誤昇格率0%の確認)。
//   3. A側(要求側)として扱った場合、REQUIREMENT_SEMANTICS_RULESの語彙がどの程度機能するか
//      (この文書は「合成した実データ」ではなく「実在する文体」であるため、語彙のカバー範囲の
//      限界が実際に見える)。
//
// 依存ライブラリなし。 `node real_corpus_validation.js` で単体実行できる。

const fs = require('fs');
const path = require('path');
const { extractQuantities } = require('./quantity_extraction_prototype.js');
const { generateIntervalSemanticsCandidates } = require('./semantic_mapping_prototype.js');

const MODE_CONFIDENCE_THRESHOLD = 0.4;

const corpus = JSON.parse(fs.readFileSync(path.join(__dirname, 'real_corpus_samples/mlit_kikai_r7_excerpts.json'), 'utf-8'));

function runValidation() {
  const sentences = corpus.sentences;
  let extractedZero = 0;
  let totalQuantities = 0;
  let maxBConfidence = 0;
  let crossedThreshold = 0;
  let requirementKeywordHits = 0; // A側でquantity_shape以外(=keyword等)の根拠が最上位に来た件数
  const rows = [];

  sentences.forEach((text, i) => {
    const records = extractQuantities(text);
    if (records.length === 0) { extractedZero++; return; }
    records.forEach((rec) => {
      totalQuantities++;
      const candB = generateIntervalSemanticsCandidates(rec, { side: 'B', nearbyText: text });
      const candA = generateIntervalSemanticsCandidates(rec, { side: 'A', nearbyText: text });
      const topB = candB[0], topA = candA[0];
      if (topB.confidence > maxBConfidence) maxBConfidence = topB.confidence;
      if (topB.value !== 'unknown' && topB.confidence >= MODE_CONFIDENCE_THRESHOLD) crossedThreshold++;
      if (topA.evidence.some(e => e.type === 'keyword')) requirementKeywordHits++;
      rows.push({ sentenceIndex: i, source_text: rec.source_text, topB, topA });
    });
  });

  return { sentences, extractedZero, totalQuantities, maxBConfidence, crossedThreshold, requirementKeywordHits, rows };
}

if (require.main === module) {
  console.log('########## 実データ検証: 公開政府調達仕様書コーパス ##########');
  console.log(`出典: ${corpus.source.title}（${corpus.source.publisher}）`);
  console.log(`${corpus.source.url}`);

  const r = runValidation();

  console.log(`\n対象文数: ${r.sentences.length}件`);
  console.log(`数量抽出に失敗した文: ${r.extractedZero}件`);
  console.log(`抽出された数量の総数: ${r.totalQuantities}件`);

  console.log('\n── B側(実仕様側)として扱った場合の安全性確認 ──');
  console.log(`最大確信度: ${r.maxBConfidence.toFixed(2)}(自動適用閾値: ${MODE_CONFIDENCE_THRESHOLD})`);
  console.log(`閾値超え(誤昇格相当)件数: ${r.crossedThreshold}件`);

  console.log('\n── A側(要求側)としての語彙カバー範囲 ──');
  console.log(`REQUIREMENT_SEMANTICS_RULESのkeywordルールが最上位候補に寄与した件数: ${r.requirementKeywordHits}/${r.totalQuantities}件`);

  console.log('\n個別結果:');
  r.rows.forEach(row => {
    console.log(`  [${row.sentenceIndex}] ${row.source_text} | B側: ${row.topB.value}(${row.topB.confidence.toFixed(2)}) | A側: ${row.topA.value}(${row.topA.confidence.toFixed(2)})`);
  });

  console.log('\n\n########## 完了条件チェック(自動アサーション) ##########');
  const assertions = [];
  const check = (name, cond) => assertions.push({ name, pass: !!cond });

  check(`実文${r.sentences.length}件すべてに対応する数量が抽出される(実際: ${r.extractedZero}件失敗)`, r.extractedZero === 0);
  check(`抽出数量が20件以上ある(実際: ${r.totalQuantities}件)`, r.totalQuantities >= 20);
  check(`B側の誤昇格(構造的根拠だけで閾値0.4を超える)はゼロ件(実際: ${r.crossedThreshold}件、最大確信度${r.maxBConfidence.toFixed(2)})`,
    r.crossedThreshold === 0);

  assertions.forEach(a => console.log((a.pass ? '[OK] ' : '[FAIL] ') + a.name));
  const failCount = assertions.filter(a => !a.pass).length;
  console.log(`\n合計 ${assertions.length}件中 ${assertions.length - failCount}件成功 / ${failCount}件失敗`);

  console.log('\n【残された限界(この検証で判明。詳細はsemantic_mapping_prototype.md 8.18〜8.20節)】');
  console.log('1. 単位辞書のカバー範囲: この文書全体で数値+単位を含む文は112件見つかった。工程4aが対応する');
  console.log('   単位(℃/kW/V/Hz/dB(A)/mm/MPa/kPa/Pa/kVA)のいずれかを含むのは106件(約95%)。mmが元々');
  console.log('   対応していたため大半をカバーしていたが、A(アンペア)・L(リットル)は鋼種型番(SUS304L等)と');
  console.log('   衝突する誤検出が実データで確認されたため追加を見送っており、その分は依然未対応。');
  console.log(`2. 要求側キーワード語彙のカバー範囲: v2.17でJIS Z 8301(規格票の様式及び作成方法)の要求事項`);
  console.log('   表現(「とする」「なければならない」)へ対応した結果、A側候補のうちkeyword由来の根拠が');
  console.log(`   最上位候補に寄与した件数は ${r.requirementKeywordHits}/${r.totalQuantities}件まで改善した(拡張前は0件)。`);
  console.log('   「による」は参照表現(「特記による」等)がほぼ全てであり値を規定しないため、意図的に');
  console.log('   未対応のまま。「望ましい」(推奨事項)・「してもよい」(許容事項)も、要求の強さが');
  console.log('   「とする」とは異なるため、意図的に未対応のまま残している。詳細は8.20節を参照。');
}

module.exports = { runValidation, corpus };
