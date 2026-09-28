package handlers

import (
	"bytes"
	"chess-server/internal/db"
	mw "chess-server/internal/middleware"
	"chess-server/internal/spells"
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/go-chi/chi/v5"
	"github.com/golang-jwt/jwt/v5"
)

type deckResp struct {
	Success bool            `json:"success"`
	Error   string          `json:"error"`
	Data    json.RawMessage `json:"data"`
}

// call esegue un handler dei mazzi come l'utente 5, senza DB (mazzi in memoria).
func call(t *testing.T, h http.HandlerFunc, method, id string, body interface{}) (int, deckResp) {
	t.Helper()
	var buf bytes.Buffer
	if body != nil {
		_ = json.NewEncoder(&buf).Encode(body)
	}
	req := httptest.NewRequest(method, "/me/decks", &buf)
	ctx := context.WithValue(req.Context(), mw.UserKey, jwt.MapClaims{"user_id": float64(5)})
	if id != "" {
		rc := chi.NewRouteContext()
		rc.URLParams.Add("id", id)
		ctx = context.WithValue(ctx, chi.RouteCtxKey, rc)
	}
	rr := httptest.NewRecorder()
	h(rr, req.WithContext(ctx))
	var resp deckResp
	if err := json.Unmarshal(rr.Body.Bytes(), &resp); err != nil {
		t.Fatalf("risposta non valida: %v", err)
	}
	return rr.Code, resp
}

func list(t *testing.T) deckListView {
	t.Helper()
	code, resp := call(t, ListDecks, "GET", "", nil)
	if code != http.StatusOK {
		t.Fatalf("GET /me/decks = %d %s", code, resp.Error)
	}
	var out deckListView
	_ = json.Unmarshal(resp.Data, &out)
	return out
}

func cardsOf(d spells.DeckCards) []deckCardView {
	out := []deckCardView{}
	for id, n := range d {
		out = append(out, deckCardView{SpellID: id, Copies: n})
	}
	return out
}

func TestDecks_StarterAndRules(t *testing.T) {
	ownedOnly(t)
	db.ResetMemDecks()

	// Alla prima lettura: il mazzo iniziale, valido e attivo (D4).
	l := list(t)
	if len(l.Decks) != 1 || l.MaxDecks != 10 || l.DeckSize != 40 {
		t.Fatalf("lista = %+v", l)
	}
	starter := l.Decks[0]
	if starter.Name != StarterDeckName || !starter.Valid || !starter.Active || starter.Size != 40 {
		t.Fatalf("mazzo iniziale = %+v", starter)
	}
	if len(list(t).Decks) != 1 {
		t.Fatal("la seconda lettura non deve creare un altro mazzo")
	}

	// Una bozza corta si salva (D3) ma non si attiva.
	code, resp := call(t, CreateDeck, "POST", "", deckRequest{Name: "  Gelo  ", Cards: []deckCardView{{SpellID: "frost", Copies: 2}}})
	if code != http.StatusCreated {
		t.Fatalf("POST = %d %s", code, resp.Error)
	}
	var draft deckView
	_ = json.Unmarshal(resp.Data, &draft)
	if draft.Name != "Gelo" || draft.Valid || draft.Active || draft.Size != 2 {
		t.Errorf("bozza = %+v", draft)
	}
	id := jsonID(draft.ID)
	if code, resp := call(t, ActivateDeck, "POST", id, nil); code != http.StatusBadRequest || resp.Error != msgDeckNotValid {
		t.Errorf("attivare una bozza = %d %s", code, resp.Error)
	}

	// Copie oltre il possesso, nome vuoto, carta sconosciuta: rifiutati.
	cases := []struct {
		req  deckRequest
		want string
	}{
		{deckRequest{Name: "X", Cards: []deckCardView{{SpellID: "haste", Copies: 1}}}, msgDeckNotOwned},
		{deckRequest{Name: "X", Cards: []deckCardView{{SpellID: "frost", Copies: 3}}}, msgDeckCopies},
		{deckRequest{Name: "X", Cards: []deckCardView{{SpellID: "nope", Copies: 1}}}, msgDeckUnknown},
		{deckRequest{Name: " ", Cards: nil}, msgDeckName},
	}
	for _, c := range cases {
		if code, resp := call(t, UpdateDeck, "PUT", id, c.req); code != http.StatusBadRequest || resp.Error != c.want {
			t.Errorf("PUT %+v = %d %q, atteso %q", c.req, code, resp.Error, c.want)
		}
	}

	// Completata a 40 diventa valida e attivabile; il mazzo iniziale non è più attivo.
	full := spells.StarterDeck(spells.StarterSet())
	if code, resp := call(t, UpdateDeck, "PUT", id, deckRequest{Name: "Gelo", Cards: cardsOf(full)}); code != http.StatusOK {
		t.Fatalf("PUT valido = %d %s", code, resp.Error)
	}
	if code, resp := call(t, ActivateDeck, "POST", id, nil); code != http.StatusOK {
		t.Fatalf("attivazione = %d %s", code, resp.Error)
	}
	active := 0
	for _, d := range list(t).Decks {
		if d.Active {
			active++
			if d.ID != draft.ID {
				t.Error("attivo il mazzo sbagliato")
			}
		}
	}
	if active != 1 {
		t.Errorf("mazzi attivi = %d", active)
	}

	// Il mazzo attivo resta valido: una modifica che lo accorcia è rifiutata.
	if code, resp := call(t, UpdateDeck, "PUT", id, deckRequest{Name: "Gelo", Cards: nil}); code != http.StatusBadRequest || resp.Error != msgDeckNotValid {
		t.Errorf("accorciare l'attivo = %d %s", code, resp.Error)
	}

	// Eliminando l'attivo, torna attivo l'altro valido (D5); l'ultimo non si elimina.
	if code, resp := call(t, DeleteDeck, "DELETE", id, nil); code != http.StatusOK {
		t.Fatalf("DELETE = %d %s", code, resp.Error)
	}
	l = list(t)
	if len(l.Decks) != 1 || !l.Decks[0].Active || l.Decks[0].ID != starter.ID {
		t.Errorf("dopo l'eliminazione = %+v", l.Decks)
	}
	if code, resp := call(t, DeleteDeck, "DELETE", jsonID(starter.ID), nil); code != http.StatusBadRequest || resp.Error != msgDeckLast {
		t.Errorf("eliminare l'ultimo = %d %s", code, resp.Error)
	}
	if code, _ := call(t, DeleteDeck, "DELETE", "999", nil); code != http.StatusNotFound {
		t.Errorf("mazzo inesistente = %d", code)
	}

	// Il mazzo attivo per la partita (D6).
	deck, valid, err := ActiveDeck(5)
	if err != nil || !valid || len(deck) != 40 {
		t.Errorf("ActiveDeck = %d carte, valido %v, err %v", len(deck), valid, err)
	}
}

func TestDecks_Limit(t *testing.T) {
	db.ResetMemDecks()
	list(t)
	for i := 1; i < spells.MaxDecks; i++ {
		if code, resp := call(t, CreateDeck, "POST", "", deckRequest{Name: "M", Cards: nil}); code != http.StatusCreated {
			t.Fatalf("mazzo %d = %d %s", i, code, resp.Error)
		}
	}
	if code, resp := call(t, CreateDeck, "POST", "", deckRequest{Name: "M", Cards: nil}); code != http.StatusBadRequest || resp.Error != msgDeckLimit {
		t.Errorf("undicesimo mazzo = %d %s", code, resp.Error)
	}
}

// C12: con la collezione piena ogni carta è posseduta al massimo: il mazzo
// iniziale è la ricetta condivisa intera (Fretta compresa) e una rara entra a 2
// copie anche se il set iniziale ne dà 1.
func TestDecks_UnlockAll(t *testing.T) {
	db.ResetMemDecks()

	rr := httptest.NewRecorder()
	req := httptest.NewRequest("GET", "/me/collection", nil)
	Collection(rr, req.WithContext(context.WithValue(req.Context(), mw.UserKey, jwt.MapClaims{"user_id": float64(5)})))
	var coll struct {
		Data spells.CollectionView `json:"data"`
	}
	_ = json.Unmarshal(rr.Body.Bytes(), &coll)
	if coll.Data.Owned != 59 || coll.Data.Total != 59 {
		t.Fatalf("collezione = %d / %d, attesa 59 / 59", coll.Data.Owned, coll.Data.Total)
	}

	starter := list(t).Decks[0]
	if !starter.Valid || starter.Size != 40 {
		t.Fatalf("mazzo iniziale = %+v", starter)
	}
	hasHaste := false
	for _, c := range starter.Cards {
		if c.SpellID == "haste" {
			hasHaste = true
		}
		if want := spells.StarterDeck(spells.FullCollection())[c.SpellID]; c.Copies != want {
			t.Errorf("%s: %d copie, attese %d", c.SpellID, c.Copies, want)
		}
	}
	if !hasHaste {
		t.Error("il mazzo iniziale deve contenere Fretta")
	}

	deck := spells.StarterDeck(spells.FullCollection())
	deck["frost"]--
	deck["swap"] = 2
	if deck.Size() != 40 {
		t.Fatalf("mazzo di prova = %d carte", deck.Size())
	}
	code, resp := call(t, CreateDeck, "POST", "", deckRequest{Name: "Scambi", Cards: cardsOf(deck)})
	if code != http.StatusCreated {
		t.Fatalf("POST con Scambio a 2 = %d %s", code, resp.Error)
	}
	var created deckView
	_ = json.Unmarshal(resp.Data, &created)
	if !created.Valid {
		t.Errorf("mazzo con Scambio a 2 non valido: %+v", created)
	}
	if code, resp := call(t, ActivateDeck, "POST", jsonID(created.ID), nil); code != http.StatusOK {
		t.Errorf("attivazione = %d %s", code, resp.Error)
	}
}

func TestDecks_Unauthorized(t *testing.T) {
	rr := httptest.NewRecorder()
	ListDecks(rr, httptest.NewRequest("GET", "/me/decks", nil))
	if rr.Code != http.StatusUnauthorized {
		t.Errorf("status = %d", rr.Code)
	}
}

func jsonID(id int) string {
	b, _ := json.Marshal(id)
	return string(b)
}
