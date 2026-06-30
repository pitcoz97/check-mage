package phase

import "testing"

func TestNext_Sequence(t *testing.T) {
	cases := []struct {
		from Phase
		want Phase
	}{
		{PhaseDraw, PhaseMain1},
		{PhaseMain1, PhaseMove},
		{PhaseMove, PhaseMain2},
		{PhaseMain2, PhaseEndTurn},
		{PhaseEndTurn, PhaseDraw}, // wrap al turno successivo
	}
	for _, c := range cases {
		got, err := Next(c.from)
		if err != nil {
			t.Errorf("Next(%s) errore inatteso: %v", c.from, err)
		}
		if got != c.want {
			t.Errorf("Next(%s) = %s, atteso %s", c.from, got, c.want)
		}
	}
}

func TestNext_Unknown(t *testing.T) {
	if _, err := Next(Phase("boom")); err == nil {
		t.Error("Next su una fase sconosciuta deve restituire errore")
	}
}

func TestIsValid(t *testing.T) {
	for _, p := range Order {
		if !IsValid(p) {
			t.Errorf("%s dovrebbe essere valida", p)
		}
	}
	if IsValid(Phase("boom")) {
		t.Error("una fase sconosciuta non deve essere valida")
	}
}

func TestIsAllowed(t *testing.T) {
	// move: obbligatoria la mossa, niente pass
	if !IsAllowed(PhaseMove, ActionMakeMove) {
		t.Error("move deve permettere make_move")
	}
	if IsAllowed(PhaseMove, ActionPassPhase) {
		t.Error("move non deve permettere pass_phase")
	}

	// main1/main2: magie e pass
	for _, p := range []Phase{PhaseMain1, PhaseMain2} {
		if !IsAllowed(p, ActionCastSpell) {
			t.Errorf("%s deve permettere cast_spell", p)
		}
		if !IsAllowed(p, ActionPassPhase) {
			t.Errorf("%s deve permettere pass_phase", p)
		}
		if IsAllowed(p, ActionMakeMove) {
			t.Errorf("%s non deve permettere make_move", p)
		}
	}

	// end_turn: nessuna azione client
	if len(AllowedActions(PhaseEndTurn)) != 0 {
		t.Error("end_turn non deve permettere alcuna azione client")
	}
}
