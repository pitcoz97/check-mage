package handlers

import (
	"bytes"
	"chess-server/internal/db"
	"chess-server/internal/game"
	"chess-server/internal/models"
	"chess-server/internal/presence"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"

	"golang.org/x/crypto/bcrypt"
)

// privacySetup: gli utenti di friendsSetup come account in memoria, con la
// password "Password1" (bcrypt al costo minimo, per la velocità dei test).
func privacySetup(t *testing.T, hidden ...int) {
	t.Helper()
	challengeSetup(t)
	hash, err := bcrypt.GenerateFromPassword([]byte("Password1"), bcrypt.MinCost)
	if err != nil {
		t.Fatal(err)
	}
	isHidden := map[int]bool{}
	for _, id := range hidden {
		isHidden[id] = true
	}
	accounts := []db.Account{}
	for _, u := range []db.UserSummary{{ID: 5, Username: "io", Elo: 1200}, {ID: 6, Username: "zeta", Elo: 1300}, {ID: 7, Username: "Beta", Elo: 1100}} {
		accounts = append(accounts, db.Account{ID: u.ID, Username: u.Username, Email: u.Username + "@test.local", PasswordHash: string(hash), Elo: u.Elo, HidePresence: isHidden[u.ID]})
	}
	db.SetMemAccounts(accounts)
	db.ResetMemDecks()
	t.Cleanup(func() {
		db.SetMemAccounts(nil)
		db.ResetMemDecks()
	})
}

func accountOf(t *testing.T, resp deckResp) accountJSON {
	t.Helper()
	var out accountJSON
	if err := json.Unmarshal(resp.Data, &out); err != nil {
		t.Fatalf("account non valido: %v", err)
	}
	return out
}

func TestRegister_Consent(t *testing.T) {
	body, _ := json.Marshal(models.RegisterRequest{Username: "mario", Email: "mario@test.local", Password: "Password1"})
	rr := httptest.NewRecorder()
	Register(rr, httptest.NewRequest("POST", "/auth/register", bytes.NewBuffer(body)))
	var resp models.APIResponse
	_ = json.Unmarshal(rr.Body.Bytes(), &resp)
	if rr.Code != http.StatusBadRequest || resp.Error != msgConsentRequired {
		t.Errorf("senza consenso: %d %q", rr.Code, resp.Error)
	}

	body, _ = json.Marshal(models.RegisterRequest{Username: "mario", Email: "mario@test.local", Password: "Password1", AcceptTerms: true})
	rr = httptest.NewRecorder()
	Register(rr, httptest.NewRequest("POST", "/auth/register", bytes.NewBuffer(body)))
	_ = json.Unmarshal(rr.Body.Bytes(), &resp)
	if rr.Code != http.StatusBadRequest || resp.Error != msgConsentRequired {
		t.Errorf("senza conferma dell'età: %d %q", rr.Code, resp.Error)
	}
}

func TestPrivacy_TermsAndHidePresence(t *testing.T) {
	privacySetup(t)

	code, resp := callAs(t, Me, 5, "GET", "", nil)
	if me := accountOf(t, resp); code != http.StatusOK || me.TermsVersion != 0 || me.TermsCurrent != TermsVersion || me.Email != "io@test.local" {
		t.Fatalf("GET /me = %d %+v", code, me)
	}
	code, resp = callAs(t, AcceptTerms, 5, "POST", "", map[string]int{"version": TermsVersion + 1})
	expectError(t, "versione sbagliata", code, resp, http.StatusConflict, msgTermsVersion)
	code, resp = callAs(t, AcceptTerms, 5, "POST", "", map[string]int{"version": TermsVersion})
	if me := accountOf(t, resp); code != http.StatusOK || me.TermsVersion != TermsVersion || me.TermsAcceptedAt == "" {
		t.Fatalf("POST /me/terms = %d %+v", code, me)
	}

	code, resp = callAs(t, UpdatePrivacy, 5, "PUT", "", map[string]string{})
	expectError(t, "privacy senza campo", code, resp, http.StatusBadRequest, msgInvalidBody)
	code, resp = callAs(t, UpdatePrivacy, 5, "PUT", "", map[string]bool{"hide_presence": true})
	if me := accountOf(t, resp); code != http.StatusOK || !me.HidePresence {
		t.Fatalf("PUT /me/privacy = %d %+v", code, me)
	}
}

func TestPrivacy_HiddenPresenceLooksOffline(t *testing.T) {
	privacySetup(t, 6)
	presence.Default.Touch(6)
	presence.Default.Touch(7)

	list := friendsOf(t, 5)
	status := map[int]string{}
	for _, f := range list.Others {
		status[f.ID] = f.Status
	}
	if status[6] != StatusOffline || status[7] != StatusOnline || list.Online != 1 {
		t.Fatalf("stati = %v, online %d", status, list.Online)
	}
	code, resp := callAs(t, CreateChallenge, 5, "POST", "", challengeRequest{To: 6})
	expectError(t, "sfida a uno stato nascosto", code, resp, http.StatusConflict, msgChallengeOffline)
}

func TestPrivacy_DeleteAccount(t *testing.T) {
	privacySetup(t)
	presence.Default.Touch(5)
	presence.Default.Touch(6)
	request(t, 5, 7)
	_ = db.Friends().Block(6, 5)
	if _, err := game.GameManager.CreateChallenge(game.ChallengePlayer{ID: 5, Username: "io"}, game.ChallengePlayer{ID: 6, Username: "zeta"}); err != nil {
		t.Fatal(err)
	}

	code, resp := callAs(t, DeleteAccount, 5, "DELETE", "", map[string]string{"password": "Sbagliata1"})
	expectError(t, "password sbagliata", code, resp, http.StatusForbidden, msgWrongPassword)

	prev := inMatch
	inMatch = func(int) bool { return true }
	code, resp = callAs(t, DeleteAccount, 5, "DELETE", "", map[string]string{"password": "Password1"})
	expectError(t, "in partita", code, resp, http.StatusConflict, msgChallengeSelfBusy)
	inMatch = prev

	if code, resp = callAs(t, DeleteAccount, 5, "DELETE", "", map[string]string{"password": "Password1"}); code != http.StatusOK {
		t.Fatalf("DELETE /me = %d %q", code, resp.Error)
	}
	code, resp = callAs(t, Me, 5, "GET", "", nil)
	expectError(t, "/me dopo la cancellazione", code, resp, http.StatusNotFound, msgAccountAbsent)
	if presence.Default.Online(5) {
		t.Error("l'utente cancellato non è più online")
	}
	if got := game.GameManager.IncomingChallenges(6); len(got) != 0 {
		t.Errorf("le sue sfide vanno chiuse: %+v", got)
	}
	for _, id := range []int{6, 7} {
		view := friendsOf(t, id)
		for _, list := range [][]friendView{view.Friends, view.Others, view.Incoming, view.Outgoing} {
			if contains(list, 5) {
				t.Errorf("%d vede ancora l'utente cancellato", id)
			}
		}
	}
	if blocked, _ := db.Friends().Blocks(6); len(blocked) != 0 {
		t.Errorf("i blocchi verso l'utente cancellato vanno tolti: %v", blocked)
	}
	if _, out, _ := searchAs(t, 6, "io"); len(out) != 0 {
		t.Errorf("l'utente cancellato non si trova: %+v", out)
	}
}

func TestPrivacy_Export(t *testing.T) {
	privacySetup(t)
	request(t, 6, 5)
	_, _ = db.Friends().Accept(6, 5)
	_ = db.Friends().Block(5, 7)

	code, resp := callAs(t, ExportData, 5, "GET", "", nil)
	if code != http.StatusOK {
		t.Fatalf("GET /me/export = %d %q", code, resp.Error)
	}
	var out exportView
	if err := json.Unmarshal(resp.Data, &out); err != nil {
		t.Fatal(err)
	}
	switch {
	case out.ExportedAt == "" || out.Account.ID != 5 || out.Account.Email != "io@test.local":
		t.Errorf("account = %+v", out.Account)
	case len(out.Collection) == 0 || len(out.Decks) == 0:
		t.Errorf("collezione %d, mazzi %d", len(out.Collection), len(out.Decks))
	case len(out.Friends.Friends) != 1 || out.Friends.Friends[0].ID != 6 || len(out.Friends.Others) != 0:
		t.Errorf("amici = %+v", out.Friends)
	case len(out.Blocked) != 1 || out.Blocked[0].ID != 7:
		t.Errorf("bloccati = %+v", out.Blocked)
	case out.Games == nil:
		t.Error("partite: [] e non null")
	}
}
