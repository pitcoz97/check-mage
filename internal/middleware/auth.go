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
		var tokenStr string
		if strings.HasPrefix(authHeader, "Bearer ") {
			tokenStr = strings.TrimPrefix(authHeader, "Bearer ")
		} else if t := r.URL.Query().Get("token"); t != "" {
			// Fallback per WebSocket: il browser non può impostare header custom
			// sulla connessione WS, quindi accettiamo il token come query param ?token=
			tokenStr = t
		} else {
			w.WriteHeader(http.StatusUnauthorized)
			json.NewEncoder(w).Encode(models.APIResponse{
				Success: false,
				Error:   "Token mancante",
			})
			return
		}

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
