package handlers

import (
	"chess-server/internal/config"
	"chess-server/internal/db"
	mw "chess-server/internal/middleware"
	"chess-server/internal/models"
	"encoding/json"
	"net/http"
	"time"

	"github.com/golang-jwt/jwt/v5"
	"golang.org/x/crypto/bcrypt"
)

// Register gestisce POST /auth/register
func Register(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")

	// Decodifica il JSON della richiesta (come deserializzare in C++)
	var req models.RegisterRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		w.WriteHeader(http.StatusBadRequest)
		json.NewEncoder(w).Encode(models.APIResponse{
			Success: false,
			Error:   "Dati non validi",
		})
		return
	}

	// Validazione base
	if req.Username == "" || req.Email == "" || req.Password == "" {
		w.WriteHeader(http.StatusBadRequest)
		json.NewEncoder(w).Encode(models.APIResponse{
			Success: false,
			Error:   "Username, email e password sono obbligatori",
		})
		return
	}

	// Hash della password con bcrypt (MAI salvare plaintext)
	// Il costo 12 è un buon bilanciamento sicurezza/performance
	hashedPassword, err := bcrypt.GenerateFromPassword([]byte(req.Password), 12)
	if err != nil {
		w.WriteHeader(http.StatusInternalServerError)
		json.NewEncoder(w).Encode(models.APIResponse{
			Success: false,
			Error:   "Errore interno",
		})
		return
	}

	// Inserisci nel DB e ritorna l'id del nuovo utente
	var userID int
	err = db.DB.QueryRow(`
        INSERT INTO users (username, email, password)
        VALUES ($1, $2, $3)
        RETURNING id`,
		req.Username, req.Email, string(hashedPassword),
	).Scan(&userID)

	if err != nil {
		// Controlla se è un errore di duplicato (username o email già esistenti)
		w.WriteHeader(http.StatusConflict)
		json.NewEncoder(w).Encode(models.APIResponse{
			Success: false,
			Error:   "Username o email già in uso",
		})
		return
	}

	json.NewEncoder(w).Encode(models.APIResponse{
		Success: true,
		Data:    map[string]int{"user_id": userID},
	})
}

// Login gestisce POST /auth/login
func Login(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")

	var req models.LoginRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		w.WriteHeader(http.StatusBadRequest)
		json.NewEncoder(w).Encode(models.APIResponse{
			Success: false,
			Error:   "Dati non validi",
		})
		return
	}

	// Cerca l'utente nel DB
	var user models.User
	err := db.DB.QueryRow(`
        SELECT id, username, email, password, elo
        FROM users WHERE email = $1`,
		req.Email,
	).Scan(&user.ID, &user.Username, &user.Email, &user.Password, &user.Elo)

	if err != nil {
		// Non dire mai "utente non trovato" — è una info utile agli attaccanti
		w.WriteHeader(http.StatusUnauthorized)
		json.NewEncoder(w).Encode(models.APIResponse{
			Success: false,
			Error:   "Credenziali non valide",
		})
		return
	}

	// Confronta la password con l'hash nel DB
	if err := bcrypt.CompareHashAndPassword([]byte(user.Password), []byte(req.Password)); err != nil {
		w.WriteHeader(http.StatusUnauthorized)
		json.NewEncoder(w).Encode(models.APIResponse{
			Success: false,
			Error:   "Credenziali non valide",
		})
		return
	}

	// Genera il JWT
	token, err := generateJWT(user.ID, user.Username)
	if err != nil {
		w.WriteHeader(http.StatusInternalServerError)
		json.NewEncoder(w).Encode(models.APIResponse{
			Success: false,
			Error:   "Errore generazione token",
		})
		return
	}

	json.NewEncoder(w).Encode(models.APIResponse{
		Success: true,
		Data: map[string]interface{}{
			"token": token,
			"user":  user,
		},
	})
}

// generateJWT crea un token JWT firmato
func generateJWT(userID int, username string) (string, error) {
	// Claims = payload del token (cosa ci mettiamo dentro)
	claims := jwt.MapClaims{
		"user_id":  userID,
		"username": username,
		"exp":      time.Now().Add(24 * time.Hour).Unix(), // scade dopo 24h
	}

	token := jwt.NewWithClaims(jwt.SigningMethodHS256, claims)
	return token.SignedString([]byte(config.C.JWTSecret))
}

// Me restituisce il profilo dell'utente loggato
func Me(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")

	// Legge i dati dell'utente iniettati dal middleware
	claims := r.Context().Value(mw.UserKey).(jwt.MapClaims)

	json.NewEncoder(w).Encode(models.APIResponse{
		Success: true,
		Data: map[string]interface{}{
			"user_id":  claims["user_id"],
			"username": claims["username"],
		},
	})
}
