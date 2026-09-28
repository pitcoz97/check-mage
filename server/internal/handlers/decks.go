package handlers

import (
	"chess-server/internal/db"
	"chess-server/internal/logger"
	mw "chess-server/internal/middleware"
	"chess-server/internal/models"
	"chess-server/internal/spells"
	"encoding/json"
	"net/http"
	"sort"
	"strconv"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/golang-jwt/jwt/v5"
	"go.uber.org/zap"
)

// Mazzi personali: GET/POST /me/decks, PUT/DELETE /me/decks/{id},
// POST /me/decks/{id}/activate. Regole in spells/decks.go (D1–D6).

// StarterDeckName è il nome del mazzo creato a chi non ne ha (D4).
const StarterDeckName = "Mazzo iniziale"

// Testi degli errori dei mazzi: il client ricava il codice dal testo.
const (
	msgDeckLimit    = "Hai già il numero massimo di mazzi"
	msgDeckName     = "Nome del mazzo non valido"
	msgDeckUnknown  = "Carta non presente nel catalogo"
	msgDeckCopies   = "Troppe copie di una carta"
	msgDeckNotOwned = "Copie non possedute"
	msgDeckNotValid = "Il mazzo non è valido"
	msgDeckLast     = "Non puoi eliminare l'ultimo mazzo"
	msgDeckNotFound = "Mazzo non trovato"
	msgInvalidBody  = "Dati non validi"
	msgUnauthorized = "Non autorizzato"
	msgDBError      = "Errore DB"
)

type deckCardView struct {
	SpellID string `json:"spell_id"`
	Copies  int    `json:"copies"`
}

type deckView struct {
	ID        int            `json:"id"`
	Name      string         `json:"name"`
	Cards     []deckCardView `json:"cards"`
	Size      int            `json:"size"`
	Valid     bool           `json:"valid"`
	Active    bool           `json:"active"`
	UpdatedAt string         `json:"updated_at"`
}

type deckListView struct {
	Decks    []deckView `json:"decks"`
	MaxDecks int        `json:"max_decks"`
	DeckSize int        `json:"deck_size"`
}

type deckRequest struct {
	Name  string         `json:"name"`
	Cards []deckCardView `json:"cards"`
}

func userIDFrom(r *http.Request) (int, bool) {
	claims, ok := r.Context().Value(mw.UserKey).(jwt.MapClaims)
	raw, idOK := claims["user_id"].(float64)
	return int(raw), ok && idOK
}

func writeJSON(w http.ResponseWriter, status int, resp models.APIResponse) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	json.NewEncoder(w).Encode(resp)
}

func fail(w http.ResponseWriter, status int, message string) {
	writeJSON(w, status, models.APIResponse{Success: false, Error: message})
}

func dbFail(w http.ResponseWriter, userID int, err error) {
	logger.L.Error("Errore mazzi", zap.Int("user_id", userID), zap.Error(err))
	fail(w, http.StatusInternalServerError, msgDBError)
}

func toView(row db.DeckRow, owned map[string]int) deckView {
	cards := make([]deckCardView, 0, len(row.Cards))
	for id, n := range row.Cards {
		cards = append(cards, deckCardView{SpellID: id, Copies: n})
	}
	sort.Slice(cards, func(i, j int) bool { return cards[i].SpellID < cards[j].SpellID })
	return deckView{
		ID:        row.ID,
		Name:      row.Name,
		Cards:     cards,
		Size:      row.Cards.Size(),
		Valid:     len(spells.ValidateDeck(row.Cards, owned)) == 0,
		Active:    row.Active,
		UpdatedAt: row.UpdatedAt.UTC().Format(time.RFC3339),
	}
}

// ownedCopies restituisce le copie possedute dall'utente (il set iniziale
// arriva alla prima lettura); con spells.UnlockAllCards la collezione è piena
// (C12), ma le righe del DB restano quelle vere.
func ownedCopies(userID int) (map[string]int, error) {
	owned, err := db.LoadCollection(userID, spells.StarterSet())
	if err != nil || !spells.UnlockAllCards {
		return owned, err
	}
	return spells.FullCollection(), nil
}

// userDecks legge collezione e mazzi; a chi non ha mazzi crea il mazzo iniziale,
// attivo (D4).
func userDecks(userID int) ([]db.DeckRow, map[string]int, error) {
	owned, err := ownedCopies(userID)
	if err != nil {
		return nil, nil, err
	}
	rows, err := db.Decks().List(userID)
	if err != nil {
		return nil, nil, err
	}
	if len(rows) == 0 {
		starter := spells.StarterDeck(owned)
		row, err := db.Decks().Insert(userID, StarterDeckName, starter, len(spells.ValidateDeck(starter, owned)) == 0)
		if err != nil {
			return nil, nil, err
		}
		rows = []db.DeckRow{row}
	}
	return rows, owned, nil
}

// ActiveDeck restituisce il mazzo attivo dell'utente, espanso per la partita, e
// se è valido (D6).
func ActiveDeck(userID int) ([]string, bool, error) {
	rows, owned, err := userDecks(userID)
	if err != nil {
		return nil, false, err
	}
	for _, row := range rows {
		if row.Active {
			return spells.Expand(row.Cards), len(spells.ValidateDeck(row.Cards, owned)) == 0, nil
		}
	}
	return nil, false, nil
}

func listResponse(w http.ResponseWriter, userID int, status int) {
	rows, owned, err := userDecks(userID)
	if err != nil {
		dbFail(w, userID, err)
		return
	}
	views := make([]deckView, 0, len(rows))
	for _, row := range rows {
		views = append(views, toView(row, owned))
	}
	writeJSON(w, status, models.APIResponse{Success: true, Data: deckListView{Decks: views, MaxDecks: spells.MaxDecks, DeckSize: spells.DeckSize}})
}

// ListDecks gestisce GET /me/decks.
func ListDecks(w http.ResponseWriter, r *http.Request) {
	userID, ok := userIDFrom(r)
	if !ok {
		fail(w, http.StatusUnauthorized, msgUnauthorized)
		return
	}
	listResponse(w, userID, http.StatusOK)
}

// readDeck decodifica e valida il corpo: nome ammesso e nessun problema
// bloccante (le bozze corte si salvano, D3).
func readDeck(w http.ResponseWriter, r *http.Request, owned map[string]int) (string, spells.DeckCards, bool) {
	var req deckRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		fail(w, http.StatusBadRequest, msgInvalidBody)
		return "", nil, false
	}
	name, ok := spells.ValidDeckName(req.Name)
	if !ok {
		fail(w, http.StatusBadRequest, msgDeckName)
		return "", nil, false
	}
	cards := spells.DeckCards{}
	for _, c := range req.Cards {
		if c.SpellID == "" || c.Copies < 0 {
			fail(w, http.StatusBadRequest, msgInvalidBody)
			return "", nil, false
		}
		cards[c.SpellID] += c.Copies
	}
	cards = cards.Normalized()
	if p := spells.BlockingProblem(spells.ValidateDeck(cards, owned)); p != nil {
		msg := map[string]string{
			spells.DeckUnknownSpell:  msgDeckUnknown,
			spells.DeckTooManyCopies: msgDeckCopies,
			spells.DeckNotOwned:      msgDeckNotOwned,
		}[p.Code]
		fail(w, http.StatusBadRequest, msg)
		return "", nil, false
	}
	return name, cards, true
}

// CreateDeck gestisce POST /me/decks: un mazzo nuovo, non attivo.
func CreateDeck(w http.ResponseWriter, r *http.Request) {
	userID, ok := userIDFrom(r)
	if !ok {
		fail(w, http.StatusUnauthorized, msgUnauthorized)
		return
	}
	rows, owned, err := userDecks(userID)
	if err != nil {
		dbFail(w, userID, err)
		return
	}
	name, cards, ok := readDeck(w, r, owned)
	if !ok {
		return
	}
	if len(rows) >= spells.MaxDecks {
		fail(w, http.StatusBadRequest, msgDeckLimit)
		return
	}
	row, err := db.Decks().Insert(userID, name, cards, false)
	if err != nil {
		dbFail(w, userID, err)
		return
	}
	writeJSON(w, http.StatusCreated, models.APIResponse{Success: true, Data: toView(row, owned)})
}

func deckID(r *http.Request) (int, bool) {
	id, err := strconv.Atoi(chi.URLParam(r, "id"))
	return id, err == nil
}

func findDeck(rows []db.DeckRow, id int) (db.DeckRow, bool) {
	for _, row := range rows {
		if row.ID == id {
			return row, true
		}
	}
	return db.DeckRow{}, false
}

// UpdateDeck gestisce PUT /me/decks/{id}. Il mazzo attivo deve restare valido.
func UpdateDeck(w http.ResponseWriter, r *http.Request) {
	userID, ok := userIDFrom(r)
	if !ok {
		fail(w, http.StatusUnauthorized, msgUnauthorized)
		return
	}
	id, ok := deckID(r)
	if !ok {
		fail(w, http.StatusNotFound, msgDeckNotFound)
		return
	}
	rows, owned, err := userDecks(userID)
	if err != nil {
		dbFail(w, userID, err)
		return
	}
	current, found := findDeck(rows, id)
	if !found {
		fail(w, http.StatusNotFound, msgDeckNotFound)
		return
	}
	name, cards, ok := readDeck(w, r, owned)
	if !ok {
		return
	}
	if current.Active && len(spells.ValidateDeck(cards, owned)) != 0 {
		fail(w, http.StatusBadRequest, msgDeckNotValid)
		return
	}
	row, found, err := db.Decks().Update(userID, id, name, cards)
	if err != nil {
		dbFail(w, userID, err)
		return
	}
	if !found {
		fail(w, http.StatusNotFound, msgDeckNotFound)
		return
	}
	writeJSON(w, http.StatusOK, models.APIResponse{Success: true, Data: toView(row, owned)})
}

// DeleteDeck gestisce DELETE /me/decks/{id}. L'ultimo mazzo resta; se era
// l'attivo, diventa attivo il valido modificato più di recente, o si ricrea il
// mazzo iniziale (D5). Risponde con la lista aggiornata.
func DeleteDeck(w http.ResponseWriter, r *http.Request) {
	userID, ok := userIDFrom(r)
	if !ok {
		fail(w, http.StatusUnauthorized, msgUnauthorized)
		return
	}
	id, ok := deckID(r)
	if !ok {
		fail(w, http.StatusNotFound, msgDeckNotFound)
		return
	}
	rows, owned, err := userDecks(userID)
	if err != nil {
		dbFail(w, userID, err)
		return
	}
	target, found := findDeck(rows, id)
	if !found {
		fail(w, http.StatusNotFound, msgDeckNotFound)
		return
	}
	if len(rows) == 1 {
		fail(w, http.StatusBadRequest, msgDeckLast)
		return
	}
	if _, err := db.Decks().Delete(userID, id); err != nil {
		dbFail(w, userID, err)
		return
	}
	if target.Active {
		var next *db.DeckRow
		for i := range rows {
			row := rows[i]
			if row.ID == id || len(spells.ValidateDeck(row.Cards, owned)) != 0 {
				continue
			}
			if next == nil || row.UpdatedAt.After(next.UpdatedAt) {
				next = &rows[i]
			}
		}
		if next != nil {
			_, err = db.Decks().SetActive(userID, next.ID)
		} else {
			_, err = db.Decks().Insert(userID, StarterDeckName, spells.StarterDeck(owned), true)
		}
		if err != nil {
			dbFail(w, userID, err)
			return
		}
	}
	listResponse(w, userID, http.StatusOK)
}

// ActivateDeck gestisce POST /me/decks/{id}/activate: solo un mazzo valido.
func ActivateDeck(w http.ResponseWriter, r *http.Request) {
	userID, ok := userIDFrom(r)
	if !ok {
		fail(w, http.StatusUnauthorized, msgUnauthorized)
		return
	}
	id, ok := deckID(r)
	if !ok {
		fail(w, http.StatusNotFound, msgDeckNotFound)
		return
	}
	rows, owned, err := userDecks(userID)
	if err != nil {
		dbFail(w, userID, err)
		return
	}
	target, found := findDeck(rows, id)
	if !found {
		fail(w, http.StatusNotFound, msgDeckNotFound)
		return
	}
	if len(spells.ValidateDeck(target.Cards, owned)) != 0 {
		fail(w, http.StatusBadRequest, msgDeckNotValid)
		return
	}
	if _, err := db.Decks().SetActive(userID, id); err != nil {
		dbFail(w, userID, err)
		return
	}
	listResponse(w, userID, http.StatusOK)
}
