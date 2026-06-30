package effects

import "testing"

const (
	startFEN = "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1"
	// Cavallo bianco in e4, nero al tratto.
	knightE4 = "rnbqkbnr/pppppppp/8/8/4N3/8/PPPPPPPP/RNBQKBNR b KQkq - 0 1"
)

func TestPieceAt(t *testing.T) {
	p, err := PieceAt(knightE4, "e4")
	if err != nil {
		t.Fatalf("errore inatteso: %v", err)
	}
	if p != 'N' {
		t.Errorf("e4 = %c, atteso N", p)
	}
	empty, _ := PieceAt(knightE4, "e5")
	if empty != 0 {
		t.Errorf("e5 dovrebbe essere vuota, trovato %c", empty)
	}
	// Pezzi iniziali.
	if p, _ := PieceAt(startFEN, "a8"); p != 'r' {
		t.Errorf("a8 = %c, atteso r", p)
	}
	if p, _ := PieceAt(startFEN, "e1"); p != 'K' {
		t.Errorf("e1 = %c, atteso K", p)
	}
}

func TestDestroyPiece_EnemyKnight(t *testing.T) {
	// Il nero distrugge il cavallo bianco in e4.
	newFEN, destroyed, err := DestroyPiece(knightE4, "e4", Black)
	if err != nil {
		t.Fatalf("errore inatteso: %v", err)
	}
	if destroyed != "knight" {
		t.Errorf("pezzo distrutto = %s, atteso knight", destroyed)
	}
	// e4 ora vuota.
	if p, _ := PieceAt(newFEN, "e4"); p != 0 {
		t.Errorf("e4 dovrebbe essere vuota dopo destroy, trovato %c", p)
	}
	// Lato al tratto e altri campi invariati.
	if newFEN != "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR b KQkq - 0 1" {
		t.Errorf("FEN risultante inattesa: %s", newFEN)
	}
}

func TestDestroyPiece_Rejections(t *testing.T) {
	// Casella vuota.
	if _, _, err := DestroyPiece(startFEN, "e4", White); err == nil {
		t.Error("distruggere una casella vuota dovrebbe fallire")
	}
	// Pezzo proprio (il bianco prova a distruggere un pedone bianco).
	if _, _, err := DestroyPiece(startFEN, "e2", White); err == nil {
		t.Error("distruggere un proprio pezzo dovrebbe fallire")
	}
	// Re (il bianco prova a distruggere il re nero).
	if _, _, err := DestroyPiece(startFEN, "e8", White); err == nil {
		t.Error("distruggere il re dovrebbe fallire")
	}
	// Casella malformata.
	if _, _, err := DestroyPiece(startFEN, "z9", White); err == nil {
		t.Error("una casella non valida dovrebbe fallire")
	}
}

func TestDestroyPiece_ClearsCastling(t *testing.T) {
	// Torre nera in h8, il bianco la distrugge → cade il diritto "k".
	fen := "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1"
	newFEN, _, err := DestroyPiece(fen, "h8", White)
	if err != nil {
		t.Fatalf("errore inatteso: %v", err)
	}
	cast := castlingField(newFEN)
	if cast != "KQq" {
		t.Errorf("arrocco = %s, atteso KQq (caduto 'k')", cast)
	}

	// Torre bianca in a1 → cade "Q".
	newFEN, _, _ = DestroyPiece(fen, "a1", Black)
	if c := castlingField(newFEN); c != "Kkq" {
		t.Errorf("arrocco = %s, atteso Kkq (caduto 'Q')", c)
	}
}

func castlingField(fen string) string {
	n := 0
	start := 0
	for i := 0; i < len(fen); i++ {
		if fen[i] == ' ' {
			n++
			if n == 2 {
				start = i + 1
			} else if n == 3 {
				return fen[start:i]
			}
		}
	}
	return ""
}

// TestEncodeRoundTrip verifica che parse+encode preservi la posizione.
func TestEncodeRoundTrip(t *testing.T) {
	for _, fen := range []string{startFEN, knightE4} {
		grid, err := parsePlacement(fen)
		if err != nil {
			t.Fatalf("parse fallito: %v", err)
		}
		got := encodePlacement(grid)
		want := fenPlacement(fen)
		if got != want {
			t.Errorf("round-trip: got %s, want %s", got, want)
		}
	}
}

func fenPlacement(fen string) string {
	for i := 0; i < len(fen); i++ {
		if fen[i] == ' ' {
			return fen[:i]
		}
	}
	return fen
}
