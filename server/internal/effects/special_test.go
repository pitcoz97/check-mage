package effects

import (
	"strings"
	"testing"
)

func hasMove(moves []string, move string) bool {
	for _, m := range moves {
		if m == move {
			return true
		}
	}
	return false
}

// Phasing: l'alfiere attraversa i pezzi fino a case vuote, senza catturare; il
// muro lo ferma (M54).
func TestSpecialMoves_Phasing(t *testing.T) {
	const fen = "4k3/8/8/8/8/2p5/1P6/B3K3 w - - 0 1"
	tr := NewTracker(fen)
	if err := AddMovementEffect(tr, "a1", KindPhasing, "", White, 0, "phase_step"); err != nil {
		t.Fatalf("phasing: %v", err)
	}
	moves := SpecialMoves(fen, tr, false)
	for _, m := range []string{"a1d4", "a1e5", "a1h8"} {
		if !hasMove(moves, m) {
			t.Errorf("manca %s in %v", m, moves)
		}
	}
	if hasMove(moves, "a1b2") || hasMove(moves, "a1c3") {
		t.Errorf("niente case occupate: %v", moves)
	}
	tr.AddSquareEffect("f6", KindWall, 2, "ice_wall", Black)
	moves = SpecialMoves(fen, tr, false)
	if !hasMove(moves, "a1e5") || hasMove(moves, "a1g7") || hasMove(moves, "a1f6") {
		t.Errorf("il muro ferma il phasing: %v", moves)
	}
	if err := AddMovementEffect(tr, "c3", KindPhasing, "", White, 0, "phase_step"); err == nil {
		t.Error("il phasing va solo sui propri pezzi")
	}
}

// Movimento preso in prestito: catture ammesse, mai in 1ª o 8ª traversa (M55, M56).
func TestSpecialMoves_Borrow(t *testing.T) {
	const knight = "4k3/8/1P6/3p4/8/8/8/4K3 w - - 0 1"
	tr := NewTracker(knight)
	AddMovementEffect(tr, "b6", KindBorrow, "knight", White, 0, "echo_of_fallen")
	moves := SpecialMoves(knight, tr, false)
	if !hasMove(moves, "b6d5") || !hasMove(moves, "b6d7") || !hasMove(moves, "b6a4") {
		t.Errorf("salti del cavallo, con cattura in d5: %v", moves)
	}
	if hasMove(moves, "b6c8") || hasMove(moves, "b6a8") {
		t.Errorf("mai in ottava traversa: %v", moves)
	}
	if tr.BorrowedAs("b6") != "knight" {
		t.Errorf("BorrowedAs = %q", tr.BorrowedAs("b6"))
	}

	const bishop = "4k3/8/5n2/8/3P4/8/8/4K3 w - - 0 1"
	tr = NewTracker(bishop)
	AddMovementEffect(tr, "d4", KindBorrow, "bishop", White, 0, "echo_of_fallen")
	moves = SpecialMoves(bishop, tr, false)
	if !hasMove(moves, "d4e5") || !hasMove(moves, "d4f6") || hasMove(moves, "d4g7") {
		t.Errorf("l'alfiere preso in prestito cattura e si ferma: %v", moves)
	}
}

// Passo di lato: case vuote accanto, senza cattura; niente che scopra il re (M58, M59).
func TestSpecialMoves_SidestepAndKingSafety(t *testing.T) {
	const fen = "4k3/8/8/8/4Pp2/8/8/4K3 w - - 0 1"
	moves := SpecialMoves(fen, NewTracker(fen), true)
	if !hasMove(moves, "e4d4") || hasMove(moves, "e4f4") {
		t.Errorf("passo di lato solo sulla casa vuota: %v", moves)
	}
	if got := SpecialMoves(fen, NewTracker(fen), false); len(got) != 0 {
		t.Errorf("senza Stendardo niente passo di lato: %v", got)
	}
	const pinned = "4r1k1/8/8/8/8/8/4P3/4K3 w - - 0 1"
	if got := SpecialMoves(pinned, NewTracker(pinned), true); len(got) != 0 {
		t.Errorf("il pedone inchiodato non scopre il re: %v", got)
	}
	frozen := NewTracker(fen)
	FreezePiece(frozen, "e4", Black, 1, "frost")
	if got := SpecialMoves(fen, frozen, true); len(got) != 0 {
		t.Errorf("un pezzo congelato non ha mosse speciali: %v", got)
	}
}

func TestApplySpecialMove(t *testing.T) {
	got, err := ApplySpecialMove("4k3/8/8/8/4P3/8/8/4K3 w - e3 5 10", "e4d4")
	if err != nil || got != "4k3/8/8/8/3P4/8/8/4K3 b - - 0 10" {
		t.Errorf("passo di lato: %q %v", got, err)
	}
	got, _ = ApplySpecialMove("4k3/8/8/8/8/8/8/B3K3 b - - 3 10", "e8d8")
	if !strings.HasSuffix(got, " w - - 4 11") {
		t.Errorf("contatori dopo una mossa del Nero: %q", got)
	}
	got, _ = ApplySpecialMove("r3k3/8/8/8/8/8/8/B3K3 w q - 0 1", "a1a8")
	if !strings.HasPrefix(got, "B3k3/") || strings.Fields(got)[2] != "-" {
		t.Errorf("cattura della torre: arrocco revocato: %q", got)
	}
}
