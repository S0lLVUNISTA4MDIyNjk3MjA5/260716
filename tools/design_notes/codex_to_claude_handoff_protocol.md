# 作業引き渡しプロトコル v2

**作成日**: 2026-07-22
**対象**: このリポジトリで変更を設計・レビュー・適用するAIと、その間を仲介する人間

## 1. 目的

この文書は、開発者AI、レビュアーAI、Claude Code、人間の責任境界と停止条件を定める。人間は、パッチ、レビュー結果、適用指示を各AI間で受け渡すだけとし、実装、レビュー、Git操作の判断主体にはならない。

正式なワークフローは次のとおり。

```text
開発者AI
  設計・実装
  恒久テスト作成
  対象回帰および全回帰
  バグ注入
  注入後の完全復元
  cleanなパッチ作成
        ↓
レビュアーAI
  パッチと検証証跡をレビュー
  Approve / Request changes
        ↓ Approve後のみ
Claude Code
  remote同期
  パッチ同一性確認
  適用可能性確認
  承認済みパッチ適用
  指定された最小受入検査
  diff・secret・clean確認
  forceなしpush
        ↓
レビュアーAI
  remote SHA・tree・変更範囲を最終照合
```

開発者AIにはChatGPT Work、Codex等を利用できるが、製品名ではなく上記の役割名で責任を判断する。

## 2. レビュー承認ゲート

Claude Codeがパッチを適用できるのは、レビュアーAIの`Approve`後のみである。次のいずれかに該当する場合、Claude Codeは作業を停止し、人間へ差し戻す。

- レビュー結果が`Request changes`
- 未レビュー
- レビュー結果不明
- パッチのファイルサイズ、SHA-256、stable patch-id、コミット情報等の識別情報が不一致
- 対象repository、branch、expected remote HEAD、許可された変更範囲のいずれかが不明または不一致

人間から「適用してよい」と伝えられた場合でも、レビュアーAIの明示的な`Approve`とパッチ識別情報を確認できなければ適用してはならない。Claude Codeはレビュアー判断を上書きしない。

## 3. 開発者AIの責任

開発者AIは、レビューに提出する前に次を完了する。

- 設計および実装
- 恒久テストの追加
- 変更の影響範囲に対する回帰テスト
- 必要な全回帰テスト
- バグ注入検証
- 各注入後の完全復元
- `git diff --check`
- secret scan
- fixtureと一時ファイルの復元・除去
- コミット後のworking tree clean確認
- レビュー用パッチの作成
- 検証結果とパッチ識別情報の報告
- 引き渡し完了時点でremoteが未変更であることの確認

回帰範囲を過去の固定件数で定義してはならない。正本は、**その時点でリポジトリに存在し、変更の影響を受ける全検査**である。開発者AIは、実行した検査名、スクリプト数、成功件数を個別の引き渡し報告に明記する。

開発者AIは、レビュアーAIから`Request changes`を受けた場合、指摘を反映した新しいcleanなパッチを作成し、識別情報を更新して再レビューへ提出する。旧パッチを再利用してはならない。

## 4. バグ注入の安全規則

バグ注入は開発者AIの責任であり、次の条件をすべて守る。

- push対象worktreeで直接実施せず、disposable worktreeまたは一時コピーで実施する
- 1件ずつ「注入 → 期待する失敗の確認 → 復元 → 空diff確認」を完結させる
- 複数の注入を同時に残さない
- 各注入後に`git diff --exit-code`等で完全復元を確認する
- セッションが中断した場合、未復元の可能性があるものとして扱う
- 再開時は、最初にworking treeと注入対象行を確認する
- 最終パッチ作成前に、非注入の正式状態で全通常検査を再実行する

開発者AIが注入後の完全復元を確認できない場合、パッチをレビューへ提出してはならない。

## 5. 開発者AIからレビュアーAIへの引き渡し

開発者AIは、次の情報を一組としてレビュアーAIへ渡す。

```text
パッチファイル
ファイルサイズ
SHA-256
stable patch-id
ローカル完全コミットSHA
親SHA
tree SHA
変更ファイル一覧
変更意図
影響範囲
実行した検査と成功件数
バグ注入結果
復元確認
git diff --check結果
secret scan結果
working tree clean
remote未変更
```

レビュアーAIは、パッチと検証証跡を独立に確認し、`Approve`または`Request changes`を明示する。

## 6. レビュアー承認後のClaude Codeへの引き渡し

レビュアーAIが`Approve`した後、人間は次の情報だけをClaude Codeへ渡す。

```text
承認済みパッチ
パッチ識別情報
対象repositoryとbranch
期待remote HEAD
許可された変更ファイル
最小受入検査
push条件
禁止操作
```

Claude Codeは、引き渡し情報を独自に補完したり、未承認の別パッチへ置き換えたりしてはならない。

## 7. Claude Codeの責任

Claude Codeの担当は、承認済み変更を安全に反映する次の作業に限定する。

- `git fetch`と対象ブランチの同期
- 作業開始前のworking tree clean確認
- local HEADとremote HEADの確認
- 引き渡し指示のexpected remote HEADとの照合
- パッチのファイルサイズ、SHA-256、stable patch-id等の同一性確認
- `git apply --check`による適用可能性確認
- 承認済みパッチの適用
- 適用後の変更ファイルが承認範囲内であることの確認
- レビュアーAIが指定した最小受入検査
- `git diff --check`
- 簡易secret scan
- 一時ファイル、fixture差分、未追跡ファイルがなくworking treeがcleanであることの確認
- forceなしpush
- commit SHA、親SHA、tree SHA、remote SHA、変更ファイル一覧、検査結果の報告

作業開始時は次を契約とする。

```text
git fetchを行い、引き渡し指示に記載されたexpected remote HEADと照合する。
```

本文中の「現在のHEAD」や過去のSHAを、将来作業の固定baseとして扱ってはならない。remote branchがexpected remote HEADから進んでいる、またはlocal HEADとremote HEADが一致しない場合、Claude Codeは適用せず停止して人間へ報告する。

## 8. Claude Codeの禁止事項と停止条件

Claude Codeは次を行わない。

- バグ注入
- 全回帰の重複実行
- 新規テスト作成
- 実装修正
- 設計変更
- 設計文書の独自訂正
- テストを通すためのassertion緩和
- 競合の意味的解消
- commit amend
- rebase
- force pushまたは`--force-with-lease`
- レビュアー判断の上書き

したがって、**Claude Codeはバグ注入を行わない**。また、**Claude Codeは全回帰を重複実行しない**。全回帰とバグ注入の証跡は開発者AIが作成し、Claude CodeはレビュアーAIが指定した最小受入検査だけを行う。

パッチ適用、最小受入検査、diff確認、secret scan、clean確認、またはpush前確認で問題を見つけた場合は、**問題時は修正せず停止**し、人間へ差し戻す。競合時に内容を推測して解消してはならない。途中状態がある場合は、承認済みの安全な中止手順で適用前の状態へ戻し、その事実を報告する。

**force push禁止**。履歴を書き換える操作も禁止する。通常のforceなしpushがnon-fast-forward等で拒否された場合も、自分でrebaseやamendを行わず停止する。

## 9. push後の最終照合

Claude Codeは、push後にremote branch SHAを取得し、次を人間経由でレビュアーAIへ報告する。

- push後の完全commit SHA
- 親SHA
- tree SHA
- remote branch SHA
- 変更ファイル一覧
- 最小受入検査の成功件数
- `git diff --check`結果
- secret scan結果
- working tree clean
- force未使用

レビュアーAIは、remote SHA、tree、親子関係、変更範囲、禁止ファイル不変、必要なCI状態を最終照合する。この照合が完了するまで、次の開発段階へ進まない。

## 10. リポジトリ情報の扱い

- 対象リポジトリ: `S0lLVUNISTA4MDIyNjk3MjA5/260717`
- 主な作業ブランチ: `claude/pdf-excel-json-overview-pigbne`
- B-3d全体の範囲・制約: `tools/design_notes/b3d_handoff.md`

このプロトコルv2改訂時点の参考情報は、commit `bd51409f00df6eda324d1642701c0645f3d2a07f`、tree `b2cf2e19d930ce2a796e670a6d4d621dfa93cd0d`である。この値は改訂作業の出発点を記録するだけであり、将来作業のexpected remote HEADではない。

## 11. 改訂履歴

### 2026-07-22 v2

- Claude Codeの担当を、承認済みパッチの同一性確認・適用・最小受入検査・forceなしpushへ縮小
- 全回帰、バグ注入、復元、実装修正は開発者AIの責任へ移管
- レビュアーAIの`Approve`を必須適用条件として追加

### 2026-07-22 v1

- 人間が行っていたパッチ適用・検証・pushをClaude Codeへ移す初版を作成
