package spells

import (
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
	ps := &PlayerState{Hand: []string{"spark", "jolt", "spark"}}
	if got := ps.HandIndex("jolt"); got != 1 {
		t.Errorf("HandIndex(jolt) = %d, atteso 1", got)
	}
	if got := ps.HandIndex("spark"); got != 0 {
		t.Errorf("HandIndex(spark) = %d, atteso 0 (prima copia)", got)
	}
	if got := ps.HandIndex("nova"); got != -1 {
		t.Errorf("HandIndex(nova) = %d, atteso -1", got)
	}
}
