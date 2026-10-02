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

// Amici: GET /me/friends (F1–F3, A1–A3). Richieste, blocchi e ricerca sono in
// friendships.go; il segnale di presenza in challenges.go.

// AllFriends, finché vale true, rende sfidabili tutti gli utenti e mostra quelli
// che non sono amici veri in «others» (F1, A1). Con false restano solo gli
// amici veri.
var AllFriends = true

// MaxListed è il numero massimo di voci di «others» in GET /me/friends.
const MaxListed = 100

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
	Friends    []friendView `json:"friends"`
	Others     []friendView `json:"others"`
	Incoming   []friendView `json:"incoming"`
	Outgoing   []friendView `json:"outgoing"`
	Online     int          `json:"online"`
	MaxFriends int          `json:"max_friends"`
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

// hiddenPresence restituisce gli utenti che hanno nascosto il proprio stato:
// agli altri appaiono sempre offline (P6).
func hiddenPresence() map[int]bool {
	ids, err := db.Accounts().HiddenPresenceIDs()
	if err != nil {
		logger.L.Error("Errore lettura stati nascosti", zap.Error(err))
	}
	out := make(map[int]bool, len(ids))
	for _, id := range ids {
		out[id] = true
	}
	return out
}

// userStatuses restituisce lo stato degli utenti attivi: in partita vale più di
// online. Chi non c'è, o ha nascosto il proprio stato, è offline.
func userStatuses() map[int]string {
	hidden := hiddenPresence()
	out := map[int]string{}
	for _, id := range presence.Default.OnlineIDs() {
		if !hidden[id] {
			out[id] = StatusOnline
		}
	}
	for _, id := range playingIDs() {
		if !hidden[id] {
			out[id] = StatusPlaying
		}
	}
	return out
}

// hiddenFor restituisce gli utenti che userID non deve vedere: quelli che ha
// bloccato e quelli che l'hanno bloccato (A8).
func hiddenFor(userID int) ([]int, error) {
	store := db.Friends()
	blocked, err := store.Blocks(userID)
	if err != nil {
		return nil, err
	}
	blockers, err := store.BlockedBy(userID)
	if err != nil {
		return nil, err
	}
	return append(blocked, blockers...), nil
}

// blockedEither dice se fra a e b c'è un blocco, in una delle due direzioni.
func blockedEither(a, b int) (bool, error) {
	hidden, err := hiddenFor(a)
	if err != nil {
		return false, err
	}
	for _, id := range hidden {
		if id == b {
			return true, nil
		}
	}
	return false, nil
}

// isFriend dice se b è sfidabile da a: amici veri, oppure tutti finché vale
// AllFriends; mai con un blocco fra i due (A8).
func isFriend(a, b int) (bool, error) {
	if a == b {
		return false, nil
	}
	if blocked, err := blockedEither(a, b); err != nil || blocked {
		return false, err
	}
	if AllFriends {
		return true, nil
	}
	link, found, err := db.Friends().Link(a, b)
	return found && link.Status == db.LinkAccepted, err
}

// sortByStatus ordina online → in partita → offline, poi per nome.
func sortByStatus(list []friendView) {
	sort.SliceStable(list, func(i, j int) bool {
		a, b := list[i], list[j]
		if statusRank(a.Status) != statusRank(b.Status) {
			return statusRank(a.Status) < statusRank(b.Status)
		}
		return strings.ToLower(a.Username) < strings.ToLower(b.Username)
	})
}

// buildFriendList compone la risposta di GET /me/friends (e delle richieste).
func buildFriendList(userID int) (friendListView, error) {
	view := friendListView{Friends: []friendView{}, Others: []friendView{}, Incoming: []friendView{}, Outgoing: []friendView{}, MaxFriends: MaxFriendsPerUser}

	links, err := db.Friends().Links(userID)
	if err != nil {
		return view, err
	}
	hidden, err := hiddenFor(userID)
	if err != nil {
		return view, err
	}
	kind := map[int]string{} // altro utente → friend | incoming | outgoing
	ids := make([]int, 0, len(links))
	for _, l := range links {
		other := l.Other(userID)
		switch {
		case l.Status == db.LinkAccepted:
			kind[other] = relationFriend
		case l.Addressee == userID:
			kind[other] = relationIncoming
		default:
			kind[other] = relationOutgoing
		}
		ids = append(ids, other)
	}

	statuses := userStatuses()
	statusOf := func(id int) string {
		if s, found := statuses[id]; found {
			return s
		}
		return StatusOffline
	}
	users := db.Users()
	linked, err := users.UsersByIDs(ids)
	if err != nil {
		return view, err
	}
	for _, u := range linked {
		v := friendView{ID: u.ID, Username: u.Username, Elo: u.Elo, Status: statusOf(u.ID)}
		switch kind[u.ID] {
		case relationFriend:
			view.Friends = append(view.Friends, v)
		case relationIncoming:
			view.Incoming = append(view.Incoming, v)
		default:
			view.Outgoing = append(view.Outgoing, v)
		}
	}

	if AllFriends {
		exclude := append(append([]int{userID}, ids...), hidden...)
		active := make([]int, 0, len(statuses))
		for id := range statuses {
			active = append(active, id)
		}
		others, err := users.ListUsers(exclude, active, MaxListed)
		if err != nil {
			return view, err
		}
		for _, u := range others {
			view.Others = append(view.Others, friendView{ID: u.ID, Username: u.Username, Elo: u.Elo, Status: statusOf(u.ID)})
		}
	}

	for _, list := range [][]friendView{view.Friends, view.Others, view.Incoming, view.Outgoing} {
		sortByStatus(list)
	}
	for _, list := range [][]friendView{view.Friends, view.Others} {
		for _, f := range list {
			if f.Status == StatusOnline {
				view.Online++
			}
		}
	}
	return view, nil
}

// friendsDBFail registra l'errore e risponde 500.
func friendsDBFail(w http.ResponseWriter, userID int, err error) {
	logger.L.Error("Errore amici", zap.Int("user_id", userID), zap.Error(err))
	fail(w, http.StatusInternalServerError, msgDBError)
}

// replyFriendList risponde con la lista aggiornata (status 200 o 201).
func replyFriendList(w http.ResponseWriter, userID, status int) {
	view, err := buildFriendList(userID)
	if err != nil {
		friendsDBFail(w, userID, err)
		return
	}
	writeJSON(w, status, models.APIResponse{Success: true, Data: view})
}

// ListFriends gestisce GET /me/friends: amici veri, altri giocatori (solo con
// AllFriends), richieste ricevute e inviate, ognuno con lo stato.
func ListFriends(w http.ResponseWriter, r *http.Request) {
	userID, ok := userIDFrom(r)
	if !ok {
		fail(w, http.StatusUnauthorized, msgUnauthorized)
		return
	}
	replyFriendList(w, userID, http.StatusOK)
}
