package middleware

import (
	"chess-server/internal/config"
	"chess-server/internal/models"
	"context"
	"encoding/json"
	"net/http"
	"strings"

	"github.com/golang-jwt/jwt/v5"
)

// Chiave per il context — evita collisioni con altre chiavi
type contextKey string

const UserKey contextKey = "user"

// Auth è il middleware che protegge le route private
// In Chi si usa così: r.Use(middleware.Auth)
func Auth(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")

		// Il token arriva nell'header: "Authorization: Bearer <token>"
		authHeader := r.Header.Get("Authorization")
		if authHeader == "" || !strings.HasPrefix(authHeader, "Bearer ") {
			w.WriteHeader(http.StatusUnauthorized)
			json.NewEncoder(w).Encode(models.APIResponse{
				Success: false,
				Error:   "Token mancante",
			})
			return
		}

		tokenStr := strings.TrimPrefix(authHeader, "Bearer ")

		// Valida e decodifica il token
		token, err := jwt.Parse(tokenStr, func(t *jwt.Token) (interface{}, error) {
			return []byte(config.C.JWTSecret), nil
		})

		if err != nil || !token.Valid {
			w.WriteHeader(http.StatusUnauthorized)
			json.NewEncoder(w).Encode(models.APIResponse{
				Success: false,
				Error:   "Token non valido o scaduto",
			})
			return
		}

		// Metti i dati dell'utente nel context della richiesta
		// Gli handler successivi possono leggerli con r.Context().Value(UserKey)
		claims := token.Claims.(jwt.MapClaims)
		ctx := context.WithValue(r.Context(), UserKey, claims)
		next.ServeHTTP(w, r.WithContext(ctx))
	})
}
