package api

import (
	"chess-server/internal/config"
	"chess-server/internal/handlers"
	mw "chess-server/internal/middleware"
	"net/http"

	"github.com/go-chi/chi/v5"
	"github.com/go-chi/chi/v5/middleware"
	"github.com/go-chi/cors"
)

func NewRouter() *chi.Mux {
	r := chi.NewRouter()

	// Middleware globali (vengono eseguiti per ogni richiesta)
	r.Use(middleware.Logger)    // logga ogni richiesta nel terminale
	r.Use(middleware.Recoverer) // se un handler va in panic, non crasha il server
	r.Use(cors.Handler(cors.Options{
		// Origini da CORS_ALLOWED_ORIGINS; il default ammette http(s)://* e
		// capacitor://localhost (iOS). In produzione specifica i domini.
		AllowedOrigins:   config.C.CORSAllowedOrigins,
		AllowedMethods:   []string{"GET", "POST", "PUT", "DELETE", "OPTIONS"},
		AllowedHeaders:   []string{"Accept", "Authorization", "Content-Type"},
		ExposedHeaders:   []string{"Link"},
		AllowCredentials: false,
		MaxAge:           300,
	}))
	r.Use(mw.GeneralLimiter.Middleware) // rate limit generale su tutto

	// Risposte JSON anche per rotte e metodi inesistenti
	r.NotFound(handlers.JSONError(http.StatusNotFound, "Risorsa non trovata"))
	r.MethodNotAllowed(handlers.JSONError(http.StatusMethodNotAllowed, "Metodo non consentito"))

	// Route
	r.Get("/status", handlers.StatusHandler)

	// Auth — limite più stretto per prevenire brute force
	r.Group(func(r chi.Router) {
		r.Use(mw.AuthLimiter.Middleware)
		r.Post("/auth/register", handlers.Register)
		r.Post("/auth/login", handlers.Login)
		r.Post("/auth/refresh", handlers.RefreshToken)
	})
	r.Get("/auth/password-policy", handlers.PasswordPolicy)

	r.Get("/leaderboard", handlers.Leaderboard)
	r.Get("/users/{id}", handlers.GetUserProfile)
	r.Get("/spells", handlers.Spells)

	// Route private (richiedono JWT valido)
	r.Group(func(r chi.Router) {
		r.Use(mw.Auth)

		r.Get("/me", handlers.Me)
		r.Get("/users/{id}/games", handlers.GameHistory) // storico partite
		r.Get("/ws/ticket", handlers.WSTicket)           // ticket monouso per /ws
	})

	// WebSocket: ticket monouso (?ticket=) oppure JWT (Bearer o ?token=)
	r.With(mw.WSLimiter.Middleware, mw.WSAuth).Get("/ws", handlers.WSHandler)

	return r
}
