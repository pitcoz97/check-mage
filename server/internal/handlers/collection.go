package handlers

import (
	"chess-server/internal/db"
	"chess-server/internal/logger"
	mw "chess-server/internal/middleware"
	"chess-server/internal/models"
	"chess-server/internal/spells"
	"encoding/json"
	"net/http"

	"github.com/golang-jwt/jwt/v5"
	"go.uber.org/zap"
)

// Collection gestisce GET /me/collection: le copie possedute dall'utente per
// ogni magia del catalogo (ordine di GET /spells), più possedute e totale.
func Collection(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")

	claims, ok := r.Context().Value(mw.UserKey).(jwt.MapClaims)
	rawID, idOK := claims["user_id"].(float64)
	if !ok || !idOK {
		w.WriteHeader(http.StatusUnauthorized)
		json.NewEncoder(w).Encode(models.APIResponse{Success: false, Error: "Non autorizzato"})
		return
	}

	owned, err := db.LoadCollection(int(rawID), spells.StarterSet())
	if err != nil {
		logger.L.Error("Errore lettura collezione", zap.Int("user_id", int(rawID)), zap.Error(err))
		w.WriteHeader(http.StatusInternalServerError)
		json.NewEncoder(w).Encode(models.APIResponse{Success: false, Error: "Errore recupero collezione"})
		return
	}

	json.NewEncoder(w).Encode(models.APIResponse{
		Success: true,
		Data:    spells.Collection(owned),
	})
}
