# 需求补充约定

本文件记录实现讨论中用户对 `travel_planner_requirements_zh_v1_1.md` 的明确补充；发生冲突时，以这些补充为准。

## 已确认

- 酒店／租车状态区间从开始 Boundary 的 **end** 到结束 Boundary 的 **start**；手续本身不计入持有状态。
- Option 内使用绝对 Placement；整体拖动时所有 Variant 同步平移。
- Option 没有独立 Placement 和可调整外框。外框覆盖全部内部项目，长度由这些项目推导；仅内部具体项目可 Resize。
- Option 没有“选定 Variant”字段。所有保留方案都参与计算。放弃一个方案是显式删除；定案是删掉其他方案。只剩一个时可解除包装，保留内部项目 ID 与时间，归并到主 Timeline。
- 状态可以跨 Option，但每个 Variant 对外的状态开启／关闭改动必须一致；时间可以不同。某方案内部同时开启并结束一个状态、对外无净影响时，其他方案可以完全不涉及它。
- 实际项目跨过 Overnight Break Point 必须报告冲突，提示修改或删除 Break Point，不自动豁免，不拆分项目。

## 对外状态身份与歧义处理（已确认）

- 对外净改动必须指向同一个 status instance，即同一笔酒店／租车预订；只满足类型一致并不够。例如 A 入住酒店甲、B 入住酒店乙，属于不一致。
- 各方案对外改动不一致时，Option 显示 blocking issue，Option 之外有歧义的状态标记 unknown，不任意采用其中一个方案。
- 每个 Variant 内部仍分别进行检查。未受差异影响的其他状态仍可正常推导。
