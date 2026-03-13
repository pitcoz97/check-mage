package api

import (
	"chess-server/internal/handlers"
	mw "chess-server/internal/middleware"

	"github.com/go-chi/chi/v5"
	"github.com/go-chi/chi/v5/middleware"
)

func NewRouter() *chi.Mux {
	r := chi.NewRouter()

	// Middleware globali (vengono eseguiti per ogni richiesta)
	r.Use(middleware.Logger)            // logga ogni richiesta nel terminale
	r.Use(middleware.Recoverer)         // se un handler va in panic, non crasha il server
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

	// Route private (richiedono JWT valido)
	r.Group(func(r chi.Router) {
		r.Use(mw.Auth)

		r.Get("/me", handlers.Me)
		r.Get("/users/{id}/games", handlers.GameHistory) // storico partite

		r.With(mw.WSLimiter.Middleware).Get("/ws", handlers.WSHandler)
	})

	return r
}
