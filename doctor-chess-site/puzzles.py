import json
import hmac
import re
from secrets import choice, token_bytes

from social import ClubError

THEMES = {
    "mix": "Все темы",
    "mate": "Мат",
    "fork": "Вилка",
    "pin": "Связка",
    "discoveredAttack": "Вскрытое нападение",
    "sacrifice": "Жертва",
    "endgame": "Эндшпиль",
    "promotion": "Превращение пешки",
    "defensiveMove": "Защита",
}
LEVELS = {
    "beginner": ("Начальный", 0, 1399),
    "intermediate": ("Средний", 1400, 1799),
    "advanced": ("Продвинутый", 1800, 10000),
}
MOVE = re.compile(r"[a-h][1-8][a-h][1-8][qrbn]?")


class Puzzles:
    def __init__(self, db, catalog):
        self.db = db
        self.guest_secret = token_bytes(32)
        with catalog.open(encoding="utf-8") as source:
            rows = [json.loads(line) for line in source]
        self.catalog = {row["id"]: row for row in rows}
        self.groups = {
            (theme, level): [
                row
                for row in rows
                if low <= row["rating"] <= high
                and (theme == "mix" or theme in row["tags"])
            ]
            for theme in THEMES
            for level, (_, low, high) in LEVELS.items()
        }
        self.db.execute("""
            CREATE TABLE IF NOT EXISTS puzzle_attempts (
                user_id TEXT NOT NULL,
                puzzle_id TEXT NOT NULL,
                step INTEGER NOT NULL DEFAULT 0,
                state TEXT NOT NULL DEFAULT 'active',
                delta INTEGER,
                win INTEGER,
                final_move TEXT,
                PRIMARY KEY (user_id, puzzle_id)
            )
            """)

    def progress(self, uid):
        if not uid:
            return None
        row = self.db.execute(
            "SELECT rating,played,wins FROM ratings WHERE user_id=? AND category='puzzles'",
            (uid,),
        ).fetchone()
        return dict(row) if row else {"rating": 1200, "played": 0, "wins": 0}

    def overview(self, uid):
        return {
            "themes": [
                {
                    "id": theme,
                    "name": name,
                    "counts": {
                        level: len(self.groups[theme, level]) for level in LEVELS
                    },
                }
                for theme, name in THEMES.items()
            ],
            "levels": [
                {"id": level, "name": name} for level, (name, _, _) in LEVELS.items()
            ],
            "progress": self.progress(uid),
        }

    def snapshot(self, puzzle, attempt, uid, feedback=None):
        line = puzzle["line"]
        moves = line[: attempt["step"]]
        if attempt["final_move"]:
            moves[-1] = attempt["final_move"]
        return {
            "id": puzzle["id"],
            "fen": puzzle["fen"],
            "lead": puzzle["lead"],
            "rating": puzzle["rating"],
            "moves": moves,
            "step": attempt["step"],
            "state": attempt["state"],
            "feedback": feedback,
            "score": (
                None
                if attempt["delta"] is None
                else {"delta": attempt["delta"], "win": bool(attempt["win"])}
            ),
            "progress": self.progress(uid),
            **(
                {"guestKey": self.guest_key(puzzle["id"], attempt["step"])}
                if not uid and attempt["state"] == "active"
                else {}
            ),
            **(
                {
                    "game": puzzle["game"],
                    "themes": [THEMES[tag] for tag in puzzle["tags"]],
                }
                if attempt["state"] != "active"
                else {}
            ),
        }

    def guest_key(self, pid, step):
        return hmac.digest(self.guest_secret, f"{pid}:{step}".encode(), "sha256").hex()

    def start(self, uid, data):
        theme, level = data.get("theme"), data.get("level")
        if not isinstance(theme, str) or not isinstance(level, str):
            raise ClubError("Укажите тему и сложность.")
        options = self.groups.get((theme, level))
        if not options:
            raise ClubError("Такой темы или уровня нет.")
        if uid:
            attempts = {
                row["puzzle_id"]: dict(row)
                for row in self.db.execute(
                    "SELECT * FROM puzzle_attempts WHERE user_id=? ORDER BY rowid DESC",
                    (uid,),
                )
            }
            eligible = {puzzle["id"] for puzzle in options}
            for pid, attempt in attempts.items():
                if pid in eligible and attempt["state"] == "active":
                    return self.snapshot(self.catalog[pid], attempt, uid)
            options = [puzzle for puzzle in options if puzzle["id"] not in attempts]
            if not options:
                return {"exhausted": True, "progress": self.progress(uid)}
        else:
            options = [
                puzzle for puzzle in options if puzzle["id"] != data.get("previous")
            ] or options
        puzzle = choice(options)
        if uid:
            self.db.execute(
                "INSERT INTO puzzle_attempts(user_id,puzzle_id) VALUES(?,?)",
                (uid, puzzle["id"]),
            )
        attempt = {
            "step": 0,
            "state": "active",
            "delta": None,
            "win": None,
            "final_move": None,
        }
        return self.snapshot(puzzle, attempt, uid)

    def play(self, uid, data):
        pid, step, move = data.get("id"), data.get("step"), data.get("move")
        reveal = data.get("reveal") is True
        if (
            not isinstance(pid, str)
            or pid not in self.catalog
            or type(step) is not int
            or step < 0
            or step % 2 != 0
            or (not reveal and (not isinstance(move, str) or not MOVE.fullmatch(move)))
        ):
            raise ClubError("Некорректный ход задачи.")
        puzzle = self.catalog[pid]
        if uid:
            self.db.execute("BEGIN IMMEDIATE")
            try:
                row = self.db.execute(
                    "SELECT * FROM puzzle_attempts WHERE user_id=? AND puzzle_id=?",
                    (uid, pid),
                ).fetchone()
                if not row:
                    raise ClubError("Сначала откройте эту задачу.", 404)
                answer = self.advance(puzzle, dict(row), uid, step, move, reveal)
                self.db.execute("COMMIT")
                return answer
            except Exception:
                self.db.execute("ROLLBACK")
                raise
        if step >= len(puzzle["line"]):
            raise ClubError("Задача уже завершена.")
        key = data.get("guestKey")
        if (
            not isinstance(key, str)
            or not re.fullmatch(r"[a-f0-9]{64}", key)
            or not hmac.compare_digest(key, self.guest_key(pid, step))
        ):
            raise ClubError("Гостевая задача устарела. Обновите страницу.", 409)
        return self.advance(
            puzzle,
            {
                "step": step,
                "state": "active",
                "delta": None,
                "win": None,
                "final_move": None,
            },
            None,
            step,
            move,
            reveal,
        )

    def advance(self, puzzle, attempt, uid, step, move, reveal):
        if attempt["state"] != "active" or attempt["step"] != step:
            return self.snapshot(puzzle, attempt, uid)
        line = puzzle["line"]
        final = step == len(line) - 1
        correct = move == line[step] or (final and move in puzzle["alternatives"])
        if reveal:
            attempt.update(step=len(line), state="revealed")
        elif correct:
            if final:
                attempt.update(step=len(line), state="solved", final_move=move)
            else:
                attempt.update(step=step + 2)
        if uid:
            if attempt["delta"] is None and (reveal or not correct or final):
                won = not reveal and correct
                rating = self.progress(uid)["rating"]
                expected = 1 / (1 + 10 ** ((puzzle["rating"] - rating) / 400))
                delta = round(24 * (int(won) - expected))
                delta = max(1, delta) if won else min(-1, delta)
                self.db.execute(
                    """INSERT INTO ratings(user_id,category,rating,played,wins)
                    VALUES(?,'puzzles',?,1,?)
                    ON CONFLICT(user_id,category) DO UPDATE
                    SET rating=excluded.rating, played=played+1, wins=wins+excluded.wins""",
                    (uid, rating + delta, int(won)),
                )
                attempt.update(delta=delta, win=int(won))
            self.db.execute(
                """UPDATE puzzle_attempts SET step=?,state=?,delta=?,win=?,final_move=?
                WHERE user_id=? AND puzzle_id=?""",
                (
                    attempt["step"],
                    attempt["state"],
                    attempt["delta"],
                    attempt["win"],
                    attempt["final_move"],
                    uid,
                    puzzle["id"],
                ),
            )
        return self.snapshot(
            puzzle, attempt, uid, "wrong" if not reveal and not correct else None
        )
