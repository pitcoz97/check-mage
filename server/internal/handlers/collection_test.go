package handlers

import (
	mw "chess-server/internal/middleware"
	"chess-server/internal/spells"
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/golang-jwt/jwt/v5"
)

func TestCollection_NoClaims(t *testing.T) {
	rr := httptest.NewRecorder()
	Collection(rr, httptest.NewRequest("GET", "/me/collection", nil))
	if rr.Code != http.StatusUnauthorized {
		t.Errorf("status = %d, atteso 401", rr.Code)
	}
}

// Senza DB (test) la collezione è il set iniziale.
func TestCollection_Starter(t *testing.T) {
	req := httptest.NewRequest("GET", "/me/collection", nil)
	req = req.WithContext(context.WithValue(req.Context(), mw.UserKey, jwt.MapClaims{"user_id": float64(7)}))
	rr := httptest.NewRecorder()
	Collection(rr, req)

	if rr.Code != http.StatusOK {
		t.Fatalf("status = %d, atteso 200", rr.Code)
	}
	var resp struct {
		Success bool                  `json:"success"`
		Data    spells.CollectionView `json:"data"`
	}
	if err := json.Unmarshal(rr.Body.Bytes(), &resp); err != nil {
		t.Fatalf("risposta non valida: %v", err)
	}
	if !resp.Success || len(resp.Data.Cards) != len(spells.Catalog) {
		t.Fatalf("risposta = %+v", resp)
	}
	if resp.Data.Owned != 45 || resp.Data.Total != 59 {
		t.Errorf("totale = %d / %d, atteso 45 / 59", resp.Data.Owned, resp.Data.Total)
	}
}
