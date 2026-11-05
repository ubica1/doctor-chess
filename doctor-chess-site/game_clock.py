"""Clock settlement and material-based impossibility of checkmate."""


def insufficient_for_side(state, side):
    pieces = [(i, p.lower()) for i, p in enumerate(state["b"]) if p]
    own = [
        (i, p.lower())
        for i, p in enumerate(state["b"])
        if p and p.isupper() == (side == "w")
    ]
    if any(p in "pqr" for _, p in own):
        return False
    if any(p == "n" for _, p in own):
        # A lone knight cannot mate a bare king (or king with queens only).
        opponent = [p.lower() for p in state["b"] if p and p.isupper() != (side == "w")]
        return len(own) <= 2 and not any(p not in "kq" for p in opponent)
    if any(p == "b" for _, p in own):
        colors = {(i // 8 + i % 8) % 2 for i, p in pieces if p == "b"}
        return len(colors) == 1 and not any(p in "pn" for _, p in pieces)
    return True


def settle_clock(payload, now):
    side = payload["state"]["turn"]
    payload["clocks"][side] = max(
        0, payload["clocks"][side] - max(0, now - payload["tick"])
    )
    payload["tick"] = max(now, payload["tick"])
    return payload["clocks"][side] <= 0
