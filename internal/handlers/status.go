package handlers

import (
	"chess-server/internal/db"
	"chess-server/internal/models"
	"encoding/json"
	"net/http"
)

func StatusHandler(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")

	dbStatus := "ok"
	if err := db.HealthCheck(); err != nil {
		dbStatus = "unavailable"
		w.WriteHeader(http.StatusServiceUnavailable)
	}

	json.NewEncoder(w).Encode(models.APIResponse{
		Success: dbStatus == "ok",
		Data: map[string]string{
			"status":  dbStatus,
			"version": "0.1.0",
		},
	})
}
