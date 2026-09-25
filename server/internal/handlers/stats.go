package handlers

import (
	"chess-server/internal/db"
	"chess-server/internal/models"
	"encoding/json"
	"net/http"
	"strconv"

	"github.com/go-chi/chi/v5"
)

// Leaderboard ritorna i top 10 giocatori per ELO
func Leaderboard(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")

	rows, err := db.DB.Query(`
        SELECT id, username, elo
        FROM users
        ORDER BY elo DESC
        LIMIT 10
    `)
	if err != nil {
		w.WriteHeader(http.StatusInternalServerError)
		json.NewEncoder(w).Encode(models.APIResponse{Success: false, Error: "Errore DB"})
		return
	}
	defer rows.Close()

	type LeaderboardEntry struct {
		Rank     int    `json:"rank"`
		ID       int    `json:"id"`
		Username string `json:"username"`
		Elo      int    `json:"elo"`
	}

	var entries []LeaderboardEntry
	rank := 1
	for rows.Next() {
		var e LeaderboardEntry
		rows.Scan(&e.ID, &e.Username, &e.Elo)
		e.Rank = rank
		entries = append(entries, e)
		rank++
	}

	json.NewEncoder(w).Encode(models.APIResponse{
		Success: true,
		Data:    entries,
	})
}

// GameHistory ritorna lo storico partite di un utente
func GameHistory(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")

	userID, err := strconv.Atoi(chi.URLParam(r, "id"))
	if err != nil {
		w.WriteHeader(http.StatusBadRequest)
		json.NewEncoder(w).Encode(models.APIResponse{Success: false, Error: "ID non valido"})
		return
	}

	rows, err := db.DB.Query(`
        SELECT
            g.id,
            w.username AS white,
            b.username AS black,
            g.result,
            g.time_control,
            g.pgn,
            g.played_at
        FROM games g
        JOIN users w ON w.id = g.white_id
        JOIN users b ON b.id = g.black_id
        WHERE g.white_id = $1 OR g.black_id = $1
        ORDER BY g.played_at DESC
        LIMIT 20
    `, userID)
	if err != nil {
		w.WriteHeader(http.StatusInternalServerError)
		json.NewEncoder(w).Encode(models.APIResponse{Success: false, Error: "Errore DB"})
		return
	}
	defer rows.Close()

	type GameEntry struct {
		ID          int    `json:"id"`
		White       string `json:"white"`
		Black       string `json:"black"`
		Result      string `json:"result"`
		TimeControl string `json:"time_control"`
		PGN         string `json:"pgn"`
		PlayedAt    string `json:"played_at"`
	}

	var games []GameEntry
	for rows.Next() {
		var g GameEntry
		rows.Scan(&g.ID, &g.White, &g.Black, &g.Result, &g.TimeControl, &g.PGN, &g.PlayedAt)
		games = append(games, g)
	}

	json.NewEncoder(w).Encode(models.APIResponse{
		Success: true,
		Data:    games,
	})
}

// GetUserProfile ritorna il profilo pubblico di un utente
func GetUserProfile(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")

	userID, err := strconv.Atoi(chi.URLParam(r, "id"))
	if err != nil {
		w.WriteHeader(http.StatusBadRequest)
		json.NewEncoder(w).Encode(models.APIResponse{
			Success: false,
			Error:   "ID non valido",
		})
		return
	}

	var user models.User
	err = db.DB.QueryRow(`
        SELECT id, username, elo, created_at
        FROM users WHERE id = $1`, userID,
	).Scan(&user.ID, &user.Username, &user.Elo, &user.CreatedAt)

	if err != nil {
		w.WriteHeader(http.StatusNotFound)
		json.NewEncoder(w).Encode(models.APIResponse{
			Success: false,
			Error:   "Utente non trovato",
		})
		return
	}

	// Statistiche partite
	var wins, losses, draws int
	db.DB.QueryRow(`
        SELECT
            COUNT(*) FILTER (WHERE (white_id = $1 AND result = '1-0') OR (black_id = $1 AND result = '0-1')) AS wins,
            COUNT(*) FILTER (WHERE (white_id = $1 AND result = '0-1') OR (black_id = $1 AND result = '1-0')) AS losses,
            COUNT(*) FILTER (WHERE result = '1/2-1/2') AS draws
        FROM games
        WHERE white_id = $1 OR black_id = $1
    `, userID).Scan(&wins, &losses, &draws)

	json.NewEncoder(w).Encode(models.APIResponse{
		Success: true,
		Data: map[string]interface{}{
			"user": user,
			"stats": map[string]int{
				"wins":   wins,
				"losses": losses,
				"draws":  draws,
				"total":  wins + losses + draws,
			},
		},
	})
}
