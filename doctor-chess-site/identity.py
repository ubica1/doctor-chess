"""Canonical account names and a non-destructive, repeatable schema migration."""

import sqlite3
import unicodedata
import uuid
from pathlib import Path
from contextlib import closing


def name_key(name):
    return unicodedata.normalize("NFKC", name).casefold()


def migrate_names(db, path):
    if "username_key" in {r[1] for r in db.execute("PRAGMA table_info(users)")}:
        return
    rows = list(db.execute("SELECT id,username FROM users"))
    groups = {}
    for uid, name in rows:
        groups.setdefault(name_key(name), []).append((uid, name))
    conflicts = [items for items in groups.values() if len(items) > 1]
    if conflicts:
        raise RuntimeError(
            "Конфликт имён Unicode; миграция отменена. Сделайте резервную копию, "
            "выберите новые имена для перечисленных ID и повторите запуск: "
            + repr(conflicts)
        )
    if rows:
        backup = Path(str(path) + ".before-unicode-" + uuid.uuid4().hex + ".sqlite3")
        # Never overwrite an earlier migration backup.
        with backup.open("xb"):
            pass
        with closing(sqlite3.connect(backup)) as copy:
            db.backup(copy)
    db.execute("BEGIN IMMEDIATE")
    try:
        db.execute("ALTER TABLE users ADD COLUMN username_key TEXT")
        db.executemany(
            "UPDATE users SET username_key=? WHERE id=?",
            [(name_key(name), uid) for uid, name in rows],
        )
        db.execute("CREATE UNIQUE INDEX users_username_key ON users(username_key)")
        db.execute("COMMIT")
    except Exception:
        db.execute("ROLLBACK")
        raise
