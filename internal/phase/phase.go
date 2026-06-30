package phase

import "fmt"

type Phase string

const (
	PhaseDraw    Phase = "draw"
	PhaseMain1   Phase = "main1"
	PhaseMove    Phase = "move"
	PhaseMain2   Phase = "main2"
	PhaseEndTurn Phase = "end_turn"
)

// Order definisce la sequenza ufficiale delle fasi in un turno
var Order = []Phase{
	PhaseDraw,
	PhaseMain1,
	PhaseMove,
	PhaseMain2,
	PhaseEndTurn,
}

// Next restituisce la fase successiva nella sequenza.
// Dopo EndTurn si ricomincia da Draw (turno avversario).
func Next(p Phase) (Phase, error) {
	for i, ph := range Order {
		if ph == p {
			if i == len(Order)-1 {
				return PhaseDraw, nil // wrap al turno successivo
			}
			return Order[i+1], nil
		}
	}
	return "", fmt.Errorf("unknown phase: %s", p)
}

// IsValid verifica che una fase sia tra quelle conosciute
func IsValid(p Phase) bool {
	for _, ph := range Order {
		if ph == p {
			return true
		}
	}
	return false
}
