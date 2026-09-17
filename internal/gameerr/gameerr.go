// Package gameerr definisce gli errori di gioco con un codice leggibile dalla
// macchina. Il messaggio resta testo libero (in italiano) per i log e il debug;
// il client deve basarsi solo su Code (e Details), mai sul testo.
package gameerr

import (
	"errors"
	"fmt"
)

// Code è il codice stabile di un errore, inviato al client nel payload `error`.
type Code string

const (
	// Protocollo
	InvalidPayload     Code = "invalid_payload"      // JSON o payload malformato
	UnknownMessageType Code = "unknown_message_type" // `type` non gestito
	RateLimited        Code = "rate_limited"         // troppi messaggi al secondo

	// Stato della partita / coda
	GameOver                Code = "game_over"                  // la partita è già terminata
	ReplacedByNewConnection Code = "replaced_by_new_connection" // un'altra connessione dello stesso utente ha preso il posto di questa

	// Turno e fasi
	NotYourTurn Code = "not_your_turn"
	WrongPhase  Code = "wrong_phase" // details: phase

	// Mosse
	IllegalMove Code = "illegal_move" // details: move
	PieceFrozen Code = "piece_frozen" // details: square

	// Magie
	UnknownSpell       Code = "unknown_spell"        // details: spell_id
	CardNotInHand      Code = "card_not_in_hand"     // details: spell_id
	InsufficientMana   Code = "insufficient_mana"    // details: needed, available
	InvalidTargetCount Code = "invalid_target_count" // details: expected, received
	InvalidTarget      Code = "invalid_target"       // casella non valida, vuota, pezzo del colore sbagliato, re…
	IllegalPosition    Code = "illegal_position"     // l'effetto lascerebbe un re sotto scacco in modo illegale

	// Patta
	DrawOfferPending Code = "draw_offer_pending"
	NoDrawOffer      Code = "no_draw_offer"
	OwnDrawOffer     Code = "own_draw_offer"

	// Fallback
	Internal Code = "internal_error"
)

// Error è un errore di gioco con codice e dettagli opzionali.
type Error struct {
	Code    Code
	Message string
	Details map[string]interface{}
}

func (e *Error) Error() string { return e.Message }

// New crea un errore con codice e messaggio.
func New(code Code, message string) *Error {
	return &Error{Code: code, Message: message}
}

// Newf crea un errore con codice e messaggio formattato.
func Newf(code Code, format string, args ...interface{}) *Error {
	return &Error{Code: code, Message: fmt.Sprintf(format, args...)}
}

// With aggiunge un dettaglio all'errore e lo restituisce (concatenabile).
func (e *Error) With(key string, value interface{}) *Error {
	if e.Details == nil {
		e.Details = make(map[string]interface{})
	}
	e.Details[key] = value
	return e
}

// From estrae l'errore di gioco da una catena di errori. Un errore senza codice
// diventa Internal, conservando il messaggio.
func From(err error) *Error {
	var ge *Error
	if errors.As(err, &ge) {
		return ge
	}
	return &Error{Code: Internal, Message: err.Error()}
}
