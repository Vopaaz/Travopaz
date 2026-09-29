import { useState } from 'react';
import { createWorkspace } from '../domain/factory';
import { effectiveConfig, uid, type Config, type Workspace } from '../domain/schema';
import { at, daysBetween, ms } from '../domain/time';
import { LocationFields, Modal, TextField, TimeField } from './fields';
import { TimezoneFields } from './TimezoneFields';
import { PlanningConfigFields } from './PlanningConfigFields';

export function NewTripDialog({
  globalConfig,
  onClose,
  onCreate,
}: {
  globalConfig: Config;
  onClose: () => void;
  onCreate: (workspace: Workspace) => void;
}) {
  const [draft, setDraft] = useState(() => createWorkspace('我的新旅行', globalConfig));
  const [startValid, setStartValid] = useState(true);
  const [endValid, setEndValid] = useState(true);
  const trip = draft.trip;
  const update = (patch: Partial<Workspace['trip']>) =>
    setDraft((current) => ({ ...current, trip: { ...current.trip, ...patch } }));
  const rangeValid = ms(trip.displayEnd) > ms(trip.displayStart);
  const valid = startValid && endValid && rangeValid && !!trip.name.trim();
  const config = effectiveConfig(draft);
  return (
    <Modal title="新建旅行" onClose={onClose} wide>
      <div className="modal-body new-trip-form">
        <p className="hint">请确认本次旅行的时间、地点与规划设置。创建后仍可在旅行设置中修改。</p>
        <section>
          <h3>旅行与时区</h3>
          <TextField label="旅行名称" value={trip.name} onChange={(name) => update({ name })} />
          <TimezoneFields
            timezones={trip.timezones}
            primaryTimezone={trip.primaryTimezone}
            onChange={(zones) =>
              update({
                ...zones,
                ...(zones.primaryTimezone !== trip.primaryTimezone
                  ? {
                      displayStart: { ...trip.displayStart, timezone: zones.primaryTimezone },
                      displayEnd: { ...trip.displayEnd, timezone: zones.primaryTimezone },
                    }
                  : {}),
              })
            }
          />
          <p className="hint">
            初始主时区取自当前设备。切换主时区会转换下方时间的显示，保持同一时刻；请确认转换后的日期与时间。
          </p>
          <div className="new-trip-grid">
            <TimeField
              label="显示开始"
              value={trip.displayStart}
              zones={trip.timezones}
              onChange={(displayStart) => update({ displayStart })}
              onValidityChange={setStartValid}
            />
            <TimeField
              label="显示结束"
              value={trip.displayEnd}
              zones={trip.timezones}
              onChange={(displayEnd) => update({ displayEnd })}
              onValidityChange={setEndValid}
            />
          </div>
          {!rangeValid && (
            <p className="error-text" role="alert">
              显示结束必须晚于显示开始。
            </p>
          )}
          {!trip.name.trim() && (
            <p className="error-text" role="alert">
              请填写旅行名称。
            </p>
          )}
          <p className="hint">
            显示范围不决定实际出发／到家时间。创建时在每个后续日期的主时区 03:30
            生成住宿检查点，之后可逐个修改或删除。
          </p>
        </section>
        <section>
          <h3>旅行起终点</h3>
          <p className="hint">初始值从全局 Home 复制。修改本次起终点不会更改 Home。</p>
          <div className="new-trip-grid">
            <LocationFields
              label="旅行起点"
              value={trip.startLocation}
              preference={config.navigation}
              onChange={(startLocation) => update({ startLocation })}
            />
            <LocationFields
              label="旅行终点"
              value={trip.endLocation}
              preference={config.navigation}
              onChange={(endLocation) => update({ endLocation })}
            />
          </div>
        </section>
        <section>
          <h3>交通与路线设置</h3>
          <p className="hint">
            以下默认值继承全局设置。在这里修改只覆盖本次旅行；交通缓冲会在新建主要交通时复制。
          </p>
          <PlanningConfigFields
            config={config}
            onChange={(patch) =>
              setDraft((current) => ({
                ...current,
                trip: { ...current.trip, config: { ...current.trip.config, ...patch } },
              }))
            }
          />
          {!!Object.keys(trip.config).length && (
            <button className="text-button" onClick={() => update({ config: {} })}>
              恢复全局默认值
            </button>
          )}
        </section>
      </div>
      <footer>
        <button className="button" onClick={onClose}>
          取消
        </button>
        <button
          className="button primary"
          disabled={!valid}
          onClick={() => {
            const overnightBreaks = daysBetween(
              trip.displayStart,
              trip.displayEnd,
              trip.primaryTimezone,
            )
              .slice(1)
              .map((day) => ({
                id: uid(),
                time: at(day.set({ hour: 3, minute: 30 }).toMillis(), trip.primaryTimezone),
              }));
            onCreate({ ...draft, trip: { ...trip, overnightBreaks } });
          }}
        >
          创建工作区
        </button>
      </footer>
    </Modal>
  );
}
