import type { Config } from '../domain/schema';
import { Field, NumberField } from './fields';

export function PlanningConfigFields({
  config,
  onChange,
}: {
  config: Config;
  onChange: (patch: Partial<Omit<Config, 'home'>>) => void;
}) {
  return (
    <div className="planning-config-fields">
      <NumberField
        label="默认交通出发前缓冲 / 分钟"
        value={config.preBuffer}
        onChange={(n) => onChange({ preBuffer: n ?? 0 })}
      />
      <NumberField
        label="默认交通到达后缓冲 / 分钟"
        value={config.postBuffer}
        onChange={(n) => onChange({ postBuffer: n ?? 0 })}
      />
      <NumberField
        label="步行阈值 / 分钟"
        value={config.walkingThreshold}
        onChange={(n) => onChange({ walkingThreshold: n ?? 0 })}
      />
      {(['WALK', 'DRIVE', 'RIDESHARE'] as const).map((mode) => (
        <NumberField
          key={mode}
          label={`${mode} 额外耗时 / 分钟`}
          value={config.overhead[mode]}
          onChange={(n) => onChange({ overhead: { ...config.overhead, [mode]: n ?? 0 } })}
        />
      ))}
      <Field label="路线查询">
        <select
          value={config.routingProvider}
          onChange={(e) =>
            onChange({ routingProvider: e.target.value as Config['routingProvider'] })
          }
        >
          <option value="google">Google Routes（非实时）</option>
          <option value="unavailable">关闭查询（保持未知）</option>
        </select>
      </Field>
      <Field label="默认导航应用">
        <select
          value={config.navigation}
          onChange={(e) => onChange({ navigation: e.target.value as Config['navigation'] })}
        >
          <option value="google">Google Maps</option>
          <option value="apple">Apple Maps</option>
        </select>
      </Field>
    </div>
  );
}
