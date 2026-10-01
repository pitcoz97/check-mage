package handlers

import (
	"chess-server/internal/db"
	"chess-server/internal/game"
	"chess-server/internal/logger"
	"chess-server/internal/models"
	"chess-server/internal/presence"
	"net/http"
	"sort"
	"strings"

	"go.uber.org/zap"
)

// Amici: GET /me/friends (F1–F3). Il segnale di presenza è in challenges.go.

// AllFriends, finché vale true, rende amici tutti gli utenti fra loro: i
// giocatori sono pochi e così si vede chi è online (F1). Con false la lista è
// vuota finché non ci saranno le amicizie vere (richieste, tabella).
var AllFriends = true

// MaxFriends è il numero massimo di voci di GET /me/friends.
const MaxFriends = 100

// Stati di un amico.
const (
	StatusOnline  = "online"
	StatusPlaying = "playing"
	StatusOffline = "offline"
)

// playingIDs restituisce gli utenti in partita; i test la sostituiscono.
var playingIDs = func() []int { return game.GameManager.PlayingIDs() }

type friendView struct {
	ID       int    `json:"id"`
	Username string `json:"username"`
	Elo      int    `json:"elo"`
	Status   string `json:"status"`
}

type friendListView struct {
	Friends []friendView `json:"friends"`
	Online  int          `json:"online"`
}

// statusRank ordina gli stati: online, in partita, offline.
func statusRank(status string) int {
	switch status {
	case StatusOnline:
		return 0
	case StatusPlaying:
		return 1
	default:
		return 2
	}
}

// userStatuses restituisce lo stato degli utenti attivi: in partita vale più di
// online. Chi non c'è è offline.
func userStatuses() map[int]string {
	out := map[int]string{}
	for _, id := range presence.Default.OnlineIDs() {
		out[id] = StatusOnline
	}
	for _, id := range playingIDs() {
		out[id] = StatusPlaying
	}
	return out
}

// isFriend dice se due utenti sono amici (F1: con AllFriends lo sono tutti).
func isFriend(userID, otherID int) bool {
	return AllFriends && userID != otherID
}

// ListFriends gestisce GET /me/friends: gli amici con il loro stato, prima gli
// online, poi quelli in partita, poi gli offline; a parità per nome.
func ListFriends(w http.ResponseWriter, r *http.Request) {
	userID, ok := userIDFrom(r)
	if !ok {
		fail(w, http.StatusUnauthorized, msgUnauthorized)
		return
	}

	view := friendListView{Friends: []friendView{}}
	if !AllFriends {
		writeJSON(w, http.StatusOK, models.APIResponse{Success: true, Data: view})
		return
	}

	statuses := userStatuses()
	active := make([]int, 0, len(statuses))
	for id := range statuses {
		active = append(active, id)
	}
	users, err := db.Users().ListUsers(userID, active, MaxFriends)
	if err != nil {
		logger.L.Error("Errore lettura amici", zap.Int("user_id", userID), zap.Error(err))
		fail(w, http.StatusInternalServerError, msgDBError)
		return
	}

	for _, u := range users {
		status, found := statuses[u.ID]
		if !found {
			status = StatusOffline
		}
		if status == StatusOnline {
			view.Online++
		}
		view.Friends = append(view.Friends, friendView{ID: u.ID, Username: u.Username, Elo: u.Elo, Status: status})
	}
	sort.SliceStable(view.Friends, func(i, j int) bool {
		a, b := view.Friends[i], view.Friends[j]
		if statusRank(a.Status) != statusRank(b.Status) {
			return statusRank(a.Status) < statusRank(b.Status)
		}
		return strings.ToLower(a.Username) < strings.ToLower(b.Username)
	})

	writeJSON(w, http.StatusOK, models.APIResponse{Success: true, Data: view})
}
