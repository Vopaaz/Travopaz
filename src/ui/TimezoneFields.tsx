import { useId, useState } from 'react';
import { IANAZone } from 'luxon';
import { X } from 'lucide-react';
import { Field } from './fields';

const availableZones = ['UTC', ...Intl.supportedValuesOf('timeZone')];

export function TimezoneFields({
  timezones,
  primaryTimezone,
  onChange,
}: {
  timezones: string[];
  primaryTimezone: string;
  onChange: (value: { timezones: string[]; primaryTimezone: string }) => void;
}) {
  const listId = useId();
  const [extraZone, setExtraZone] = useState('');
  const [error, setError] = useState('');
  const choices = [...new Set([...availableZones, ...timezones])].sort();
  const add = () => {
    const zone = extraZone.trim();
    if (!IANAZone.isValidZone(zone)) {
      setError('请输入有效的 IANA 时区，例如 Asia/Shanghai 或 Europe/Paris。');
      return;
    }
    onChange({ timezones: [...new Set([...timezones, zone])], primaryTimezone });
    setExtraZone('');
    setError('');
  };
  return (
    <div className="timezone-fields">
      <Field
        label="主时区"
        hint="用于新建项目的默认时间输入，以及生成住宿检查点。可从全部时区中选择。"
      >
        <select
          aria-label="主时区"
          value={primaryTimezone}
          onChange={(e) =>
            onChange({
              timezones: [...new Set([...timezones, e.target.value])],
              primaryTimezone: e.target.value,
            })
          }
        >
          {choices.map((zone) => (
            <option key={zone}>{zone}</option>
          ))}
        </select>
      </Field>
      <div className="timezone-list" aria-label="旅行时区列表">
        {timezones.map((zone) => (
          <span className="timezone-chip" key={zone}>
            {zone}
            {zone === primaryTimezone && ' · 主时区'}
            <button
              type="button"
              className="icon-button"
              aria-label={`移除时区 ${zone}`}
              title={zone === primaryTimezone ? '请先选择其他主时区' : '移除时区'}
              disabled={zone === primaryTimezone}
              onClick={() =>
                onChange({ timezones: timezones.filter((z) => z !== zone), primaryTimezone })
              }
            >
              <X size={12} />
            </button>
          </span>
        ))}
      </div>
      <div className="timezone-add">
        <Field label="其他旅行时区">
          <input
            list={listId}
            value={extraZone}
            placeholder="搜索或输入，例如 America/Los_Angeles"
            onChange={(e) => {
              setExtraZone(e.target.value);
              setError('');
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                add();
              }
            }}
          />
          <datalist id={listId}>
            {choices.map((zone) => (
              <option key={zone} value={zone} />
            ))}
          </datalist>
        </Field>
        <button type="button" className="button compact" disabled={!extraZone.trim()} onClick={add}>
          添加时区
        </button>
      </div>
      {error && (
        <p className="error-text" role="alert">
          {error}
        </p>
      )}
      <p className="hint">时间轴显示与各时间字段均可切换到旅行时区列表中的时区。</p>
    </div>
  );
}
