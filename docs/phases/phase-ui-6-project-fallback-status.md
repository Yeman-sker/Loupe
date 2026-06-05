# 阶段 UI-6 · Project chooser、Page-level fallback 与 sync / locator 状态映射

> **对应里程碑：M2（surface）+ 忠实反映 M3 / M4 状态真值｜ Surface 2 + 8（跨切面状态）** ｜ 表达 project 边界与 local-first / sync / MCP 可用性，不阻断保存；把真实 sync / locator 状态映射进所有 surface。

## 阶段目标

- **Project chooser。** origin 映射多个 project 时，进 picker 前选择（`pname` + `ppath`，选中 = iris veil + radio dot + hairline-iris 边）；单 project 自动使用、不打扰；选定后本 origin/session 不反复询问；「仅本地继续 / Continue locally」→ `local only` / `project not linked`。current project 在 view all header 与 picker mode indicator 中低噪声可见。
- **Page-level fallback。** daemon offline / no MCP：底部居中软卡「已保存到本地。Agent 同步不可用。」+ Copy Markdown + `local only` token，不使用错误语气；sync failed：mark / detail / view-all 中显示 `sync failed` token + Retry + Copy Markdown。
- **状态真值映射。** 把 store 中真实的 `sync.status`（`local_only` / `syncing` / `synced` / `failed`）与 `locator_status` + `confidence`（located / drifted / lost）映射到 pin / detail / view-all / fallback 的 token；token / auth 严重阻断 Agent read 时，在 view all 顶部小提示（非全页 banner）。

## 验收标准

- 多 project → 显示 chooser；单 project 自动使用；local fallback 标 `local only` / `project not linked` 且仍可保存 + Copy Markdown。
- daemon offline 显示弱提示且保存成功（**不**呈现为创建失败）；sync failed 提供 Retry + Copy Markdown。
- pin / detail / view-all 的状态 token 与 store 真实 `sync` / `locator` 一致；反馈就地、无 toast。

## 范围边界（本阶段不做，留待后续）

- daemon 在线的**实际同步推进**（`local_only → syncing → synced`）由阶段 3 引擎驱动；**活体漂移恢复**（route / detach 后 drifted/lost 的恢复）由阶段 4 引擎驱动。本阶段只**忠实呈现**其结果并提供 Retry / Copy 兜底入口。
- onboarding 分支文案与发布级视觉打磨 → UI-7。

## 依赖

- UI-5：detail / view all 已能呈现状态与触发 copy / retry 入口。
- 阶段 0：project / session scope；阶段 2：`sync.status`、retry / copy 入口。
- 呈现层依赖阶段 3 / 阶段 4 产出的 sync / locator 状态（不在本阶段实现其引擎）。

## 对应 surface 与里程碑

- Surface：2（project chooser）/ 8（page-level status / fallback）。
- interaction-spec：§4、§10、§13；验收场景 §16.1 / 16.2 / 16.8。
- 里程碑：M2 surface（PRD §8.2、§9.7、§4.1.11）+ 反映 M3 / M4 状态真值。
