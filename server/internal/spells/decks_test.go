package spells

import (
	"math/rand"
	"reflect"
	"testing"
)

func codes(problems []DeckProblem) []string {
	out := make([]string, 0, len(problems))
	for _, p := range problems {
		out = append(out, p.Code+":"+p.SpellID)
	}
	return out
}

func TestValidateDeck(t *testing.T) {
	owned := StarterSet()
	starter := StarterDeck(owned)
	if p := ValidateDeck(starter, owned); len(p) != 0 {
		t.Fatalf("mazzo iniziale non valido: %v", codes(p))
	}

	bad := DeckCards{"frost": 3, "haste": 1, "nope": 1, "shatter": 2}
	got := codes(ValidateDeck(bad, owned))
	want := []string{"too_many_copies:frost", "not_owned:haste", "unknown_spell:nope", "not_owned:shatter", "deck_size:"}
	if !reflect.DeepEqual(got, want) {
		t.Errorf("problemi = %v, attesi %v", got, want)
	}
	if b := BlockingProblem(ValidateDeck(DeckCards{"frost": 2}, owned)); b != nil {
		t.Errorf("una bozza corta non deve bloccare il salvataggio: %+v", b)
	}
	if b := BlockingProblem(ValidateDeck(bad, owned)); b == nil || b.SpellID != "frost" {
		t.Errorf("problema bloccante = %+v", b)
	}
}

// Mazzo iniziale (D4): 40 carte, entro possesso e rarità, deterministico.
func TestStarterDeck(t *testing.T) {
	owned := StarterSet()
	a, b := StarterDeck(owned), StarterDeck(owned)
	if a.Size() != DeckSize {
		t.Fatalf("mazzo iniziale = %d carte", a.Size())
	}
	if !reflect.DeepEqual(a, b) {
		t.Error("il mazzo iniziale deve essere deterministico")
	}
	for id, n := range a {
		if n > owned[id] {
			t.Errorf("%s: %d copie, possedute %d", id, n, owned[id])
		}
	}
	// Con poche carte possedute resta corto.
	if short := StarterDeck(map[string]int{"frost": 2, "shield": 2}); short.Size() != 4 {
		t.Errorf("mazzo corto = %d carte, attese 4", short.Size())
	}
}

func TestExpandAndName(t *testing.T) {
	if got := Expand(DeckCards{"shield": 1, "frost": 2}); !reflect.DeepEqual(got, []string{"frost", "frost", "shield"}) {
		t.Errorf("Expand = %v", got)
	}
	if name, ok := ValidDeckName("  Rune d'Oro  "); !ok || name != "Rune d'Oro" {
		t.Errorf("nome = %q %v", name, ok)
	}
	for _, name := range []string{"", "   ", "123456789012345678901234x"} {
		if _, ok := ValidDeckName(name); ok {
			t.Errorf("nome %q accettato", name)
		}
	}
}

func TestNewPlayerStateWithDeck(t *testing.T) {
	deck := Expand(StarterDeck(StarterSet()))
	ps := NewPlayerStateWithDeck(rand.New(rand.NewSource(1)), deck)
	if len(ps.Hand) != StartingHand || len(ps.Deck) != DeckSize-StartingHand {
		t.Errorf("mano %d, mazzo %d", len(ps.Hand), len(ps.Deck))
	}
	if len(deck) != DeckSize {
		t.Error("il mazzo passato non deve essere modificato")
	}
}
