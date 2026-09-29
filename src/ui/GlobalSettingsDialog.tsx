import type { Workspace } from '../domain/schema';
import { session } from '../storage/session';
import { LocationFields, Modal } from './fields';
import { PlanningConfigFields } from './PlanningConfigFields';

export function GlobalSettingsDialog({ w, onClose }: { w: Workspace; onClose: () => void }) {
  return (
    <Modal title="全局设置" onClose={onClose} wide>
      <div className="modal-body global-settings-form">
        <p className="hint">
          修改后自动保存。旅行未覆盖的设置继承这些默认值；交通缓冲仅在新建主要交通时复制。
        </p>
        <LocationFields
          label="Home"
          value={w.globalConfig.home}
          preference={w.globalConfig.navigation}
          onChange={(home) =>
            session.edit((d) => {
              d.globalConfig.home = home;
            })
          }
        />
        <PlanningConfigFields
          config={w.globalConfig}
          onChange={(patch) =>
            session.edit((d) => {
              Object.assign(d.globalConfig, patch);
            })
          }
        />
        <section className="config-guide">
          <strong>连接 Google Routes</strong>
          <ol>
            <li>在 Google Cloud 项目中启用结算与 Routes API。</li>
            <li>创建 API Key，将 API 限制为 Routes API；服务器 Key 可限制公网出口 IP。</li>
            <li>将 Key 写入项目根目录 .env 的 GOOGLE_MAPS_API_KEY，重启服务。</li>
            <li>点击工具栏“重新查询路线”，查看路线耗时。</li>
          </ol>
          <p>完整官方流程见仓库 docs/GOOGLE_MAPS_SETUP.md。Key 不会进入浏览器或工作区导出。</p>
        </section>
      </div>
      <footer>
        <button className="button primary" onClick={onClose}>
          完成
        </button>
      </footer>
    </Modal>
  );
}
