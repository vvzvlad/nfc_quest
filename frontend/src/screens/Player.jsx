import React from 'react';
import { useNavigate } from 'react-router-dom';
import { QuestCtx } from '../QuestContext.js';
import { connectSocket, disconnectSocket, getLocalPlayer, api } from '../api.js';
import { getErrorMessage } from '../i18n.js';

// screens/Player.jsx — Player flow (mobile)
// Registration → Scan result (7 states) → Mobile scoreboard
// Canon direction: bracketed mono titles, big numerals, ИБ-конференц-эстетика.

// Returns a correctly pluralised Russian string for the word "участник".
// Russian plural rules: 1 → участник, 2-4 → участника, 5+ → участников.
function pluralParticipants(n) {
  const mod10 = n % 10;
  const mod100 = n % 100;
  let word;
  if (mod10 === 1 && mod100 !== 11) {
    word = 'участник';
  } else if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) {
    word = 'участника';
  } else {
    word = 'участников';
  }
  return `${n} ${word}`;
}

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
  const [localError, setLocalError] = React.useState(null);

  const handleSubmit = () => {
    const trimmed = nick.trim();
    if (!trimmed) {
      setLocalError('Введите никнейм');
      return;
    }
    setLocalError(null);
    if (onRegister) onRegister(trimmed);
  };

  const displayError = error || localError;

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
          {displayError && (
            <div style={{ fontSize: 13, color: 'var(--accent)', marginTop: 4, lineHeight: 1.4 }}>
              {displayError}
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

// Compute h:mm:ss string from a target ISO date string; returns '' if no target
function computeCountdown(target) {
  if (!target) return '';
  const diff = Math.max(0, new Date(target).getTime() - Date.now());
  const h = String(Math.floor(diff / 3600000)).padStart(2, '0');
  const m = String(Math.floor((diff % 3600000) / 60000)).padStart(2, '0');
  const s = String(Math.floor((diff % 60000) / 1000)).padStart(2, '0');
  return `${h}:${m}:${s}`;
}

function ScanResultLayout({
  user, score, tagId, strategy, tone = 'accent',
  hero, sub, meta, scanLabel = 'scan · ok', wideHero = false,
  boardTimerLabel = 'до конца', boardTimer = '',
  timerTarget,
  boardSlice, boardEmpty, totalPlayers,
}) {
  const navigate = useNavigate();
  // Live countdown from timerTarget ISO string; falls back to static boardTimer string
  const [liveTimer, setLiveTimer] = React.useState(
    () => timerTarget ? computeCountdown(timerTarget) : (boardTimer || '')
  );
  React.useEffect(() => {
    if (!timerTarget) {
      // No live target — just show static boardTimer as-is
      setLiveTimer(boardTimer || '');
      return;
    }
    const tick = () => {
      setLiveTimer(computeCountdown(timerTarget));
    };
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [timerTarget, boardTimer]);

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
            <span className="mono tabular" style={{ fontSize: 16, fontWeight: 600, color: 'var(--fg)', letterSpacing: '-0.02em' }}>{liveTimer}</span>
          </div>
        </div>
        <div style={{ flex: 1, overflow: 'auto', padding: '0 16px' }}>
          {boardEmpty
            ? <BoardEmptyHint message={boardEmpty} />
            : (boardSlice ?? []).map(([place, name, scoreVal, opts], i) =>
                opts?.separator
                  ? <BoardSeparatorRow key={`sep-${i}`} />
                  : <BoardSliceRow key={name + place}
                      place={place} name={name} score={scoreVal}
                      mine={opts?.mine} delta={opts?.delta} prevPlace={opts?.prevPlace} dim={opts?.dim} />
              )
          }
        </div>
      </div>

      {totalPlayers != null && (
        <QuestFooter>
          <button className="btn ghost" onClick={() => navigate('/scoreboard')}>Полное табло · {pluralParticipants(totalPlayers)} →</button>
        </QuestFooter>
      )}
    </div>
  );
}


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

function BoardSeparatorRow() {
  return (
    <div style={{
      padding: '4px 6px',
      borderTop: '1px solid var(--line)',
      textAlign: 'center',
      fontFamily: 'var(--font-mono)',
      fontSize: 11,
      color: 'var(--muted-2)',
      letterSpacing: '0.2em',
    }}>···</div>
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
  const s = { position: 'absolute', width: 14, height: 14, borderColor: c, borderStyle: 'solid', borderWidth: 0, pointerEvents: 'none' };
  return (
    <>
      <div style={{ ...s, top: 8, left: 8,  borderTopWidth: 1, borderLeftWidth: 1 }} />
      <div style={{ ...s, top: 8, right: 8, borderTopWidth: 1, borderRightWidth: 1 }} />
      <div style={{ ...s, bottom: 8, left: 8,  borderBottomWidth: 1, borderLeftWidth: 1 }} />
      <div style={{ ...s, bottom: 8, right: 8, borderBottomWidth: 1, borderRightWidth: 1 }} />
    </>
  );
}

// ─── Variants of scan-result screen (states) ────────────────────
// Each shares ScanResultLayout and feeds it a leaderboard slice
// centered on the player's row, so the table is right there.

// State: ok (positive delta)
function ScanSuccessPlus({ user, score, tagId, delta, meta, strategyDisplay, boardSlice, boardTimer, boardTimerLabel, timerTarget, totalPlayers }) {
  return <ScanResultLayout
    user={user || 'r00t_kit'}
    score={score != null ? score : 310}
    tagId={tagId ? `TAG · ${tagId}` : 'TAG · ???'}
    tone="plus"
    hero={delta != null ? (delta >= 0 ? `+${delta}` : `${delta}`) : '+?'}
    sub={strategyDisplay || 'Спрятанная метка. Лежала под чёрной доской.'}
    meta={meta || ''}
    boardSlice={boardSlice}
    boardTimer={boardTimer || ''}
    boardTimerLabel={boardTimerLabel || 'до конца'}
    timerTarget={timerTarget}
    totalPlayers={totalPlayers}
  />;
}

// State: ok (negative delta)
function ScanSuccessMinus({ user, score, tagId, delta, meta, strategyDisplay, boardSlice, boardTimer, boardTimerLabel, timerTarget, totalPlayers }) {
  return <ScanResultLayout
    user={user || 'r00t_kit'}
    score={score != null ? score : 210}
    tagId={tagId ? `TAG · ${tagId}` : 'TAG · ???'}
    tone="minus"
    hero={delta != null ? String(delta) : '-?'}
    sub={strategyDisplay || 'Эта метка отнимает баллы. Не повезло.'}
    meta={meta || ''}
    boardSlice={boardSlice}
    boardTimer={boardTimer || ''}
    boardTimerLabel={boardTimerLabel || 'до конца'}
    timerTarget={timerTarget}
    totalPlayers={totalPlayers}
  />;
}

// State: locked (tag already used)
function ScanLocked({ user, score, tagId, boardSlice, boardTimer, boardTimerLabel, timerTarget, totalPlayers }) {
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
      boardSlice={boardSlice}
      boardTimer={boardTimer || ''}
      boardTimerLabel={boardTimerLabel || 'до конца'}
      timerTarget={timerTarget}
      totalPlayers={totalPlayers}
    />
  );
}

// State: quest not started yet (countdown)
// startsAt — ISO string of when the quest begins
function ScanNotYet({ user, score, tagId, boardSlice, boardTimer, boardTimerLabel, timerTarget, startsAt, totalPlayers }) {
  return (
    <ScanResultLayout
      user={user || 'r00t_kit'}
      score={score != null ? score : 0}
      tagId={tagId ? `TAG · ${tagId}` : 'TAG · ???'}
      tone="info"
      scanLabel="quest · pending"
      wideHero
      hero={<CountdownBig startsAt={startsAt} />}
      sub="Квест ещё не начался."
      strategy="ожидание · старт через"
      boardTimerLabel={boardTimerLabel || 'до старта'}
      boardTimer={boardTimer || ''}
      timerTarget={timerTarget}
      boardEmpty="Сканирование ещё не открыто."
      totalPlayers={totalPlayers}
    />
  );
}

// Live countdown to startsAt (or static "—" if no date provided)
function CountdownBig({ startsAt }) {
  const [timeStr, setTimeStr] = React.useState('');
  React.useEffect(() => {
    const tick = () => {
      if (!startsAt) { setTimeStr('—'); return; }
      const diff = Math.max(0, new Date(startsAt).getTime() - Date.now());
      const h = String(Math.floor(diff / 3600000)).padStart(2, '0');
      const m = String(Math.floor((diff % 3600000) / 60000)).padStart(2, '0');
      const s = String(Math.floor((diff % 60000) / 1000)).padStart(2, '0');
      setTimeStr(`${h}:${m}:${s}`);
    };
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [startsAt]);
  return (
    <div style={{
      display: 'flex', alignItems: 'baseline', gap: 4,
      fontSize: 84, lineHeight: 0.85, fontFamily: 'var(--font-display)',
      fontWeight: 800, letterSpacing: '-0.04em', whiteSpace: 'nowrap',
    }}>
      {timeStr}
    </div>
  );
}
function Sep() { return <span style={{ color: 'var(--muted-2)' }}>:</span>; }

// State: quest finished
// awardMessage — string with award ceremony info
function ScanFinished({ user, score, tagId, boardSlice, boardTimer, boardTimerLabel, awardMessage, totalPlayers }) {
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
      boardSlice={boardSlice}
      totalPlayers={totalPlayers}
    />
  );
}

// State: quest finished — winner screen for top-10 players
// Displays a bright fullscreen congratulation with the player's place number
function ScanFinishedWinner({ user, score, rank }) {
  // Gold background for top 3, warm amber for places 4-10
  const bgColor = rank <= 3 ? '#f6cd5b' : '#f0b429';
  const placeStr = String(rank).padStart(2, '0');

  return (
    <div style={{
      width: '100%', height: '100%',
      display: 'flex', flexDirection: 'column',
      alignItems: 'center', justifyContent: 'center',
      background: bgColor,
    }}>
      {/* Small "МЕСТО" label above the big number */}
      <div style={{
        fontFamily: 'var(--font-mono)', fontSize: 11,
        letterSpacing: '0.15em', textTransform: 'uppercase',
        color: 'rgba(0,0,0,0.5)', marginBottom: 8,
      }}>МЕСТО</div>

      {/* Giant place number */}
      <div style={{
        fontFamily: 'var(--font-display)', fontSize: 180, fontWeight: 800,
        lineHeight: 1, letterSpacing: '-0.05em', color: '#0c0d0e',
      }}>{placeStr}</div>

      {/* Call-to-action message */}
      <div style={{
        fontFamily: 'var(--font-sans)', fontSize: 24, fontWeight: 700,
        color: '#0c0d0e', marginTop: 16,
      }}>Приходите на награждение</div>

      {/* Nick and score in muted style */}
      <div style={{
        fontFamily: 'var(--font-mono)', fontSize: 13,
        color: 'rgba(0,0,0,0.55)', marginTop: 12,
      }}>{user} · {score} pts</div>
    </div>
  );
}

// State: unknown tag
function ScanUnknown({ user, score, tagId, boardSlice, boardTimer, boardTimerLabel, timerTarget, totalPlayers }) {
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
      boardSlice={boardSlice}
      boardEmpty={boardSlice ? undefined : "Данные недоступны"}
      boardTimer={boardTimer || ''}
      boardTimerLabel={boardTimerLabel || 'до конца'}
      timerTarget={timerTarget}
      totalPlayers={totalPlayers}
    />
  );
}

// State: rate-limited
function ScanRateLimit({ user, score, tagId, boardSlice, boardTimer, boardTimerLabel, timerTarget, totalPlayers, message }) {
  return (
    <ScanResultLayout
      user={user || 'r00t_kit'}
      score={score != null ? score : 310}
      tagId={tagId ? `TAG · ${tagId}` : 'TAG · ???'}
      tone="warn"
      scanLabel="scan · throttled"
      hero={<span style={{ fontSize: 62, letterSpacing: '-0.04em' }}>WAIT</span>}
      sub={getErrorMessage(message, 'Подождите секунду и попробуйте снова.')}
      strategy="rate limit · 1 скан / сек"
      meta="retry в течение ~ 0.6 сек"
      boardSlice={boardSlice}
      boardTimer={boardTimer || ''}
      boardTimerLabel={boardTimerLabel || 'до конца'}
      timerTarget={timerTarget}
      totalPlayers={totalPlayers}
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
      <QuestHeader user={myNick} score={myNick ? (scoreboard.find(p => p.nick === myNick)?.points ?? 0) : 0} />
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
        overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', minWidth: 0,
      }}>{name}{mine && <span style={{ color: 'var(--accent)', marginLeft: 6, fontSize: 10 }}>· ВЫ</span>}</div>
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
  ScanSuccessPlus, ScanSuccessMinus, ScanLocked, ScanNotYet, ScanFinished, ScanFinishedWinner, ScanUnknown, ScanRateLimit,
  ScreenScoreboardMobile,
};
