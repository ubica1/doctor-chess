import os, tempfile, threading, json, urllib.request, http.cookiejar, unittest, time, importlib.util
from pathlib import Path

TEMP = tempfile.TemporaryDirectory()
os.environ["DOCTOR_CHESS_DB"] = str(Path(TEMP.name) / "test.sqlite3")
import server

httpd = server.ThreadingHTTPServer(("127.0.0.1", 0), server.Handler)
threading.Thread(target=httpd.serve_forever, daemon=True).start()
BASE = f"http://127.0.0.1:{httpd.server_port}"


def client():
    return urllib.request.build_opener(
        urllib.request.HTTPCookieProcessor(http.cookiejar.CookieJar())
    )


def call(c, path, data=None):
    req = urllib.request.Request(
        BASE + "/api/" + path,
        data=None if data is None else json.dumps(data).encode(),
        headers={"Content-Type": "application/json", "Origin": BASE},
    )
    try:
        with c.open(req) as r:
            return r.status, json.load(r)
    except urllib.error.HTTPError as e:
        with e:
            return e.code, json.load(e)


class Integration(unittest.TestCase):
    def test_complete_flow(self):
        a, b, anon = client(), client(), client()
        self.assertEqual(call(anon, "queue", {"control": "5+0"})[0], 401)
        self.assertEqual(
            call(a, "register", {"username": "Alpha", "password": "test-pass-123"})[0],
            200,
        )
        self.assertEqual(
            call(b, "register", {"username": "Beta", "password": "test-pass-123"})[0],
            200,
        )
        self.assertEqual(
            call(anon, "register", {"username": "Alpha", "password": "test-pass-123"})[
                0
            ],
            409,
        )
        self.assertEqual(
            call(a, "profile", {"bio": "I love chess"})[1]["user"]["bio"],
            "I love chess",
        )
        self.assertTrue(call(a, "queue", {"control": "5+0"})[1]["queued"])
        g = call(b, "queue", {"control": "5+0"})[1]["game"]
        gid = g["id"]
        ga = call(a, "state")[1]["game"]
        self.assertEqual(ga["id"], gid)
        self.assertEqual(call(anon, "games/" + gid)[0], 404)
        white = a if ga["you"] == "w" else b
        black = b if white == a else a
        self.assertEqual(
            call(black, "move", {"game": gid, "from": 12, "to": 28})[0], 409
        )
        self.assertEqual(
            call(white, "move", {"game": gid, "from": 52, "to": 20})[0], 400
        )
        for c, i, j in [
            (white, 53, 45),
            (black, 12, 28),
            (white, 54, 38),
            (black, 3, 39),
        ]:
            code, out = call(c, "move", {"game": gid, "from": i, "to": j})
            self.assertEqual(code, 200, out)
        self.assertEqual(out["game"]["result"], "b")
        self.assertEqual(out["game"]["reason"], "Чёрные победили. Мат.")
        code, review = call(anon, "games/" + gid)
        self.assertEqual(code, 200)
        self.assertEqual(len(review["game"]["moves"]), 4)
        self.assertNotIn("payload", review["game"])
        self.assertNotIn("password", json.dumps(review))
        with anon.open(BASE + "/review/" + gid) as r:
            self.assertEqual(r.status, 200)
        self.assertEqual(
            call(white, "me")[1]["user"]["ratings"]["blitz"]["rating"], 1188
        )
        self.assertEqual(
            call(black, "me")[1]["user"]["ratings"]["blitz"]["rating"], 1212
        )
        call(white, "resign", {"game": gid})
        self.assertEqual(call(black, "me")[1]["user"]["ratings"]["blitz"]["played"], 1)
        self.assertEqual(call(a, "leaderboard")[1]["blitz"][0]["rating"], 1212)
        self.assertEqual(call(a, "me")[1]["user"]["ratings"]["rapid"]["played"], 0)
        call(a, "queue", {"control": "10+0"})
        g = call(b, "queue", {"control": "10+0"})[1]["game"]
        gid = g["id"]
        self.assertIsNone(call(a, "draw", {"game": gid})[1]["game"]["result"])
        self.assertEqual(call(b, "draw", {"game": gid})[1]["game"]["result"], "draw")
        call(a, "queue", {"control": "1+0"})
        g = call(b, "queue", {"control": "1+0"})[1]["game"]
        gid = g["id"]
        with server.lock:
            p = server.game_row(gid)["payload"]
            p["tick"] = time.time() - 70
            server.db.execute(
                "UPDATE games SET payload=? WHERE id=?", (json.dumps(p), gid)
            )
        self.assertEqual(call(a, "state")[1]["game"]["result"], "b")
        call(a, "queue", {"control": "3+2"})
        self.assertTrue(call(a, "state")[1]["queued"])
        call(a, "cancel", {})
        self.assertFalse(call(a, "state")[1]["queued"])
        self.assertEqual(call(a, "logout", {})[0], 200)
        self.assertIsNone(call(a, "me")[1]["user"])
        self.assertEqual(
            call(a, "login", {"username": "Alpha", "password": "incorrect"})[0], 401
        )
        self.assertEqual(
            call(a, "login", {"username": "Alpha", "password": "test-pass-123"})[1][
                "user"
            ]["bio"],
            "I love chess",
        )
        self.assertNotIn("password", call(a, "me")[1]["user"])
        self.assertEqual(call(anon, "profile", {"bio": "changed"})[0], 401)
        self.assertEqual(
            call(
                a, "profile", {"bio": "<script>alert(1)</script>", "avatar": "bamboo"}
            )[0],
            200,
        )
        self.assertEqual(call(a, "profile", {"avatar": "invalid"})[0], 400)
        code, out = call(anon, "players/Alpha")
        self.assertEqual(code, 200)
        p = out["player"]
        self.assertEqual(p["avatar"], "bamboo")
        self.assertEqual(p["stats"]["played"], 3)
        self.assertEqual(sum(p["stats"][k] for k in ["wins", "draws", "losses"]), 3)
        self.assertEqual(len(p["games"]), 3)
        self.assertEqual(
            set(p),
            {
                "id",
                "username",
                "bio",
                "created",
                "avatar",
                "ratings",
                "stats",
                "games",
                "page",
                "total_games",
            },
        )
        self.assertNotIn("password", json.dumps(out))
        self.assertNotIn("salt", json.dumps(out))
        self.assertEqual(
            call(anon, "players/Alpha?category=rapid")[1]["player"]["total_games"], 1
        )
        self.assertEqual(call(anon, "players/Alpha?page=2")[1]["player"]["games"], [])
        self.assertEqual(call(anon, "players/nobody")[0], 404)
        self.assertEqual(call(anon, "players/Alpha?page=bad")[0], 400)
        self.assertEqual(
            call(anon, "players?search=Alpha")[1]["players"][0]["username"], "Alpha"
        )
        with anon.open(BASE + "/player/Alpha") as r:
            html = r.read().decode()
            self.assertEqual(r.status, 200)
        self.assertRegex(html, r'src="/community\.js(?:\?[^\"]+)?"')
        with anon.open(BASE + "/academy") as r:
            self.assertIn('src="/academy.js', r.read().decode())
        with anon.open(BASE + "/vendor/stockfish/stockfish-19-lite-single.wasm") as r:
            self.assertEqual(r.headers.get_content_type(), "application/wasm")
            self.assertEqual(r.read()[:4], b"\x00asm")


class SocialGames(unittest.TestCase):
    def setUp(self):
        with server.lock:
            server.failures.clear()
        suffix = server.secrets.token_hex(4)
        self.host, self.guest, self.other, self.anon = (
            client(),
            client(),
            client(),
            client(),
        )
        self.names = []
        for c, prefix in [
            (self.host, "Host"),
            (self.guest, "Guest"),
            (self.other, "Other"),
        ]:
            name = prefix + "_" + suffix
            self.names.append(name)
            status, out = call(
                c, "register", {"username": name, "password": "social-test-pass"}
            )
            self.assertEqual(status, 200, out)

    def create(self, control="3+2", color="w"):
        status, out = call(
            self.host, "challenges", {"control": control, "color": color}
        )
        self.assertEqual(status, 200, out)
        return out["challenge"]

    def casual(self):
        invitation = self.create()
        status, out = call(self.guest, "challenges/" + invitation["id"] + "/join", {})
        self.assertEqual(status, 200, out)
        return out["game"]

    def test_targeted_invitation_rejects_other_players(self):
        status, out = call(
            self.host,
            "challenges",
            {"control": "3+2", "color": "w", "opponent": self.names[1].lower()},
        )
        self.assertEqual(status, 200, out)
        token = out["challenge"]["id"]
        self.assertEqual(out["challenge"]["target"], self.names[1])
        self.assertFalse(
            call(self.other, "challenges/" + token)[1]["challenge"]["can_join"]
        )
        self.assertEqual(call(self.other, "challenges/" + token + "/join", {})[0], 403)
        self.assertEqual(call(self.anon, "challenges/" + token + "/join", {})[0], 401)
        self.assertEqual(call(self.guest, "challenges/" + token + "/join", {})[0], 200)
        self.assertEqual(
            call(
                self.other, "challenges", {"control": "3+2", "opponent": self.names[2]}
            )[0],
            400,
        )
        self.assertEqual(
            call(self.other, "challenges", {"control": "3+2", "opponent": {}})[0], 400
        )

    def test_takeback_consent_clocks_and_stale_actions(self):
        g = self.casual()
        gid = g["id"]
        call(self.host, "move", {"game": gid, "from": 52, "to": 36})
        status, out = call(self.host, "takeback-request", {"game": gid, "ply": 1})
        self.assertEqual(status, 200, out)
        offer = out["game"]["takeback"]["id"]
        self.assertEqual(
            call(self.host, "takeback-request", {"game": gid, "ply": 1})[1]["game"][
                "takeback"
            ]["id"],
            offer,
        )
        self.assertEqual(
            call(self.host, "takeback-accept", {"game": gid, "offer": offer})[0], 403
        )
        self.assertEqual(
            call(self.other, "takeback-accept", {"game": gid, "offer": offer})[0], 404
        )
        call(self.guest, "draw", {"game": gid})
        self.assertEqual(
            call(self.host, "draw-decline", {"game": gid})[1]["game"]["takeback"]["id"],
            offer,
        )
        with server.lock:
            row = server.game_row(gid)
            p = row["payload"]
            p["clocks"] = {"w": 100, "b": 90}
            p["tick"] = time.time() - 3
            server.db.execute(
                "UPDATE games SET payload=? WHERE id=?", (json.dumps(p), gid)
            )
        status, out = call(self.guest, "takeback-accept", {"game": gid, "offer": offer})
        self.assertEqual(status, 200, out)
        restored = out["game"]
        self.assertEqual(restored["moves"], [])
        self.assertEqual(restored["last"], [])
        self.assertEqual(restored["state"], server.INITIAL)
        self.assertLessEqual(restored["clocks"]["w"], 98)
        self.assertLessEqual(restored["clocks"]["b"], 87)
        self.assertIsNone(restored["takeback"])
        self.assertEqual(
            call(self.guest, "takeback-accept", {"game": gid, "offer": offer})[0], 409
        )
        self.assertEqual(
            call(self.host, "move", {"game": gid, "from": 51, "to": 35})[0], 200
        )
        _, out = call(self.host, "takeback-request", {"game": gid, "ply": 1})
        offer = out["game"]["takeback"]["id"]
        call(self.guest, "move", {"game": gid, "from": 12, "to": 28})
        self.assertIsNone(call(self.host, "play/" + gid)[1]["game"]["takeback"])
        self.assertEqual(
            call(self.guest, "takeback-accept", {"game": gid, "offer": offer})[0], 409
        )
        _, out = call(self.guest, "takeback-request", {"game": gid, "ply": 2})
        offer = out["game"]["takeback"]["id"]
        self.assertEqual(
            call(self.host, "takeback-decline", {"game": gid, "offer": offer})[0], 200
        )
        self.assertEqual(
            call(self.guest, "takeback-request", {"game": gid, "ply": 2})[0], 409
        )
        self.assertEqual(
            call(self.host, "me")[1]["user"]["ratings"]["blitz"]["played"], 0
        )

    def test_simultaneous_takeback_acceptance_undoes_exactly_once(self):
        from concurrent.futures import ThreadPoolExecutor

        g = self.casual()
        call(self.host, "move", {"game": g["id"], "from": 52, "to": 36})
        offer = call(self.host, "takeback-request", {"game": g["id"], "ply": 1})[1][
            "game"
        ]["takeback"]["id"]
        barrier = threading.Barrier(2)

        def accept():
            barrier.wait()
            return call(
                self.guest, "takeback-accept", {"game": g["id"], "offer": offer}
            )[0]

        with ThreadPoolExecutor(max_workers=2) as pool:
            answers = list(pool.map(lambda _: accept(), range(2)))
        self.assertEqual(sorted(answers), [200, 409])
        self.assertEqual(call(self.host, "play/" + g["id"])[1]["game"]["moves"], [])

    def test_time_gifts_are_idempotent_limited_and_cannot_revive_game(self):
        g = self.casual()
        gid = g["id"]
        payload = {"game": gid, "token": "retry-token-0001"}
        status, out = call(self.host, "give-time", payload)
        self.assertEqual(status, 200, out)
        self.assertEqual(out["game"]["clocks"]["b"], 195)
        self.assertEqual(out["game"]["giftsLeft"], 19)
        out = call(self.host, "give-time", payload)[1]
        self.assertEqual(out["game"]["clocks"]["b"], 195)
        self.assertEqual(out["game"]["giftsLeft"], 19)
        self.assertEqual(call(self.other, "give-time", payload)[0], 404)
        self.assertEqual(
            call(self.host, "give-time", {"game": gid, "token": []})[0], 400
        )
        for n in range(19):
            self.assertEqual(
                call(self.host, "give-time", {"game": gid, "token": f"gift-{n:08d}"})[
                    0
                ],
                200,
            )
        self.assertEqual(
            call(self.host, "give-time", {"game": gid, "token": "limit-token-0001"})[0],
            409,
        )
        self.assertEqual(call(self.host, "give-time", payload)[0], 200)
        with server.lock:
            row = server.game_row(gid)
            p = row["payload"]
            p["tick"] = time.time() - 1000
            server.db.execute(
                "UPDATE games SET payload=? WHERE id=?", (json.dumps(p), gid)
            )
        self.assertEqual(
            call(self.guest, "give-time", {"game": gid, "token": "no-revival-token"})[
                0
            ],
            409,
        )
        self.assertEqual(call(self.host, "play/" + gid)[1]["game"]["result"], "b")
        call(self.host, "queue", {"control": "3+2"})
        rated = call(self.guest, "queue", {"control": "3+2"})[1]["game"]
        self.assertEqual(
            call(
                self.host,
                "give-time",
                {"game": rated["id"], "token": "rated-token-0001"},
            )[0],
            403,
        )
        self.assertEqual(
            call(self.guest, "takeback-request", {"game": rated["id"], "ply": 0})[0],
            403,
        )

    def test_presence_and_live_lobby_expire_without_names(self):
        call(self.host, "queue", {"control": "30+0"})
        status, out = call(self.anon, "lobby")
        self.assertEqual(status, 200)
        self.assertGreaterEqual(out["waiting"]["30+0"], 1)
        self.assertNotIn(self.names[0], json.dumps(out))
        g = call(self.guest, "queue", {"control": "30+0"})[1]["game"]
        self.assertTrue(all(g["presence"].values()))
        with server.lock:
            host_id = server.db.execute(
                "SELECT id FROM users WHERE username=?", (self.names[0],)
            ).fetchone()[0]
            server.presence.seen[host_id] = time.time() - 25
        g = call(self.guest, "state")[1]["game"]
        host_side = "b" if g["you"] == "w" else "w"
        self.assertFalse(g["presence"][host_side])
        call(self.host, "state")
        self.assertTrue(call(self.guest, "state")[1]["game"]["presence"][host_side])
        with server.lock:
            service = server.Presence()
            service.touch("a", 100)
            self.assertTrue(service.online("a", 119))
            self.assertFalse(service.online("a", 121))
            service.touch(None, 140)
            self.assertEqual(service.seen, {})

    def test_private_game_room_restores_only_participants(self):
        g = self.casual()
        endpoint = "play/" + g["id"]
        self.assertEqual(call(self.anon, endpoint)[0], 401)
        self.assertEqual(call(self.other, endpoint)[0], 404)
        self.assertEqual(call(self.host, "play/missing")[0], 404)
        for c, side in [(self.host, "w"), (self.guest, "b")]:
            status, out = call(c, endpoint)
            self.assertEqual(status, 200)
            self.assertEqual(out["game"]["id"], g["id"])
            self.assertEqual(out["game"]["you"], side)
        call(self.host, "move", {"game": g["id"], "from": 52, "to": 36})
        self.assertEqual(len(call(self.guest, endpoint)[1]["game"]["moves"]), 1)
        call(self.guest, "resign", {"game": g["id"]})
        self.assertEqual(call(self.host, endpoint)[1]["game"]["result"], "w")
        for route in ["/game/" + g["id"], "/play/computer"]:
            with self.anon.open(BASE + route) as response:
                self.assertEqual(response.status, 200)
                self.assertIn(b'id="room-heading"', response.read())

    def test_casual_invitation_has_one_guest_and_no_elo(self):
        invitation = self.create()
        token = invitation["id"]
        status, public = call(self.anon, "challenges/" + token)
        self.assertEqual(status, 200)
        self.assertFalse(public["challenge"]["participant"])
        self.assertNotIn("password", json.dumps(public))
        self.assertNotIn("salt", json.dumps(public))
        self.assertEqual(call(self.anon, "challenges/" + token + "/join", {})[0], 401)
        self.assertEqual(call(self.host, "challenges/" + token + "/join", {})[0], 409)
        status, out = call(self.guest, "challenges/" + token + "/join", {})
        self.assertEqual(status, 200, out)
        g = out["game"]
        self.assertEqual(g["kind"], "casual")
        self.assertEqual(g["you"], "b")
        self.assertEqual(
            call(self.guest, "challenges/" + token + "/join", {})[1]["game"]["id"],
            g["id"],
        )
        self.assertEqual(call(self.other, "challenges/" + token + "/join", {})[0], 409)
        self.assertEqual(call(self.host, "state")[1]["game"]["id"], g["id"])
        self.assertEqual(call(self.anon, "games/" + g["id"])[0], 404)
        self.assertEqual(call(self.host, "challenges/" + token + "/cancel", {})[0], 409)
        status, out = call(self.host, "move", {"game": g["id"], "from": 52, "to": 36})
        self.assertEqual(status, 200, out)
        self.assertGreater(out["game"]["clocks"]["w"], 180)
        call(self.guest, "resign", {"game": g["id"]})
        for c in [self.host, self.guest]:
            rating = call(c, "me")[1]["user"]["ratings"]["blitz"]
            self.assertEqual(rating["rating"], 1200)
            self.assertEqual(rating["played"], 0)
        self.assertEqual(
            call(self.anon, "players/" + self.names[0])[1]["player"]["stats"]["played"],
            1,
        )
        self.assertEqual(
            call(self.anon, "games/" + g["id"])[1]["game"]["kind"], "casual"
        )
        with server.lock:
            self.assertEqual(
                server.db.execute(
                    "SELECT COUNT(*) FROM games WHERE id=?", (g["id"],)
                ).fetchone()[0],
                1,
            )

    def test_expiry_cancellation_and_busy_player(self):
        invitation = self.create()
        token = invitation["id"]
        with server.lock:
            server.db.execute(
                "UPDATE challenges SET expires=? WHERE id=?", (time.time() - 1, token)
            )
        self.assertEqual(
            call(self.anon, "challenges/" + token)[1]["challenge"]["status"], "expired"
        )
        self.assertEqual(call(self.guest, "challenges/" + token + "/join", {})[0], 410)
        invitation = self.create()
        token = invitation["id"]
        self.assertEqual(
            call(self.other, "challenges/" + token + "/cancel", {})[0], 404
        )
        self.assertEqual(
            call(self.host, "challenges/" + token + "/cancel", {})[1]["challenge"][
                "status"
            ],
            "cancelled",
        )
        self.assertEqual(call(self.guest, "challenges/" + token + "/join", {})[0], 410)
        invitation = self.create()
        token = invitation["id"]
        third = call(self.other, "challenges", {"control": "5+0", "color": "b"})[1][
            "challenge"
        ]
        busy = call(self.guest, "challenges/" + third["id"] + "/join", {})[1]["game"]
        self.assertEqual(call(self.guest, "challenges/" + token + "/join", {})[0], 409)
        self.assertEqual(
            call(self.anon, "challenges/" + token)[1]["challenge"]["status"], "pending"
        )
        call(self.guest, "resign", {"game": busy["id"]})
        newer = self.create()
        self.assertNotEqual(newer["id"], token)
        self.assertEqual(
            call(self.anon, "challenges/" + token)[1]["challenge"]["status"],
            "cancelled",
        )

    def test_rematch_requires_both_players_and_switches_colors(self):
        g = self.casual()
        gid = g["id"]
        self.assertEqual(call(self.host, "games/" + gid + "/rematch", {})[0], 409)
        call(self.guest, "resign", {"game": gid})
        status, out = call(self.host, "games/" + gid + "/rematch", {})
        self.assertEqual(status, 200, out)
        offer = out["challenge"]
        self.assertTrue(offer["own"])
        self.assertEqual(
            call(self.host, "games/" + gid + "/rematch", {})[1]["challenge"]["id"],
            offer["id"],
        )
        self.assertFalse(call(self.guest, "state")[1]["game"]["rematch"]["own"])
        self.assertEqual(
            call(self.other, "challenges/" + offer["id"] + "/join", {})[0], 403
        )
        self.assertEqual(call(self.other, "games/" + gid + "/rematch", {})[0], 404)
        status, out = call(self.guest, "games/" + gid + "/rematch", {})
        self.assertEqual(status, 200, out)
        again = out["game"]
        self.assertEqual(again["you"], "w")
        self.assertEqual(again["kind"], "casual")
        self.assertEqual(again["control"], "3+2")
        self.assertNotEqual(again["id"], gid)
        self.assertEqual(call(self.host, "state")[1]["game"]["you"], "b")
        self.assertEqual(
            call(self.guest, "games/" + gid + "/rematch", {})[1]["game"]["id"],
            again["id"],
        )
        call(self.host, "resign", {"game": again["id"]})
        self.assertEqual(
            call(self.host, "me")[1]["user"]["ratings"]["blitz"]["played"], 0
        )

    def test_rated_rematch_preserves_rating_rules(self):
        call(self.host, "queue", {"control": "5+0"})
        g = call(self.guest, "queue", {"control": "5+0"})[1]["game"]
        gid = g["id"]
        old_white = g["white"]["id"]
        ended = call(self.guest, "resign", {"game": gid})[1]["game"]
        change = ended["ratingChange"][ended["you"]]
        self.assertEqual(change["delta"], -12)
        self.assertEqual(change["after"], change["before"] - 12)
        self.assertEqual(
            call(self.guest, "state")[1]["game"]["ratingChange"], ended["ratingChange"]
        )
        call(self.host, "games/" + gid + "/rematch", {})
        new = call(self.guest, "games/" + gid + "/rematch", {})[1]["game"]
        self.assertEqual(new["kind"], "rated")
        self.assertEqual(new["black"]["id"], old_white)
        call(self.guest, "resign", {"game": new["id"]})
        self.assertEqual(
            call(self.host, "me")[1]["user"]["ratings"]["blitz"]["played"], 2
        )

    def test_draw_decline_and_flagged_clock(self):
        g = self.casual()
        gid = g["id"]
        call(self.host, "draw", {"game": gid})
        self.assertIsNone(
            call(self.guest, "draw-decline", {"game": gid})[1]["game"]["offer"]
        )
        self.assertIsNone(call(self.host, "state")[1]["game"]["result"])
        with server.lock:
            p = server.game_row(gid)["payload"]
            p["tick"] = time.time() - 500
            server.db.execute(
                "UPDATE games SET payload=? WHERE id=?", (json.dumps(p), gid)
            )
        finished = call(self.host, "state")[1]["game"]
        self.assertEqual(finished["result"], "b")
        self.assertEqual(finished["clocks"]["w"], 0)

    def test_simultaneous_guests_cannot_create_two_games(self):
        from concurrent.futures import ThreadPoolExecutor

        token = self.create()["id"]
        with ThreadPoolExecutor(max_workers=2) as pool:
            results = list(
                pool.map(
                    lambda c: call(c, "challenges/" + token + "/join", {}),
                    [self.guest, self.other],
                )
            )
        self.assertEqual(sorted(status for status, _ in results), [200, 409])
        host_id = call(self.host, "me")[1]["user"]["id"]
        with server.lock:
            row = server.db.execute(
                "SELECT game_id FROM challenges WHERE id=?", (token,)
            ).fetchone()
            self.assertIsNotNone(row["game_id"])
            self.assertEqual(
                server.db.execute(
                    "SELECT COUNT(*) FROM games WHERE white=? OR black=?",
                    (host_id, host_id),
                ).fetchone()[0],
                1,
            )


class ReviewRegressions(unittest.TestCase):
    def setUp(self):
        with server.lock:
            server.failures.clear()
        self.white, self.black = client(), client()
        self.ids = []
        for c in (self.white, self.black):
            name = "Review" + server.secrets.token_hex(5)
            code, body = call(
                c, "register", {"username": name, "password": "test-pass-123"}
            )
            self.assertEqual(code, 200)
            self.ids.append(body["user"]["id"])

    def game(self, board=None, seconds=180, elapsed=0, kind="rated"):
        with server.lock:
            g = server.club.new_game(*self.ids, "3+0", kind)
            p = g["payload"]
            if board:
                p["state"]["b"] = [None] * 64
                p["state"]["rights"] = ""
                for square, piece in board.items():
                    p["state"]["b"][square] = piece
            p["clocks"]["w"] = seconds
            p["tick"] = time.time() - elapsed
            server.db.execute(
                "UPDATE games SET payload=? WHERE id=?", (json.dumps(p), g["id"])
            )
            return g["id"]

    def test_clock_at_request_receipt_and_stable_completion(self):
        from unittest.mock import patch

        original = server.subprocess.run

        def slow(*args, **kwargs):
            time.sleep(0.5)
            return original(*args, **kwargs)

        gid = self.game({60: "K", 56: "R", 4: "k"}, seconds=0.3)
        with patch.object(server.subprocess, "run", side_effect=slow):
            code, body = call(self.white, "move", {"game": gid, "from": 56, "to": 48})
        self.assertEqual(code, 200, body)
        self.assertIsNone(body["game"]["result"])
        self.assertGreater(body["game"]["clocks"]["w"], 0)
        self.assertEqual(len(body["game"]["moves"]), 1)
        gid = self.game({60: "K", 56: "R", 4: "k"}, seconds=0.01, elapsed=1)
        body = call(self.white, "move", {"game": gid, "from": 56, "to": 48})[1]["game"]
        self.assertEqual(body["result"], "draw")
        self.assertEqual(body["clocks"]["w"], 0)
        self.assertEqual(body["moves"], [])
        before = call(self.white, "me")[1]["user"]["ratings"]
        call(self.white, "resign", {"game": gid})
        self.assertEqual(call(self.white, "me")[1]["user"]["ratings"], before)

    def test_timeout_material_and_old_dead_positions(self):
        # Winner is black; enemy material can permit a mating net.
        cases = [
            ({60: "K", 4: "k", 0: "r"}, "b"),
            ({60: "K", 4: "k", 2: "b"}, "draw"),
            ({60: "K", 4: "k", 1: "n"}, "draw"),
            ({60: "K", 48: "P", 4: "k", 2: "b"}, "b"),
            ({60: "K", 56: "R", 4: "k", 1: "n"}, "b"),
            ({60: "K", 61: "B", 4: "k", 2: "b"}, "draw"),
            ({60: "K", 58: "B", 4: "k", 2: "b"}, "b"),
        ]
        for board, result in cases:
            with self.subTest(board=board):
                gid = self.game(board, seconds=1, elapsed=2)
                g = call(self.white, "resign", {"game": gid})[1]["game"]
                self.assertEqual(g["result"], result)
                self.assertEqual(g["reason"], "Время вышло")
                self.assertEqual(g["clocks"]["w"], 0)
        gid = self.game({60: "K", 4: "k", 2: "b"})
        g = call(self.white, "state")[1]["game"]
        self.assertEqual(g["id"], gid)
        self.assertEqual(g["result"], "draw")

    def test_resign_draw_clocks_persist_for_rated_and_casual(self):
        for kind in ("rated", "casual"):
            for action in ("resign", "draw"):
                gid = self.game(elapsed=10, kind=kind)
                if action == "draw":
                    call(self.black, "draw", {"game": gid})
                g = call(self.white, action, {"game": gid})[1]["game"]
                self.assertAlmostEqual(g["clocks"]["w"], 170, delta=0.5)
                self.assertEqual(
                    call(self.white, "state")[1]["game"]["clocks"], g["clocks"]
                )
                with server.lock:
                    payload = json.loads(
                        server.db.execute(
                            "SELECT payload FROM games WHERE id=?", (gid,)
                        ).fetchone()[0]
                    )
                self.assertEqual(payload["clocks"], g["clocks"])

    def test_unicode_identity_and_typed_fields(self):
        from urllib.parse import quote

        c = client()
        self.assertEqual(
            call(c, "register", {"username": "Шахматист", "password": "  pass-123  "})[
                0
            ],
            200,
        )
        self.assertEqual(
            call(
                client(), "login", {"username": "шахматист", "password": "  pass-123  "}
            )[0],
            200,
        )
        self.assertEqual(
            call(
                client(), "register", {"username": "ШАХМАТИСТ", "password": "password1"}
            )[0],
            409,
        )
        self.assertEqual(
            call(c, "players/" + quote("шахматист"))[1]["player"]["username"],
            "Шахматист",
        )
        self.assertEqual(
            call(c, "players?search=" + quote("шахматист"))[1]["players"][0][
                "username"
            ],
            "Шахматист",
        )
        for value in (None, True, 12345678, [], {}):
            for route, fields in (
                ("register", ("username", "password")),
                ("login", ("username", "password")),
                ("profile", ("bio", "avatar")),
            ):
                for field in fields:
                    with self.subTest(route=route, field=field, value=value):
                        with server.lock:
                            server.failures.clear()
                            before = [
                                server.db.execute(
                                    "SELECT COUNT(*) FROM " + table
                                ).fetchone()[0]
                                for table in ("users", "sessions")
                            ]
                        original_profile = call(c, "me")[1]["user"]
                        data = (
                            {"username": "TypedName", "password": "password1"}
                            if route != "profile"
                            else {"bio": "old", "avatar": "crane"}
                        )
                        data[field] = value
                        self.assertEqual(call(c, route, data)[0], 400)
                        self.assertEqual(call(c, "me")[1]["user"], original_profile)
                        with server.lock:
                            self.assertEqual(
                                [
                                    server.db.execute(
                                        "SELECT COUNT(*) FROM " + table
                                    ).fetchone()[0]
                                    for table in ("users", "sessions")
                                ],
                                before,
                            )

    def test_hosted_origin_and_secure_cookie(self):
        from unittest.mock import patch

        with patch.object(
            server, "PUBLIC_ORIGIN", "https://chess.example.com"
        ), patch.object(server, "COOKIE_SECURE", "; Secure"):
            body = json.dumps(
                {
                    "username": "Proxy" + server.secrets.token_hex(4),
                    "password": "test-password",
                }
            ).encode()
            request = urllib.request.Request(
                BASE + "/api/register",
                data=body,
                headers={
                    "Content-Type": "application/json",
                    "Origin": "https://chess.example.com",
                },
            )
            with urllib.request.urlopen(request) as response:
                self.assertEqual(response.status, 200)
                self.assertIn("; Secure", response.headers["Set-Cookie"])
            self.assertEqual(
                call(self.white, "profile", {"bio": "wrong origin"})[0], 403
            )
            with urllib.request.urlopen(BASE + "/healthz") as response:
                self.assertEqual(json.load(response), {"ok": True})

    def test_unicode_migration_backup_conflict_and_retry(self):
        import sqlite3
        from contextlib import closing
        from identity import migrate_names

        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "legacy.sqlite3"
            db = sqlite3.connect(path, isolation_level=None)
            try:
                db.execute("CREATE TABLE users(id TEXT,username TEXT)")
                db.executemany(
                    "INSERT INTO users VALUES(?,?)",
                    [("a", "Шахматист"), ("b", "шахматист")],
                )
                with self.assertRaisesRegex(RuntimeError, "Конфликт"):
                    migrate_names(db, path)
                self.assertNotIn(
                    "username_key",
                    [r[1] for r in db.execute("PRAGMA table_info(users)")],
                )
                db.execute("UPDATE users SET username='Other' WHERE id='b'")
                migrate_names(db, path)
                migrate_names(db, path)
                self.assertEqual(
                    list(db.execute("SELECT id,username_key FROM users ORDER BY id")),
                    [("a", "шахматист"), ("b", "other")],
                )
                backups = list(Path(tmp).glob("*.before-unicode-*.sqlite3"))
                self.assertEqual(len(backups), 1)
                with closing(sqlite3.connect(backups[0])) as backup:
                    self.assertEqual(
                        backup.execute("SELECT COUNT(*) FROM users").fetchone()[0], 2
                    )
                    self.assertNotIn(
                        "username_key",
                        [r[1] for r in backup.execute("PRAGMA table_info(users)")],
                    )
            finally:
                db.close()


class StudiesIntegration(unittest.TestCase):
    setUp = SocialGames.setUp

    def payload(self, key="study-request-0001"):
        return {
            "title": "Тетрадь вариантов",
            "description": "Мои идеи",
            "public": False,
            "clientKey": key,
            "document": {
                "version": 1,
                "start": "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1",
                "nodes": [
                    {
                        "id": "root",
                        "parent": None,
                        "move": None,
                        "comment": "План",
                        "nag": 0,
                    },
                    {
                        "id": "n1",
                        "parent": "root",
                        "move": {"from": 52, "to": 36, "promotion": "q"},
                        "comment": "Центр",
                        "nag": 1,
                    },
                    {
                        "id": "n2",
                        "parent": "n1",
                        "move": {"from": 12, "to": 28, "promotion": "q"},
                        "comment": "",
                        "nag": 0,
                    },
                    {
                        "id": "n3",
                        "parent": "root",
                        "move": {"from": 51, "to": 35, "promotion": "q"},
                        "comment": "Другой план",
                        "nag": 0,
                    },
                ],
            },
        }

    def create_study(self, data=None):
        data = data or self.payload()
        status, out = call(self.host, "studies", data)
        self.assertEqual(status, 200, out)
        return out["study"]

    def test_private_share_archive_and_revision_access(self):
        data = self.payload()
        self.assertEqual(call(self.anon, "studies", data)[0], 401)
        self.assertEqual(call(self.anon, "studies")[0], 401)
        study = self.create_study(data)
        sid = study["id"]
        self.assertTrue(study["own"])
        self.assertFalse(study["public"])
        self.assertEqual(study["revision"], 1)
        self.assertEqual(call(self.anon, "studies/" + sid)[0], 404)
        self.assertEqual(call(self.other, "studies/" + sid)[0], 404)
        self.assertEqual(
            call(self.other, "studies/" + sid, dict(data, revision=1))[0], 404
        )
        self.assertEqual(
            call(self.other, "studies/" + sid + "/archive", {"revision": 1})[0], 404
        )
        status, out = call(
            self.host, "studies/" + sid, dict(data, public=True, revision=1)
        )
        self.assertEqual(status, 200, out)
        self.assertEqual(out["study"]["revision"], 2)
        shared = call(self.anon, "studies/" + sid)[1]["study"]
        self.assertFalse(shared["own"])
        self.assertEqual(shared["document"]["nodes"][1]["comment"], "Центр")
        self.assertNotIn("owner", shared)
        self.assertNotIn("clientKey", shared)
        self.assertEqual(
            call(self.host, "studies/" + sid, dict(data, revision=1))[0], 409
        )
        self.assertEqual(
            call(self.host, "studies/" + sid + "/archive", {"revision": 2})[0], 200
        )
        self.assertEqual(call(self.anon, "studies/" + sid)[0], 404)
        self.assertEqual(call(self.host, "studies")[1]["total"], 0)
        archived = call(self.host, "studies?archived=1")[1]["studies"][0]
        self.assertEqual(archived["revision"], 3)
        self.assertEqual(
            call(self.host, "studies/" + sid + "/restore", {"revision": 3})[0], 200
        )
        self.assertEqual(call(self.anon, "studies/" + sid)[0], 200)
        out = call(self.host, "studies/" + sid, dict(data, revision=4))[1]["study"]
        self.assertEqual(out["revision"], 5)
        self.assertEqual(call(self.anon, "studies/" + sid)[0], 404)
        self.assertEqual(call(self.guest, "studies")[1]["total"], 0)

    def test_create_retry_and_racing_edit_preserve_data(self):
        from concurrent.futures import ThreadPoolExecutor

        data = self.payload()
        first = self.create_study(data)
        second = self.create_study(dict(data, title="Повтор запроса"))
        self.assertEqual(first["id"], second["id"])
        self.assertEqual(second["title"], data["title"])
        barrier = threading.Barrier(2)

        def update(title):
            barrier.wait()
            return call(
                self.host, "studies/" + first["id"], dict(data, revision=1, title=title)
            )

        with ThreadPoolExecutor(max_workers=2) as pool:
            results = list(pool.map(update, ["Первая вкладка", "Вторая вкладка"]))
        self.assertEqual(sorted(status for status, _ in results), [200, 409])
        winner = next(out["study"] for status, out in results if status == 200)
        stored = call(self.host, "studies/" + first["id"])[1]["study"]
        self.assertEqual(stored["revision"], 2)
        self.assertEqual(stored["title"], winner["title"])
        self.assertEqual(call(self.host, "studies")[1]["total"], 1)

    def test_rejects_illegal_trees_types_and_oversized_payloads(self):
        data = self.payload()
        self.assertEqual(call(self.host, "studies", dict(data, title=[]))[0], 400)
        self.assertEqual(call(self.host, "studies", dict(data, public="yes"))[0], 400)
        self.assertEqual(call(self.host, "studies", dict(data, clientKey=True))[0], 400)
        for change in ["cycle", "illegal", "note", "missing", "fen"]:
            bad = json.loads(json.dumps(data))
            if change == "cycle":
                bad["document"]["nodes"][1]["parent"] = "n2"
            if change == "illegal":
                bad["document"]["nodes"][1]["move"]["to"] = 20
            if change == "note":
                bad["document"]["nodes"][0]["comment"] = "x" * 2001
            if change == "missing":
                bad["document"]["nodes"][1]["parent"] = "absent"
            if change == "fen":
                bad["document"]["start"] = "8/8/8/8/8/8/8/8 w - - 0 1"
            self.assertEqual(call(self.host, "studies", bad)[0], 400, change)
        self.assertEqual(call(self.host, "studies")[1]["total"], 0)
        self.assertEqual(
            call(self.host, "studies", dict(data, description="x" * 200001))[0], 413
        )
        self.assertEqual(call(self.host, "profile", {"bio": "x" * 11000})[0], 413)
        study = self.create_study(data)
        self.assertEqual(
            call(self.host, "studies/" + study["id"], dict(data, revision=True))[0], 409
        )
        self.assertEqual(
            call(self.host, "studies/" + study["id"] + "/archive", {"revision": True})[
                0
            ],
            409,
        )

    def test_validation_does_not_block_live_requests_and_gate_recovers(self):
        from concurrent.futures import ThreadPoolExecutor

        original = server.studies.prepare
        started, release = threading.Event(), threading.Event()

        def prepare(data):
            started.set()
            release.wait(5)
            return original(data)

        server.studies.prepare = prepare
        try:
            with ThreadPoolExecutor(max_workers=2) as pool:
                pending = pool.submit(call, self.host, "studies", self.payload())
                self.assertTrue(started.wait(2))
                try:
                    live = pool.submit(call, self.guest, "state")
                    self.assertEqual(live.result(timeout=2)[0], 200)
                finally:
                    release.set()
                self.assertEqual(pending.result(timeout=10)[0], 200)
        finally:
            release.set()
            server.studies.prepare = original
        server.study_gate.acquire()
        server.study_gate.acquire()
        try:
            self.assertEqual(
                call(self.host, "studies", self.payload("another-request"))[0], 429
            )
        finally:
            server.study_gate.release()
            server.study_gate.release()
        self.assertEqual(
            call(self.host, "studies", self.payload("another-request"))[0], 200
        )

    def test_study_routes_and_private_library_page(self):
        study = self.create_study()
        for path in [
            "/studies",
            "/study/new",
            "/study/" + study["id"],
            "/editor",
            "/practice",
        ]:
            with self.anon.open(BASE + path) as response:
                self.assertEqual(response.status, 200)
                self.assertIn(b"/notebook.js", response.read())
        self.assertEqual(call(self.host, "studies?page=invalid")[0], 400)
        self.assertEqual(call(self.host, "studies?page=2")[1]["studies"], [])


def tearDownModule():
    httpd.shutdown()
    httpd.server_close()
    server.db.close()
    TEMP.cleanup()


if __name__ == "__main__":
    unittest.main()
