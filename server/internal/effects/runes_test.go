package effects

import (
	"encoding/json"
	"testing"
)

var stasis = RuneSpec{OnEnter: RuneFreeze, Duration: 2}

// Una runa per proprietario per casa: la seconda dello stesso giocatore
// sostituisce la prima, quella dell'avversario convive.
func TestAddRune_OnePerOwner(t *testing.T) {
	tr := NewTracker(startFEN)
	tr.AddRune("e5", White, stasis, "stasis_rune")
	tr.AddRune("e5", White, RuneSpec{OnEnter: RuneReturn}, "repel_rune")
	tr.AddRune("e5", Black, stasis, "stasis_rune")
	if n := len(tr.SquareEffects()[0].Effects); n != 2 {
		t.Fatalf("due rune (una per giocatore), trovate %d", n)
	}
	if r, ok := tr.RuneAt("e5", White); !ok || r.Rune.OnEnter != RuneReturn || !r.Hidden || r.RemainingTurns != Permanent {
		t.Errorf("runa bianca: %+v", r)
	}
	if got := tr.RunesOf(Black); len(got) != 1 || got[0] != "e5" {
		t.Errorf("rune nere: %v", got)
	}
	tr.RemoveRune("e5", White)
	if _, ok := tr.RuneAt("e5", White); ok {
		t.Error("la runa bianca va tolta")
	}
	if _, ok := tr.RuneAt("e5", Black); !ok {
		t.Error("la runa nera resta")
	}
	tr.RemoveRune("e5", Black)
	if len(tr.SquareEffects()) != 0 {
		t.Error("la casa senza stati sparisce")
	}
}

// L'avversario non vede le rune nascoste; dopo la rivelazione sì, per sempre, ma
// non quelle piazzate dopo. Le rune non scadono.
func TestRunes_HiddenAndRevealed(t *testing.T) {
	tr := NewTracker(startFEN)
	tr.AddSquareEffect("d4", KindWall, 2, "ice_wall", Black)
	tr.AddRune("d4", White, stasis, "stasis_rune")
	tr.AddRune("e5", White, stasis, "stasis_rune")
	if got := tr.SquareEffectsFor(Black); len(got) != 1 || len(got[0].Effects) != 1 || got[0].Effects[0].Kind != KindWall {
		t.Fatalf("il nero vede solo il muro: %+v", got)
	}
	if got := tr.SquareEffectsFor(White); len(got) != 2 {
		t.Fatalf("il bianco vede le sue rune: %+v", got)
	}
	if n := tr.RevealRunes(White); n != 2 {
		t.Errorf("rivelate %d, attese 2", n)
	}
	tr.AddRune("c6", White, stasis, "stasis_rune")
	if got := tr.SquareEffectsFor(Black); len(got) != 2 {
		t.Errorf("il nero vede le due rune rivelate, non la nuova: %+v", got)
	}
	for i := 0; i < 5; i++ {
		tr.TickSquares(Black)
		tr.TickSquares(White)
	}
	if len(tr.RunesOf(White)) != 3 {
		t.Error("le rune non scadono")
	}
}

// Clone e ripristino conservano stato nascosto e spec; la rivelazione sulla
// copia non tocca l'originale.
func TestRunes_CloneAndRestore(t *testing.T) {
	tr := NewTracker(startFEN)
	tr.AddRune("e5", White, RuneSpec{OnEnter: RuneDestroy, Only: []string{"pawn"}, Fallback: RuneFreeze, FallbackDuration: 1}, "explosive_rune")
	c := tr.Clone()
	c.RevealRunes(White)
	if r, _ := tr.RuneAt("e5", White); !r.Hidden {
		t.Error("la rivelazione sulla copia non tocca l'originale")
	}

	data, err := json.Marshal(tr.SquareEffects())
	if err != nil {
		t.Fatal(err)
	}
	var saved []SquareEffectInfo
	if err := json.Unmarshal(data, &saved); err != nil {
		t.Fatal(err)
	}
	restored := NewTracker(startFEN)
	for _, s := range saved {
		restored.RestoreSquareEffects(s.Square, s.Effects)
	}
	r, ok := restored.RuneAt("e5", White)
	if !ok || !r.Hidden || r.Rune.Fallback != RuneFreeze || r.Rune.Only[0] != "pawn" {
		t.Errorf("runa ripristinata: %+v %+v", r, r.Rune)
	}
}

func TestRuneEntry(t *testing.T) {
	const fen = "r3k2r/pppp1ppp/8/3Pp3/8/8/8/R3K2R w KQkq e6 0 1"
	cases := []struct {
		move, square, origin string
		piece                byte
		ok                   bool
	}{
		{"a1a4", "a4", "a1", 'R', true},
		{"d5e6", "e6", "d5", 'P', true}, // en passant
		{"e1g1", "f1", "h1", 'R', true}, // arrocco: entra la torre
		{"e1c1", "d1", "a1", 'R', true},
		{"e1e2", "", "", 0, false}, // il re non fa scattare le rune
	}
	for _, c := range cases {
		sq, origin, p, ok := RuneEntry(fen, c.move)
		if sq != c.square || origin != c.origin || p != c.piece || ok != c.ok {
			t.Errorf("%s: (%s, %s, %c, %v)", c.move, sq, origin, p, ok)
		}
	}
}

func TestReturnPiece(t *testing.T) {
	// Il pedone promosso in e8 torna pedone in e7.
	fen, err := ReturnPiece("4Q2k/8/8/8/8/8/8/4K3 b - - 0 1", "e8", "e7", 'P')
	if err != nil || fen != "7k/4P3/8/8/8/8/8/4K3 b - - 0 1" {
		t.Errorf("promozione annullata: %s %v", fen, err)
	}
	// La spinta doppia annullata toglie la casella en passant.
	fen, err = ReturnPiece("4k3/8/8/8/4P3/8/8/4K3 b - e3 0 1", "e4", "e2", 'P')
	if err != nil || fen != "4k3/8/8/8/8/8/4P3/4K3 b - - 0 1" {
		t.Errorf("spinta doppia annullata: %s %v", fen, err)
	}
	if _, err := ReturnPiece("4k3/8/8/8/4P3/8/4P3/4K3 b - - 0 1", "e4", "e2", 'P'); err == nil {
		t.Error("la casa di partenza occupata è un errore")
	}
}

func TestRuneSpec_Strike(t *testing.T) {
	explosive := RuneSpec{OnEnter: RuneDestroy, Only: []string{"pawn", "knight", "bishop"}, Fallback: RuneFreeze, FallbackDuration: 1}
	if kind, _ := explosive.Strike('n'); kind != RuneDestroy {
		t.Errorf("cavallo: %s", kind)
	}
	if kind, d := explosive.Strike('Q'); kind != RuneFreeze || d != 1 {
		t.Errorf("regina: %s %d", kind, d)
	}
	if kind, d := stasis.Strike('R'); kind != RuneFreeze || d != 2 {
		t.Errorf("stasi sulla torre: %s %d", kind, d)
	}
}

func TestAroundSquares(t *testing.T) {
	if got := AroundSquares("a1", 1); len(got) != 3 {
		t.Errorf("a1: %v", got)
	}
	if got := AroundSquares("e4", 1); len(got) != 8 {
		t.Errorf("e4: %v", got)
	}
}
