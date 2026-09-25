package models

// Struct che rappresenta un utente nel DB
type User struct {
	ID        int    `json:"id"`
	Username  string `json:"username"`
	Email     string `json:"email"`
	Password  string `json:"-"` // il "-" significa: non includere mai nel JSON
	Elo       int    `json:"elo"`
	CreatedAt string `json:"created_at,omitempty"`
}

// Dati che arrivano dalla richiesta di registrazione
type RegisterRequest struct {
	Username string `json:"username"`
	Email    string `json:"email"`
	Password string `json:"password"`
}

// Dati che arrivano dalla richiesta di login
type LoginRequest struct {
	Email    string `json:"email"`
	Password string `json:"password"`
}

type TokenPair struct {
	AccessToken  string `json:"access_token"`
	RefreshToken string `json:"refresh_token"`
}
