package middleware

import (
	"chess-server/internal/config"
	"chess-server/internal/models"
	"context"
	"encoding/json"
	"errors"
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
			unauthorized(w, "Token mancante")
			return
		}

		claims, err := ParseAccessToken(tokenStr)
		if err != nil {
			unauthorized(w, "Token non valido o scaduto")
			return
		}

		// Metti i dati dell'utente nel context della richiesta
		// Gli handler successivi possono leggerli con r.Context().Value(UserKey)
		ctx := context.WithValue(r.Context(), UserKey, claims)
		next.ServeHTTP(w, r.WithContext(ctx))
	})
}

// ParseAccessToken valida un access token: firma HS256, scadenza, claim
// type == "access" (un refresh token non apre le rotte protette) e presenza dei
// claim utente usati dagli handler.
func ParseAccessToken(tokenStr string) (jwt.MapClaims, error) {
	token, err := jwt.Parse(tokenStr, func(t *jwt.Token) (interface{}, error) {
		return []byte(config.C.JWTSecret), nil
	}, jwt.WithValidMethods([]string{jwt.SigningMethodHS256.Alg()}))
	if err != nil || !token.Valid {
		return nil, errors.New("token non valido")
	}

	claims, ok := token.Claims.(jwt.MapClaims)
	if !ok || claims["type"] != "access" {
		return nil, errors.New("non è un access token")
	}
	if _, ok := claims["user_id"].(float64); !ok {
		return nil, errors.New("claim user_id mancante")
	}
	if _, ok := claims["username"].(string); !ok {
		return nil, errors.New("claim username mancante")
	}
	return claims, nil
}

func unauthorized(w http.ResponseWriter, msg string) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusUnauthorized)
	json.NewEncoder(w).Encode(models.APIResponse{
		Success: false,
		Error:   msg,
	})
}
