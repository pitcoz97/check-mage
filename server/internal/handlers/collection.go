package handlers

import (
	"chess-server/internal/db"
	"chess-server/internal/logger"
	"chess-server/internal/models"
	"chess-server/internal/spells"
	"net/http"

	"go.uber.org/zap"
)

// Collection gestisce GET /me/collection: le copie possedute dall'utente per
// ogni magia del catalogo (ordine di GET /spells), più possedute e totale.
func Collection(w http.ResponseWriter, r *http.Request) {
	userID, ok := userIDFrom(r)
	if !ok {
		fail(w, http.StatusUnauthorized, msgUnauthorized)
		return
	}

	owned, err := db.LoadCollection(userID, spells.StarterSet())
	if err != nil {
		logger.L.Error("Errore lettura collezione", zap.Int("user_id", userID), zap.Error(err))
		fail(w, http.StatusInternalServerError, "Errore recupero collezione")
		return
	}

	writeJSON(w, http.StatusOK, models.APIResponse{Success: true, Data: spells.Collection(owned)})
}
