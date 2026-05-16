import React from 'react';
import { QuestCtx } from '../QuestContext.js';
import { CornerBrackets } from './Player.jsx';
import { Stat } from './Hall.jsx';
import { adminApi } from '../api.js';

// Admin.jsx — Admin panel (5 screens)
// Linear/Notion-density: persistent sidebar + dense content.

function AdminShell({ section, title, breadcrumb, actions, children, login = false }) {
  if (login) {
    return (
      <div style={{
        width: '100%', height: '100%',
        background: 'var(--bg)', color: 'var(--fg)',
        fontFamily: 'var(--font-sans)',
        display: 'grid', placeItems: 'center',
        position: 'relative', overflow: 'hidden',
      }} className="grid-bg">
        <CornerBrackets />
        {children}
      </div>
    );
  }
  return (
    <div style={{
      width: '100%', height: '100%',
      background: 'var(--bg)', color: 'var(--fg)',
      fontFamily: 'var(--font-sans)',
      display: 'grid', gridTemplateColumns: '232px 1fr',
      position: 'relative', overflow: 'hidden',
    }}>
      <AdminSidebar active={section} />
      <div style={{ display: 'grid', gridTemplateRows: '56px 1fr', overflow: 'hidden' }}>
        <AdminTopBar breadcrumb={breadcrumb || [title]} actions={actions} />
        <div style={{ overflow: 'auto' }}>
          {children}
        </div>
      </div>
    </div>
  );
}

function AdminSidebar({ active }) {
  const QUEST = React.useContext(QuestCtx);
  const [stats, setStats] = React.useState({});
  const [game, setGame] = React.useState({});
  // Countdown timer tick (seconds) to force re-render each second
  const [tick, setTick] = React.useState(0);

  // Load stats and game settings on mount
  React.useEffect(() => {
    adminApi.getStats().then(r => { if (r.ok) setStats(r.data); });
    adminApi.getGame().then(r => { if (r.ok) setGame(r.data); });
  }, []);

  // Countdown ticker: re-render every second for live timer display
  React.useEffect(() => {
    const id = setInterval(() => setTick(t => t + 1), 1000);
    return () => clearInterval(id);
  }, []);

  const sections = [
    { id: 'game',    label: 'Управление игрой', kbd: 'G' },
    { id: 'tags',    label: 'Метки',            kbd: 'T', meta: stats.total_tags != null ? String(stats.total_tags) : undefined },
    { id: 'players', label: 'Участники',        kbd: 'P', meta: stats.total_players != null ? String(stats.total_players) : undefined },
    { id: 'log',     label: 'Лог событий',      kbd: 'L', meta: stats.total_scans != null ? String(stats.total_scans) : undefined },
  ];

  // Compute game status from timestamps (same logic as ScreenAdminGame)
  const now = Date.now();
  const startsAt = game.starts_at ? new Date(game.starts_at).getTime() : null;
  const endsAt = game.ends_at ? new Date(game.ends_at).getTime() : null;
  let gameStatusLabel = 'НЕТ ДАТ';
  let gameStatusColor = 'var(--muted)';
  let gameStatusBorder = 'var(--line)';
  let gameStatusBg = 'transparent';
  let timerMs = null;

  if (startsAt && endsAt) {
    if (now < startsAt) {
      gameStatusLabel = 'НЕ НАЧАТА';
      gameStatusColor = 'var(--muted)';
      gameStatusBorder = 'var(--line)';
      timerMs = startsAt - now; // time until start
    } else if (now >= startsAt && now < endsAt) {
      gameStatusLabel = 'АКТИВНА';
      gameStatusColor = 'var(--success)';
      gameStatusBorder = 'var(--success-2)';
      gameStatusBg = 'rgba(108,208,122,0.08)';
      timerMs = endsAt - now; // time remaining
    } else {
      gameStatusLabel = 'ЗАВЕРШЕНА';
      gameStatusColor = 'var(--warn)';
      gameStatusBorder = 'var(--line)';
      timerMs = null;
    }
  }

  // Format milliseconds as HH:MM:SS
  const fmtTimer = (ms) => {
    if (ms == null || ms < 0) return null;
    const totalSec = Math.floor(ms / 1000);
    const h = Math.floor(totalSec / 3600);
    const m = Math.floor((totalSec % 3600) / 60);
    const s = totalSec % 60;
    return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  };

  const timerDisplay = fmtTimer(timerMs);

  return (
    <div style={{
      borderRight: '1px solid var(--line)',
      background: 'var(--bg)',
      padding: '12px 12px',
      display: 'flex', flexDirection: 'column', gap: 4,
    }}>
      {/* logo */}
      <div style={{
        display: 'flex', alignItems: 'center', gap: 10,
        padding: '12px 8px 18px', borderBottom: '1px solid var(--line)', marginBottom: 8,
      }}>
        <span style={{ width: 12, height: 12, background: 'var(--accent)' }} />
        <div>
          <div style={{ fontFamily: 'var(--font-display)', fontSize: 14, fontWeight: 700, letterSpacing: '-0.02em' }}>{QUEST}</div>
          <div className="mono" style={{ fontSize: 10, color: 'var(--muted)', letterSpacing: '0.1em' }}>NFC · QUEST · ADMIN</div>
        </div>
      </div>

      <div className="brak" style={{ padding: '6px 8px' }}>конференция</div>

      {sections.map(s => (
        <div key={s.id}
          onClick={() => { window.location.href = `/admin/${s.id}`; }}
          style={{
          display: 'grid', gridTemplateColumns: '1fr auto auto', alignItems: 'center', gap: 8,
          padding: '7px 8px',
          background: active === s.id ? 'var(--bg-2)' : 'transparent',
          borderLeft: active === s.id ? '2px solid var(--accent)' : '2px solid transparent',
          fontSize: 13,
          color: active === s.id ? 'var(--fg)' : 'var(--fg-2)',
          fontWeight: active === s.id ? 600 : 400,
          cursor: 'pointer',
        }}>
          <span>{s.label}</span>
          {s.meta && <span className="mono" style={{ fontSize: 11, color: 'var(--muted)' }}>{s.meta}</span>}
          <span className="mono" style={{
            fontSize: 10, color: 'var(--muted)', border: '1px solid var(--line-2)',
            padding: '1px 4px', minWidth: 14, textAlign: 'center',
          }}>{s.kbd}</span>
        </div>
      ))}

      <div style={{ flex: 1 }} />

      {/* status pill — real game status with live countdown */}
      <div style={{ padding: '10px 8px', borderTop: '1px solid var(--line)', display: 'flex', flexDirection: 'column', gap: 8 }}>
        <div className="brak" style={{ fontSize: 10 }}>статус игры</div>
        <div style={{
          display: 'flex', alignItems: 'center', gap: 8,
          padding: '6px 10px', border: `1px solid ${gameStatusBorder}`, background: gameStatusBg,
        }}>
          <span style={{ width: 6, height: 6, background: gameStatusColor, borderRadius: '50%' }} />
          <span style={{ color: gameStatusColor, fontFamily: 'var(--font-mono)', fontSize: 11, letterSpacing: '0.08em', textTransform: 'uppercase' }}>{gameStatusLabel}</span>
          <span style={{ flex: 1 }} />
          {timerDisplay && (
            <span className="mono tabular" style={{ fontSize: 11, color: 'var(--fg-2)' }}>{timerDisplay}</span>
          )}
        </div>
        <div className="mono" style={{ fontSize: 10, color: 'var(--muted)', display: 'flex', justifyContent: 'space-between' }}>
          <span>admin@metascan</span>
          <span onClick={() => adminApi.logout().then(() => { window.location.href = '/admin/login'; })} style={{ cursor: 'pointer' }}>выйти</span>
        </div>
      </div>
    </div>
  );
}

function AdminTopBar({ breadcrumb, actions }) {
  return (
    <div style={{
      display: 'flex', alignItems: 'center', justifyContent: 'space-between',
      padding: '0 24px', borderBottom: '1px solid var(--line)',
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontFamily: 'var(--font-mono)', fontSize: 12, color: 'var(--muted)', letterSpacing: '0.08em' }}>
        {breadcrumb.map((b, i) => (
          <React.Fragment key={i}>
            {i > 0 && <span style={{ color: 'var(--muted-2)' }}>/</span>}
            <span style={{ color: i === breadcrumb.length - 1 ? 'var(--fg)' : 'var(--muted)', textTransform: 'uppercase' }}>{b}</span>
          </React.Fragment>
        ))}
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        {actions}
      </div>
    </div>
  );
}

// ─── Screen 4: Admin login ──────────────────────────────────────
function ScreenAdminLogin() {
  const QUEST = React.useContext(QuestCtx);
  const [password, setPassword] = React.useState('');
  const [error, setError] = React.useState(null);
  const [loading, setLoading] = React.useState(false);

  const handleLogin = async () => {
    setLoading(true);
    setError(null);
    const res = await adminApi.login(password);
    if (res.ok) {
      window.location.href = '/admin';
    } else {
      setError('Неверный пароль');
    }
    setLoading(false);
  };

  return (
    <AdminShell login>
      <div style={{
        width: 420, position: 'relative', zIndex: 2,
        background: 'var(--bg-2)', border: '1px solid var(--line)',
        padding: 32, display: 'flex', flexDirection: 'column', gap: 18,
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <span style={{ width: 16, height: 16, background: 'var(--accent)' }} />
          <div>
            <div style={{ fontFamily: 'var(--font-display)', fontSize: 18, fontWeight: 700, letterSpacing: '-0.02em' }}>Квест «{QUEST}»</div>
            <div className="mono" style={{ fontSize: 11, color: 'var(--muted)', letterSpacing: '0.1em' }}>панель администратора</div>
          </div>
        </div>
        <div className="hr" />
        <div>
          <label className="brak" style={{ fontSize: 11 }}>пароль</label>
          <input
            className="input"
            type="password"
            value={password}
            onChange={e => setPassword(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && !loading && handleLogin()}
            style={{ marginTop: 6 }}
          />
          {error && (
            <div className="mono" style={{
              fontSize: 11, color: 'var(--accent)', marginTop: 8,
              display: 'flex', alignItems: 'center', gap: 6,
            }}>
              <span style={{ width: 6, height: 6, background: 'var(--accent)' }} />
              {error}
            </div>
          )}
        </div>
        <button className="btn" onClick={handleLogin} disabled={loading}>
          {loading ? 'Вход…' : 'Войти'}
        </button>
      </div>
    </AdminShell>
  );
}

// ─── Screen 5: Game management ──────────────────────────────────
function ScreenAdminGame() {
  const [settings, setSettings] = React.useState({});
  const [stats, setStats] = React.useState({});
  const [loading, setLoading] = React.useState(false);
  const [saved, setSaved] = React.useState(false);

  // Load game settings and stats on mount
  React.useEffect(() => {
    adminApi.getGame().then(r => { if (r.ok) setSettings(r.data); });
    adminApi.getStats().then(r => { if (r.ok) setStats(r.data); });
  }, []);

  const reloadSettings = () => adminApi.getGame().then(r => { if (r.ok) setSettings(r.data); });
  const reloadStats = () => adminApi.getStats().then(r => { if (r.ok) setStats(r.data); });

  const handleSave = async () => {
    setLoading(true);
    setSaved(false);
    try {
      await adminApi.updateGame({
        starts_at: settings.starts_at,
        ends_at: settings.ends_at,
        award_message: settings.award_message,
      });
      await reloadSettings();
      setSaved(true);
    } finally {
      setLoading(false);
    }
  };

  const handleStartGame = async () => {
    if (!window.confirm('Запустить игру сейчас? Все участники смогут сканировать метки.')) return;
    await adminApi.startGame();
    await reloadSettings();
  };

  const handleStopGame = async () => {
    if (!window.confirm('Остановить игру? Сканирование будет закрыто.')) return;
    await adminApi.stopGame();
    await reloadSettings();
  };

  const handleDeleteAllPlayers = async () => {
    if (!window.confirm('Удалить всех участников? Это действие необратимо.')) return;
    await adminApi.deleteAllPlayers();
    await reloadStats();
  };

  const handleDeleteAllTags = async () => {
    if (!window.confirm('Удалить все метки? Это действие необратимо.')) return;
    await adminApi.deleteAllTags();
    await reloadStats();
  };

  // Compute game status from settings timestamps
  const now = Date.now();
  const startsAt = settings.starts_at ? new Date(settings.starts_at).getTime() : null;
  const endsAt = settings.ends_at ? new Date(settings.ends_at).getTime() : null;
  let gameStatus = 'НЕ НАЧАТА';
  let statusColor = 'var(--muted)';
  if (startsAt && endsAt) {
    if (now >= startsAt && now < endsAt) { gameStatus = 'АКТИВНА'; statusColor = 'var(--success)'; }
    else if (now >= endsAt) { gameStatus = 'ЗАВЕРШЕНА'; statusColor = 'var(--warn)'; }
  }

  return (
    <AdminShell
      section="game"
      breadcrumb={['Конференция', 'Управление игрой']}
      actions={<>
        {saved && <span className="mono" style={{ fontSize: 11, color: 'var(--success)' }}>сохранено ✓</span>}
        <button className="btn sm" onClick={handleSave} disabled={loading}>
          {loading ? 'Сохраняем…' : 'Сохранить настройки'}
        </button>
      </>}
    >
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 360px', gap: 0, height: '100%' }}>
        {/* MAIN */}
        <div style={{ padding: 28, display: 'flex', flexDirection: 'column', gap: 28, overflow: 'auto' }}>
          <SectionBlock title="01 · временные рамки" desc="Когда квест открывается и закрывается. Между этими моментами участники могут сканировать метки.">
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
              <Field label="начало игры" hint="МСК">
                <input
                  className="input"
                  type="datetime-local"
                  value={settings.starts_at ? settings.starts_at.slice(0, 16) : ''}
                  onChange={e => setSettings(s => ({ ...s, starts_at: e.target.value ? e.target.value + ':00' : null }))}
                />
              </Field>
              <Field label="конец игры" hint="МСК">
                <input
                  className="input"
                  type="datetime-local"
                  value={settings.ends_at ? settings.ends_at.slice(0, 16) : ''}
                  onChange={e => setSettings(s => ({ ...s, ends_at: e.target.value ? e.target.value + ':00' : null }))}
                />
              </Field>
            </div>
          </SectionBlock>

          <SectionBlock title="02 · сообщение награждения" desc="Появляется на таблице лидеров после финиша.">
            <textarea
              className="input"
              rows={3}
              value={settings.award_message || ''}
              onChange={e => setSettings(s => ({ ...s, award_message: e.target.value }))}
              style={{ fontFamily: 'var(--font-sans)', resize: 'vertical' }}
            />
          </SectionBlock>

          <SectionBlock title="03 · опасная зона" desc="Действия без отмены. Подтверждение через диалог.">
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 12 }}>
              <DangerBtn label="Запустить игру сейчас" sub="откроет окно сканирования всем" onClick={handleStartGame} />
              <DangerBtn label="Остановить игру" sub="закроет сканирование, табло остаётся" danger onClick={handleStopGame} />
              <DangerBtn label="Очистить список участников" sub={`удалит ${stats.total_players ?? 0} UUID и баллы`} danger onClick={handleDeleteAllPlayers} />
              <DangerBtn label="Очистить список меток" sub={`удалит ${stats.total_tags ?? 0} tag_id и события`} danger onClick={handleDeleteAllTags} />
            </div>
          </SectionBlock>
        </div>

        {/* SIDE — current status, big */}
        <div style={{ borderLeft: '1px solid var(--line)', padding: 24, background: 'var(--bg-2)', display: 'flex', flexDirection: 'column', gap: 22 }}>
          <div>
            <div className="brak" style={{ fontSize: 11 }}>текущий статус</div>
            <div style={{
              fontFamily: 'var(--font-display)', fontSize: 56, fontWeight: 800,
              letterSpacing: '-0.03em', color: statusColor, lineHeight: 1, marginTop: 8,
            }}>{gameStatus}</div>
          </div>

          <div className="hr" />

          <div>
            <div className="brak" style={{ fontSize: 11, marginBottom: 8 }}>счётчики</div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              <KV k="участники" v={stats.total_players ?? '—'} />
              <KV k="метки активные" v={stats.active_tags != null ? `${stats.active_tags} / ${stats.total_tags}` : '—'} />
              <KV k="сканирования" v={stats.total_scans ?? '—'} />
              <KV k="сканов / минуту" v={stats.scans_per_minute ?? '—'} />
              <KV k="макс. счёт" v={stats.max_score ? `${stats.max_score.nick} · ${stats.max_score.points}` : '—'} />
            </div>
          </div>

          <div className="hr" />

          <div>
            <div className="brak" style={{ fontSize: 11, marginBottom: 8 }}>endpoints</div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 4, fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--fg-2)' }}>
              <div><span style={{ color: 'var(--success)' }}>GET</span> /tag/&lt;id&gt;</div>
              <div><span style={{ color: 'var(--success)' }}>GET</span> /scoreboard</div>
              <div><span style={{ color: 'var(--info)'    }}>POST</span> /register</div>
              <div><span style={{ color: 'var(--warn)'    }}>SSE</span>  /events</div>
            </div>
          </div>
        </div>
      </div>
    </AdminShell>
  );
}

function SectionBlock({ title, desc, children }) {
  return (
    <section>
      <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', marginBottom: 6 }}>
        <h3 style={{ fontFamily: 'var(--font-display)', fontSize: 18, fontWeight: 700, letterSpacing: '-0.02em', margin: 0 }}>{title}</h3>
      </div>
      {desc && <div style={{ color: 'var(--muted)', fontSize: 13, marginBottom: 14, maxWidth: 600 }}>{desc}</div>}
      {children}
    </section>
  );
}

function Field({ label, hint, children }) {
  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', marginBottom: 6 }}>
        <label className="brak" style={{ fontSize: 11 }}>{label}</label>
        {hint && <span className="mono" style={{ fontSize: 10, color: 'var(--muted)' }}>{hint}</span>}
      </div>
      {children}
    </div>
  );
}

function DateTimeField({ date, time }) {
  return (
    <div style={{ display: 'flex', alignItems: 'stretch', border: '1px solid var(--line)' }}>
      <div style={{ flex: 1, padding: '12px 12px', fontFamily: 'var(--font-mono)', fontSize: 14, color: 'var(--fg)' }}>{date}</div>
      <div style={{ width: 1, background: 'var(--line)' }} />
      <div style={{ width: 100, padding: '12px 12px', fontFamily: 'var(--font-mono)', fontSize: 14, color: 'var(--fg)', textAlign: 'right' }}>{time}</div>
    </div>
  );
}

function DangerBtn({ label, sub, danger, onClick }) {
  return (
    <div
      style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        gap: 12, padding: '14px 16px',
        border: '1px solid ' + (danger ? 'var(--accent)' : 'var(--line-2)'),
        cursor: 'pointer',
      }}
      onClick={onClick}
    >
      <div>
        <div style={{ fontSize: 14, fontWeight: 600, color: danger ? 'var(--accent)' : 'var(--fg)' }}>{label}</div>
        <div style={{ fontSize: 12, color: 'var(--muted)', marginTop: 2 }}>{sub}</div>
      </div>
      <svg width="16" height="16" viewBox="0 0 16 16" stroke={danger ? 'var(--accent)' : 'var(--fg-2)'} strokeWidth="1.4" fill="none"><path d="M4 8h8M8 4l4 4-4 4"/></svg>
    </div>
  );
}

function KV({ k, v }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', borderBottom: '1px dashed var(--line)', padding: '5px 0' }}>
      <span className="mono" style={{ fontSize: 11, color: 'var(--muted)', letterSpacing: '0.06em', textTransform: 'uppercase' }}>{k}</span>
      <span className="mono tabular" style={{ fontSize: 13, color: 'var(--fg)' }}>{v}</span>
    </div>
  );
}

// ─── Screen 6: Tags (dense table view) ─────────────────────────
function ScreenAdminTags() {
  const [tags, setTags] = React.useState([]);
  const [total, setTotal] = React.useState(0);
  const [loading, setLoading] = React.useState(false);
  const [page, setPage] = React.useState(1);
  const [showCreate, setShowCreate] = React.useState(false);
  // Currently selected tag for the detail panel
  const [selectedTag, setSelectedTag] = React.useState(null);
  const perPage = 50;

  const loadTags = React.useCallback(() => {
    setLoading(true);
    adminApi.getTags({ page, per_page: perPage }).then(r => {
      if (r.ok) {
        setTags(r.data.items || []);
        setTotal(r.data.total || 0);
      }
      setLoading(false);
    });
  }, [page]);

  React.useEffect(() => { loadTags(); }, [loadTags]);

  // Dismiss tag detail panel on Escape
  React.useEffect(() => {
    const handler = (e) => { if (e.key === 'Escape') setSelectedTag(null); };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, []);

  const handleReset = async (id) => {
    await adminApi.resetTag(id);
    loadTags();
  };

  const handleDelete = async (id) => {
    if (!window.confirm(`Удалить метку ${id}?`)) return;
    await adminApi.deleteTag(id);
    loadTags();
  };

  if (showCreate) {
    return <ScreenAdminTagsCreate onBack={() => { setShowCreate(false); loadTags(); }} />;
  }

  return (
    <AdminShell
      section="tags"
      breadcrumb={['Конференция', 'Метки']}
      actions={<>
        <button className="btn ghost sm">Экспорт CSV</button>
        <button className="btn sm" onClick={() => setShowCreate(true)}>+ создать пачку</button>
      </>}
    >
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 320px', height: '100%' }}>
        {/* main */}
        <div style={{ overflow: 'auto', display: 'flex', flexDirection: 'column' }}>
          {/* filter bar */}
          <div style={{ padding: '10px 24px', borderBottom: '1px solid var(--line)', display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
            <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
              <div className="brak" style={{ fontSize: 11 }}>все метки · {total}</div>
              <input className="input sm" placeholder="tag_id или label" style={{ width: 220 }} />
              <FilterChip label="стратегия: все" />
              <FilterChip label="статус: all" />
            </div>
            <div className="mono" style={{ fontSize: 11, color: 'var(--muted)', whiteSpace: 'nowrap' }}>
              {loading ? 'загрузка…' : `${tags.length} из ${total}`}
            </div>
          </div>

          {/* dense table */}
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12, fontFamily: 'var(--font-sans)' }}>
            <thead>
              <tr style={{ textAlign: 'left', color: 'var(--muted)', fontFamily: 'var(--font-mono)', fontSize: 10, textTransform: 'uppercase', letterSpacing: '0.08em', background: 'var(--bg-2)' }}>
                {[
                  ['tag_id', 110],
                  ['label', null],
                  ['стратегия', 100],
                  ['параметры', 90],
                  ['сканов', 70],
                  ['уник.', 60],
                  ['статус', 80],
                  ['', 100],
                ].map(([h, w]) => (
                  <th key={h} style={{ padding: '6px 12px', borderBottom: '1px solid var(--line)', fontWeight: 500, width: w ?? undefined }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {tags.map((t, i) => {
                // Build params display from strategy_params object returned by API
                const sp = t.strategy_params || {};
                const params = t.strategy === 'fixed' ? `+${sp.points ?? '?'}`
                  : t.strategy === 'penalty' ? `-${sp.points ?? '?'}`
                  : t.strategy === 'random' ? `+${sp.min ?? sp.min_points ?? '?'}…+${sp.max ?? sp.max_points ?? '?'}`
                  : t.strategy === 'oneshot' ? `+${sp.points ?? '?'}`
                  : t.strategy === 'transfer' ? `±${sp.points ?? '?'}`
                  : '—';
                return (
                  <tr key={t.id}
                    onClick={() => setSelectedTag(t)}
                    style={{
                    borderBottom: '1px solid var(--line)',
                    background: selectedTag && selectedTag.id === t.id ? 'var(--bg-2)' : i === 0 && !selectedTag ? 'var(--bg-2)' : 'transparent',
                    cursor: 'pointer',
                  }}>
                    <td style={{ padding: '5px 12px', fontFamily: 'var(--font-mono)', fontSize: 12, color: 'var(--fg)' }}>{t.id}</td>
                    <td style={{ padding: '5px 12px', color: 'var(--fg-2)' }}>{t.label || '—'}</td>
                    <td style={{ padding: '5px 12px' }}><StrategyChip s={t.strategy} /></td>
                    <td style={{ padding: '5px 12px', fontFamily: 'var(--font-mono)', color: 'var(--fg)' }} className="tabular">{params}</td>
                    <td style={{ padding: '5px 12px', fontFamily: 'var(--font-mono)' }} className="tabular">{t.total_scans ?? 0}</td>
                    <td style={{ padding: '5px 12px', fontFamily: 'var(--font-mono)' }} className="tabular">{t.unique_scans ?? 0}</td>
                    <td style={{ padding: '5px 12px' }}><StatusBadge s={t.status || 'active'} /></td>
                    <td style={{ padding: '5px 12px', fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--muted)', textAlign: 'right' }}>
                      <span style={{ marginRight: 12, cursor: 'pointer' }} onClick={() => handleReset(t.id)}>сброс</span>
                      <span style={{ color: 'var(--accent)', cursor: 'pointer' }} onClick={() => handleDelete(t.id)}>удал.</span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>

          {/* pagination footer */}
          <div style={{ padding: '8px 24px', borderTop: '1px solid var(--line)', display: 'flex', justifyContent: 'space-between', fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--muted)' }}>
            <span>показано {(page - 1) * perPage + 1}–{Math.min(page * perPage, total)} из {total}</span>
            <span>
              <span style={{ cursor: 'pointer', marginRight: 12 }} onClick={() => setPage(p => Math.max(1, p - 1))}>←</span>
              <span style={{ cursor: 'pointer' }} onClick={() => setPage(p => p + 1)}>→</span>
            </span>
          </div>
        </div>

        {/* side — tag detail panel */}
        <div style={{ borderLeft: '1px solid var(--line)', background: 'var(--bg-2)', padding: 20, display: 'flex', flexDirection: 'column', gap: 18, overflow: 'auto' }}>
          {selectedTag ? (
            <>
              {/* header */}
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <div className="brak" style={{ fontSize: 11 }}>[ выбрано · {selectedTag.id} ]</div>
                <span
                  className="mono"
                  style={{ fontSize: 10, color: 'var(--muted)', cursor: 'pointer' }}
                  onClick={() => setSelectedTag(null)}
                >esc</span>
              </div>

              {/* label */}
              <div>
                <div className="mono" style={{ fontSize: 11, color: 'var(--muted)', letterSpacing: '0.08em', textTransform: 'uppercase' }}>label</div>
                <div style={{ fontFamily: 'var(--font-display)', fontSize: 20, fontWeight: 700, marginTop: 4, letterSpacing: '-0.02em' }}>
                  {selectedTag.label || '—'}
                </div>
              </div>

              {/* URL */}
              <div>
                <div className="brak" style={{ fontSize: 11, marginBottom: 4 }}>url</div>
                <div className="mono" style={{ fontSize: 11, color: 'var(--fg-2)', wordBreak: 'break-all' }}>
                  {window.location.origin}/tag/{selectedTag.id}
                </div>
              </div>

              {/* data rows */}
              <KVList items={[
                ['стратегия', selectedTag.strategy || '—'],
                ['параметры', (() => {
                  const sp = selectedTag.strategy_params || {};
                  if (selectedTag.strategy === 'fixed')    return `+${sp.points ?? '?'}`;
                  if (selectedTag.strategy === 'penalty')  return `-${sp.points ?? '?'}`;
                  if (selectedTag.strategy === 'random')   return `+${sp.min ?? sp.min_points ?? '?'}…+${sp.max ?? sp.max_points ?? '?'}`;
                  if (selectedTag.strategy === 'oneshot')  return `+${sp.points ?? '?'}`;
                  if (selectedTag.strategy === 'transfer') return `±${sp.points ?? '?'}`;
                  return JSON.stringify(sp);
                })()],
                ['сканов', selectedTag.total_scans ?? selectedTag.scan_count ?? 0],
                ['уникальных', selectedTag.unique_scans ?? selectedTag.unique_players_count ?? 0],
                ['создана', selectedTag.created_at ? new Date(selectedTag.created_at).toLocaleString('ru-RU') : '—'],
              ]} />

              {/* Sparkline visual accent */}
              <div>
                <Sparkline />
              </div>

              {/* actions */}
              <div style={{ display: 'flex', gap: 8, marginTop: 'auto' }}>
                <button
                  className="btn ghost sm"
                  style={{ flex: 1 }}
                  onClick={() => { handleReset(selectedTag.id); setSelectedTag(null); }}
                >Сброс</button>
                <button
                  className="btn sm"
                  style={{ flex: 1, borderColor: 'var(--accent)', color: 'var(--accent)' }}
                  onClick={() => { handleDelete(selectedTag.id); setSelectedTag(null); }}
                >Удалить</button>
              </div>
            </>
          ) : (
            <>
              {/* placeholder when nothing is selected */}
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <div className="brak" style={{ fontSize: 11 }}>выбрано · —</div>
                <span className="mono" style={{ fontSize: 10, color: 'var(--muted)' }}>esc</span>
              </div>
              <div>
                <div className="mono" style={{ fontSize: 11, color: 'var(--muted)', letterSpacing: '0.08em', textTransform: 'uppercase' }}>label</div>
                <div style={{ fontFamily: 'var(--font-display)', fontSize: 20, fontWeight: 700, marginTop: 4, letterSpacing: '-0.02em', color: 'var(--muted)' }}>нажмите на метку</div>
              </div>
              <div>
                <Sparkline />
              </div>
            </>
          )}
        </div>
      </div>
    </AdminShell>
  );
}

function KVList({ items }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column' }}>
      {items.map(([k, v]) => (
        <div key={k} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', padding: '4px 0', borderBottom: '1px dashed var(--line)', fontFamily: 'var(--font-mono)', fontSize: 11 }}>
          <span style={{ color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>{k}</span>
          <span className="tabular" style={{ color: 'var(--fg)' }}>{v}</span>
        </div>
      ))}
    </div>
  );
}

// ─── Screen 6b: Tag batch creation ─────────────────────────────
function ScreenAdminTagsCreate({ onBack }) {
  const [strategy, setStrategy] = React.useState('fixed');
  const [points, setPoints] = React.useState('50');
  const [labelPrefix, setLabelPrefix] = React.useState('hall · ');
  const [count, setCount] = React.useState('12');
  const [created, setCreated] = React.useState(null); // array of {id, url}
  const [loading, setLoading] = React.useState(false);

  const handleCreate = async () => {
    setLoading(true);
    const strategyParams = strategy === 'random'
      ? { min_points: 10, max_points: parseInt(points) || 50 }
      : { points: parseInt(points) || 50 };
    const res = await adminApi.createTagsBatch({
      strategy,
      strategy_params: strategyParams,
      count: parseInt(count) || 12,
      label_prefix: labelPrefix,
    });
    if (res.ok) {
      setCreated(res.data.items || []);
    }
    setLoading(false);
  };

  return (
    <AdminShell
      section="tags"
      breadcrumb={['Конференция', 'Метки', 'Создание']}
      actions={<>
        <button className="btn ghost sm" onClick={onBack}>← Назад к таблице</button>
        <button className="btn ghost sm">Печать листа</button>
        {!created && <button className="btn sm" onClick={handleCreate} disabled={loading}>{loading ? 'Создаём…' : `+ ещё пачка`}</button>}
      </>}
    >
      <div style={{ display: 'grid', gridTemplateColumns: '420px 1fr', height: '100%' }}>
        {/* left — form */}
        <div style={{ borderRight: '1px solid var(--line)', padding: 24, display: 'flex', flexDirection: 'column', gap: 20, overflow: 'auto' }}>
          <div>
            <div className="brak" style={{ fontSize: 11 }}>новая пачка</div>
            <h2 style={{ fontFamily: 'var(--font-display)', fontSize: 28, fontWeight: 700, letterSpacing: '-0.02em', margin: '8px 0 4px' }}>Создать метки</h2>
            <p style={{ color: 'var(--muted)', fontSize: 13, margin: 0, maxWidth: 360 }}>Сгенерируйте URL и запишите их на NFC через любое приложение для записи (например NFC Tools).</p>
          </div>
          <div className="hr" />
          <Field label="стратегия">
            <select
              className="input"
              value={strategy}
              onChange={e => setStrategy(e.target.value)}
              style={{ fontFamily: 'var(--font-mono)', fontSize: 13 }}
            >
              <option value="fixed">fixed · фиксированные баллы</option>
              <option value="random">random · случайные баллы</option>
              <option value="penalty">penalty · штраф</option>
              <option value="oneshot">oneshot · одноразовая</option>
              <option value="transfer">transfer · перевод</option>
            </select>
          </Field>
          <Field label="баллы">
            <input className="input" value={points} onChange={e => setPoints(e.target.value)} />
          </Field>
          <Field label="префикс label">
            <input className="input" value={labelPrefix} onChange={e => setLabelPrefix(e.target.value)} placeholder="например: zal-A · " />
          </Field>
          <Field label="количество" hint="макс 200 за раз">
            <input className="input tabular" value={count} onChange={e => setCount(e.target.value)} />
          </Field>
          <div className="hr" />
          <div className="mono" style={{ fontSize: 11, color: 'var(--muted)', lineHeight: 1.6 }}>
            доступные стратегии:<br/>
            · fixed — фикс. баллы<br/>
            · random — диапазон min/max<br/>
            · penalty — отрицательные<br/>
            · oneshot — одноразовая (стартовая)<br/>
            · transfer — переводит баллы между игроками
          </div>
          <div style={{ flex: 1 }} />
          <button className="btn" style={{ width: '100%' }} onClick={handleCreate} disabled={loading}>
            {loading ? 'Создаём…' : `создать ${count} меток →`}
          </button>
        </div>

        {/* right — created urls list */}
        <div style={{ overflow: 'auto', display: 'flex', flexDirection: 'column' }}>
          {created ? (
            <>
              <div style={{ padding: '14px 24px', borderBottom: '1px solid var(--line)', display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 12, flexWrap: 'wrap' }}>
                <div>
                  <div className="brak" style={{ fontSize: 11 }}>создано · {created.length} меток</div>
                  <div style={{ fontFamily: 'var(--font-display)', fontSize: 18, fontWeight: 600, letterSpacing: '-0.02em', marginTop: 2 }}>
                    {strategy} · <span style={{ color: 'var(--success)' }}>+{points}</span> · prefix "{labelPrefix}"
                  </div>
                </div>
                <div style={{ display: 'flex', gap: 8 }}>
                  <button className="btn ghost sm">скопировать все</button>
                  <button className="btn ghost sm">экспорт TXT</button>
                </div>
              </div>

              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12, fontFamily: 'var(--font-mono)' }}>
                <thead>
                  <tr style={{ textAlign: 'left', color: 'var(--muted)', fontSize: 10, textTransform: 'uppercase', letterSpacing: '0.08em', background: 'var(--bg-2)' }}>
                    <th style={{ padding: '6px 24px', borderBottom: '1px solid var(--line)', fontWeight: 500, width: 40 }}>#</th>
                    <th style={{ padding: '6px 12px', borderBottom: '1px solid var(--line)', fontWeight: 500, width: 120 }}>tag_id</th>
                    <th style={{ padding: '6px 12px', borderBottom: '1px solid var(--line)', fontWeight: 500 }}>URL для NFC</th>
                    <th style={{ padding: '6px 12px', borderBottom: '1px solid var(--line)', fontWeight: 500, width: 80, textAlign: 'right' }}>действия</th>
                  </tr>
                </thead>
                <tbody>
                  {created.map((item, i) => (
                    <tr key={item.id} style={{ borderBottom: '1px solid var(--line)' }}>
                      <td style={{ padding: '6px 24px', color: 'var(--muted)' }} className="tabular">{String(i+1).padStart(2,'0')}</td>
                      <td style={{ padding: '6px 12px', color: 'var(--fg)' }}>{item.id}</td>
                      <td style={{ padding: '6px 12px', color: 'var(--fg)' }}>{item.url}</td>
                      <td style={{ padding: '6px 12px', textAlign: 'right', fontSize: 11, color: 'var(--muted)' }}>
                        <span style={{ cursor: 'pointer' }} onClick={() => navigator.clipboard?.writeText(item.url)}>copy</span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>

              <div style={{ padding: '12px 24px', borderTop: '1px solid var(--line)', background: 'var(--bg-2)', display: 'flex', alignItems: 'center', gap: 12 }}>
                <span style={{ width: 8, height: 8, background: 'var(--accent)', display: 'inline-block', flexShrink: 0 }} />
                <span className="mono" style={{ fontSize: 11, color: 'var(--fg-2)' }}>
                  {created.length} НЕЗАПИСАННЫХ URL — запишите их на NFC до старта
                </span>
              </div>
            </>
          ) : (
            <div style={{ display: 'grid', placeItems: 'center', flex: 1 }}>
              <div className="mono" style={{ fontSize: 13, color: 'var(--muted)' }}>заполните форму и нажмите «создать»</div>
            </div>
          )}
        </div>
      </div>
    </AdminShell>
  );
}

function SelectFake({ value }) {
  return (
    <div className="input" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
      <span>{value}</span>
      <svg width="12" height="12" viewBox="0 0 12 12" stroke="currentColor" fill="none"><path d="M3 5l3 3 3-3"/></svg>
    </div>
  );
}

function StrategyChip({ s }) {
  const map = {
    fixed:    { c: 'var(--info)',    l: 'fixed'    },
    random:   { c: 'var(--warn)',    l: 'random'   },
    penalty:  { c: 'var(--accent)',  l: 'penalty'  },
    oneshot:  { c: 'var(--success)', l: 'oneshot'  },
    transfer: { c: 'var(--gold)',    l: 'transfer' },
  };
  const m = map[s] || { c: 'var(--muted)', l: String(s || '—') };
  return (
    <span className="mono" style={{
      fontSize: 11, color: m.c, border: '1px solid ' + m.c,
      padding: '2px 6px', textTransform: 'uppercase', letterSpacing: '0.08em',
    }}>{m.l}</span>
  );
}

function StatusBadge({ s }) {
  const map = {
    active:   { c: 'var(--success)', l: '● active' },
    used:     { c: 'var(--muted)',   l: '○ used' },
    disabled: { c: 'var(--muted-2)', l: '× off' },
  };
  const m = map[s] || { c: 'var(--muted)', l: s || '—' };
  return <span className="mono" style={{ fontSize: 11, color: m.c, letterSpacing: '0.06em' }}>{m.l}</span>;
}

function FilterChip({ label }) {
  return (
    <span className="mono" style={{
      fontSize: 11, color: 'var(--fg-2)', border: '1px solid var(--line-2)',
      padding: '4px 8px', textTransform: 'uppercase', letterSpacing: '0.06em',
    }}>{label} <span style={{ color: 'var(--muted)', marginLeft: 4 }}>×</span></span>
  );
}

function FakeQR() {
  // pseudo QR
  const rows = [
    '11111110100111111',
    '10000010111100001',
    '10111010100101101',
    '10111010110101101',
    '10111010001101101',
    '10000010110100001',
    '11111110101011111',
    '00000000110100000',
    '11010111010111110',
    '01101010110010101',
    '10010111101101011',
    '01110010110011100',
    '00000001011001011',
    '11111110100010110',
    '10000010101011010',
    '10111010110101001',
    '10000010110001111',
  ];
  return (
    <svg width="56" height="56" viewBox="0 0 17 17" shapeRendering="crispEdges">
      <rect width="17" height="17" fill="var(--bg-2)"/>
      {rows.map((r, y) => r.split('').map((c, x) => c === '1' ? <rect key={x+'-'+y} x={x} y={y} width="1" height="1" fill="var(--fg)"/> : null))}
    </svg>
  );
}

function Sparkline() {
  // procedurally placed bars
  const bars = Array.from({ length: 32 }, (_, i) => 4 + Math.round(20 * Math.abs(Math.sin(i*0.7) + Math.cos(i*0.3))) % 30 + 6);
  return (
    <div style={{ display: 'flex', alignItems: 'end', gap: 2, height: 40 }}>
      {bars.map((h, i) => (
        <div key={i} style={{ width: 6, height: h, background: i > bars.length - 4 ? 'var(--accent)' : 'var(--line-2)' }} />
      ))}
    </div>
  );
}

// ─── Screen 7: Players ──────────────────────────────────────────
function ScreenAdminPlayers() {
  const [players, setPlayers] = React.useState([]);
  const [total, setTotal] = React.useState(0);
  const [loading, setLoading] = React.useState(false);
  const [page, setPage] = React.useState(1);
  const perPage = 50;

  const loadPlayers = React.useCallback(() => {
    setLoading(true);
    adminApi.getPlayers({ page, per_page: perPage }).then(r => {
      if (r.ok) {
        setPlayers(r.data.items || []);
        setTotal(r.data.total || 0);
      }
      setLoading(false);
    });
  }, [page]);

  React.useEffect(() => { loadPlayers(); }, [loadPlayers]);

  const handleAdjust = async (id, nick) => {
    const raw = window.prompt(`Изменить баллы для ${nick} (положительное или отрицательное число):`);
    if (raw === null) return;
    const delta = parseInt(raw);
    if (isNaN(delta)) return;
    await adminApi.adjustPlayer(id, delta);
    loadPlayers();
  };

  const handleDelete = async (id, nick) => {
    if (!window.confirm(`Удалить участника ${nick}?`)) return;
    await adminApi.deletePlayer(id);
    loadPlayers();
  };

  // Compute summary stats from loaded page
  const maxPoints = players.length ? Math.max(...players.map(p => p.points || 0)) : 0;
  const avgPoints = players.length ? Math.round(players.reduce((s, p) => s + (p.points || 0), 0) / players.length) : 0;

  return (
    <AdminShell
      section="players"
      breadcrumb={['Конференция', 'Участники']}
      actions={<>
        <button className="btn ghost sm">Экспорт CSV</button>
        <button className="btn sm">+ ручная регистрация</button>
      </>}
    >
      <div style={{ padding: 28, display: 'flex', flexDirection: 'column', gap: 16 }}>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 12 }}>
          <Stat label="всего" value={String(total)} />
          <Stat label="на странице" value={String(players.length)} />
          <Stat label="макс баллов" value={String(maxPoints)} />
          <Stat label="ср. баллов" value={String(avgPoints)} />
        </div>

        <div style={{ border: '1px solid var(--line)' }}>
          <div style={{ padding: '10px 16px', borderBottom: '1px solid var(--line)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <div style={{ display: 'flex', gap: 16, alignItems: 'center' }}>
              <div className="brak" style={{ fontSize: 11 }}>участники</div>
              <input className="input sm" placeholder="ник или UUID" style={{ width: 260 }} />
              <FilterChip label="онлайн: все" />
            </div>
            <div className="mono" style={{ fontSize: 11, color: 'var(--muted)' }}>
              {loading ? 'загрузка…' : 'сорт: баллы ↓'}
            </div>
          </div>

          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
            <thead>
              <tr style={{ textAlign: 'left', color: 'var(--muted)', fontFamily: 'var(--font-mono)', fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.08em' }}>
                {['#', 'ник', 'uuid', 'баллы', 'регистрация', 'сканов', ''].map(h => (
                  <th key={h} style={{ padding: '10px 14px', borderBottom: '1px solid var(--line)', fontWeight: 500 }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {players.map((p, i) => (
                <tr key={p.id} style={{
                  borderBottom: '1px solid var(--line)',
                  background: 'transparent',
                }}>
                  <td style={{ padding: '10px 14px', fontFamily: 'var(--font-mono)', color: i < 3 ? 'var(--accent)' : 'var(--muted)' }}>
                    {String((page - 1) * perPage + i + 1).padStart(2,'0')}
                  </td>
                  <td style={{ padding: '10px 14px', fontFamily: 'var(--font-mono)', color: 'var(--fg)' }}>{p.nick}</td>
                  <td style={{ padding: '10px 14px', fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--muted)' }}>
                    {p.id ? p.id.slice(0, 8) + '…' : '—'}
                  </td>
                  <td style={{ padding: '10px 14px', fontFamily: 'var(--font-mono)', fontSize: 14, fontWeight: 600, color: 'var(--fg)' }} className="tabular">
                    <span style={{ borderBottom: '1px dashed var(--line-2)', paddingBottom: 2 }}>{p.points ?? 0}</span>
                  </td>
                  <td style={{ padding: '10px 14px', fontFamily: 'var(--font-mono)', color: 'var(--fg-2)' }}>
                    {p.registered_at ? new Date(p.registered_at).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit', second: '2-digit' }) : '—'}
                  </td>
                  <td style={{ padding: '10px 14px', fontFamily: 'var(--font-mono)' }} className="tabular">{p.total_scans ?? 0}</td>
                  <td style={{ padding: '10px 14px', fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--muted)' }}>
                    <span style={{ marginRight: 12, cursor: 'pointer' }} onClick={() => handleAdjust(p.id, p.nick)}>± баллы</span>
                    <span style={{ color: 'var(--accent)', cursor: 'pointer' }} onClick={() => handleDelete(p.id, p.nick)}>удал.</span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>

          {/* pagination */}
          <div style={{ padding: '8px 16px', borderTop: '1px solid var(--line)', display: 'flex', justifyContent: 'space-between', fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--muted)' }}>
            <span>показано {(page - 1) * perPage + 1}–{Math.min(page * perPage, total)} из {total}</span>
            <span>
              <span style={{ cursor: 'pointer', marginRight: 12 }} onClick={() => setPage(p => Math.max(1, p - 1))}>←</span>
              <span style={{ cursor: 'pointer' }} onClick={() => setPage(p => p + 1)}>→</span>
            </span>
          </div>
        </div>
      </div>
    </AdminShell>
  );
}

// ─── Screen 8: Event log ────────────────────────────────────────
function ScreenAdminLog() {
  const [log, setLog] = React.useState([]);
  const [total, setTotal] = React.useState(0);
  const [loading, setLoading] = React.useState(false);
  const [page, setPage] = React.useState(1);
  const perPage = 50;

  const loadLog = React.useCallback(() => {
    setLoading(true);
    adminApi.getLog({ page, per_page: perPage }).then(r => {
      if (r.ok) {
        setLog(r.data.items || []);
        setTotal(r.data.total || 0);
      }
      setLoading(false);
    });
  }, [page]);

  React.useEffect(() => { loadLog(); }, [loadLog]);

  // Format ISO timestamp to HH:MM:SS
  const fmtTime = (iso) => {
    if (!iso) return '—';
    try { return new Date(iso).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit', second: '2-digit' }); }
    catch { return iso; }
  };

  // Format delta as "+N" or "-N"
  const fmtDelta = (d) => {
    if (d == null) return '—';
    return d >= 0 ? `+${d}` : String(d);
  };

  return (
    <AdminShell
      section="log"
      breadcrumb={['Конференция', 'Лог событий']}
      actions={<>
        <span className="mono" style={{ fontSize: 11, color: 'var(--muted)' }}>
          <span className="live-dot" style={{ marginRight: 8, transform: 'translateY(-1px)' }}/>
          stream · sse
        </span>
        <button className="btn ghost sm">Экспорт</button>
      </>}
    >
      <div style={{ padding: 28, display: 'flex', flexDirection: 'column', gap: 16 }}>
        {/* filters */}
        <div style={{ border: '1px solid var(--line)', background: 'var(--bg-2)', padding: '12px 16px', display: 'flex', gap: 16, alignItems: 'center' }}>
          <div className="brak" style={{ fontSize: 11 }}>фильтры</div>
          <Field label="" hint=""><SelectFake value="участник: все" /></Field>
          <Field label="" hint=""><SelectFake value="метка: все" /></Field>
          <Field label="" hint=""><SelectFake value="статус: все" /></Field>
          <input className="input sm" placeholder="поиск по тексту" style={{ width: 220 }} />
          <span style={{ flex: 1 }} />
          <span className="mono" style={{ fontSize: 11, color: 'var(--muted)' }}>
            {loading ? 'загрузка…' : `результатов · ${total}`}
          </span>
        </div>

        <div style={{ border: '1px solid var(--line)' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12, fontFamily: 'var(--font-mono)' }}>
            <thead>
              <tr style={{ textAlign: 'left', color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '0.08em', fontSize: 10, background: 'var(--bg-2)' }}>
                {['время', 'участник', 'tag_id', 'стратегия', 'Δ', 'итог', 'res'].map(h => (
                  <th key={h} style={{ padding: '6px 12px', borderBottom: '1px solid var(--line)', fontWeight: 500 }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {log.map((item, i) => {
                const delta = fmtDelta(item.delta_points);
                const isNeg = item.delta_points != null && item.delta_points < 0;
                const isPos = item.delta_points != null && item.delta_points > 0;
                return (
                  <tr key={i} style={{ borderBottom: '1px solid var(--line)', background: item.result !== 'ok' ? 'rgba(240,180,41,0.04)' : 'transparent' }}>
                    <td style={{ padding: '5px 12px', color: 'var(--muted)' }}>{fmtTime(item.scanned_at)}</td>
                    <td style={{ padding: '5px 12px', color: 'var(--fg)' }}>{item.player_nick || '—'}</td>
                    <td style={{ padding: '5px 12px', color: 'var(--fg-2)' }}>{item.tag_id || '—'}</td>
                    <td style={{ padding: '5px 12px' }}><StrategyChip s={item.strategy || 'fixed'} /></td>
                    <td style={{ padding: '5px 12px', color: isNeg ? 'var(--accent)' : isPos ? 'var(--success)' : 'var(--muted)' }} className="tabular">{delta}</td>
                    <td style={{ padding: '5px 12px', color: 'var(--fg)' }} className="tabular">{item.player_total_after ?? '—'}</td>
                    <td style={{ padding: '5px 12px' }}>
                      <span style={{
                        color: item.result === 'ok' ? 'var(--success)' : item.result === 'locked' ? 'var(--muted)' : 'var(--warn)',
                      }}>{item.result || '—'}</span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>

          {/* pagination */}
          <div style={{ padding: '8px 16px', borderTop: '1px solid var(--line)', display: 'flex', justifyContent: 'space-between', fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--muted)' }}>
            <span>показано {(page - 1) * perPage + 1}–{Math.min(page * perPage, total)} из {total}</span>
            <span>
              <span style={{ cursor: 'pointer', marginRight: 12 }} onClick={() => setPage(p => Math.max(1, p - 1))}>←</span>
              <span style={{ cursor: 'pointer' }} onClick={() => setPage(p => p + 1)}>→</span>
            </span>
          </div>
        </div>
      </div>
    </AdminShell>
  );
}

export {
  AdminShell, AdminSidebar, AdminTopBar, SectionBlock, Field, DateTimeField, DangerBtn, KV,
  ScreenAdminLogin, ScreenAdminGame, ScreenAdminTags, ScreenAdminPlayers, ScreenAdminLog,
  StrategyChip, StatusBadge, FilterChip, FakeQR, SelectFake, Sparkline,
};
