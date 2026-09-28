package spells

import (
	"sort"
	"strings"
	"unicode/utf8"
)

// Mazzi personali: regole pure (validazione, mazzo iniziale, espansione per la
// partita). La persistenza è in internal/db/decks.go.

const (
	MaxDecks    = 10 // mazzi per utente (D2)
	DeckNameMax = 24 // caratteri del nome, dopo il trim
)

// DeckCards sono le copie di ogni magia in un mazzo.
type DeckCards map[string]int

// Codici dei problemi di un mazzo (dettagli degli errori REST).
const (
	DeckUnknownSpell  = "unknown_spell"   // magia non nel catalogo
	DeckTooManyCopies = "too_many_copies" // oltre il massimo della rarità
	DeckNotOwned      = "not_owned"       // oltre le copie possedute
	DeckSizeWrong     = "deck_size"       // non 40 carte
)

// DeckProblem è un motivo per cui un mazzo non è valido.
type DeckProblem struct {
	Code    string `json:"code"`
	SpellID string `json:"spell_id,omitempty"`
}

// Size è il numero di carte del mazzo.
func (d DeckCards) Size() int {
	n := 0
	for _, c := range d {
		n += c
	}
	return n
}

// Normalized toglie le voci a zero o negative.
func (d DeckCards) Normalized() DeckCards {
	out := DeckCards{}
	for id, c := range d {
		if c > 0 {
			out[id] = c
		}
	}
	return out
}

// ValidateDeck elenca i problemi del mazzo, in ordine di id e poi la
// dimensione. Nessun problema = mazzo valido e giocabile (D1).
func ValidateDeck(cards DeckCards, owned map[string]int) []DeckProblem {
	ids := make([]string, 0, len(cards))
	for id := range cards {
		ids = append(ids, id)
	}
	sort.Strings(ids)
	var problems []DeckProblem
	for _, id := range ids {
		n := cards[id]
		if n <= 0 {
			continue
		}
		sp, ok := Catalog[id]
		switch {
		case !ok:
			problems = append(problems, DeckProblem{Code: DeckUnknownSpell, SpellID: id})
		case n > sp.Rarity.MaxCopies():
			problems = append(problems, DeckProblem{Code: DeckTooManyCopies, SpellID: id})
		case n > owned[id]:
			problems = append(problems, DeckProblem{Code: DeckNotOwned, SpellID: id})
		}
	}
	if cards.Size() != DeckSize {
		problems = append(problems, DeckProblem{Code: DeckSizeWrong})
	}
	return problems
}

// BlockingProblem restituisce il primo problema che impedisce anche di salvare
// il mazzo come bozza (tutti tranne la dimensione, D3), o nil.
func BlockingProblem(problems []DeckProblem) *DeckProblem {
	for i := range problems {
		if problems[i].Code != DeckSizeWrong {
			return &problems[i]
		}
	}
	return nil
}

// ValidDeckName restituisce il nome ripulito e se è ammesso (1–24 caratteri).
func ValidDeckName(name string) (string, bool) {
	trimmed := strings.TrimSpace(name)
	n := utf8.RuneCountInString(trimmed)
	return trimmed, n >= 1 && n <= DeckNameMax
}

// StarterDeck costruisce il mazzo iniziale (D4): la ricetta condivisa limitata
// alle copie possedute, poi completata fino a 40 con le carte possedute più
// economiche (a pari costo per id). Con meno di 40 copie possedute resta corto.
func StarterDeck(owned map[string]int) DeckCards {
	deck := DeckCards{}
	room := func(id string) int {
		sp, ok := Catalog[id]
		if !ok {
			return 0
		}
		limit := sp.Rarity.MaxCopies()
		if owned[id] < limit {
			limit = owned[id]
		}
		return limit - deck[id]
	}
	total := 0
	for _, entry := range deckRecipe {
		n := entry.Count
		if r := room(entry.ID); n > r {
			n = r
		}
		if n > 0 {
			deck[entry.ID] += n
			total += n
		}
	}
	for _, sp := range List() {
		for total < DeckSize && room(sp.ID) > 0 {
			deck[sp.ID]++
			total++
		}
	}
	return deck
}

// Expand trasforma il mazzo nella lista di carte (ordine per id) da mischiare
// in partita.
func Expand(cards DeckCards) []string {
	ids := make([]string, 0, len(cards))
	for id := range cards {
		ids = append(ids, id)
	}
	sort.Strings(ids)
	out := make([]string, 0, cards.Size())
	for _, id := range ids {
		for i := 0; i < cards[id]; i++ {
			out = append(out, id)
		}
	}
	return out
}
