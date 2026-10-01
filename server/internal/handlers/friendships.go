package handlers

import (
	"chess-server/internal/db"
	"chess-server/internal/game"
	"chess-server/internal/models"
	"encoding/json"
	"net/http"
	"strconv"
	"strings"

	"github.com/go-chi/chi/v5"
)

// Amicizie vere (A1–A10): richieste, accetta, rifiuta, annulla, rimuovi,
// ricerca per nome e blocchi. Le mutazioni delle amicizie rispondono con la
// lista di GET /me/friends, quelle dei blocchi con la lista dei bloccati.

// Limiti (A9).
const (
	MaxFriendsPerUser = 200
	MaxPendingOut     = 50
	MaxSearchResults  = 20
	MinSearchLength   = 2
)

// Relazioni con un altro utente (ricerca, A5).
const (
	relationNone     = "none"
	relationFriend   = "friend"
	relationIncoming = "incoming"
	relationOutgoing = "outgoing"
)

// Testi degli errori delle amicizie: il client ricava il codice dal testo.
const (
	msgFriendSelf          = "Non puoi aggiungere te stesso"
	msgFriendAlready       = "Siete già amici"
	msgFriendPending       = "Richiesta già inviata"
	msgFriendLimit         = "Hai raggiunto il numero massimo di amici"
	msgFriendTheirLimit    = "Il giocatore ha raggiunto il numero massimo di amici"
	msgFriendPendingLimit  = "Hai troppe richieste in sospeso"
	msgFriendRequestAbsent = "Richiesta non trovata"
	msgFriendAbsent        = "Amico non trovato"
	msgBlockSelf           = "Non puoi bloccare te stesso"
	msgBlockAbsent         = "Giocatore non bloccato"
	msgSearchShort         = "Ricerca troppo corta"
)

// requestState è ciò che serve per decidere una richiesta d'amicizia.
type requestState struct {
	Me           int
	To           int
	Exists       bool // l'utente To esiste
	Blocked      bool // c'è un blocco fra i due, in una delle due direzioni
	Link         *db.FriendLink
	MyFriends    int
	TheirFriends int
	MyPendingOut int
}

// Esiti di una richiesta.
const (
	planRequest = "request" // nuova richiesta
	planAccept  = "accept"  // To aveva già chiesto: diventate amici (A3)
)

// planFriendRequest decide una richiesta d'amicizia (A2–A3, A8–A9): l'esito,
// oppure lo status e il testo dell'errore.
func planFriendRequest(s requestState) (plan string, status int, msg string) {
	switch {
	case s.Me == s.To:
		return "", http.StatusBadRequest, msgFriendSelf
	case !s.Exists || s.Blocked:
		// Chi ti ha bloccato non deve accorgersene: la risposta è la stessa di un utente inesistente.
		return "", http.StatusNotFound, msgChallengeNoPlayer
	case s.Link != nil && s.Link.Status == db.LinkAccepted:
		return "", http.StatusConflict, msgFriendAlready
	case s.Link != nil && s.Link.Requester == s.Me:
		return "", http.StatusConflict, msgFriendPending
	case s.MyFriends >= MaxFriendsPerUser:
		return "", http.StatusConflict, msgFriendLimit
	case s.TheirFriends >= MaxFriendsPerUser:
		return "", http.StatusConflict, msgFriendTheirLimit
	case s.Link != nil:
		return planAccept, 0, ""
	case s.MyPendingOut >= MaxPendingOut:
		return "", http.StatusConflict, msgFriendPendingLimit
	}
	return planRequest, 0, ""
}

// linkCounts conta amici e richieste inviate in sospeso di un utente.
func linkCounts(userID int) (friends, pendingOut int, err error) {
	links, err := db.Friends().Links(userID)
	if err != nil {
		return 0, 0, err
	}
	for _, l := range links {
		switch {
		case l.Status == db.LinkAccepted:
			friends++
		case l.Requester == userID:
			pendingOut++
		}
	}
	return friends, pendingOut, nil
}

// incomingCount conta le richieste ricevute in sospeso (badge, A6).
func incomingCount(userID int) (int, error) {
	links, err := db.Friends().Links(userID)
	if err != nil {
		return 0, err
	}
	n := 0
	for _, l := range links {
		if l.Status == db.LinkPending && l.Addressee == userID {
			n++
		}
	}
	return n, nil
}

// pathUserID legge l'id utente dal percorso.
func pathUserID(r *http.Request) (int, bool) {
	id, err := strconv.Atoi(chi.URLParam(r, "id"))
	return id, err == nil && id > 0
}

// RequestFriend gestisce POST /me/friends/requests {to}: nuova richiesta, o
// amicizia subito se l'altro aveva già chiesto (A3).
func RequestFriend(w http.ResponseWriter, r *http.Request) {
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

	state := requestState{Me: userID, To: req.To}
	if req.To != userID {
		var err error
		if _, state.Exists, err = db.Users().User(req.To); err != nil {
			friendsDBFail(w, userID, err)
			return
		}
		if state.Blocked, err = blockedEither(userID, req.To); err != nil {
			friendsDBFail(w, userID, err)
			return
		}
		link, found, err := db.Friends().Link(userID, req.To)
		if err != nil {
			friendsDBFail(w, userID, err)
			return
		}
		if found {
			state.Link = &link
		}
		if state.MyFriends, state.MyPendingOut, err = linkCounts(userID); err != nil {
			friendsDBFail(w, userID, err)
			return
		}
		if state.TheirFriends, _, err = linkCounts(req.To); err != nil {
			friendsDBFail(w, userID, err)
			return
		}
	}

	plan, status, msg := planFriendRequest(state)
	var err error
	switch plan {
	case planAccept:
		_, err = db.Friends().Accept(req.To, userID)
	case planRequest:
		err = db.Friends().Request(userID, req.To)
	default:
		fail(w, status, msg)
		return
	}
	if err != nil {
		friendsDBFail(w, userID, err)
		return
	}
	replyFriendList(w, userID, http.StatusCreated)
}

// AcceptFriend gestisce POST /me/friends/requests/{id}/accept: accetta la
// richiesta ricevuta dall'utente id.
func AcceptFriend(w http.ResponseWriter, r *http.Request) {
	userID, ok := userIDFrom(r)
	if !ok {
		fail(w, http.StatusUnauthorized, msgUnauthorized)
		return
	}
	other, ok := pathUserID(r)
	if !ok {
		fail(w, http.StatusNotFound, msgFriendRequestAbsent)
		return
	}
	link, found, err := db.Friends().Link(userID, other)
	if err != nil {
		friendsDBFail(w, userID, err)
		return
	}
	if !found || link.Status != db.LinkPending || link.Addressee != userID {
		fail(w, http.StatusNotFound, msgFriendRequestAbsent)
		return
	}
	mine, _, err := linkCounts(userID)
	if err != nil {
		friendsDBFail(w, userID, err)
		return
	}
	theirs, _, err := linkCounts(other)
	if err != nil {
		friendsDBFail(w, userID, err)
		return
	}
	switch {
	case mine >= MaxFriendsPerUser:
		fail(w, http.StatusConflict, msgFriendLimit)
		return
	case theirs >= MaxFriendsPerUser:
		fail(w, http.StatusConflict, msgFriendTheirLimit)
		return
	}
	if _, err := db.Friends().Accept(other, userID); err != nil {
		friendsDBFail(w, userID, err)
		return
	}
	replyFriendList(w, userID, http.StatusOK)
}

// deleteLink toglie il legame con l'utente del percorso se ha lo stato atteso.
func deleteLink(w http.ResponseWriter, r *http.Request, status, absent string) {
	userID, ok := userIDFrom(r)
	if !ok {
		fail(w, http.StatusUnauthorized, msgUnauthorized)
		return
	}
	other, ok := pathUserID(r)
	if !ok {
		fail(w, http.StatusNotFound, absent)
		return
	}
	link, found, err := db.Friends().Link(userID, other)
	if err != nil {
		friendsDBFail(w, userID, err)
		return
	}
	if !found || link.Status != status {
		fail(w, http.StatusNotFound, absent)
		return
	}
	if _, err := db.Friends().DeleteLink(userID, other); err != nil {
		friendsDBFail(w, userID, err)
		return
	}
	replyFriendList(w, userID, http.StatusOK)
}

// DeleteFriendRequest gestisce DELETE /me/friends/requests/{id}: rifiuta la
// richiesta ricevuta da id, o annulla quella inviata a id (A4).
func DeleteFriendRequest(w http.ResponseWriter, r *http.Request) {
	deleteLink(w, r, db.LinkPending, msgFriendRequestAbsent)
}

// RemoveFriend gestisce DELETE /me/friends/{id}: toglie l'amicizia (A4).
func RemoveFriend(w http.ResponseWriter, r *http.Request) {
	deleteLink(w, r, db.LinkAccepted, msgFriendAbsent)
}

type searchResultView struct {
	ID       int    `json:"id"`
	Username string `json:"username"`
	Elo      int    `json:"elo"`
	Relation string `json:"relation"`
}

// SearchUsers gestisce GET /users/search?q=: i giocatori il cui nome contiene q
// (almeno 2 caratteri), tranne se stessi e i blocchi, con la relazione (A5).
func SearchUsers(w http.ResponseWriter, r *http.Request) {
	userID, ok := userIDFrom(r)
	if !ok {
		fail(w, http.StatusUnauthorized, msgUnauthorized)
		return
	}
	q := strings.TrimSpace(r.URL.Query().Get("q"))
	if len([]rune(q)) < MinSearchLength {
		fail(w, http.StatusBadRequest, msgSearchShort)
		return
	}
	hidden, err := hiddenFor(userID)
	if err != nil {
		friendsDBFail(w, userID, err)
		return
	}
	links, err := db.Friends().Links(userID)
	if err != nil {
		friendsDBFail(w, userID, err)
		return
	}
	relation := map[int]string{}
	for _, l := range links {
		switch {
		case l.Status == db.LinkAccepted:
			relation[l.Other(userID)] = relationFriend
		case l.Addressee == userID:
			relation[l.Other(userID)] = relationIncoming
		default:
			relation[l.Other(userID)] = relationOutgoing
		}
	}
	users, err := db.Users().Search(q, append([]int{userID}, hidden...), MaxSearchResults)
	if err != nil {
		friendsDBFail(w, userID, err)
		return
	}
	out := make([]searchResultView, 0, len(users))
	for _, u := range users {
		rel, found := relation[u.ID]
		if !found {
			rel = relationNone
		}
		out = append(out, searchResultView{ID: u.ID, Username: u.Username, Elo: u.Elo, Relation: rel})
	}
	writeJSON(w, http.StatusOK, models.APIResponse{Success: true, Data: out})
}

type blockedView struct {
	ID       int    `json:"id"`
	Username string `json:"username"`
}

type blockRequest struct {
	UserID int `json:"user_id"`
}

// replyBlocks risponde con i bloccati, dal più recente.
func replyBlocks(w http.ResponseWriter, userID int) {
	ids, err := db.Friends().Blocks(userID)
	if err != nil {
		friendsDBFail(w, userID, err)
		return
	}
	users, err := db.Users().UsersByIDs(ids)
	if err != nil {
		friendsDBFail(w, userID, err)
		return
	}
	names := map[int]string{}
	for _, u := range users {
		names[u.ID] = u.Username
	}
	out := make([]blockedView, 0, len(ids))
	for _, id := range ids {
		if name, found := names[id]; found {
			out = append(out, blockedView{ID: id, Username: name})
		}
	}
	writeJSON(w, http.StatusOK, models.APIResponse{Success: true, Data: out})
}

// ListBlocks gestisce GET /me/blocks.
func ListBlocks(w http.ResponseWriter, r *http.Request) {
	userID, ok := userIDFrom(r)
	if !ok {
		fail(w, http.StatusUnauthorized, msgUnauthorized)
		return
	}
	replyBlocks(w, userID)
}

// BlockUser gestisce POST /me/blocks {user_id}: toglie amicizia e richieste,
// chiude le sfide aperte fra i due e nasconde l'uno all'altro (A8).
func BlockUser(w http.ResponseWriter, r *http.Request) {
	userID, ok := userIDFrom(r)
	if !ok {
		fail(w, http.StatusUnauthorized, msgUnauthorized)
		return
	}
	var req blockRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil || req.UserID <= 0 {
		fail(w, http.StatusBadRequest, msgInvalidBody)
		return
	}
	if req.UserID == userID {
		fail(w, http.StatusBadRequest, msgBlockSelf)
		return
	}
	_, found, err := db.Users().User(req.UserID)
	if err != nil {
		friendsDBFail(w, userID, err)
		return
	}
	if !found {
		fail(w, http.StatusNotFound, msgChallengeNoPlayer)
		return
	}
	if err := db.Friends().Block(userID, req.UserID); err != nil {
		friendsDBFail(w, userID, err)
		return
	}
	game.GameManager.CloseChallengesBetween(userID, req.UserID)
	replyBlocks(w, userID)
}

// UnblockUser gestisce DELETE /me/blocks/{id}.
func UnblockUser(w http.ResponseWriter, r *http.Request) {
	userID, ok := userIDFrom(r)
	if !ok {
		fail(w, http.StatusUnauthorized, msgUnauthorized)
		return
	}
	other, ok := pathUserID(r)
	if !ok {
		fail(w, http.StatusNotFound, msgBlockAbsent)
		return
	}
	removed, err := db.Friends().Unblock(userID, other)
	if err != nil {
		friendsDBFail(w, userID, err)
		return
	}
	if !removed {
		fail(w, http.StatusNotFound, msgBlockAbsent)
		return
	}
	replyBlocks(w, userID)
}
