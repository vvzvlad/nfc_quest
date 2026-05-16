import React from 'react';
import { Routes, Route, Navigate, useParams } from 'react-router-dom';
import { QuestCtx } from './QuestContext.js';
import { getLocalPlayer, setLocalPlayer, api } from './api.js';

import {
  ScreenRegistration,
  ScanSuccessPlus, ScanSuccessMinus, ScanLocked, ScanNotYet,
  ScanFinished, ScanUnknown, ScanRateLimit,
  ScreenScoreboardMobile,
} from './screens/Player.jsx';

import { ScreenHallScoreboard } from './screens/Hall.jsx';

import {
  ScreenAdminLogin, ScreenAdminGame, ScreenAdminTags,
  ScreenAdminPlayers, ScreenAdminLog,
} from './screens/Admin.jsx';

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

  // On mount: decide whether to show registration or go straight to scanning
  React.useEffect(() => {
    const player = getLocalPlayer();
    if (!player) {
      setPhase('registration');
    } else {
      doScan(tagId, player.player_id);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tagId]);

  // Calls scan API and transitions to 'result' (or 'error').
  // Run scan and scoreboard fetch in parallel to have all data ready for first render,
  // so timerTarget is computed from real data on the very first render of the result screen.
  async function doScan(tag_id, player_id) {
    setPhase('scanning');
    try {
      const [scanRes, boardRes] = await Promise.allSettled([
        api.scan(tag_id, player_id),
        api.scoreboard(),
      ]);

      if (scanRes.status === 'rejected') {
        setPhase('error');
        return;
      }

      const { data: scanData } = scanRes.value;

      // Apply scoreboard data if available (may be absent if the request failed)
      if (boardRes.status === 'fulfilled' && boardRes.value.ok) {
        setScoreboardData(boardRes.value.data);
      }

      // Set scan result and transition to result screen — scoreboard data is already in state
      setScanResult(scanData);
      setPhase('result');
    } catch (err) {
      setPhase('error');
    }
  }

  // Build a boardSlice array centered around the current player for ScanResultLayout.
  // Format: [place, nick, points, opts?]
  function buildBoardSlice(players, myNick) {
    if (!players || players.length === 0) return null;
    const myIdx = players.findIndex(p => p.nick === myNick);
    const center = myIdx >= 0 ? myIdx : 0;
    const start = Math.max(0, center - 2);
    const slice = players.slice(start, start + 5);
    return slice.map(p => [p.rank, p.nick, p.points, p.nick === myNick ? { mine: true } : undefined]);
  }

  // Called by ScreenRegistration when the user submits the nick form
  async function onRegister(nick) {
    setRegistrationError(null);
    const player_id = crypto.randomUUID();
    const { ok, status, data } = await api.register(player_id, nick);

    if (!ok) {
      if (status === 409) {
        // Nick already taken — surface error to registration screen
        setRegistrationError(data.error || 'Никнейм уже занят');
      } else {
        setRegistrationError(data.error || 'Ошибка регистрации');
      }
      return;
    }

    // Registration succeeded — persist player locally
    setLocalPlayer({ player_id, nick, points: data.points ?? 0 });

    // Immediately scan the tag
    await doScan(tagId, player_id);
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
    if (status === 'locked')     return <ScanLocked   {...commonProps} />;
    if (status === 'not_yet')    return <ScanNotYet   {...commonProps} timerTarget={scanResult.starts_at} startsAt={scanResult.starts_at} registeredCount={scanResult.registered_count} />;
    if (status === 'finished')   return <ScanFinished {...commonProps} awardMessage={scanResult.award_message} />;
    if (status === 'rate_limit') return <ScanRateLimit {...commonProps} />;
    // Covers 'unknown' and any unexpected status values
    return <ScanUnknown {...commonProps} />;
  }

  return null;
}

// ─── App (root router) ────────────────────────────────────────────────────────

export default function App() {
  const [quest] = React.useState('ПЕРИМЕТР');
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
        <Route path="/admin/login"   element={<AdminHost><ScreenAdminLogin /></AdminHost>} />
        <Route path="/admin"         element={<AdminHost><ScreenAdminGame /></AdminHost>} />
        <Route path="/admin/game"    element={<AdminHost><ScreenAdminGame /></AdminHost>} />
        <Route path="/admin/tags"    element={<AdminHost><ScreenAdminTags /></AdminHost>} />
        <Route path="/admin/players" element={<AdminHost><ScreenAdminPlayers /></AdminHost>} />
        <Route path="/admin/log"     element={<AdminHost><ScreenAdminLog /></AdminHost>} />
      </Routes>
    </QuestCtx.Provider>
  );
}
