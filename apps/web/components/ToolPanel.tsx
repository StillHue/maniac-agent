'use client';

import { useCallback, useEffect, useState } from 'react';
import { Play, Terminal, AlertTriangle } from 'lucide-react';

interface ToolParam {
  name: string;
  label: string;
  type: 'string' | 'multiline' | 'number' | 'json';
  required: boolean;
  description: string;
  default?: string;
}

interface ToolDef {
  name: string;
  description: string;
  danger?: boolean;
  params: ToolParam[];
}

export default function ToolPanel() {
  const [tools, setTools] = useState<ToolDef[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [values, setValues] = useState<Record<string, string>>({});
  const [result, setResult] = useState<{ success: boolean; output: string } | null>(null);
  const [loading, setLoading] = useState(false);
  const [search, setSearch] = useState('');

  useEffect(() => {
    fetch('/api/execute').then(r => r.json()).then(d => setTools(d.tools || [])).catch(() => {});
  }, []);

  const tool = tools.find(t => t.name === selected);

  const handleSelect = useCallback((name: string) => {
    const t = tools.find(x => x.name === name);
    setSelected(name);
    setValues({});
    setResult(null);
    if (t) {
      const init: Record<string, string> = {};
      for (const p of t.params) {
        if (p.default !== undefined) init[p.name] = p.default;
      }
      setValues(init);
    }
  }, [tools]);

  const handleExecute = useCallback(async () => {
    if (!tool) return;
    setLoading(true);
    setResult(null);
    try {
      // Compose command from the tool's expected format
      let command = '';
      // Build command based on tool type and its params
      const filePath = values.filePath || '';
      const old = values.old || '';
      const new_ = values.new || '';
      const content = values.content || '';
      const pattern = values.pattern || '';
      const searchPath = values.searchPath || '';
      const title = values.title || '';
      const provider = values.provider || '';
      const model = values.model || '';
      const cmd = values.command || '';
      const port = values.port || '';
      const reason = values.reason || '';
      const to = values.to || '';
      const text = values.text || '';
      const name = values.name || '';
      const description = values.description || '';
      const code = values.code || '';

      switch (tool.name) {
        case 'exec': command = cmd; break;
        case 'ls': command = values.dirPath || '.'; break;
        case 'read': command = filePath; break;
        case 'write': command = `${filePath}\n${content}`; break;
        case 'edit': command = `${filePath}\n---\n${old}\n---\n${new_}`; break;
        case 'grep': command = searchPath ? `${pattern} ${searchPath}` : pattern; break;
        case 'glob': command = searchPath ? `${pattern} ${searchPath}` : pattern; break;
        case 'brain': command = `${title}\n${content}`; break;
        case 'source_edit': command = `${filePath}\n---\n${old}\n---\n${new_}`; break;
        case 'tool_create': command = JSON.stringify({ name, description, code }); break;
        case 'model_switch': command = model ? `${provider} | ${model}` : provider; break;
        case 'system_prompt_edit': command = `${old}\n---\n${new_}`; break;
        case 'spawn_terminal': command = cmd || 'cmd.exe'; break;
        case 'server_start': command = port || '3130'; break;
        case 'self_restart': command = reason || ''; break;
        case 'send_telegram': command = JSON.stringify({ to, text }); break;
        default: command = ''; break;
      }

      const res = await fetch('/api/execute', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type: tool.name, command }),
      });
      const data = await res.json();
      setResult({ success: data.success ?? false, output: data.output || '(sem retorno)' });
    } catch (e: any) {
      setResult({ success: false, output: e.message });
    } finally {
      setLoading(false);
    }
  }, [tool, values]);

  const filtered = tools.filter(t =>
    t.name.toLowerCase().includes(search.toLowerCase()) ||
    t.description.toLowerCase().includes(search.toLowerCase())
  );

  return (
    <div style={s.panel}>
      <div style={s.header}>
        <Terminal size={16} style={{ verticalAlign: 'middle', marginRight: 6 }} />
        executor de ferramentas
      </div>

      <input
        type="text"
        value={search}
        onChange={e => setSearch(e.target.value)}
        placeholder="buscar ferramenta..."
        style={s.search}
      />

      <div style={s.list}>
        {filtered.map(t => (
          <div
            key={t.name}
            onClick={() => handleSelect(t.name)}
            style={s.item(selected === t.name)}
          >
            <span style={s.itemName}>{t.name}</span>
            {t.danger && <AlertTriangle size={12} color="#ff5555" style={{ verticalAlign: 'middle', marginLeft: 4 }} />}
            <span style={s.itemDesc}>{t.description}</span>
          </div>
        ))}
        {filtered.length === 0 && <div style={s.empty}>nenhuma ferramenta encontrada</div>}
      </div>

      {tool && (
        <div style={s.formWrapper}>
          <div style={s.formHeader}>
            <span style={{ fontWeight: 'bold', color: '#fff' }}>{tool.name}</span>
            <span style={{ fontSize: '0.7rem', color: '#888', marginLeft: 8 }}>{tool.description}</span>
          </div>

          {tool.params.map(p => (
            <div key={p.name} style={s.field}>
              <label style={s.label}>
                {p.label}
                {p.required && <span style={{ color: '#ff5555' }}> *</span>}
              </label>
              {p.type === 'multiline' ? (
                <textarea
                  value={values[p.name] || ''}
                  onChange={e => setValues(v => ({ ...v, [p.name]: e.target.value }))}
                  placeholder={p.description}
                  style={s.textarea}
                  rows={4}
                />
              ) : (
                <input
                  type={p.type === 'number' ? 'number' : 'text'}
                  value={values[p.name] || ''}
                  onChange={e => setValues(v => ({ ...v, [p.name]: e.target.value }))}
                  placeholder={p.description}
                  style={s.input}
                />
              )}
            </div>
          ))}

          <button onClick={handleExecute} disabled={loading} style={s.executeBtn}>
            <Play size={14} style={{ verticalAlign: 'middle', marginRight: 4 }} />
            {loading ? 'executando...' : 'executar'}
          </button>

          {result && (
            <div style={s.resultBox(result.success)}>
              <div style={s.resultHeader}>
                {result.success ? '✓ sucesso' : '✗ erro'}
              </div>
              <pre style={s.resultOutput}>{result.output}</pre>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

const D = '#aaaaaa';

const s: Record<string, any> = {
  panel: {
    height: '100%',
    display: 'flex',
    flexDirection: 'column',
    fontSize: '0.8rem',
    color: D,
  },
  header: {
    fontSize: '0.7rem',
    color: '#ff5555',
    fontWeight: 'bold',
    textTransform: 'uppercase',
    letterSpacing: '0.05em',
    padding: '0 0 8px 0',
    borderBottom: '1px solid rgba(255,255,255,0.06)',
    marginBottom: 8,
  },
  search: {
    width: '100%',
    background: 'rgba(255,255,255,0.04)',
    border: '1px solid rgba(255,255,255,0.08)',
    borderRadius: 4,
    padding: '6px 8px',
    color: '#fff',
    fontSize: '0.75rem',
    fontFamily: 'inherit',
    outline: 'none',
    marginBottom: 8,
    boxSizing: 'border-box' as const,
  },
  list: {
    flex: 1,
    overflowY: 'auto' as const,
    minHeight: 0,
  },
  item: (sel: boolean) => ({
    padding: '6px 8px',
    borderRadius: 4,
    cursor: 'pointer',
    background: sel ? 'rgba(255,255,255,0.08)' : 'transparent',
    marginBottom: 2,
    borderLeft: sel ? '2px solid #ff5555' : '2px solid transparent',
  }),
  itemName: {
    color: '#55ffff',
    fontSize: '0.78rem',
    fontWeight: 'bold' as const,
    display: 'block',
  },
  itemDesc: {
    color: D,
    fontSize: '0.68rem',
    display: 'block',
    marginTop: 1,
  },
  empty: {
    padding: '16px 0',
    textAlign: 'center' as const,
    color: D,
    fontSize: '0.7rem',
  },
  formWrapper: {
    borderTop: '1px solid rgba(255,255,255,0.08)',
    padding: '12px 0',
    overflowY: 'auto' as const,
    maxHeight: '60%',
  },
  formHeader: {
    marginBottom: 10,
    fontSize: '0.75rem',
  },
  field: {
    marginBottom: 8,
  },
  label: {
    display: 'block',
    fontSize: '0.68rem',
    color: D,
    marginBottom: 2,
  },
  input: {
    width: '100%',
    background: 'rgba(255,255,255,0.04)',
    border: '1px solid rgba(255,255,255,0.08)',
    borderRadius: 4,
    padding: '6px 8px',
    color: '#fff',
    fontSize: '0.75rem',
    fontFamily: 'inherit',
    outline: 'none',
    boxSizing: 'border-box' as const,
  },
  textarea: {
    width: '100%',
    background: 'rgba(255,255,255,0.04)',
    border: '1px solid rgba(255,255,255,0.08)',
    borderRadius: 4,
    padding: '6px 8px',
    color: '#fff',
    fontSize: '0.75rem',
    fontFamily: 'inherit',
    outline: 'none',
    resize: 'vertical' as const,
    boxSizing: 'border-box' as const,
  },
  executeBtn: {
    width: '100%',
    padding: '8px 12px',
    background: '#ff5555',
    color: '#fff',
    border: 'none',
    borderRadius: 4,
    cursor: 'pointer',
    fontSize: '0.8rem',
    fontFamily: 'inherit',
    fontWeight: 'bold' as const,
    marginTop: 4,
  },
  resultBox: (ok: boolean) => ({
    marginTop: 10,
    border: `1px solid ${ok ? 'rgba(85,255,85,0.2)' : 'rgba(255,85,85,0.2)'}`,
    borderRadius: 4,
    background: ok ? 'rgba(85,255,85,0.04)' : 'rgba(255,85,85,0.04)',
    overflow: 'hidden' as const,
  }),
  resultHeader: {
    fontSize: '0.68rem',
    padding: '4px 8px',
    fontWeight: 'bold' as const,
    color: '#fff',
    background: 'rgba(255,255,255,0.04)',
  },
  resultOutput: {
    fontSize: '0.7rem',
    padding: '8px',
    whiteSpace: 'pre-wrap' as const,
    wordBreak: 'break-all' as const,
    maxHeight: '200px',
    overflowY: 'auto' as const,
    color: D,
    lineHeight: 1.5,
    margin: 0,
  },
};
