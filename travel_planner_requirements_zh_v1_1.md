# 本地旅行规划应用需求说明

语言：中文 UI / 中文产品文档
定位：本地优先、可视化、约束检查型旅行计划工作台

---

## 1. 产品目标

本应用用于规划一次旅行中的活动、交通、住宿、租车与备选方案。

核心目标不是自动替用户生成、优化或调整行程，而是提供一个可视化工作台，让用户自己安排所有 Timeline 内容，并由系统持续进行只读的派生计算与一致性检查。

用户负责决定：

- 要去哪些地方；
- 哪些交通、住宿、租车安排属于本次旅行；
- 每个项目放在哪一天、什么时间；
- 每个用户可编辑 Block 在 Timeline 上的起止时间；
- 使用哪种交通方式；
- Option 最终采用哪个方案；
- 哪些夜晚需要住宿；
- Trip 的显示范围、地点与时区。

系统负责：

- 按时间比例展示用户安排；
- 根据相邻项目和当前状态推导 Travel Edge；
- 查询非实时路线耗时；
- 推导默认交通方式；
- 推导住宿、租车等状态；
- 推导 Overnight 与 Trip 起终点相关的只读信息；
- 检查时间、地点、交通、状态和 Option 的一致性；
- 将问题清晰地显示为 issue；
- 允许用户保留任何临时 invalid state。

系统不得自动：

- 移动 Timeline 上的用户项目；
- 改写用户项目起止时间；
- 自动顺延后续项目；
- 自动重排活动；
- 自动选择 Option；
- 因 consistency issue 阻止用户拖拽或编辑。

核心原则是：

> 用户拥有 Timeline；系统只负责 derive、lookup、calculate、validate、display。

---

## 2. 核心用户心智模型

一次 Trip 主要由以下部分组成：

1. Candidate Library
2. Timeline
3. Trip Metadata
4. Global / Trip Config
5. Derived Information
6. Attachments
7. Workspace Persistence

### 2.1 Candidate Library

Candidate Library 是本次旅行相关“已知但尚未完全安排”的内容库。

以下三类对象都应先在 Candidate Library 中创建：

- Activity
- Major Transport
- Status Boundary

例如：

- 想去的景点或餐厅；
- 已购买的头尾机票；
- 已订好的火车；
- 已订好的酒店；
- 已订好的租车。

它们进入 Timeline 的主要方式是拖拽。

Candidate Library 和 Timeline 应遵循统一心智模型：

> 先创建“这是什么”，再把它拖入 Timeline 表达“这次准备何时使用它”。

Option 是例外。Option 本身用于 Timeline 内表达多个尚未决策的方案，不属于 Candidate Library 的普通 Candidate 类型。

### 2.2 Timeline

Timeline 表示用户当前实际安排出的旅行计划。

Timeline 上所有用户可编辑 Block 都有明确 Placement。

Placement 表示用户决定：

- 哪一天；
- 什么开始时间；
- 什么结束时间。

系统不会根据前后关系自动更改 Placement。

### 2.3 Definition 与 Placement 分离

Candidate 的 Definition 与 Timeline Placement 必须严格分离。

Definition 表示对象本身的信息与约束，例如：

- 名称；
- Location；
- Reservation；
- Scheduled time；
- Placement constraint；
- Attachments。

Placement 表示：

- 当前在 Timeline 中放在哪个具体时间段。

即使 Definition 具有强时间限制，用户仍可把 Placement 拖到不合法的位置。此时系统只产生 consistency issue，不阻止操作。

---

## 3. Block 分类

### 3.1 用户可创建、可编辑的四类 Block

Timeline 中共有四类用户可创建、可编辑的一级 Block：

1. Activity Block
2. Major Transport Block
3. Status Boundary Block
4. Option Block

其中：

- Activity、Major Transport、Status Boundary 可以来自 Candidate Library；
- Option 只存在于 Timeline 规划层。

### 3.2 系统推导的视觉 Block

系统还可以在 Timeline 中显示只读的 Derived Block。目前包括：

1. Derived Overnight Block
2. Derived Trip Start Block
3. Derived Trip End Block

这些 Derived Block：

- 不属于 Candidate Library；
- 用户不能拖动；
- 用户不能 Resize；
- 用户不能直接编辑时间；
- 时间与位置完全由其它 canonical data 推导。

---

## 4. Activity Block

Activity Block 表示一个普通旅行活动，例如：

- 景点；
- 餐厅；
- 徒步；
- Tour；
- 演出；
- 酒店休息。

### 4.1 Activity 基础属性

Activity Definition 至少应支持：

- 名称；
- Location；
- Placement constraints；
- Notes；
- Links；
- Attachments；
- Tags。

### 4.2 Location

Location 主要包含：

- 地点名称；
- 地址；
- Google Maps Link；
- Apple Maps Link。

Google Maps 与 Apple Maps 应分别有可用入口，并允许用户按个人偏好一键打开导航。

Latitude / longitude 不属于面向用户的核心数据模型。若 Routing Provider 内部需要坐标，可作为 provider/cache 层派生数据处理。

---

## 5. Activity Placement Constraint

Activity 的 Placement Constraint 统一分为两个彼此独立的维度：

1. 时间区间约束
2. Duration 约束

一个 Activity 可以同时拥有两类约束，也可以两类都没有。

---

## 6. 时间区间约束

时间区间约束描述：

> Activity Placement 与某些时间区间之间必须满足什么关系。

支持以下类型。

### 6.1 无时间区间约束

Activity 可以放在任意时间。

这只代表“没有时间区间限制”，不代表没有 Duration 限制。

### 6.2 Placement 必须包含于某个允许区间

完整 Placement 必须落在允许区间内部。

典型用途：

- 景点开放时间；
- 某个服务可使用时间。

例如允许区间为 09:00–17:00，则 Activity 的 start 和 end 都必须位于该区间中。

允许存在多个合法区间。

### 6.3 Placement 必须覆盖某个必需区间

某一时间段必须完整包含在 Activity Placement 内。

典型用途：

- Activity 包含一个固定演出，同时允许用户把演出前后的附近活动也归在同一个 Activity 中。

例如必需区间为 19:00–20:00：

- Placement 18:30–20:30 合法；
- Placement 19:00–20:00 合法；
- Placement 19:15–20:15 不合法。

允许存在多个候选区间。

当存在多个候选区间时，Activity Placement 只需满足其中一个合法选项。

### 6.4 多个合法区间

一个 Activity 可以存在多个合法区间，每个区间具有明确关系语义：

- Placement 必须被该区间包含；
- 或 Placement 必须覆盖该区间。

这用于表示多个预约 slot 或多个可接受时间段。

---

## 7. Duration 约束

Duration 约束独立于时间区间约束。

支持：

### 7.1 无 Duration 限制

Activity Placement 的长度不受限制。

### 7.2 最短 Duration

Placement duration 必须至少达到指定长度。

### 7.3 最长 Duration

Placement duration 不得超过指定长度。

### 7.4 Duration Range

同时存在最短与最长限制。

Exact Duration 可以表达为：

- min duration = max duration。

---

## 8. Activity Placement 行为

Timeline 中 Activity Placement 始终由用户控制。

用户可以：

- 拖动整个 Block 修改时间；
- Resize Block 修改起止时间；
- 跨日期移动；
- 批量移动；
- 将其放入违反 Definition constraint 的位置。

任何非法状态均允许存在，只在 UI 上显示 issue。

系统不得自动：

- 推导“应该几点开始”；
- 自动设置下一个 Activity；
- 自动改变 Placement；
- 根据 Travel Edge 顺延后续内容。

---

## 9. Major Transport Block

Major Transport 表示本身就是行程主体的大型、通常需要预订的交通。

可包含 subtype：

- Flight；
- Train；
- Ferry；
- Intercity Bus；
- Other。

### 9.1 Major Transport Definition

至少包含：

- 名称；
- subtype；
- Origin；
- Destination；
- Scheduled Departure；
- Scheduled Arrival；
- Pre-departure Buffer；
- Post-arrival Buffer；
- Operator；
- Service / Flight / Train Number；
- Reservation metadata；
- Notes；
- Links；
- Attachments。

### 9.2 Scheduled Time 与 Placement

Scheduled Departure / Arrival 属于 Major Transport 本身的真实属性。

第一次从 Candidate Library 拖入 Timeline 时：

- Placement 默认自动对应 scheduled time。

之后用户可以：

- 移动；
- Resize；
- 批量移动；
- 把它放在与 scheduled time 不一致的位置。

系统允许该状态存在，但产生 consistency issue。

Scheduled time 本身不会因 Placement 移动而改变。

---

## 10. Major Transport Buffer

每个 Major Transport 都有自身的：

- Pre-departure Buffer；
- Post-arrival Buffer。

语义分别是：

- 用户计划提前多久抵达机场 / 车站 / 港口等；
- 到达后预计多久才能真正离开机场 / 车站 / 港口等。

这两个 buffer：

- 是 Major Transport Definition 的正式属性；
- 在创建 Major Transport 时从适用的默认 Config 读取初始值；
- 用户可以在具体 Major Transport 上单独修改；
- 修改具体 Major Transport 后不影响默认 Config。

### 10.1 Timeline 视觉结构

Major Transport 在 Detailed Timeline 中应显示为深浅两层：

- 外层浅色：整个 buffered interval；
- 内层深色：Scheduled Departure 到 Scheduled Arrival 的交通工具本体时间。

视觉上应能直接看出：

1. 提前到达 terminal/station 的 buffer；
2. 交通工具实际运行时间；
3. 到达后的离开 buffer。

Travel Edge 的 consistency checking 使用 buffered interval 的外沿：

- 前一个 Travel Edge 必须能在 `scheduled departure - pre-buffer` 前到达；
- 后一个 Travel Edge 从 `scheduled arrival + post-buffer` 之后开始计算。

---

## 11. 普通 Buffer 的归属

除 Major Transport 自身特殊 pre/post buffer 外，普通“小 buffer”统一属于 Travel Edge，不属于 Activity。

例如：

- 开车时走到停车场、取车、停车后的步行；
- Rideshare 等车时间；
- Transit 进站等固定额外耗时；
- 其它从一个 Block 切换到下一个 Block 的摩擦成本。

Consistency checking 使用：

`前一个 Placement 结束 → Travel Edge route duration + edge buffer/overhead → 后一个 Placement 开始`

Activity 本身不引入通用 pre/post buffer。

---

## 12. Status Boundary Block

Status Boundary 表示某个状态的开始或结束。

典型 subtype：

- Hotel Check-in / Check-out；
- Rental Car Pickup / Return。

每一个 Status Boundary Block 本身的 Timeline 行为与 Activity Block 尽量一致：

- 有完整 Placement interval；
- 可以拖动；
- 可以 Resize；
- 可以单独修改起止时间；
- 可以被批量移动；
- 可以拥有自己的 metadata、notes、links 与 attachments；
- 任何 invalid placement 都只产生 issue。

### 12.1 Boundary 必须有正 Duration

Status Boundary 不能是纯时间点。

每一个 Boundary 都必须具有：

- start；
- end；
- 正数 duration。

如果业务语义近似“瞬时时间点”，可以使用非常短的 Block，例如 1 分钟，作为足够好的近似。

不引入独立的 point-event 模型。

### 12.2 Boundary 可以在临时状态中与其它 Block 重叠

作为用户编辑过程中的临时 invalid state，Status Boundary 可以与其它 Block 在时间上重叠。

但若这种 overlap 违反当前业务约束，则必须产生对应 consistency issue。

“允许重叠”只表示系统不阻止用户编辑，不表示重叠状态本身合法。

### 12.3 Boundary 必须成对

同一个 status instance 在最终 consistent state 中必须存在成对的：

- start boundary；
- end boundary。

例如：

- Hotel Check-in + Hotel Check-out；
- Rental Car Pickup + Rental Car Return。

若缺少配对，则产生 blocking consistency issue。

### 12.4 Status Interval

一对合法 Boundary 之间自动形成 status interval。

Status interval 本身不是用户创建的 Block，而是 derived state。

---

## 13. Hotel Status

Hotel Check-in / Check-out Boundary 之间形成 Hotel Status。

Hotel Status 至少包含：

- 酒店 Location；
- Reservation metadata；
- Notes；
- Links；
- Attachments。

Hotel Status 用于：

- 推导某一晚的住宿地点；
- 生成 Derived Overnight Block；
- 生成与酒店相关的 derived Travel Edge；
- 判断某个时间段是否允许创建“酒店休息”活动。

若某个配置为需要住宿的 Overnight Break Point 没有有效 Hotel Status 覆盖，应产生 blocking issue。

---

## 14. Rental Car Status

Rental Car Pickup / Return Boundary 之间形成 Rental Car Status。

在有效区间内：

- Travel Edge 默认交通方式优先推导为 DRIVE。

在有效区间外：

- 不得自动假设有车。

如果用户手动将某条 Travel Edge 设为 DRIVE，而当时无有效 Rental Car Status：

- 允许保留；
- 产生 consistency issue。

---

## 15. Status Timeline 可视化

Status 不放在 Day Header 中。

Detailed Timeline 左侧应有一个或多个纵向状态条，用来显示 status interval。

原因是 Status 可能：

- 在一天中间开始或结束；
- 跨多天；
- 同一天发生酒店切换；
- 同时存在多个不同类型状态。

例如可同时显示：

- Hotel；
- Rental Car。

纵向状态条必须和时间轴等比例对齐，从对应 Start Boundary 延伸到 End Boundary。

---

## 16. Overnight Break Point

Overnight Break Point 属于 Trip 本身的数据，用于定义哪些跨日边界需要进行住宿语义检查，并决定 Derived Overnight Block 的插入位置。

它不是 Global Config，也不从 Global Config 继承。

### 16.1 初始生成

创建 Trip 时，应用可以根据 Trip 的显示时间范围批量生成一组 Overnight Break Point。

默认建议时间为：

- Trip Primary Timezone 的 03:30。

这些 Break Point 一旦生成，就是 Trip 自身的数据。

### 16.2 用户可编辑

用户可以：

- 修改某个 Break Point 的时间；
- 删除某个 Break Point；
- 增加新的 Break Point。

删除某个 Break Point 的语义是：

> 这个跨日边界不要求 lodging。

典型用途包括：

- 红眼航班；
- 夜间火车；
- 通宵活动；
- 其它不需要酒店住宿的特殊夜晚。

因此，是否需要 Overnight / Hotel coverage 由实际存在的 Break Point 决定，而不是按所有自然日强制要求。

---

## 17. Derived Overnight Block

Derived Overnight Block 完全由系统推导。

用户不能：

- 在 Candidate Library 创建；
- 在 Timeline 主动创建；
- 拖动；
- Resize；
- 修改任何时间字段。

它的 Location 来自该 Break Point 时刻有效的 Hotel Status。

### 17.1 Overnight Block 生成条件

对于一个存在的 Overnight Break Point：

1. Break Point 之前存在属于前一 travel period 的最后一个具体可安排 Block；
2. Break Point 之后存在属于后一 travel period 的第一个具体可安排 Block；
3. Break Point 被有效 Hotel Status 覆盖。

满足条件时自动生成 Overnight Block。

若存在该 Break Point 和前后活动，但没有有效 Hotel Status 覆盖：

- 不生成正常 Overnight Block；
- 产生 blocking lodging issue。

如果该 Break Point 已被用户删除：

- 不要求该夜晚存在 Hotel Status；
- 不生成 corresponding Overnight Block；
- 不因此产生 lodging issue。

### 17.2 Overnight Block 时间语义

Overnight Block 没有用户输入的固定 start/end。

系统根据：

- 前一 travel period 最后一个可安排 Block；
- 到酒店的 derived Travel Edge；
- 后一 travel period 第一个可安排 Block；
- 从酒店出发的 derived Travel Edge；

显示：

- “预计回到酒店”的时间；
- “至少需要离开酒店”的时间。

如果用户在前一侧新增或移动 Activity：

- Overnight Block 的派生时间自动随 derived information 更新。

这种变化不属于自动排程，因为 Overnight Block 本身不是用户计划对象，而是纯 derived information。

### 17.3 Overnight Block 视觉样式

Detailed Timeline 中：

- 使用非常浅的视觉层级；
- 明确区别于普通用户可编辑 Block；
- 不提供 drag / resize affordance。

---

## 18. 酒店休息 Activity

“酒店休息”是特殊 Activity subtype。

它：

- 不在 Candidate Library 创建；
- 可以直接在 Timeline 中手动创建；
- 用户手动指定完整 start/end；
- 不会被任何系统逻辑自动调整；
- Location 由该时间段有效 Hotel Status 自动推导。

它可以拥有普通 Activity 所需的 metadata，例如：

- 自定义标题；
- Notes；
- Links；
- Attachments；
- Tags。

例如用户可以把标题写成“在酒店吃早餐”“回酒店休息”等。

它没有额外时间区间或 duration constraint，唯一约束是：

- 整个 Placement 必须被同一个有效 Hotel Status 完整覆盖。

如果不满足：

- 产生 consistency issue。

---

## 19. Trip Metadata

每个 Trip 具有明确的 metadata。

至少包含：

- Trip 名称；
- Trip Start Location；
- Trip End Location；
- Trip Display Start Time；
- Trip Display End Time；
- Timezone List；
- Primary Timezone。

### 19.1 Trip Start / End Location

Trip Start Location 与 Trip End Location 可以不同。

Global Config 中可以保存一个 Home Address / Home Location。

创建新 Trip 时：

- Trip Start Location 默认从 Home Location populate；
- Trip End Location 默认从 Home Location populate。

之后用户可以在 Trip Metadata 中分别修改。

### 19.2 Trip Display Start / End Time

Trip Metadata 中可以配置：

- Trip Display Start Time；
- Trip Display End Time。

它们的目的主要是：

- 定义 Timeline 初始需要展示的时间范围；
- 定义 Calendar View 涵盖的日期范围；
- 让一个刚创建、尚未安排任何 Block 的 Trip 也有明确可编辑范围。

它们不是 Derived Trip Start / End Block 的时间。

它们可以由用户修改，不代表用户必须在该时刻真正离家或到家。

---

## 20. Derived Trip Start / End Block

Trip 开始与结尾使用两个特殊 Derived Block 表达：

1. Derived Trip Start Block
2. Derived Trip End Block

它们与 Overnight Block 类似：

- 不存在于 Candidate Library；
- 用户不能创建；
- 用户不能删除；
- 用户不能拖动；
- 用户不能 Resize；
- 用户不能直接修改时间。

用户唯一可以影响它们的位置来源，是修改 Trip Metadata 中的 Start / End Location，或修改第一个 / 最后一个真实 Timeline Block。

### 20.1 Derived Trip Start Block

Location：

- Trip Start Location。

时间由系统根据：

- Timeline 中第一个实际可安排 Block；
- Start Location 到该 Block 的 derived Travel Edge；
- 若第一个 Block 为 Major Transport，则使用其 buffered interval 外沿；

推导出：

> 必须从 Trip Start Location 离开的时间。

### 20.2 Derived Trip End Block

Location：

- Trip End Location。

时间由系统根据：

- Timeline 中最后一个实际可安排 Block；
- 该 Block 到 End Location 的 derived Travel Edge；
- 若最后一个 Block 为 Major Transport，则使用其 buffered interval 外沿；

推导出：

> 预计回到 Trip End Location 的时间。

### 20.3 Timeline 视觉样式

Derived Trip Start Block 位于 Timeline 顶端，使用只有下半部分可见的“半 Block”视觉：

- 表示 Timeline 从更早的外部状态截断进入本次 Trip。

Derived Trip End Block 位于 Timeline 底端，使用只有上半部分可见的“半 Block”视觉：

- 表示本次 Trip 在此后回到外部状态。

二者均使用明显的只读、derived 视觉样式。

Trip Display Start / End Time 只决定视图范围，不强制与这两个 Derived Block 的推导时间相同。

---

## 21. Option Block

Option Block 表示某一段行程尚未决定采用哪个方案。

Option 不属于普通 Candidate Library 内容。

一个 Option 包含多个 Variant。

每个 Variant 本身是一段小型 Timeline，可以包含：

- Activity；
- Major Transport；
- Status Boundary；
- 其内部 derived Travel Edge。

### 21.1 Variant 内部规则

Variant 内部遵循与主 Timeline 相同的基本规则：

- 用户拥有 Placement；
- 允许 invalid state；
- 系统只进行只读 consistency checking。

### 21.2 Option 对外 Worst-case 语义

Option 对 Parent Timeline 的 consistency checking 使用 conservative / worst-case 结果。

不能只比较 Variant 内部 Block duration。

必须考虑完整路径：

`Previous Block → incoming Travel Edge → Variant → outgoing Travel Edge → Next Block`

因为各 Variant 可能具有不同：

- 起点；
- 终点；
- 内部耗时；
- incoming travel time；
- outgoing travel time。

Parent Timeline 对 Option 的检查应基于所有 Variant 中最不利的完整路径。

该 worst-case 结果只用于检查，不会改变 Option 或相邻 Block Placement。

---

## 22. Travel Edge

Travel Edge 不是 Block。

它是系统根据相邻位置自动建立的 derived edge。

Travel Edge 可以拥有属性，但用户不负责创建或删除它。

至少包含：

- Origin；
- Destination；
- Travel Mode；
- Routing Duration；
- Edge Buffer / Overhead；
- Effective Duration；
- Routing 状态；
- 用户是否 override mode。

---

## 23. Travel Mode

Travel Edge 最终拥有明确 mode，不存在持久化的 `AUTO` mode。

至少支持：

- WALK；
- DRIVE；
- RIDESHARE。

未来若需要其它 mode，可作为扩展 subtype，但不影响现有模型。

### 23.1 默认推导规则

新 Travel Edge 创建时：

1. 如果该时间段存在有效 Rental Car Status，则默认 DRIVE；
2. 否则查询 walking duration；
3. 根据适用 Config 中的 walking threshold：
   - 小于等于 threshold → WALK；
   - 大于 threshold → RIDESHARE。

用户可以手动 override 某条 Edge 的 mode。

一旦用户手动 override：

- 系统不得因后续状态重新计算而擅自改变该选择；
- 除非用户主动恢复为“使用默认推导”。

---

## 24. Routing

Routing 只获取规划需要的最低限度信息。

不需要实时交通、实时拥堵、实时公交或其它实时数据。

优先使用非实时、成本更低的路线查询能力。

Routing 至少需要返回：

- duration；
- distance（如有展示或逻辑用途）。

Route Provider 与 Timeline 逻辑应解耦。

第一阶段使用 Google Maps 对应的非实时路线能力即可。

查询结果应缓存。

若 route lookup 失败：

- Travel Edge duration 不能视为 0；
- 显示 unknown / unavailable；
- 产生对应 issue。

### 24.1 Google Maps API 人工配置要求

Coding agent 只需要实现正常、官方支持的 Google Maps API 集成。

实现完成后，必须同时提供清晰的人类操作指南，说明：

1. 用户需要在 Google Cloud 中启用哪些必要 API；
2. 如何按官方流程创建 API Key；
3. 如适用，如何设置合理的 Key restriction；
4. 应将 API Key 放到本应用的哪个配置位置；
5. 如何确认 Routing 功能已经正常工作。

不得尝试通过非官方、绕过权限、自动窃取或其它 hacking 方式获得 API 访问权限或凭据。

API Key 由用户自行按官方流程获取并配置。

---

## 25. Consistency Checker

Consistency Checker 的唯一职责是回答：

> 当前用户制定的计划是否自洽？

它不得自动修复。

至少检查：

- 任何两个 Block 存在不合法 overlapping（除了作为 Option 的选项）；
- Activity Placement 不满足时间区间约束；
- Activity Placement 不满足 Duration 约束；
- 相邻 Block 间 Travel Edge 时间不足；
- Major Transport Placement 与 scheduled time 不一致；
- DRIVE 时没有有效 Rental Car Status；
- Status Boundary 未成对；
- Overnight Break Point 存在但 Hotel coverage 缺失；
- 酒店休息 Activity 未被完整 Hotel Status 覆盖；
- Option 某 Variant 导致 Parent Timeline 不可行；
- Location 缺失；
- Route 无法计算；
- 外部文件 schema invalid。

### 25.1 Issue Severity

至少支持：

- Blocking / Error；
- Warning；
- Info。

Blocking / Error 也不阻止编辑，只表达计划当前不一致。

---

## 26. Invalid State 原则

任何 Timeline 编辑都采用：

> Edit first, validate afterwards.

用户可以临时制造：

- Activity overlap；
- Status Boundary 与其它 Block overlap；
- 强约束 Activity 位于错误时间；
- Major Transport 被拖离 scheduled time；
- DRIVE 发生在租车区间之外；
- Hotel status 暂时缺失；
- Option 暂时无法容纳；
- 多个 Block 同时重叠。

系统只显示 issue，不拒绝操作。

---

## 27. 多选与批量移动

Detailed Timeline 必须支持多选。

至少支持：

- 鼠标框选；
- Shift / Ctrl / Cmd 增减选择；
- 多 Block 整体拖动。

批量移动必须保持选中 Block 之间的相对时间关系。

即使选中内容包含：

- 强约束 Activity；
- Major Transport；
- Status Boundary；

仍应允许整体移动。

移动后再统一运行 consistency checking。

---

## 28. Detailed Timeline View

这是主要编辑视图。

整体按 Trip 中的时间顺序从上到下排列，每一天内部必须使用 Calendar Day View 的视觉模型。

### 28.1 时间比例

每个 Day：

- 有明确纵向时间轴；
- Block 顶部位置对应实际 start；
- Block 底部位置对应实际 end；
- Block 高度与 duration 成比例；
- Block 之间空白与真实空闲时间成比例；
- 重叠 Block 可以视觉重叠或并排；
- Status Bar 与时间轴等比例对齐。

不得使用“一个卡片紧接一个卡片”的流程图式布局。

### 28.2 Travel Edge 显示

Detailed Timeline 中 Travel Edge 应在相关 Block 之间明确显示。

可展示：

- mode；
- route duration；
- edge overhead；
- effective duration；
- issue 状态。

### 28.3 Major Transport 双层显示

Major Transport 在 Timeline 中：

- 外层表示 buffered interval；
- 内层深色表示 scheduled transport interval。

用户应能直接看到三部分所占时间。

### 28.4 Derived Overnight Block

Overnight Block 使用很浅的视觉样式。

显示：

- 酒店；
- 预计回到酒店时间；
- 至少需要离开酒店时间。

不可交互。

### 28.5 Derived Trip Start / End Block

Timeline 顶部和底部分别显示只读的 Trip Start / End 半 Block：

- Start 只显示向下连接 Timeline 的半 Block；
- End 只显示从 Timeline 向上连接的半 Block。

分别展示：

- Trip Start / End Location；
- 推导出的离开 / 到达时间。

### 28.6 Status Bar

Timeline 左侧显示一个或多个纵向状态条。

状态条可表示：

- 当前酒店；
- 当前租车状态；
- 其它未来 Status Boundary subtype。

---

## 29. Timeline Zoom

Detailed Timeline 必须支持：

- Ctrl + Mouse Wheel 调整时间比例。

本质是改变视觉上的 pixels-per-minute。

低 zoom：

- 一屏看更多时间；
- 适合整体浏览。

高 zoom：

- 更容易精细拖动和 Resize。

Zoom 不得修改任何数据。

---

## 30. Calendar Overview View

第二类视图是 Calendar Overview。

布局类似传统月历 / 周历：

- 每行 7 列；
- Mon–Sun；
- 跨多周则继续下一行。

目标是：

> 一眼看出整个 Trip 每天已经安排了什么。

每一天主要显示：

- Block 标题；
- 必要的简洁状态提示。

不要求：

- duration 精确比例；
- 显示 Travel Edge；
- 显示完整 metadata。

该视图以 overview 为目标，不承担主要精细编辑职责。

Calendar Overview 的显示日期范围由 Trip Display Start / End Time 决定。

---

## 31. Timezone 模型

每个 Trip 有一个 timezone list。

### 31.1 Trip Timezone List

Trip Metadata / Trip Config 中配置本次旅行可能使用的所有 timezone。

其中指定一个：

- Primary Timezone。

新建项目时：

- 默认使用 Trip Primary Timezone。

### 31.2 Block 时间字段的 Timezone

任何项目的 start/end 都可以分别拥有自己的 timezone。

同一个 Block 的 start 和 end 允许使用不同 timezone。

该能力是 generic 的，不仅限于 Flight。

### 31.3 Timeline / Calendar 显示时区

整个 Timeline 或 Calendar 在任一时刻必须统一使用同一个 display timezone。

UI 提供 timezone selector / toggle：

- 只在当前 Trip 的 timezone list 中选择；
- 不需要每次从全球所有 timezone 中查找。

用户切换后：

- 所有 Block；
- Status Boundary；
- Major Transport；
- Overnight；
- Derived Trip Start / End；
- Travel Edge 的显示位置

都统一转换到该 display timezone。

原始数据中的 timezone 不被修改。

---

## 32. Config 层级原则

应用存在 Global Config 与 Trip-specific settings，但不是所有设置都必须具有 global → trip inheritance。

每个设置应根据自身语义决定：

- 是否属于 Global；
- 是否属于 Trip；
- 是否在创建 Trip 时从 Global 复制初始值；
- 是否允许更细粒度 override。

不得为了形式统一而强制所有 Config 使用相同层级。

### 32.1 适合 Global 默认值的设置

例如：

- Home Location；
- 默认 Major Transport pre-buffer；
- 默认 Major Transport post-buffer；
- DRIVE overhead；
- RIDESHARE overhead；
- WALK overhead；
- walking threshold；
- 默认 Routing Provider；
- 默认导航应用偏好。

Trip 可以按需要覆盖其中部分设置。

### 32.2 仅属于 Trip 的设置 / 数据

例如：

- Trip timezone list；
- Primary Timezone；
- Overnight Break Point 集合；
- Trip Start / End Location；
- Trip Display Start / End Time。

Overnight Break Point 不存在 Global Config inheritance。

---

## 33. Metadata、Links 与 Attachments

点击 Candidate 或 Timeline Block 后，应能在统一 Detail Panel 中编辑对应信息。

至少覆盖：

- Location；
- Placement constraints；
- Reservation；
- Scheduled data；
- Notes；
- Links；
- Attachments；
- subtype-specific metadata。

Attachments 可为任意本地文件，例如：

- PDF；
- 图片；
- Screenshot；
- Ticket；
- Confirmation；
- Text file。

### 33.1 Attachment Copy-to-Workspace

用户为 Candidate / Block 添加 Attachment 后，应用应将 Attachment 复制一份到当前 Workspace 内部，而不是只保存对原始外部文件路径的引用。

目的：

- 原始文件移动或删除后，Trip 仍然完整；
- Workspace Export 可以完整带走 Attachment；
- 最终行程导出可以按需包含 Attachment；
- Electron 本地工作区可以自包含。

Canonical data 保存的是 Workspace 内 Attachment 的相对引用。

---

## 34. Local-first Workspace

应用不考虑 Cloud Sync。

每个 Workspace / Trip 应能够完整保存在本地。

核心要求：

- Electron 版本能够直接打开工作区；
- 用户正常使用时无需手工管理内部状态文件；
- UI 修改后可以自动保存；
- 外部 AI agent 可以直接修改 canonical data；
- 应用能够监听外部改动并刷新；
- Attachment 已复制进 Workspace，Workspace 本身应能保持完整性。

---

## 35. Canonical Data 与 Derived Data

必须明确区分：

### 35.1 Canonical Data

包括用户真实输入和安排，例如：

- Candidate Definitions；
- Placements；
- Status Boundaries；
- Option；
- Trip Metadata；
- Overnight Break Point 集合；
- Config override；
- Attachment references；
- 用户手动 Travel Mode override。

### 35.2 Derived Data

包括：

- Travel Edge；
- route duration；
- active status；
- Derived Overnight Block；
- Derived Trip Start / End Block；
- consistency issues；
- provider lookup cache；
- display timezone 转换结果。

Derived Data 可以重新生成，不应成为用户必须维护的核心状态。

---

## 36. Schema 与可编辑文件

Canonical data 必须有明确 versioned schema。

至少包含：

- `schemaVersion`。

应用负责：

- load；
- validate；
- save；
- migrate。

Canonical 文件应适合程序和 AI agent 直接编辑。

核心结构应保持：

- 明确；
- 稳定；
- 可解析；
- 容易由外部工具修改。

---

## 37. 外部文件修改与 AI Agent Workflow

应用本身不需要集成任何 AI API 或 Agent API。

但外部 AI agent 直接修改本地工作区是正式支持的使用场景。

应提供一份 AI Editing Guide，至少说明：

- Workspace / Trip schema；
- Candidate 与 Placement 的区别；
- 四类用户 Block 与各类 Derived Block 的语义；
- Activity constraint 模型；
- Status Boundary 配对规则；
- Major Transport buffer 语义；
- Overnight Break Point 语义；
- Trip Metadata 与 Derived Trip Start / End 的区别；
- Option 结构；
- Canonical / derived 数据边界；
- 外部修改时需要遵守的字段语义。

用户可把：

- AI Editing Guide；
- Workspace 文件；

提供给外部 coding / planning agent。

---

## 38. File Watcher

Electron 本地版本必须监听 canonical workspace 文件变化。

外部修改后：

1. 检测文件变化；
2. Reload；
3. Schema validation；
4. Rebuild derived state；
5. Refresh UI。

如果外部修改导致 schema invalid：

- 不覆盖用户外部修改；
- 不偷偷修复；
- 不用旧 UI state 反向写回；
- 保留最后一个可展示的有效状态；
- 明确显示 parsing / schema issue。

---

## 39. Autosave、Undo 与 Redo

正常 UI 操作应支持 autosave。

至少支持 Undo / Redo：

- 新建；
- 删除；
- 单 Block 移动；
- 批量移动；
- Resize；
- constraint 修改；
- Location 修改；
- Travel Mode override；
- Option 修改；
- Status Boundary 修改；
- Overnight Break Point 增删与修改；
- Trip Metadata 修改。

---

## 40. Electron 与 Browser Target

最终正式使用形态优先为 Electron 桌面应用。

同时必须支持 Browser Target。

### 40.1 Browser Target 目的

主要用于开发和功能验证：

- 核心复杂逻辑可以在 WSL 环境中开发；
- Browser build 可在 WSL 启动；
- 通过 localhost 转发在 Windows 浏览器中打开；
- 用户可以快速导入 Workspace；
- 在浏览器中测试主要 UI 与业务逻辑；
- 修改后继续回到 WSL 迭代。

Browser Target 应尽可能覆盖除本地文件实时监听外的全部核心功能。

### 40.2 Browser Workspace 导入 / 导出

Browser Target 提供：

- Import Workspace；
- Export Workspace。

Workspace Export 的目的仅是：

> 完整保存应用状态并在未来重新导入应用。

它不要求强人类可读。

可以打包为：

- zip；
- tar；
- 或其它单文件 Workspace bundle。

其中应包含：

- canonical data；
- attachments；
- 恢复应用状态所需的其它数据。

### 40.3 Electron 正式使用体验

Electron 版本应支持：

- 直接打开本地 Workspace；
- 自动保存；
- 自动监听外部文件改动；
- 下次快速重新打开已有 Workspace。

用户不应需要反复手动 import/export 才能正常使用。

---

## 41. 最终行程导出

Workspace Import / Export 与“最终行程导出”是两个不同概念。

最终行程导出用于旅行执行阶段，不用于重新恢复 App 编辑状态。

必须支持至少两种输出。

---

## 42. 人类可读行程导出

用于用户在旅行途中无法访问本地 planning 应用时查看。

目标：

- 方便阅读；
- 信息按日期和时间组织；
- 包含活动、交通、酒店和关键 reservation；
- 包含必要地址与导航链接；
- 包含必要备注；
- 清楚显示时区；
- Option 若尚未 finalize，应明确展示仍存在的选项；
- consistency issue 若导出时仍存在，应明确标记。

格式可以是适合人类查看的文档型输出。

具体最终格式可以在实现阶段决定，但导出物应可独立于本应用使用。

如导出内容引用 Attachment，应将对应 Attachment 一并复制到导出结果中，保证导出内容自包含。

---

## 43. AI Context 行程导出

第二种最终导出用于上传到普通 chat-based 生活辅助 AI 作为背景上下文。

假设目标 AI：

- 可以读普通文本文件；
- 可以读 JSON；
- 不应假设拥有解压 zip 的工具；
- 不应假设拥有复杂 agent/tool 能力。

因此导出必须为明文文件。

推荐结构可为：

1. 一个简短说明文件；
2. 一个结构化 JSON 文件；
3. 如有需要，一个普通目录中的相关 Attachment 文件。

目标是让 AI 能快速定位：

- Trip 基本信息；
- Trip Start / End Location；
- 时区；
- 每日完整计划；
- 活动；
- 交通；
- 酒店；
- 租车；
- Reservation；
- Address；
- Notes；
- Option；
- 时间关系；
- Attachment 与对应项目的关联。

该导出不需要用于重新载入本应用。

不得要求目标 AI 先解压 zip 才能读取核心 itinerary/context 信息。

---

## 44. Candidate Library 与 Timeline 操作

Candidate Library 中：

- Activity；
- Major Transport；
- Status Boundary

均遵循统一操作流程：

1. 创建 Candidate；
2. 完善 Definition；
3. 拖入 Timeline；
4. 自动生成初始 Placement；
5. 用户继续拖动 / Resize；
6. 系统进行 consistency checking。

Major Transport 第一次拖入时使用 scheduled interval 作为初始 Placement。

Status Boundary 第一次拖入时使用其 Definition 中的默认 / reservation interval 作为初始 Placement。

Status Boundary 的初始 Placement 必须具有正 Duration。

Activity 根据用户拖入 Timeline 的具体位置生成 Placement。

---

## 45. Travel Edge 与 Candidate 的关系

Travel Edge 永远不是 Candidate。

它只存在于 Timeline derived layer。

当以下内容变化时，相关 Travel Edge 自动重建或重新计算：

- 相邻 Block；
- Block Placement；
- Location；
- Status；
- Travel Mode；
- Config；
- Option context；
- Trip Start / End Location。

Travel Edge 的自动变化不属于自动排程，因为它不修改任何用户 Placement。

---

## 46. Consistency Issue UI

Issue 必须在相关位置直接可见，而不是只存在于独立报告页。

例如：

- Block 本身存在 constraint issue → Block 上显示；
- Travel Edge 时间不足 → Edge 上显示；
- Status Boundary 未配对 → Boundary 和状态条显示；
- Status Boundary 与其它 Block 发生不合法 overlap → 对应重叠区域显示；
- Overnight lodging 缺失 → Break Point / Overnight 位置显示；
- Option worst-case 冲突 → Option 外层显示。

应用可以额外提供全局 Issue Summary，但不能替代就地提示。

---

## 47. UI 主体布局

桌面形态至少包含：

- Candidate Library 区域；
- 主 Timeline / Calendar 区域；
- Detail Panel；
- Config / View 控件；
- Issue Summary。

核心操作应尽量通过：

- 拖拽；
- Resize；
- 多选；
- Detail Panel 编辑；

完成。

---

## 48. Navigation Link 行为

Location 应同时支持：

- Google Maps；
- Apple Maps。

允许设置默认偏好。

UI 中应能一键打开对应位置或导航入口。

该 link 属于 Location metadata，不应依赖 Routing Provider。

---

## 49. 非目标

本需求明确不包括：

- Cloud Sync；
- 自动行程生成；
- 自动优化路线；
- 自动重新排程；
- 自动解决 conflict；
- 自动预订；
- 自动选择 Option；
- 强制维持 Timeline 始终 valid；
- 通过非官方方式获取第三方 API 凭据。

---

## 50. 核心行为总结

### Candidate

Activity、Major Transport、Status Boundary 都先在 Candidate Library 中定义，再拖入 Timeline。

### Placement

所有用户可编辑 Block 的 Placement 都由用户决定。

### Validation

任何编辑都允许完成，之后再进行一致性检查。

### Travel

Travel Edge 自动产生，但永远不是 Block。

### Buffer

- Major Transport pre/post buffer 属于 Major Transport；
- 普通切换 buffer / overhead 属于 Travel Edge；
- 普通 Activity 不拥有泛化 buffer。

### Status

Status Boundary Block 必须有正 Duration，并成对形成 derived status interval。

### Overnight

Overnight Break Point 是 Trip 自身可增删改的数据；Derived Overnight Block 完全只读、自动推导。

### Trip Endpoints

Trip Start / End Location 属于 Trip Metadata；Derived Trip Start / End Block 只读地表达实际离开与回到起终点的推导时间。

### Timezone

Trip 配置有限 timezone list，所有 UI 在某一时刻统一使用其中一个 display timezone。

### Local-first

Electron 正式版本直接工作于本地 Workspace；Browser Target 通过 Workspace Import / Export 支持开发测试。

### AI Workflow

外部 agent 可直接修改 canonical data，Electron 版本监听文件变化并刷新。

### Attachments

Attachment 添加后复制到 Workspace 内，确保 Workspace 与导出结果可保持完整。

### Export

最终行程至少支持：

- 人类可读导出；
- 普通 chat-based AI 可读明文导出。

---

## 51. 验收层面的产品原则

实现符合本需求时，应满足以下整体体验：

1. 用户可以先把一次旅行中的活动、机票、酒店和租车全部建入 Candidate Library，而不必提前决定完整 Timeline。
2. 用户通过拖拽把这些内容逐步安排到按真实时间比例显示的 Timeline。
3. 用户可以任意制造临时冲突，并通过多选、拖动和 Resize 自己调整。
4. 系统持续指出哪里不合理，但从不替用户移动内容。
5. Status Boundary 始终表现为具有正 Duration 的普通可编辑 Block，并通过配对形成 Hotel、Rental Car 等状态。
6. Overnight Break Point 可在 Trip 创建时批量生成，之后可以增删改；删除即表示该夜晚不要求 lodging。
7. Major Transport 清晰区分 terminal buffer 与实际运输时间。
8. Trip 起终点位置由 Trip Metadata 定义，系统通过只读半 Block 推导必须离家 / 预计回家的时间。
9. 所有跨时区内容都能在统一 display timezone 下正确对齐。
10. Browser Target 可以完整导入一个 Workspace 进行主要功能测试。
11. Electron 版本可以直接长期使用本地 Workspace，并自动监听外部 AI agent 的文件修改。
12. Attachment 一旦加入项目即可复制进 Workspace，并随 Workspace 或相关最终导出完整保留。
13. Coding agent 完成 Google Maps Routing 集成后，会同时给出清晰、官方流程的人类 API Key 配置说明。
14. 行程完成后，可以导出一个脱离本应用也能使用的人类版，以及一个方便普通聊天 AI 读取的结构化背景版。
