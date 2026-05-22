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

  const boardRef = React.useRef(null);       // ref to the two-column grid container
  const prevRectsRef = React.useRef({});     // nick -> DOMRect from previous render
  const prevScoresRef = React.useRef({});    // nick -> score string from previous render

  const [animatedScores, setAnimatedScores] = React.useState({});  // nick -> currently displayed (animated) score
  const animatedScoresRef = React.useRef({});                       // mirror of animatedScores for stale-closure-free reads in useLayoutEffect
  const animatingRef = React.useRef({});                            // nick -> active interval id for score counting
  const flipTimeoutsRef = React.useRef({});                         // nick -> pending setTimeout id for FLIP (fires after counting ends)

  const [tickKeys, setTickKeys] = React.useState({});               // nick -> tick counter (increments each tick, triggers pop in HallRow)

  // Updates animated score in both state (for rendering) and ref (for stale-closure-free reads)
  const setAnimated = React.useCallback((nick, value) => {
    animatedScoresRef.current[nick] = value;
    setAnimatedScores(prev => ({ ...prev, [nick]: value }));
  }, []);

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

  // Cleanup all score-counting intervals and pending FLIP timeouts on unmount
  React.useEffect(() => {
    return () => {
      Object.values(animatingRef.current).forEach(id => clearInterval(id));
      Object.values(flipTimeoutsRef.current).forEach(id => clearTimeout(id));
    };
  }, []);

  // Effect 1: Wall clock — runs once, ticks every 1 second
  React.useEffect(() => {
    const updateClock = () => {
      const now = new Date();
      setCurrentTime(now.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit', second: '2-digit' }));
    };
    updateClock();
    const id = setInterval(updateClock, 1000);
    return () => clearInterval(id);
  }, []);

  // Effect 2: Countdown — restarts when gameInfo changes; uses recursive setTimeout with adaptive delay
  React.useEffect(() => {
    let timeoutId;
    const tick = () => {
      if (!gameInfo) return;
      if (gameInfo.status === 'finished') { setTimeLeft(gameInfo.award_message || 'ФИНИШ'); return; }
      const target = gameInfo.status === 'active'
        ? new Date(gameInfo.ends_at).getTime()
        : gameInfo.starts_at ? new Date(gameInfo.starts_at).getTime() : null;
      if (!target) return;
      const diff = Math.max(0, target - Date.now());
      if (diff === 0) {
        // Game ended on client side: freeze at 00:00.00 and wait for WebSocket finished event.
        // Do not reschedule — stops the chain until gameInfo updates to 'finished'.
        setTimeLeft('00:00.00');
        return;
      }
      if (diff < 3600000) {
        // Under 1 hour: show MM:SS.cc with centiseconds
        const m = String(Math.floor((diff % 3600000) / 60000)).padStart(2, '0');
        const s = String(Math.floor((diff % 60000) / 1000)).padStart(2, '0');
        const cs = String(Math.floor((diff % 1000) / 10)).padStart(2, '0');
        setTimeLeft(`${m}:${s}.${cs}`);
        timeoutId = setTimeout(tick, 50); // fast tick so centiseconds appear to run
      } else {
        // 1 hour or more: show HH:MM:SS at normal 1s cadence
        const h = String(Math.floor(diff / 3600000)).padStart(2, '0');
        const m = String(Math.floor((diff % 3600000) / 60000)).padStart(2, '0');
        const s = String(Math.floor((diff % 60000) / 1000)).padStart(2, '0');
        setTimeLeft(`${h}:${m}:${s}`);
        timeoutId = setTimeout(tick, 1000);
      }
    };
    tick();
    return () => clearTimeout(timeoutId);
  }, [gameInfo]);

  // FLIP animation: animates rows to their new positions when players list changes
  React.useLayoutEffect(() => {
    if (!boardRef.current) return;
    const elements = boardRef.current.querySelectorAll('[data-nick]');

    // Cancel pending FLIP timeouts — new update supersedes them
    Object.entries(flipTimeoutsRef.current).forEach(([, id]) => clearTimeout(id));
    flipTimeoutsRef.current = {};

    // Read current visual positions BEFORE cancelling (getBoundingClientRect includes active transforms)
    const visualRects = {};
    elements.forEach(el => {
      visualRects[el.dataset.nick] = el.getBoundingClientRect();
    });

    // Cancel in-progress animations — elements snap to their final DOM positions
    elements.forEach(el => {
      el.getAnimations().forEach(anim => anim.cancel());
    });

    // Read final (post-cancel) positions and scores from the DOM
    const newRects = {};
    const newScores = {};
    elements.forEach(el => {
      const nick = el.dataset.nick;
      newRects[nick] = el.getBoundingClientRect();
      newScores[nick] = el.dataset.score;
    });

    // Clear animatedScoresRef entries for nicks no longer in the DOM to prevent stale startValue on re-entry
    const activeNicks = new Set(Object.keys(newRects));
    Object.keys(animatedScoresRef.current).forEach(nick => {
      if (!activeNicks.has(nick)) {
        delete animatedScoresRef.current[nick];
      }
    });

    // For each element, apply FLIP if it moved, and a score counting animation if score changed
    elements.forEach(el => {
      const nick = el.dataset.nick;
      // Determine if this element was mid-animation when the update arrived:
      // if visualRects (pre-cancel) differs from newRects (post-cancel), a transform was active.
      const wasAnimating =
        visualRects[nick] && newRects[nick] &&
        (Math.abs(visualRects[nick].left - newRects[nick].left) > 1 ||
         Math.abs(visualRects[nick].top  - newRects[nick].top)  > 1);
      // If mid-animation: start FLIP from current visual position (avoids jump on rapid updates).
      // Otherwise: start from the stored position of the previous render (normal FLIP path).
      const prevRect = wasAnimating ? visualRects[nick] : prevRectsRef.current[nick];
      const newRect = newRects[nick];
      const prevScore = prevScoresRef.current[nick];
      const curScore = newScores[nick];

      // Compute score change metadata
      const prevNum = prevScore !== undefined ? Number(prevScore) : null;
      const curNum  = curScore  !== undefined ? Number(curScore)  : null;
      const scoreChanged = prevNum !== null && curNum !== null && prevNum !== curNum;

      // Score changed: start counting animation; FLIP fires via setTimeout after counting ends
      if (scoreChanged) {
        const delta = curNum - prevNum;

        // Cancel any in-progress counting interval for this nick
        if (animatingRef.current[nick]) {
          clearInterval(animatingRef.current[nick]);
          delete animatingRef.current[nick];
        }

        // Cancel any pending FLIP timeout for this nick (already cancelled above, but be safe)
        if (flipTimeoutsRef.current[nick]) {
          clearTimeout(flipTimeoutsRef.current[nick]);
          delete flipTimeoutsRef.current[nick];
        }

        // Start from currently displayed animated value (not real prev score) to avoid jump on rapid updates
        const startValue    = animatedScoresRef.current[nick] ?? prevNum;
        const startDelta    = curNum - startValue;
        const absStartDelta = Math.abs(startDelta);
        const startTicks    = absStartDelta > 0 ? Math.min(Math.ceil(absStartDelta / 5), 20) : 0;
        const startStepSize = startDelta > 0
          ? Math.ceil(absStartDelta / Math.max(startTicks, 1))
          : -Math.ceil(absStartDelta / Math.max(startTicks, 1));

        // Capture FLIP rects now (DOM positions won't be available later inside the interval)
        const capturedPrevRect = prevRect;
        const capturedNewRect  = newRect;

        if (startTicks > 0) {
          // Seed display at the current animated value (smooth continuation if interrupted)
          setAnimated(nick, startValue);

          // Tick every 100 ms toward curNum; also trigger per-tick pop animation in HallRow
          let ticksDone = 0;
          const intervalId = setInterval(() => {
            ticksDone++;
            const isLast = ticksDone >= startTicks;
            const next   = isLast ? curNum : Math.round(startValue + startStepSize * ticksDone);
            setAnimated(nick, next);
            // Increment tickKey so HallRow plays the pop animation
            setTickKeys(prev => ({ ...prev, [nick]: (prev[nick] ?? 0) + 1 }));
            if (isLast) {
              clearInterval(intervalId);
              delete animatingRef.current[nick];
              // Trigger FLIP now that counting is done
              if (capturedPrevRect && capturedNewRect) {
                const dx = capturedPrevRect.left - capturedNewRect.left;
                const dy = capturedPrevRect.top  - capturedNewRect.top;
                if (Math.abs(dx) > 1 || Math.abs(dy) > 1) {
                  // Small timeout to let React flush the final score render before animating
                  const tid = setTimeout(() => {
                    delete flipTimeoutsRef.current[nick];
                    const domEl = document.querySelector(`[data-nick="${CSS.escape(nick)}"]`);
                    if (domEl) {
                      domEl.animate(
                        [
                          { transform: `translate(${dx}px, ${dy}px)` },
                          { transform: 'translate(0, 0)' },
                        ],
                        { duration: 600, easing: 'cubic-bezier(0.25, 0.46, 0.45, 0.94)' }
                      );
                    }
                  }, 16);  // one frame delay after last tick render
                  flipTimeoutsRef.current[nick] = tid;
                }
              }
            }
          }, 100);
          animatingRef.current[nick] = intervalId;
        }

        // Green background flash when score increases (keep existing behaviour)
        if (delta > 0) {
          el.animate(
            [
              { backgroundColor: 'rgba(108,208,122,0.18)' },
              { backgroundColor: 'rgba(108,208,122,0.18)', offset: 0.12 },
              { backgroundColor: 'transparent' },
            ],
            { duration: 1600, easing: 'ease-out' }
          );
        }
      }

      // FLIP for elements whose score did NOT change — fire immediately as usual
      // (for elements whose score changed, FLIP is deferred via setTimeout inside the interval above)
      if (!scoreChanged && prevRect && newRect) {
        const dx = prevRect.left - newRect.left;
        const dy = prevRect.top  - newRect.top;
        if (Math.abs(dx) > 1 || Math.abs(dy) > 1) {
          el.animate(
            [
              { transform: `translate(${dx}px, ${dy}px)` },
              { transform: 'translate(0, 0)' },
            ],
            { duration: 600, easing: 'cubic-bezier(0.25, 0.46, 0.45, 0.94)' }
          );
        }
      }
    });

    // Save current positions and scores for the next update
    prevRectsRef.current = newRects;
    prevScoresRef.current = newScores;
  }, [players]);

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
                  : /^\d{2}:\d{2}\.\d{2}$/.test(timeLeft)
                    ? <>
                        {timeLeft.slice(0, 2)}
                        <span style={{ color: 'var(--muted-2)', padding: '0 0.04em' }}>:</span>
                        {timeLeft.slice(3, 5)}
                        <span style={{ color: 'var(--muted-2)', padding: '0 0.02em' }}>.</span>
                        <span style={{ color: 'var(--accent)', fontSize: '0.55em', verticalAlign: 'baseline' }}>{timeLeft.slice(6)}</span>
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
          <div ref={boardRef} style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 0 }}>
            <div>
              {left.map((entry, i) => (
                <HallRow
                  key={entry.nick ?? i}
                  place={i + 1}
                  name={entry.nick}
                  score={animatedScores[entry.nick] ?? entry.points}
                  realScore={entry.points}
                  lastScanAt={entry.last_scan_at}
                  tickKey={tickKeys[entry.nick] ?? 0}
                />
              ))}
            </div>
            <div style={{ marginLeft: 24 }}>
              {right.map((entry, i) => (
                <HallRow
                  key={entry.nick ?? i}
                  place={i + 13}
                  name={entry.nick}
                  score={animatedScores[entry.nick] ?? entry.points}
                  realScore={entry.points}
                  lastScanAt={entry.last_scan_at}
                  tickKey={tickKeys[entry.nick] ?? 0}
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
          : recentScans.map((scan, i) => {
              // Compute seconds elapsed since this scan occurred
              const secsAgo = scan.scanned_at
                ? Math.max(0, Math.round((Date.now() - new Date(scan.scanned_at).getTime()) / 1000))
                : null;
              return (
                <React.Fragment key={scan.nick + '_' + (scan.scanned_at ?? '') + '_' + i}>
                  {i > 0 && <span style={{ color: 'var(--muted-2)' }}>·</span>}
                  <span>
                    <b style={{ color: 'var(--fg)' }}>{scan.nick}</b>
                    {' '}
                    <span style={{ color: scan.delta >= 0 ? 'var(--success)' : 'var(--accent)' }}>
                      {scan.delta >= 0 ? '+' : ''}{scan.delta}
                    </span>
                    {secsAgo !== null && (
                      <span style={{ color: 'var(--muted)', fontSize: 11, marginLeft: 4 }}>
                        {secsAgo}с
                      </span>
                    )}
                  </span>
                </React.Fragment>
              );
            })
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

function HallRow({ place, name, score, realScore, lastScanAt, tickKey }) {
  const medal = place === 1 ? 'var(--gold)' : place <= 4 ? 'var(--silver)' : place <= 15 ? 'var(--bronze)' : null;

  const elapsedMs    = lastScanAt ? Date.now() - new Date(lastScanAt).getTime() : null;
  const minsAgo      = elapsedMs !== null ? Math.floor(elapsedMs / 60000) : null;
  const showInactive = elapsedMs !== null && elapsedMs > 10 * 60 * 1000;

  // Ref for the score cell — used to trigger the per-tick pop animation
  const scoreRef = React.useRef(null);

  // Play a scale-up pop on each tick (tickKey increments every 100 ms during counting)
  React.useEffect(() => {
    if (!tickKey || !scoreRef.current) return;
    scoreRef.current.animate(
      [
        { transform: 'scale(1)',   color: 'var(--fg)' },
        { transform: 'scale(1.9)', color: 'var(--success)', offset: 0.35 },
        { transform: 'scale(1)',   color: 'var(--fg)' },
      ],
      { duration: 80, easing: 'ease-out' }
    );
  }, [tickKey]);

  return (
    <div
      data-nick={name}
      data-score={realScore ?? score}
      style={{
        display: 'grid', gridTemplateColumns: '40px 1fr auto',
        alignItems: 'center', padding: '7px 6px',
        borderBottom: '1px solid var(--line)',
        overflow: 'visible',   // allow score pop to overflow row borders
      }}
    >
      <div className="mono" style={{ fontSize: 13, color: medal ?? 'var(--muted)', fontWeight: 700 }}>{String(place).padStart(2,'0')}</div>
      <div style={{ display: 'flex', flexDirection: 'row', alignItems: 'center', minWidth: 0, gap: 6 }}>
        <div style={{
          fontFamily: 'var(--font-mono)', fontSize: 15, color: 'var(--fg-2)',
          overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
          flexShrink: 1, minWidth: 0,
        }}>{name}</div>
        {showInactive && (
          <div style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--muted)', flexShrink: 0, whiteSpace: 'nowrap' }}>
            {minsAgo} мин. назад
          </div>
        )}
      </div>
      <div
        ref={scoreRef}
        className="tabular"
        style={{
          fontFamily: 'var(--font-mono)', fontSize: 18, fontWeight: 700, color: 'var(--fg)',
          display: 'inline-block',   // needed so transform scale works correctly on inline text
        }}
      >{score}</div>
    </div>
  );
}

export {
  ScreenHallScoreboard, Podium, HallRow, Stat,
};
