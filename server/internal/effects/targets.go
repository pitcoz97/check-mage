package effects

import (
	"chess-server/internal/gameerr"
	"chess-server/internal/spells"
)

// Motivi di rifiuto di un bersaglio, in details.reason di invalid_target.
const (
	ReasonOffBoard      = "off_board"      // casella inesistente
	ReasonDuplicate     = "duplicate"      // stessa casella scelta due volte
	ReasonNotEmpty      = "not_empty"      // serviva una casa vuota
	ReasonNoPiece       = "no_piece"       // serviva un pezzo
	ReasonWrongOwner    = "wrong_owner"    // pezzo del colore sbagliato
	ReasonKing          = "king"           // il re non è un bersaglio valido
	ReasonPieceKind     = "piece_kind"     // tipo di pezzo non ammesso
	ReasonMissingEffect = "missing_effect" // manca lo stato richiesto (es. freeze)
	ReasonTooFar        = "too_far"        // oltre MaxDistance dal bersaglio precedente
	ReasonRank          = "rank"           // traversa non ammessa
)

// ValidateTargets verifica che i bersagli rispettino i TargetSpec della magia,
// nello stesso ordine. È pura: legge la FEN e gli stati del Tracker senza
// modificarli. Il numero di bersagli lo verifica già match.CastSpell.
//
// Regole globali, valide per ogni magia: i bersagli sono caselle distinte e il
// re non è mai un bersaglio, salvo un TargetOwnPiece che lo elenca
// esplicitamente in Pieces.
func ValidateTargets(fen string, t *Tracker, specs []spells.TargetSpec, targets []string, caster Color) error {
	grid, err := parsePlacement(fen)
	if err != nil {
		return gameerr.Newf(gameerr.Internal, "FEN non valida: %v", err)
	}
	seen := make(map[string]bool, len(targets))
	for i, spec := range specs {
		if i >= len(targets) {
			break
		}
		square := targets[i]
		reject := func(reason, format string, args ...interface{}) error {
			return gameerr.Newf(gameerr.InvalidTarget, format, args...).
				With("index", i).With("reason", reason).With("square", square)
		}

		row, col, err := parseSquare(square)
		if err != nil {
			return reject(ReasonOffBoard, "casella non valida: %q", square)
		}
		if seen[square] {
			return reject(ReasonDuplicate, "la casella %s è già stata scelta", square)
		}
		seen[square] = true
		p := grid[row][col]

		switch spec.Type {
		case spells.TargetSquare:
			if spec.EmptySquare && p != 0 {
				return reject(ReasonNotEmpty, "la casella %s non è vuota", square)
			}
			// Una casa col muro non è vuota: niente muri impilati, niente pezzi evocati o teletrasportati lì.
			if spec.EmptySquare && t.HasSquareEffect(square, KindWall) {
				return reject(ReasonWall, "la casella %s ha un muro", square)
			}
		case spells.TargetOwnPiece, spells.TargetEnemyPiece:
			if p == 0 {
				return reject(ReasonNoPiece, "nessun pezzo in %s", square)
			}
			own := pieceColor(p) == caster
			if own != (spec.Type == spells.TargetOwnPiece) {
				return reject(ReasonWrongOwner, "il pezzo in %s è del colore sbagliato", square)
			}
			if reason := checkPieceKind(spec, p); reason != "" {
				return reject(reason, "il pezzo in %s non è un bersaglio ammesso", square)
			}
			if spec.RequireEffect != "" && !t.HasEffect(square, spec.RequireEffect) {
				return reject(ReasonMissingEffect, "il pezzo in %s non ha l'effetto %s", square, spec.RequireEffect)
			}
		default:
			return gameerr.Newf(gameerr.Internal, "tipo di bersaglio non supportato: %s", spec.Type)
		}

		if spec.MaxDistance > 0 && i > 0 {
			if d := chebyshev(targets[i-1], square); d > spec.MaxDistance {
				return reject(ReasonTooFar, "%s è a distanza %d, massimo %d", square, d, spec.MaxDistance)
			}
		}
		rank := RelativeRank(square, caster)
		if len(spec.OwnRanks) > 0 && !containsInt(spec.OwnRanks, rank) {
			return reject(ReasonRank, "la traversa di %s non è ammessa", square)
		}
		if spec.MinRank > 0 && rank < spec.MinRank {
			return reject(ReasonRank, "%s è prima della traversa %d", square, spec.MinRank)
		}
	}
	return nil
}

// checkPieceKind restituisce il motivo di rifiuto per il tipo di pezzo, o "".
func checkPieceKind(spec spells.TargetSpec, p byte) string {
	kind := spells.PieceKind(pieceName(p))
	if kind == spells.King {
		if spec.Type == spells.TargetOwnPiece && containsKind(spec.Pieces, spells.King) {
			return ""
		}
		return ReasonKing
	}
	if len(spec.Pieces) > 0 && !containsKind(spec.Pieces, kind) {
		return ReasonPieceKind
	}
	return ""
}

// chebyshev è la distanza "da re" fra due caselle valide.
func chebyshev(a, b string) int {
	ar, ac, errA := parseSquare(a)
	br, bc, errB := parseSquare(b)
	if errA != nil || errB != nil {
		return 99
	}
	return max(abs(ar-br), abs(ac-bc))
}

func abs(x int) int {
	if x < 0 {
		return -x
	}
	return x
}

func containsInt(list []int, v int) bool {
	for _, x := range list {
		if x == v {
			return true
		}
	}
	return false
}

func containsKind(list []spells.PieceKind, v spells.PieceKind) bool {
	for _, x := range list {
		if x == v {
			return true
		}
	}
	return false
}
