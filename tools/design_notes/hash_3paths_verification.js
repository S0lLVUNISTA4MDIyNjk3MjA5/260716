// 回帰テスト27番(shadow_mode_integration_design.md §6): Node(crypto.createHash)・
// ブラウザ(crypto.subtle.digest)・純JSフォールバック(v12Sha256Fallback())の3経路が、
// 同じ入力に対して同じハッシュ値を返すことを検証する。
//
// 【他5スイートとの違い】このスクリプトはPlaywright(Chromiumの起動)に依存する。
// tools/design_notes/配下の他のテストスイート(quantity_extraction_prototype.js等)は
// 依存パッケージなしで動く自己完結スクリプトだが、本スクリプトはブラウザ経路を実際に
// 実行して検証するため、意図的にこの原則の例外としている。playwrightが利用できない
// 環境では、代わりに hash_3paths_verification.json に記録済みの結果と、
// hash_3paths_node_check.js (playwright不要、ブラウザ経路以外を回帰確認する軽量版)を使う。
//
// 実行方法: NODE_PATH=$(npm root -g) node tools/design_notes/hash_3paths_verification.js
// (playwrightがグローバルインストールされている必要がある。ローカルにnode_modulesがあれば
// NODE_PATHは不要)

const { chromium } = require('playwright');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const { execSync } = require('child_process');

const REPO = path.join(__dirname, '..', '..');
const TOOL = path.join(REPO, 'tools/spec_to_json_conversion_tool_v1.18.html');
const OUT_PATH = path.join(__dirname, 'runtime_fixtures', 'hash_3paths_verification.json');

// 日本語、全角ASCII、CRLF改行、連続空白、絵文字を含む固定ベクトル
// (shadow_mode_integration_design.md §6 27番が明示的に要求する入力種別)
const VECTORS = [
  { name: 'basic', namespace: 'content-hash-v1', parts: ['a', 'b'] },
  { name: 'japanese', namespace: 'content-hash-v1', parts: ['周囲温度50 °Cで12.5 kW', '冷房能力'] },
  { name: 'fullwidth_ascii', namespace: 'quantity-id-v1', parts: ['ＡＢＣ１２３ｘｙｚ'] },
  { name: 'crlf', namespace: 'content-hash-v1', parts: ['line1\r\nline2\r\nline3'] },
  { name: 'consecutive_whitespace', namespace: 'content-hash-v1', parts: ['a    b\t\tc   '] },
  { name: 'emoji', namespace: 'content-hash-v1', parts: ['温度🌡️確認済み✅ラベル'] },
  { name: 'empty_part', namespace: 'content-hash-v1', parts: ['', 'x'] },
  { name: 'leading_trailing_ws', namespace: 'content-hash-v1', parts: ['  padded value  '] },
  { name: 'namespace_with_ws', namespace: '  content-hash-v1  ', parts: ['x'] },
  { name: 'part_boundary_ambiguity', namespace: 'quantity-id-v1', parts: ['ab', 'c'] },
  { name: 'part_boundary_ambiguity_2', namespace: 'quantity-id-v1', parts: ['a', 'bc'] },
];

// Node側: v12HashParts(namespace, parts)の実際の契約をそのまま移植する。
// namespaceは正規化せず、partsのみv12Normalize()相当(NFKC正規化+改行統一+行末空白除去+
// 空白圧縮+trim)を適用してからNUL文字で連結し、1回だけSHA-256をとる
// (spec_to_json_conversion_tool_v1.18.html 5737行目の実装どおり)。
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

async function runInBrowser(disableSubtle) {
  const browser = await chromium.launch();
  const context = await browser.newContext();
  const page = await context.newPage();
  if (disableSubtle) {
    // crypto.subtleを未定義にして、v12Sha256()が純JSフォールバック経路(v12Sha256Fallback)を
    // 通るよう強制する(v12Sha256: if(globalThis.crypto?.subtle) ... else v12Sha256Fallback(value))。
    await page.addInitScript(() => {
      Object.defineProperty(window.crypto, 'subtle', { value: undefined, configurable: true });
    });
  }
  await page.goto('file://' + TOOL);
  await page.waitForTimeout(300);

  const results = {};
  for (const v of VECTORS) {
    const hash = await page.evaluate(async ({ namespace, parts }) => {
      return await v12HashParts(namespace, parts);
    }, { namespace: v.namespace, parts: v.parts });
    results[v.name] = hash;
  }
  const pathUsed = await page.evaluate(() => (globalThis.crypto?.subtle ? 'crypto.subtle' : 'fallback'));
  await browser.close();
  return { pathUsed, results };
}

(async () => {
  const nodeResults = {};
  for (const v of VECTORS) nodeResults[v.name] = nodeV12HashParts(v.namespace, v.parts);

  const browserSubtle = await runInBrowser(false);
  const browserFallback = await runInBrowser(true);

  console.log('Node経路:', 'crypto.createHash(sha256)');
  console.log('ブラウザ経路1:', browserSubtle.pathUsed);
  console.log('ブラウザ経路2:', browserFallback.pathUsed);
  console.log('');

  let allMatch = true;
  const comparison = [];
  for (const v of VECTORS) {
    const n = nodeResults[v.name];
    const s = browserSubtle.results[v.name];
    const f = browserFallback.results[v.name];
    const match = n === s && s === f;
    if (!match) allMatch = false;
    comparison.push({ name: v.name, namespace: v.namespace, parts: v.parts, node: n, browser_subtle: s, browser_fallback: f, match });
    console.log(`[${match ? 'OK' : 'FAIL'}] ${v.name}: node=${n.slice(0, 16)}... subtle=${s.slice(0, 16)}... fallback=${f.slice(0, 16)}...`);
  }

  console.log('');
  console.log(allMatch ? '3経路すべて一致' : '不一致あり(詳細はresults参照)');

  const sourceBlobSha = execSync(`git hash-object "${TOOL}"`, { cwd: REPO }).toString().trim();
  fs.mkdirSync(path.dirname(OUT_PATH), { recursive: true });
  fs.writeFileSync(OUT_PATH, JSON.stringify({
    source_file: 'tools/spec_to_json_conversion_tool_v1.18.html',
    source_blob_sha: sourceBlobSha,
    generated_at: new Date().toISOString(),
    allMatch,
    comparison,
  }, null, 2), 'utf-8');
  console.log(`\n結果を ${path.relative(REPO, OUT_PATH)} へ書き出した(source_blob_sha: ${sourceBlobSha})。`);

  process.exitCode = allMatch ? 0 : 1;
})().catch(e => { console.error('FATAL', e); process.exitCode = 1; });
