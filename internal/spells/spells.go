// Package spells contiene il modello dati delle magie (carte), del mazzo e
// della mano di un giocatore. Il catalogo sta in catalog.go.
//
// È volutamente data-driven: ogni magia è un record che dichiara i bersagli
// (TargetSpec) e compone uno o più Effect; l'esecuzione degli effetti vive in
// internal/effects e internal/game. Nessuna logica dipende dall'ID della magia.
package spells

import (
	"math/rand"
	"sort"

	"chess-server/internal/phase"
)

// Parametri del card game.
const (
	StartingHand = 4  // carte in mano iniziale
	DeckSize     = 40 // dimensione del mazzo
	InitialMana  = 1  // mana al turno 1
	MaxManaCap   = 10 // tetto massimo del mana
)

// TargetType descrive cosa bersaglia un elemento di Spell.Targets.
type TargetType string

const (
	TargetSquare     TargetType = "square"      // una casa (vuota o no, secondo EmptySquare)
	TargetOwnPiece   TargetType = "own_piece"   // un pezzo del lanciatore
	TargetEnemyPiece TargetType = "enemy_piece" // un pezzo dell'avversario
)

// PieceKind è il tipo di un pezzo, come nome inglese minuscolo.
type PieceKind string

const (
	Pawn   PieceKind = "pawn"
	Knight PieceKind = "knight"
	Bishop PieceKind = "bishop"
	Rook   PieceKind = "rook"
	Queen  PieceKind = "queen"
	King   PieceKind = "king"
)

// TargetSpec descrive un bersaglio di una magia e i filtri che deve rispettare.
// I bersagli di un cast arrivano nello stesso ordine di Spell.Targets.
type TargetSpec struct {
	Type TargetType `json:"type"`
	// Pezzi ammessi; vuoto = tutti tranne il re. Il re non è mai un bersaglio
	// valido per un pezzo nemico, qualunque cosa dica la lista.
	Pieces []PieceKind `json:"pieces,omitempty"`
	// Stato che il pezzo bersaglio deve avere (es. "freeze").
	RequireEffect string `json:"require_effect,omitempty"`
	// Per TargetSquare: la casa deve essere vuota.
	EmptySquare bool `json:"empty_square,omitempty"`
	// Distanza massima (Chebyshev) dal bersaglio precedente; 0 = nessun limite.
	MaxDistance int `json:"max_distance,omitempty"`
	// Traverse ammesse, relative al lanciatore (1 = la sua prima traversa).
	OwnRanks []int `json:"own_ranks,omitempty"`
	// Traversa minima, relativa al lanciatore; 0 = nessun limite.
	MinRank int `json:"min_rank,omitempty"`
}

// Rarity è la rarità di una carta: decide quante copie ne può contenere un mazzo.
type Rarity string

const (
	Common    Rarity = "common"    // massimo 2 copie
	Legendary Rarity = "legendary" // massimo 1 copia
)

// MaxCopies restituisce il numero massimo di copie ammesse in un mazzo.
func (r Rarity) MaxCopies() int {
	if r == Legendary {
		return 1
	}
	return 2
}

// Chiavi di Spell.Limits.
const (
	LimitPerTurn = "per_turn" // cast massimi per turno del lanciatore
)

// Kind degli effetti.
const (
	EffectDestroyPiece = "destroy_piece" // rimuove il pezzo bersaglio
	EffectFreezePiece  = "freeze_piece"  // congela un pezzo
	EffectShieldPiece  = "shield_piece"  // protegge un pezzo
	EffectDrawCard     = "draw_card"     // pesca carte
	EffectGainMana     = "gain_mana"     // mana extra questo turno
	EffectMovePiece    = "move_piece"    // sposta un pezzo proprio su una casa vuota
	EffectSummonPawn   = "summon_pawn"   // crea un pedone del lanciatore
)

// Effect è un effetto componibile di una magia.
type Effect struct {
	Kind   string                 `json:"kind"`
	Params map[string]interface{} `json:"params,omitempty"`
}

// Spell è la definizione data-driven di una carta.
type Spell struct {
	ID       string         `json:"id"`
	Name     string         `json:"name"`
	ManaCost int            `json:"mana_cost"`
	Phases   []phase.Phase  `json:"phases"`  // fasi in cui è giocabile
	Targets  []TargetSpec   `json:"targets"` // bersagli, in ordine; vuoto = nessun bersaglio
	Effects  []Effect       `json:"effects"`
	Tags     []string       `json:"tags"` // archetipi: gelo, necro, arcano, sacro, rune, falange
	Rarity   Rarity         `json:"rarity"`
	Limits   map[string]int `json:"limits,omitempty"` // es. {"per_turn": 1}
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
	// Cast di ogni magia nel turno corrente del giocatore (per Spell.Limits).
	// Si azzera all'inizio di ogni suo turno.
	CastsThisTurn map[string]int `json:"casts_this_turn,omitempty"`
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

// DropUnknownCards toglie da mano, mazzo e scarti le carte che il catalogo non
// contiene più e restituisce quante ne ha tolte. Serve a ripristinare le partite
// salvate con un catalogo precedente.
func (ps *PlayerState) DropUnknownCards() int {
	removed := 0
	keep := func(ids []string) []string {
		out := make([]string, 0, len(ids))
		for _, id := range ids {
			if _, ok := Catalog[id]; ok {
				out = append(out, id)
			} else {
				removed++
			}
		}
		return out
	}
	ps.Hand = keep(ps.Hand)
	ps.Deck = keep(ps.Deck)
	ps.Discard = keep(ps.Discard)
	return removed
}

// List restituisce il catalogo come lista ordinata per costo e poi per id
// (ordine stabile per GET /spells).
func List() []Spell {
	out := make([]Spell, 0, len(Catalog))
	for _, s := range Catalog {
		out = append(out, s)
	}
	sort.Slice(out, func(i, j int) bool {
		if out[i].ManaCost != out[j].ManaCost {
			return out[i].ManaCost < out[j].ManaCost
		}
		return out[i].ID < out[j].ID
	})
	return out
}
