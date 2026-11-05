"""Consensual actions in casual games, serialized by the application lock."""

import json
import re
import secrets

from game_clock import settle_clock
from social import ClubError


class FriendlyActions:
    def __init__(self, db, controls, game_row, public_game):
        self.db = db
        self.controls = controls
        self.game_row = game_row
        self.public_game = public_game

    def act(self, uid, action, data, received):
        game = self.game_row(str(data.get("game", "")), received)
        if not game or uid not in (game["white"], game["black"]):
            raise ClubError("Партия не найдена.", 404)
        if game["result"]:
            raise ClubError("Партия уже завершена.", 409)
        if game["kind"] != "casual":
            raise ClubError("Это действие доступно только в дружеской партии.", 403)
        side = "w" if game["white"] == uid else "b"
        other = "b" if side == "w" else "w"
        p = game["payload"]
        if action == "give-time":
            token = data.get("token")
            if not isinstance(token, str) or not re.fullmatch(
                r"[A-Za-z0-9_-]{8,64}", token
            ):
                raise ClubError("Обновите страницу и повторите действие.")
            gifts = p.setdefault("timeGifts", {}).setdefault(side, [])
            if token in gifts:
                return {"game": self.public_game(game, uid)}
            if len(gifts) >= 20:
                raise ClubError("В этой партии уже подарено пять минут.", 409)
            settle_clock(p, received)
            p["clocks"][other] += 15
            gifts.append(token)
        elif action == "takeback-request":
            ply = data.get("ply")
            if type(ply) is not int or ply != len(p["moves"]):
                raise ClubError("Позиция изменилась. Повторите действие.", 409)
            last_side = "w" if ply % 2 else "b"
            if not ply or last_side != side:
                raise ClubError(
                    "Можно попросить вернуть только свой последний ход.", 409
                )
            if p.get("takebackDenied") == ply:
                raise ClubError("Соперник отклонил просьбу. Продолжайте партию.", 409)
            if not p.get("takeback"):
                p["takeback"] = {"id": secrets.token_hex(12), "side": side, "ply": ply}
        elif action in ("takeback-accept", "takeback-decline"):
            offer = p.get("takeback")
            if (
                not offer
                or offer["id"] != data.get("offer")
                or offer["ply"] != len(p["moves"])
            ):
                raise ClubError("Просьба уже не действует.", 409)
            if action == "takeback-accept":
                if side == offer["side"]:
                    raise ClubError("Ожидаем согласия соперника.", 403)
                settle_clock(p, received)
                p["state"] = p["history"].pop()
                p["moves"].pop()
                last = p["moves"][-1] if p["moves"] else None
                p["last"] = [last["from"], last["to"]] if last else []
                # Spent time is never refunded; remove the undone move's increment.
                p["clocks"][offer["side"]] = max(
                    0, p["clocks"][offer["side"]] - self.controls[game["control"]][2]
                )
                p["offer"] = None
                p.pop("takebackDenied", None)
            elif side != offer["side"]:
                p["takebackDenied"] = len(p["moves"])
            p["takeback"] = None
        else:
            raise ClubError("Действие не найдено.", 404)
        self.db.execute(
            "UPDATE games SET payload=? WHERE id=? AND result IS NULL",
            (json.dumps(p), game["id"]),
        )
        return {"game": self.public_game(self.game_row(game["id"], received), uid)}
