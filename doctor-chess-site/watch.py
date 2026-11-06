"""Read-only live broadcasts require consent from both participants."""

import time
from social import ClubError


class WatchGames:
    def __init__(self, db, game_row, profile):
        self.db, self.game_row, self.profile = db, game_row, profile
        db.execute(
            "CREATE TABLE IF NOT EXISTS game_watch(game_id TEXT PRIMARY KEY, white INTEGER NOT NULL DEFAULT 0, black INTEGER NOT NULL DEFAULT 0)"
        )

    def consent(self, g):
        row = self.db.execute(
            "SELECT white,black FROM game_watch WHERE game_id=?", (g["id"],)
        ).fetchone()
        w, b = (bool(row["white"]), bool(row["black"])) if row else (False, False)
        return {
            "w": w,
            "b": b,
            "enabled": w and b,
            "listed": w and b and g.get("kind", "rated") != "casual",
        }

    def set_consent(self, uid, gid, enabled):
        row = self.db.execute(
            "SELECT white,black FROM games WHERE id=?", (gid,)
        ).fetchone()
        if not row or uid not in (row["white"], row["black"]):
            raise ClubError("Партия не найдена или недоступна.", 404)
        if type(enabled) is not bool:
            raise ClubError("Выберите, разрешён ли просмотр.")
        g = self.game_row(gid)
        if g["result"]:
            raise ClubError("Партия уже завершена. Её запись доступна в разборе.", 409)
        side = "white" if uid == row["white"] else "black"
        self.db.execute("INSERT OR IGNORE INTO game_watch(game_id) VALUES(?)", (gid,))
        self.db.execute(
            "UPDATE game_watch SET " + side + "=? WHERE game_id=?", (int(enabled), gid)
        )
        return g

    def public(self, g):
        now = time.time()
        p = g["payload"]
        clocks = dict(p["clocks"])
        if not g["result"]:
            side = p["state"]["turn"]
            clocks[side] = max(0, clocks[side] - max(0, now - p["tick"]))

        def player(uid):
            profile = self.profile(uid)
            rating = profile["ratings"].get(g["category"], {}).get("rating", 1200)
            return {
                "username": profile["username"],
                "avatar": profile["avatar"],
                "rating": rating,
            }

        return {
            "id": g["id"],
            "white": player(g["white"]),
            "black": player(g["black"]),
            "control": g["control"],
            "kind": g.get("kind", "rated"),
            "state": p["state"],
            "moves": p["moves"],
            "last": p["last"],
            "clocks": clocks,
            "result": g["result"],
            "reason": g["reason"],
            "serverTime": now,
        }

    def detail(self, gid):
        g = self.game_row(gid)
        if not g or (not g["result"] and not self.consent(g)["enabled"]):
            raise ClubError(
                "Трансляция закрыта или ещё не разрешена обоими игроками.", 404
            )
        return {"game": self.public(g)}

    def listing(self):
        rows = self.db.execute(
            "SELECT g.id FROM games g JOIN game_watch w ON w.game_id=g.id WHERE g.result IS NULL AND g.kind!='casual' AND w.white=1 AND w.black=1 ORDER BY g.created DESC,g.id LIMIT 20"
        ).fetchall()
        games = []
        for row in rows:
            g = self.game_row(row["id"])
            if g and not g["result"]:
                public = self.public(g)
                games.append(
                    {k: public[k] for k in ("id", "white", "black", "control", "kind")}
                    | {"ply": len(public["moves"])}
                )
        return {"games": games}
