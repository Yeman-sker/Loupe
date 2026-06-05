# 阶段 UI-5 · Pin detail 与 View all（接 resolve / delete / copy）

> **对应里程碑：M2｜ Surface 6 + 7** ｜ 单 mark 任务卡与当前 route/session 列表，所有反馈就地发生（无 toast），接真实 store 与 `copy_markdown`。

## 阶段目标

- **Pin detail（comment-first 任务卡）。** 层级：弱化的 tiny target label（`#3 button "Save" · div.relative.flex`）→ comment（主内容）→ compact meta token 行（`open · located 100% · synced · style`）→ actions；不使用旧表格式字段布局。
- **Detail actions 就地。** 主「标记完成 / Mark done」无确认 → 原位变 `✓ Done`、pin 转 done、稍后关闭（调用阶段 2 `resolve_annotation`）；ghost「复制 Markdown」原位 `已复制 / Copied`，失败原位 `Copy failed` 可重试；danger「删除」两步原位（`删除? / Delete?` → 确认 → `已删除 / Deleted`，调用 `delete_annotation` 写 tombstone），`Esc` / 移开 / 超时 disarm。无 dialog / toast / undo。
- **View all（右侧 panel）。** header：iris-dot project + mono route + `✕`；sub：open count + 「显示已完成 / Show done」toggle（默认隐藏 done）；list item：`#n` + comment（单行省略）+ 第二行 `target · kind · located/drifted/lost · sync`，hover 高亮、current = iris-veil，click → jump + 开 detail；empty state（`本页还没有 mark` + Start picking）。
- **Copy all Markdown。** 默认 ghost；当存在 `local only` / `sync failed` 时提升为 primary。接阶段 2 `copy_markdown`（当前 route/session 的 open marks）。

## 验收标准

- 从 pin / detail / view-all 可手动 Resolve、Delete、Copy（功能可用，写真实 store 并反映到 pin 与列表）。
- View all 默认显示当前 route/session 的 open marks，done 在 toggle 后可见，并展示 task / locator / sync 三类状态。
- 所有反馈就地发生（button state / inline token / pin transition / card state），无 toast；danger 操作需就地二次确认。

## 范围边界（本阶段不做，留待后续）

- Agent 经 MCP `resolve_mark` / `delete_mark` 后回写浏览器本地的 **reconciliation** → 阶段 3；本阶段只做用户在浏览器侧发起的 resolve / delete / copy。
- project chooser、page-level fallback 与 sync 状态真值映射 → UI-6。

## 依赖

- UI-4：pin 状态（detail 与 pin 状态联动）。
- 阶段 2：`resolve_annotation`、`delete_annotation`（tombstone）、`copy_markdown`。

## 对应 surface 与里程碑

- Surface：6（pin detail）/ 7（view all）。
- interaction-spec：§8、§9、§11；验收场景 §16.9 / 16.10。
- 里程碑：M2（PRD §9.5、§9.7、§12.1）。
