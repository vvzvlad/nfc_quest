import React from 'react';
import { Routes, Route, Navigate, useParams, Outlet } from 'react-router-dom';
import { QuestCtx } from './QuestContext.js';
import { getLocalPlayer, setLocalPlayer, clearLocalPlayer, api, adminApi } from './api.js';
import { getErrorMessage } from './i18n.js';
import {
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

// ─── PlayerPage ───────────────────────────────────────────────────────────────

// Possible phases:
//   'registration' — no local player found, show registration form
//   'scanning'     — API call in flight, render nothing (blank / loader)
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
        // Refresh scoreboard in background (GET, no side effects)
        api.scoreboard().then(r => { if (r.ok) setScoreboardData(r.data); });
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

      if (scanData.total != null) {
        const cur = getLocalPlayer();
        if (cur) setLocalPlayer({ ...cur, points: scanData.total });
      }

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

      setLocalPlayer({ player_id, nick, points: data.points ?? 0 });
      await doScan(tagId, player_id);
    } catch (err) {
      setRegistrationError('Ошибка регистрации. Попробуйте ещё раз.');
    }
  }

  // ── Render branch ──────────────────────────────────────────────────────────

  // Still initialising
  if (phase === null || phase === 'scanning') {
    return null; // blank screen while request is in flight
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
    return <ScanUnknown user={player?.nick} score={player?.points} tagId={tagId} />;
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
    const liveScore = myNick && scoreboardData?.players
      ? scoreboardData.players.find(p => p.nick === myNick)?.points ?? player?.points
      : player?.points;
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
// Renders null while the check is in-flight, redirects to /admin/login if not authenticated.
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
  if (!authenticated) return <Navigate to="/admin/login" replace />;
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
        {/* Default redirect to scoreboard */}
        <Route path="/" element={<Navigate to="/scoreboard" replace />} />

        {/* Player flow: tag scan page */}
        <Route path="/tag/:tagId" element={<PhoneHost><PlayerPage /></PhoneHost>} />

        {/* Mobile scoreboard */}
        <Route path="/scoreboard" element={<PhoneHost><ScreenScoreboardMobile /></PhoneHost>} />

        {/* Hall display (1920×1080) */}
        <Route path="/hall" element={<ScaleHost width={1920} height={1080}><ScreenHallScoreboard /></ScaleHost>} />

        {/* Admin screens — full viewport, no fixed canvas */}
        <Route path="/admin/login" element={<AdminHost><ScreenAdminLogin /></AdminHost>} />
        <Route element={<AdminHost><RequireAuth /></AdminHost>}>
          <Route path="/admin"         element={<ScreenAdminGame />} />
          <Route path="/admin/game"    element={<ScreenAdminGame />} />
          <Route path="/admin/tags"    element={<ScreenAdminTags />} />
          <Route path="/admin/players" element={<ScreenAdminPlayers />} />
          <Route path="/admin/log"     element={<ScreenAdminLog />} />
        </Route>
      </Routes>
    </QuestCtx.Provider>
  );
}
