package handlers

import (
	"chess-server/internal/models"
	"chess-server/internal/spells"
	"chess-server/internal/validation"
	"encoding/json"
	"net/http"
)

// Spells gestisce GET /spells: il catalogo completo delle magie, ordinato per
// costo e poi per id.
func Spells(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(models.APIResponse{
		Success: true,
		Data:    spells.List(),
	})
}

// PasswordPolicy gestisce GET /auth/password-policy: le regole di validazione
// di username e password applicate alla registrazione.
func PasswordPolicy(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(models.APIResponse{
		Success: true,
		Data:    validation.CurrentPolicy(),
	})
}

// JSONError restituisce un handler che risponde con l'inviluppo JSON standard
// (usato per 404 e 405 al posto del testo semplice di default).
func JSONError(status int, message string) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(status)
		json.NewEncoder(w).Encode(models.APIResponse{Success: false, Error: message})
	}
}
