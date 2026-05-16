"""
Security tests: XSS/injection in nicks, SQL injection in filters, admin brute-force,
tag ID enumeration, batch limits, WebSocket client messages.
"""
import pytest
from datetime import datetime, timezone, timedelta

from helpers import start_game, create_tag, register_player, scan_tag, make_player_id
from blueprints.game_api import rate_limiter


class TestNickInjection:
    @pytest.mark.parametrize("nick", [
        '<script>alert(1)</script>',
        '💀hacker',
        "'; DROP TABLE players;--",
        '<img src=x onerror=alert(1)>',
    ])
    def test_register_xss_nick_stored_literally(self, client, nick):
        """Nicks with HTML/SQL injection are stored as-is without server crash."""
        pid = make_player_id(f"player-xss-{hash(nick) % 10000}")
        r = register_player(client, pid, nick)
        assert r.status_code == 201
        assert r.get_json()["nick"] == nick

    @pytest.mark.parametrize("nick", [
        '<script>alert(1)</script>',
        "'; DROP TABLE players;--",
    ])
    def test_xss_nick_on_scoreboard(self, client, admin_client, nick):
        """Nicks with injection content appear on scoreboard without being interpreted."""
        start_game(admin_client)
        pid = make_player_id(f"player-xss-sb-{hash(nick) % 10000}")
        register_player(client, pid, nick)

        sb = client.get("/api/scoreboard").get_json()
        nicks = [p["nick"] for p in sb["players"]]
        assert nick in nicks


class TestSQLInjectionLogFilters:
    @pytest.mark.parametrize("param,value", [
        ("player_id", "'; DROP TABLE players;--"),
        ("player_id", "1 OR 1=1"),
        ("tag_id", "'; DROP TABLE tags;--"),
        ("result", "ok' OR '1'='1"),
    ])
    def test_log_filter_sql_injection(self, admin_client, param, value):
        """SQL injection attempts in log filters should not crash or leak data."""
        r = admin_client.get(f"/admin/api/log?{param}={value}")
        assert r.status_code == 200
        body = r.get_json()
        assert "items" in body
        assert body["items"] == []


class TestAdminBruteForce:
    def test_login_rate_limit_kicks_in_after_5_attempts(self, client):
        """After 5 failed logins within 60s, further attempts get 429."""
        from blueprints.admin_api import _login_attempts
        _login_attempts.clear()

        for i in range(5):
            r = client.post("/admin/api/login", json={"password": f"wrong-{i}"})
            assert r.status_code == 401

        # 6th attempt should be rate-limited
        r = client.post("/admin/api/login", json={"password": "wrong-6"})
        assert r.status_code == 429
        assert r.get_json()["error"] == "LOGIN_RATE_LIMIT"

    def test_login_rate_limit_does_not_block_correct_password_before_limit(self, client):
        """Correct password succeeds if under the rate limit threshold."""
        from blueprints.admin_api import _login_attempts
        _login_attempts.clear()

        # 4 failed attempts (under limit of 5)
        for i in range(4):
            client.post("/admin/api/login", json={"password": f"wrong-{i}"})

        # Correct password on 5th attempt should still work
        r_ok = client.post("/admin/api/login", json={"password": "testpass"})
        assert r_ok.status_code == 200

    def test_login_rate_limit_does_not_block_correct_password(self, client):
        """After rate limit is exhausted, correct password still succeeds (DoS protection)."""
        from blueprints.admin_api import _login_attempts
        _login_attempts.clear()

        for i in range(5):
            client.post("/admin/api/login", json={"password": f"wrong-{i}"})

        # Correct password should succeed even after exhausting the rate limit
        r = client.post("/admin/api/login", json={"password": "testpass"})
        assert r.status_code == 200
        assert r.get_json()["ok"] is True

    def test_login_rate_limit_resets_after_window(self, client):
        """After the rate limit window expires, login attempts work again."""
        from blueprints.admin_api import _login_attempts, LOGIN_RATE_LIMIT_WINDOW
        _login_attempts.clear()

        # Exhaust the limit
        for i in range(5):
            client.post("/admin/api/login", json={"password": f"wrong-{i}"})

        # Simulate time passing by backdating all attempts
        ip = "127.0.0.1"
        past = datetime.now(timezone.utc) - timedelta(seconds=LOGIN_RATE_LIMIT_WINDOW + 1)
        _login_attempts[ip] = [past] * 5

        # Should work now
        r = client.post("/admin/api/login", json={"password": "testpass"})
        assert r.status_code == 200

    def test_successful_login_clears_attempt_counter(self, client):
        """Successful login resets the failed attempt counter for that IP."""
        from blueprints.admin_api import _login_attempts
        _login_attempts.clear()

        # 3 failed attempts
        for i in range(3):
            client.post("/admin/api/login", json={"password": f"wrong-{i}"})

        # Successful login
        r = client.post("/admin/api/login", json={"password": "testpass"})
        assert r.status_code == 200

        # Logout and try 5 more wrong passwords — counter should have reset
        client.post("/admin/api/logout")
        for i in range(5):
            r = client.post("/admin/api/login", json={"password": f"wrong-again-{i}"})
            assert r.status_code == 401

        # 6th after reset — NOW it should be rate-limited
        r = client.post("/admin/api/login", json={"password": "wrong-final"})
        assert r.status_code == 429

    def test_login_rate_limit_uses_x_forwarded_for(self, app):
        """Rate limit buckets are per real client IP via X-Forwarded-For, not proxy IP."""
        from blueprints.admin_api import _login_attempts
        _login_attempts.clear()

        client_a = app.test_client()
        client_b = app.test_client()

        # Client A (IP 1.1.1.1) exhausts rate limit
        for i in range(5):
            r = client_a.post(
                "/admin/api/login",
                json={"password": f"wrong-{i}"},
                headers={"X-Forwarded-For": "1.1.1.1"},
            )
            assert r.status_code == 401

        # Client A is now blocked
        r = client_a.post(
            "/admin/api/login",
            json={"password": "wrong-6"},
            headers={"X-Forwarded-For": "1.1.1.1"},
        )
        assert r.status_code == 429

        # Client B (IP 2.2.2.2) is NOT blocked — independent bucket
        r = client_b.post(
            "/admin/api/login",
            json={"password": "testpass"},
            headers={"X-Forwarded-For": "2.2.2.2"},
        )
        assert r.status_code == 200


class TestTagIdEnumeration:
    def test_unknown_tag_returns_same_response_shape(self, client, admin_client):
        """Response for unknown tag has same shape as known-but-unknown-strategy."""
        start_game(admin_client)
        register_player(client, make_player_id("player-enum"), "EnumPlayer")

        rate_limiter.clear()
        r = scan_tag(client, make_player_id("player-enum"), "ZZZZ-ZZZ")
        assert r.status_code == 200
        body = r.get_json()
        assert body["status"] == "unknown"
        assert body.get("tag_id") == "ZZZZ-ZZZ"

    def test_existing_vs_nonexisting_tag_status_code_same(self, client, admin_client):
        """Both existing and non-existing tags return HTTP 200."""
        start_game(admin_client)
        tags = create_tag(admin_client, "random", {"min": 10, "max": 10})
        real_tag_id = tags[0]["id"]
        register_player(client, make_player_id("player-enum2"), "EnumPlayer2")

        rate_limiter.clear()
        r_real = scan_tag(client, make_player_id("player-enum2"), real_tag_id)
        assert r_real.status_code == 200

        rate_limiter.clear()
        r_fake = scan_tag(client, make_player_id("player-enum2"), "0000-000")
        assert r_fake.status_code == 200


class TestBatchCreateLimit:
    def test_batch_create_negative_count(self, admin_client):
        """Negative count should create 0 tags or be rejected."""
        r = admin_client.post(
            "/admin/api/tags/batch",
            json={"strategy": "random", "strategy_params": {"min": 1, "max": 1}, "count": -1},
        )
        if r.status_code == 201:
            assert r.get_json()["items"] == []
        else:
            assert r.status_code == 400


class TestWebSocketClientMessages:
    def test_ws_client_emit_does_not_crash_server(self, app, ws_client):
        """Client sending arbitrary events to server should not crash."""
        ws_client.emit("scoreboard_update", {"malicious": True})
        ws_client.emit("nonexistent_event", {"data": "test"})
        # Server is still alive
        ws_client.get_received()
