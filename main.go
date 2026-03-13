package main

import (
	"chess-server/internal/api"
	"chess-server/internal/config"
	"chess-server/internal/db"
	"chess-server/internal/engine"
	"chess-server/internal/game"
	"chess-server/internal/logger"
	mw "chess-server/internal/middleware"
	"context"
	"net/http"
	"os"
	"os/signal"
	"syscall"
	"time"

	"go.uber.org/zap"
)

// In Go le struct sono come in C++
type StatusResponse struct {
	Status  string `json:"status"`
	Message string `json:"message"`
}

func main() {

	config.Load()

	if err := logger.Init(config.C.Env); err != nil {
		panic("Errore inizializzazione logger: " + err.Error())
	}
	defer logger.Sync()

	mw.InitLimiters()
	db.Connect()

	// Avvia Stockfish
	if err := engine.Init(); err != nil {
		logger.L.Fatal("Errore avvio Stockfish DB", zap.Error(err))
	}
	defer engine.SF.Shutdown()

	router := api.NewRouter()
	server := &http.Server{
		Addr:         ":" + config.C.ServerPort,
		Handler:      router,
		ReadTimeout:  15 * time.Second,
		WriteTimeout: 15 * time.Second,
		IdleTimeout:  60 * time.Second,
	}

	go func() {
		logger.L.Info("Chess server avviato",
			zap.String("addr", server.Addr),
			zap.String("env", config.C.Env),
		)
		if err := server.ListenAndServe(); err != nil && err != http.ErrServerClosed {
			logger.L.Fatal("Errore server", zap.Error(err))
		}
	}()

	// Aspetta un segnale di terminazione (Ctrl+C o kill)
	quit := make(chan os.Signal, 1)
	signal.Notify(quit, syscall.SIGINT, syscall.SIGTERM)
	<-quit // blocca qui finché non arriva il segnale

	logger.L.Info("Shutdown in corso...")

	// Termina le partite attive
	game.GameManager.Shutdown()

	// Dai al server 10 secondi per completare le richieste in corso
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()

	if err := server.Shutdown(ctx); err != nil {
		logger.L.Error("Errore durante lo shutdown", zap.Error(err))
	}

	logger.L.Info("Server spento correttamente")
}
