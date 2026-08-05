#!/usr/bin/env python3
"""Drive curated Hold'em scenarios through PokerKit and print expected stacks."""

from __future__ import annotations

import json
from pokerkit import Automation, NoLimitTexasHoldem, StandardHighHand

AUTOS = (
    Automation.ANTE_POSTING,
    Automation.BET_COLLECTION,
    Automation.BLIND_OR_STRADDLE_POSTING,
    Automation.CARD_BURNING,
    Automation.HOLE_CARDS_SHOWING_OR_MUCKING,
    Automation.HAND_KILLING,
    Automation.CHIPS_PUSHING,
    Automation.CHIPS_PULLING,
)


def run(name, holes, pre, stacks, boards):
    state = NoLimitTexasHoldem.create_state(
        AUTOS, True, 0, (5, 10), 10, stacks, len(stacks)
    )
    for h in holes:
        state.deal_hole(h)
    for a in pre:
        if a == "fold":
            state.fold()
        elif a in ("call", "check"):
            state.check_or_call()
        else:
            state.complete_bet_or_raise_to(a)
    bi = 0
    guard = 0
    while state.status and guard < 100:
        guard += 1
        if state.can_deal_board() and bi < len(boards):
            state.deal_board(boards[bi])
            bi += 1
        elif state.can_check_or_call():
            state.check_or_call()
        elif state.can_fold():
            state.fold()
        else:
            break
    return {"name": name, "starting": stacks, "stacks": [int(x) for x in state.stacks]}


def main():
    results = [
        run(
            "short_AA_main_KK_side",
            ["KhKd", "QhQd", "AcAd"],
            [20, 100, "call"],
            [200, 200, 20],
            ["2c3d4h", "5s", "7c"],
        ),
        run(
            "triple_allin_short_main",
            ["KhKd", "QhQd", "AcAd"],
            [20, 200, "call"],
            [200, 200, 20],
            ["2c3d4h", "5s", "7c"],
        ),
        run(
            "hu_chop",
            ["AsKh", "AdKc"],
            [100, "call"],
            [100, 100],
            ["2c3d4h", "5s", "7c"],
        ),
        {
            "name": "hand_eval",
            "six_beats_wheel": StandardHighHand.from_game("6c7d", "3d4h5s9cKd")
            > StandardHighHand.from_game("As2c", "3d4h5s9cKd"),
            "sf_beats_quads": StandardHighHand.from_game("9hTh", "JhQhKh2c2d")
            > StandardHighHand.from_game("AsAd", "AhAcKh2c3d"),
            "ak_kicker_beats_aq": StandardHighHand.from_game("AsKd", "Ah2c3d7h9s")
            > StandardHighHand.from_game("AcQd", "Ah2c3d7h9s"),
        },
    ]
    print(json.dumps(results, indent=2))


if __name__ == "__main__":
    main()
