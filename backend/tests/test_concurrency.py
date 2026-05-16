"""
Concurrency tests: race conditions in one_time_global, one_time_per_player, and registration.
"""
import threading

from helpers import start_game, create_tag, register_player, scan_tag, make_player_id
from blueprints.game_api import rate_limiter


class TestConcurrentOneTimeGlobal:
    def test_concurrent_one_time_global_only_one_gets_points(self, app, admin_client, client):
        """Only one player should get points when two scan a one_time_global tag."""
        start_game(admin_client)
        tags = create_tag(admin_client, "one_time_global", {"points": 100})
        tag_id = tags[0]["id"]

        register_player(client, make_player_id("player-conc-a"), "ConcPlayerA")
        register_player(client, make_player_id("player-conc-b"), "ConcPlayerB")

        results = []

        def do_scan(player_id):
            with app.test_client() as c:
                r = scan_tag(c, player_id, tag_id)
                results.append(r.get_json())

        rate_limiter.clear()
        t1 = threading.Thread(target=do_scan, args=(make_player_id("player-conc-a"),))
        t2 = threading.Thread(target=do_scan, args=(make_player_id("player-conc-b"),))
        t1.start()
        t2.start()
        t1.join()
        t2.join()

        statuses = [r["status"] for r in results]
        assert statuses.count("ok") == 1, f"Expected exactly one 'ok', got: {statuses}"
        assert statuses.count("locked") == 1, f"Expected exactly one 'locked', got: {statuses}"


class TestConcurrentRegistration:
    def test_concurrent_register_same_nick_no_500(self, app):
        """Two simultaneous registrations with the same nick: one gets 201, the other 409 (not 500)."""
        results = []

        def do_register(player_id):
            with app.test_client() as c:
                r = c.post("/api/register", json={"player_id": player_id, "nick": "SameNick"})
                results.append(r.status_code)

        t1 = threading.Thread(target=do_register, args=(make_player_id("uuid-race-1"),))
        t2 = threading.Thread(target=do_register, args=(make_player_id("uuid-race-2"),))
        t1.start()
        t2.start()
        t1.join()
        t2.join()

        assert 201 in results, f"Expected one 201, got: {results}"
        assert all(s in (201, 409) for s in results), f"Expected 201/409 only, got: {results}"
        assert results.count(201) == 1, f"Expected exactly one 201, got: {results}"


class TestConcurrentUnlimited:
    def test_concurrent_unlimited_scans_all_award_points(self, app, admin_client, client):
        """20 players scanning the same unlimited tag concurrently: all get points, no lost updates."""
        start_game(admin_client)
        tags = create_tag(admin_client, "unlimited", {"points": 10})
        tag_id = tags[0]["id"]

        num_players = 20
        for i in range(num_players):
            register_player(client, make_player_id(f"player-unlim-{i}"), f"UnlimPlayer{i}")

        results = []

        def do_scan(player_id):
            with app.test_client() as c:
                r = scan_tag(c, player_id, tag_id)
                results.append(r.get_json())

        rate_limiter.clear()
        threads = [
            threading.Thread(target=do_scan, args=(make_player_id(f"player-unlim-{i}"),))
            for i in range(num_players)
        ]
        for t in threads:
            t.start()
        for t in threads:
            t.join()

        # All 20 must get status "ok"
        statuses = [r["status"] for r in results]
        assert statuses.count("ok") == num_players, f"Expected all 'ok', got: {statuses}"

        # Each player should have exactly 10 points on the scoreboard
        with app.test_client() as c:
            sb = c.get("/api/scoreboard").get_json()
        player_points = {p["nick"]: p["points"] for p in sb["players"]}
        for i in range(num_players):
            nick = f"UnlimPlayer{i}"
            assert player_points.get(nick) == 10, (
                f"{nick} expected 10 points, got {player_points.get(nick)}"
            )


class TestConcurrentOneTimePerPlayer:
    def test_same_player_scans_one_time_per_player_twice_concurrently(self, app, client, admin_client):
        """Same player scanning one_time_per_player concurrently should only get points once."""
        start_game(admin_client)
        tags = create_tag(admin_client, "one_time_per_player", {"points": 50})
        tag_id = tags[0]["id"]
        register_player(client, make_player_id("player-par-otp"), "ParOTP")

        results = []

        def do_scan():
            with app.test_client() as c:
                r = scan_tag(c, make_player_id("player-par-otp"), tag_id)
                results.append(r.get_json())

        rate_limiter.clear()
        t1 = threading.Thread(target=do_scan)
        t2 = threading.Thread(target=do_scan)
        t1.start()
        t2.start()
        t1.join()
        t2.join()

        statuses = [r["status"] for r in results]
        assert statuses.count("ok") == 1, f"Expected exactly one 'ok', got: {statuses}"
