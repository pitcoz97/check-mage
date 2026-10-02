package handlers

import (
	"chess-server/internal/db"
	"chess-server/internal/game"
	"chess-server/internal/logger"
	"chess-server/internal/models"
	"chess-server/internal/presence"
	"chess-server/internal/spells"
	"encoding/json"
	"net/http"
	"time"

	"go.uber.org/zap"
	"golang.org/x/crypto/bcrypt"
)

// Privacy e conformità (P1–P10): termini accettati, stato online nascosto,
// cancellazione dell'account (anonimizzazione) ed esportazione dei dati.

// TermsVersion è la versione corrente di Informativa e Termini: si alza quando
// cambiano, e chi ha accettato una versione precedente deve riaccettare (P2).
// Il client ha la stessa costante (client/src/legal/config.ts).
const TermsVersion = 1

// Testi degli errori: il client ricava il codice dal testo.
const (
	msgConsentRequired = "Devi accettare i termini e confermare di avere almeno 14 anni"
	msgTermsVersion    = "Versione dei termini non valida"
	msgWrongPassword   = "Password non corretta"
	msgAccountAbsent   = "Account non trovato"
)

type accountJSON struct {
	ID              int    `json:"id"`
	Username        string `json:"username"`
	Email           string `json:"email"`
	Elo             int    `json:"elo"`
	CreatedAt       string `json:"created_at,omitempty"`
	TermsVersion    int    `json:"terms_version"`
	TermsCurrent    int    `json:"terms_current"`
	TermsAcceptedAt string `json:"terms_accepted_at,omitempty"`
	HidePresence    bool   `json:"hide_presence"`
}

func accountView(a db.Account) accountJSON {
	view := accountJSON{
		ID:           a.ID,
		Username:     a.Username,
		Email:        a.Email,
		Elo:          a.Elo,
		CreatedAt:    a.CreatedAt,
		TermsVersion: a.TermsVersion,
		TermsCurrent: TermsVersion,
		HidePresence: a.HidePresence,
	}
	if a.TermsAcceptedAt != nil {
		view.TermsAcceptedAt = a.TermsAcceptedAt.UTC().Format(time.RFC3339)
	}
	return view
}

func privacyDBFail(w http.ResponseWriter, userID int, err error) {
	logger.L.Error("Errore account", zap.Int("user_id", userID), zap.Error(err))
	fail(w, http.StatusInternalServerError, msgDBError)
}

// replyAccount risponde con l'account dell'utente, o 404 se è stato cancellato.
func replyAccount(w http.ResponseWriter, userID int) {
	account, found, err := db.Accounts().Account(userID)
	if err != nil {
		privacyDBFail(w, userID, err)
		return
	}
	if !found {
		fail(w, http.StatusNotFound, msgAccountAbsent)
		return
	}
	writeJSON(w, http.StatusOK, models.APIResponse{Success: true, Data: accountView(account)})
}

// AcceptTerms gestisce POST /me/terms {version}: accetta la versione corrente
// di Informativa e Termini (P2).
func AcceptTerms(w http.ResponseWriter, r *http.Request) {
	userID, ok := userIDFrom(r)
	if !ok {
		fail(w, http.StatusUnauthorized, msgUnauthorized)
		return
	}
	var req struct {
		Version int `json:"version"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		fail(w, http.StatusBadRequest, msgInvalidBody)
		return
	}
	if req.Version != TermsVersion {
		fail(w, http.StatusConflict, msgTermsVersion)
		return
	}
	if err := db.Accounts().AcceptTerms(userID, TermsVersion); err != nil {
		privacyDBFail(w, userID, err)
		return
	}
	replyAccount(w, userID)
}

// UpdatePrivacy gestisce PUT /me/privacy {hide_presence}: con lo stato
// nascosto l'utente appare sempre offline agli altri (P6).
func UpdatePrivacy(w http.ResponseWriter, r *http.Request) {
	userID, ok := userIDFrom(r)
	if !ok {
		fail(w, http.StatusUnauthorized, msgUnauthorized)
		return
	}
	var req struct {
		HidePresence *bool `json:"hide_presence"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil || req.HidePresence == nil {
		fail(w, http.StatusBadRequest, msgInvalidBody)
		return
	}
	if err := db.Accounts().SetHidePresence(userID, *req.HidePresence); err != nil {
		privacyDBFail(w, userID, err)
		return
	}
	replyAccount(w, userID)
}

// DeleteAccount gestisce DELETE /me {password}: dopo la password e fuori dalle
// partite, cancella mazzi, collezione, amicizie e blocchi e rende anonimo
// l'utente; chiude le sue sfide e lo toglie dalla presenza (P3).
func DeleteAccount(w http.ResponseWriter, r *http.Request) {
	userID, ok := userIDFrom(r)
	if !ok {
		fail(w, http.StatusUnauthorized, msgUnauthorized)
		return
	}
	var req struct {
		Password string `json:"password"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil || req.Password == "" {
		fail(w, http.StatusBadRequest, msgInvalidBody)
		return
	}
	account, found, err := db.Accounts().Account(userID)
	if err != nil {
		privacyDBFail(w, userID, err)
		return
	}
	if !found {
		fail(w, http.StatusNotFound, msgAccountAbsent)
		return
	}
	if bcrypt.CompareHashAndPassword([]byte(account.PasswordHash), []byte(req.Password)) != nil {
		fail(w, http.StatusForbidden, msgWrongPassword)
		return
	}
	if inMatch(userID) {
		fail(w, http.StatusConflict, msgChallengeSelfBusy)
		return
	}
	if err := db.Accounts().Delete(userID); err != nil {
		privacyDBFail(w, userID, err)
		return
	}
	game.GameManager.CloseChallengesOf(userID)
	presence.Default.Forget(userID)
	logger.L.Info("Account cancellato", zap.Int("user_id", userID))
	writeJSON(w, http.StatusOK, models.APIResponse{Success: true})
}

type exportCardView struct {
	SpellID string `json:"spell_id"`
	Copies  int    `json:"copies"`
}

type exportView struct {
	ExportedAt string           `json:"exported_at"`
	Account    accountJSON      `json:"account"`
	Collection []exportCardView `json:"collection"`
	Decks      []deckView       `json:"decks"`
	Games      []db.GameRecord  `json:"games"`
	Friends    friendListView   `json:"friends"`
	Blocked    []blockedView    `json:"blocked"`
}

// ExportData gestisce GET /me/export: tutti i dati dell'utente in un JSON
// (portabilità, P5). La collezione è quella salvata, non quella sbloccata.
func ExportData(w http.ResponseWriter, r *http.Request) {
	userID, ok := userIDFrom(r)
	if !ok {
		fail(w, http.StatusUnauthorized, msgUnauthorized)
		return
	}
	account, found, err := db.Accounts().Account(userID)
	if err != nil || !found {
		if err != nil {
			privacyDBFail(w, userID, err)
		} else {
			fail(w, http.StatusNotFound, msgAccountAbsent)
		}
		return
	}

	saved, err := db.LoadCollection(userID, spells.StarterSet())
	if err != nil {
		privacyDBFail(w, userID, err)
		return
	}
	collection := make([]exportCardView, 0, len(saved))
	for _, entry := range spells.Collection(saved).Cards {
		if entry.Copies > 0 {
			collection = append(collection, exportCardView{SpellID: entry.SpellID, Copies: entry.Copies})
		}
	}

	rows, owned, err := userDecks(userID)
	if err != nil {
		privacyDBFail(w, userID, err)
		return
	}
	decks := make([]deckView, 0, len(rows))
	for _, row := range rows {
		decks = append(decks, toView(row, owned))
	}

	games, err := db.Accounts().Games(userID)
	if err != nil {
		privacyDBFail(w, userID, err)
		return
	}
	friends, err := buildFriendList(userID)
	if err != nil {
		privacyDBFail(w, userID, err)
		return
	}
	friends.Others = []friendView{} // gli altri giocatori non sono dati dell'utente
	blocked, err := blockList(userID)
	if err != nil {
		privacyDBFail(w, userID, err)
		return
	}

	writeJSON(w, http.StatusOK, models.APIResponse{Success: true, Data: exportView{
		ExportedAt: time.Now().UTC().Format(time.RFC3339),
		Account:    accountView(account),
		Collection: collection,
		Decks:      decks,
		Games:      games,
		Friends:    friends,
		Blocked:    blocked,
	}})
}
