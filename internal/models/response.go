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

	// Risultati partita
	ResultWhiteWins = "1-0"
	ResultBlackWins = "0-1"
	ResultDraw      = "1/2-1/2"
)
