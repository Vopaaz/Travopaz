# Google Routes API 官方配置

本应用只调用 Google Routes API 的 Compute Routes，通过地点名称／地址获取耗时与距离；不需要 Maps JavaScript API、Directions Legacy、地图瓦片或 Geocoding API。

## 1. 准备项目与 API

1. 登录 [Google Cloud Console](https://console.cloud.google.com/)，选择或创建一个项目。
2. 按 [Routes API 官方设置流程](https://developers.google.com/maps/documentation/routes/get-api-key) 为项目启用结算。
3. 打开“API 和服务 → 库”，搜索并启用 **Routes API**。

## 2. 创建 Key 与限制

在“API 和服务 → 凭据”中创建 API Key。API restriction 选择 **Restrict key → Routes API**。

请求由本地 Node 服务或 Electron 主进程发出，适用的是服务端 Key。若设置 application restriction，使用 **IP addresses**，填写 Google 实际看到的公网出口 IP；它不是 `127.0.0.1`、WSL 私网地址，也不是 HTTP referrer。动态出口 IP 改变时需要更新白名单。详细规则见 [Google Maps Platform 官方安全指南](https://developers.google.com/maps/api-security-best-practices)。

可在 Cloud Console 为 API 设置适合测试量的配额，并设置账单预算提醒。费用与配额以你自己的 Cloud Console 显示为准。

## 3. 放入本应用

复制项目中的 `.env.example` 为 `.env`，填入：

```dotenv
GOOGLE_MAPS_API_KEY=这里填写你自己的Key
PORT=5173
```

停止并重新执行 `npm run dev`。Electron 执行 `npm run electron` 时也会读取应用目录的 `.env`，或使用启动进程已有的 `GOOGLE_MAPS_API_KEY` 环境变量。

不要使用 `VITE_` 前缀；那会把变量暴露给浏览器。`.env` 已被 `.gitignore` 排除。导出的 Workspace 不包含 Key。不要把 Key 放在备注、附件或 `workspace.json` 中。

## 4. 确认成功

1. 打开 http://localhost:5173，导入京都示例或给相邻项目填写具体地址。
2. 在“偏好与路线”中确认 Provider 为 Google Routes。
3. 点击时间轴底部“重新查询路线”。配置生效后底部不再显示“路线未配置”。
4. 点击一条路线，详情中应出现数值路线耗时、overhead 与总耗时，source 为 `google`。
5. 服务健康接口 http://localhost:5173/api/health 只返回是否配置，不返回 Key。

相同地址之间无需调用 API，source 为 `same-location`。请用两个不同的真实地址验证 API 调用成功。

## 查询语义与故障

调用 [Compute Routes 官方端点](https://developers.google.com/maps/documentation/routes/compute_route_directions)，只请求 `routes.duration,routes.distanceMeters`。DRIVE 使用 `TRAFFIC_UNAWARE`，RIDESHARE 复用驾驶路线，WALK 不携带驾驶专用的 routingPreference。不请求实时拥堵或实时发车时刻。

缓存仅用于当前本机服务与浏览器会话：成功结果最多 1 小时，失败结果短暂保留 30 秒以免重复请求。点击“重新查询路线”会清空缓存。缓存是 derived data，不随 canonical Workspace 保存。

- HTTP 403：检查项目结算、Routes API 是否启用、Key 的 API/IP restriction。
- HTTP 429：检查配额与计费设置。
- 无路线：尝试更完整地址；部分地区或交通方式可能没有结果。
- 网络或超时：检查 WSL 到 Google 服务的连接，稍后重新查询。

任何失败都保留 `minutes: null`，产生可见 issue，不会设置为零，不会移动任何行程。
