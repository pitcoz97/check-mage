package phase

type ActionKind string

const (
	ActionPassPhase ActionKind = "pass_phase"
	ActionMakeMove  ActionKind = "make_move"
	ActionCastSpell ActionKind = "cast_spell"
	ActionResign    ActionKind = "resign"
	ActionOfferDraw ActionKind = "offer_draw"
)

// AllowedActions restituisce le azioni legali in una data fase
// per il giocatore di turno.
func AllowedActions(p Phase) map[ActionKind]bool {
	switch p {
	case PhaseDraw:
		// La pesca è automatica all'ingresso della fase.
		// Il giocatore può solo passare (o resign/draw).
		return map[ActionKind]bool{
			ActionPassPhase: true,
			ActionResign:    true,
			ActionOfferDraw: true,
		}
	case PhaseMain1:
		return map[ActionKind]bool{
			ActionPassPhase: true,
			ActionCastSpell: true,
			ActionResign:    true,
			ActionOfferDraw: true,
		}
	case PhaseMove:
		return map[ActionKind]bool{
			ActionMakeMove:  true, // obbligatoria, niente pass
			ActionResign:    true,
			ActionOfferDraw: true,
		}
	case PhaseMain2:
		return map[ActionKind]bool{
			ActionPassPhase: true,
			ActionCastSpell: true,
			ActionResign:    true,
			ActionOfferDraw: true,
		}
	case PhaseEndTurn:
		// Fase di transizione, gestita lato server (trigger end-of-turn).
		// Il client non dovrebbe mai mandare azioni qui.
		return map[ActionKind]bool{}
	}
	return map[ActionKind]bool{}
}

func IsAllowed(p Phase, a ActionKind) bool {
	return AllowedActions(p)[a]
}
