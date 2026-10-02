package bot

import (
	"math/rand/v2"
	"slices"
	"testing"

	"chess-server/internal/effects"
	"chess-server/internal/engine"
	"chess-server/internal/phase"
	"chess-server/internal/spells"
)

// fakeEngine risponde sempre la stessa mossa e ricorda l'ultima ricerca.
type fakeEngine struct {
	reply string
	last  engine.Search
	calls int
}

func (f *fakeEngine) BestMoveWith(_ string, s engine.Search) string {
	f.last, f.calls = s, f.calls+1
	return f.reply
}

func newRng() *rand.Rand { return rand.New(rand.NewPCG(1, 2)) }

func TestParseLevel(t *testing.T) {
	for _, name := range []string{"base", "intermediate", "advanced"} {
		if l, ok := ParseLevel(name); !ok || string(l) != name {
			t.Errorf("ParseLevel(%q) = %q %v", name, l, ok)
		}
	}
	if _, ok := ParseLevel("grandmaster"); ok {
		t.Error("livello sconosciuto accettato")
	}
	if got := LevelNames(); !slices.Equal(got, []string{"base", "intermediate", "advanced"}) {
		t.Errorf("LevelNames = %v", got)
	}
}

func TestChooseMove_EngineChoosesAmongPlayable(t *testing.T) {
	eng := &fakeEngine{reply: "d2d4"}
	playable := []string{"e2e4", "d2d4"}
	if got := ChooseMove(Advanced, engine.StartingFEN, playable, nil, eng, newRng()); got != "d2d4" {
		t.Errorf("mossa = %q, attesa quella del motore", got)
	}
	if !slices.Equal(eng.last.Only, playable) {
		t.Errorf("searchmoves = %v, attese le mosse giocabili", eng.last.Only)
	}
	if eng.last.Skill != 20 {
		t.Errorf("Skill dell'avanzato = %d", eng.last.Skill)
	}
}

func TestChooseMove_Fallbacks(t *testing.T) {
	playable := []string{"e2e4", "d2d4"}
	// Il motore risponde una mossa fuori elenco: se ne gioca una giocabile.
	if got := ChooseMove(Advanced, engine.StartingFEN, playable, nil, &fakeEngine{reply: "a2a3"}, newRng()); !slices.Contains(playable, got) {
		t.Errorf("mossa = %q, attesa una giocabile", got)
	}
	// Senza motore: a caso, mosse speciali comprese.
	all := append([]string{"b1d2"}, playable...)
	if got := ChooseMove(Advanced, engine.StartingFEN, playable, []string{"b1d2"}, nil, newRng()); !slices.Contains(all, got) {
		t.Errorf("senza motore = %q", got)
	}
	// Solo mosse speciali, o una sola mossa: il motore non serve.
	eng := &fakeEngine{reply: "x"}
	if got := ChooseMove(Advanced, engine.StartingFEN, nil, []string{"c1e3"}, eng, newRng()); got != "c1e3" {
		t.Errorf("solo speciali = %q", got)
	}
	if got := ChooseMove(Advanced, engine.StartingFEN, []string{"e2e4"}, nil, eng, newRng()); got != "e2e4" {
		t.Errorf("una sola mossa = %q", got)
	}
	if eng.calls != 0 {
		t.Errorf("il motore non andava chiamato (%d chiamate)", eng.calls)
	}
	if got := ChooseMove(Advanced, engine.StartingFEN, nil, nil, eng, newRng()); got != "" {
		t.Errorf("nessuna mossa = %q", got)
	}
}

// Il base gioca a caso circa il 30% delle volte.
func TestChooseMove_BaseSometimesRandom(t *testing.T) {
	eng := &fakeEngine{reply: "e2e4"}
	rng := newRng()
	playable := []string{"e2e4", "a2a3", "b2b3", "c2c3", "d2d3", "f2f3", "g2g3", "h2h3"}
	const n = 2000
	for i := 0; i < n; i++ {
		ChooseMove(Base, engine.StartingFEN, playable, nil, eng, rng)
	}
	if share := float64(n-eng.calls) / n; share < 0.25 || share > 0.35 {
		t.Errorf("mosse a caso del base = %.2f, attese circa 0.30", share)
	}
	if eng.last.Skill != 0 || eng.last.Depth != 1 {
		t.Errorf("ricerca del base = %+v", eng.last)
	}
}

// Bianco: torre in a1 minacciata dall'alfiere in h8, pedone in e2 tranquillo.
// Nero: cavallo in d5, pedone in h7.
const spellFEN = "4k2b/7p/8/3n4/8/8/4P3/R3K3 w - - 0 1"

func view(hand []string, mana int) View {
	return View{
		FEN:     spellFEN,
		Color:   effects.White,
		Phase:   phase.PhaseMain1,
		Hand:    hand,
		Mana:    mana,
		Casts:   map[string]int{},
		Tracker: effects.NewTracker(spellFEN),
	}
}

func TestChooseSpell_ShieldsThreatenedPiece(t *testing.T) {
	for _, level := range []Level{Intermediate, Advanced} {
		cast, ok := ChooseSpell(level, view([]string{"shield"}, 5), nil, newRng())
		if !ok || cast.SpellID != "shield" || !slices.Equal(cast.Targets, []string{"a1"}) {
			t.Errorf("%s: cast = %+v %v, atteso lo scudo sulla torre minacciata", level, cast, ok)
		}
	}
	// Senza pezzi minacciati lo scudo non serve: né l'intermedio né l'avanzato lo lanciano.
	quiet := view([]string{"shield"}, 5)
	quiet.FEN = "4k3/7p/8/3n4/8/8/4P3/R3K3 w - - 0 1"
	quiet.Tracker = effects.NewTracker(quiet.FEN)
	for _, level := range []Level{Intermediate, Advanced} {
		if cast, ok := ChooseSpell(level, quiet, nil, newRng()); ok {
			t.Errorf("%s: scudo inutile lanciato: %+v", level, cast)
		}
	}
}

func TestChooseSpell_AdvancedWeighsTheCost(t *testing.T) {
	// Frantumare (4 mana) sul cavallo congelato: 3 pedoni valgono il costo.
	v := view([]string{"shatter"}, 4)
	if err := effects.FreezePiece(v.Tracker, "d5", effects.White, 1, "frost"); err != nil {
		t.Fatal(err)
	}
	if cast, ok := ChooseSpell(Advanced, v, nil, newRng()); !ok || !slices.Equal(cast.Targets, []string{"d5"}) {
		t.Errorf("frantumare sul cavallo = %+v %v", cast, ok)
	}
	// Sul solo pedone congelato no: 1 pedone non vale 4 mana. L'intermedio invece lo lancia.
	v = view([]string{"shatter"}, 4)
	if err := effects.FreezePiece(v.Tracker, "h7", effects.White, 1, "frost"); err != nil {
		t.Fatal(err)
	}
	if cast, ok := ChooseSpell(Advanced, v, nil, newRng()); ok {
		t.Errorf("l'avanzato non spreca 4 mana per un pedone: %+v", cast)
	}
	if _, ok := ChooseSpell(Intermediate, v, nil, newRng()); !ok {
		t.Error("l'intermedio distrugge il pedone congelato")
	}
}

func TestChooseSpell_RespectsRules(t *testing.T) {
	// Mana insufficiente, fase sbagliata, carta già rifiutata, limite per turno.
	if _, ok := ChooseSpell(Advanced, view([]string{"shield"}, 1), nil, newRng()); ok {
		t.Error("lanciata senza mana")
	}
	premove := view([]string{"divine_castling"}, 10)
	premove.Phase = phase.PhaseMain2
	if _, ok := ChooseSpell(Base, premove, nil, newRng()); ok {
		t.Error("magia di main1 lanciata in main2")
	}
	if _, ok := ChooseSpell(Advanced, view([]string{"shield"}, 5), map[string]bool{"shield": true}, newRng()); ok {
		t.Error("magia rifiutata ritentata")
	}
	limited := view([]string{"blood_pact"}, 5)
	limited.Casts["blood_pact"] = 1
	if _, ok := ChooseSpell(Intermediate, limited, nil, newRng()); ok {
		t.Error("oltre il limite per turno")
	}
}

func TestChooseSpell_ReviveChoosesBestFromGraveyard(t *testing.T) {
	v := view([]string{"resurrection"}, 10)
	if _, ok := ChooseSpell(Advanced, v, nil, newRng()); ok {
		t.Error("cimitero vuoto: niente resurrezione")
	}
	v.Graveyard = []spells.PieceKind{spells.Knight, spells.Rook}
	cast, ok := ChooseSpell(Advanced, v, nil, newRng())
	if !ok || cast.Choice.Piece != spells.Rook {
		t.Errorf("resurrezione = %+v %v, attesa la torre", cast, ok)
	}
}

// Il base lancia circa metà delle volte, sempre con bersagli validi.
func TestChooseSpell_BaseRandomButValid(t *testing.T) {
	rng := newRng()
	hand := []string{"frost", "shield", "ice_wall", "forced_march", "revelation"}
	const n = 400
	casts := 0
	for i := 0; i < n; i++ {
		v := view(hand, 3)
		cast, ok := ChooseSpell(Base, v, nil, rng)
		if !ok {
			continue
		}
		casts++
		def := spells.Catalog[cast.SpellID]
		if err := effects.ValidateTargets(v.FEN, v.Tracker, def.Targets, cast.Targets, v.Color); err != nil || len(cast.Targets) != len(def.Targets) {
			t.Fatalf("bersagli non validi per %s: %v (%v)", cast.SpellID, cast.Targets, err)
		}
	}
	if share := float64(casts) / n; share < 0.4 || share > 0.6 {
		t.Errorf("lanci del base = %.2f, attesi circa 0.5", share)
	}
}
