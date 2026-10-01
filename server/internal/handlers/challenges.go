package handlers

import (
	"chess-server/internal/db"
	"chess-server/internal/game"
	"chess-server/internal/logger"
	"chess-server/internal/models"
	"chess-server/internal/presence"
	"encoding/json"
	"errors"
	"net/http"

	"github.com/go-chi/chi/v5"
	"go.uber.org/zap"
)

// Sfide dirette: POST /me/challenges, DELETE /me/challenges/{id} e il segnale
// di presenza POST /me/presence, che porta le sfide ricevute (F2–F7). La
// partita parte su /ws?challenge=<id> (game/challenges.go).

// Testi degli errori delle sfide: il client ricava il codice dal testo.
const (
	msgChallengeSelf       = "Non puoi sfidare te stesso"
	msgChallengeNoPlayer   = "Giocatore non trovato"
	msgChallengeOffline    = "Il giocatore non è online"
	msgChallengeTargetBusy = "Il giocatore è in partita"
	msgChallengeSelfBusy   = "Sei già in partita"
	msgChallengeNotFound   = "Sfida non trovata"
)

// inMatch dice se l'utente è in partita; i test la sostituiscono.
var inMatch = func(userID int) bool { return game.GameManager.InMatch(userID) }

type challengeRequest struct {
	To int `json:"to"`
}

type presenceView struct {
	Incoming       []game.ChallengeView `json:"incoming"`
	FriendRequests int                  `json:"friend_requests"` // richieste d'amicizia ricevute, per il badge (A6)
}

func challengePlayer(u db.UserSummary) game.ChallengePlayer {
	return game.ChallengePlayer{ID: u.ID, Username: u.Username, Elo: u.Elo}
}

// Presence gestisce POST /me/presence: il segnale «sono online» che il client
// manda ogni ~5 s (F2). Risponde con le sfide ricevute ancora aperte e il
// numero di richieste d'amicizia ricevute.
func Presence(w http.ResponseWriter, r *http.Request) {
	userID, ok := userIDFrom(r)
	if !ok {
		fail(w, http.StatusUnauthorized, msgUnauthorized)
		return
	}
	presence.Default.Touch(userID)
	requests, err := incomingCount(userID)
	if err != nil {
		friendsDBFail(w, userID, err)
		return
	}
	writeJSON(w, http.StatusOK, models.APIResponse{
		Success: true,
		Data:    presenceView{Incoming: game.GameManager.IncomingChallenges(userID), FriendRequests: requests},
	})
}

// CreateChallenge gestisce POST /me/challenges {to}: sfida un amico online che
// non è in partita. Una sfida precedente di chi chiama viene sostituita (F5).
func CreateChallenge(w http.ResponseWriter, r *http.Request) {
	userID, ok := userIDFrom(r)
	if !ok {
		fail(w, http.StatusUnauthorized, msgUnauthorized)
		return
	}
	var req challengeRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil || req.To <= 0 {
		fail(w, http.StatusBadRequest, msgInvalidBody)
		return
	}
	if req.To == userID {
		fail(w, http.StatusBadRequest, msgChallengeSelf)
		return
	}
	friend, err := isFriend(userID, req.To)
	if err != nil {
		challengeDBFail(w, userID, err)
		return
	}
	if !friend {
		fail(w, http.StatusNotFound, msgChallengeNoPlayer)
		return
	}

	users := db.Users()
	target, found, err := users.User(req.To)
	if err != nil {
		challengeDBFail(w, userID, err)
		return
	}
	if !found {
		fail(w, http.StatusNotFound, msgChallengeNoPlayer)
		return
	}
	me, found, err := users.User(userID)
	if err != nil {
		challengeDBFail(w, userID, err)
		return
	}
	if !found {
		fail(w, http.StatusUnauthorized, msgUnauthorized)
		return
	}
	createChallenge(w, me, target)
}

func challengeDBFail(w http.ResponseWriter, userID int, err error) {
	logger.L.Error("Errore lettura utenti per la sfida", zap.Int("user_id", userID), zap.Error(err))
	fail(w, http.StatusInternalServerError, msgDBError)
}

// createChallenge controlla lo stato dei due giocatori e apre la sfida.
func createChallenge(w http.ResponseWriter, me, target db.UserSummary) {
	switch {
	case inMatch(me.ID):
		fail(w, http.StatusConflict, msgChallengeSelfBusy)
		return
	case inMatch(target.ID):
		fail(w, http.StatusConflict, msgChallengeTargetBusy)
		return
	case !presence.Default.Online(target.ID):
		fail(w, http.StatusConflict, msgChallengeOffline)
		return
	}

	view, err := game.GameManager.CreateChallenge(challengePlayer(me), challengePlayer(target))
	switch {
	case errors.Is(err, game.ErrChallengerBusy):
		fail(w, http.StatusConflict, msgChallengeSelfBusy)
		return
	case errors.Is(err, game.ErrTargetBusy):
		fail(w, http.StatusConflict, msgChallengeTargetBusy)
		return
	}
	presence.Default.Touch(me.ID)
	writeJSON(w, http.StatusCreated, models.APIResponse{Success: true, Data: view})
}

// DeleteChallenge gestisce DELETE /me/challenges/{id}: chi sfida annulla, lo
// sfidato rifiuta (F6).
func DeleteChallenge(w http.ResponseWriter, r *http.Request) {
	userID, ok := userIDFrom(r)
	if !ok {
		fail(w, http.StatusUnauthorized, msgUnauthorized)
		return
	}
	if err := game.GameManager.CancelChallenge(userID, chi.URLParam(r, "id")); err != nil {
		fail(w, http.StatusNotFound, msgChallengeNotFound)
		return
	}
	writeJSON(w, http.StatusOK, models.APIResponse{Success: true})
}
