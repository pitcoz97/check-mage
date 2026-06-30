// Package match orchestra una partita di "scacchi + magie": combina la
// macchina a stati delle fasi del turno (internal/phase) con le risorse del
// card game (internal/spells). Volutamente NON conosce scacchiera, FEN o
// Stockfish — internal/game resta scacchi puri — così il livello magico può
// evolvere in modo indipendente.
package match

import (
	"errors"
	"fmt"
	"math/rand"

	"chess-server/internal/phase"
	"chess-server/internal/spells"
)

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

// State è lo stato di orchestrazione di una singola partita: fase/turno più le
// risorse del card game dei due giocatori.
type State struct {
	CurrentPhase phase.Phase
	TurnNumber   int
	ActivePlayer Player

	Seed  int64               // seed RNG del match (determinismo/replay)
	White *spells.PlayerState // risorse del Bianco
	Black *spells.PlayerState // risorse del Nero

	rng *rand.Rand
}

// New costruisce lo stato iniziale: tocca al Bianco, turno 1, fase draw. Da
// seed costruisce e mischia in modo deterministico i mazzi e distribuisce le
// mani iniziali. Il Bianco NON pesca al turno 1 (stile Hearthstone: chi inizia
// salta la prima pesca); la pesca per-turno parte dal primo turno del Nero.
func New(seed int64) *State {
	rng := rand.New(rand.NewSource(seed))
	return &State{
		CurrentPhase: phase.PhaseDraw,
		TurnNumber:   1,
		ActivePlayer: PlayerWhite,
		Seed:         seed,
		White:        spells.NewPlayerState(rng),
		Black:        spells.NewPlayerState(rng),
		rng:          rng,
	}
}

// player restituisce le risorse del giocatore dato.
func (s *State) player(p Player) *spells.PlayerState {
	if p == PlayerWhite {
		return s.White
	}
	return s.Black
}

// DrawResult descrive una pesca d'inizio turno.
type DrawResult struct {
	Player   Player
	CardID   string // "" se il mazzo era vuoto (nessuna pesca, niente fatigue)
	HandSize int
	DeckSize int
}

// ManaState è una fotografia del mana di un giocatore.
type ManaState struct {
	Player  Player
	Current int
	Max     int
}

// AdvanceResult riporta cosa è successo durante un Advance, così che il
// chiamante (game.Room) possa tradurlo in messaggi WebSocket.
type AdvanceResult struct {
	NewTurn bool        // true se è iniziato un nuovo turno (rollover)
	Draw    *DrawResult // pesca d'inizio turno (nil se nessun nuovo turno)
	Mana    *ManaState  // mana del giocatore attivo dopo il refresh
}

// Advance porta il match alla fase successiva in cui il giocatore attivo deve
// agire.
//
// end_turn è una transizione server-side: quando la sequenza la raggiunge il
// match passa immediatamente alla fase draw dell'avversario — scambiando il
// giocatore attivo, incrementando il turno e applicando gli effetti d'inizio
// turno (refill mana + pesca). I chiamanti quindi non osservano mai il match
// fermo in end_turn: da main2 un singolo Advance approda alla draw avversaria.
func (s *State) Advance() AdvanceResult {
	next, err := phase.Next(s.CurrentPhase)
	if err != nil {
		// Stato corrotto: ripartiamo dalla draw del giocatore attivo.
		s.CurrentPhase = phase.PhaseDraw
		return AdvanceResult{}
	}

	if next != phase.PhaseEndTurn {
		s.CurrentPhase = next
		return AdvanceResult{}
	}

	// next == end_turn: transizione di fine turno + rollover all'avversario.
	s.CurrentPhase = phase.PhaseEndTurn
	// TODO(step4): qui andranno i trigger di fine turno (decremento contatori
	// degli effetti attivi sui pezzi).
	s.ActivePlayer = s.ActivePlayer.Opponent()
	s.TurnNumber++
	s.CurrentPhase = phase.PhaseDraw
	return s.beginTurn()
}

// beginTurn applica gli effetti d'inizio turno del giocatore attivo: refill del
// mana e pesca automatica.
func (s *State) beginTurn() AdvanceResult {
	mana := s.refreshMana(s.ActivePlayer)
	draw := s.drawCard(s.ActivePlayer)
	return AdvanceResult{NewTurn: true, Draw: &draw, Mana: &mana}
}

// playerTurnIndex è il numero d'ordine del turno del giocatore (1 = primo
// turno). Il Bianco agisce nei turni globali dispari, il Nero nei pari.
func (s *State) playerTurnIndex(p Player) int {
	if p == PlayerWhite {
		return (s.TurnNumber + 1) / 2
	}
	return s.TurnNumber / 2
}

// refreshMana porta il mana massimo del giocatore a min(turni del giocatore, 10)
// e ricarica il mana attuale al massimo. Risultato: max 1 al 1° turno, +1 ad
// ogni turno successivo del giocatore.
func (s *State) refreshMana(p Player) ManaState {
	ps := s.player(p)
	ps.MaxMana = s.playerTurnIndex(p)
	if ps.MaxMana > spells.MaxManaCap {
		ps.MaxMana = spells.MaxManaCap
	}
	ps.Mana = ps.MaxMana
	return ManaState{Player: p, Current: ps.Mana, Max: ps.MaxMana}
}

// drawCard pesca una carta dalla cima del mazzo del giocatore. Se il mazzo è
// vuoto non succede nulla (MVP: niente fatigue).
func (s *State) drawCard(p Player) DrawResult {
	ps := s.player(p)
	res := DrawResult{Player: p, HandSize: len(ps.Hand), DeckSize: len(ps.Deck)}
	if len(ps.Deck) == 0 {
		return res
	}
	card := ps.Deck[0]
	ps.Deck = ps.Deck[1:]
	ps.Hand = append(ps.Hand, card)
	res.CardID = card
	res.HandSize = len(ps.Hand)
	res.DeckSize = len(ps.Deck)
	return res
}

// CastResult riporta l'esito di un cast riuscito.
type CastResult struct {
	Spell          spells.Spell
	EffectsApplied []spells.Effect
	Targets        []string
	ManaAfter      int
	ManaMax        int
	HandSize       int
}

// CastSpell valida e applica il cast di una magia. In Step 2 gli effetti sono
// noop: viene scalato il mana e la carta va nello scarto, senza toccare la
// scacchiera. La validazione dei target controlla per ora solo la cardinalità.
func (s *State) CastSpell(p Player, spellID string, targets []string) (CastResult, error) {
	if !s.IsActive(p) {
		return CastResult{}, errors.New("non è il tuo turno")
	}
	if !s.Allows(phase.ActionCastSpell) {
		return CastResult{}, fmt.Errorf("non puoi castare magie nella fase %s", s.CurrentPhase)
	}

	def, ok := spells.Catalog[spellID]
	if !ok {
		return CastResult{}, fmt.Errorf("magia sconosciuta: %s", spellID)
	}
	if !phaseAllowsSpell(def, s.CurrentPhase) {
		return CastResult{}, fmt.Errorf("%s non è giocabile nella fase %s", def.Name, s.CurrentPhase)
	}

	ps := s.player(p)
	idx := ps.HandIndex(spellID)
	if idx < 0 {
		return CastResult{}, errors.New("carta non in mano")
	}
	if ps.Mana < def.ManaCost {
		return CastResult{}, fmt.Errorf("mana insufficiente: servono %d, hai %d", def.ManaCost, ps.Mana)
	}
	if len(targets) != def.TargetType.TargetCount() {
		return CastResult{}, fmt.Errorf("la magia %s richiede %d bersagli, ricevuti %d",
			def.Name, def.TargetType.TargetCount(), len(targets))
	}

	// Applica: scala il mana, sposta la carta dalla mano allo scarto.
	ps.Mana -= def.ManaCost
	ps.Hand = append(ps.Hand[:idx], ps.Hand[idx+1:]...)
	ps.Discard = append(ps.Discard, spellID)

	// TODO(step3+): eseguire def.Effects su scacchiera/stato. In Step 2 sono noop.
	return CastResult{
		Spell:          def,
		EffectsApplied: def.Effects,
		Targets:        targets,
		ManaAfter:      ps.Mana,
		ManaMax:        ps.MaxMana,
		HandSize:       len(ps.Hand),
	}, nil
}

// phaseAllowsSpell indica se la magia è giocabile nella fase data.
func phaseAllowsSpell(def spells.Spell, p phase.Phase) bool {
	for _, allowed := range def.Phases {
		if allowed == p {
			return true
		}
	}
	return false
}

// IsActive indica se il giocatore dato è quello di turno.
func (s *State) IsActive(p Player) bool {
	return s.ActivePlayer == p
}

// Allows indica se l'azione data è legale nella fase corrente.
func (s *State) Allows(a phase.ActionKind) bool {
	return phase.IsAllowed(s.CurrentPhase, a)
}
