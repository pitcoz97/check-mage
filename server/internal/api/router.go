package api

import (
	"chess-server/internal/handlers"
	mw "chess-server/internal/middleware"

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
		// In sviluppo accetta tutto, in produzione specifica i domini
		AllowedOrigins:   []string{"https://*", "http://*"},
		AllowedMethods:   []string{"GET", "POST", "PUT", "DELETE", "OPTIONS"},
		AllowedHeaders:   []string{"Accept", "Authorization", "Content-Type"},
		ExposedHeaders:   []string{"Link"},
		AllowCredentials: false,
		MaxAge:           300,
	}))
	r.Use(mw.GeneralLimiter.Middleware) // rate limit generale su tutto

	// Route
	r.Get("/status", handlers.StatusHandler)

	// Auth — limite più stretto per prevenire brute force
	r.Group(func(r chi.Router) {
		r.Use(mw.AuthLimiter.Middleware)
		r.Post("/auth/register", handlers.Register)
		r.Post("/auth/login", handlers.Login)
	})

	r.Get("/leaderboard", handlers.Leaderboard)
	r.Get("/users/{id}", handlers.GetUserProfile)

	r.Post("/auth/refresh", handlers.RefreshToken)

	// Route private (richiedono JWT valido)
	r.Group(func(r chi.Router) {
		r.Use(mw.Auth)

		r.Get("/me", handlers.Me)
		r.Get("/users/{id}/games", handlers.GameHistory) // storico partite

		r.With(mw.WSLimiter.Middleware).Get("/ws", handlers.WSHandler)
	})

	return r
}
