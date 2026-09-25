package effects

import (
	"testing"

	"chess-server/internal/spells"
)

func withWalls(fen string, squares ...string) *Tracker {
	tr := NewTracker(fen)
	for _, sq := range squares {
		tr.AddSquareEffect(sq, KindWall, 2, "ice_wall", White)
	}
	return tr
}

// Criterio del brief: una torre non attraversa un muro; un cavallo lo scavalca
// ma non ci atterra.
func TestMoveBlock_Walls(t *testing.T) {
	const fen = "4k3/8/8/8/8/8/8/R3K1N1 w - - 0 1"
	tr := withWalls(fen, "a4", "f3")
	cases := []struct {
		move, square, reason string
	}{
		{"a1a3", "", ""},              // prima del muro
		{"a1a4", "a4", ReasonWall},    // sul muro
		{"a1a6", "a4", ReasonWall},    // attraverso il muro
		{"g1f3", "f3", ReasonWall},    // il cavallo non atterra sul muro
		{"g1h3", "", ""},              // il cavallo scavalca
		{"e1f2", "", ""},              // il re accanto al muro
	}
	for _, c := range cases {
		sq, reason := MoveBlock(fen, tr, c.move)
		if sq != c.square || reason != c.reason {
			t.Errorf("%s: (%q, %q), attesi (%q, %q)", c.move, sq, reason, c.square, c.reason)
		}
	}
	// Il cavallo scavalca un muro fra partenza e arrivo.
	if _, reason := MoveBlock(fen, withWalls(fen, "g2", "f2"), "g1f3"); reason != "" {
		t.Errorf("il cavallo deve scavalcare i muri: %s", reason)
	}
}

func TestMoveBlock_PawnsAndCastling(t *testing.T) {
	const fen = "r3k2r/pppppppp/8/8/8/8/PPPPPPPP/R3K2R w KQkq - 0 1"
	if sq, reason := MoveBlock(fen, withWalls(fen, "e3"), "e2e4"); sq != "e3" || reason != ReasonWall {
		t.Errorf("spinta doppia attraverso il muro: %q %q", sq, reason)
	}
	if _, reason := MoveBlock(fen, withWalls(fen, "e4"), "e2e3"); reason != "" {
		t.Errorf("spinta semplice davanti al muro: %q", reason)
	}
	// Arrocco: bloccato da un muro su qualunque casa fra re e torre.
	for _, c := range []struct{ move, wall string }{{"e1g1", "f1"}, {"e1g1", "g1"}, {"e1c1", "b1"}, {"e1c1", "d1"}} {
		if sq, reason := MoveBlock(fen, withWalls(fen, c.wall), c.move); sq != c.wall || reason != ReasonWall {
			t.Errorf("%s con muro in %s: %q %q", c.move, c.wall, sq, reason)
		}
	}
	if _, reason := MoveBlock(fen, withWalls(fen, "b1"), "e1g1"); reason != "" {
		t.Errorf("il muro sull'altro lato non blocca l'arrocco corto: %q", reason)
	}
}

// Criterio del brief: nessuna cattura su una casa Santuario, en passant compreso.
func TestMoveBlock_Sanctuary(t *testing.T) {
	const fen = "4k3/8/8/3pP3/8/8/8/3QK3 w - d6 0 1"
	tr := NewTracker(fen)
	tr.AddSquareEffect("d5", KindNoCapture, 3, "sanctuary", Black)
	if sq, reason := MoveBlock(fen, tr, "d1d5"); sq != "d5" || reason != ReasonNoCapture {
		t.Errorf("cattura sul santuario: %q %q", sq, reason)
	}
	if sq, reason := MoveBlock(fen, tr, "e5d6"); sq != "d5" || reason != ReasonNoCapture {
		t.Errorf("en passant sul pedone nel santuario: %q %q", sq, reason)
	}
	if _, reason := MoveBlock(fen, tr, "d1d4"); reason != "" {
		t.Errorf("una mossa senza cattura resta libera: %q", reason)
	}
	// Si entra in un santuario vuoto.
	tr.AddSquareEffect("d3", KindNoCapture, 3, "sanctuary", Black)
	if _, reason := MoveBlock(fen, tr, "d1d3"); reason != "" {
		t.Errorf("si può entrare in un santuario: %q", reason)
	}
}

// Criterio del brief: un muro scade dopo il numero di turni previsto. Durata 2
// = due turni dell'avversario di chi lo lancia.
func TestSquareEffects_Duration(t *testing.T) {
	tr := NewTracker(startFEN)
	tr.AddSquareEffect("e4", KindWall, 2, "ice_wall", White)
	steps := []struct {
		finishing Color
		expired   bool
	}{
		{White, false}, // fine del turno di chi lancia: non conta
		{Black, false}, // primo turno avversario
		{White, false},
		{Black, true}, // secondo turno avversario: scade
	}
	for i, s := range steps {
		if got := tr.TickSquares(s.finishing); got != s.expired {
			t.Fatalf("passo %d: scaduto = %v, atteso %v", i, got, s.expired)
		}
	}
	if tr.HasSquareEffect("e4", KindWall) || len(tr.SquareEffects()) != 0 {
		t.Error("il muro deve essere sparito")
	}
}

func TestSquareEffects_RenewCloneAndList(t *testing.T) {
	tr := NewTracker(startFEN)
	tr.AddSquareEffect("e4", KindWall, 1, "ice_wall", White)
	tr.AddSquareEffect("e4", KindWall, 2, "ice_wall", Black)
	tr.AddSquareEffect("a3", KindNoCapture, 3, "sanctuary", White)
	list := tr.SquareEffects()
	if len(list) != 2 || list[0].Square != "a3" || list[1].Square != "e4" {
		t.Fatalf("lista ordinata per casa: %+v", list)
	}
	if e := list[1].Effects; len(e) != 1 || e[0].RemainingTurns != 2 || e[0].Caster != Black {
		t.Errorf("rilanciare rinnova il muro: %+v", e)
	}
	clone := tr.Clone()
	clone.AddSquareEffect("h5", KindWall, 2, "ice_wall", White)
	clone.TickSquares(Black)
	if tr.HasSquareEffect("h5", KindWall) || tr.SquareEffects()[0].Effects[0].RemainingTurns != 3 {
		t.Error("il clone non deve toccare l'originale")
	}

	restored := NewTracker(startFEN)
	for _, s := range list {
		restored.RestoreSquareEffects(s.Square, s.Effects)
	}
	restored.RestoreSquareEffects("z9", list[0].Effects)
	if len(restored.SquareEffects()) != 2 || !restored.HasSquareEffect("a3", KindNoCapture) {
		t.Errorf("ripristino: %+v", restored.SquareEffects())
	}
}

// Una casa col muro non è vuota per i bersagli empty_square.
func TestValidateTargets_Wall(t *testing.T) {
	tr := withWalls(startFEN, "e4")
	spec := []spells.TargetSpec{{Type: spells.TargetSquare, EmptySquare: true}}
	err := ValidateTargets(startFEN, tr, spec, []string{"e4"}, White)
	if reason(t, err) != ReasonWall {
		t.Errorf("muro come casa vuota: %v", err)
	}
	if err := ValidateTargets(startFEN, tr, []spells.TargetSpec{{Type: spells.TargetSquare}}, []string{"e4"}, White); err != nil {
		t.Errorf("una casa qualsiasi accetta anche il muro: %v", err)
	}
}
