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

// Snapshot è lo stato serializzabile del match (per la persistenza DB). Le
// PlayerState hanno campi esportati, quindi marshalla direttamente in JSON.
type Snapshot struct {
	CurrentPhase phase.Phase         `json:"current_phase"`
	TurnNumber   int                 `json:"turn_number"`
	ActivePlayer Player              `json:"active_player"`
	Seed         int64               `json:"seed"`
	White        *spells.PlayerState `json:"white"`
	Black        *spells.PlayerState `json:"black"`
}

// Snapshot cattura lo stato corrente per la persistenza.
func (s *State) Snapshot() Snapshot {
	return Snapshot{
		CurrentPhase: s.CurrentPhase,
		TurnNumber:   s.TurnNumber,
		ActivePlayer: s.ActivePlayer,
		Seed:         s.Seed,
		White:        s.White,
		Black:        s.Black,
	}
}

// FromSnapshot ricostruisce lo stato da uno Snapshot. L'RNG viene re-seedato dal
// seed: non serve replicarne la posizione perché le pesche leggono dal mazzo già
// persistito (l'RNG è usato solo per il mescolamento iniziale).
func FromSnapshot(sn Snapshot) *State {
	return &State{
		CurrentPhase: sn.CurrentPhase,
		TurnNumber:   sn.TurnNumber,
		ActivePlayer: sn.ActivePlayer,
		Seed:         sn.Seed,
		White:        sn.White,
		Black:        sn.Black,
		rng:          rand.New(rand.NewSource(sn.Seed)),
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
// chiamante (game.Room) possa tradurlo in messaggi WebSocket. Phase/
// ActivePlayer/TurnNumber sono lo snapshot DOPO quel passaggio: servono perché
// un'azione può produrre più passaggi (auto-avanzamento) e i broadcast vanno
// fatti con lo stato di ciascun passaggio, non con quello finale.
type AdvanceResult struct {
	Phase        phase.Phase
	ActivePlayer Player
	TurnNumber   int
	NewTurn      bool        // true se è iniziato un nuovo turno (rollover)
	Draw         *DrawResult // pesca d'inizio turno (nil se nessun nuovo turno)
	Mana         *ManaState  // mana del giocatore attivo dopo il refresh
}

// snapshot completa il risultato con lo stato corrente della FSM.
func (s *State) snapshot(r AdvanceResult) AdvanceResult {
	r.Phase = s.CurrentPhase
	r.ActivePlayer = s.ActivePlayer
	r.TurnNumber = s.TurnNumber
	return r
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
		return s.snapshot(AdvanceResult{})
	}

	if next != phase.PhaseEndTurn {
		s.CurrentPhase = next
		return s.snapshot(AdvanceResult{})
	}

	// next == end_turn: transizione di fine turno + rollover all'avversario.
	s.CurrentPhase = phase.PhaseEndTurn
	// TODO(step4): qui andranno i trigger di fine turno (decremento contatori
	// degli effetti attivi sui pezzi).
	s.ActivePlayer = s.ActivePlayer.Opponent()
	s.TurnNumber++
	s.CurrentPhase = phase.PhaseDraw
	mana := s.refreshMana(s.ActivePlayer)
	draw := s.drawCard(s.ActivePlayer)
	return s.snapshot(AdvanceResult{NewTurn: true, Draw: &draw, Mana: &mana})
}

// DrawFor pesca una carta per il giocatore dato (effetto draw_card).
func (s *State) DrawFor(p Player) DrawResult {
	return s.drawCard(p)
}

// GainMana aggiunge mana al giocatore dato per questo turno (effetto gain_mana),
// senza superare il cap assoluto. Il mana torna al massimo del turno alla
// prossima ricarica.
func (s *State) GainMana(p Player, amount int) ManaState {
	ps := s.player(p)
	ps.Mana += amount
	if ps.Mana > spells.MaxManaCap {
		ps.Mana = spells.MaxManaCap
	}
	return ManaState{Player: p, Current: ps.Mana, Max: ps.MaxMana}
}

// CanCastAny indica se il giocatore attivo ha almeno una magia giocabile ORA:
// carta in mano, mana sufficiente e fase consentita dalla magia.
func (s *State) CanCastAny() bool {
	if !s.Allows(phase.ActionCastSpell) {
		return false
	}
	ps := s.player(s.ActivePlayer)
	for _, id := range ps.Hand {
		def, ok := spells.Catalog[id]
		if ok && def.ManaCost <= ps.Mana && phaseAllowsSpell(def, s.CurrentPhase) {
			return true
		}
	}
	return false
}

// shouldAutoAdvance indica se la fase corrente va saltata senza input utente:
// la draw passa sempre da sola (la pesca è già avvenuta nel rollover); le fasi
// main passano se il giocatore non può castare nulla (niente mana o niente
// carte giocabili); la move richiede sempre la mossa.
func (s *State) shouldAutoAdvance() bool {
	switch s.CurrentPhase {
	case phase.PhaseDraw:
		return true
	case phase.PhaseMain1, phase.PhaseMain2:
		return !s.CanCastAny()
	default:
		return false
	}
}

// AutoAdvance fa avanzare la FSM finché la fase corrente non richiede input
// dell'utente, restituendo in ordine i passaggi avvenuti (eventualmente vuoto).
// Il numero di passaggi è limitato dalla struttura della FSM (la move è sempre
// un punto d'arresto); il cap è solo una salvaguardia.
func (s *State) AutoAdvance() []AdvanceResult {
	var results []AdvanceResult
	for i := 0; i < 12 && s.shouldAutoAdvance(); i++ {
		results = append(results, s.Advance())
	}
	return results
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

// CastResult riporta l'esito di un cast riuscito. EffectsApplied contiene gli
// effetti effettivamente applicati (arricchiti dei dettagli, es. il pezzo
// distrutto), pronti per il broadcast.
type CastResult struct {
	Spell          spells.Spell
	EffectsApplied []interface{}
	Targets        []string
	ManaAfter      int
	ManaMax        int
	HandSize       int
}

// ApplyEffects è la callback con cui game.Room esegue gli effetti della magia
// sulla scacchiera (che match volutamente non conosce). Riceve la definizione e
// i bersagli, applica gli effetti alla board e ritorna gli effetti applicati
// (per il broadcast) oppure un errore. In caso di errore il cast è annullato
// senza spendere mana né scartare la carta.
type ApplyEffects func(def spells.Spell, targets []string) ([]interface{}, error)

// CastSpell valida le regole del card game (turno, fase, carta in mano, mana,
// cardinalità dei bersagli), poi delega l'esecuzione degli effetti sulla board
// alla callback apply. Solo se tutto riesce scala il mana e scarta la carta.
func (s *State) CastSpell(p Player, spellID string, targets []string, apply ApplyEffects) (CastResult, error) {
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

	// Esegue gli effetti sulla board PRIMA di spendere mana: se falliscono
	// (es. bersaglio non valido) il cast è annullato senza costi.
	applied, err := apply(def, targets)
	if err != nil {
		return CastResult{}, err
	}

	ps.Mana -= def.ManaCost
	ps.Hand = append(ps.Hand[:idx], ps.Hand[idx+1:]...)
	ps.Discard = append(ps.Discard, spellID)

	return CastResult{
		Spell:          def,
		EffectsApplied: applied,
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
