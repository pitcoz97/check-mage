package game

import (
	"chess-server/internal/effects"
	"chess-server/internal/match"
	"chess-server/internal/models"
	"chess-server/internal/spells"
)

// Bus di eventi interno (docs/BRIEFING-MAGIE.md, Step 5): le azioni della
// partita (mosse, magie, rune) notificano gli eventi che contano per trigger e
// aure. Le reazioni si applicano subito sotto r.mu e si raccolgono in un
// eventLog, trasmesso dopo aver rilasciato il lock.

// triggerFired è il payload di trigger_fired: un trigger ha reagito.
type triggerFired struct {
	Player        match.Player           `json:"player"`
	On            string                 `json:"on"`
	Do            string                 `json:"do"`
	SourceSpellID string                 `json:"source_spell_id"`
	Result        map[string]interface{} `json:"result"`
}

// auraChange è il payload di aura_changed: un'aura si è accesa o spenta.
type auraChange struct {
	Player match.Player `json:"player"`
	Grant  string       `json:"grant"`
	Active bool         `json:"active"`
}

// eventLog raccoglie le reazioni di un'azione. views è la fotografia delle liste
// di trigger e aure per ciascun giocatore, presa da sealEvents se sono cambiate.
type eventLog struct {
	fired         []triggerFired
	draws         []match.DrawResult
	auras         []auraChange
	playerEffects bool
	views         playerEffectViews
}

// onPieceLost: n pezzi di owner sono finiti nel cimitero. I trigger
// own_piece_lost / draw_card del proprietario pescano Amount carte per pezzo
// (M48). Va invocata con r.mu tenuto.
func (r *Room) onPieceLost(log *eventLog, owner match.Player, n int) {
	if n <= 0 {
		return
	}
	ps := r.playerState(owner)
	for i := 0; i < len(ps.Triggers); i++ {
		t := ps.Triggers[i]
		if t.On != spells.TriggerOnOwnPieceLost || t.Do != spells.TriggerDoDrawCard {
			continue
		}
		count := 0
		for k := 0; k < n*max(t.Amount, 1); k++ {
			if d := r.Match.DrawFor(owner); d.CardID != "" {
				count++
				log.draws = append(log.draws, d)
			}
		}
		log.fired = append(log.fired, triggerFired{Player: owner, On: t.On, Do: t.Do, SourceSpellID: t.SourceSpellID,
			Result: map[string]interface{}{"kind": spells.TriggerDoDrawCard, "count": count}})
		if t.OneShot {
			ps.Triggers = append(ps.Triggers[:i], ps.Triggers[i+1:]...)
			i--
			log.playerEffects = true
		}
	}
}

// onCaptureAttempt: il pezzo attackerID di attacker ha provato a catturare un
// pezzo scudato dell'avversario (lo scudo ha assorbito o si è rotto). Il primo
// trigger shielded_piece_attacked / freeze_attacker del difensore congela
// l'attaccante dove si trova ora (M45, M47) e, se OneShot, si consuma (M46). Il
// re non viene mai colpito (regola globale): il trigger resta. Va invocata con
// r.mu tenuto, dopo che la mossa (e un'eventuale runa) è stata applicata.
func (r *Room) onCaptureAttempt(log *eventLog, attacker match.Player, attackerID int) {
	owner := attacker.Opponent()
	ps := r.playerState(owner)
	for i, t := range ps.Triggers {
		if t.On != spells.TriggerOnShieldedAttacked || t.Do != spells.TriggerDoFreezeAttacker {
			continue
		}
		square, ok := r.Tracker.SquareOf(attackerID)
		if !ok {
			return // l'attaccante non c'è più (una runa esplosiva l'ha distrutto)
		}
		if _, piece, _ := r.Tracker.Info(square); piece == 'K' || piece == 'k' {
			return
		}
		// +1: il gelo cade nel turno dell'attaccante, che non conta (M47, come M44).
		turns := max(t.Amount, 1) + 1
		if err := effects.FreezePiece(r.Tracker, square, toEffectsColor(owner), turns, t.SourceSpellID); err != nil {
			return
		}
		log.fired = append(log.fired, triggerFired{Player: owner, On: t.On, Do: t.Do, SourceSpellID: t.SourceSpellID,
			Result: map[string]interface{}{"kind": spells.EffectFreezePiece, "target": square, "remaining_turns": turns}})
		if t.OneShot {
			ps.Triggers = append(ps.Triggers[:i], ps.Triggers[i+1:]...)
			log.playerEffects = true
		}
		return
	}
}

// refreshAuras ricalcola le aure dei due giocatori sulla FEN corrente (M49) e
// registra quelle che si sono accese o spente. Va invocata con r.mu tenuto dopo
// ogni cambio della scacchiera.
func (r *Room) refreshAuras(log *eventLog) {
	for _, p := range []match.Player{match.PlayerWhite, match.PlayerBlack} {
		ps := r.playerState(p)
		if len(ps.Auras) == 0 {
			continue
		}
		pawns := r.ownPawns(p)
		for i := range ps.Auras {
			a := &ps.Auras[i]
			if active := pawns >= a.MinOwnPawns; active != a.Active {
				a.Active = active
				log.auras = append(log.auras, auraChange{Player: p, Grant: a.Grant, Active: active})
				log.playerEffects = true
			}
		}
	}
}

// ownPawns conta i pedoni del giocatore sulla FEN corrente.
func (r *Room) ownPawns(p match.Player) int {
	pawn := byte('P')
	if p == match.PlayerBlack {
		pawn = 'p'
	}
	return effects.CountPieces(r.Board.FEN, pawn)
}

// tickTriggers, a un cambio di turno, aggiorna le durate dei trigger dei due
// giocatori (regole di TickTurnEnd, M9). Va invocata con r.mu tenuto.
func (r *Room) tickTriggers(log *eventLog, results []match.AdvanceResult) {
	for _, res := range results {
		if !res.NewTurn {
			continue
		}
		finishing := res.ActivePlayer.Opponent()
		for _, p := range []match.Player{match.PlayerWhite, match.PlayerBlack} {
			if r.playerState(p).TickTriggers(p == finishing) {
				log.playerEffects = true
			}
		}
		return
	}
}

// triggerView e auraView sono le voci pubbliche di triggers e auras.
type triggerView struct {
	Player         match.Player `json:"player"`
	On             string       `json:"on"`
	Do             string       `json:"do"`
	RemainingTurns int          `json:"remaining_turns"`
	SourceSpellID  string       `json:"source_spell_id"`
	Hidden         bool         `json:"hidden,omitempty"`
}

type auraView struct {
	Player        match.Player `json:"player"`
	Grant         string       `json:"grant"`
	Active        bool         `json:"active"`
	MinOwnPawns   int          `json:"min_own_pawns"`
	SourceSpellID string       `json:"source_spell_id"`
}

// playerEffects sono le liste viste da un giocatore: i trigger nascosti
// dell'avversario non ci sono (M51).
type playerEffects struct {
	Triggers []triggerView `json:"triggers"`
	Auras    []auraView    `json:"auras"`
}

// playerEffectViews sono le liste di ciascun giocatore. nil = nessun cambiamento.
type playerEffectViews map[match.Player]playerEffects

// playerEffectsFor costruisce le liste viste da viewer. Va invocata con r.mu tenuto.
func (r *Room) playerEffectsFor(viewer match.Player) playerEffects {
	out := playerEffects{Triggers: []triggerView{}, Auras: []auraView{}}
	if r.Match == nil {
		return out
	}
	for _, p := range []match.Player{match.PlayerWhite, match.PlayerBlack} {
		ps := r.playerState(p)
		if ps == nil {
			continue
		}
		for _, t := range ps.Triggers {
			if t.Hidden && p != viewer {
				continue
			}
			out.Triggers = append(out.Triggers, triggerView{Player: p, On: t.On, Do: t.Do, RemainingTurns: t.RemainingTurns,
				SourceSpellID: t.SourceSpellID, Hidden: t.Hidden})
		}
		for _, a := range ps.Auras {
			out.Auras = append(out.Auras, auraView{Player: p, Grant: a.Grant, Active: a.Active, MinOwnPawns: a.MinOwnPawns,
				SourceSpellID: a.SourceSpellID})
		}
	}
	return out
}

// sealEvents fotografa le liste se sono cambiate. Va invocata con r.mu tenuto,
// prima di rilasciarlo.
func (r *Room) sealEvents(log *eventLog) {
	if log.playerEffects {
		log.views = playerEffectViews{
			match.PlayerWhite: r.playerEffectsFor(match.PlayerWhite),
			match.PlayerBlack: r.playerEffectsFor(match.PlayerBlack),
		}
	}
}

// broadcastEvents trasmette le reazioni raccolte: trigger scattati e aure a
// entrambi, le carte pescate solo al proprietario (con hand_size_changed a
// entrambi), le liste a ciascuno la sua. Va invocata senza r.mu.
func (r *Room) broadcastEvents(log eventLog) {
	for _, f := range log.fired {
		r.Broadcast(models.MsgTriggerFired, f)
	}
	for _, d := range log.draws {
		r.broadcastDraw(d)
	}
	for _, a := range log.auras {
		r.Broadcast(models.MsgAuraChanged, a)
	}
	if log.views == nil {
		return
	}
	for _, p := range []match.Player{match.PlayerWhite, match.PlayerBlack} {
		if c := r.clientOf(p); c != nil {
			c.SendMessage(models.MsgPlayerEffectsChanged, log.views[p])
		}
	}
}
