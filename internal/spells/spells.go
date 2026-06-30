// Package spells contiene il modello dati delle magie (carte), del mazzo e
// della mano di un giocatore, più il catalogo hardcoded del set MVP.
//
// È volutamente data-driven: ogni magia è un record che compone uno o più
// Effect; l'esecuzione vera degli effetti vive in internal/effects (step
// successivi). In Step 2 gli effetti sono "noop": le magie costano mana e
// finiscono nello scarto senza modificare la scacchiera.
package spells

import (
	"math/rand"

	"chess-server/internal/phase"
)

// Parametri del card game (MVP).
const (
	StartingHand = 4  // carte in mano iniziale
	DeckSize     = 40 // dimensione del mazzo
	InitialMana  = 1  // mana al turno 1
	MaxManaCap   = 10 // tetto massimo del mana
)

// TargetType descrive cosa bersaglia una magia.
type TargetType string

const (
	TargetNone       TargetType = "none"
	TargetSquare     TargetType = "square"
	TargetPiece      TargetType = "piece"
	TargetOwnPiece   TargetType = "own_piece"
	TargetEnemyPiece TargetType = "enemy_piece"
)

// TargetCount restituisce quanti bersagli si attende un TargetType.
func (t TargetType) TargetCount() int {
	if t == TargetNone {
		return 0
	}
	return 1
}

// Kind degli effetti (cresce ad ogni step della roadmap).
const (
	EffectNoop         = "noop"          // nessun effetto (placeholder)
	EffectDestroyPiece = "destroy_piece" // distrugge un pezzo nemico (Step 3)
	EffectFreezePiece  = "freeze_piece"  // congela un pezzo nemico (Step 4)
	EffectShieldPiece  = "shield_piece"  // protegge un pezzo proprio (Step 4)
)

// Effect è un effetto componibile di una magia.
type Effect struct {
	Kind   string                 `json:"kind"`
	Params map[string]interface{} `json:"params,omitempty"`
}

// Spell è la definizione data-driven di una carta.
type Spell struct {
	ID         string        `json:"id"`
	Name       string        `json:"name"`
	ManaCost   int           `json:"mana_cost"`
	Phases     []phase.Phase `json:"phases"` // fasi in cui è giocabile
	TargetType TargetType    `json:"target_type"`
	Effects    []Effect      `json:"effects"`
}

// noop è l'effetto placeholder.
func noop() []Effect { return []Effect{{Kind: EffectNoop}} }

// castableInMain elenca le fasi main (default per le magie del MVP).
var castableInMain = []phase.Phase{phase.PhaseMain1, phase.PhaseMain2}

// Catalog è la libreria delle magie indicizzata per ID. Set MVP: placeholder
// noop + magie con effetti reali (destroy/freeze/shield).
var Catalog = map[string]Spell{
	"spark":        {ID: "spark", Name: "Spark", ManaCost: 1, Phases: castableInMain, TargetType: TargetNone, Effects: noop()},
	"jolt":         {ID: "jolt", Name: "Jolt", ManaCost: 2, Phases: castableInMain, TargetType: TargetNone, Effects: noop()},
	"pulse":        {ID: "pulse", Name: "Pulse", ManaCost: 2, Phases: castableInMain, TargetType: TargetNone, Effects: noop()},
	"surge":        {ID: "surge", Name: "Surge", ManaCost: 3, Phases: castableInMain, TargetType: TargetNone, Effects: noop()},
	"nova":         {ID: "nova", Name: "Nova", ManaCost: 5, Phases: castableInMain, TargetType: TargetNone, Effects: noop()},
	"disintegrate": {ID: "disintegrate", Name: "Disintegrate", ManaCost: 4, Phases: castableInMain, TargetType: TargetEnemyPiece, Effects: []Effect{{Kind: EffectDestroyPiece}}},
	"frostbolt":    {ID: "frostbolt", Name: "Frost Bolt", ManaCost: 2, Phases: castableInMain, TargetType: TargetEnemyPiece, Effects: []Effect{{Kind: EffectFreezePiece, Params: map[string]interface{}{"turns": 2}}}},
	"aegis":        {ID: "aegis", Name: "Aegis", ManaCost: 3, Phases: castableInMain, TargetType: TargetOwnPiece, Effects: []Effect{{Kind: EffectShieldPiece, Params: map[string]interface{}{"turns": 2}}}},
}

// deckRecipe definisce quante copie di ogni carta compongono il mazzo MVP.
// In Fase 1 il mazzo è condiviso e identico per entrambi i giocatori; la
// struttura per-giocatore è comunque già separata, pronta per il deckbuilding
// di Fase 2. Totale = 40.
var deckRecipe = []struct {
	ID    string
	Count int
}{
	{"spark", 10},
	{"jolt", 7},
	{"pulse", 7},
	{"surge", 6},
	{"disintegrate", 4},
	{"frostbolt", 3},
	{"aegis", 2},
	{"nova", 1},
}

// BuildDeck costruisce un mazzo ordinato (non mischiato) dal deckRecipe.
func BuildDeck() []string {
	deck := make([]string, 0, DeckSize)
	for _, entry := range deckRecipe {
		for i := 0; i < entry.Count; i++ {
			deck = append(deck, entry.ID)
		}
	}
	return deck
}

// PlayerState è lo stato del card game per un singolo giocatore.
// Nel mazzo l'indice 0 è la cima (prossima carta da pescare).
type PlayerState struct {
	Hand    []string `json:"hand"`     // ID delle carte in mano
	Deck    []string `json:"deck"`     // ID delle carte nel mazzo (0 = cima)
	Discard []string `json:"discard"`  // ID delle carte scartate
	Mana    int      `json:"mana"`     // mana attuale
	MaxMana int      `json:"max_mana"` // mana massimo del turno
}

// NewPlayerState costruisce e mischia (in modo deterministico, via rng) il
// mazzo e pesca la mano iniziale di StartingHand carte.
func NewPlayerState(rng *rand.Rand) *PlayerState {
	deck := BuildDeck()
	rng.Shuffle(len(deck), func(i, j int) { deck[i], deck[j] = deck[j], deck[i] })

	ps := &PlayerState{
		Hand:    make([]string, 0, StartingHand),
		Deck:    deck,
		Discard: make([]string, 0),
		Mana:    InitialMana,
		MaxMana: InitialMana,
	}
	for i := 0; i < StartingHand && len(ps.Deck) > 0; i++ {
		ps.Hand = append(ps.Hand, ps.Deck[0])
		ps.Deck = ps.Deck[1:]
	}
	return ps
}

// HandIndex restituisce l'indice della prima copia di spellID in mano, o -1.
func (ps *PlayerState) HandIndex(spellID string) int {
	for i, id := range ps.Hand {
		if id == spellID {
			return i
		}
	}
	return -1
}
