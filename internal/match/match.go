// Package match orchestra una partita di "scacchi + magie": sovrappone la
// macchina a stati delle fasi del turno (vedi internal/phase) a una partita di
// scacchi pura. Volutamente NON conosce scacchiera, FEN o Stockfish —
// internal/game resta scacchi puri — così il livello magico può evolvere in
// modo indipendente.
package match

import "chess-server/internal/phase"

// Player identifica il lato che sta agendo nel turno corrente.
type Player string

const (
	PlayerWhite Player = "white"
	PlayerBlack Player = "black"
)

// Opponent restituisce l'altro giocatore.
func (p Player) Opponent() Player {
	if p == PlayerWhite {
		return PlayerBlack
	}
	return PlayerWhite
}

// Hooks vengono invocati quando l'orchestratore entra in determinate fasi.
// Sono i punti di aggancio dove gli step successivi inseriranno il comportamento
// reale (pesca carte, decremento effetti a fine turno). In Step 1 sono
// placeholder opzionali.
type Hooks struct {
	// OnDraw scatta quando un giocatore entra nella sua fase di draw (inizio
	// del suo turno), già con ActivePlayer/TurnNumber aggiornati.
	// TODO(step2): pescare 1 carta per il giocatore attivo.
	OnDraw func(s *State)
	// OnEndTurn scatta durante la transizione server-side end_turn, PRIMA che il
	// match passi all'avversario (ActivePlayer è ancora il giocatore uscente).
	// TODO(step4): decrementare i contatori degli effetti attivi.
	OnEndTurn func(s *State)
}

// State è lo stato di orchestrazione fase/turno di una singola partita.
type State struct {
	CurrentPhase phase.Phase
	TurnNumber   int
	ActivePlayer Player
}

// New restituisce lo stato iniziale: tocca al Bianco, turno 1, fase draw.
func New() *State {
	return &State{
		CurrentPhase: phase.PhaseDraw,
		TurnNumber:   1,
		ActivePlayer: PlayerWhite,
	}
}

// Advance porta il match alla fase successiva in cui il giocatore attivo deve
// agire.
//
// end_turn è una transizione server-side: quando la sequenza la raggiunge,
// scatta l'hook OnEndTurn e il match passa immediatamente alla fase draw
// dell'avversario — scambiando il giocatore attivo, incrementando il contatore
// del turno e invocando OnDraw. I chiamanti quindi non osservano mai il match
// fermo in end_turn: da main2 un singolo Advance approda alla draw avversaria.
func (s *State) Advance(hooks Hooks) {
	next, err := phase.Next(s.CurrentPhase)
	if err != nil {
		// Stato corrotto: ripartiamo dalla draw del giocatore attivo.
		s.CurrentPhase = phase.PhaseDraw
		return
	}

	if next == phase.PhaseEndTurn {
		s.CurrentPhase = phase.PhaseEndTurn
		if hooks.OnEndTurn != nil {
			hooks.OnEndTurn(s)
		}
		s.rollOver(hooks)
		return
	}

	s.CurrentPhase = next
}

// rollOver passa il turno all'avversario e ne apre la fase di draw.
func (s *State) rollOver(hooks Hooks) {
	s.ActivePlayer = s.ActivePlayer.Opponent()
	s.TurnNumber++
	s.CurrentPhase = phase.PhaseDraw
	if hooks.OnDraw != nil {
		hooks.OnDraw(s)
	}
}

// IsActive indica se il giocatore dato è quello di turno.
func (s *State) IsActive(p Player) bool {
	return s.ActivePlayer == p
}

// Allows indica se l'azione data è legale nella fase corrente.
func (s *State) Allows(a phase.ActionKind) bool {
	return phase.IsAllowed(s.CurrentPhase, a)
}
