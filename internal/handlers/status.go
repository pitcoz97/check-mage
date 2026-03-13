package handlers

import (
	"chess-server/internal/models"
	"encoding/json"
	"net/http"
)

func StatusHandler(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")

	data := map[string]string{
		"status"  : "ok",
		"version" : "0.1.0",
	}

	json.NewEncoder(w).Encode(models.APIResponse{
		Success : true,
		Data	: data,
	})
}