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

  // Calls scan API and transitions to 'result' (or 'error')
  async function doScan(tag_id, player_id) {
    setPhase('scanning');
    try {
      const { ok, status, data } = await api.scan(tag_id, player_id);
      if (ok || status === 200) {
        setScanResult(data);
        setPhase('result');
      } else {
        // Non-2xx: store whatever the server returned and still show result screen
        setScanResult(data);
        setPhase('result');
      }
    } catch (err) {
      setPhase('error');
    }
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
    // Generic fallback for unexpected errors
    return <ScanUnknown />;
  }

  // phase === 'result': pick screen by status + delta
  if (phase === 'result' && scanResult) {
    const { status, delta } = scanResult;

    if (status === 'ok') {
      return delta >= 0 ? <ScanSuccessPlus /> : <ScanSuccessMinus />;
    }
    if (status === 'locked')     return <ScanLocked />;
    if (status === 'not_yet')    return <ScanNotYet />;
    if (status === 'finished')   return <ScanFinished />;
    if (status === 'rate_limit') return <ScanRateLimit />;
    // Covers 'unknown' and any unexpected status values
    return <ScanUnknown />;
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

        {/* Admin screens (1440×900) */}
        <Route path="/admin/login"   element={<ScaleHost width={1440} height={900}><ScreenAdminLogin /></ScaleHost>} />
        <Route path="/admin"         element={<ScaleHost width={1440} height={900}><ScreenAdminGame /></ScaleHost>} />
        <Route path="/admin/game"    element={<ScaleHost width={1440} height={900}><ScreenAdminGame /></ScaleHost>} />
        <Route path="/admin/tags"    element={<ScaleHost width={1440} height={900}><ScreenAdminTags /></ScaleHost>} />
        <Route path="/admin/players" element={<ScaleHost width={1440} height={900}><ScreenAdminPlayers /></ScaleHost>} />
        <Route path="/admin/log"     element={<ScaleHost width={1440} height={900}><ScreenAdminLog /></ScaleHost>} />
      </Routes>
    </QuestCtx.Provider>
  );
}
