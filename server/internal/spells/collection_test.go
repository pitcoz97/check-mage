package spells

import "testing"

// Set iniziale (C4): comuni al massimo, rare a 1, leggendarie a 0; 45 copie su 59.
func TestStarterSet(t *testing.T) {
	starter := StarterSet()
	for id, s := range Catalog {
		want := map[Rarity]int{Common: 2, Rare: 1, Legendary: 0}[s.Rarity]
		if got := starter[id]; got != want {
			t.Errorf("%s (%s): %d copie nel set iniziale, attese %d", id, s.Rarity, got, want)
		}
	}
	view := Collection(starter)
	if view.Owned != 45 || view.Total != 59 {
		t.Errorf("set iniziale = %d / %d, atteso 45 / 59", view.Owned, view.Total)
	}
}

func TestCollection_Clamp(t *testing.T) {
	view := Collection(map[string]int{"frost": 5, "haste": -1, "gone_spell": 2})
	if len(view.Cards) != len(Catalog) {
		t.Fatalf("voci = %d, attese %d", len(view.Cards), len(Catalog))
	}
	byID := map[string]CollectionEntry{}
	for _, e := range view.Cards {
		byID[e.SpellID] = e
	}
	if e := byID["frost"]; e.Copies != 2 || e.MaxCopies != 2 {
		t.Errorf("frost = %+v, atteso 2/2", e)
	}
	if e := byID["haste"]; e.Copies != 0 || e.MaxCopies != 1 {
		t.Errorf("haste = %+v, atteso 0/1", e)
	}
	if _, ok := byID["gone_spell"]; ok {
		t.Error("una magia fuori dal catalogo non deve comparire")
	}
	if e := byID["shatter"]; e.Copies != 0 || e.MaxCopies != 2 {
		t.Errorf("shatter (senza voce) = %+v, atteso 0/2", e)
	}
	if view.Owned != 2 || view.Total != 59 {
		t.Errorf("totale = %d / %d, atteso 2 / 59", view.Owned, view.Total)
	}
	// Stesso ordine di GET /spells.
	for i, s := range List() {
		if view.Cards[i].SpellID != s.ID {
			t.Fatalf("voce %d = %s, attesa %s", i, view.Cards[i].SpellID, s.ID)
		}
	}
}
