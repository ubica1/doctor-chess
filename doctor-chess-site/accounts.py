"""Bounded password work outside the shared game lock; explicit proxy trust."""

import hashlib
import hmac
import ipaddress
import re
import secrets
import sqlite3
import time

from identity import name_key
from social import ClubError


def client_address(peer, headers, trust_proxy=False):
    try:
        address = ipaddress.ip_address(peer)
        if trust_proxy and (address.is_private or address.is_loopback):
            forwarded = headers.get("X-Doctor-Client-IP", "").strip()
            if forwarded:
                return str(ipaddress.ip_address(forwarded))
        return str(address)
    except ValueError:
        return peer


class Accounts:
    def __init__(self, db, attempts):
        self.db, self.attempts = db, attempts
        self.cleaned = 0

    def prepare(self, route, data, address):
        now = time.monotonic()
        if now - self.cleaned > 60:
            stale = [
                key
                for key, times in self.attempts.items()
                if not times or times[-1] <= now - 60
            ]
            for key in stale:
                del self.attempts[key]
            self.cleaned = now
        if address not in self.attempts and len(self.attempts) >= 10000:
            raise ClubError(
                "Сейчас слишком много запросов входа. Повторите немного позже.", 429
            )
        attempts = [t for t in self.attempts.get(address, []) if t > now - 60]
        self.attempts[address] = attempts
        if len(attempts) >= 15:
            raise ClubError("Слишком много попыток. Подождите минуту.", 429)
        attempts.append(now)
        username, password = data.get("username", ""), data.get("password", "")
        if not isinstance(username, str) or not isinstance(password, str):
            raise ClubError("Имя и пароль должны быть строками")
        try:
            password.encode("utf-8")
        except UnicodeError:
            raise ClubError("Пароль содержит недопустимые символы.")
        username = username.strip()
        if not re.fullmatch(r"[\w-]{3,24}", username) or not 8 <= len(password) <= 128:
            raise ClubError("Имя: 3–24 буквы, цифры, _ или -. Пароль: 8–128 символов.")
        key = name_key(username)
        row = self.db.execute(
            "SELECT id,salt,password FROM users WHERE username_key=?", (key,)
        ).fetchone()
        register = route == "/api/register"
        if register and row:
            raise ClubError("Это имя уже занято", 409)
        return {
            "register": register,
            "username": username,
            "key": key,
            "uid": secrets.token_hex(12) if register else row["id"] if row else None,
            "salt": (
                secrets.token_hex(16) if register else row["salt"] if row else "00" * 16
            ),
            "expected": row["password"] if row else None,
            "password": password,
        }

    def compute(self, prepared):
        out = {k: v for k, v in prepared.items() if k != "password"}
        out["hashed"] = hashlib.pbkdf2_hmac(
            "sha256",
            prepared["password"].encode(),
            bytes.fromhex(prepared["salt"]),
            310000,
        ).hex()
        return out

    def finish(self, prepared):
        if not prepared:
            raise ClubError("Повторите вход в профиль.", 401)
        if not prepared["register"]:
            row = self.db.execute(
                "SELECT password,salt FROM users WHERE id=?", (prepared["uid"],)
            ).fetchone()
            if (
                not row
                or row["salt"] != prepared["salt"]
                or row["password"] != prepared["expected"]
                or not hmac.compare_digest(prepared["hashed"], row["password"])
            ):
                raise ClubError("Неверное имя или пароль", 401)
            return prepared["uid"]
        self.db.execute("BEGIN IMMEDIATE")
        try:
            self.db.execute(
                "INSERT INTO users(id,username,username_key,password,salt,created) VALUES(?,?,?,?,?,?)",
                (
                    prepared["uid"],
                    prepared["username"],
                    prepared["key"],
                    prepared["hashed"],
                    prepared["salt"],
                    time.time(),
                ),
            )
            for category in ("bullet", "blitz", "rapid", "classical"):
                self.db.execute(
                    "INSERT INTO ratings(user_id,category) VALUES(?,?)",
                    (prepared["uid"], category),
                )
            self.db.execute("COMMIT")
        except sqlite3.IntegrityError:
            self.db.execute("ROLLBACK")
            raise ClubError("Это имя уже занято", 409)
        except Exception:
            self.db.execute("ROLLBACK")
            raise
        return prepared["uid"]
