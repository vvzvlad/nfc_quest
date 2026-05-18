import React from 'react';
import { Routes, Route, useNavigate, useParams, Outlet, Navigate } from 'react-router-dom';
import { QuestCtx } from './QuestContext.js';
import { getLocalPlayer, setLocalPlayer, clearLocalPlayer, api, adminApi } from './api.js';
import { getErrorMessage } from './i18n.js';
import {
  QuestHeader,
  ScreenRegistration,
  ScanSuccessPlus, ScanSuccessMinus, ScanLocked, ScanNotYet,
  ScanFinished, ScanFinishedWinner, ScanUnknown, ScanRateLimit,
  ScreenScoreboardMobile,
} from './screens/Player.jsx';
import { ScreenHallScoreboard } from './screens/Hall.jsx';
import {
  ScreenAdminLogin, ScreenAdminGame, ScreenAdminTags,
  ScreenAdminPlayers, ScreenAdminLog,
} from './screens/Admin.jsx';

// generateUUID must come AFTER all imports (ESM rule: imports must be at top of file)
function generateUUID() {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  // Fallback for environments without crypto.randomUUID (e.g. old Safari)
  return '10000000-1000-4000-8000-100000000000'.replace(/[018]/g, c =>
    (+c ^ (crypto.getRandomValues(new Uint8Array(1))[0] & (15 >> (+c >> 2)))).toString(16)
  );
}

// ─── Layout hosts ─────────────────────────────────────────────────────────────

// ScaleHost: scales a fixed-size design canvas to fit any viewport using CSS transform.
function ScaleHost({ width, height, children }) {
  const ref = React.useRef(null);
  const [scale, setScale] = React.useState(1);
  React.useEffect(() => {
    const fit = () => {
      const el = ref.current;
      if (!el) return;
      setScale(Math.min(el.clientWidth / width, el.clientHeight / height));
    };
    fit();
    window.addEventListener('resize', fit);
    return () => window.removeEventListener('resize', fit);
  }, [width, height]);
  return (
    <div ref={ref} style={{
      width: '100vw', height: '100vh', background: 'var(--bg)',
      display: 'flex', alignItems: 'center', justifyContent: 'center', overflow: 'hidden',
    }}>
      <div style={{
        width, height,
        transform: `scale(${scale})`, transformOrigin: 'center center',
        flexShrink: 0,
      }}>{children}</div>
    </div>
  );
}

// PhoneHost: centers content in a phone-width column.
function PhoneHost({ children }) {
  return (
    <div style={{
      width: '100%', maxWidth: 600, margin: '0 auto', height: '100vh',
      background: 'var(--bg)', display: 'flex', flexDirection: 'column',
    }}>{children}</div>
  );
}

// AdminHost: full-viewport host for admin panel screens (no fixed canvas, responsive).
function AdminHost({ children }) {
  return (
    <div style={{
      width: '100vw', height: '100vh', background: 'var(--bg)',
      overflow: 'hidden', display: 'flex', flexDirection: 'column',
    }}>{children}</div>
  );
}

// ─── ScreenLanding ────────────────────────────────────────────────────────────

// Landing screen shown at root `/`. Displayed on hall screens so visitors
// know to scan an NFC tag to participate.
function ScreenLanding() {
  const QUEST = React.useContext(QuestCtx);
  const navigate = useNavigate();
  return (
    <div style={{ height: '100%', display: 'flex', flexDirection: 'column', background: 'var(--bg)' }}>
      <QuestHeader simple />
      <div style={{
        flex: 1, display: 'flex', flexDirection: 'column',
        alignItems: 'center', justifyContent: 'center',
        padding: '40px 24px', gap: 32,
      }}>
        <div style={{ textAlign: 'center' }}>
          <div style={{
            fontFamily: 'var(--font-mono)', fontSize: 11,
            color: 'var(--muted)', letterSpacing: '0.15em',
            textTransform: 'uppercase', marginBottom: 16,
          }}>nfc · quest</div>
          <h1 style={{
            fontFamily: 'var(--font-display)',
            fontSize: 48, lineHeight: 1.0, fontWeight: 800,
            letterSpacing: '-0.04em', color: 'var(--fg)',
            margin: '0 0 8px',
          }}>{QUEST}</h1>
        </div>

        <div style={{
          border: '1px solid var(--accent)',
          padding: '24px 32px',
          textAlign: 'center',
          maxWidth: 360,
        }}>
          <div style={{
            fontFamily: 'var(--font-display)',
            fontSize: 22, fontWeight: 700,
            letterSpacing: '-0.02em', color: 'var(--fg)',
            lineHeight: 1.3,
          }}>
            Сканируйте NFC-метку,<br />
            <span style={{ color: 'var(--accent)' }}>чтобы начать</span>
          </div>
        </div>

        <button
          className="btn ghost"
          style={{ maxWidth: 240, width: '100%' }}
          onClick={() => navigate('/scoreboard')}
        >
          Смотреть табло →
        </button>
      </div>
    </div>
  );
}

// ─── ScreenLoading ────────────────────────────────────────────────────────────

// Shown while a scan API call is in flight (phase === 'scanning' or null).
function ScreenLoading() {
  return (
    <>
      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
      <div style={{ height: '100%', display: 'flex', flexDirection: 'column', background: 'var(--bg)' }}>
        <QuestHeader simple />
        <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', flexDirection: 'column', gap: 16 }}>
          <div style={{
            width: 32, height: 32,
            border: '2px solid var(--line)',
            borderTopColor: 'var(--accent)',
            borderRadius: '50%',
            animation: 'spin 1s linear infinite',
          }} />
          <div className="mono" style={{ fontSize: 12, color: 'var(--muted)', letterSpacing: '0.1em' }}>ЗАГРУЗКА…</div>
        </div>
      </div>
    </>
  );
}

// ─── PlayerPage ───────────────────────────────────────────────────────────────

// Possible phases:
//   'registration' — no local player found, show registration form
//   'scanning'     — API call in flight, show loading spinner
//   'result'       — scan complete, show result screen based on status
//   'error'        — unexpected API error (network, 5xx, etc.)

function PlayerPage() {
  const { tagId } = useParams();

  // phase controls which screen branch is shown
  const [phase, setPhase] = React.useState(null); // null = initialising
  const [registrationError, setRegistrationError] = React.useState(null);
  const [scanResult, setScanResult] = React.useState(null);
  const [scoreboardData, setScoreboardData] = React.useState(null);

  // On mount: decide whether to show registration or go straight to scanning.
  // If we already scanned this tag in this browser tab, show cached result
  // instead of re-POSTing (prevents accidental re-scans on refresh).
  // After showing cache, validate that the player still exists in the scoreboard —
  // if admin deleted the player, invalidate session and go to registration.
  React.useEffect(() => {
    const player = getLocalPlayer();
    if (!player) {
      setPhase('registration');
      return;
    }

    const cached = sessionStorage.getItem('scan_result_' + tagId);
    if (cached) {
      try {
        const { scanData, boardData } = JSON.parse(cached);
        setScanResult(scanData);
        setScoreboardData(boardData);
        setPhase('result');
        // Validate player is still active and refresh scoreboard in background
        api.scoreboard().then(r => {
          if (r.ok) {
            setScoreboardData(r.data);
            // If player no longer appears in scoreboard, they were deleted — reset session
            const stillExists = r.data.players?.some(p => p.nick === player.nick);
            if (!stillExists) {
              clearLocalPlayer();
              sessionStorage.removeItem('scan_result_' + tagId);
              setPhase('registration');
            }
          }
        });
        return;
      } catch { /* corrupted cache — fall through to fresh scan */ }
    }

    doScan(tagId, player.player_id);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tagId]);

  // Calls scan API and transitions to 'result' (or 'error').
  async function doScan(tag_id, player_id) {
    setPhase('scanning');
    try {
      const scanRes = await api.scan(tag_id, player_id);

      if (!scanRes.ok) {
        if (scanRes.data?.error === 'PLAYER_NOT_FOUND') {
          clearLocalPlayer();
          sessionStorage.removeItem('scan_result_' + tag_id);
          setPhase('registration');
          return;
        }
        setPhase('error');
        return;
      }

      const scanData = scanRes.data;
      setScanResult(scanData);

      // Points are not stored locally; always fetched live from the scoreboard
      const boardRes = await api.scoreboard();
      if (boardRes.ok) {
        setScoreboardData(boardRes.data);
      }

      // Cache scan result so refresh doesn't re-POST
      sessionStorage.setItem('scan_result_' + tag_id, JSON.stringify({
        scanData,
        boardData: boardRes.ok ? boardRes.data : null,
      }));

      setPhase('result');
    } catch (err) {
      setPhase('error');
    }
  }

  function buildBoardSlice(players, myNick) {
    if (!players || players.length === 0) return null;
    const myIdx = players.findIndex(p => p.nick === myNick);
    const toRow = (p) => [p.rank, p.nick, p.points, p.nick === myNick ? { mine: true } : undefined];
    const sepRow = [null, null, null, { separator: true }];

    if (players.length <= 7) {
      return players.map(toRow);
    }

    const rows = [];
    const top3 = players.slice(0, 3).map(toRow);
    rows.push(...top3);

    const playerPos = myIdx >= 0 ? myIdx : 0;
    const lastIdx = players.length - 1;

    if (playerPos <= 3) {
      rows.push(toRow(players[3]));
      if (playerPos === 3) rows.push(toRow(players[4]));
      rows.push(sepRow);
      rows.push(toRow(players[lastIdx]));
    } else if (playerPos >= lastIdx - 1) {
      rows.push(sepRow);
      if (playerPos === lastIdx - 1) rows.push(toRow(players[playerPos - 1]));
      rows.push(toRow(players[playerPos]));
      if (playerPos !== lastIdx) rows.push(toRow(players[lastIdx]));
    } else {
      rows.push(sepRow);
      rows.push(toRow(players[playerPos - 1]));
      rows.push(toRow(players[playerPos]));
      rows.push(toRow(players[playerPos + 1]));
      if (playerPos + 1 < lastIdx) {
        rows.push(sepRow);
        rows.push(toRow(players[lastIdx]));
      }
    }

    return rows;
  }

  // Called by ScreenRegistration when the user submits the nick form
  async function onRegister(nick) {
    setRegistrationError(null);
    try {
      const player_id = generateUUID();
      const { ok, status, data } = await api.register(player_id, nick);

      if (!ok) {
        setRegistrationError(getErrorMessage(data.error, 'Ошибка регистрации'));
        return;
      }

      // Store only player_id and nick — points are always fetched live from scoreboard
      setLocalPlayer({ player_id, nick });
      await doScan(tagId, player_id);
    } catch (err) {
      setRegistrationError('Ошибка регистрации. Попробуйте ещё раз.');
    }
  }

  // ── Render branch ──────────────────────────────────────────────────────────

  // Still initialising or scanning — show loading spinner
  if (phase === null || phase === 'scanning') {
    return <ScreenLoading />;
  }

  if (phase === 'registration') {
    return (
      <ScreenRegistration
        tagId={tagId}
        onRegister={onRegister}
        error={registrationError}
      />
    );
  }

  if (phase === 'error') {
    // Generic fallback for unexpected errors — pass what we know about the player
    const player = getLocalPlayer();
    return <ScanUnknown user={player?.nick} score={0} tagId={tagId} />;
  }

  // phase === 'result': pick screen by status + delta
  if (phase === 'result' && scanResult) {
    const { status, delta } = scanResult;

    // Common props for all result screens
    const player = getLocalPlayer();
    const myNick = player?.nick;
    const boardSlice = buildBoardSlice(scoreboardData?.players, myNick) || undefined;
    const game = scoreboardData?.game;
    // Extract the live countdown target as an ISO string; ScanResultLayout will tick it every second.
    // For 'active' games count down to ends_at; for 'not_started' count down to starts_at.
    const timerTarget = game?.status === 'active' && game?.ends_at
      ? game.ends_at
      : game?.status === 'not_started' && game?.starts_at
      ? game.starts_at
      : null;
    // Points are always fetched live from scoreboard; fall back to 0 if not yet available
    const liveScore = myNick && scoreboardData?.players
      ? scoreboardData.players.find(p => p.nick === myNick)?.points ?? 0
      : 0;
    const commonProps = {
      user: myNick, score: liveScore, tagId, boardSlice, timerTarget,
      totalPlayers: scoreboardData?.stats?.total_players,
    };

    if (status === 'ok') {
      // Props shared between plus and minus success screens
      const commonScanProps = {
        ...commonProps,
        score: scanResult.total,
        delta: scanResult.delta,
        meta: scanResult.meta,
        strategyDisplay: scanResult.strategy_display,
      };
      return delta >= 0
        ? <ScanSuccessPlus  {...commonScanProps} />
        : <ScanSuccessMinus {...commonScanProps} />;
    }
    if (status === 'locked')     return <ScanLocked   {...commonProps} strategy={scanResult.strategy} />;
    if (status === 'not_yet')    return <ScanNotYet   {...commonProps} timerTarget={scanResult.starts_at} startsAt={scanResult.starts_at} registeredCount={scanResult.registered_count} />;
    if (status === 'finished') {
      // Use rank returned directly by the backend scan response
      if (scanResult.rank && scanResult.rank <= 10) {
        return <ScanFinishedWinner user={myNick} score={liveScore} rank={scanResult.rank} />;
      }
      return <ScanFinished {...commonProps} awardMessage={scanResult.award_message} />;
    }
    if (status === 'rate_limit') return <ScanRateLimit {...commonProps} message={scanResult.message} />;
    // Covers 'unknown' and any unexpected status values
    return <ScanUnknown {...commonProps} />;
  }

  return null;
}

// ─── RequireAuth ──────────────────────────────────────────────────────────────

// RequireAuth: checks session validity before rendering admin content.
// Renders null while the check is in-flight, redirects to /FRuihf7Y/login if not authenticated.
function RequireAuth() {
  const [authChecked, setAuthChecked] = React.useState(false);
  const [authenticated, setAuthenticated] = React.useState(false);

  React.useEffect(() => {
    let cancelled = false; // cleanup flag to avoid state updates on unmounted component
    adminApi.me()
      .then(r => { if (!cancelled) setAuthenticated(r.ok && r.data?.authenticated === true); })
      .catch(() => { if (!cancelled) setAuthenticated(false); }) // Network error: treat as unauthenticated
      .finally(() => { if (!cancelled) setAuthChecked(true); });
    return () => { cancelled = true; };
  }, []);

  if (!authChecked) return null; // blank while checking
  if (!authenticated) return <Navigate to="/FRuihf7Y/login" replace />;
  return <Outlet />; // renders the matched child route
}

// ─── App (root router) ────────────────────────────────────────────────────────

export default function App() {
  const [quest, setQuest] = React.useState('');
  React.useEffect(() => {
    // Load quest name from backend config on mount; fall back to default if request fails
    api.config()
      .then(r => { if (r.ok && r.data?.quest_name) setQuest(r.data.quest_name); })
      .catch(() => setQuest('ПЕРИМЕТР'));
  }, []);
  return (
    <QuestCtx.Provider value={quest}>
      <Routes>
        {/* Landing page shown at root — scan NFC tag to start */}
        <Route path="/" element={<PhoneHost><ScreenLanding /></PhoneHost>} />

        {/* Player flow: tag scan page */}
        <Route path="/tag/:tagId" element={<PhoneHost><PlayerPage /></PhoneHost>} />

        {/* Mobile scoreboard */}
        <Route path="/scoreboard" element={<PhoneHost><ScreenScoreboardMobile /></PhoneHost>} />

        {/* Hall display (1920×1080) */}
        <Route path="/hall" element={<ScaleHost width={1920} height={1080}><ScreenHallScoreboard /></ScaleHost>} />

        {/* Admin screens — full viewport, no fixed canvas */}
        <Route path="/FRuihf7Y/login" element={<AdminHost><ScreenAdminLogin /></AdminHost>} />
        <Route path="/admin" element={<Navigate to="/tag/admin" replace />} />
        <Route element={<AdminHost><RequireAuth /></AdminHost>}>
          <Route path="/FRuihf7Y"         element={<ScreenAdminGame />} />
          <Route path="/FRuihf7Y/game"    element={<ScreenAdminGame />} />
          <Route path="/FRuihf7Y/tags"    element={<ScreenAdminTags />} />
          <Route path="/FRuihf7Y/players" element={<ScreenAdminPlayers />} />
          <Route path="/FRuihf7Y/log"     element={<ScreenAdminLog />} />
        </Route>
      </Routes>
    </QuestCtx.Provider>
  );
}
