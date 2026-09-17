package handlers

import (
	"chess-server/internal/spells"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestSpells(t *testing.T) {
	rr := httptest.NewRecorder()
	Spells(rr, httptest.NewRequest("GET", "/spells", nil))

	var resp struct {
		Success bool           `json:"success"`
		Data    []spells.Spell `json:"data"`
	}
	if err := json.Unmarshal(rr.Body.Bytes(), &resp); err != nil {
		t.Fatalf("risposta non valida: %v", err)
	}
	if !resp.Success || len(resp.Data) != len(spells.Catalog) {
		t.Errorf("success = %v, magie = %d (attese %d)", resp.Success, len(resp.Data), len(spells.Catalog))
	}
}

func TestPasswordPolicy(t *testing.T) {
	rr := httptest.NewRecorder()
	PasswordPolicy(rr, httptest.NewRequest("GET", "/auth/password-policy", nil))

	var resp struct {
		Data struct {
			Password struct {
				MinLength int `json:"min_length"`
				MaxLength int `json:"max_length"`
			} `json:"password"`
		} `json:"data"`
	}
	if err := json.Unmarshal(rr.Body.Bytes(), &resp); err != nil {
		t.Fatal(err)
	}
	if resp.Data.Password.MinLength != 8 || resp.Data.Password.MaxLength != 72 {
		t.Errorf("policy = %+v", resp.Data.Password)
	}
}

func TestJSONError(t *testing.T) {
	rr := httptest.NewRecorder()
	JSONError(http.StatusNotFound, "Risorsa non trovata")(rr, httptest.NewRequest("GET", "/nope", nil))
	if rr.Code != http.StatusNotFound || rr.Header().Get("Content-Type") != "application/json" {
		t.Errorf("code = %d, content-type = %s", rr.Code, rr.Header().Get("Content-Type"))
	}
}
