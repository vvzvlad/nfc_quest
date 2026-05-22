import React from 'react';
import { QuestCtx } from '../QuestContext.js';
import { CornerBrackets } from './Player.jsx';
import { connectSocket, api } from '../api.js';

// Hall.jsx — Hall scoreboard (1920x1080 big screen)
// Designed for projection / 50" TV in a hallway. High contrast, no chrome.

function ScreenHallScoreboard() {
  const QUEST = React.useContext(QuestCtx);

  const [players, setPlayers] = React.useState([]);
  const [gameInfo, setGameInfo] = React.useState(null);
  const [stats, setStats] = React.useState({ total_players: 0, total_tags: 0, scans_per_minute: 0 });
  const [timeLeft, setTimeLeft] = React.useState('');
  const [currentTime, setCurrentTime] = React.useState('');
  const [recentScans, setRecentScans] = React.useState([]); // for ticker in footer

  // Initial load on mount
  React.useEffect(() => {
    api.scoreboard().then(r => {
      if (r.ok) {
        setPlayers(r.data.players || []);
        setGameInfo(r.data.game || null);
        setStats(r.data.stats || {});
        if (r.data.recent_scans) setRecentScans(r.data.recent_scans);
      }
    });
  }, []);

  // WebSocket connection for live updates
  React.useEffect(() => {
    const cancel = connectSocket((data) => {
      setPlayers(data.players || []);
      setGameInfo(data.game || null);
      setStats(data.stats || {});
      if (data.recent_scans) setRecentScans(data.recent_scans);
    });
    return cancel;
  }, []);

  // Timer effect: updates current wall clock and countdown from gameInfo
  React.useEffect(() => {
    const tick = () => {
      // Update current wall clock display
      const now = new Date();
      setCurrentTime(now.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit', second: '2-digit' }));
      // Update countdown timer
      if (!gameInfo) return;
      if (gameInfo.status === 'finished') { setTimeLeft(gameInfo.award_message || 'ФИНИШ'); return; }
      const target = gameInfo.status === 'active'
        ? new Date(gameInfo.ends_at).getTime()
        : gameInfo.starts_at ? new Date(gameInfo.starts_at).getTime() : null;
      if (!target) return;
      const diff = Math.max(0, target - Date.now());
      const h = String(Math.floor(diff / 3600000)).padStart(2, '0');
      const m = String(Math.floor((diff % 3600000) / 60000)).padStart(2, '0');
      const s = String(Math.floor((diff % 60000) / 1000)).padStart(2, '0');
      setTimeLeft(`${h}:${m}:${s}`);
    };
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [gameInfo]);

  const left = players.slice(0, 12);
  const right = players.slice(12, 24);

  // Live date string for header
  const liveDateStr = new Date().toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit', year: 'numeric' }).replace(/\//g, ' · ');

  // Build schedule line from gameInfo
  const scheduleLine = gameInfo
    ? [
        gameInfo.starts_at && `старт · ${new Date(gameInfo.starts_at).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' })}`,
        gameInfo.ends_at && `финиш · ${new Date(gameInfo.ends_at).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' })}`,
        gameInfo.status === 'finished' && gameInfo.award_message && `награждение · ${gameInfo.award_message}`,
      ].filter(Boolean).join(' · ')
    : '';

  return (
    <div className="grid-bg" style={{
      width: 1920, height: 1080,
      background: 'var(--bg)',
      color: 'var(--fg)',
      fontFamily: 'var(--font-sans)',
      display: 'grid',
      gridTemplateRows: '88px 1fr 64px',
      position: 'relative',
      overflow: 'hidden',
    }}>
      <CornerBrackets />
      {/* HEADER */}
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        padding: '0 48px',
        borderBottom: '1px solid var(--line)',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
          <span style={{ width: 14, height: 14, background: 'var(--accent)' }} />
          <span style={{ fontFamily: 'var(--font-display)', fontSize: 28, fontWeight: 800, letterSpacing: '-0.02em' }}>{QUEST}</span>
          <span className="mono" style={{ color: 'var(--muted)', fontSize: 14, letterSpacing: '0.1em' }}>NFC · QUEST · v.1</span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 24 }}>
          <span className="mono" style={{ fontSize: 14, color: 'var(--muted)', letterSpacing: '0.1em', textTransform: 'uppercase' }}>
            <span className="live-dot" style={{ marginRight: 10, transform: 'translateY(-1px)' }} /> LIVE
          </span>
          <span className="mono" style={{ fontSize: 14, color: 'var(--muted)', letterSpacing: '0.1em' }}>{liveDateStr}</span>
          <span className="mono tabular" style={{ fontSize: 14, color: 'var(--fg)' }}>{currentTime}</span>
        </div>
      </div>

      {/* BODY */}
      <div style={{ display: 'grid', gridTemplateColumns: '720px 1fr', gap: 0 }}>
        {/* LEFT — timer + podium */}
        <div style={{ padding: '40px 48px', borderRight: '1px solid var(--line)', display: 'flex', flexDirection: 'column', gap: 28 }}>
          <div>
            <div className="brak" style={{ fontSize: 14 }}>до конца квеста</div>
            <div className="tabular display" style={{
              fontSize: 144, lineHeight: 0.85, fontWeight: 800, letterSpacing: '-0.05em',
              color: 'var(--fg)', marginTop: 8, whiteSpace: 'nowrap',
            }}>
              {timeLeft
                ? /^\d{2}:\d{2}:\d{2}$/.test(timeLeft)
                  ? <>
                      {timeLeft.slice(0, 2)}
                      <span style={{ color: 'var(--muted-2)', padding: '0 0.04em' }}>:</span>
                      {timeLeft.slice(3, 5)}
                      <span style={{ color: 'var(--muted-2)', padding: '0 0.04em' }}>:</span>
                      <span style={{ color: 'var(--accent)' }}>{timeLeft.slice(6)}</span>
                    </>
                  : (() => {
                      // Adaptive font size for award_message or other non-timer text
                      const msgFontSize = timeLeft.length <= 15 ? 96 : timeLeft.length <= 30 ? 64 : timeLeft.length <= 50 ? 44 : 32;
                      return (
                        <span style={{
                          color: 'var(--accent)',
                          fontSize: msgFontSize,
                          whiteSpace: 'normal',
                          lineHeight: 1.1,
                          wordBreak: 'break-word',
                        }}>{timeLeft}</span>
                      );
                    })()
                : <span style={{ color: 'var(--muted-2)' }}>--:--:--</span>
              }
            </div>
            <div className="mono" style={{ fontSize: 13, color: 'var(--muted)', marginTop: 14, letterSpacing: '0.1em' }}>
              {scheduleLine || 'загрузка…'}
            </div>
          </div>

          <div className="hr" />

          {/* podium */}
          <div>
            <div className="brak" style={{ fontSize: 14, marginBottom: 14 }}>топ · 3</div>
            <Podium items={players.slice(0, 3)} />
          </div>

          <div className="hr" />

          {/* stats */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 12 }}>
            <Stat label="участников" value={String(stats.total_players ?? 0)} />
            <Stat label="меток в игре" value={String(stats.total_tags ?? 0)} />
            <Stat label="сканов / мин" value={String(stats.scans_per_minute ?? 0)} />
          </div>
        </div>

        {/* RIGHT — full leaderboard */}
        <div style={{ padding: '32px 40px' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 18 }}>
            <div className="brak" style={{ fontSize: 14 }}>таблица лидеров</div>
            <div className="mono" style={{ fontSize: 12, color: 'var(--muted)', letterSpacing: '0.1em' }}>обновление · ~ 2 сек</div>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 0 }}>
            <div>
              {left.map((entry, i) => (
                <HallRow
                  key={entry.nick ?? i}
                  place={i + 1}
                  name={entry.nick}
                  score={entry.points}
                />
              ))}
            </div>
            <div style={{ marginLeft: 24 }}>
              {right.map((entry, i) => (
                <HallRow
                  key={entry.nick ?? i}
                  place={i + 13}
                  name={entry.nick}
                  score={entry.points}
                />
              ))}
            </div>
          </div>
          {/* promo HTML block — shown below leaderboard when configured in admin panel */}
          {gameInfo?.promo_html && (
            <>
              <div className="hr" style={{ margin: '16px 0' }} />
              <div
                dangerouslySetInnerHTML={{ __html: gameInfo.promo_html }}
                style={{ fontSize: 13, color: 'var(--fg-2)', lineHeight: 1.6 }}
              />
            </>
          )}
        </div>
      </div>

      {/* FOOTER ticker */}
      <div style={{
        display: 'flex', alignItems: 'center',
        padding: '0 48px', borderTop: '1px solid var(--line)',
        gap: 32, overflow: 'hidden',
        fontFamily: 'var(--font-mono)', fontSize: 14, color: 'var(--fg-2)',
      }}>
        <span style={{ color: 'var(--accent)', fontWeight: 600, letterSpacing: '0.1em' }}>· LOG ·</span>
        {recentScans.length === 0
          ? <span style={{ color: 'var(--muted)' }}>ожидание событий…</span>
          : recentScans.map((scan, i) => (
              <React.Fragment key={i}>
                {i > 0 && <span style={{ color: 'var(--muted-2)' }}>·</span>}
                <span>
                  <b style={{ color: 'var(--fg)' }}>{scan.nick}</b>
                  {' '}
                  <span style={{ color: scan.delta >= 0 ? 'var(--success)' : 'var(--accent)' }}>
                    {scan.delta >= 0 ? '+' : ''}{scan.delta}
                  </span>
                </span>
              </React.Fragment>
            ))
        }
        <span style={{ color: 'var(--muted)' }}>{window.location.host}</span>
      </div>
    </div>
  );
}

function Podium({ items }) {
  return (
    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 12, alignItems: 'end' }}>
      {/* 2nd */}
      <PodiumCol place={2} {...rowOf(items[1])} medal="var(--silver)" h={160} />
      {/* 1st */}
      <PodiumCol place={1} {...rowOf(items[0])} medal="var(--gold)" h={200} />
      {/* 3rd */}
      <PodiumCol place={3} {...rowOf(items[2])} medal="var(--bronze)" h={130} />
    </div>
  );
}

// Convert API player object {nick, points} to {name, score} for PodiumCol
function rowOf(entry) { return { name: entry?.nick ?? '—', score: entry?.points ?? 0 }; }

function PodiumCol({ place, name, score, medal, h }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'stretch', gap: 8 }}>
      <div style={{
        fontFamily: 'var(--font-mono)', fontSize: 13, color: medal, letterSpacing: '0.1em',
      }}>{String(place).padStart(2, '0')}</div>
      <div style={{
        background: 'var(--bg-2)',
        border: '1px solid var(--line)',
        borderTop: `2px solid ${medal}`,
        padding: '12px 14px',
        display: 'flex', flexDirection: 'column', justifyContent: 'flex-end',
        height: h,
      }}>
        <div className="tabular" style={{
          fontFamily: 'var(--font-display)', fontSize: 56, lineHeight: 1, fontWeight: 800, letterSpacing: '-0.03em', color: 'var(--fg)',
        }}>{score}</div>
        <div style={{
          fontFamily: 'var(--font-mono)', fontSize: 14, color: 'var(--fg-2)', marginTop: 6,
          overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
        }}>{name}</div>
      </div>
    </div>
  );
}

function Stat({ label, value }) {
  return (
    <div style={{ padding: '10px 14px', background: 'var(--bg-2)', border: '1px solid var(--line)' }}>
      <div className="mono" style={{ fontSize: 11, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '0.1em' }}>{label}</div>
      <div className="tabular" style={{ fontFamily: 'var(--font-display)', fontSize: 32, fontWeight: 700, color: 'var(--fg)', letterSpacing: '-0.03em' }}>{value}</div>
    </div>
  );
}

function HallRow({ place, name, score }) {
  const medal = place === 1 ? 'var(--gold)' : place <= 4 ? 'var(--silver)' : place <= 15 ? 'var(--bronze)' : null;
  return (
    <div style={{
      display: 'grid', gridTemplateColumns: '40px 1fr auto',
      alignItems: 'center', padding: '7px 6px',
      borderBottom: '1px solid var(--line)',
    }}>
      <div className="mono" style={{ fontSize: 13, color: medal ?? 'var(--muted)', fontWeight: 700 }}>{String(place).padStart(2,'0')}</div>
      <div style={{
        fontFamily: 'var(--font-mono)', fontSize: 15, color: 'var(--fg-2)',
        overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', minWidth: 0,
      }}>{name}</div>
      <div className="tabular" style={{ fontFamily: 'var(--font-mono)', fontSize: 18, fontWeight: 700, color: 'var(--fg)' }}>{score}</div>
    </div>
  );
}

export {
  ScreenHallScoreboard, Podium, HallRow, Stat,
};
