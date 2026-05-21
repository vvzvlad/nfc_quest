import React from 'react';
import { useNavigate } from 'react-router-dom';
import { QuestCtx } from '../QuestContext.js';
import { CornerBrackets } from './Player.jsx';
import { Stat } from './Hall.jsx';
import { adminApi } from '../api.js';
import { getErrorMessage } from '../i18n.js';

// Admin.jsx — Admin panel (5 screens)
// Linear/Notion-density: persistent sidebar + dense content.

function downloadCSV(filename, headers, rows) {
  const escape = (v) => {
    const s = String(v ?? '');
    return s.includes(',') || s.includes('"') || s.includes('\n') ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const csv = [headers.map(escape).join(','), ...rows.map(r => r.map(escape).join(','))].join('\n');
  const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = filename; a.click();
  URL.revokeObjectURL(url);
}

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
        <AdminTopBar breadcrumb={breadcrumb || [{ label: title }]} actions={actions} />
        <div style={{ overflow: 'auto' }}>
          {children}
        </div>
      </div>
    </div>
  );
}

function AdminSidebar({ active }) {
  const QUEST = React.useContext(QuestCtx);
  const navigate = useNavigate();
  const [stats, setStats] = React.useState({});
  const [game, setGame] = React.useState({});
  // Countdown timer tick (seconds) to force re-render each second
  const [tick, setTick] = React.useState(0);

  // Load stats and game settings on mount, then refresh every 5s
  React.useEffect(() => {
    const load = () => {
      adminApi.getStats().then(r => { if (r.ok) setStats(r.data); });
      adminApi.getGame().then(r => { if (r.ok) setGame(r.data); });
    };
    load();
    const id = setInterval(load, 5000);
    return () => clearInterval(id);
  }, []);

  // Countdown ticker: re-render every second for live timer display
  React.useEffect(() => {
    const id = setInterval(() => setTick(t => t + 1), 1000);
    return () => clearInterval(id);
  }, []);

  const sections = [
    { id: 'game',    label: 'Управление игрой' },
    { id: 'tags',    label: 'Метки',            meta: stats.total_tags != null ? String(stats.total_tags) : undefined },
    { id: 'players', label: 'Участники',        meta: stats.total_players != null ? String(stats.total_players) : undefined },
    { id: 'log',     label: 'Лог событий',      meta: stats.total_scans != null ? String(stats.total_scans) : undefined },
  ];

  // Compute game status from timestamps (same logic as ScreenAdminGame)
  const now = Date.now();
  const startsAt = game.starts_at ? new Date(game.starts_at).getTime() : null;
  const endsAt = game.ends_at ? new Date(game.ends_at).getTime() : null;
  let gameStatusLabel = 'НЕ НАЧАТА';
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

      <div className="brak" style={{ padding: '6px 8px' }}>квест</div>

      {sections.map(s => (
        <div key={s.id}
          onClick={() => navigate(`/FRuihf7Y/${s.id}`)}
          style={{
          display: 'grid', gridTemplateColumns: '1fr auto', alignItems: 'center', gap: 8,
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
          <span>admin</span>
          <span onClick={() => adminApi.logout().then(() => { window.location.href = '/FRuihf7Y/login'; })} style={{ cursor: 'pointer' }}>выход</span>
        </div>
      </div>
    </div>
  );
}

function AdminTopBar({ breadcrumb, actions }) {
  const navigate = useNavigate();
  const [hoveredIdx, setHoveredIdx] = React.useState(null);
  return (
    <div style={{
      display: 'flex', alignItems: 'center', justifyContent: 'space-between',
      padding: '0 24px', borderBottom: '1px solid var(--line)',
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontFamily: 'var(--font-mono)', fontSize: 12, color: 'var(--muted)', letterSpacing: '0.08em' }}>
        {breadcrumb.map((b, i) => {
          const isLast = i === breadcrumb.length - 1;
          const isHovered = hoveredIdx === i;
          // Clickable only for non-last items that have a `to` path; last item is always plain text
          const clickable = !isLast && !!b.to;
          return (
            <React.Fragment key={i}>
              {i > 0 && <span style={{ color: 'var(--muted-2)' }}>/</span>}
              <span
                style={{
                  color: isLast ? 'var(--fg)' : isHovered ? 'var(--fg)' : 'var(--muted)',
                  textTransform: 'uppercase',
                  cursor: clickable ? 'pointer' : 'default',
                }}
                onClick={clickable ? () => navigate(b.to) : undefined}
                onMouseEnter={clickable ? () => setHoveredIdx(i) : undefined}
                onMouseLeave={clickable ? () => setHoveredIdx(null) : undefined}
              >
                {b.label}
              </span>
            </React.Fragment>
          );
        })}
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
  const navigate = useNavigate();
  const [password, setPassword] = React.useState('');
  const [error, setError] = React.useState(null);
  const [loading, setLoading] = React.useState(false);

  const handleLogin = async () => {
    setLoading(true);
    setError(null);
    const res = await adminApi.login(password);
    if (res.ok) {
      navigate('/FRuihf7Y');
    } else {
      setError(getErrorMessage(res.data?.error, 'Неверный пароль'));
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

// ─── Datetime helpers for UTC↔local conversion ──────────────────
// Backend stores datetimes in UTC naive format; browser datetime-local inputs
// operate in the user's local timezone. These helpers convert between them.

// Convert a UTC ISO string (e.g. "2026-05-16T03:45:00Z") to a value
// suitable for <input type="datetime-local"> (local time, no timezone).
function utcToLocalInput(utcStr) {
  if (!utcStr) return '';
  const d = new Date(utcStr.endsWith('Z') ? utcStr : utcStr + 'Z');
  // Format as "YYYY-MM-DDTHH:MM" in local time
  const pad = n => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

// Convert a datetime-local input value (local time) to a UTC ISO string
// that the backend will interpret correctly.
function localInputToUtc(localStr) {
  if (!localStr) return null;
  return new Date(localStr).toISOString();
}

// ─── Screen 5: Game management ──────────────────────────────────
function ScreenAdminGame() {
  const [settings, setSettings] = React.useState({});
  const [stats, setStats] = React.useState({});
  const [loading, setLoading] = React.useState(false);
  const [saved, setSaved] = React.useState(false);

  // Load game settings and stats on mount only; updates happen after explicit user actions
  React.useEffect(() => {
    adminApi.getGame().then(r => { if (r.ok) setSettings(r.data); });
    adminApi.getStats().then(r => { if (r.ok) setStats(r.data); });
  }, []);

  // Reload settings from server (called after Save / Start / Stop actions)
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
    if (!window.confirm(`Удалить всех участников (${stats.total_players ?? 0})? Это действие необратимо.`)) return;
    await adminApi.deleteAllPlayers();
    await reloadStats();
  };

  const handleDeleteAllTags = async () => {
    if (!window.confirm(`Удалить все метки (${stats.total_tags ?? 0})? Это действие необратимо.`)) return;
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
      breadcrumb={[{ label: 'квест', to: '/FRuihf7Y' }, { label: 'Управление игрой' }]}
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
              <Field label="начало игры">
                <input
                  className="input"
                  type="datetime-local"
                  value={settings.starts_at ? utcToLocalInput(settings.starts_at) : ''}
                  onChange={e => setSettings(s => ({ ...s, starts_at: e.target.value ? localInputToUtc(e.target.value) : null }))}
                />
              </Field>
              <Field label="конец игры">
                <input
                  className="input"
                  type="datetime-local"
                  value={settings.ends_at ? utcToLocalInput(settings.ends_at) : ''}
                  onChange={e => setSettings(s => ({ ...s, ends_at: e.target.value ? localInputToUtc(e.target.value) : null }))}
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
              <DangerBtn label="Запустить игру сейчас" sub="откроет окно сканирования всем" onClick={handleStartGame} disabled={gameStatus === 'АКТИВНА'} />
              <DangerBtn label="Остановить игру" sub="закроет сканирование, табло остаётся" danger onClick={handleStopGame} disabled={gameStatus !== 'АКТИВНА'} />
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
              <div><span style={{ color: 'var(--warn)'    }}>WS</span>  /socket.io</div>
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

function DangerBtn({ label, sub, danger, onClick, disabled }) {
  return (
    <div
      style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        gap: 12, padding: '14px 16px',
        border: '1px solid ' + (danger ? 'var(--accent)' : 'var(--line-2)'),
        cursor: disabled ? 'not-allowed' : 'pointer',
        opacity: disabled ? 0.4 : 1,
      }}
      onClick={disabled ? undefined : onClick}
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

// Returns true if the given strategy name uses range params (min/max) instead of single points
function isRangeStrategy(strategyName, strategies) {
  const found = strategies.find(s => s.name === strategyName);
  if (found) return found.params_type === 'range';
  return strategyName === 'random'; // fallback while loading
}

// Strip tag_id suffix from label if present (e.g. "hall · ED7A-B422" → "hall")
const stripIdSuffix = (label, id) => {
  if (!label) return '—';
  if (!id) return label; // guard against undefined/null id from API
  const suffix = ' · ' + id;
  if (label.endsWith(suffix)) return label.slice(0, -suffix.length).trim() || '—';
  return label;
};

// ─── Screen 6: Tags (dense table view) ─────────────────────────
function ScreenAdminTags() {
  const navigate = useNavigate();
  const [tags, setTags] = React.useState([]);
  const [total, setTotal] = React.useState(0);
  const [loading, setLoading] = React.useState(false);
  const [page, setPage] = React.useState(1);
  const [search, setSearch] = React.useState('');
  const [debouncedSearch, setDebouncedSearch] = React.useState('');
  const [selectedTag, setSelectedTag] = React.useState(null);
  const [exportingTags, setExportingTags] = React.useState(false);
  const [selectedIds, setSelectedIds] = React.useState(new Set()); // selected tag IDs (persists across pages)
  const [bulkEditOpen, setBulkEditOpen] = React.useState(false);   // whether bulk edit panel is shown
  const perPage = 50;
  const requestIdRef = React.useRef(0);

  React.useEffect(() => {
    const id = setTimeout(() => setDebouncedSearch(search), 300);
    return () => clearTimeout(id);
  }, [search]);

  const loadTags = React.useCallback(() => {
    setLoading(true);
    const reqId = ++requestIdRef.current;
    const params = { page, per_page: perPage };
    if (debouncedSearch.trim()) params.search = debouncedSearch.trim();
    adminApi.getTags(params).then(r => {
      if (reqId !== requestIdRef.current) return;
      if (r.ok) {
        setTags(r.data.items || []);
        setTotal(r.data.total || 0);
      }
      setLoading(false);
    });
  }, [page, debouncedSearch]);

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
    if (selectedTag?.id === id) setSelectedTag(null);
    loadTags();
  };

  return (
    <AdminShell
      section="tags"
      breadcrumb={[{ label: 'квест', to: '/FRuihf7Y' }, { label: 'Метки' }]}
      actions={<>
        <button className="btn ghost sm" disabled={exportingTags} onClick={() => {
          setExportingTags(true);
          adminApi.getTags({ page: 1, per_page: 9999 }).then(r => {
            if (r.ok) {
              const items = r.data.items || [];
              downloadCSV('tags.csv',
                ['tag_id', 'label', 'strategy', 'params', 'scans', 'unique_players'],
                items.map(t => {
                  const sp = t.strategy_params || {};
                  const params = t.strategy === 'random' ? `${sp.min}…${sp.max}` : String(sp.points ?? '');
                  return [t.id, t.label || '', t.strategy, params, t.scan_count ?? 0, t.unique_players_count ?? 0];
                })
              );
            }
          }).finally(() => setExportingTags(false)); // reset flag even on network error
        }}>{exportingTags ? 'Экспорт…' : 'Экспорт CSV'}</button>
        <button className="btn sm" onClick={() => navigate('/FRuihf7Y/tags/create')}>+ массовое создание</button>
      </>}
    >
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 320px', height: '100%' }}>
        {/* main */}
        <div style={{ overflow: 'auto', display: 'flex', flexDirection: 'column' }}>
          {/* filter bar */}
          <div style={{ padding: '10px 24px', borderBottom: '1px solid var(--line)', display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
            <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
              <div className="brak" style={{ fontSize: 11 }}>все метки · {total}</div>
              <input className="input sm" placeholder="tag_id или label" style={{ width: 220 }}
                value={search} onChange={e => { setSearch(e.target.value); setPage(1); }} />
            </div>
            <div className="mono" style={{ fontSize: 11, color: 'var(--muted)', whiteSpace: 'nowrap' }}>
              {loading ? 'загрузка…' : `${tags.length} из ${total}`}
            </div>
          </div>

          {/* bulk action bar — visible only when at least one tag is selected */}
          {selectedIds.size > 0 && (
            <div style={{
              padding: '8px 24px',
              borderBottom: '1px solid var(--line)',
              background: 'rgba(240,180,41,0.06)',
              display: 'flex', alignItems: 'center', gap: 12,
            }}>
              <span className="mono" style={{ fontSize: 11, color: 'var(--fg)' }}>
                выбрано · {selectedIds.size}
              </span>
              <span style={{ flex: 1 }} />
              <button className="btn ghost sm" onClick={() => { setSelectedIds(new Set()); setBulkEditOpen(false); }}>
                снять выделение
              </button>
              <button className="btn ghost sm" onClick={() => setBulkEditOpen(true)}>
                изменить стратегию / параметры
              </button>
              <button
                className="btn sm"
                style={{ borderColor: 'var(--accent)', color: 'var(--accent)', background: 'transparent' }}
                onClick={async () => {
                  if (!window.confirm(`Удалить ${selectedIds.size} меток? Это действие необратимо.`)) return;
                  const res = await adminApi.bulkDeleteTags({ ids: [...selectedIds] });
                  if (!res.ok) {
                    window.alert(res.data?.error || 'Ошибка удаления');
                    return;
                  }
                  setSelectedIds(new Set());
                  setBulkEditOpen(false);
                  loadTags();
                }}
              >
                удалить выбранные
              </button>
            </div>
          )}

          {/* dense table */}
          <table style={{ width: '100%', minWidth: 700, borderCollapse: 'collapse', fontSize: 12, fontFamily: 'var(--font-sans)' }}>
            <thead>
              <tr style={{ textAlign: 'left', color: 'var(--muted)', fontFamily: 'var(--font-mono)', fontSize: 10, textTransform: 'uppercase', letterSpacing: '0.08em', background: 'var(--bg-2)' }}>
                {/* checkbox column header — selects/deselects all tags on current page */}
                <th style={{ padding: '6px 12px', borderBottom: '1px solid var(--line)', width: 40 }}>
                  <input
                    type="checkbox"
                    style={{ cursor: 'pointer', accentColor: 'var(--accent)' }}
                    checked={tags.length > 0 && tags.every(t => selectedIds.has(t.id))}
                    onChange={e => {
                      if (e.target.checked) {
                        setSelectedIds(prev => new Set([...prev, ...tags.map(t => t.id)]));
                      } else {
                        setSelectedIds(prev => {
                          const next = new Set(prev);
                          tags.forEach(t => next.delete(t.id));
                          return next;
                        });
                      }
                    }}
                  />
                </th>
                {[
                  ['tag_id', 110],
                  ['label', null],
                  ['url', null],
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
                const fmtPts = (v) => { const n = Number(v); return isNaN(n) ? '?' : (n > 0 ? `+${n}` : String(n)); };
                const params = t.strategy === 'random' ? `${sp.min ?? sp.min_points ?? '?'}…${sp.max ?? sp.max_points ?? '?'}`
                  : t.strategy === 'oneshot' || t.strategy === 'one_time_global' ? fmtPts(sp.points)
                  : t.strategy === 'one_time_per_player' || t.strategy === 'bonus_penalty' ? fmtPts(sp.points)
                  : '—';
                return (
                  <tr key={t.id}
                    onClick={() => setSelectedTag(t)}
                    style={{
                    borderBottom: '1px solid var(--line)',
                    background: selectedTag && selectedTag.id === t.id ? 'var(--bg-2)' : i === 0 && !selectedTag ? 'var(--bg-2)' : 'transparent',
                    cursor: 'pointer',
                  }}>
                    {/* per-row checkbox — stopPropagation prevents opening TagDetailPanel */}
                    <td style={{ padding: '5px 12px' }} onClick={e => e.stopPropagation()}>
                      <input
                        type="checkbox"
                        style={{ cursor: 'pointer', accentColor: 'var(--accent)' }}
                        checked={selectedIds.has(t.id)}
                        onChange={() => {
                          setSelectedIds(prev => {
                            const next = new Set(prev);
                            if (next.has(t.id)) next.delete(t.id);
                            else next.add(t.id);
                            return next;
                          });
                        }}
                      />
                    </td>
                    <td style={{ padding: '5px 12px', fontFamily: 'var(--font-mono)', fontSize: 12, color: 'var(--fg)' }}>{t.id}</td>
                    <td style={{ padding: '5px 12px', color: 'var(--fg-2)' }}>{stripIdSuffix(t.label, t.id)}</td>
                    <td style={{ padding: '5px 12px', fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--fg-2)' }}>
                      {`${window.location.origin}/tag/${t.id}`}
                    </td>
                    <td style={{ padding: '5px 12px' }}><StrategyChip s={t.strategy} /></td>
                    <td style={{ padding: '5px 12px', fontFamily: 'var(--font-mono)', color: 'var(--fg)' }} className="tabular">{params}</td>
                    <td style={{ padding: '5px 12px', fontFamily: 'var(--font-mono)' }} className="tabular">{t.scan_count ?? 0}</td>
                    <td style={{ padding: '5px 12px', fontFamily: 'var(--font-mono)' }} className="tabular">{t.unique_players_count ?? 0}</td>
                    <td style={{ padding: '5px 12px' }}><StatusBadge s={t.is_blocked ? 'used' : 'active'} /></td>
                    <td style={{ padding: '5px 12px', fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--muted)', textAlign: 'right' }}>
                      <span style={{ color: 'var(--accent)', cursor: 'pointer' }} onClick={(e) => { e.stopPropagation(); handleDelete(t.id); }}>удал.</span>
                    </td>
                  </tr>
                );
              })}
              {!loading && tags.length === 0 && (
                <tr>
                  <td colSpan={10} style={{ padding: '40px', textAlign: 'center', fontFamily: 'var(--font-mono)', fontSize: 13, color: 'var(--muted)' }}>
                    {debouncedSearch ? 'Метки не найдены по запросу' : 'Метки не созданы. Нажмите «+ массовое создание».'}
                  </td>
                </tr>
              )}
            </tbody>
          </table>

          {/* pagination footer */}
          <div style={{ padding: '8px 24px', borderTop: '1px solid var(--line)', display: 'flex', justifyContent: 'space-between', fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--muted)' }}>
            <span>показано {total === 0 ? 0 : (page - 1) * perPage + 1}–{Math.min(page * perPage, total)} из {total}</span>
            <span>
              <span style={{ cursor: page <= 1 ? 'default' : 'pointer', opacity: page <= 1 ? 0.3 : 1, marginRight: 12 }} onClick={() => { if (page > 1) setPage(p => p - 1); }}>←</span>
              <span style={{ cursor: page * perPage >= total ? 'default' : 'pointer', opacity: page * perPage >= total ? 0.3 : 1 }} onClick={() => { if (page * perPage < total) setPage(p => p + 1); }}>→</span>
            </span>
          </div>
        </div>

        {/* side — bulk edit panel or tag detail/edit panel */}
        {bulkEditOpen ? (
          <BulkEditPanel
            selectedCount={selectedIds.size}
            selectedIds={[...selectedIds]}
            onClose={() => setBulkEditOpen(false)}
            onSaved={() => { setBulkEditOpen(false); setSelectedIds(new Set()); loadTags(); }}
          />
        ) : (
          <TagDetailPanel
            tag={selectedTag}
            onClose={() => setSelectedTag(null)}
            onDelete={async (id) => { await handleDelete(id); }}
            onSaved={(updatedTag) => { setSelectedTag(updatedTag); loadTags(); }}
          />
        )}

      </div>
    </AdminShell>
  );
}

function TagDetailPanel({ tag, onClose, onDelete, onSaved }) {
  const [strategies, setStrategies] = React.useState([]);
  const [editing, setEditing] = React.useState(false);
  const [editStrategy, setEditStrategy] = React.useState('');
  const [editParams, setEditParams] = React.useState('');
  const [editLabel, setEditLabel] = React.useState('');
  const [saving, setSaving] = React.useState(false);
  const [editTagId, setEditTagId] = React.useState('');
  const [saveError, setSaveError] = React.useState(null);

  // Load available strategies from backend on mount
  React.useEffect(() => {
    adminApi.getStrategies().then(r => { if (r.ok) setStrategies(r.data.strategies || []); });
  }, []);

  // Use module-level isRangeStrategy helper (accepts strategy name + loaded strategies list)
  const isRange = (name) => isRangeStrategy(name, strategies);

  React.useEffect(() => {
    if (tag) {
      setEditing(false);
      setEditStrategy(tag.strategy || '');
      setEditLabel(tag.label || '');
      setEditTagId(tag.id || '');
      setSaveError(null);
      const sp = tag.strategy_params || {};
      if (isRangeStrategy(tag.strategy, strategies)) {
        setEditParams(JSON.stringify({ min: sp.min ?? 0, max: sp.max ?? 0 }));
      } else {
        setEditParams(String(sp.points ?? 0));
      }
    }
  }, [tag?.id]);

  const handleSave = async () => {
    setSaving(true);
    setSaveError(null);
    let strategy_params;
    if (isRange(editStrategy)) {
      try { strategy_params = JSON.parse(editParams); } catch { strategy_params = { min: 0, max: 0 }; }
    } else {
      strategy_params = { points: parseInt(editParams) || 0 };
    }
    // Validate tag_id field is not empty before saving
    if (!editTagId.trim()) {
      setSaveError('tag_id не может быть пустым');
      setSaving(false);
      return;
    }
    const payload = {
      strategy: editStrategy,
      strategy_params,
      label: editLabel || null,
    };
    // Include new_id only if it has changed
    if (editTagId !== tag.id) {
      payload.new_id = editTagId;
    }
    const res = await adminApi.updateTag(tag.id, payload);
    setSaving(false);
    if (res.ok) {
      setSaveError(null);
      setEditing(false);
      onSaved(res.data);
    } else {
      // Show backend error code to the user
      const errMap = {
        'INVALID_TAG_ID_FORMAT': 'Неверный формат tag_id (ожидается XXXX-XXXX, hex)',
        'TAG_ID_ALREADY_EXISTS': 'Метка с таким tag_id уже существует',
        'TAG_NOT_FOUND': 'Метка не найдена',
      };
      setSaveError(errMap[res.data?.error] || res.data?.error || 'Ошибка сохранения');
    }
  };

  if (!tag) {
    return (
      <div style={{ borderLeft: '1px solid var(--line)', background: 'var(--bg-2)', padding: 20, display: 'flex', flexDirection: 'column', gap: 18, overflow: 'auto' }}>
        <div className="brak" style={{ fontSize: 11 }}>выбрано · —</div>
        <div>
          <div className="mono" style={{ fontSize: 11, color: 'var(--muted)', letterSpacing: '0.08em', textTransform: 'uppercase' }}>label</div>
          <div style={{ fontFamily: 'var(--font-display)', fontSize: 20, fontWeight: 700, marginTop: 4, letterSpacing: '-0.02em', color: 'var(--muted)' }}>нажмите на метку</div>
        </div>
      </div>
    );
  }

  const sp = tag.strategy_params || {};
  const paramsDisplay = (() => {
    const fmtPts = (v) => { const n = Number(v); return isNaN(n) ? '?' : (n > 0 ? `+${n}` : String(n)); };
    if (tag.strategy === 'random') return `${sp.min ?? '?'}…${sp.max ?? '?'}`;
    if (tag.strategy === 'oneshot' || tag.strategy === 'one_time_global') return fmtPts(sp.points);
    if (tag.strategy === 'one_time_per_player') return fmtPts(sp.points);
    if (tag.strategy === 'bonus_penalty') return fmtPts(sp.points);
    return JSON.stringify(sp);
  })();

  return (
    <div style={{ borderLeft: '1px solid var(--line)', background: 'var(--bg-2)', padding: 20, display: 'flex', flexDirection: 'column', gap: 18, overflow: 'auto' }}>
      {/* header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div className="brak" style={{ fontSize: 11 }}>[ выбрано · {tag.id} ]</div>
        <span className="mono" style={{ fontSize: 10, color: 'var(--muted)', cursor: 'pointer' }} onClick={onClose}>✕</span>
      </div>

      {editing ? (
        <>
          {/* edit mode */}
          <Field label="tag_id" hint="формат: XXXX-XXXX (hex)">
            <input
              className="input"
              value={editTagId}
              onChange={e => setEditTagId(e.target.value.toUpperCase())}
              placeholder="XXXX-XXXX"
              style={{ fontFamily: 'var(--font-mono)' }}
            />
          </Field>
          <Field label="label">
            <input className="input" value={editLabel} onChange={e => setEditLabel(e.target.value)} placeholder="название метки" />
          </Field>
          <Field label="стратегия">
            <select
              className="input"
              value={editStrategy}
              onChange={e => setEditStrategy(e.target.value)}
              disabled={strategies.length === 0}
              style={{ fontFamily: 'var(--font-mono)', fontSize: 13 }}
            >
              {strategies.length === 0
                ? <option value="">loading…</option>
                : strategies.map(s => (
                    <option key={s.name} value={s.name}>{s.name}</option>
                  ))
              }
            </select>
          </Field>
          <Field label={isRange(editStrategy) ? 'параметры (JSON: {"min": N, "max": M})' : 'баллы'}>
            <input className="input" value={editParams} onChange={e => setEditParams(e.target.value)} />
          </Field>

          {saveError && (
            <div className="mono" style={{ fontSize: 11, color: 'var(--accent)', display: 'flex', alignItems: 'center', gap: 6 }}>
              <span style={{ width: 6, height: 6, background: 'var(--accent)', flexShrink: 0 }} />
              {saveError}
            </div>
          )}

          <div style={{ display: 'flex', gap: 8 }}>
            <button className="btn ghost sm" style={{ flex: 1 }} onClick={() => setEditing(false)}>Отмена</button>
            <button className="btn sm" style={{ flex: 1 }} onClick={handleSave} disabled={saving}>
              {saving ? 'Сохраняем…' : 'Сохранить'}
            </button>
          </div>
        </>
      ) : (
        <>
          {/* view mode */}
          <div>
            <div className="mono" style={{ fontSize: 11, color: 'var(--muted)', letterSpacing: '0.08em', textTransform: 'uppercase' }}>label</div>
            <div style={{ fontFamily: 'var(--font-display)', fontSize: 20, fontWeight: 700, marginTop: 4, letterSpacing: '-0.02em' }}>
              {tag.label || '—'}
            </div>
          </div>

          <div>
            <div className="brak" style={{ fontSize: 11, marginBottom: 4 }}>url</div>
            <div className="mono" style={{ fontSize: 11, color: 'var(--fg-2)', wordBreak: 'break-all' }}>
              {window.location.origin}/tag/{tag.id}
            </div>
          </div>

          <KVList items={[
            ['стратегия', tag.strategy || '—'],
            ['параметры', paramsDisplay],
            ['сканов', tag.scan_count ?? 0],
            ['уникальных', tag.unique_players_count ?? 0],
            ['создана', tag.created_at ? new Date(tag.created_at).toLocaleString('ru-RU') : '—'],
          ]} />

          {/* actions */}
          <div style={{ marginTop: 'auto' }}>
            <button className="btn ghost sm" style={{ width: '100%', marginBottom: 8 }} onClick={() => setEditing(true)}>Редактировать</button>
            <button
              className="btn sm"
              style={{ width: '100%', background: 'transparent', borderColor: 'var(--accent)', color: 'var(--accent)' }}
              onClick={() => onDelete(tag.id)}
            >Удалить</button>
          </div>
        </>
      )}
    </div>
  );
}

function BulkEditPanel({ selectedCount, selectedIds, onClose, onSaved }) {
  const [strategies, setStrategies] = React.useState([]);
  const [editStrategy, setEditStrategy] = React.useState('');
  const [editParams, setEditParams] = React.useState('50');
  const [saving, setSaving] = React.useState(false);
  const [saveError, setSaveError] = React.useState(null);

  // Load available strategies from backend on mount
  React.useEffect(() => {
    adminApi.getStrategies().then(r => {
      if (r.ok) {
        const list = r.data.strategies || [];
        setStrategies(list);
        if (list.length > 0) setEditStrategy(list[0].name);
      }
    });
  }, []);

  // Reset params field when strategy type changes to avoid stale JSON/number mismatch.
  // Guard: skip reset until strategies list is loaded to prevent incorrect fallback.
  React.useEffect(() => {
    if (!editStrategy || strategies.length === 0) return;
    setEditParams(isRangeStrategy(editStrategy, strategies)
      ? JSON.stringify({ min: 0, max: 0 })
      : '50');
  }, [editStrategy, strategies]);

  const isRange = isRangeStrategy(editStrategy, strategies);

  const handleApply = async () => {
    setSaving(true);
    setSaveError(null);
    let strategy_params;
    if (isRange) {
      try { strategy_params = JSON.parse(editParams); }
      catch { strategy_params = { min: 0, max: 0 }; }
    } else {
      strategy_params = { points: parseInt(editParams) || 0 };
    }
    const res = await adminApi.bulkUpdateTags({
      ids: selectedIds,
      strategy: editStrategy,
      strategy_params,
    });
    setSaving(false);
    if (res.ok) {
      setSaveError(null);
      onSaved();
    } else {
      setSaveError(res.data?.error || 'Ошибка сохранения');
    }
  };

  return (
    <div style={{ borderLeft: '1px solid var(--line)', background: 'var(--bg-2)', padding: 20, display: 'flex', flexDirection: 'column', gap: 18, overflow: 'auto' }}>
      {/* header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div className="brak" style={{ fontSize: 11 }}>[ групповое изменение · {selectedCount} меток ]</div>
        <span className="mono" style={{ fontSize: 10, color: 'var(--muted)', cursor: 'pointer' }} onClick={onClose}>✕</span>
      </div>

      <Field label="стратегия">
        <select
          className="input"
          value={editStrategy}
          onChange={e => setEditStrategy(e.target.value)}
          disabled={strategies.length === 0}
          style={{ fontFamily: 'var(--font-mono)', fontSize: 13 }}
        >
          {strategies.length === 0
            ? <option value="">loading…</option>
            : strategies.map(s => <option key={s.name} value={s.name}>{s.name}</option>)
          }
        </select>
      </Field>

      <Field label={isRange ? 'параметры (JSON: {"min": N, "max": M})' : 'баллы'}>
        <input className="input" value={editParams} onChange={e => setEditParams(e.target.value)} />
      </Field>

      {saveError && (
        <div className="mono" style={{ fontSize: 11, color: 'var(--accent)', display: 'flex', alignItems: 'center', gap: 6 }}>
          <span style={{ width: 6, height: 6, background: 'var(--accent)', flexShrink: 0 }} />
          {saveError}
        </div>
      )}

      <div style={{ marginTop: 'auto', display: 'flex', gap: 8 }}>
        <button className="btn ghost sm" style={{ flex: 1 }} onClick={onClose}>Отмена</button>
        <button className="btn sm" style={{ flex: 1 }} onClick={handleApply} disabled={saving || strategies.length === 0}>
          {saving ? 'Сохраняем…' : `Применить к ${selectedCount}`}
        </button>
      </div>
    </div>
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
function ScreenAdminTagsCreate() {
  const navigate = useNavigate();
  const [strategies, setStrategies] = React.useState([]);
  const [strategy, setStrategy] = React.useState('one_time_per_player');
  const [points, setPoints] = React.useState('50');
  const [minPoints, setMinPoints] = React.useState('0');
  const [labelPrefix, setLabelPrefix] = React.useState('hall · ');
  const [count, setCount] = React.useState('12');
  const [created, setCreated] = React.useState(null); // array of {id, url}
  const [loading, setLoading] = React.useState(false);

  // Load available strategies from backend on mount
  React.useEffect(() => {
    adminApi.getStrategies().then(r => { if (r.ok) setStrategies(r.data.strategies || []); });
  }, []);

  // Determine if the currently selected strategy uses range params (min/max)
  const currentStrategyMeta = strategies.find(s => s.name === strategy);
  const isRange = currentStrategyMeta?.params_type === 'range';

  const handleCreate = async () => {
    setLoading(true);
    const strategyParams = isRange
      ? { min: parseInt(minPoints) || 0, max: parseInt(points) || 50 }
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
      breadcrumb={[{ label: 'квест', to: '/FRuihf7Y' }, { label: 'Метки', to: '/FRuihf7Y/tags' }, { label: 'Создание' }]}
      actions={<>
        <button className="btn ghost sm" onClick={() => navigate('/FRuihf7Y/tags')}>← Назад к таблице</button>
        {!created && <button className="btn sm" onClick={handleCreate} disabled={loading}>{loading ? 'Создаём…' : '+ создать'}</button>}
      </>}
    >
      <div style={{ display: 'grid', gridTemplateColumns: '420px 1fr', height: '100%' }}>
        {/* left — form */}
        <div style={{ borderRight: '1px solid var(--line)', padding: 24, display: 'flex', flexDirection: 'column', gap: 20, overflow: 'auto' }}>
          <div>
            <div className="brak" style={{ fontSize: 11 }}>массовое создание</div>
            <h2 style={{ fontFamily: 'var(--font-display)', fontSize: 28, fontWeight: 700, letterSpacing: '-0.02em', margin: '8px 0 4px' }}>Создать метки</h2>
            <p style={{ color: 'var(--muted)', fontSize: 13, margin: 0, maxWidth: 360 }}>Сгенерируйте URL и запишите их на NFC через любое приложение для записи (например NFC Tools).</p>
          </div>
          <div className="hr" />
          <Field label="стратегия">
            <select
              className="input"
              value={strategy}
              onChange={e => setStrategy(e.target.value)}
              disabled={strategies.length === 0}
              style={{ fontFamily: 'var(--font-mono)', fontSize: 13 }}
            >
              {strategies.length === 0
                ? <option value="">loading…</option>
                : strategies.map(s => (
                    <option key={s.name} value={s.name}>{s.name} · {s.description}</option>
                  ))
              }
            </select>
          </Field>
          {isRange ? (
            <>
              <Field label="мин. баллы">
                <input className="input tabular" value={minPoints} onChange={e => setMinPoints(e.target.value)} />
              </Field>
              <Field label="макс. баллы">
                <input className="input tabular" value={points} onChange={e => setPoints(e.target.value)} />
              </Field>
            </>
          ) : (
            <Field label="баллы">
              <input className="input" value={points} onChange={e => setPoints(e.target.value)} />
            </Field>
          )}
          <Field label="префикс label">
            <input className="input" value={labelPrefix} onChange={e => setLabelPrefix(e.target.value)} placeholder="например: zal-A · " />
          </Field>
          <Field label="количество" hint="макс 200 за раз">
            <input className="input tabular" value={count} onChange={e => setCount(e.target.value)} />
          </Field>
          <div className="hr" />
          <div className="mono" style={{ fontSize: 11, color: 'var(--muted)', lineHeight: 1.6 }}>
            available strategies:<br/>
            {strategies.map(s => (
              <React.Fragment key={s.name}>· {s.name} — {s.description}<br/></React.Fragment>
            ))}
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
                  <button className="btn ghost sm" onClick={() => {
                    const text = created.map(item => item.url).join('\n');
                    navigator.clipboard?.writeText(text);
                  }}>скопировать все</button>
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
                        <span style={{ cursor: 'pointer' }} onClick={() => navigator.clipboard?.writeText(item.url)}>скопировать</span>
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
    one_time_global:     { c: 'var(--success)', l: 'one_time_global' },
    one_time_per_player: { c: 'var(--info)',    l: 'per_player'      },
    random:              { c: 'var(--warn)',    l: 'random'          },
    oneshot:             { c: 'var(--success)', l: 'oneshot'         },
    bonus_penalty:       { c: 'var(--accent)',  l: 'bonus_penalty'   },
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
  return <span className="mono" style={{ fontSize: 11, color: m.c, letterSpacing: '0.06em', whiteSpace: 'nowrap' }}>{m.l}</span>;
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
  const [search, setSearch] = React.useState('');
  const [debouncedSearch, setDebouncedSearch] = React.useState('');
  const [exportingPlayers, setExportingPlayers] = React.useState(false);
  const [globalStats, setGlobalStats] = React.useState(null);
  // Sort field: 'points' (default) or 'last_seen'
  const [sortBy, setSortBy] = React.useState('points');
  const perPage = 50;
  const requestIdRef = React.useRef(0);

  React.useEffect(() => {
    const id = setTimeout(() => setDebouncedSearch(search), 300);
    return () => clearTimeout(id);
  }, [search]);

  const loadPlayers = React.useCallback(() => {
    setLoading(true);
    const reqId = ++requestIdRef.current;
    const params = { page, per_page: perPage };
    if (debouncedSearch.trim()) params.search = debouncedSearch.trim();
    if (sortBy === 'last_seen') params.sort_by = 'last_seen';
    adminApi.getPlayers(params).then(r => {
      if (reqId !== requestIdRef.current) return;
      if (r.ok) {
        setPlayers(r.data.items || []);
        setTotal(r.data.total || 0);
      }
      setLoading(false);
    });
  }, [page, debouncedSearch, sortBy]);

  React.useEffect(() => { loadPlayers(); }, [loadPlayers]);

  const reloadStats = React.useCallback(() => {
    adminApi.getStats()
      .then(r => { if (r.ok) setGlobalStats(r.data); })
      .catch(() => {});
  }, []);

  React.useEffect(() => { reloadStats(); }, [reloadStats]);

  const handleAdjust = async (id, nick) => {
    const raw = window.prompt(`Изменить баллы для ${nick} (положительное или отрицательное число):`);
    if (raw === null) return;
    const delta = parseInt(raw);
    if (isNaN(delta)) return;
    await adminApi.adjustPlayer(id, delta);
    loadPlayers();
    reloadStats();
  };

  const handleDelete = async (id, nick) => {
    if (!window.confirm(`Удалить участника ${nick}?`)) return;
    await adminApi.deletePlayer(id);
    loadPlayers();
    reloadStats();
  };

  return (
    <AdminShell
      section="players"
      breadcrumb={[{ label: 'квест', to: '/FRuihf7Y' }, { label: 'Участники' }]}
      actions={<>
        <button className="btn ghost sm" disabled={exportingPlayers} onClick={() => {
          setExportingPlayers(true);
          adminApi.getPlayers({ page: 1, per_page: 9999 }).then(r => {
            if (r.ok) {
              const items = r.data.items || [];
              downloadCSV('players.csv',
                ['nick', 'uuid', 'points', 'scans', 'registered_at'],
                items.map(p => [p.nick, p.id, p.points ?? 0, p.scan_count ?? 0, p.registered_at || ''])
              );
            }
          }).finally(() => setExportingPlayers(false)); // reset flag even on network error
        }}>{exportingPlayers ? 'Экспорт…' : 'Экспорт CSV'}</button>
      </>}
    >
      <div style={{ padding: 28, display: 'flex', flexDirection: 'column', gap: 16 }}>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 12 }}>
          <Stat label="всего" value={String(total)} />
          <Stat label="на странице" value={String(players.length)} />
          <Stat label="макс баллов" value={String(globalStats?.max_score?.points ?? '—')} />
          <Stat label="ср. баллов" value={String(globalStats?.avg_score ?? '—')} />
        </div>

        <div style={{ border: '1px solid var(--line)' }}>
          <div style={{ padding: '10px 16px', borderBottom: '1px solid var(--line)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <div style={{ display: 'flex', gap: 16, alignItems: 'center' }}>
              <div className="brak" style={{ fontSize: 11 }}>участники</div>
              <input className="input sm" placeholder="ник или UUID" style={{ width: 260 }}
                value={search} onChange={e => { setSearch(e.target.value); setPage(1); }} />
            </div>
            <span
              className="mono"
              style={{ fontSize: 11, color: 'var(--muted)', cursor: 'pointer' }}
              onClick={() => setSortBy(s => s === 'points' ? 'last_seen' : 'points')}
            >
              {loading ? 'загрузка…' : `сорт: ${sortBy === 'points' ? 'баллы ↓' : 'активность ↓'} ⇄`}
            </span>
          </div>

          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
            <thead>
              <tr style={{ textAlign: 'left', color: 'var(--muted)', fontFamily: 'var(--font-mono)', fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.08em' }}>
                {['#', 'ник', 'uuid', 'баллы', 'регистрация', 'сканов', 'последняя активность', ''].map(h => (
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
                  <td style={{ padding: '10px 14px', fontFamily: 'var(--font-mono)', color: 'var(--fg)', maxWidth: 200, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{p.nick}</td>
                  <td style={{ padding: '10px 14px', fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--muted)' }}>
                    {p.id ? p.id.slice(0, 8) + '…' : '—'}
                  </td>
                  <td style={{ padding: '10px 14px', fontFamily: 'var(--font-mono)', fontSize: 14, fontWeight: 600, color: 'var(--fg)' }} className="tabular">
                    <span style={{ borderBottom: '1px dashed var(--line-2)', paddingBottom: 2 }}>{p.points ?? 0}</span>
                  </td>
                  <td style={{ padding: '10px 14px', fontFamily: 'var(--font-mono)', color: 'var(--fg-2)' }}>
                    {p.registered_at ? new Date(p.registered_at).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit', second: '2-digit' }) : '—'}
                  </td>
                  <td style={{ padding: '10px 14px', fontFamily: 'var(--font-mono)' }} className="tabular">{p.scan_count ?? 0}</td>
                  <td style={{ padding: '10px 14px', fontFamily: 'var(--font-mono)', color: 'var(--fg-2)' }}>
                    {p.last_seen ? new Date(p.last_seen).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit', second: '2-digit' }) : '—'}
                  </td>
                  <td style={{ padding: '10px 14px', fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--muted)' }}>
                    <span style={{ marginRight: 12, cursor: 'pointer' }} onClick={() => handleAdjust(p.id, p.nick)}>± баллы</span>
                    <span style={{ color: 'var(--accent)', cursor: 'pointer' }} onClick={() => handleDelete(p.id, p.nick)}>удал.</span>
                  </td>
                </tr>
              ))}
              {!loading && players.length === 0 && (
                <tr>
                  <td colSpan={8} style={{ padding: '40px', textAlign: 'center', fontFamily: 'var(--font-mono)', fontSize: 13, color: 'var(--muted)' }}>
                    {debouncedSearch ? 'Участники не найдены по запросу' : 'Участников ещё нет'}
                  </td>
                </tr>
              )}
            </tbody>
          </table>

          {/* pagination */}
          <div style={{ padding: '8px 16px', borderTop: '1px solid var(--line)', display: 'flex', justifyContent: 'space-between', fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--muted)' }}>
            <span>показано {total === 0 ? 0 : (page - 1) * perPage + 1}–{Math.min(page * perPage, total)} из {total}</span>
            <span>
              <span style={{ cursor: page <= 1 ? 'default' : 'pointer', opacity: page <= 1 ? 0.3 : 1, marginRight: 12 }} onClick={() => { if (page > 1) setPage(p => p - 1); }}>←</span>
              <span style={{ cursor: page * perPage >= total ? 'default' : 'pointer', opacity: page * perPage >= total ? 0.3 : 1 }} onClick={() => { if (page * perPage < total) setPage(p => p + 1); }}>→</span>
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
      breadcrumb={[{ label: 'квест', to: '/FRuihf7Y' }, { label: 'Лог событий' }]}
      actions={<>
        <span className="mono" style={{ fontSize: 11, color: 'var(--muted)' }}>
          <span className="live-dot" style={{ marginRight: 8, transform: 'translateY(-1px)' }}/>
          stream · sse
        </span>
      </>}
    >
      <div style={{ padding: 28, display: 'flex', flexDirection: 'column', gap: 16 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div className="brak" style={{ fontSize: 11 }}>лог событий</div>
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
                    <td style={{ padding: '5px 12px' }}><StrategyChip s={item.strategy || '—'} /></td>
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
              {!loading && log.length === 0 && (
                <tr>
                  <td colSpan={7} style={{ padding: '40px', textAlign: 'center', fontFamily: 'var(--font-mono)', fontSize: 13, color: 'var(--muted)' }}>
                    Событий ещё нет
                  </td>
                </tr>
              )}
            </tbody>
          </table>

          {/* pagination */}
          <div style={{ padding: '8px 16px', borderTop: '1px solid var(--line)', display: 'flex', justifyContent: 'space-between', fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--muted)' }}>
            <span>показано {total === 0 ? 0 : (page - 1) * perPage + 1}–{Math.min(page * perPage, total)} из {total}</span>
            <span>
              <span style={{ cursor: page <= 1 ? 'default' : 'pointer', opacity: page <= 1 ? 0.3 : 1, marginRight: 12 }} onClick={() => { if (page > 1) setPage(p => p - 1); }}>←</span>
              <span style={{ cursor: page * perPage >= total ? 'default' : 'pointer', opacity: page * perPage >= total ? 0.3 : 1 }} onClick={() => { if (page * perPage < total) setPage(p => p + 1); }}>→</span>
            </span>
          </div>
        </div>
      </div>
    </AdminShell>
  );
}

export {
  AdminShell, AdminSidebar, AdminTopBar, SectionBlock, Field, DateTimeField, DangerBtn, KV,
  ScreenAdminLogin, ScreenAdminGame, ScreenAdminTags, ScreenAdminTagsCreate, ScreenAdminPlayers, ScreenAdminLog,
  StrategyChip, StatusBadge, FilterChip, FakeQR, SelectFake, Sparkline,
};
