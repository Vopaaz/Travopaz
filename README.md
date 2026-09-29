# Travopaz · 本地旅行规划工作台

中文、local-first 的旅行规划应用。收集活动、交通、酒店和租车，手动安排时间；应用只推导路线、状态和检查结果，绝不自动移动行程。

## 在 WSL 启动网页

需要 Node.js 22.12+（当前开发环境为 Node 24）。

```sh
npm install
npm run dev
```

在 Windows 浏览器打开 **http://localhost:5173**。服务监听 WSL 的 `127.0.0.1:5173`，前端与路线服务使用同一端口。首次打开有可编辑的京都演示行程；“工作区 → 新建旅行”可创建空白工作区。开发模式支持热更新。

右上角的 **全局设置** 打开独立浮窗，可调整 Home、默认交通缓冲、各交通方式额外耗时、步行阈值、路线查询和导航偏好。旅行标题旁的设置按钮管理本次旅行，包括交通／路线设置的旅行覆盖值。

新建旅行时，可在创建窗口确认主时区、旅行时区列表、显示范围、起终点和交通／路线设置。初始主时区来自当前设备，可从全部 IANA 时区中选择；起终点从 Home 复制，创建窗口中的修改只影响新旅行。切换主时区会转换显示范围的时间表示并保持同一时刻，请确认转换后的日期和时间。住宿检查点按最终确认的主时区与日期范围生成。

端口可在 `.env` 中设置 `PORT=5173`。生产构建与本地预览：

```sh
npm run build
npm start
```

## 开始使用

1. 候选库右上角 `+` 创建活动、主要交通，或一对酒店／租车 Boundary。此时不占用 Timeline。
2. 从候选库拖入时间轴。普通活动采用拖入时间；交通与 Boundary 从自己的 scheduled / reservation interval 初始化。
3. 拖动整个 Block 移动，拖动上下边缘 Resize；允许跨日。空白处框选，Shift／Ctrl／⌘ 增减选择，多选后整体拖动。默认吸附 5 分钟，Alt 精确到 1 分钟。Ctrl + 滚轮改变时间比例。
4. 右侧详情分别编辑 Placement 与 Definition。修改 Placement 不影响 scheduled time、预约区间或其他项目。
5. 酒店／租车的开始、结束 Boundary 都需要安排到 Timeline，才形成有效状态。状态从开始手续的 **end** 到结束手续的 **start**。
6. “添加”菜单创建 Option 或酒店休息；Option 内可加入已有 Candidate。内部事件决定外框，外框不能 Resize；拖动 Option 会移动所有 Variant。删除方案表示放弃，剩一个时可解除包装。
7. 旅行设置管理起终点、显示范围、时区和住宿检查点。住宿检查点与实际项目相交时报错；红眼航班等无需住宿时，手动删除相应点。
8. 点击路线可覆盖为无移动（NONE）／WALK／DRIVE／RIDESHARE，并单独设置该路段的额外耗时（buffer）。留空使用对应交通方式的旅行默认值，填写 0 则不加额外耗时。同址默认无移动，路线耗时为 0、buffer 默认 0，但也可自定义；异址手动选择无移动会报冲突。所有错误都只提示，不阻止编辑。

按钮布局、键盘快捷键与更多说明也在右上角 `?` 中。

## 路线查询

未配置 Key 时可以测试全部编辑功能，路线明确显示“未知”，不会假装为零或展示虚构估计。

配置步骤见 [Google Routes 配置指南](docs/GOOGLE_MAPS_SETUP.md)。将官方申请的 Key 放在仓库根目录 `.env`：

```dotenv
GOOGLE_MAPS_API_KEY=你的Key
PORT=5173
```

Key 只由本地 Node 服务／Electron 主进程读取，不打包进浏览器，不写入 Workspace。驾驶使用 `TRAFFIC_UNAWARE`；打车使用驾驶路线加独立 overhead。成功路线按起终地址和交通方式缓存 14 天，重启后可复用；修改时间不改变缓存键。失败结果仅在内存中保留 30 秒。缓存是可重新生成的数据，详见 [路线缓存说明及 Google 使用限制](docs/GOOGLE_MAPS_SETUP.md#查询语义与故障)。

## 保存、附件与导出

- **Browser**：自动保存到当前浏览器 IndexedDB。“最近的浏览器工作区”可切换旅行。清除浏览器网站数据会删除本机副本，请用 Workspace ZIP 备份。
- **Workspace 导出／导入**：ZIP 包含 `workspace.json`、`attachments/` 和 `route-cache.json`。缓存只随工作区备份，不加入人类或 AI Context 导出；导入不会延长 14 天有效期。旧 ZIP 和无附件的 canonical JSON 仍可导入。附件加入时立即复制，不依赖原文件位置。
- **人类行程**：ZIP 内有独立 HTML 和相对引用的附件。解压打开 `行程.html` 即可使用，也可通过浏览器打印为 PDF。
- **AI 背景**：分别下载明文 `itinerary-context.json` 与使用说明；需要的附件可单独下载。核心信息不要求解压。导出保留所有方案、未知路线和一致性问题。

## Electron

```sh
npm run electron
```

桌面界面使用固定的 `travopaz://app/` 地址。未保存为本地文件夹的工作区（包括全局设置和附件）保存在当前系统用户的 Electron 应用数据目录中，重启后自动恢复；不依赖仓库路径或 WSL。此前版本使用随机 localhost 端口，旧端口下的 IndexedDB 数据不会自动迁移到新地址；若旧界面仍能打开，可导出 Workspace 后导入新版。已保存的本地工作区文件夹可以直接重新打开。

在桌面版的“工作区”菜单选择“保存为本地工作区”或“打开本地文件夹”。一个文件夹保存一次 Trip：

```text
my-trip/
  workspace.json
  route-cache.json
  attachments/
    <attachment-id>
```

后续操作自动保存，下次启动重新打开上次的目录。文件监听支持外部编辑。非法 JSON / schema 会保留最后可展示状态、暂停写回并显示错误；修复文件后自动重新加载。保存前校验文件版本，检测到外部变化不会覆盖。

Electron 在 WSL 中需要可用的 WSLg／图形环境与兼容的桌面运行库；核心开发测试优先使用 Windows 浏览器访问 WSL localhost。应用本身不会修改系统库。

## 外部 AI 编辑

参阅 [AI Editing Guide](docs/AI_EDITING_GUIDE.md)、[version 1 JSON Schema](schemas/workspace-v1.schema.json) 与 [需求补充约定](docs/DECISIONS.md)。

示例文件 [京都工作区](examples/kyoto-workspace.json) 可直接从 UI 导入。不要把派生路线、状态区间或 Overnight 写进 canonical 文件。

## 验证与目录

```sh
npm test                  # 领域计算、路线适配、文件保护测试
npm run typecheck         # TypeScript
npm run build             # 浏览器和 Electron 构建
npx playwright install chromium
npm run test:e2e           # 先启动 npm run dev
```

Electron 集成冒烟测试（需要可用显示服务器）：

```sh
node --import tsx tests/electron/smoke.ts
```

测试的 mock 路线只存在于测试代码；运行中的应用始终使用官方 Google API 或明确的 unknown 状态。

主要代码：`src/domain/` 是纯计算与 schema，`src/ui/` 是 Timeline／详情组件，`src/storage/` 是浏览器保存与导出，`server/` 是本机路线服务，`electron/` 是桌面桥接与文件监听。没有云同步、AI API 或自动排程。
