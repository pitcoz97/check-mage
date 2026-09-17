package gameerr

import (
	"errors"
	"fmt"
	"testing"
)

func TestFrom_WrappedGameError(t *testing.T) {
	base := New(InsufficientMana, "mana insufficiente").With("needed", 3).With("available", 1)
	wrapped := fmt.Errorf("cast fallito: %w", base)

	got := From(wrapped)
	if got.Code != InsufficientMana {
		t.Errorf("code = %s, atteso %s", got.Code, InsufficientMana)
	}
	if got.Details["needed"] != 3 || got.Details["available"] != 1 {
		t.Errorf("details = %v", got.Details)
	}
}

func TestFrom_PlainError(t *testing.T) {
	got := From(errors.New("boom"))
	if got.Code != Internal || got.Message != "boom" {
		t.Errorf("atteso internal_error/boom, ottenuto %s/%s", got.Code, got.Message)
	}
}
