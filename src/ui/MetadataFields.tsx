import { Paperclip, Plus, Trash2, Download } from 'lucide-react';
import { useState } from 'react';
import { uid, type Metadata, type Workspace } from '../domain/schema';
import { session } from '../storage/session';
import { download } from '../storage/browser';
import { TextField } from './fields';

export function MetadataFields({
  value,
  workspace,
  onChange,
}: {
  value: Metadata;
  workspace: Workspace;
  onChange: (v: Metadata, attachment?: Workspace['attachments'][number]) => void;
}) {
  const [error, setError] = useState(''),
    [busy, setBusy] = useState(false);
  return (
    <>
      <TextField
        label="预订信息"
        value={value.reservation}
        multiline
        onChange={(reservation) => onChange({ ...value, reservation })}
        placeholder="确认编号、姓名、费用、取消政策…"
      />
      <TextField
        label="备注"
        value={value.notes}
        multiline
        onChange={(notes) => onChange({ ...value, notes })}
        placeholder="记下旅途中需要的信息"
      />
      <TextField
        label="标签（逗号分隔）"
        value={value.tags.join(', ')}
        onChange={(tags) =>
          onChange({
            ...value,
            tags: tags
              .split(/[,，]/)
              .map((s) => s.trim())
              .filter(Boolean),
          })
        }
      />
      <section className="detail-section">
        <div className="section-label">
          相关链接
          <button
            className="icon-button"
            title="添加链接"
            onClick={() =>
              onChange({ ...value, links: [...value.links, { label: '新链接', url: '' }] })
            }
          >
            <Plus size={15} />
          </button>
        </div>
        {value.links.map((link, i) => (
          <div key={i} className="link-editor">
            <TextField
              label="链接名称"
              value={link.label}
              onChange={(label) =>
                onChange({
                  ...value,
                  links: value.links.map((l, j) => (j === i ? { ...l, label } : l)),
                })
              }
            />
            <TextField
              label="URL"
              value={link.url}
              onChange={(url) =>
                onChange({
                  ...value,
                  links: value.links.map((l, j) => (j === i ? { ...l, url } : l)),
                })
              }
            />
            {/^https?:\/\//i.test(link.url) && (
              <a href={link.url} target="_blank" rel="noreferrer">
                打开 ↗
              </a>
            )}
            <button
              className="text-button danger"
              onClick={() => onChange({ ...value, links: value.links.filter((_, j) => j !== i) })}
            >
              删除链接
            </button>
          </div>
        ))}
      </section>
      <section className="detail-section">
        <div className="section-label">
          附件 <Paperclip size={15} />
        </div>
        <p className="hint">文件会复制到工作区，导出时一并保留。</p>
        {value.attachmentIds.map((id) => {
          const a = workspace.attachments.find((a) => a.id === id);
          return (
            <div className="attachment-row" key={id}>
              <span>{a?.name ?? '附件缺失'}</span>
              <button
                title="下载附件"
                className="icon-button"
                onClick={async () => {
                  if (a)
                    try {
                      download(a.name, await session.readAttachment(a.path));
                    } catch (e) {
                      setError(String(e));
                    }
                }}
              >
                <Download size={14} />
              </button>
              <button
                title="移除附件引用"
                className="icon-button"
                onClick={() =>
                  onChange({ ...value, attachmentIds: value.attachmentIds.filter((x) => x !== id) })
                }
              >
                <Trash2 size={14} />
              </button>
            </div>
          );
        })}
        <label className={`upload-button ${busy ? 'disabled' : ''}`}>
          <Plus size={14} />
          {busy ? '正在复制…' : '添加本地文件'}
          <input
            type="file"
            hidden
            disabled={busy}
            onChange={async (e) => {
              const file = e.target.files?.[0];
              if (!file) return;
              setBusy(true);
              try {
                const attachment = await session.addAttachment(file);
                onChange(
                  { ...value, attachmentIds: [...value.attachmentIds, attachment.id] },
                  attachment,
                );
                setError('');
              } catch (e) {
                setError(String(e));
              } finally {
                setBusy(false);
              }
            }}
          />
        </label>
        {error && <div className="error-text">{error}</div>}
      </section>
    </>
  );
}
