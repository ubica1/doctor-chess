"""Short-lived authenticated presence; no visitor identifiers are retained."""

import time


class Presence:
    def __init__(self):
        self.seen = {}
        self.cleaned = 0

    def touch(self, uid, now=None):
        now = time.time() if now is None else now
        if now - self.cleaned > 20:
            self.seen = {key: at for key, at in self.seen.items() if now - at <= 30}
            self.cleaned = now
        if uid:
            self.seen[uid] = now

    def online(self, uid, now=None):
        now = time.time() if now is None else now
        return uid in self.seen and now - self.seen[uid] <= 20

    def lobby(self, db, controls, now=None):
        now = time.time() if now is None else now
        waiting = dict.fromkeys(controls, 0)
        for row in db.execute(
            "SELECT control,COUNT(*) AS n FROM queue WHERE touched>? GROUP BY control",
            (now - 15,),
        ):
            if row["control"] in waiting:
                waiting[row["control"]] = row["n"]
        return {
            "online": sum(self.online(uid, now) for uid in self.seen),
            "waiting": waiting,
        }
