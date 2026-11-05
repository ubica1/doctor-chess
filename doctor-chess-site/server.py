import os, json, sqlite3, secrets, hashlib, hmac, time, re, threading, subprocess, random
from pathlib import Path
from http.server import ThreadingHTTPServer, SimpleHTTPRequestHandler
from http.cookies import SimpleCookie
from urllib.parse import urlparse, parse_qs, unquote
from social import ClubGames, ClubError
from identity import name_key, migrate_names
from game_clock import settle_clock, insufficient_for_side

BASE = Path(__file__).resolve().parent
PUBLIC_ORIGIN = os.environ.get("DOCTOR_CHESS_PUBLIC_ORIGIN", "").rstrip("/")
if PUBLIC_ORIGIN:
    public_url = urlparse(PUBLIC_ORIGIN)
    if (
        public_url.scheme != "https"
        or not public_url.netloc
        or public_url.path
        or public_url.query
        or public_url.fragment
        or public_url.username
        or public_url.password
    ):
        raise ValueError(
            "DOCTOR_CHESS_PUBLIC_ORIGIN must be an HTTPS origin without a path"
        )
COOKIE_SECURE = "; Secure" if PUBLIC_ORIGIN else ""
DB = Path(os.environ.get("DOCTOR_CHESS_DB", str(BASE / "data" / "chess.sqlite3")))
DB.parent.mkdir(parents=True, exist_ok=True)
db = sqlite3.connect(DB, check_same_thread=False, isolation_level=None)
db.row_factory = sqlite3.Row
lock = threading.RLock()
db.executescript("""PRAGMA journal_mode=WAL;
CREATE TABLE IF NOT EXISTS users(id TEXT PRIMARY KEY,username TEXT UNIQUE COLLATE NOCASE,password TEXT,salt TEXT,bio TEXT DEFAULT '',created REAL);
CREATE TABLE IF NOT EXISTS sessions(token TEXT PRIMARY KEY,user_id TEXT,expires REAL);
CREATE TABLE IF NOT EXISTS ratings(user_id TEXT,category TEXT,rating INTEGER DEFAULT 1200,played INTEGER DEFAULT 0,wins INTEGER DEFAULT 0,PRIMARY KEY(user_id,category));
CREATE TABLE IF NOT EXISTS games(id TEXT PRIMARY KEY,white TEXT,black TEXT,control TEXT,category TEXT,payload TEXT,result TEXT,reason TEXT,created REAL);
CREATE TABLE IF NOT EXISTS queue(user_id TEXT PRIMARY KEY,control TEXT,touched REAL);
""")
if "avatar" not in [r[1] for r in db.execute("PRAGMA table_info(users)")]:
    db.execute("ALTER TABLE users ADD COLUMN avatar TEXT DEFAULT 'crane'")
migrate_names(db, DB)
CONTROLS = {
    "1+0": ("bullet", 60, 0),
    "3+0": ("blitz", 180, 0),
    "3+2": ("blitz", 180, 2),
    "5+0": ("blitz", 300, 0),
    "10+0": ("rapid", 600, 0),
    "15+10": ("rapid", 900, 10),
    "30+0": ("classical", 1800, 0),
}
INITIAL = {
    "b": list("rnbqkbnrpppppppp................................PPPPPPPPRNBQKBNR"),
    "turn": "w",
    "rights": "KQkq",
    "ep": -1,
    "half": 0,
}
INITIAL["b"] = [None if x == "." else x for x in INITIAL["b"]]
failures = {}


def profile(uid):
    u = db.execute(
        "SELECT id,username,bio,created,avatar FROM users WHERE id=?", (uid,)
    ).fetchone()
    if not u:
        return None
    out = dict(u)
    out["ratings"] = {
        r["category"]: dict(r)
        for r in db.execute(
            "SELECT category,rating,played,wins FROM ratings WHERE user_id=?", (uid,)
        )
    }
    return out


def readable_reason(value):
    if not value:
        return value
    try:
        repaired = value.encode("cp1251").decode("utf-8")
        return repaired if repaired else value
    except (UnicodeEncodeError, UnicodeDecodeError):
        return value


def public_profile(username, page=1, category="all"):
    row = db.execute(
        "SELECT id FROM users WHERE username_key=?", (name_key(username),)
    ).fetchone()
    if not row:
        return None
    uid = row["id"]
    out = profile(uid)
    stats = {"played": 0, "wins": 0, "draws": 0, "losses": 0}
    for r in db.execute(
        "SELECT white,result,COUNT(*) AS n FROM games WHERE (white=? OR black=?) AND result IS NOT NULL GROUP BY white,result",
        (uid, uid),
    ):
        stats["played"] += r["n"]
        key = (
            "draws"
            if r["result"] == "draw"
            else "wins" if (r["result"] == "w") == (r["white"] == uid) else "losses"
        )
        stats[key] += r["n"]
    out["stats"] = stats
    clause = (
        " AND category=?"
        if category in ["bullet", "blitz", "rapid", "classical"]
        else ""
    )
    args = [uid, uid] + ([category] if clause else [])
    total = db.execute(
        "SELECT COUNT(*) FROM games WHERE (white=? OR black=?) AND result IS NOT NULL"
        + clause,
        args,
    ).fetchone()[0]
    rows = db.execute(
        "SELECT id,white,black,control,category,result,reason,created,kind FROM games WHERE (white=? OR black=?) AND result IS NOT NULL"
        + clause
        + " ORDER BY created DESC,id LIMIT 12 OFFSET ?",
        args + [(page - 1) * 12],
    )
    games = []
    for row in rows:
        g = dict(row)
        side = "w" if g["white"] == uid else "b"
        opponent = profile(g["black"] if side == "w" else g["white"])
        games.append(
            {
                "id": g["id"],
                "opponent": {
                    "username": opponent["username"],
                    "avatar": opponent["avatar"],
                },
                "control": g["control"],
                "category": g["category"],
                "result": (
                    "draw"
                    if g["result"] == "draw"
                    else "win" if g["result"] == side else "loss"
                ),
                "reason": readable_reason(g["reason"]),
                "created": g["created"],
                "side": side,
                "kind": g.get("kind", "rated"),
            }
        )
    out["games"] = games
    out["page"] = page
    out["total_games"] = total
    return out


def finish(g, result, reason, now=None):
    if g["result"]:
        return
    expired = settle_clock(g["payload"], time.time() if now is None else now)
    if expired:
        winner = "b" if g["payload"]["state"]["turn"] == "w" else "w"
        result = (
            "draw" if insufficient_for_side(g["payload"]["state"], winner) else winner
        )
        reason = "Время вышло"
    db.execute("BEGIN IMMEDIATE")
    try:
        changed = db.execute(
            "UPDATE games SET result=?,reason=? WHERE id=? AND result IS NULL",
            (result, reason, g["id"]),
        )
        if not changed.rowcount:
            db.execute("ROLLBACK")
            return
        if g.get("kind", "rated") == "rated":
            a = db.execute(
                "SELECT rating FROM ratings WHERE user_id=? AND category=?",
                (g["white"], g["category"]),
            ).fetchone()[0]
            b = db.execute(
                "SELECT rating FROM ratings WHERE user_id=? AND category=?",
                (g["black"], g["category"]),
            ).fetchone()[0]
            score = 1 if result == "w" else 0 if result == "b" else 0.5
            delta = round(24 * (score - 1 / (1 + 10 ** ((b - a) / 400))))
            g["payload"]["ratingChange"] = {
                "w": {"before": a, "after": a + delta, "delta": delta},
                "b": {"before": b, "after": b - delta, "delta": -delta},
            }
            for uid, d, win in [
                (g["white"], delta, result == "w"),
                (g["black"], -delta, result == "b"),
            ]:
                db.execute(
                    "UPDATE ratings SET rating=rating+?,played=played+1,wins=wins+? WHERE user_id=? AND category=?",
                    (d, int(win), uid, g["category"]),
                )
        db.execute(
            "UPDATE games SET payload=? WHERE id=?",
            (json.dumps(g["payload"]), g["id"]),
        )
        db.execute("COMMIT")
    except:
        db.execute("ROLLBACK")
        raise
    g["result"] = result
    g["reason"] = reason


def game_row(gid, now=None):
    row = db.execute("SELECT * FROM games WHERE id=?", (gid,)).fetchone()
    if not row:
        return None
    g = dict(row)
    g["reason"] = readable_reason(g["reason"])
    g["payload"] = json.loads(g["payload"])
    p = g["payload"]
    now = time.time() if now is None else now
    if not g["result"]:
        dead = all(insufficient_for_side(p["state"], side) for side in ("w", "b"))
        if dead or p["clocks"][p["state"]["turn"]] <= max(0, now - p["tick"]):
            finish(g, "draw", "Ничья — недостаточно материала.", now)
    return g


def public_game(g, uid):
    p = g["payload"]
    clocks = dict(p["clocks"])
    if not g["result"]:
        clocks[p["state"]["turn"]] = max(
            0, clocks[p["state"]["turn"]] - (time.time() - p["tick"])
        )
    return {
        "id": g["id"],
        "control": g["control"],
        "category": g["category"],
        "white": profile(g["white"]),
        "black": profile(g["black"]),
        "you": "w" if uid == g["white"] else "b",
        "state": p["state"],
        "moves": p["moves"],
        "last": p["last"],
        "clocks": clocks,
        "result": g["result"],
        "reason": g["reason"],
        "ratingChange": p.get("ratingChange"),
        "offer": p.get("offer"),
        "kind": g.get("kind", "rated"),
        "created": g["created"],
        "rematch": club.pending_rematch(g, uid),
    }


club = ClubGames(db, CONTROLS, INITIAL, profile, game_row, public_game)


class Handler(SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        self.timeout = 15
        super().__init__(*args, directory=str(BASE / "dist"), **kwargs)

    def log_message(self, *args):
        pass

    def reply(self, obj, status=200, cookie=None):
        data = json.dumps(obj, ensure_ascii=False).encode()
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Cache-Control", "no-store")
        self.send_header("X-Content-Type-Options", "nosniff")
        if cookie:
            self.send_header("Set-Cookie", cookie)
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def user(self):
        c = SimpleCookie()
        try:
            c.load(self.headers.get("Cookie", ""))
            token = c["dc_session"].value if "dc_session" in c else ""
        except:
            token = ""
        r = db.execute(
            "SELECT user_id FROM sessions WHERE token=? AND expires>?",
            (hashlib.sha256(token.encode()).hexdigest(), time.time()),
        ).fetchone()
        return r[0] if r else None

    def session(self, uid):
        token = secrets.token_urlsafe(32)
        db.execute(
            "INSERT INTO sessions VALUES(?,?,?)",
            (hashlib.sha256(token.encode()).hexdigest(), uid, time.time() + 86400 * 30),
        )
        return f"dc_session={token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=2592000{COOKIE_SECURE}"

    def do_GET(self):
        if self.path == "/healthz":
            with lock:
                db.execute("SELECT 1").fetchone()
            return self.reply({"ok": True})
        if (
            self.path.startswith("/player/")
            or self.path.startswith("/review/")
            or self.path.startswith("/invite/")
            or self.path.startswith("/game/")
            or self.path.startswith("/play/")
            or urlparse(self.path).path in ("/players", "/academy")
        ):
            self.path = "/index.html"
            return super().do_GET()
        if not self.path.startswith("/api/"):
            return super().do_GET()
        with lock:
            try:
                uid = self.user()
                parsed = urlparse(self.path)
                query = parse_qs(parsed.query)
                if parsed.path.startswith("/api/play/"):
                    if not uid:
                        return self.reply({"error": "Войдите в профиль участника"}, 401)
                    gid = parsed.path[len("/api/play/") :]
                    row = db.execute(
                        "SELECT white,black FROM games WHERE id=?", (gid,)
                    ).fetchone()
                    if not row or uid not in (row["white"], row["black"]):
                        return self.reply(
                            {"error": "Партия не найдена или недоступна"}, 404
                        )
                    return self.reply({"game": public_game(game_row(gid), uid)})
                if parsed.path.startswith("/api/challenges/"):
                    token = parsed.path[len("/api/challenges/") :]
                    return self.reply({"challenge": club.public(club.row(token), uid)})
                if parsed.path.startswith("/api/games/"):
                    gid = parsed.path[len("/api/games/") :]
                    row = db.execute(
                        "SELECT * FROM games WHERE id=? AND result IS NOT NULL", (gid,)
                    ).fetchone()
                    if not row:
                        return self.reply(
                            {"error": "Завершённая партия не найдена"}, 404
                        )
                    payload = json.loads(row["payload"])
                    white = profile(row["white"])
                    black = profile(row["black"])
                    return self.reply(
                        {
                            "game": {
                                "id": row["id"],
                                "white": white["username"],
                                "black": black["username"],
                                "control": row["control"],
                                "kind": row["kind"],
                                "created": row["created"],
                                "result": row["result"],
                                "reason": readable_reason(row["reason"]),
                                "moves": payload["moves"],
                            }
                        }
                    )
                if parsed.path.startswith("/api/players/"):
                    try:
                        page = max(1, min(10000, int(query.get("page", ["1"])[0])))
                    except ValueError:
                        return self.reply({"error": "Некорректная страница"}, 400)
                    result = public_profile(
                        unquote(parsed.path[len("/api/players/") :]),
                        page,
                        query.get("category", ["all"])[0],
                    )
                    return (
                        self.reply({"player": result})
                        if result
                        else self.reply({"error": "Игрок не найден"}, 404)
                    )
                if parsed.path == "/api/players":
                    search = query.get("search", [""])[0][:24]
                    # instr treats search text literally, including underscores.
                    players = [
                        dict(r)
                        for r in db.execute(
                            "SELECT u.username,u.avatar,u.created,MAX(r.rating) AS rating,SUM(r.played) AS played FROM users u JOIN ratings r ON r.user_id=u.id WHERE instr(u.username_key,?)>0 GROUP BY u.id ORDER BY u.created DESC LIMIT 50",
                            (name_key(search),),
                        )
                    ]
                    return self.reply({"players": players})
                if self.path == "/api/me":
                    return self.reply({"user": profile(uid) if uid else None})
                if self.path == "/api/state":
                    if not uid:
                        return self.reply({"user": None, "game": None, "queued": False})
                    row = db.execute(
                        "SELECT id FROM games WHERE (white=? OR black=?) AND result IS NULL ORDER BY created DESC LIMIT 1",
                        (uid, uid),
                    ).fetchone()
                    # Include the most recent finished game until a new queue request.
                    if not row:
                        row = db.execute(
                            "SELECT id FROM games WHERE white=? OR black=? ORDER BY created DESC LIMIT 1",
                            (uid, uid),
                        ).fetchone()
                    q = db.execute(
                        "SELECT * FROM queue WHERE user_id=?", (uid,)
                    ).fetchone()
                    if q:
                        db.execute(
                            "UPDATE queue SET touched=? WHERE user_id=?",
                            (time.time(), uid),
                        )
                    g = game_row(row[0]) if row else None
                    return self.reply(
                        {
                            "user": profile(uid),
                            "game": public_game(g, uid) if g and not q else None,
                            "queued": bool(q),
                            "control": q["control"] if q else None,
                        }
                    )
                if self.path == "/api/leaderboard":
                    out = {}
                    for cat in ["bullet", "blitz", "rapid", "classical"]:
                        out[cat] = [
                            dict(r)
                            for r in db.execute(
                                "SELECT u.username,r.rating,r.played FROM ratings r JOIN users u ON u.id=r.user_id WHERE category=? AND played>0 ORDER BY rating DESC LIMIT 20",
                                (cat,),
                            )
                        ]
                    return self.reply(out)
                return self.reply({"error": "Не найдено"}, 404)
            except ClubError as error:
                return self.reply({"error": str(error)}, error.status)
            except Exception:
                return self.reply({"error": "Ошибка сервера"}, 500)

    def do_POST(self):
        # Only same-origin browser requests may mutate authenticated state.
        origin = self.headers.get("Origin")
        host = self.headers.get("Host", "")
        allowed_origins = (
            (PUBLIC_ORIGIN,) if PUBLIC_ORIGIN else ("http://" + host, "https://" + host)
        )
        if origin and origin not in allowed_origins:
            return self.reply({"error": "Недопустимый источник запроса"}, 403)
        try:
            size = int(self.headers.get("Content-Length", "0"))
            if size < 0:
                return self.reply({"error": "Некорректный размер запроса"}, 400)
            if size > 10000:
                return self.reply({"error": "Слишком большой запрос"}, 413)
            x = json.loads(self.rfile.read(size) or b"{}")
            if not isinstance(x, dict):
                raise ValueError()
            self.received_at = time.time()
        except:
            return self.reply({"error": "Некорректный запрос"}, 400)
        with lock:
            try:
                self.post(x)
            except ClubError as error:
                self.reply({"error": str(error)}, error.status)
            except (ValueError, KeyError, TypeError):
                self.reply({"error": "Некорректные данные"}, 400)
            except Exception as e:
                print(type(e).__name__, str(e), flush=True)
                self.reply({"error": "Ошибка сервера"}, 500)

    def post(self, x):
        route = self.path
        uid = self.user()
        if route in ["/api/register", "/api/login"]:
            key = self.client_address[0]
            now = time.time()
            attempts = [t for t in failures.get(key, []) if t > now - 60]
            failures[key] = attempts
            if len(attempts) >= 15:
                return self.reply(
                    {"error": "Слишком много попыток. Подождите минуту."}, 429
                )
            attempts.append(now)
            username = x.get("username", "")
            password = x.get("password", "")
            if not isinstance(username, str) or not isinstance(password, str):
                return self.reply({"error": "Имя и пароль должны быть строками"}, 400)
            username = username.strip()
            if (
                not re.fullmatch(r"[\w-]{3,24}", username)
                or not 8 <= len(password) <= 128
            ):
                return self.reply(
                    {
                        "error": "Имя: 3–24 буквы, цифры, _ или -. Пароль: 8–128 символов."
                    },
                    400,
                )
            if route == "/api/register":
                if db.execute(
                    "SELECT 1 FROM users WHERE username_key=?", (name_key(username),)
                ).fetchone():
                    return self.reply({"error": "Это имя уже занято"}, 409)
                uid = secrets.token_hex(12)
                salt = secrets.token_hex(16)
                hashed = hashlib.pbkdf2_hmac(
                    "sha256", password.encode(), bytes.fromhex(salt), 310000
                ).hex()
                db.execute(
                    "INSERT INTO users(id,username,username_key,password,salt,created) VALUES(?,?,?,?,?,?)",
                    (uid, username, name_key(username), hashed, salt, now),
                )
                for cat in ["bullet", "blitz", "rapid", "classical"]:
                    db.execute(
                        "INSERT INTO ratings(user_id,category) VALUES(?,?)", (uid, cat)
                    )
            else:
                u = db.execute(
                    "SELECT * FROM users WHERE username_key=?", (name_key(username),)
                ).fetchone()
                salt = u["salt"] if u else "00" * 16
                hashed = hashlib.pbkdf2_hmac(
                    "sha256", password.encode(), bytes.fromhex(salt), 310000
                ).hex()
                if not u or not hmac.compare_digest(hashed, u["password"]):
                    return self.reply({"error": "Неверное имя или пароль"}, 401)
                uid = u["id"]
            return self.reply({"user": profile(uid)}, cookie=self.session(uid))
        if not uid:
            return self.reply({"error": "Сначала войдите в профиль"}, 401)
        if route == "/api/challenges":
            return self.reply(
                club.create(uid, x.get("control"), x.get("color", "random"))
            )
        match = re.fullmatch(r"/api/challenges/([A-Za-z0-9_-]+)/(join|cancel)", route)
        if match:
            return self.reply(
                club.accept(match[1], uid)
                if match[2] == "join"
                else club.cancel(match[1], uid)
            )
        match = re.fullmatch(r"/api/games/([a-f0-9]+)/rematch", route)
        if match:
            return self.reply(club.rematch(match[1], uid))
        if route == "/api/logout":
            c = SimpleCookie(self.headers.get("Cookie", ""))
            token = c["dc_session"].value if "dc_session" in c else ""
            db.execute(
                "DELETE FROM sessions WHERE token=?",
                (hashlib.sha256(token.encode()).hexdigest(),),
            )
            db.execute("DELETE FROM queue WHERE user_id=?", (uid,))
            return self.reply(
                {"ok": True},
                cookie="dc_session=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0"
                + COOKIE_SECURE,
            )
        if route == "/api/profile":
            bio = x.get("bio", profile(uid)["bio"])
            avatar = x.get("avatar", profile(uid)["avatar"])
            if (
                not isinstance(bio, str)
                or not isinstance(avatar, str)
                or len(bio) > 240
            ):
                return self.reply(
                    {
                        "error": "Описание и эмблема должны быть строками; описание — до 240 символов"
                    },
                    400,
                )
            bio = bio.strip()
            if avatar not in ["crane", "dragon", "bamboo", "mountain"]:
                return self.reply({"error": "Выберите эмблему из списка"}, 400)
            db.execute("UPDATE users SET bio=?,avatar=? WHERE id=?", (bio, avatar, uid))
            return self.reply({"user": profile(uid)})
        if route == "/api/cancel":
            db.execute("DELETE FROM queue WHERE user_id=?", (uid,))
            return self.reply({"ok": True})
        if route == "/api/queue":
            control = x.get("control")
            if control not in CONTROLS:
                return self.reply({"error": "Выберите контроль времени"}, 400)
            active = db.execute(
                "SELECT id FROM games WHERE (white=? OR black=?) AND result IS NULL",
                (uid, uid),
            ).fetchone()
            if active:
                g = game_row(active[0])
                if not g["result"]:
                    return self.reply({"game": public_game(g, uid)})
            club.cancel_waiting(uid)
            db.execute("DELETE FROM queue WHERE touched<?", (time.time() - 15,))
            waiting = db.execute(
                "SELECT user_id FROM queue WHERE control=? AND user_id!=? ORDER BY RANDOM() LIMIT 1",
                (control, uid),
            ).fetchone()
            if not waiting:
                db.execute(
                    "INSERT OR REPLACE INTO queue VALUES(?,?,?)",
                    (uid, control, time.time()),
                )
                return self.reply({"queued": True})
            white, black = random.sample([uid, waiting[0]], 2)
            game = club.new_game(white, black, control)
            return self.reply({"game": public_game(game, uid)})
        if route in ["/api/move", "/api/resign", "/api/draw", "/api/draw-decline"]:
            received = self.received_at
            g = game_row(str(x.get("game", "")), received)
            if not g or uid not in [g["white"], g["black"]]:
                return self.reply({"error": "Партия не найдена"}, 404)
            if g["result"]:
                return self.reply({"game": public_game(g, uid)})
            side = "w" if uid == g["white"] else "b"
            p = g["payload"]
            if route == "/api/resign":
                finish(g, "b" if side == "w" else "w", "Соперник сдался", received)
            elif route == "/api/draw-decline":
                p["offer"] = None
                db.execute(
                    "UPDATE games SET payload=? WHERE id=?", (json.dumps(p), g["id"])
                )
            elif route == "/api/draw":
                if p.get("offer") and p["offer"] != side:
                    finish(g, "draw", "Ничья по соглашению", received)
                else:
                    p["offer"] = side
                    db.execute(
                        "UPDATE games SET payload=? WHERE id=?",
                        (json.dumps(p), g["id"]),
                    )
            else:
                if p["state"]["turn"] != side:
                    return self.reply({"error": "Сейчас ход соперника"}, 409)
                cmd = {
                    "state": p["state"],
                    "from": x.get("from"),
                    "to": x.get("to"),
                    "promotion": x.get("promotion", "q"),
                    "history": p["history"],
                }
                r = subprocess.run(
                    ["node", str(BASE / "engine-runner.cjs")],
                    input=json.dumps(cmd),
                    capture_output=True,
                    text=True,
                    encoding="utf-8",
                    timeout=5,
                    cwd=BASE,
                )
                out = json.loads(r.stdout)
                if out.get("error"):
                    return self.reply({"error": out["error"]}, 400)
                now = time.time()
                settle_clock(p, received)
                p["clocks"][side] += CONTROLS[g["control"]][2]
                p["tick"] = now
                p["history"].append(p["state"])
                p["state"] = out["state"]
                p["last"] = [x["from"], x["to"]]
                p["moves"].append(
                    {
                        "from": x["from"],
                        "to": x["to"],
                        "piece": p["history"][-1]["b"][x["from"]],
                        "promotion": x.get("promotion", "q"),
                    }
                )
                p["offer"] = None
                db.execute(
                    "UPDATE games SET payload=? WHERE id=?", (json.dumps(p), g["id"])
                )
                if out.get("result"):
                    finish(g, out["result"], out["message"], now)
            return self.reply({"game": public_game(g, uid)})
        return self.reply({"error": "Не найдено"}, 404)


if __name__ == "__main__":
    port = int(os.environ.get("PORT", "4173"))
    host = os.environ.get("DOCTOR_CHESS_HOST", "127.0.0.1")
    print(f"Doctor Chess: {PUBLIC_ORIGIN or f'http://{host}:{port}'}", flush=True)
    ThreadingHTTPServer((host, port), Handler).serve_forever()
