import json
import hmac
import re
from secrets import choice, token_bytes
from time import time

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
HISTORY_PAGE_SIZE = 12
TREND_LIMIT = 24


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
                updated_at REAL,
                scored_order INTEGER,
                reveal_step INTEGER,
                PRIMARY KEY (user_id, puzzle_id)
            )
            """)
        columns = {
            row["name"] for row in self.db.execute("PRAGMA table_info(puzzle_attempts)")
        }
        for name, kind in (
            ("updated_at", "REAL"),
            ("scored_order", "INTEGER"),
            ("reveal_step", "INTEGER"),
        ):
            if name not in columns:
                self.db.execute(f"ALTER TABLE puzzle_attempts ADD COLUMN {name} {kind}")

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

    def dashboard(self, uid, theme, outcome, page):
        if not uid:
            raise ClubError("Войдите, чтобы увидеть свой прогресс.", 401)
        if theme not in THEMES or outcome not in (
            "all",
            "win",
            "retry",
            "revealed",
            "active",
        ):
            raise ClubError("Неизвестный фильтр истории.")
        progress = self.progress(uid)
        attempts = list(
            self.db.execute(
                """SELECT * FROM puzzle_attempts
                WHERE user_id=? AND (step>0 OR delta IS NOT NULL)
                ORDER BY updated_at DESC,rowid DESC""",
                (uid,),
            )
        )
        scored = sorted(
            (row for row in attempts if row["scored_order"] is not None),
            key=lambda row: row["scored_order"],
            reverse=True,
        )[:TREND_LIMIT]
        rating = progress["rating"]
        trend = [rating]
        for row in scored:
            rating -= row["delta"]
            trend.append(rating)
        stats = {
            tag: {"id": tag, "name": name, "played": 0, "wins": 0}
            for tag, name in THEMES.items()
            if tag != "mix"
        }
        history = []
        for row in attempts:
            puzzle = self.catalog.get(row["puzzle_id"])
            if not puzzle:
                continue
            if row["delta"] is not None:
                for tag in puzzle["tags"]:
                    stats[tag]["played"] += 1
                    stats[tag]["wins"] += int(bool(row["win"]))
            result = row["state"]
            if result == "solved":
                result = "win" if row["win"] else "retry"
            if (theme == "mix" or theme in puzzle["tags"]) and (
                outcome == "all" or outcome == result
            ):
                history.append(
                    {
                        "id": puzzle["id"],
                        "rating": puzzle["rating"],
                        "themes": [THEMES[tag] for tag in puzzle["tags"]],
                        "result": result,
                        "delta": row["delta"],
                        "updatedAt": row["updated_at"],
                    }
                )
        pages = max(1, (len(history) + HISTORY_PAGE_SIZE - 1) // HISTORY_PAGE_SIZE)
        page = max(1, min(page, pages))
        offset = (page - 1) * HISTORY_PAGE_SIZE
        return {
            "progress": progress,
            "trend": trend[::-1] if scored else [],
            "themes": list(stats.values()),
            "history": history[offset : offset + HISTORY_PAGE_SIZE],
            "page": page,
            "pages": pages,
            "total": len(history),
        }

    def saved(self, uid, pid):
        if not uid:
            raise ClubError("Войдите, чтобы открыть свою задачу.", 401)
        puzzle = self.catalog.get(pid)
        row = self.db.execute(
            """SELECT * FROM puzzle_attempts
            WHERE user_id=? AND puzzle_id=? AND (step>0 OR delta IS NOT NULL)""",
            (uid, pid),
        ).fetchone()
        if not puzzle or not row:
            raise ClubError("Задача не найдена в вашей истории.", 404)
        return self.snapshot(puzzle, dict(row), uid)

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
            "accepted": (
                (attempt.get("reveal_step") or 0)
                if attempt["state"] == "revealed"
                else attempt["step"]
            ),
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
            attempt.update(step=len(line), state="revealed", reveal_step=step)
        elif correct:
            if final:
                attempt.update(step=len(line), state="solved", final_move=move)
            else:
                attempt.update(step=step + 2)
        if uid:
            scored = attempt["delta"] is None and (reveal or not correct or final)
            if scored:
                won = not reveal and correct
                progress = self.progress(uid)
                rating = progress["rating"]
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
                attempt.update(
                    delta=delta, win=int(won), scored_order=progress["played"] + 1
                )
            if scored or reveal or correct:
                self.db.execute(
                    """UPDATE puzzle_attempts
                    SET step=?,state=?,delta=?,win=?,final_move=?,updated_at=?,scored_order=?,reveal_step=?
                    WHERE user_id=? AND puzzle_id=?""",
                    (
                        attempt["step"],
                        attempt["state"],
                        attempt["delta"],
                        attempt["win"],
                        attempt["final_move"],
                        time(),
                        attempt["scored_order"],
                        attempt["reveal_step"],
                        uid,
                        puzzle["id"],
                    ),
                )
        return self.snapshot(
            puzzle, attempt, uid, "wrong" if not reveal and not correct else None
        )
