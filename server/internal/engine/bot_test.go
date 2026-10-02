package engine

import (
	"os/exec"
	"testing"
	"time"

	"chess-server/internal/logger"
)

func TestSearchCommand(t *testing.T) {
	cases := []struct {
		search Search
		want   string
	}{
		{Search{Depth: 6}, "go depth 6"},
		{Search{MoveTime: 600 * time.Millisecond}, "go movetime 600"},
		{Search{Depth: 12, MoveTime: 600 * time.Millisecond}, "go depth 12 movetime 600"},
		{Search{}, "go depth 10"},
		{Search{Depth: 1, Only: []string{"e2e4", "d2d4"}}, "go depth 1 searchmoves e2e4 d2d4"},
	}
	for _, c := range cases {
		if got := searchCommand(c.search); got != c.want {
			t.Errorf("searchCommand(%+v) = %q, atteso %q", c.search, got, c.want)
		}
	}
}

func TestSkillLevelClamped(t *testing.T) {
	for in, want := range map[int]int{-3: 0, 0: 0, 8: 8, 20: 20, 25: 20} {
		if got := skillLevel(in); got != want {
			t.Errorf("skillLevel(%d) = %d, atteso %d", in, got, want)
		}
	}
}

func TestParseBestMove(t *testing.T) {
	if got := parseBestMove([]string{"info depth 1", "bestmove e2e4 ponder e7e5"}); got != "e2e4" {
		t.Errorf("mossa = %q, attesa e2e4", got)
	}
	if got := parseBestMove([]string{"bestmove (none)"}); got != "" {
		t.Errorf("senza mosse = %q, atteso vuoto", got)
	}
	if got := parseBestMove(nil); got != "" {
		t.Errorf("senza risposta = %q, atteso vuoto", got)
	}
}

// Con searchmoves il motore sceglie solo fra le mosse indicate, anche quando
// ce n'è una migliore (qui la cattura della donna): così il bot non gioca mai
// una mossa vietata dalle magie. Gira solo dove Stockfish è installato.
func TestBestMoveWith_OnlyAmongAllowed(t *testing.T) {
	if _, err := exec.LookPath("stockfish"); err != nil {
		t.Skip("Stockfish non installato")
	}
	if logger.L == nil {
		_ = logger.Init("test")
	}
	e := &Engine{}
	if err := initEngine(e); err != nil {
		t.Skipf("Stockfish non avviabile: %v", err)
	}
	defer e.Shutdown()

	// La torre bianca in d1 cattura la donna nera in d8.
	fen := "3q3k/8/8/8/8/8/PP6/3R3K w - - 0 1"
	if got := e.BestMoveWith(fen, Search{Skill: 20, Depth: 6}); got != "d1d8" {
		t.Errorf("senza limiti = %q, attesa la cattura d1d8", got)
	}
	only := []string{"a2a3", "b2b3"}
	got := e.BestMoveWith(fen, Search{Skill: 20, Depth: 6, Only: only})
	if got != "a2a3" && got != "b2b3" {
		t.Errorf("con searchmoves = %q, attesa una fra %v", got, only)
	}
}
