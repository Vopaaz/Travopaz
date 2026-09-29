import { useState } from 'react';
import {
  emptyLocation,
  emptyMetadata,
  effectiveConfig,
  uid,
  type Candidate,
  type Workspace,
} from '../domain/schema';
import { fromLocal, formatTime, ms, shiftTime } from '../domain/time';
import { session } from '../storage/session';
import { LocationFields, Modal, TextField, TimeField, Field } from './fields';
import type { Focus } from './types';

export function CreateDialog({
  workspace: w,
  onClose,
  onFocus,
}: {
  workspace: Workspace;
  onClose: () => void;
  onFocus: (f: Focus) => void;
}) {
  const [kind, setKind] = useState<'activity' | 'transport' | 'hotel' | 'rentalCar'>('activity');
  const [title, setTitle] = useState(''),
    [location, setLocation] = useState(emptyLocation()),
    [destination, setDestination] = useState(emptyLocation());
  const initial = fromLocal(
    `${formatTime(w.trip.displayStart, w.trip.primaryTimezone, 'yyyy-MM-dd')}T09:00`,
    w.trip.primaryTimezone,
  );
  const [start, setStart] = useState(initial),
    [end, setEnd] = useState(shiftTime(initial, 120));
  const [subtype, setSubtype] = useState<'flight' | 'train' | 'ferry' | 'bus' | 'other'>('flight');
  const config = effectiveConfig(w);
  const create = () => {
    let focusId = '';
    session.edit((d) => {
      const id = uid();
      focusId = id;
      if (kind === 'activity')
        d.candidates.push({
          id,
          kind,
          title: title || '新活动',
          location,
          constraints: { intervals: [], minMinutes: null, maxMinutes: null },
          metadata: emptyMetadata(),
        });
      else if (kind === 'transport')
        d.candidates.push({
          id,
          kind,
          title: title || '主要交通',
          subtype,
          origin: location,
          destination,
          departure: start,
          arrival: end,
          preBuffer: config.preBuffer,
          postBuffer: config.postBuffer,
          operator: '',
          serviceNumber: '',
          metadata: emptyMetadata(),
        });
      else {
        const statusId = uid(),
          statusTitle = title || (kind === 'hotel' ? '新酒店' : '租车');
        d.statuses.push({
          id: statusId,
          kind,
          title: statusTitle,
          location,
          metadata: emptyMetadata(),
        });
        const boundary = (role: 'start' | 'end'): Candidate => ({
          id: role === 'start' ? id : uid(),
          kind: 'boundary',
          title: `${statusTitle} · ${kind === 'hotel' ? (role === 'start' ? '入住' : '退房') : role === 'start' ? '取车' : '还车'}`,
          statusId,
          role,
          location: role === 'end' && kind === 'rentalCar' ? destination : location,
          defaultStart: role === 'start' ? start : end,
          defaultEnd: shiftTime(role === 'start' ? start : end, 30),
          metadata: emptyMetadata(),
        });
        d.candidates.push(boundary('start'), boundary('end'));
      }
    });
    onFocus({ kind: 'candidate', id: focusId });
    onClose();
  };
  return (
    <Modal title="添加到候选库" onClose={onClose}>
      <div className="modal-body">
        <div className="kind-tabs">
          {(
            [
              ['activity', '活动'],
              ['transport', '主要交通'],
              ['hotel', '酒店'],
              ['rentalCar', '租车'],
            ] as const
          ).map(([key, text]) => (
            <button key={key} className={kind === key ? 'active' : ''} onClick={() => setKind(key)}>
              {text}
            </button>
          ))}
        </div>
        <p className="hint">先定义是什么，再拖入时间轴安排何时使用。</p>
        <TextField
          label="名称"
          value={title}
          onChange={setTitle}
          placeholder={kind === 'activity' ? '例如：在清水寺看日落' : '为这项安排取个名字'}
        />
        {kind === 'transport' && (
          <Field label="交通类型">
            <select value={subtype} onChange={(e) => setSubtype(e.target.value as typeof subtype)}>
              <option value="flight">航班</option>
              <option value="train">火车</option>
              <option value="ferry">渡轮</option>
              <option value="bus">城际巴士</option>
              <option value="other">其他</option>
            </select>
          </Field>
        )}
        <LocationFields
          value={location}
          onChange={setLocation}
          label={kind === 'transport' ? '出发' : kind === 'rentalCar' ? '取车' : '地点'}
        />
        {(kind === 'transport' || kind === 'rentalCar') && (
          <LocationFields
            value={destination}
            onChange={setDestination}
            label={kind === 'transport' ? '到达' : '还车'}
          />
        )}
        {kind !== 'activity' && (
          <>
            <TimeField
              label={
                kind === 'transport'
                  ? 'Scheduled Departure'
                  : kind === 'hotel'
                    ? '预订入住办理开始'
                    : '取车办理开始'
              }
              value={start}
              zones={w.trip.timezones}
              onChange={setStart}
            />
            <TimeField
              label={
                kind === 'transport'
                  ? 'Scheduled Arrival'
                  : kind === 'hotel'
                    ? '预订退房办理开始'
                    : '还车办理开始'
              }
              value={end}
              zones={w.trip.timezones}
              onChange={setEnd}
            />
            {ms(end) <= ms(start) && (
              <div className="inline-issue">时间先后关系存在冲突；仍可创建并稍后调整。</div>
            )}
            {kind !== 'transport' && (
              <p className="hint">
                将生成两个独立 Boundary Candidate。每次办理初始 30 分钟，可在详情修改。
              </p>
            )}
          </>
        )}
      </div>
      <footer>
        <button className="button" onClick={onClose}>
          取消
        </button>
        <button className="button primary" onClick={create}>
          加入候选库
        </button>
      </footer>
    </Modal>
  );
}
