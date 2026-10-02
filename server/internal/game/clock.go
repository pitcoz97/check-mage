package game

import (
	"chess-server/internal/logger"
	"chess-server/internal/match"
	"chess-server/internal/models"
	"chess-server/internal/phase"
	"fmt"
	"time"

	"go.uber.org/zap"
)

// Tempo per fase: ogni fase del giocatore attivo ha il suo tempo, che riparte a
// ogni cambio di fase (MainTime per main1 e main2, MoveTime per la mossa).
//   - Magie scaduta: la fase si passa al posto del giocatore e conta una
//     scadenza; MaxStrikes scadenze di fila fanno perdere (timeout_strikes). Il
//     conto si azzera quando il giocatore chiude da solo una fase Magie (passa o
//     lancia una magia); la mossa, obbligatoria, non lo tocca.
//   - Mossa scaduta: sconfitta (timeout), salvo la seconda mossa di Fretta,
//     facoltativa, che si salta.

// MaxStrikes è il numero di fasi Magie scadute di fila che fa perdere.
const MaxStrikes = 3

// Motivi di game_over legati al tempo.
const (
	ReasonTimeout        = "timeout"         // tempo della mossa scaduto
	ReasonTimeoutStrikes = "timeout_strikes" // MaxStrikes fasi Magie scadute di fila
)

// currentPhaseKey identifica la fase del giocatore attivo. Va invocata con r.mu tenuto.
func (r *Room) currentPhaseKey() string {
	return fmt.Sprintf("%d/%s/%s", r.Match.TurnNumber, r.Match.ActivePlayer, r.Match.CurrentPhase)
}

// isMainPhase indica se la fase corrente è una fase Magie. Va invocata con r.mu tenuto.
func (r *Room) isMainPhase() bool {
	return r.Match.CurrentPhase == phase.PhaseMain1 || r.Match.CurrentPhase == phase.PhaseMain2
}

// phaseLimit è il tempo pieno della fase corrente. Va invocata con r.mu tenuto.
func (r *Room) phaseLimit() time.Duration {
	if r.Match.CurrentPhase == phase.PhaseMove {
		return r.MoveTime
	}
	return r.MainTime
}

// syncPhaseClock fa ripartire PhaseLeft dal tempo pieno quando la fase è
// cambiata: così non serve toccare ogni punto in cui la fase avanza. Va
// invocata con r.mu tenuto.
func (r *Room) syncPhaseClock() {
	if key := r.currentPhaseKey(); key != r.phaseKey {
		r.phaseKey, r.PhaseLeft = key, r.phaseLimit()
	}
}

// syncedPhaseLeft è PhaseLeft dopo syncPhaseClock. Va invocata con r.mu tenuto.
func (r *Room) syncedPhaseLeft() time.Duration {
	r.syncPhaseClock()
	return r.PhaseLeft
}

// resetStrikes azzera le scadenze di fila di p. Va invocata con r.mu tenuto.
func (r *Room) resetStrikes(p match.Player) {
	if r.strikes != nil {
		r.strikes[p] = 0
	}
}

// runTimer fa scorrere in tempo reale il tempo della fase del giocatore
// ATTIVO (match.ActivePlayer) ed è l'unica autorità sul tempo. Scala il tempo
// realmente trascorso, così i tick persi (lock occupato durante una chiamata a
// Stockfish) non regalano tempo. Manda timer_update ogni secondo e subito dopo
// un cambio di fase.
func (r *Room) runTimer() {
	tickGame := time.NewTicker(100 * time.Millisecond)
	tickBroadcast := time.NewTicker(1 * time.Second)
	defer tickGame.Stop()
	defer tickBroadcast.Stop()

	last := time.Now()
	lastKey := ""
	for {
		select {
		case <-r.timerStop:
			return

		case now := <-tickGame.C:
			elapsed := now.Sub(last)
			last = now

			r.mu.Lock()
			if r.ended {
				r.mu.Unlock()
				return
			}
			r.syncPhaseClock()
			changed := r.phaseKey != lastKey
			lastKey = r.phaseKey
			r.PhaseLeft -= elapsed
			expired := r.PhaseLeft <= 0
			if expired {
				r.PhaseLeft = 0
			}
			key := r.phaseKey
			r.mu.Unlock()

			if expired {
				r.expirePhase(key)
			} else if changed {
				r.broadcastTimers()
			}

		case <-tickBroadcast.C:
			r.broadcastTimers()
		}
	}
}

// expirePhase applica lo scadere del tempo della fase key. Se nel frattempo il
// giocatore ha agito (la fase è cambiata) non fa nulla.
func (r *Room) expirePhase(key string) {
	r.mu.Lock()
	if r.ended || r.currentPhaseKey() != key {
		r.mu.Unlock()
		return
	}
	player := r.Match.ActivePlayer
	client := r.clientOf(player)
	current := r.Match.CurrentPhase
	winner := models.ResultWhiteWins
	if player == match.PlayerWhite {
		winner = models.ResultBlackWins
	}

	if current == phase.PhaseMove {
		if r.extraActive() && r.extra.Player == player {
			// Solo la seconda mossa di Fretta, facoltativa: si salta.
			r.mu.Unlock()
			r.passPhase(client, key)
			return
		}
		end := r.finishLocked(winner, ReasonTimeout, StatusTimeout)
		r.mu.Unlock()
		logger.L.Info("Tempo della mossa scaduto", zap.String("room", r.ID), zap.String("player", string(player)))
		if end != nil {
			r.broadcastTimers()
			r.broadcastState()
		}
		r.announceEnd(end)
		return
	}

	if r.strikes == nil {
		r.strikes = map[match.Player]int{}
	}
	r.strikes[player]++
	strikes := r.strikes[player]
	var end *gameEnd
	if strikes >= MaxStrikes {
		end = r.finishLocked(winner, ReasonTimeoutStrikes, StatusTimeout)
	}
	r.mu.Unlock()

	logger.L.Info("Tempo della fase scaduto",
		zap.String("room", r.ID),
		zap.String("player", string(player)),
		zap.String("phase", string(current)),
		zap.Int("strikes", strikes),
	)
	r.Broadcast(models.MsgPhaseTimeout, map[string]interface{}{
		"player":  player,
		"phase":   current,
		"strikes": strikes,
	})
	if end != nil {
		r.broadcastState()
		r.announceEnd(end)
		return
	}
	r.passPhase(client, key)
}

// broadcastTimers manda il tempo della fase del giocatore attivo. "turn" è il
// giocatore attivo (di chi sta scorrendo il tempo), non il lato al tratto degli
// scacchi. Va invocata SENZA r.mu.
func (r *Room) broadcastTimers() {
	r.mu.Lock()
	left, active, current := r.syncedPhaseLeft().Milliseconds(), r.Match.ActivePlayer, r.Match.CurrentPhase
	r.mu.Unlock()
	r.Broadcast(models.MsgTimerUpdate, map[string]interface{}{
		"phase_time": left,
		"turn":       active,
		"phase":      current,
	})
}
