import React from 'react';
import { QuestCtx } from '../QuestContext.js';
import { connectSocket, disconnectSocket, getLocalPlayer, api } from '../api.js';

// screens/Player.jsx — Player flow (mobile)
// Registration → Scan result (7 states) → Mobile scoreboard
// Canon direction: bracketed mono titles, big numerals, ИБ-конференц-эстетика.

// ─── Shared phone header (quest title bar) ─────────────────────
function QuestHeader({ user, score, simple = false }) {
  const QUEST = React.useContext(QuestCtx);
  return (
    <div style={{
      display: 'flex', alignItems: 'center', justifyContent: 'space-between',
      padding: '14px 20px 12px',
      borderBottom: '1px solid var(--line)',
      fontFamily: 'var(--font-mono)', fontSize: 11,
      color: 'var(--muted)', letterSpacing: '0.08em',
      textTransform: 'uppercase',
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <span style={{ width: 6, height: 6, background: 'var(--accent)', display: 'inline-block' }} />
        <span style={{ color: 'var(--fg)', fontWeight: 600 }}>{QUEST}</span>
        <span>v.1</span>
      </div>
      {!simple && user && (
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 6 }}>
          <span>{user}</span>
          <span style={{ color: 'var(--muted-2)' }}>/</span>
          <span className="tabular" style={{ color: 'var(--fg)', fontWeight: 600 }}>{score}</span>
        </div>
      )}
    </div>
  );
}

function QuestFooter({ children }) {
  return (
    <div style={{
      padding: '12px 20px 24px',
      borderTop: '1px solid var(--line)',
      display: 'flex', flexDirection: 'column', gap: 10,
    }}>
      {children}
    </div>
  );
}

// ─── Screen 1: Registration ─────────────────────────────────────
// Props:
//   onRegister(nick) — called when the user submits the nick form
//   error           — string shown in red below the input, or null
//   tagId           — current tag ID shown in footer hint
function ScreenRegistration({ onRegister, error, tagId }) {
  const [nick, setNick] = React.useState('');

  const handleSubmit = () => {
    const trimmed = nick.trim();
    if (trimmed && onRegister) onRegister(trimmed);
  };

  const handleKeyDown = (e) => {
    if (e.key === 'Enter') handleSubmit();
  };

  return (
    <div style={{ height: '100%', display: 'flex', flexDirection: 'column', background: 'var(--bg)' }}>
      <QuestHeader simple />
      <div style={{ flex: 1, padding: '40px 24px 24px', display: 'flex', flexDirection: 'column' }}>
        <div className="brak" style={{ marginBottom: 12 }}>00 · регистрация</div>
        <h1 style={{
          fontFamily: 'var(--font-display)',
          fontSize: 38, lineHeight: 1.05, fontWeight: 700,
          letterSpacing: '-0.03em',
          margin: '0 0 16px',
          color: 'var(--fg)',
        }}>
          Добро<br/>пожаловать<br/>
          <span style={{ color: 'var(--accent)' }}>в квест.</span>
        </h1>
        <p style={{
          color: 'var(--muted)', fontSize: 14, lineHeight: 1.5,
          margin: '0 0 28px', maxWidth: 280,
        }}>
          Сканируйте метки по холлу — копите баллы. Свою стартовую можно отсканировать только один раз.
        </p>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          <label className="brak">никнейм</label>
          <input
            className="input"
            value={nick}
            onChange={e => setNick(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="напр. r00t_kit"
          />
          {/* Show error message in accent color when provided */}
          {error && (
            <div style={{ fontSize: 13, color: 'var(--accent)', marginTop: 4, lineHeight: 1.4 }}>
              {error}
            </div>
          )}
        </div>

        <div style={{ marginTop: 24, padding: 12, border: '1px dashed var(--line-2)', display: 'flex', gap: 12 }}>
          <div style={{
            width: 28, height: 28, flexShrink: 0,
            border: '1px solid var(--accent)', color: 'var(--accent)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            fontFamily: 'var(--font-mono)', fontSize: 14,
          }}>i</div>
          <div style={{ fontSize: 12, color: 'var(--muted)', lineHeight: 1.5 }}>
            Ник будет виден в таблице лидеров. Привязка к устройству — UUID хранится локально.
          </div>
        </div>
      </div>
      <QuestFooter>
        <button className="btn" onClick={handleSubmit}>Начать игру →</button>
        <div className="mono" style={{ fontSize: 10, color: 'var(--muted-2)', textAlign: 'center', letterSpacing: '0.1em', textTransform: 'uppercase' }}>
          {tagId ? `tag · ${tagId.toLowerCase()} / first scan` : 'tag · ??? / first scan'}
        </div>
      </QuestFooter>
    </div>
  );
}

// ─── Scan result base layout (with integrated leaderboard) ─────
// Each scan state shares this layout: compact result band on top,
// then a 5-row slice of the leaderboard centered on the player.
// `boardSlice` is an array of [place, name, score, opts?] where
// opts can include {mine, delta, prevPlace}.

function ScanResultLayout({
  user, score, tagId, strategy, tone = 'accent',
  hero, sub, meta, scanLabel = 'scan · ok', wideHero = false,
  boardTimerLabel = 'до конца', boardTimer = '02:13:08',
  boardSlice, boardEmpty,
}) {
  const tones = {
    plus:    { color: 'var(--success)' },
    minus:   { color: 'var(--accent)' },
    neutral: { color: 'var(--fg)' },
    info:    { color: 'var(--info)' },
    warn:    { color: 'var(--warn)' },
  };
  return (
    <div style={{ height: '100%', display: 'flex', flexDirection: 'column', background: 'var(--bg)' }}>
      <QuestHeader user={user} score={score} />

      {/* ── RESULT BAND ───────────────────────────────────────── */}
      <div style={{
        position: 'relative',
        padding: '16px 20px 18px',
        borderBottom: '1px solid var(--line)',
      }}>
        <CornerBrackets />
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div className="brak" style={{ fontSize: 10 }}>{scanLabel}</div>
          <div className="tag-chip mono">{tagId}</div>
        </div>

        {wideHero ? (
          <div style={{ marginTop: 10 }}>
            <div style={{
              fontFamily: 'var(--font-display)',
              fontWeight: 800, letterSpacing: '-0.05em',
              ...tones[tone],
              fontVariantNumeric: 'tabular-nums',
            }}>{hero}</div>
            <div style={{
              fontFamily: 'var(--font-sans)', fontSize: 14,
              color: 'var(--fg-2)', lineHeight: 1.4, marginTop: 10,
            }}>{sub}</div>
            {strategy && (
              <div className="mono" style={{
                fontSize: 10, color: 'var(--muted)', letterSpacing: '0.08em',
                textTransform: 'uppercase', marginTop: 6,
              }}>{strategy}</div>
            )}
            {meta && (
              <div className="mono tabular" style={{
                fontSize: 11, color: 'var(--fg-2)', marginTop: 6, lineHeight: 1.6,
              }}>{meta}</div>
            )}
          </div>
        ) : (
          <div style={{
            display: 'grid',
            gridTemplateColumns: 'auto 1fr',
            alignItems: 'center',
            gap: 18,
            marginTop: 10,
          }}>
            <div style={{
              fontFamily: 'var(--font-display)',
              fontSize: 88, lineHeight: 0.85, fontWeight: 800,
              letterSpacing: '-0.05em',
              ...tones[tone],
              fontVariantNumeric: 'tabular-nums',
            }}>{hero}</div>
            <div style={{ minWidth: 0 }}>
              <div style={{
                fontFamily: 'var(--font-sans)', fontSize: 15,
                color: 'var(--fg-2)', lineHeight: 1.35,
              }}>{sub}</div>
              {strategy && (
                <div className="mono" style={{
                  fontSize: 10, color: 'var(--muted)', letterSpacing: '0.08em',
                  textTransform: 'uppercase', marginTop: 6,
                }}>{strategy}</div>
              )}
              {meta && (
                <div className="mono tabular" style={{
                  fontSize: 11, color: 'var(--fg-2)', marginTop: 6, lineHeight: 1.6,
                }}>{meta}</div>
              )}
            </div>
          </div>
        )}
      </div>

      {/* ── BOARD PREVIEW ─────────────────────────────────────── */}
      <div style={{ flex: 1, overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
        <div style={{
          display: 'flex', justifyContent: 'space-between', alignItems: 'center',
          padding: '12px 20px 8px',
        }}>
          <div className="mono" style={{ fontSize: 10, color: 'var(--muted)', letterSpacing: '0.1em', textTransform: 'uppercase' }}>
            <span className="live-dot" style={{ marginRight: 6, transform: 'translateY(-1px)' }} />
            live · табло
          </div>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
            <span className="mono" style={{ fontSize: 10, color: 'var(--muted)', letterSpacing: '0.1em', textTransform: 'uppercase' }}>{boardTimerLabel}</span>
            <span className="mono tabular" style={{ fontSize: 16, fontWeight: 600, color: 'var(--fg)', letterSpacing: '-0.02em' }}>{boardTimer}</span>
          </div>
        </div>
        <div style={{ flex: 1, overflow: 'auto', padding: '0 16px' }}>
          {boardEmpty
            ? <BoardEmptyHint message={boardEmpty} />
            : (boardSlice ?? []).map(([place, name, scoreVal, opts]) => (
                <BoardSliceRow key={name + place}
                  place={place} name={name} score={scoreVal}
                  mine={opts?.mine} delta={opts?.delta} prevPlace={opts?.prevPlace} dim={opts?.dim} />
              ))
          }
        </div>
      </div>

      <QuestFooter>
        <button className="btn ghost">Полное табло · {QUEST_TOTAL_PLAYERS} участников →</button>
      </QuestFooter>
    </div>
  );
}

const QUEST_TOTAL_PLAYERS = 48;

function BoardSliceRow({ place, name, score, mine, delta, prevPlace, dim }) {
  const medal = place === 1 ? 'var(--gold)' : place === 2 ? 'var(--silver)' : place === 3 ? 'var(--bronze)' : null;
  // place arrow: prevPlace > place = went up (green), prevPlace < place = went down (red)
  let arrow = null;
  if (typeof prevPlace === 'number' && prevPlace !== place) {
    const up = prevPlace > place;
    arrow = (
      <span className="mono" style={{
        fontSize: 9, color: up ? 'var(--success)' : 'var(--accent)',
        letterSpacing: '0.04em',
      }}>{up ? '▲' : '▼'}{Math.abs(prevPlace - place)}</span>
    );
  }
  return (
    <div style={{
      display: 'grid',
      gridTemplateColumns: '28px 1fr auto auto',
      gap: 10, alignItems: 'center',
      padding: '10px 6px',
      borderTop: '1px solid var(--line)',
      background: mine ? 'rgba(230,57,53,0.10)' : 'transparent',
      position: 'relative',
      opacity: dim ? 0.55 : 1,
    }}>
      {mine && <div style={{ position: 'absolute', left: 0, top: 0, bottom: 0, width: 2, background: 'var(--accent)' }} />}
      <div className="mono" style={{
        fontSize: 12, color: medal ?? 'var(--muted)', fontWeight: 700,
      }}>{String(place).padStart(2, '0')}</div>
      <div style={{
        fontFamily: 'var(--font-mono)', fontSize: 13,
        color: mine ? 'var(--fg)' : 'var(--fg-2)',
        fontWeight: mine ? 600 : 400,
        whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
      }}>{name}{mine && <span style={{ color: 'var(--accent)', marginLeft: 4, fontSize: 9 }}>· ВЫ</span>}</div>
      <div style={{ width: 36, textAlign: 'right' }}>
        {delta && (
          <span className="mono tabular" style={{
            fontSize: 11,
            color: String(delta).startsWith('−') || String(delta).startsWith('-') ? 'var(--accent)' : 'var(--success)',
          }}>{delta}</span>
        )}
        {arrow}
      </div>
      <div className="tabular" style={{
        fontFamily: 'var(--font-mono)', fontSize: 15, fontWeight: 600,
        color: 'var(--fg)', minWidth: 38, textAlign: 'right',
      }}>{score}</div>
    </div>
  );
}

function BoardEmptyHint({ message }) {
  return (
    <div style={{
      padding: '40px 16px',
      textAlign: 'center',
      color: 'var(--muted)',
      fontSize: 13,
      borderTop: '1px solid var(--line)',
    }}>
      {message}
    </div>
  );
}

function CornerBrackets() {
  const c = 'var(--muted-2)';
  const s = { position: 'absolute', width: 14, height: 14, borderColor: c, borderStyle: 'solid', borderWidth: 0 };
  return (
    <>
      <div style={{ ...s, top: 16, left: 16,  borderTopWidth: 1, borderLeftWidth: 1 }} />
      <div style={{ ...s, top: 16, right: 16, borderTopWidth: 1, borderRightWidth: 1 }} />
      <div style={{ ...s, bottom: 16, left: 16,  borderBottomWidth: 1, borderLeftWidth: 1 }} />
      <div style={{ ...s, bottom: 16, right: 16, borderBottomWidth: 1, borderRightWidth: 1 }} />
    </>
  );
}

// ─── Static fallback board slice (used when no real data is provided) ────────
function defaultBoardSlice(myNick) {
  return [
    [2, 'phr34k',         760],
    [3, 'captain_pcap',   710],
    [4, myNick || 'r00t_kit', 310, { mine: true }],
    [5, 'sudo_make_love', 265],
    [6, 'kernel_panic',   230],
  ];
}

// ─── Variants of scan-result screen (states) ────────────────────
// Each shares ScanResultLayout and feeds it a leaderboard slice
// centered on the player's row, so the table is right there.

// State: ok (positive delta)
function ScanSuccessPlus({ user, score, tagId, delta, meta, strategyDisplay, boardSlice, boardTimer, boardTimerLabel }) {
  return <ScanResultLayout
    user={user || 'r00t_kit'}
    score={score != null ? score : 310}
    tagId={tagId ? `TAG · ${tagId}` : 'TAG · ???'}
    tone="plus"
    hero={delta != null ? (delta >= 0 ? `+${delta}` : `${delta}`) : '+?'}
    sub={strategyDisplay || 'Спрятанная метка. Лежала под чёрной доской.'}
    strategy={strategyDisplay || 'hidden · fixed +50'}
    meta={meta || ''}
    boardSlice={boardSlice || defaultBoardSlice(user)}
    boardTimer={boardTimer || ''}
    boardTimerLabel={boardTimerLabel || 'до конца'}
  />;
}

// State: ok (negative delta)
function ScanSuccessMinus({ user, score, tagId, delta, meta, strategyDisplay, boardSlice, boardTimer, boardTimerLabel }) {
  return <ScanResultLayout
    user={user || 'r00t_kit'}
    score={score != null ? score : 210}
    tagId={tagId ? `TAG · ${tagId}` : 'TAG · ???'}
    tone="minus"
    hero={delta != null ? String(delta) : '-?'}
    sub={strategyDisplay || 'Эта метка отнимает баллы. Не повезло.'}
    strategy={strategyDisplay || 'ловушка · penalty −30'}
    meta={meta || ''}
    boardSlice={boardSlice || defaultBoardSlice(user)}
    boardTimer={boardTimer || ''}
    boardTimerLabel={boardTimerLabel || 'до конца'}
  />;
}

// State: locked (tag already used)
function ScanLocked({ user, score, tagId, boardSlice, boardTimer, boardTimerLabel }) {
  return (
    <ScanResultLayout
      user={user || 'r00t_kit'}
      score={score != null ? score : 310}
      tagId={tagId ? `TAG · ${tagId}` : 'TAG · ???'}
      tone="neutral"
      scanLabel="scan · locked"
      hero={<IconLock />}
      sub="Эта метка уже использована."
      strategy="oneshot · стартовая"
      boardSlice={boardSlice || defaultBoardSlice(user)}
      boardTimer={boardTimer || ''}
      boardTimerLabel={boardTimerLabel || 'до конца'}
    />
  );
}

// State: quest not started yet (countdown)
// startsAt — ISO string of when the quest begins
// registeredCount — number of registered players so far
function ScanNotYet({ user, score, tagId, boardSlice, boardTimer, boardTimerLabel, startsAt, registeredCount }) {
  // Build a human-readable start time hint
  let startHint = 'Сканирование откроется — участников уже зарегистрированы.';
  if (startsAt || registeredCount != null) {
    const timeStr = startsAt
      ? new Date(startsAt).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' })
      : null;
    const countStr = registeredCount != null ? `${registeredCount} участников` : '';
    startHint = [
      timeStr ? `Сканирование откроется в ${timeStr}` : 'Сканирование откроется позже',
      countStr ? `${countStr} уже зарегистрированы.` : '',
    ].filter(Boolean).join(' — ');
  }

  return (
    <ScanResultLayout
      user={user || 'r00t_kit'}
      score={score != null ? score : 0}
      tagId={tagId ? `TAG · ${tagId}` : 'TAG · ???'}
      tone="info"
      scanLabel="quest · pending"
      wideHero
      hero={<CountdownBig />}
      sub="Квест ещё не начался. Регистрация уже открыта."
      strategy="ожидание · старт через"
      boardTimerLabel={boardTimerLabel || 'до старта'}
      boardTimer={boardTimer || ''}
      boardEmpty={startHint}
    />
  );
}

function CountdownBig() {
  return (
    <div style={{
      display: 'flex', alignItems: 'baseline', gap: 4,
      fontSize: 84, lineHeight: 0.85, fontFamily: 'var(--font-display)',
      fontWeight: 800, letterSpacing: '-0.04em', whiteSpace: 'nowrap',
    }}>
      <span>00</span><Sep />
      <span>12</span><Sep />
      <span>47</span>
    </div>
  );
}
function Sep() { return <span style={{ color: 'var(--muted-2)' }}>:</span>; }

// State: quest finished
// awardMessage — string with award ceremony info
function ScanFinished({ user, score, tagId, boardSlice, boardTimer, boardTimerLabel, awardMessage }) {
  return (
    <ScanResultLayout
      user={user || 'r00t_kit'}
      score={score != null ? score : 310}
      tagId={tagId ? `TAG · ${tagId}` : 'TAG · ???'}
      tone="neutral"
      scanLabel="quest · finished"
      hero={<span style={{ fontSize: 68, letterSpacing: '-0.05em' }}>FIN</span>}
      sub={awardMessage || 'Квест завершён. Награждение в 18:00, главный зал.'}
      strategy="итоговые результаты"
      boardTimerLabel={awardMessage ? 'награждение' : (boardTimerLabel || 'награждение')}
      boardTimer={boardTimer || '18:00'}
      boardSlice={boardSlice || defaultBoardSlice(user)}
    />
  );
}

// State: unknown tag
function ScanUnknown({ user, score, tagId, boardSlice, boardTimer, boardTimerLabel }) {
  return (
    <ScanResultLayout
      user={user || 'r00t_kit'}
      score={score != null ? score : 310}
      tagId={tagId ? `TAG · ${tagId}` : 'TAG · ????-???'}
      tone="warn"
      scanLabel="scan · error"
      hero="404"
      sub="Метка не найдена в базе квеста."
      strategy="неизвестный tag_id"
      meta="возможно метка из другой игры"
      boardSlice={boardSlice || defaultBoardSlice(user)}
      boardTimer={boardTimer || ''}
      boardTimerLabel={boardTimerLabel || 'до конца'}
    />
  );
}

// State: rate-limited
function ScanRateLimit({ user, score, tagId, boardSlice, boardTimer, boardTimerLabel }) {
  return (
    <ScanResultLayout
      user={user || 'r00t_kit'}
      score={score != null ? score : 310}
      tagId={tagId ? `TAG · ${tagId}` : 'TAG · ???'}
      tone="warn"
      scanLabel="scan · throttled"
      hero={<span style={{ fontSize: 62, letterSpacing: '-0.04em' }}>WAIT</span>}
      sub="Подождите секунду и попробуйте снова."
      strategy="rate limit · 1 скан / сек"
      meta="retry в течение ~ 0.6 сек"
      boardSlice={boardSlice || defaultBoardSlice(user)}
      boardTimer={boardTimer || ''}
      boardTimerLabel={boardTimerLabel || 'до конца'}
    />
  );
}

// Icon: lock
function IconLock() {
  return (
    <svg width="116" height="116" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="0.8" style={{ display: 'inline-block', color: 'var(--fg)' }}>
      <rect x="5" y="10" width="14" height="11" />
      <path d="M8 10V7a4 4 0 018 0v3" />
    </svg>
  );
}

// ─── Screen 3: Mobile scoreboard ────────────────────────────────
// Props:
//   initialData — optional object from api.scoreboard() with { players, game }
//
// Connects to WebSocket for live updates; disconnects on unmount.
// Identifies "my" row by comparing nick with getLocalPlayer()?.nick.
// Counts down to ends_at (active) or starts_at (not_started) game states.

function ScreenScoreboardMobile({ initialData }) {
  const myNick = getLocalPlayer()?.nick || null;
  const myScore = getLocalPlayer()?.points ?? 0;

  // scoreboard: array of { nick, points, rank } from backend
  const [scoreboard, setScoreboard] = React.useState(
    initialData?.players ?? []
  );
  // gameInfo: { status, starts_at, ends_at, award_message }
  const [gameInfo, setGameInfo] = React.useState(
    initialData?.game ?? null
  );
  // Countdown timer string
  const [timeLeft, setTimeLeft] = React.useState('');

  // Fetch initial scoreboard data if not provided via props
  React.useEffect(() => {
    if (!initialData) {
      api.scoreboard().then(({ ok, data }) => {
        if (ok && data) {
          if (data.players) setScoreboard(data.players);
          if (data.game) setGameInfo(data.game);
        }
      }).catch(() => {});
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Connect WebSocket for live scoreboard updates
  React.useEffect(() => {
    connectSocket((update) => {
      // update expected shape: { players, game }
      if (update?.players) setScoreboard(update.players);
      if (update?.game) setGameInfo(update.game);
    });
    return () => disconnectSocket();
  }, []);

  // Client-side countdown timer tick
  React.useEffect(() => {
    const tick = () => {
      if (!gameInfo) return;
      const now = Date.now();
      const target = gameInfo.status === 'active'
        ? new Date(gameInfo.ends_at).getTime()
        : gameInfo.status === 'not_started'
        ? new Date(gameInfo.starts_at).getTime()
        : null;
      if (!target) { setTimeLeft(gameInfo.award_message || ''); return; }
      const diff = Math.max(0, target - now);
      const h = Math.floor(diff / 3600000);
      const m = Math.floor((diff % 3600000) / 60000);
      const s = Math.floor((diff % 60000) / 1000);
      setTimeLeft(`${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`);
    };
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [gameInfo]);

  // Determine timer label based on game status
  const timerLabel = gameInfo?.status === 'not_started'
    ? 'до старта'
    : gameInfo?.status === 'finished'
    ? 'награждение'
    : 'до конца';

  return (
    <div style={{ height: '100%', display: 'flex', flexDirection: 'column', background: 'var(--bg)' }}>
      <QuestHeader user={myNick} score={myScore} />
      <div style={{ flex: 1, overflow: 'auto', padding: '20px 20px 0' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 8 }}>
          <div className="brak">live · табло</div>
          <div className="mono" style={{ fontSize: 10, color: 'var(--muted)', letterSpacing: '0.1em' }}>
            <span className="live-dot" style={{ marginRight: 6, transform: 'translateY(-1px)' }} />
            обновляется
          </div>
        </div>
        <div style={{ marginBottom: 16 }}>
          <div className="mono" style={{ fontSize: 10, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '0.1em' }}>{timerLabel}</div>
          <div className="tabular" style={{
            fontFamily: 'var(--font-display)',
            fontSize: 56, lineHeight: 1, fontWeight: 700, letterSpacing: '-0.04em',
            color: 'var(--fg)',
          }}>{timeLeft || '—'}</div>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 0 }}>
          {scoreboard.map((entry, i) => {
            // Backend may return { nick, score, place } or array — handle both shapes
            const name  = entry.nick  ?? entry[0];
            const pts   = entry.points ?? entry.score ?? entry[1];
            const place = entry.place ?? (i + 1);
            const isMine = myNick && name === myNick;
            return (
              <BoardRow key={name} place={place} name={name} score={pts} mine={isMine} />
            );
          })}
        </div>
        <div style={{ height: 20 }} />
      </div>
    </div>
  );
}

function BoardRow({ place, name, score, mine }) {
  const medal = place === 1 ? 'var(--gold)' : place === 2 ? 'var(--silver)' : place === 3 ? 'var(--bronze)' : null;
  return (
    <div style={{
      display: 'grid',
      gridTemplateColumns: '36px 1fr auto',
      alignItems: 'center',
      padding: '12px 8px',
      borderTop: '1px solid var(--line)',
      background: mine ? 'rgba(230,57,53,0.08)' : 'transparent',
      position: 'relative',
    }}>
      {mine && <div style={{ position: 'absolute', left: 0, top: 0, bottom: 0, width: 2, background: 'var(--accent)' }} />}
      <div className="mono" style={{
        fontSize: 13, color: medal ?? 'var(--muted)', fontWeight: 700,
      }}>{String(place).padStart(2, '0')}</div>
      <div style={{
        fontFamily: 'var(--font-mono)', fontSize: 14,
        color: mine ? 'var(--fg)' : 'var(--fg-2)',
        fontWeight: mine ? 600 : 400,
      }}>{name}{mine && <span style={{ color: 'var(--accent)', marginLeft: 6, fontSize: 10 }}>· вы</span>}</div>
      <div className="tabular" style={{
        fontFamily: 'var(--font-mono)', fontSize: 16, fontWeight: 600,
        color: 'var(--fg)',
      }}>{score}</div>
    </div>
  );
}

export {
  QuestHeader, QuestFooter, CornerBrackets,
  ScanResultLayout, BoardRow, BoardSliceRow,
  ScreenRegistration,
  ScanSuccessPlus, ScanSuccessMinus, ScanLocked, ScanNotYet, ScanFinished, ScanUnknown, ScanRateLimit,
  ScreenScoreboardMobile,
};
