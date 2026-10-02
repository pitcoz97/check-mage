// Package bot decide le azioni del bot avversario: la mossa (con Stockfish) e
// le magie (a regole). È logica pura: riceve una vista dello stato della
// partita (View) e non conosce la Room, che vive in internal/game (bot.go).
package bot

import (
	"time"

	"chess-server/internal/engine"
)

// Level è il livello di difficoltà del bot.
type Level string

const (
	Base         Level = "base"
	Intermediate Level = "intermediate"
	Advanced     Level = "advanced"
)

// Levels sono i livelli, dal più facile.
var Levels = []Level{Base, Intermediate, Advanced}

// ParseLevel riconosce il nome di un livello.
func ParseLevel(name string) (Level, bool) {
	for _, l := range Levels {
		if string(l) == name {
			return l, true
		}
	}
	return "", false
}

// LevelNames sono i nomi dei livelli (per gli account dei bot, db.EnsureBotAccounts).
func LevelNames() []string {
	out := make([]string, len(Levels))
	for i, l := range Levels {
		out[i] = string(l)
	}
	return out
}

// spellStyle è il modo in cui un livello sceglie le magie.
type spellStyle int

const (
	spellsAtRandom spellStyle = iota // una magia lanciabile a caso, con bersagli a caso
	spellsSimple                     // la candidata col punteggio più alto, se utile
	spellsCareful                    // come sopra, ma solo se vale il mana che costa
)

// profile sono i parametri di un livello. Sono il punto in cui tarare la forza
// del bot: valori iniziali, da rivedere giocando.
type profile struct {
	search     engine.Search // ricerca di Stockfish (senza Only, che dipende dalla posizione)
	randomMove float64       // probabilità di giocare una mossa a caso invece di quella del motore
	castChance float64       // probabilità di lanciare una magia in una fase main (solo spellsAtRandom)
	spells     spellStyle
}

var profiles = map[Level]profile{
	Base: {
		search:     engine.Search{Skill: 0, Depth: 1},
		randomMove: 0.3,
		castChance: 0.5,
		spells:     spellsAtRandom,
	},
	Intermediate: {
		search: engine.Search{Skill: 8, Depth: 6},
		spells: spellsSimple,
	},
	Advanced: {
		search: engine.Search{Skill: 20, MoveTime: 600 * time.Millisecond},
		spells: spellsCareful,
	},
}

// MaxCastsPerPhase limita le magie del bot in una fase: una salvaguardia, oltre
// al mana, contro i cicli.
const MaxCastsPerPhase = 3
