package spells

// Effetti che vivono sul giocatore (docs/BRIEFING-MAGIE.md, Step 5): trigger che
// reagiscono agli eventi della partita e aure attive finché vale una condizione.
// Stanno nel PlayerState, quindi finiscono nello snapshot con il resto.

// Eventi e reazioni dei trigger.
const (
	TriggerOnOwnPieceLost        = "own_piece_lost"          // un proprio pezzo finisce nel cimitero
	TriggerOnShieldedAttacked    = "shielded_piece_attacked" // un nemico prova a catturare un proprio pezzo scudato
	TriggerDoDrawCard            = "draw_card"               // pesca Amount carte
	TriggerDoFreezeAttacker      = "freeze_attacker"         // congela l'attaccante per Amount turni
	AuraGrantPawnSidestep        = "pawn_sidestep"           // i pedoni muovono di 1 di lato (mossa allo Step 6)
	AuraConditionOwnPawnsAtLeast = "own_pawns_gte"           // chiave della condizione nei params
)

// PermanentTurns è la durata di un effetto che non scade.
const PermanentTurns = -1

// Trigger è una reazione registrata da una magia sul giocatore che la lancia.
//
// RemainingTurns segue le regole degli stati sui pezzi: scende alla fine di ogni
// turno dell'avversario del proprietario; 0 = fino alla fine del turno del
// proprietario; PermanentTurns = non scade. Un trigger OneShot si consuma alla
// prima reazione. Hidden = l'avversario non lo vede finché non scatta.
type Trigger struct {
	On             string `json:"on"`
	Do             string `json:"do"`
	Amount         int    `json:"amount"`
	RemainingTurns int    `json:"remaining_turns"`
	Hidden         bool   `json:"hidden,omitempty"`
	OneShot        bool   `json:"one_shot,omitempty"`
	SourceSpellID  string `json:"source_spell_id"`
}

// Aura è un effetto permanente attivo finché i propri pedoni sono almeno
// MinOwnPawns. Active è l'ultimo valore calcolato (per notificare i cambi).
type Aura struct {
	Grant         string `json:"grant"`
	MinOwnPawns   int    `json:"min_own_pawns"`
	Active        bool   `json:"active"`
	SourceSpellID string `json:"source_spell_id"`
}

// TickTriggers aggiorna le durate dei trigger alla fine di un turno e indica se
// qualcuno è scaduto. ownerFinished = il turno che si chiude è del proprietario.
func (ps *PlayerState) TickTriggers(ownerFinished bool) bool {
	expired := false
	kept := ps.Triggers[:0]
	for _, t := range ps.Triggers {
		if t.RemainingTurns != PermanentTurns {
			if !ownerFinished {
				t.RemainingTurns--
			}
			if t.RemainingTurns <= 0 {
				expired = true
				continue
			}
		}
		kept = append(kept, t)
	}
	ps.Triggers = kept
	return expired
}

// HasAura indica se il giocatore ha già un'aura con quel grant.
func (ps *PlayerState) HasAura(grant string) bool {
	for _, a := range ps.Auras {
		if a.Grant == grant {
			return true
		}
	}
	return false
}
