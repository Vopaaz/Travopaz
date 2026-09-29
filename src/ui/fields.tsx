import { useEffect, useState, type ReactNode } from 'react';
import { DateTime } from 'luxon';
import { ExternalLink, X } from 'lucide-react';
import type { Location, ZonedTime } from '../domain/schema';
import { fromLocal, localValue, at } from '../domain/time';
import { navigationUrl } from '../domain/routing';

export function Field({
  label,
  children,
  hint,
}: {
  label: string;
  children: ReactNode;
  hint?: string;
}) {
  return (
    <label className="field">
      <span>{label}</span>
      {children}
      {hint && <small>{hint}</small>}
    </label>
  );
}
export function TextField({
  label,
  value,
  onChange,
  multiline = false,
  placeholder,
  type = 'text',
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  multiline?: boolean;
  placeholder?: string;
  type?: string;
}) {
  const [draft, setDraft] = useState(value);
  useEffect(() => setDraft(value), [value]);
  const props = {
    value: draft,
    placeholder,
    onChange: (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
      setDraft(e.target.value),
    onBlur: () => {
      if (draft !== value) onChange(draft);
    },
  };
  return (
    <Field label={label}>
      {multiline ? (
        <textarea {...props} rows={3} />
      ) : (
        <input
          {...props}
          type={type}
          onKeyDown={(e) => {
            if (e.key === 'Enter') e.currentTarget.blur();
          }}
        />
      )}
    </Field>
  );
}
export function NumberField({
  label,
  value,
  onChange,
  nullable = false,
  placeholder,
}: {
  label: string;
  value: number | null;
  onChange: (v: number | null) => void;
  nullable?: boolean;
  placeholder?: string;
}) {
  return (
    <TextField
      label={label}
      value={value === null ? '' : String(value)}
      type="number"
      placeholder={placeholder ?? (nullable ? '无限制' : '0')}
      onChange={(v) => {
        const n = v === '' && nullable ? null : Number(v);
        if (n === null || (Number.isFinite(n) && n >= 0)) onChange(n);
      }}
    />
  );
}
export function TimeField({
  label,
  value,
  zones,
  onChange,
  onValidityChange,
}: {
  label: string;
  value: ZonedTime;
  zones: string[];
  onChange: (v: ZonedTime) => void;
  onValidityChange?: (valid: boolean) => void;
}) {
  const [draft, setDraft] = useState(localValue(value)),
    [error, setError] = useState('');
  useEffect(() => {
    setDraft(localValue(value));
    setError('');
  }, [value.instant, value.timezone]);
  useEffect(() => {
    if (!onValidityChange) return;
    try {
      fromLocal(draft, value.timezone, value.instant);
      onValidityChange(true);
    } catch {
      onValidityChange(false);
    }
  }, [draft, value.timezone, value.instant, onValidityChange]);
  const possibilities = DateTime.fromISO(value.instant)
    .setZone(value.timezone)
    .getPossibleOffsets();
  return (
    <div className="time-field">
      <Field label={label}>
        <input
          aria-label={label}
          type="datetime-local"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={() => {
            try {
              if (!draft && onValidityChange) throw new Error('请填写日期与时间。');
              if (draft && draft !== localValue(value))
                onChange(fromLocal(draft, value.timezone, value.instant));
              setError('');
            } catch (e) {
              setError(String(e));
            }
          }}
        />
      </Field>
      <select
        aria-label={`${label}时区`}
        value={value.timezone}
        title="切换输入时区，保持同一时刻"
        onChange={(e) => onChange({ ...value, timezone: e.target.value })}
      >
        {[...new Set([...zones, value.timezone])].map((z) => (
          <option key={z}>{z}</option>
        ))}
      </select>
      {possibilities.length > 1 && (
        <select
          aria-label={`${label}夏令时偏移`}
          value={DateTime.fromISO(value.instant).toMillis()}
          onChange={(e) => onChange(at(Number(e.target.value), value.timezone))}
        >
          {possibilities.map((p) => (
            <option key={p.toMillis()} value={p.toMillis()}>
              UTC{p.toFormat('ZZ')}（重复小时）
            </option>
          ))}
        </select>
      )}
      {error && <small className="error-text">{error}</small>}
    </div>
  );
}
export function LocationFields({
  value,
  onChange,
  preference = 'google',
  label = '地点',
}: {
  value: Location;
  onChange: (v: Location) => void;
  preference?: 'google' | 'apple';
  label?: string;
}) {
  return (
    <div className="location-fields">
      <TextField
        label={`${label}名称`}
        value={value.name}
        onChange={(name) => onChange({ ...value, name })}
        placeholder="地点、酒店或车站名称"
      />
      <TextField
        label={`${label}地址`}
        value={value.address}
        onChange={(address) => onChange({ ...value, address })}
        placeholder="完整地址可提高路线查询准确度"
      />
      <div className="map-links">
        <a href={navigationUrl(value, preference)} target="_blank" rel="noreferrer">
          <ExternalLink size={12} /> 导航
        </a>
        <a href={navigationUrl(value, 'google')} target="_blank" rel="noreferrer">
          Google Maps ↗
        </a>
        <a href={navigationUrl(value, 'apple')} target="_blank" rel="noreferrer">
          Apple Maps ↗
        </a>
      </div>
      <details>
        <summary>自定义地图链接</summary>
        <TextField
          label="Google Maps Link"
          value={value.googleMapsUrl}
          onChange={(googleMapsUrl) => onChange({ ...value, googleMapsUrl })}
        />
        <TextField
          label="Apple Maps Link"
          value={value.appleMapsUrl}
          onChange={(appleMapsUrl) => onChange({ ...value, appleMapsUrl })}
        />
      </details>
    </div>
  );
}
export function Modal({
  title,
  children,
  onClose,
  wide = false,
}: {
  title: string;
  children: ReactNode;
  onClose: () => void;
  wide?: boolean;
}) {
  return (
    <div
      className="modal-scrim"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <section
        className={`modal ${wide ? 'wide' : ''}`}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        onKeyDown={(e) => {
          if (e.key === 'Escape') {
            e.stopPropagation();
            (document.activeElement as HTMLElement | null)?.blur();
            onClose();
          }
        }}
      >
        <header>
          <h2>{title}</h2>
          <button className="icon-button" aria-label="关闭弹窗" onClick={onClose}>
            <X size={19} />
          </button>
        </header>
        {children}
      </section>
    </div>
  );
}
