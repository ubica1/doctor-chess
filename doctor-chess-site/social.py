"""Invitations and rematches. All mutations run under the server's shared lock."""

import json
import random
import secrets
import time


class ClubError(Exception):
    def __init__(self, message, status=400):
        super().__init__(message)
        self.status = status


class ClubGames:
    def __init__(self, db, controls, initial, profile, game_row, public_game):
        self.db = db
        self.controls = controls
        self.initial = initial
        self.profile = profile
        self.game_row = game_row
        self.public_game = public_game
        if "kind" not in [row[1] for row in db.execute("PRAGMA table_info(games)")]:
            db.execute(
                "ALTER TABLE games ADD COLUMN kind TEXT NOT NULL DEFAULT 'rated'"
            )
        db.executescript("""
        CREATE TABLE IF NOT EXISTS challenges(
          id TEXT PRIMARY KEY,host TEXT NOT NULL,control TEXT NOT NULL,color TEXT NOT NULL,
          created REAL NOT NULL,expires REAL NOT NULL,status TEXT NOT NULL DEFAULT 'pending',
          guest TEXT,game_id TEXT,rematch_of TEXT,kind TEXT NOT NULL DEFAULT 'casual');
        CREATE INDEX IF NOT EXISTS challenges_rematch ON challenges(rematch_of,status);
        CREATE INDEX IF NOT EXISTS games_players_white ON games(white,result,created);
        CREATE INDEX IF NOT EXISTS games_players_black ON games(black,result,created);
        """)

        if "target" not in [
            row[1] for row in db.execute("PRAGMA table_info(challenges)")
        ]:
            db.execute("ALTER TABLE challenges ADD COLUMN target TEXT")

    def active_for(self, uid):
        rows = self.db.execute(
            "SELECT id FROM games WHERE (white=? OR black=?) AND result IS NULL ORDER BY created DESC",
            (uid, uid),
        ).fetchall()
        for row in rows:
            game = self.game_row(row["id"])
            if not game["result"]:
                return game
        return None

    def cancel_waiting(self, uid):
        self.db.execute("DELETE FROM queue WHERE user_id=?", (uid,))
        self.db.execute(
            "UPDATE challenges SET status='cancelled' WHERE status='pending' AND (host=? OR rematch_of IN (SELECT id FROM games WHERE white=? OR black=?))",
            (uid, uid, uid),
        )

    def new_game(self, white, black, control, kind="rated"):
        self.cancel_waiting(white)
        self.cancel_waiting(black)
        category, seconds, _ = self.controls[control]
        gid = secrets.token_hex(12)
        payload = {
            "state": self.initial,
            "clocks": {"w": seconds, "b": seconds},
            "tick": time.time(),
            "moves": [],
            "last": [],
            "history": [],
            "offer": None,
        }
        self.db.execute(
            "INSERT INTO games(id,white,black,control,category,payload,result,reason,created,kind) VALUES(?,?,?,?,?,?,NULL,NULL,?,?)",
            (
                gid,
                white,
                black,
                control,
                category,
                json.dumps(payload),
                time.time(),
                kind,
            ),
        )
        self.db.execute("DELETE FROM queue WHERE user_id IN (?,?)", (white, black))
        return self.game_row(gid)

    def row(self, token):
        row = self.db.execute(
            "SELECT * FROM challenges WHERE id=?", (token,)
        ).fetchone()
        if not row:
            raise ClubError("Приглашение не найдено.", 404)
        challenge = dict(row)
        if challenge["status"] == "pending" and challenge["expires"] <= time.time():
            challenge["status"] = "expired"
            self.db.execute(
                "UPDATE challenges SET status='expired' WHERE id=?", (token,)
            )
        return challenge

    def public(self, challenge, uid):
        host = self.profile(challenge["host"])
        return {
            "id": challenge["id"],
            "host": {"username": host["username"], "avatar": host["avatar"]},
            "control": challenge["control"],
            "color": challenge["color"],
            "expires": challenge["expires"],
            "status": challenge["status"],
            "kind": challenge["kind"],
            "own": uid == challenge["host"],
            "participant": uid is not None
            and uid in [challenge["host"], challenge["guest"]],
            "game_id": challenge["game_id"],
            "rematch": bool(challenge["rematch_of"]),
            "target": (
                self.profile(challenge["target"])["username"]
                if challenge.get("target")
                else None
            ),
            "can_join": uid is not None
            and uid != challenge["host"]
            and (not challenge.get("target") or uid == challenge["target"]),
        }

    def create(self, uid, control, color, target=None):
        if control not in self.controls or color not in ["w", "b", "random"]:
            raise ClubError("Выберите контроль и цвет.")
        if self.active_for(uid):
            raise ClubError("Сначала завершите текущую сетевую партию.", 409)
        self.cancel_waiting(uid)
        challenge = self._insert(uid, control, color, None, "casual", 1800, target)
        return {"challenge": self.public(challenge, uid)}

    def _insert(self, uid, control, color, rematch_of, kind, lifetime, target=None):
        token = secrets.token_urlsafe(18)
        self.db.execute(
            "INSERT INTO challenges(id,host,control,color,created,expires,rematch_of,kind) VALUES(?,?,?,?,?,?,?,?)",
            (
                token,
                uid,
                control,
                color,
                time.time(),
                time.time() + lifetime,
                rematch_of,
                kind,
            ),
        )
        if target:
            self.db.execute(
                "UPDATE challenges SET target=? WHERE id=?", (target, token)
            )
        return self.row(token)

    def accept(self, token, uid):
        challenge = self.row(token)
        if challenge["status"] == "accepted":
            if uid not in [challenge["host"], challenge["guest"]]:
                raise ClubError("Этим приглашением уже воспользовались.", 409)
            return {"game": self.public_game(self.game_row(challenge["game_id"]), uid)}
        if challenge["status"] != "pending":
            raise ClubError("Это приглашение больше не действует.", 410)
        if uid == challenge["host"]:
            raise ClubError(
                "Ожидаем другого игрока — своё приглашение принять нельзя.", 409
            )
        if challenge.get("target") and challenge["target"] != uid:
            raise ClubError("Это приглашение предназначено другому игроку.", 403)
        if challenge["rematch_of"]:
            original = self.game_row(challenge["rematch_of"])
            if uid not in [original["white"], original["black"]]:
                raise ClubError("Реванш предназначен сопернику из этой партии.", 403)
        if self.active_for(uid) or self.active_for(challenge["host"]):
            raise ClubError("Один из игроков уже участвует в другой партии.", 409)
        host_side = (
            random.choice(["w", "b"])
            if challenge["color"] == "random"
            else challenge["color"]
        )
        white, black = (
            (challenge["host"], uid) if host_side == "w" else (uid, challenge["host"])
        )
        self.db.execute("BEGIN IMMEDIATE")
        try:
            game = self.new_game(white, black, challenge["control"], challenge["kind"])
            self.db.execute(
                "UPDATE challenges SET status='accepted',guest=?,game_id=? WHERE id=?",
                (uid, game["id"], token),
            )
            self.db.execute("COMMIT")
        except Exception:
            self.db.execute("ROLLBACK")
            raise
        return {"game": self.public_game(game, uid)}

    def cancel(self, token, uid):
        challenge = self.row(token)
        if uid != challenge["host"]:
            raise ClubError("Приглашение не найдено.", 404)
        if challenge["status"] == "accepted":
            raise ClubError("Партия уже началась.", 409)
        self.db.execute("UPDATE challenges SET status='cancelled' WHERE id=?", (token,))
        return {"challenge": self.public(self.row(token), uid)}

    def rematch(self, gid, uid):
        game = self.game_row(gid)
        if not game or uid not in [game["white"], game["black"]]:
            raise ClubError("Партия не найдена.", 404)
        if not game["result"]:
            raise ClubError("Предложить реванш можно после завершения партии.", 409)
        pending = self.db.execute(
            "SELECT * FROM challenges WHERE rematch_of=? AND status='pending' AND expires>? ORDER BY created DESC LIMIT 1",
            (gid, time.time()),
        ).fetchone()
        if pending:
            if pending["host"] == uid:
                return {"challenge": self.public(dict(pending), uid)}
            return self.accept(pending["id"], uid)
        running = self.active_for(uid)
        if running:
            accepted = self.db.execute(
                "SELECT game_id FROM challenges WHERE rematch_of=? AND status='accepted' AND game_id=?",
                (gid, running["id"]),
            ).fetchone()
            if accepted:
                return {"game": self.public_game(running, uid)}
            raise ClubError("Вы уже участвуете в другой партии.", 409)
        opponent = game["black"] if uid == game["white"] else game["white"]
        if self.active_for(opponent):
            raise ClubError("Соперник уже играет другую партию.", 409)
        self.cancel_waiting(uid)
        color = "b" if uid == game["white"] else "w"
        challenge = self._insert(
            uid, game["control"], color, gid, game.get("kind", "rated"), 300, opponent
        )
        return {"challenge": self.public(challenge, uid)}

    def pending_rematch(self, game, uid):
        if not game["result"]:
            return None
        row = self.db.execute(
            "SELECT id,host,expires FROM challenges WHERE rematch_of=? AND status='pending' AND expires>? ORDER BY created DESC LIMIT 1",
            (game["id"], time.time()),
        ).fetchone()
        if not row:
            return None
        return {
            "id": row["id"],
            "own": row["host"] == uid,
            "from": self.profile(row["host"])["username"],
            "expires": row["expires"],
        }
