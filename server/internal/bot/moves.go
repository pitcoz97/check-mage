package bot

import (
	"math/rand/v2"
	"slices"

	"chess-server/internal/engine"
)

// Engine è il motore che sceglie la mossa: engine.Bot, o un finto nei test.
type Engine interface {
	BestMoveWith(fen string, s engine.Search) string
}

// ChooseMove sceglie la mossa del bot. playable sono le mosse degli scacchi
// ammesse dalle magie: il motore sceglie solo fra queste (searchmoves). special
// sono le mosse che esistono solo grazie alle magie e che il motore non conosce:
// il bot le gioca solo quando sceglie a caso o non ha altro. Con eng nil si
// sceglie sempre a caso. "" se non c'è nessuna mossa.
func ChooseMove(level Level, fen string, playable, special []string, eng Engine, rng *rand.Rand) string {
	all := append(append([]string{}, playable...), special...)
	if len(all) == 0 {
		return ""
	}
	p := profiles[level]
	if eng == nil || len(playable) == 0 || rng.Float64() < p.randomMove {
		return all[rng.IntN(len(all))]
	}
	if len(playable) == 1 {
		return playable[0]
	}
	search := p.search
	search.Only = playable
	if move := eng.BestMoveWith(fen, search); slices.Contains(playable, move) {
		return move
	}
	// Il motore non ha risposto (o ha risposto fuori dall'elenco): una mossa a caso.
	return playable[rng.IntN(len(playable))]
}
