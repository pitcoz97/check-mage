package spells

import (
	"encoding/json"
	"math/rand"
	"testing"
)

func TestBuildDeck_Size(t *testing.T) {
	deck := BuildDeck()
	if len(deck) != DeckSize {
		t.Errorf("dimensione mazzo = %d, attesa %d", len(deck), DeckSize)
	}
	// Tutte le carte devono esistere nel catalogo.
	for _, id := range deck {
		if _, ok := Catalog[id]; !ok {
			t.Errorf("carta %s non presente nel catalogo", id)
		}
	}
}

func TestCatalog_CostsInRange(t *testing.T) {
	for id, sp := range Catalog {
		if sp.ManaCost < 0 || sp.ManaCost > 8 {
			t.Errorf("%s ha costo %d fuori range 0-8", id, sp.ManaCost)
		}
		if sp.ID != id {
			t.Errorf("chiave catalogo %s != Spell.ID %s", id, sp.ID)
		}
		if len(sp.Effects) == 0 {
			t.Errorf("%s non ha effetti", id)
		}
	}
}

func TestNewPlayerState(t *testing.T) {
	rng := rand.New(rand.NewSource(7))
	ps := NewPlayerState(rng)

	if len(ps.Hand) != StartingHand {
		t.Errorf("mano = %d, attesa %d", len(ps.Hand), StartingHand)
	}
	if len(ps.Deck) != DeckSize-StartingHand {
		t.Errorf("mazzo = %d, atteso %d", len(ps.Deck), DeckSize-StartingHand)
	}
	if len(ps.Discard) != 0 {
		t.Errorf("scarto iniziale = %d, atteso 0", len(ps.Discard))
	}
	if ps.Mana != InitialMana || ps.MaxMana != InitialMana {
		t.Errorf("mana iniziale = %d/%d, atteso %d/%d", ps.Mana, ps.MaxMana, InitialMana, InitialMana)
	}
}

func TestNewPlayerState_Deterministic(t *testing.T) {
	a := NewPlayerState(rand.New(rand.NewSource(99)))
	b := NewPlayerState(rand.New(rand.NewSource(99)))
	for i := range a.Deck {
		if a.Deck[i] != b.Deck[i] {
			t.Fatalf("mazzi divergono all'indice %d con lo stesso seed", i)
		}
	}
}

func TestHandIndex(t *testing.T) {
	ps := &PlayerState{Hand: []string{"frost", "shield", "frost"}}
	if got := ps.HandIndex("shield"); got != 1 {
		t.Errorf("HandIndex(shield) = %d, atteso 1", got)
	}
	if got := ps.HandIndex("frost"); got != 0 {
		t.Errorf("HandIndex(frost) = %d, atteso 0 (prima copia)", got)
	}
	if got := ps.HandIndex("blink"); got != -1 {
		t.Errorf("HandIndex(blink) = %d, atteso -1", got)
	}
}

func TestList_SortedAndComplete(t *testing.T) {
	list := List()
	if len(list) != len(Catalog) {
		t.Fatalf("List() = %d magie, attese %d", len(list), len(Catalog))
	}
	for i := 1; i < len(list); i++ {
		a, b := list[i-1], list[i]
		if a.ManaCost > b.ManaCost || (a.ManaCost == b.ManaCost && a.ID > b.ID) {
			t.Errorf("ordine errato: %s (%d) prima di %s (%d)", a.ID, a.ManaCost, b.ID, b.ManaCost)
		}
	}
}

// Ogni voce del catalogo usa valori noti: rarità, tag, tipi di bersaglio,
// pezzi, fasi main e kind di effetto implementati.
func TestCatalog_WellFormed(t *testing.T) {
	tags := map[string]bool{"gelo": true, "necro": true, "arcano": true, "sacro": true, "rune": true, "falange": true}
	kinds := map[string]bool{
		EffectDestroyPiece: true, EffectFreezePiece: true, EffectShieldPiece: true, EffectDrawCard: true,
		EffectGainMana: true, EffectMovePiece: true, EffectSummonPawn: true,
		EffectFreezeAll: true, EffectShieldArea: true, EffectSwapPieces: true, EffectTransformPiece: true,
		EffectPromotePiece: true, EffectRevivePiece: true, EffectRestoreCastling: true,
		EffectCreateWall: true, EffectCreateSquareEffect: true,
	}
	targetTypes := map[TargetType]bool{TargetSquare: true, TargetOwnPiece: true, TargetEnemyPiece: true}
	pieces := map[PieceKind]bool{Pawn: true, Knight: true, Bishop: true, Rook: true, Queen: true}

	for id, sp := range Catalog {
		if sp.Rarity != Common && sp.Rarity != Legendary {
			t.Errorf("%s: rarità %q sconosciuta", id, sp.Rarity)
		}
		if len(sp.Tags) == 0 {
			t.Errorf("%s: nessun archetipo", id)
		}
		for _, tag := range sp.Tags {
			if !tags[tag] {
				t.Errorf("%s: archetipo %q sconosciuto", id, tag)
			}
		}
		if len(sp.Phases) == 0 {
			t.Errorf("%s: nessuna fase", id)
		}
		for _, spec := range sp.Targets {
			if !targetTypes[spec.Type] {
				t.Errorf("%s: tipo di bersaglio %q sconosciuto", id, spec.Type)
			}
			for _, p := range spec.Pieces {
				if !pieces[p] {
					t.Errorf("%s: pezzo %q non ammesso come bersaglio", id, p)
				}
			}
		}
		for _, e := range sp.Effects {
			if !kinds[e.Kind] {
				t.Errorf("%s: effetto %q non implementato", id, e.Kind)
			}
		}
		for key := range sp.Limits {
			if key != LimitPerTurn {
				t.Errorf("%s: limite %q sconosciuto", id, key)
			}
		}
	}
}

// Il mazzo è di 40 carte, contiene solo magie del catalogo e le leggendarie
// sono già a una copia.
func TestDeckRecipe(t *testing.T) {
	total := 0
	for _, entry := range deckRecipe {
		sp, ok := Catalog[entry.ID]
		if !ok {
			t.Errorf("ricetta: %s non è nel catalogo", entry.ID)
		}
		if sp.Rarity == Legendary && entry.Count > Legendary.MaxCopies() {
			t.Errorf("ricetta: %s è leggendaria ma ha %d copie", entry.ID, entry.Count)
		}
		if entry.Count <= 0 {
			t.Errorf("ricetta: %s ha %d copie", entry.ID, entry.Count)
		}
		total += entry.Count
	}
	if total != DeckSize {
		t.Errorf("ricetta = %d carte, attese %d", total, DeckSize)
	}
}

func TestRarity_MaxCopies(t *testing.T) {
	if Common.MaxCopies() != 2 || Legendary.MaxCopies() != 1 {
		t.Errorf("copie massime: common %d, legendary %d", Common.MaxCopies(), Legendary.MaxCopies())
	}
}

// In JSON bersagli e tag sono sempre liste, mai null.
func TestCatalog_JSONShape(t *testing.T) {
	data, err := json.Marshal(List())
	if err != nil {
		t.Fatalf("marshal fallito: %v", err)
	}
	var raw []map[string]interface{}
	if err := json.Unmarshal(data, &raw); err != nil {
		t.Fatalf("unmarshal fallito: %v", err)
	}
	for _, s := range raw {
		for _, key := range []string{"id", "name", "mana_cost", "phases", "targets", "effects", "tags", "rarity"} {
			if _, ok := s[key]; !ok {
				t.Errorf("%v: campo %s assente", s["id"], key)
			}
		}
		if _, ok := s["targets"].([]interface{}); !ok {
			t.Errorf("%v: targets non è una lista", s["id"])
		}
		if _, ok := s["target_type"]; ok {
			t.Errorf("%v: target_type non deve più esistere", s["id"])
		}
	}
}

func TestDropUnknownCards(t *testing.T) {
	ps := &PlayerState{
		Hand:    []string{"frost", "spark", "aegis"},
		Deck:    []string{"nova", "shield"},
		Discard: []string{"frostbolt"},
	}
	if removed := ps.DropUnknownCards(); removed != 4 {
		t.Errorf("carte tolte = %d, attese 4", removed)
	}
	if len(ps.Hand) != 1 || ps.Hand[0] != "frost" {
		t.Errorf("mano = %v, attesa [frost]", ps.Hand)
	}
	if len(ps.Deck) != 1 || ps.Deck[0] != "shield" {
		t.Errorf("mazzo = %v, atteso [shield]", ps.Deck)
	}
	if len(ps.Discard) != 0 {
		t.Errorf("scarti = %v, attesi vuoti", ps.Discard)
	}
}

func TestGraveyard(t *testing.T) {
	ps := &PlayerState{Graveyard: []GraveEntry{{Piece: Pawn, PieceID: 9}, {Piece: Knight, PieceID: 2}}}
	kinds := ps.GraveyardKinds()
	if len(kinds) != 2 || kinds[0] != Pawn || kinds[1] != Knight {
		t.Errorf("tipi del cimitero = %v", kinds)
	}
	if !ps.InGraveyard(Knight) || ps.InGraveyard(Rook) {
		t.Error("InGraveyard errato")
	}
	c := ps.CopyGraveyard()
	c[0].Piece = Queen
	if ps.Graveyard[0].Piece != Pawn {
		t.Error("la copia del cimitero deve essere indipendente")
	}
}
