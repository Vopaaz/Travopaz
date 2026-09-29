# Travopaz AI Editing Guide · schemaVersion 1

这份指南用于外部 coding / planning agent 直接编辑工作区。应用没有集成 AI API。

## 工作区与安全编辑流程

一个 Workspace 对应一次 Trip。`workspace.json` 保存 canonical data；`attachments/<id>` 保存已复制的附件。JSON Schema 在 `schemas/workspace-v1.schema.json`，运行时严格校验在 `src/domain/schema.ts`。全局对象 ID 必须唯一，推荐 UUID。

1. 读取当前文件，保留所有无关内容和对象 ID。
2. 只编辑 canonical 字段；不要生成派生字段。
3. 保留 `schemaVersion: 1`，按 schema 校验；时间必须是带 UTC offset 的 ISO 8601 字符串。
4. 建议在同目录写临时文件后原子替换 `workspace.json`。避免从旧快照覆盖用户的新编辑。
5. Electron watcher 会重新读取、验证、重建派生状态。若 schema 无效，应用保留最后有效视图并暂停保存；修复文件即可恢复，不需要删除工作区。

结构性校验与业务检查分开：schema 正确但活动重叠、时长为负、边界未配对等临时 invalid state 可以保留并显示 issue。不要为了消除 issue 自行移动用户项目。

## 顶层结构

```json
{
  "schemaVersion": 1,
  "id": "workspace-uuid",
  "trip": {},
  "globalConfig": {},
  "candidates": [],
  "statuses": [],
  "blocks": [],
  "edgeOverrides": {},
  "attachments": []
}
```

实际必需字段请以 schema 和 `examples/kyoto-workspace.json` 为准，不可把上述省略结构直接当有效文件导入。

## 时间与 Location

所有用户时间字段使用 `{ "instant": "2026-10-12T02:00:00.000Z", "timezone": "Asia/Tokyo" }`。

`instant` 表示绝对时刻；`timezone` 是该字段原始输入时区。起止字段可以各自使用不同 IANA 时区。显示时区只是 UI 偏好，不重写上述字段。夏令时回拨的重复小时用不同 absolute instant 表示；不存在的本地时间不能输入。

Location 包括 `name,address,googleMapsUrl,appleMapsUrl` 字符串。坐标不属于 canonical 模型。地址可为空，但缺少可识别地点会出现路线 issue。自定义导航链接可为空，UI 会从名称／地址构造 Google Maps 与 Apple Maps 入口。

统一 metadata：`notes,reservation` 为字符串；`links` 为 `{label,url}[]`；`tags`、`attachmentIds` 为字符串数组。

## Candidate Definition 与 Placement

Candidate 的 `kind` 有三种：

- `activity`：title、location、metadata、constraints。
- `transport`：subtype（flight/train/ferry/bus/other）、origin、destination、departure、arrival、preBuffer、postBuffer、operator、serviceNumber、metadata。
- `boundary`：statusId、role（start/end）、location、defaultStart、defaultEnd、metadata。

同一个 Candidate 可以有多个独立 Placement。普通 Placement：

```json
{
  "id": "block-uuid",
  "kind": "candidate",
  "candidateId": "candidate-uuid",
  "start": { "instant": "2026-10-12T02:00:00Z", "timezone": "Asia/Tokyo" },
  "end": { "instant": "2026-10-12T03:00:00Z", "timezone": "Asia/Tokyo" }
}
```

第一次拖入 transport 时从 departure / arrival 复制；boundary 从 defaultStart / defaultEnd 复制，必要时用 1 分钟保证初始正时长。之后独立编辑，不能反向改写 Definition。普通活动初始 60 分钟是可修改的编辑起点，不是额外业务约束。

## Activity constraints

```json
{
  "intervals": [{ "relation": "within", "start": {}, "end": {} }],
  "minMinutes": null,
  "maxMinutes": null
}
```

`within` 表示 Placement 全部位于区间内；`covers` 表示 Placement 全部覆盖区间。多个 intervals 是 OR 关系。intervals 为空表示无时间区间限制。Duration 与 intervals 独立；null 表示无对应限制，min=max 表示精确时长。示意中的空时间对象必须替换为完整 ZonedTime。

## Status 与 Boundary

`statuses` 定义酒店／租车实例：`id,kind,title,location,metadata`，kind 是 hotel 或 rentalCar。此实例数据不是用户可拖动 Block。

Boundary Definition 通过 statusId 引用实例，Placement 出现在主 Timeline 或 Option Variant。某一实际方案中必须恰好有一个 start Boundary 和一个 end Boundary，且各自 duration 为正。有效状态范围是 startBoundary.end 到 endBoundary.start，不包含办理手续。未配对、反向、重复或重叠会产生 issue，系统不修复。

同一笔预订的 metadata 可在 status 实例保存；Boundary 自身也有独立 metadata。酒店实例 location 用于 Overnight／酒店休息；Boundary location 用于办理地点与路线。

## Major Transport 与普通 Travel Edge

transport 的 departure / arrival 是真实 scheduled time，preBuffer / postBuffer 为分钟。缓冲在新建 Definition 时复制当前默认值，后续不受默认设置变化影响。

交通前一条 Edge 需要在 `departure - preBuffer` 前抵达，后一条从 `arrival + postBuffer` 后出发。Placement 不一致会报错，检查仍使用 scheduled buffered interval 外沿。Activity 没有通用 pre/post buffer。

Travel Edge 由相邻具体项目自动生成，不可写入 canonical，不是 Candidate。唯一可写内容是 `edgeOverrides`：key 为 `fromId>toId`，value 必须为 WALK、DRIVE 或 RIDESHARE。删除该 key 恢复默认推导。不要写 AUTO，也不要写人工 route duration。

默认优先在有有效租车状态的完整路段使用 DRIVE；否则查询步行耗时，与 walkingThreshold 比较决定 WALK／RIDESHARE。未知查询结果为 null，不能当 0。相同已知地址的零路程是明确的同地特例。普通 overhead 属于 Edge。

特殊端点 ID：`trip-start`、`trip-end`；Overnight ID：`overnight:<breakPointId>:<statusId>`。普通边使用持久 Block ID；相邻关系消失时 override 可以成为未使用记录，重新出现时仍可恢复。

## Option

```json
{
  "id": "option-uuid",
  "kind": "option",
  "title": "午后方案",
  "metadata": { "notes": "", "reservation": "", "links": [], "tags": [], "attachmentIds": [] },
  "variants": [{ "id": "variant-uuid", "title": "方案 A", "blocks": [] }]
}
```

没有 start、end、selectedVariantId。每个 Variant 内是拥有绝对时间的具体 Block（普通 Candidate Placement 或酒店休息）；不支持嵌套 Option。空方案会提示无法确定完整路径。

Option 外框是所有内部 Placement 的最早 start 至最晚 end。整体移动同步平移所有内部起止时刻，不能 Resize 外框。所有保留 Variant 都参与完整路径的 incoming/internal/outgoing 检查。解除包装只在剩一个 Variant 时可用；其内部 ID、时间均保持不变。

各 Variant 对外的状态净改动应一致，不能某条取车、另一条没有取车却隐含任选其一。内部开启并关闭、净影响为零的状态不要求其他方案复制。具体身份与歧义规则参阅 `docs/DECISIONS.md`。

## 酒店休息、Overnight 与旅行起终点

酒店休息为 `kind: hotelRest`，直接保存在 blocks 或 Variant blocks，带 id、title、start、end、metadata；没有 Candidate Definition。地点由完整覆盖 Placement 的唯一酒店状态推导，不保存 Location 或额外 constraints。

`trip.overnightBreaks` 是 `{id,time}[]`，仅属于 Trip，不继承 Global Config。创建 Trip 时可按主时区每晚 03:30 初始化，之后修改显示范围不会自动重建。删除点表示不要求该次住宿。

Break Point 与实际 Block 相交报错。没有有效酒店覆盖报 blocking issue。存在前后具体项目及酒店时，系统通过回酒店／离酒店路线推导 Overnight；路线未知则时间未知。不要写 Overnight Block。

`trip.startLocation/endLocation` 是用户输入；`trip.displayStart/displayEnd` 只决定显示范围。Derived Trip Start 是为首个项目准时抵达所需的离开时刻，Trip End 是末项目后预计到达的时刻；不能持久化这些派生时间。Option 导致多条路径时，出发取最早要求，到达取最晚估计；任一路径未知时保持未知。

## Config、附件与导出边界

globalConfig 保存 Home、默认交通 buffers、各 mode overhead、walkingThreshold、routingProvider、navigation。trip.config 只保存覆盖项。Trip 的地点、显示范围、timezone list、primaryTimezone、overnightBreaks 是 Trip 自身数据。primaryTimezone 必须在列表中。

attachments 数组只保存 `{id,name,mime,path,size}`。path 必须是 `attachments/<安全ID>`，不可使用绝对路径、`..` 或外部文件引用。实际二进制文件必须同步复制到 Workspace。metadata.attachmentIds 负责对象与文件关联；Undo 后未引用的附件仍保留以便 Redo。

Canonical 不保存：Travel Edge、route cache、issue、status interval、Overnight、Trip Start/End 派生块、displayTimezone 的转换结果。Workspace ZIP 用于恢复编辑状态；人类 HTML 与 AI context JSON 是最终只读行程，不用于重新导入。

当前首版 schemaVersion 为 1，load / validate / save 入口已统一；未知版本明确拒绝，绝不猜测字段或偷偷修复。未来升级必须在 migrateWorkspace 中增加显式转换后再接受对应版本。
