package effects

import "testing"

func TestIsKingAttacked(t *testing.T) {
	tests := []struct {
		name string
		fen  string
		c    Color
		want bool
	}{
		{"posizione iniziale", "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1", White, false},
		{"torre in colonna", "4k3/8/8/8/8/8/8/4R2K b - - 0 1", Black, true},
		{"torre schermata", "4k3/4p3/8/8/8/8/8/4R2K b - - 0 1", Black, false},
		{"alfiere in diagonale", "4k3/8/8/1B6/8/8/8/7K b - - 0 1", Black, true},
		{"donna in diagonale", "7k/8/8/8/8/8/1q6/K7 w - - 0 1", White, true},
		{"cavallo", "4k3/8/3N4/8/8/8/8/7K b - - 0 1", Black, true},
		{"pedone bianco attacca in avanti", "8/8/8/3k4/4P3/8/8/7K b - - 0 1", Black, true},
		{"pedone bianco non attacca all'indietro", "8/8/8/4P3/3k4/8/8/7K b - - 0 1", Black, false},
		{"pedone nero attacca verso il basso", "7k/8/8/8/3p4/4K3/8/8 w - - 0 1", White, true},
		{"re adiacente", "8/8/8/3kK3/8/8/8/8 w - - 0 1", White, true},
		{"senza re", "8/8/8/8/8/8/8/7K b - - 0 1", Black, false},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if got := IsKingAttacked(tt.fen, tt.c); got != tt.want {
				t.Errorf("IsKingAttacked = %v, atteso %v", got, tt.want)
			}
		})
	}
}

func TestSideToMove(t *testing.T) {
	if SideToMove("8/8/8/8/8/8/8/8 b - - 0 1") != Black {
		t.Error("atteso nero")
	}
	if SideToMove("8/8/8/8/8/8/8/8 w - - 0 1") != White {
		t.Error("atteso bianco")
	}
}

func TestSquareAttacked(t *testing.T) {
	fen := "4k3/8/8/3p4/8/8/8/3R3K w - - 0 1" // torre bianca in d1, pedone nero in d5
	if !SquareAttacked(fen, "d5", White) {
		t.Error("la torre in d1 attacca d5")
	}
	if SquareAttacked(fen, "e5", White) {
		t.Error("e5 non è attaccata dal bianco")
	}
	if !SquareAttacked(fen, "e4", Black) {
		t.Error("il pedone nero in d5 attacca e4")
	}
	if SquareAttacked(fen, "z9", White) || SquareAttacked("rotta", "d5", White) {
		t.Error("casella o FEN non valide: false")
	}
}
