package spells

// La collezione di un utente: quante copie possiede di ogni magia del catalogo.
// Qui c'è solo la parte pura (set iniziale e vista per il client); la
// persistenza è in internal/db/collection.go.

// CollectionEntry è una voce di GET /me/collection.
type CollectionEntry struct {
	SpellID   string `json:"spell_id"`
	Copies    int    `json:"copies"`
	MaxCopies int    `json:"max_copies"`
}

// CollectionView è la risposta di GET /me/collection: una voce per ogni magia
// del catalogo, più le copie possedute su quelle possibili.
type CollectionView struct {
	Cards []CollectionEntry `json:"cards"`
	Owned int               `json:"owned"`
	Total int               `json:"total"`
}

// StarterCopies è il numero di copie di una magia nel set iniziale: le comuni
// al massimo, le rare a 1, le leggendarie a 0 (C4, da rivedere nel
// bilanciamento).
func StarterCopies(s Spell) int {
	switch s.Rarity {
	case Common:
		return s.Rarity.MaxCopies()
	case Rare:
		return 1
	default:
		return 0
	}
}

// StarterSet restituisce il set iniziale, solo le magie con almeno una copia.
func StarterSet() map[string]int {
	out := map[string]int{}
	for id, s := range Catalog {
		if n := StarterCopies(s); n > 0 {
			out[id] = n
		}
	}
	return out
}

// Collection costruisce la vista della collezione dalle copie possedute: ogni
// magia del catalogo nell'ordine di List(), con le copie limitate fra 0 e il
// massimo della rarità. Le magie non più nel catalogo si ignorano; una magia
// senza voce vale 0 copie (C6).
func Collection(owned map[string]int) CollectionView {
	list := List()
	view := CollectionView{Cards: make([]CollectionEntry, 0, len(list))}
	for _, s := range list {
		maxCopies := s.Rarity.MaxCopies()
		copies := owned[s.ID]
		if copies < 0 {
			copies = 0
		}
		if copies > maxCopies {
			copies = maxCopies
		}
		view.Cards = append(view.Cards, CollectionEntry{SpellID: s.ID, Copies: copies, MaxCopies: maxCopies})
		view.Owned += copies
		view.Total += maxCopies
	}
	return view
}
