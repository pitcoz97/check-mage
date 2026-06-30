package models

import "encoding/json"

type APIResponse struct {
	Success bool        `json:"success"`
	Data    interface{} `json:"data,omitempty"`
	Error   string      `json:"error,omitempty"`
}

type WSMessage struct {
	Type    string          `json:"type"`
	Payload json.RawMessage `json:"payload"` // RawMessage = JSON grezzo, decodificato dopo
}

// Tipi di messaggio possibili
const (
	MsgMove                 = "move"       // il giocatore ha fatto una mossa
	MsgGameState            = "game_state" // stato completo della board
	MsgGameOver             = "game_over"  // partita finita
	MsgError                = "error"      // errore
	MsgOpponentDisconnected = "opponent_disconnected"
	MsgDrawOffer            = "draw_offer"
	MsgDrawAccepted         = "draw_accepted"
	MsgDrawDeclined         = "draw_declined"
	MsgResign               = "resign"

	// Fasi del turno (scacchi + magie)
	MsgPassPhase    = "pass_phase"    // il giocatore passa alla fase successiva
	MsgPhaseChanged = "phase_changed" // notifica server→client di cambio fase/turno

	// Card game (scacchi + magie)
	MsgCastSpell       = "cast_spell"        // client→server: gioca una magia
	MsgSpellCast       = "spell_cast"        // server→client: magia giocata (broadcast)
	MsgHand            = "hand"              // server→client: mano completa (solo al proprietario)
	MsgCardDrawn       = "card_drawn"        // server→client: carta pescata (solo a chi pesca)
	MsgHandSizeChanged = "hand_size_changed" // server→client: cambio dimensione mano (broadcast)
	MsgManaChanged     = "mana_changed"      // server→client: cambio mana (broadcast)

	// Risultati partita
	ResultWhiteWins = "1-0"
	ResultBlackWins = "0-1"
	ResultDraw      = "1/2-1/2"
)
