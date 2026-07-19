// hash_3paths_verification.js(Playwright依存、ブラウザ2経路+Node経路を毎回実行する完全版)の
// 軽量版。playwrightが使えない環境でも、他5スイートと同じ「依存パッケージなしで動く」原則で
// 実行できるようにする。以下の2点だけを回帰確認する(ブラウザ経路そのものは実行しない)。
//
// 1. tools/spec_to_json_conversion_tool_v1.18.html が、3経路検証を行った時点から変更されて
//    いないか(git blobハッシュの比較。変更されていれば、記録済みの3経路一致結果が現在の
//    実装を代表しなくなるため、hash_3paths_verification.jsの再実行が必要という警告を出す)。
// 2. 記録済みの11ベクトルについて、Node側のhashParts()相当ロジックが記録済みのnode値を
//    再現するか(trace_comparison_example_verification.jsのhashParts()に将来手を加えた際の
//    回帰を検出する)。
//
// このスクリプトが検出できないもの: crypto.subtle・v12Sha256Fallback()側の変更・退行
// (ブラウザ経路を経由しないため)。それらはhash_3paths_verification.jsの実行でのみ検出できる。

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const REPO = path.join(__dirname, '..', '..');
const TOOL_PATH = path.join(REPO, 'tools/spec_to_json_conversion_tool_v1.18.html');
const FIXTURE_PATH = path.join(__dirname, 'runtime_fixtures', 'hash_3paths_verification.json');

function v12NormalizeEquivalent(value) {
  return String(value ?? '').normalize('NFKC').replace(/\r\n?/g, '\n')
    .split('\n').map(s => s.replace(/[ \t]+$/g, '')).join('\n')
    .replace(/[ \t]+/g, ' ').trim();
}
function nodeV12HashParts(namespace, parts) {
  const NUL = String.fromCharCode(0);
  const canonical = [namespace, ...parts.map(v12NormalizeEquivalent)].join(NUL);
  return crypto.createHash('sha256').update(canonical, 'utf-8').digest('hex');
}
// gitコマンドに依存せず、git blobオブジェクトのハッシュ("blob <byte数>\0<内容>"のSHA-1)を
// Node組み込みモジュールだけで計算する(レビュー指摘: execSync('git hash-object')だとgitが
// 使えない環境で陳腐化検査そのものがスキップされてしまうため、必須検査にできるよう変更)。
function gitBlobSha(filePath) {
  const content = fs.readFileSync(filePath);
  const header = Buffer.from('blob ' + content.length + String.fromCharCode(0), 'utf-8');
  return crypto.createHash('sha1').update(Buffer.concat([header, content])).digest('hex');
}

const assertions = [];
const check = (name, cond) => assertions.push({ name, pass: !!cond });

const fixture = JSON.parse(fs.readFileSync(FIXTURE_PATH, 'utf-8'));

check(`3経路検証fixtureに記録されたsource_blob_sha(${fixture.source_blob_sha.slice(0, 12)}...)が、` +
  `現在の${fixture.source_file}のgit blobハッシュと一致する(不一致ならhash_3paths_verification.jsの再実行が必要)`,
  gitBlobSha(TOOL_PATH) === fixture.source_blob_sha);

for (const c of fixture.comparison) {
  const recomputed = nodeV12HashParts(c.namespace, c.parts);
  check(`ベクトル"${c.name}"のNode側ハッシュが記録済みの値と一致する(hashParts()の回帰検出)`,
    recomputed === c.node);
}

check('fixture記録時点でNode/ブラウザ2経路(crypto.subtle・フォールバック)が一致していた(allMatch===true)',
  fixture.allMatch === true);

assertions.forEach(a => console.log((a.pass ? '[OK] ' : '[FAIL] ') + a.name));
const failCount = assertions.filter(a => !a.pass).length;
console.log(`\n合計 ${assertions.length}件中 ${assertions.length - failCount}件成功 / ${failCount}件失敗`);
if (failCount > 0) {
  console.log('\n【注意】このスクリプトはブラウザ経路(crypto.subtle/v12Sha256Fallback)そのものは');
  console.log('再実行しない軽量版である。source_blob_shaが不一致の場合や、本体の実装を変更した');
  console.log('場合は、node tools/design_notes/hash_3paths_verification.js(playwright必要)を');
  console.log('再実行し、runtime_fixtures/hash_3paths_verification.jsonを更新すること。');
}
process.exitCode = failCount > 0 ? 1 : 0;
