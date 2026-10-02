package bot

import (
	"math/rand/v2"
	"slices"

	"chess-server/internal/effects"
	"chess-server/internal/phase"
	"chess-server/internal/spells"
)

// View è lo stato della partita visto dal bot, nella sua fase main.
type View struct {
	FEN       string
	Color     effects.Color      // il lato del bot
	Phase     phase.Phase        // main1 o main2
	Hand      []string           // le carte in mano
	Mana      int                // il mana disponibile
	Casts     map[string]int     // magie già lanciate in questo turno (Spell.Limits)
	Graveyard []spells.PieceKind // i propri pezzi persi
	Tracker   *effects.Tracker   // stati di pezzi e case: una copia, il bot non la modifica
}

// Cast è una magia da lanciare: gli stessi campi di cast_spell.
type Cast struct {
	SpellID string
	Targets []string
	Choice  spells.Choice
}

// Soglie delle regole: l'intermedio lancia la candidata migliore se vale almeno
// simpleThreshold; l'avanzato solo se il punteggio supera il mana speso, pesato
// con manaWeight.
const (
	simpleThreshold = 0.3
	manaWeight      = 0.35
	// maxTargetSets limita le combinazioni di bersagli esaminate per magia (le
	// rune su tre case ne avrebbero decine di migliaia).
	maxTargetSets = 400
)

// ChooseSpell sceglie la magia da lanciare ora; false = passare la fase.
// rejected sono le magie che il server ha già rifiutato in questa fase, che
// non si ritentano.
func ChooseSpell(level Level, v View, rejected map[string]bool, rng *rand.Rand) (Cast, bool) {
	options := castable(v, rejected)
	if len(options) == 0 {
		return Cast{}, false
	}
	p := profiles[level]
	if p.spells == spellsAtRandom {
		if rng.Float64() >= p.castChance {
			return Cast{}, false
		}
		return randomCast(v, options, rng)
	}

	var best Cast
	bestScore, ties := 0.0, 0
	found := false
	for _, def := range options {
		choice, ok := choiceFor(v, def)
		if !ok {
			continue
		}
		for _, targets := range targetSets(v, def, allSquares, maxTargetSets) {
			score := scoreCast(v, def, targets, choice)
			if p.spells == spellsCareful {
				score -= manaWeight * float64(def.ManaCost)
				if score <= 0 {
					continue
				}
			} else if score < simpleThreshold {
				continue
			}
			switch {
			case !found || score > bestScore:
				best, bestScore, ties, found = Cast{SpellID: def.ID, Targets: targets, Choice: choice}, score, 1, true
			case score == bestScore:
				// A parità si sceglie a caso, così il bot non è sempre uguale.
				ties++
				if rng.IntN(ties) == 0 {
					best = Cast{SpellID: def.ID, Targets: targets, Choice: choice}
				}
			}
		}
	}
	return best, found
}

// castable sono le magie in mano lanciabili ora: in catalogo, nel mana, nella
// fase, nei limiti per turno e non già rifiutate. Una sola volta per carta.
func castable(v View, rejected map[string]bool) []spells.Spell {
	var out []spells.Spell
	seen := map[string]bool{}
	for _, id := range v.Hand {
		def, ok := spells.Catalog[id]
		if !ok || seen[id] || rejected[id] || def.ManaCost > v.Mana || !slices.Contains(def.Phases, v.Phase) {
			continue
		}
		if limit, ok := def.Limits[spells.LimitPerTurn]; ok && v.Casts[id] >= limit {
			continue
		}
		seen[id] = true
		out = append(out, def)
	}
	return out
}

// randomCast prova le magie in ordine casuale e lancia la prima che ha una
// scelta e bersagli validi, scelti a caso.
func randomCast(v View, options []spells.Spell, rng *rand.Rand) (Cast, bool) {
	for _, i := range rng.Perm(len(options)) {
		def := options[i]
		choice, ok := choiceFor(v, def)
		if !ok {
			continue
		}
		squares := append([]string{}, allSquares...)
		rng.Shuffle(len(squares), func(a, b int) { squares[a], squares[b] = squares[b], squares[a] })
		if sets := targetSets(v, def, squares, 1); len(sets) > 0 {
			return Cast{SpellID: def.ID, Targets: sets[0], Choice: choice}, true
		}
	}
	return Cast{}, false
}

// allSquares sono le 64 case, da a1 a h8.
var allSquares = func() []string {
	out := make([]string, 0, 64)
	for rank := byte('1'); rank <= '8'; rank++ {
		for file := byte('a'); file <= 'h'; file++ {
			out = append(out, string([]byte{file, rank}))
		}
	}
	return out
}()

// targetSets elenca, nell'ordine di squares, al più limit combinazioni di
// bersagli valide per la magia secondo effects.ValidateTargets (le stesse
// regole del server). Una magia senza bersagli ha una sola combinazione, vuota.
func targetSets(v View, def spells.Spell, squares []string, limit int) [][]string {
	if len(def.Targets) == 0 {
		return [][]string{{}}
	}
	var out [][]string
	var walk func(prefix []string)
	walk = func(prefix []string) {
		if len(prefix) == len(def.Targets) {
			out = append(out, prefix)
			return
		}
		for _, square := range squares {
			if len(out) >= limit {
				return
			}
			next := append(append([]string{}, prefix...), square)
			if effects.ValidateTargets(v.FEN, v.Tracker, def.Targets, next, v.Color) == nil {
				walk(next)
			}
		}
	}
	walk(nil)
	return out
}

// choiceFor è la scelta del pezzo che la magia richiede: per la promozione il
// più forte ammesso, per il ritorno dal cimitero il più forte presente. false
// se la magia ora non si può lanciare (cimitero senza pezzi ammessi).
func choiceFor(v View, def spells.Spell) (spells.Choice, bool) {
	for _, e := range def.Effects {
		switch e.Kind {
		case spells.EffectPromotePiece:
			kind, ok := strongest(kindsParam(e.Params, "choices"), func(spells.PieceKind) bool { return true })
			return spells.Choice{Piece: kind}, ok
		case spells.EffectRevivePiece:
			inGraveyard := func(k spells.PieceKind) bool { return slices.Contains(v.Graveyard, k) }
			kind, ok := strongest(kindsParam(e.Params, "pieces"), inGraveyard)
			return spells.Choice{Piece: kind}, ok
		}
	}
	return spells.Choice{}, true
}

// strongest è il pezzo di valore più alto fra i kinds che allowed accetta.
func strongest(kinds []spells.PieceKind, allowed func(spells.PieceKind) bool) (spells.PieceKind, bool) {
	var best spells.PieceKind
	for _, k := range kinds {
		if !allowed(k) {
			continue
		}
		if best == "" || kindValue(k) > kindValue(best) {
			best = k
		}
	}
	return best, best != ""
}

// kindsParam legge un parametro con un elenco di pezzi.
func kindsParam(params map[string]interface{}, key string) []spells.PieceKind {
	switch list := params[key].(type) {
	case []spells.PieceKind:
		return list
	case []interface{}:
		out := make([]spells.PieceKind, 0, len(list))
		for _, item := range list {
			if s, ok := item.(string); ok {
				out = append(out, spells.PieceKind(s))
			}
		}
		return out
	}
	return nil
}
