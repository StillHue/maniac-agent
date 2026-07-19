'use client';

import { FormEvent, useCallback, useEffect, useRef, useState } from 'react';
import { Circle, MessageCircle, HelpCircle, ClipboardList, MessageSquareMore, ClipboardPaste, Image, Plus, Trash2 } from 'lucide-react';
import OrbScene from '../components/OrbScene';
import SpinningPlanet from '../components/SpinningPlanet';

type EngineMode = 'chat' | 'ask' | 'plan';

interface ToolCallDisp {
  id: string;
  tool: string;
  args: string;
  success?: boolean;
  output?: string;
  done: boolean;
}

interface ChatMsg {
  id: string;
  role: 'user' | 'assistant' | 'system' | 'event';
  content: string;
  contentType?: 'text' | 'pasted' | 'image';
  mode?: EngineMode;
  toolCalls?: ToolCallDisp[];
}

interface Conversation {
  id: string;
  title: string;
  messages: ChatMsg[];
  mode: EngineMode;
  createdAt: number;
}

const genId = (p: string) => `${p}${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
const cuid = () => genId('c');
const muid = () => genId('m');

const R = '#ff5555';

const STATUSES = ['Thinking…', 'Reasoning…', 'Delegating…', 'Executing…', 'Reviewing…'];

function ThinkingStatus() {
  const [i, setI] = useState(0);
  const [fade, setFade] = useState(true);
  useEffect(() => {
    const t = setInterval(() => {
      setFade(false);
      setTimeout(() => {
        setI(p => (p + 1) % STATUSES.length);
        setFade(true);
      }, 250);
    }, 2000);
    return () => clearInterval(t);
  }, []);
  return <span style={{ opacity: fade ? 1 : 0, transition: 'opacity 0.25s' }}>{STATUSES[i]}</span>;
}
const G = '#55ff55';
const Cc = '#55ffff';
const W = '#ffffff';
const Y = '#ffff55';
const VINHO = '#800020';
const VINHO_C = '#b4283c';
const D = '#aaaaaa';
const BG = '#000000';

const s = {
  page: { minHeight: '100vh', background: BG, fontFamily: 'JetBrains Mono, ui-monospace, monospace', color: W, display: 'flex', margin: 0, padding: 0 },

  sidebar: { width: '240px', flexShrink: 0, borderRight: '1px solid rgba(255,255,255,0.06)', display: 'flex', flexDirection: 'column' as const, padding: '12px', background: 'rgba(255,255,255,0.02)' },
  newBtn: { width: '100%', padding: '8px 12px', borderRadius: '6px', fontSize: '0.78rem', border: '1px solid rgba(255,255,255,0.1)', cursor: 'pointer', fontFamily: 'inherit', textAlign: 'left' as const, background: 'rgba(255,85,85,0.1)', color: R, fontWeight: 'bold', display: 'flex', alignItems: 'center', gap: 6, marginBottom: 12 },
  convList: { flex: 1, overflowY: 'auto' as const, display: 'flex', flexDirection: 'column' as const, gap: 2 },
  convItem: (a: boolean) => ({
    padding: '8px 10px', borderRadius: '6px', cursor: 'pointer', fontSize: '0.72rem', fontFamily: 'inherit', textAlign: 'left' as const, width: '100%', border: 'none', background: a ? 'rgba(255,255,255,0.08)' : 'transparent', color: a ? W : D, display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 4,
  }),
  convTitle: { overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' as const, flex: 1 },
  convDel: { background: 'none', border: 'none', color: D, cursor: 'pointer', padding: 2, opacity: 0, fontSize: '0.7rem' },
  sbFooter: { fontSize: '0.6rem', color: D, textAlign: 'center' as const, paddingTop: 12, borderTop: '1px solid rgba(255,255,255,0.06)', marginTop: 'auto', lineHeight: 1.6 },

  main: { flex: 1, display: 'flex', flexDirection: 'column' as const, padding: '20px 24px', minWidth: 0 },
  top: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: '0.72rem', color: D, paddingBottom: '8px', borderBottom: '1px solid rgba(255,255,255,0.06)', marginBottom: '8px' },
  log: { flex: 1, overflowY: 'auto' as const, minHeight: '400px', maxHeight: 'calc(100vh - 180px)', padding: '4px 0' },
  row: (isUser: boolean) => ({ marginBottom: '10px', textAlign: isUser ? 'right' as const : 'left' as const }),
  label: (isUser: boolean) => ({ fontSize: '0.65rem', color: isUser ? Cc : R, fontWeight: 'bold', marginBottom: '1px' }),
  body: { fontSize: '0.82rem', lineHeight: 1.6 },
  reasoning: { color: VINHO, marginBottom: '4px' },
  toolLine: (done: boolean, ok: boolean) => ({
    fontSize: '0.72rem', color: D, fontStyle: 'italic' as const, paddingLeft: '12px', borderLeft: `2px solid ${!done ? Y : ok ? G : R}`, marginBottom: '2px',
  }),
  toolOut: { fontSize: '0.68rem', color: D, whiteSpace: 'pre-wrap' as const, paddingLeft: '14px', maxHeight: '60px', overflowY: 'auto' as const },
  code: { background: 'rgba(0,0,0,0.4)', borderRadius: '4px', padding: '8px', overflow: 'auto' as const, fontSize: '0.75rem', lineHeight: 1.5, marginBlock: '4px', border: '1px solid rgba(255,255,255,0.04)' },
  form: { display: 'flex', alignItems: 'center', gap: '6px', borderTop: '1px solid rgba(255,255,255,0.06)', paddingTop: '8px' },
  prompt: { color: R, fontSize: '0.85rem', flexShrink: 0 },
  input: { flex: 1, background: 'transparent', border: 'none', padding: '8px 0', color: W, fontSize: '0.85rem', outline: 'none', fontFamily: 'inherit' },
  empty: { padding: '40px 0', color: D, fontSize: '0.8rem', textAlign: 'center' as const },
  contentTypeTag: { fontSize: '0.65rem', color: D, fontStyle: 'italic' as const, marginLeft: '4px' },
};

function fmt(text: string) {
  const parts = text.split(/(```[\s\S]*?```)/g);
  return parts.map((part, i) => {
    if (part.startsWith('```')) {
      const code = part.split('\n').slice(1).join('\n').replace(/```$/, '').trimEnd();
      return <pre key={i} style={s.code}><code>{code}</code></pre>;
    }
    const html = part
      .replace(/\*\*(.*?)\*\*/g, '<strong style="color:#fff">$1</strong>')
      .replace(/\*(.*?)\*/g, '<em>$1</em>')
      .replace(/`([^`]+)`/g, '<code style="background:rgba(255,255,255,0.06);padding:1px 4px;border-radius:3px;font-size:0.8em">$1</code>')
      .replace(/\n/g, '<br/>');
    return <span key={i} dangerouslySetInnerHTML={{ __html: html }} />;
  });
}

function parseReason(text: string) {
  const m = text.match(/^\*\*Racioc[ií]nio:\*\*/i);
  if (!m) return { reasoning: '', rest: text };
  const after = m.index! + m[0].length;
  const brk = text.slice(after).search(/\n\n/);
  if (brk === -1) return { reasoning: text.slice(after).trim(), rest: '' };
  return { reasoning: text.slice(after, after + brk).trim(), rest: text.slice(after + brk + 2).trim() };
}

function Content({ content }: { content: string }) {
  const { reasoning, rest } = parseReason(content);
  return <>
    {reasoning && <div style={s.reasoning}><strong style={{ color: VINHO_C }}>Raciocínio:</strong> {fmt(reasoning)}</div>}
    {rest && fmt(rest)}
  </>;
}

function Tools({ calls }: { calls: ToolCallDisp[] }) {
  if (!calls?.length) return null;
  return <div style={{ marginBottom: '4px' }}>
    {calls.map(tc => {
      const done = tc.done;
      const ok = tc.success !== false;
      return <div key={tc.id}>
        <div style={s.toolLine(done, ok)}>
          {done ? (ok ? '✓' : '✗') : '○'} [{tc.tool}] {tc.args.slice(0, 100)}
        </div>
        {tc.output && <div style={s.toolOut}>{tc.output}</div>}
      </div>;
    })}
  </div>;
}

const MODES: { key: EngineMode }[] = [{ key: 'chat' }, { key: 'ask' }, { key: 'plan' }];

export default function Home() {
  const ref = useRef<HTMLDivElement>(null);
  const [d, setD] = useState('');
  const [load, setLoad] = useState(false);
  const [convs, setConvs] = useState<Conversation[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const tcRef = useRef<ToolCallDisp[]>([]);
  const seenProactive = useRef(new Set<string>());

  const activeConv = convs.find(c => c.id === activeId);
  const msgs = activeConv?.messages || [];

  const updateConv = useCallback((id: string, upd: Partial<Conversation>) => {
    setConvs(p => p.map(c => c.id === id ? { ...c, ...upd } : c));
  }, []);

  const newConv = useCallback(() => {
    const id = cuid();
    setConvs(p => [...p, { id, title: 'nova conversa', messages: [], mode: 'chat', createdAt: Date.now() }]);
    setActiveId(id);
    setD('');
  }, []);

  useEffect(() => {
    if (convs.length === 0) newConv();
  }, [convs.length, newConv]);

  const delConv = useCallback((id: string) => {
    setConvs(p => p.filter(c => c.id !== id));
    if (activeId === id) setActiveId(null);
  }, [activeId]);

  useEffect(() => { if (ref.current) ref.current.scrollTop = ref.current.scrollHeight; }, [msgs, load]);

  const activeMode = activeConv?.mode || 'chat';

  useEffect(() => {
    if (!activeId) return;
    let t: ReturnType<typeof setInterval>;
    const poll = async () => {
      if (load) return;
      try {
        const r = await fetch('/api/proactive');
        const { messages } = await r.json();
        if (messages?.length > 0) {
          const newIds: string[] = [];
          for (const m of messages) {
            const id = 'p-' + m.id;
            if (seenProactive.current.has(id)) continue;
            seenProactive.current.add(id);
            updateConv(activeId, { messages: [...(convs.find(c => c.id === activeId)?.messages || []), { id, role: 'assistant', content: m.text }] });
            newIds.push(m.id);
          }
          if (newIds.length > 0) {
            await fetch('/api/proactive', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ ids: newIds }),
            });
          }
        }
      } catch {}
    };
    poll();
    t = setInterval(poll, 30000);
    return () => clearInterval(t);
  }, [activeId, load, convs, updateConv]);

  const addMsg = useCallback((m: ChatMsg) => {
    if (!activeId) return;
    updateConv(activeId, { messages: [...(convs.find(c => c.id === activeId)?.messages || []), m] });
  }, [activeId, convs, updateConv]);

  const appendMsg = useCallback((t: string) => {
    if (!activeId) return;
    const conv = convs.find(c => c.id === activeId);
    if (!conv) return;
    const msgs = conv.messages;
    const i = msgs.length - 1;
    if (i < 0 || msgs[i].role !== 'assistant') return;
    const n = [...msgs];
    n[i] = { ...n[i], content: n[i].content + t };
    updateConv(activeId, { messages: n });
  }, [activeId, convs, updateConv]);

  const syncTools = useCallback((tc: ToolCallDisp[]) => {
    if (!activeId) return;
    const conv = convs.find(c => c.id === activeId);
    if (!conv) return;
    const msgs = conv.messages;
    const i = msgs.length - 1;
    if (i < 0 || msgs[i].role !== 'assistant') return;
    const n = [...msgs];
    n[i] = { ...n[i], toolCalls: [...tc] };
    updateConv(activeId, { messages: n });
  }, [activeId, convs, updateConv]);

  function handlePaste(e: React.ClipboardEvent<HTMLInputElement>) {
    const items = e.clipboardData.items;
    for (let i = 0; i < items.length; i++) {
      const item = items[i];
      if (item.type.startsWith('image/')) {
        e.preventDefault();
        const file = item.getAsFile();
        if (file) {
          const reader = new FileReader();
          reader.onload = () => {
            const dataUrl = reader.result as string;
            const id = muid();
            addMsg({ id, role: 'user', content: dataUrl, contentType: 'image' });
            setLoad(true);
            sendContent(dataUrl);
          };
          reader.readAsDataURL(file);
        }
        return;
      }
    }
  }

  async function sendContent(content: string) {
    if (!activeId) return;
    setLoad(true);
    const aid = muid();
    addMsg({ id: aid, role: 'assistant', content: '', mode: activeMode, toolCalls: [] });
    const tc: ToolCallDisp[] = [];
    tcRef.current = tc;
    const conv = convs.find(c => c.id === activeId);

    try {
      const hist = (conv?.messages || []).filter(m => m.role === 'user' || (m.role === 'assistant' && m.content)).map(m => ({ role: m.role as 'user' | 'assistant', content: m.content }));
      const res = await fetch('/api/chat', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: content, mode: activeMode, history: hist }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      if (!res.body) throw new Error('Sem body');

      const rd = res.body.getReader();
      const dec = new TextDecoder();
      let buf = '', evt = '';

      while (true) {
        const { done, value } = await rd.read();
        if (done) break;
        buf += dec.decode(value, { stream: true });
        for (const ln of buf.split('\n')) {
          buf = '';
          const tr = ln.trim();
          if (tr.startsWith('event: ')) { evt = tr.slice(7); continue; }
          if (!tr.startsWith('data: ')) continue;
          try {
            const j = JSON.parse(tr.slice(6));
            switch (evt) {
              case 'token': appendMsg(j.content); break;
              case 'tool_start': tc.push({ id: `t${tc.length}`, tool: j.tool, args: j.args, done: false }); syncTools([...tc]); break;
              case 'tool_result': { const f = tc.find(x => x.tool === j.tool && !x.done); if (f) { f.done = true; f.success = j.success; f.output = j.output?.slice(0, 500); syncTools([...tc]); } break; }
              case 'error': appendMsg(`\n\nErro: ${j.message}`); break;
            }
          } catch { }
          evt = '';
        }
      }
    } catch (err: any) { appendMsg(`\n\nErro: ${err.message}`); }
    finally { setLoad(false); tcRef.current = []; }
  }

  async function send(e?: FormEvent) {
    e?.preventDefault();
    const t = d.trim();
    if (!t || load || !activeId) return;
    setD('');
    const contentType = t.length > 500 ? 'pasted' : undefined;
    addMsg({ id: muid(), role: 'user', content: t, contentType });
    if (activeConv?.title === 'nova conversa') {
      updateConv(activeId, { title: t.slice(0, 40) + (t.length > 40 ? '...' : '') });
    }
    await sendContent(t);
  }

  return (
    <main style={s.page}>
      <div style={s.sidebar}>
        <div style={{ textAlign: 'center', marginBottom: 8 }}><OrbScene shapeIndex={0} /></div>
        <button onClick={newConv} style={s.newBtn}>
          <Plus size={16} /> nova conversa
        </button>

        <div style={s.convList}>
          {convs.map(c => (
            <div key={c.id} onMouseEnter={e => { const d = e.currentTarget.querySelector('button'); if (d) d.style.opacity = '1'; }} onMouseLeave={e => { const d = e.currentTarget.querySelector('button'); if (d) d.style.opacity = '0'; }} style={{ display: 'flex', alignItems: 'center' }}>
              <button onClick={() => setActiveId(c.id)} style={s.convItem(c.id === activeId)}>
                <span style={s.convTitle}>{c.title}</span>
                <span style={{ color: D, fontSize: '0.6rem', flexShrink: 0 }}>{c.mode}</span>
              </button>
              <button onClick={() => delConv(c.id)} style={s.convDel} title="excluir"><Trash2 size={12} /></button>
            </div>
          ))}
        </div>

        <div style={s.sbFooter}>
          maniac console<br />
          <span style={{ opacity: 0.5 }}>v1.0.0</span>
        </div>
      </div>

      <div style={s.main}>
        <div style={s.top}>
          <span><Circle size={8} fill={R} color={R} style={{ verticalAlign: 'middle' }} /> maniac <span style={{ color: D }}>│ {load ? <ThinkingStatus /> : 'pronto'}</span></span>
          <span style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
            {MODES.map(m => (
              <button key={m.key} onClick={() => updateConv(activeId || '', { mode: m.key })} style={{
                fontSize: '0.65rem', padding: '2px 6px', borderRadius: 4, border: `1px solid ${activeMode === m.key ? 'rgba(255,255,255,0.15)' : 'transparent'}`, cursor: 'pointer', fontFamily: 'inherit', background: activeMode === m.key ? 'rgba(255,255,255,0.06)' : 'transparent', color: activeMode === m.key ? W : D,
              }}>
                {m.key === 'chat' ? <MessageCircle size={12} style={{ verticalAlign: 'middle', marginRight: 2 }} /> : m.key === 'ask' ? <HelpCircle size={12} style={{ verticalAlign: 'middle', marginRight: 2 }} /> : <ClipboardList size={12} style={{ verticalAlign: 'middle', marginRight: 2 }} />}
                {m.key}
              </button>
            ))}
          </span>
        </div>

        <div ref={ref} style={s.log}>
          {msgs.length === 0 && !load && (
            <div style={s.empty}>
              <SpinningPlanet />
              <div style={{ fontSize: '0.9rem', marginBottom: 4 }}>o que você quer fazer hoje?</div>
              <div style={{ fontSize: '0.7rem' }}>eu penso, logo processo</div>
            </div>
          )}
          {msgs.map(m => {
            const u = m.role === 'user';
            const proactive = !u && m.id.startsWith('p-');
            return <div key={m.id} style={s.row(u)}>
              <div style={s.label(u)}>
                {u ? 'você' : 'maniac'}
                {u && m.contentType === 'pasted' && <span style={s.contentTypeTag}><ClipboardPaste size={11} style={{ verticalAlign: 'middle', marginLeft: 4 }} /> pasted</span>}
                {u && m.contentType === 'image' && <span style={s.contentTypeTag}><Image size={11} style={{ verticalAlign: 'middle', marginLeft: 4 }} /> image</span>}
              </div>
              {!u && m.toolCalls && m.toolCalls.length > 0 && <Tools calls={m.toolCalls} />}
              <div style={s.body}>
                {proactive && <MessageSquareMore size={14} style={{ verticalAlign: 'middle', marginRight: 4, color: '#888' }} />}
                {u && m.contentType === 'image'
                  ? <img src={m.content} alt="imagem" style={{ maxWidth: '300px', maxHeight: '300px', borderRadius: '8px', border: '1px solid rgba(255,255,255,0.1)' }} />
                  : m.content ? <Content content={m.content} /> : ''}
              </div>
            </div>;
          })}
          {load && <div style={s.row(false)}>
            <div style={s.label(false)}>maniac</div>
            {tcRef.current.length > 0 && <Tools calls={tcRef.current} />}
            <ThinkingStatus />
          </div>}
        </div>

        <form onSubmit={send} style={s.form}>
          <span style={s.prompt}><Circle size={8} fill={R} color={R} style={{ verticalAlign: 'middle' }} /> maniac │</span>
          <input type="text" value={d} onChange={e => setD(e.target.value)} onPaste={handlePaste}
            placeholder="digite sua mensagem..."
            style={s.input} disabled={load || !activeId} autoFocus />
        </form>
      </div>
    </main>
  );
}
