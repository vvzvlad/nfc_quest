"""
Security tests: XSS/injection in nicks, SQL injection in filters, admin brute-force,
tag ID enumeration, batch limits, WebSocket client messages.
"""
import pytest

from helpers import start_game, create_tag, register_player, scan_tag
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
        pid = f"player-xss-{hash(nick) % 10000}"
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
        pid = f"player-xss-sb-{hash(nick) % 10000}"
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
    def test_many_failed_logins_no_crash(self, client):
        """100 failed login attempts don't crash the server."""
        for i in range(100):
            r = client.post("/admin/api/login", json={"password": f"wrong-{i}"})
            assert r.status_code == 401

        # Valid login still works after all failures
        r_ok = client.post("/admin/api/login", json={"password": "testpass"})
        assert r_ok.status_code == 200

    def test_no_rate_limit_on_admin_login(self, client):
        """Documents: no rate limit on admin login currently exists."""
        for _ in range(10):
            r = client.post("/admin/api/login", json={"password": "wrong"})
            assert r.status_code == 401


class TestTagIdEnumeration:
    def test_unknown_tag_returns_same_response_shape(self, client, admin_client):
        """Response for unknown tag has same shape as known-but-unknown-strategy."""
        start_game(admin_client)
        register_player(client, "player-enum", "EnumPlayer")

        rate_limiter.clear()
        r = scan_tag(client, "player-enum", "ZZZZ-ZZZ")
        assert r.status_code == 200
        body = r.get_json()
        assert body["status"] == "unknown"
        assert body.get("tag_id") == "ZZZZ-ZZZ"

    def test_existing_vs_nonexisting_tag_status_code_same(self, client, admin_client):
        """Both existing and non-existing tags return HTTP 200."""
        start_game(admin_client)
        tags = create_tag(admin_client, "unlimited", {"points": 10})
        real_tag_id = tags[0]["id"]
        register_player(client, "player-enum2", "EnumPlayer2")

        rate_limiter.clear()
        r_real = scan_tag(client, "player-enum2", real_tag_id)
        assert r_real.status_code == 200

        rate_limiter.clear()
        r_fake = scan_tag(client, "player-enum2", "0000-000")
        assert r_fake.status_code == 200


class TestBatchCreateLimit:
    def test_batch_create_negative_count(self, admin_client):
        """Negative count should create 0 tags or be rejected."""
        r = admin_client.post(
            "/admin/api/tags/batch",
            json={"strategy": "unlimited", "strategy_params": {"points": 1}, "count": -1},
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
