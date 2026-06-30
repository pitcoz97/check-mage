package engine

import "testing"

func TestIsDrawByRule_StartingAndOpenings(t *testing.T) {
	// Posizioni normali: NON devono essere patta (era il bug).
	notDraw := []string{
		StartingFEN,
		"rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq e3 0 1",      // dopo 1.e4
		"rnbqkbnr/pppp1ppp/8/4p3/4P3/8/PPPP1PPP/RNBQKBNR w KQkq e6 0 2",    // dopo 1.e4 e5
		"r1bqkbnr/pppp1ppp/2n5/4p3/4P3/5N2/PPPP1PPP/RNBQKB1R b KQkq - 2 3", // un po' più avanti
	}
	for _, fen := range notDraw {
		if isDrawByRule(fen) {
			t.Errorf("posizione NON dovrebbe essere patta: %s", fen)
		}
	}
}

func TestIsDrawByRule_FiftyMoveRule(t *testing.T) {
	// halfmove clock = 100 → patta per regola delle 50 mosse.
	if !isDrawByRule("8/8/8/4k3/8/4K3/8/4R3 w - - 100 120") {
		t.Error("halfmove clock 100 dovrebbe essere patta")
	}
	// 99 → non ancora patta.
	if isDrawByRule("8/8/8/4k3/8/4K3/8/4R3 w - - 99 120") {
		t.Error("halfmove clock 99 non dovrebbe essere patta")
	}
}

func TestInsufficientMaterial(t *testing.T) {
	draws := []string{
		"8/8/8/4k3/8/4K3/8/8 w - - 0 1",   // K vs K
		"8/8/8/4k3/8/4K3/8/5B2 w - - 0 1", // K vs KB
		"8/8/8/4k3/8/4K3/8/5N2 w - - 0 1", // K vs KN
		"8/8/8/4kn2/8/4K3/8/8 w - - 0 1",  // KN vs K
	}
	for _, fen := range draws {
		if !insufficientMaterial(fenPlacement(fen)) {
			t.Errorf("dovrebbe essere materiale insufficiente: %s", fen)
		}
	}

	notDraws := []string{
		StartingFEN,
		"8/8/8/4k3/8/4K3/8/4R3 w - - 0 1",  // torre → matto possibile
		"8/8/8/4k3/8/4K3/8/3Q4 w - - 0 1",  // donna
		"8/4p3/8/4k3/8/4K3/8/8 w - - 0 1",  // pedone
		"8/8/8/2bk4/8/4K3/8/5B2 w - - 0 1", // due alfieri (conservativo: non patta)
	}
	for _, fen := range notDraws {
		if insufficientMaterial(fenPlacement(fen)) {
			t.Errorf("NON dovrebbe essere materiale insufficiente: %s", fen)
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
