"""Private-by-default studies with legal trees and optimistic revisions."""

import json
import re
import secrets
import subprocess
import time

from social import ClubError


class Studies:
    def __init__(self, db, base):
        self.db = db
        self.base = base
        db.executescript("""
        CREATE TABLE IF NOT EXISTS studies(
          id TEXT PRIMARY KEY, owner TEXT NOT NULL, title TEXT NOT NULL,
          description TEXT NOT NULL, document TEXT NOT NULL, public INTEGER NOT NULL DEFAULT 0,
          revision INTEGER NOT NULL DEFAULT 1, archived INTEGER NOT NULL DEFAULT 0,
          created REAL NOT NULL, updated REAL NOT NULL);
        CREATE INDEX IF NOT EXISTS studies_owner ON studies(owner,archived,updated);
        """)
        if "client_key" not in [
            row[1] for row in db.execute("PRAGMA table_info(studies)")
        ]:
            db.execute("ALTER TABLE studies ADD COLUMN client_key TEXT")
        db.execute(
            "CREATE UNIQUE INDEX IF NOT EXISTS studies_create_key ON studies(owner,client_key)"
        )

    def owner_row(self, uid, sid):
        row = self.db.execute(
            "SELECT * FROM studies WHERE id=? AND owner=?", (sid, uid)
        ).fetchone()
        if not row:
            raise ClubError("Исследование не найдено.", 404)
        return row

    def prepare(self, data):
        title, description, public = (
            data.get("title"),
            data.get("description", ""),
            data.get("public", False),
        )
        if not isinstance(title, str) or not 1 <= len(title.strip()) <= 80:
            raise ClubError("Название — от 1 до 80 символов.")
        if (
            not isinstance(description, str)
            or len(description) > 400
            or type(public) is not bool
        ):
            raise ClubError("Описание — до 400 символов. Выберите допустимый доступ.")
        document = data.get("document")
        if (
            not isinstance(document, dict)
            or not isinstance(document.get("nodes"), list)
            or len(document["nodes"]) > 400
        ):
            raise ClubError("Исследование должно содержать до 400 позиций.")
        try:
            result = subprocess.run(
                ["node", str(self.base / "study-runner.cjs")],
                input=json.dumps(document),
                capture_output=True,
                text=True,
                encoding="utf-8",
                timeout=8,
                cwd=self.base,
            )
            if result.returncode:
                raise ValueError()
            checked = json.loads(result.stdout)
        except (subprocess.TimeoutExpired, ValueError, OSError):
            raise ClubError(
                "Не удалось проверить варианты. Уменьшите исследование и повторите."
            )
        if checked.get("error"):
            raise ClubError(checked["error"])
        return {
            "title": title.strip(),
            "description": description.strip(),
            "public": public,
            "document": checked["document"],
        }

    def detail(self, uid, sid):
        row = self.db.execute(
            "SELECT s.*,u.username AS author FROM studies s JOIN users u ON u.id=s.owner WHERE s.id=?",
            (sid,),
        ).fetchone()
        if not row or row["archived"] or (not row["public"] and row["owner"] != uid):
            raise ClubError("Исследование не найдено или доступно только автору.", 404)
        out = self.summary(row)
        out.update(
            document=json.loads(row["document"]),
            own=uid == row["owner"],
            author=row["author"],
        )
        return {"study": out}

    @staticmethod
    def summary(row):
        return {
            key: row[key]
            for key in ("id", "title", "description", "revision", "created", "updated")
        } | {"public": bool(row["public"]), "archived": bool(row["archived"])}

    def listing(self, uid, page, archived=False):
        if not uid:
            raise ClubError("Войдите, чтобы открыть свои исследования.", 401)
        total = self.db.execute(
            "SELECT COUNT(*) FROM studies WHERE owner=? AND archived=?",
            (uid, int(archived)),
        ).fetchone()[0]
        rows = self.db.execute(
            "SELECT * FROM studies WHERE owner=? AND archived=? ORDER BY updated DESC,id LIMIT 20 OFFSET ?",
            (uid, int(archived), (page - 1) * 20),
        ).fetchall()
        return {
            "studies": [self.summary(row) for row in rows],
            "total": total,
            "page": page,
            "archived": archived,
        }

    def save(self, uid, sid, data, prepared):
        if not uid:
            raise ClubError("Войдите, чтобы сохранить исследование.", 401)
        if prepared is None:
            raise ClubError("Исследование не прошло проверку.")
        now = time.time()
        doc = json.dumps(prepared["document"], ensure_ascii=False)
        if sid is None:
            client_key = data.get("clientKey")
            if not isinstance(client_key, str) or not re.fullmatch(
                r"[A-Za-z0-9_-]{8,64}", client_key
            ):
                raise ClubError("Не удалось распознать черновик. Сохраните его копию.")
            previous = self.db.execute(
                "SELECT id FROM studies WHERE owner=? AND client_key=?",
                (uid, client_key),
            ).fetchone()
            if previous:
                return self.detail(uid, previous["id"])
            if (
                self.db.execute(
                    "SELECT COUNT(*) FROM studies WHERE owner=?", (uid,)
                ).fetchone()[0]
                >= 100
            ):
                raise ClubError(
                    "В профиле уже 100 исследований, включая архив. Можно продолжить одно из сохранённых.",
                    409,
                )
            sid = secrets.token_hex(12)
            self.db.execute(
                "INSERT INTO studies(id,owner,title,description,document,public,created,updated,client_key) VALUES(?,?,?,?,?,?,?,?,?)",
                (
                    sid,
                    uid,
                    prepared["title"],
                    prepared["description"],
                    doc,
                    int(prepared["public"]),
                    now,
                    now,
                    client_key,
                ),
            )
        else:
            row = self.owner_row(uid, sid)
            revision = data.get("revision")
            if (
                type(revision) is not int
                or revision != row["revision"]
                or row["archived"]
            ):
                raise ClubError(
                    "Исследование изменено в другой вкладке. Сохраните копию, чтобы не потерять свои правки.",
                    409,
                )
            self.db.execute(
                "UPDATE studies SET title=?,description=?,document=?,public=?,revision=revision+1,updated=? WHERE id=? AND owner=? AND revision=?",
                (
                    prepared["title"],
                    prepared["description"],
                    doc,
                    int(prepared["public"]),
                    now,
                    sid,
                    uid,
                    revision,
                ),
            )
        return self.detail(uid, sid)

    def archive(self, uid, sid, data, archived):
        row = self.owner_row(uid, sid)
        revision = data.get("revision")
        if type(revision) is not int or revision != row["revision"]:
            raise ClubError(
                "Запись изменилась. Обновите список и повторите действие.", 409
            )
        self.db.execute(
            "UPDATE studies SET archived=?,revision=revision+1,updated=? WHERE id=? AND owner=? AND revision=?",
            (int(archived), time.time(), sid, uid, revision),
        )
        return {"ok": True}
