package effects

import (
	"testing"

	"chess-server/internal/gameerr"
)

func TestSwapPieces(t *testing.T) {
	got, err := SwapPieces(startFEN, "b1", "c1")
	if err != nil || got != "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RBNQKBNR w KQkq - 0 1" {
		t.Errorf("scambio cavallo-alfiere: %s %v", got, err)
	}
	// La torre che lascia a1 perde il diritto d'arrocco lungo.
	got, _ = SwapPieces(startFEN, "a1", "b1")
	if castlingField(got) != "Kkq" {
		t.Errorf("arrocchi dopo lo scambio della torre: %s", castlingField(got))
	}
	// Un pedone non può finire in prima traversa.
	_, err = SwapPieces(startFEN, "b1", "b2")
	if ge := gameerr.From(err); ge.Code != gameerr.InvalidTarget || ge.Details["reason"] != ReasonPawnRank {
		t.Errorf("pedone in prima traversa: %v", err)
	}
	if _, err := SwapPieces(startFEN, "b1", "b4"); err == nil {
		t.Error("scambio con una casa vuota dovrebbe fallire")
	}
}

func TestSetPiece(t *testing.T) {
	got, err := SetPiece(startFEN, "b1", 'B')
	if err != nil || got != "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RBBQKBNR w KQkq - 0 1" {
		t.Errorf("metamorfosi: %s %v", got, err)
	}
	if _, err := SetPiece(startFEN, "e4", 'Q'); err == nil {
		t.Error("una casa vuota dovrebbe fallire")
	}
}

func TestRestoreCastling(t *testing.T) {
	const lost = "r3k2r/8/8/8/8/8/8/R3K2R w - - 0 1"
	got, ok := RestoreCastling(lost, White)
	if !ok || castlingField(got) != "KQ" {
		t.Errorf("ripristino del bianco: %s %v", got, ok)
	}
	got, ok = RestoreCastling(got, Black)
	if !ok || castlingField(got) != "KQkq" {
		t.Errorf("ripristino del nero, in ordine canonico: %s %v", got, ok)
	}
	// Re fuori posto: nessun diritto da ripristinare.
	if _, ok := RestoreCastling("r3k2r/8/8/8/8/8/8/R4K1R w - - 0 1", White); ok {
		t.Error("con il re fuori posto non si ripristina nulla")
	}
	// Solo la torre di h1 a posto: solo l'arrocco corto.
	got, _ = RestoreCastling("4k3/8/8/8/8/8/8/1R2K2R w - - 0 1", White)
	if castlingField(got) != "K" {
		t.Errorf("solo arrocco corto atteso, ottenuto %s", castlingField(got))
	}
	// Diritti già presenti: niente da fare.
	if _, ok := RestoreCastling(startFEN, White); ok {
		t.Error("diritti già presenti: nessun effetto")
	}
}

func TestSelections(t *testing.T) {
	// Bianco: re e1, regina d1, pedoni d2 e2 (di lato) e h3; nero: re e8, pedoni a7 c7.
	const fen = "4k3/p1p5/8/8/8/7P/3PP3/3QK3 w - - 0 1"
	if got := PiecesOf(fen, Black, []string{"pawn"}); len(got) != 2 || got[0] != "a7" || got[1] != "c7" {
		t.Errorf("pedoni neri = %v", got)
	}
	if got := PiecesOf(fen, White, nil); len(got) != 4 {
		t.Errorf("pezzi bianchi senza il re = %v", got)
	}
	if got := AroundKing(fen, White, 1); len(got) != 3 || got[0] != "d2" || got[1] != "e2" || got[2] != "d1" {
		t.Errorf("attorno al re = %v", got)
	}
	if got := PawnsSideBySide(fen, White); len(got) != 2 || got[0] != "d2" || got[1] != "e2" {
		t.Errorf("pedoni di lato = %v", got)
	}
	if got := PawnsSideBySide(fen, Black); len(got) != 0 {
		t.Errorf("a7 e c7 non sono di lato: %v", got)
	}
}

func TestTracker_SwapAndSetType(t *testing.T) {
	tr := NewTracker(startFEN)
	FreezePiece(tr, "b8", White, 1, "test")
	idB8, _, _ := tr.Info("b8")
	idC8, _, _ := tr.Info("c8")
	tr.Swap("b8", "c8")
	if id, _, _ := tr.Info("c8"); id != idB8 || !tr.IsFrozen("c8") {
		t.Error("lo scambio deve spostare id ed effetti")
	}
	if id, _, _ := tr.Info("b8"); id != idC8 {
		t.Error("lo scambio deve spostare anche l'altro pezzo")
	}
	tr.SetType("c8", 'b')
	if id, p, _ := tr.Info("c8"); id != idB8 || p != 'b' || !tr.IsFrozen("c8") {
		t.Error("il cambio di tipo conserva id ed effetti")
	}
}
