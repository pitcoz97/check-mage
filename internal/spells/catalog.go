package spells

import "chess-server/internal/phase"

// Catalogo delle magie (docs/BRIEFING-MAGIE.md §5). Cresce a ogni step della
// roadmap: entrano solo le magie i cui effect kind sono già implementati, perché
// un kind sconosciuto farebbe fallire il cast con internal_error.
//
// Convenzioni dei parametri:
//   - "duration" = turni dell'AVVERSARIO del lanciatore in cui l'effetto resta
//     attivo (0 = solo il turno corrente, -1 = permanente);
//   - "no_check": true = dopo l'effetto nessun re può essere sotto scacco. Oggi
//     la regola vale per ogni effetto che tocca la scacchiera: il parametro
//     resta nei dati per documentare l'intento;
//   - gli stati richiesti (RequireEffect) usano i nomi del Tracker: "freeze",
//     "shield".

// mainPhases: la magia è giocabile in main1 e in main2.
var mainPhases = []phase.Phase{phase.PhaseMain1, phase.PhaseMain2}

// minor: i pezzi minori.
var minor = []PieceKind{Knight, Bishop}

var catalogList = []Spell{

	// ───────────────────────── GELO ─────────────────────────

	{ID: "frost", Name: "Brina", ManaCost: 1, Phases: mainPhases, Tags: []string{"gelo"}, Rarity: Common,
		Targets: []TargetSpec{{Type: TargetEnemyPiece, Pieces: []PieceKind{Pawn}}},
		Effects: []Effect{{Kind: EffectFreezePiece, Params: map[string]interface{}{"duration": 1}}}},

	{ID: "ice_chain", Name: "Catena di ghiaccio", ManaCost: 3, Phases: mainPhases, Tags: []string{"gelo"}, Rarity: Common,
		Targets: []TargetSpec{{Type: TargetEnemyPiece, Pieces: minor}},
		Effects: []Effect{{Kind: EffectFreezePiece, Params: map[string]interface{}{"duration": 1}}}},

	{ID: "shatter", Name: "Frantumare", ManaCost: 4, Phases: mainPhases, Tags: []string{"gelo"}, Rarity: Common,
		Targets: []TargetSpec{{Type: TargetEnemyPiece, Pieces: []PieceKind{Pawn, Knight, Bishop, Rook}, RequireEffect: "freeze"}},
		Effects: []Effect{{Kind: EffectDestroyPiece}}},

	// ────────────────────── NECROMANZIA ──────────────────────

	{ID: "blood_pact", Name: "Patto di sangue", ManaCost: 0, Phases: mainPhases, Tags: []string{"necro"}, Rarity: Common,
		Targets: []TargetSpec{{Type: TargetOwnPiece, Pieces: []PieceKind{Pawn}}},
		Effects: []Effect{
			{Kind: EffectDestroyPiece},
			{Kind: EffectGainMana, Params: map[string]interface{}{"amount": 2, "can_exceed_cap": false}},
		},
		Limits: map[string]int{LimitPerTurn: 1}},

	// ───────────────────────── ARCANO ─────────────────────────

	{ID: "blink", Name: "Blink", ManaCost: 4, Phases: mainPhases, Tags: []string{"arcano"}, Rarity: Common,
		Targets: []TargetSpec{{Type: TargetOwnPiece, Pieces: minor}, {Type: TargetSquare, EmptySquare: true, MaxDistance: 2}},
		Effects: []Effect{{Kind: EffectMovePiece, Params: map[string]interface{}{"no_check": true}}}},

	// ───────────────────────── SACRO ─────────────────────────

	{ID: "shield", Name: "Scudo", ManaCost: 2, Phases: mainPhases, Tags: []string{"sacro"}, Rarity: Common,
		Targets: []TargetSpec{{Type: TargetOwnPiece, Pieces: []PieceKind{Pawn, Knight, Bishop, Rook}}},
		Effects: []Effect{{Kind: EffectShieldPiece, Params: map[string]interface{}{"duration": 1}}}},

	{ID: "royal_shield", Name: "Scudo reale", ManaCost: 4, Phases: mainPhases, Tags: []string{"sacro"}, Rarity: Common,
		Targets: []TargetSpec{{Type: TargetOwnPiece, Pieces: []PieceKind{Queen}}},
		Effects: []Effect{{Kind: EffectShieldPiece, Params: map[string]interface{}{"duration": 1}}}},

	// ──────────────────────── FALANGE ────────────────────────

	{ID: "forced_march", Name: "Marcia forzata", ManaCost: 1, Phases: mainPhases, Tags: []string{"falange"}, Rarity: Common,
		Targets: []TargetSpec{{Type: TargetOwnPiece, Pieces: []PieceKind{Pawn}}},
		Effects: []Effect{{Kind: EffectMovePiece, Params: map[string]interface{}{
			"relative": "forward", "squares": 1, "no_capture": true, "no_promotion": true, "no_check": true}}}},

	{ID: "conscription", Name: "Leva militare", ManaCost: 4, Phases: mainPhases, Tags: []string{"falange"}, Rarity: Common,
		Targets: []TargetSpec{{Type: TargetSquare, EmptySquare: true, OwnRanks: []int{2}}},
		Effects: []Effect{{Kind: EffectSummonPawn, Params: map[string]interface{}{"max_pawns": 8}}}},
}

// Catalog è la libreria delle magie indicizzata per ID.
var Catalog = indexCatalog(catalogList)

// indexCatalog indicizza la lista per ID. Liste nil diventano vuote, così in
// JSON escono come [] e non come null.
func indexCatalog(list []Spell) map[string]Spell {
	out := make(map[string]Spell, len(list))
	for _, s := range list {
		if s.Targets == nil {
			s.Targets = []TargetSpec{}
		}
		if s.Tags == nil {
			s.Tags = []string{}
		}
		out[s.ID] = s
	}
	return out
}

// deckRecipe definisce quante copie di ogni carta compongono il mazzo, uguale
// per entrambi i giocatori. Totale = 40.
//
// Finché il catalogo non è completo la ricetta non può rispettare i limiti di
// copie della rarità (2 per le comuni, 1 per le leggendarie): con 9 magie ne
// servirebbero almeno 20. Il limite si impone alla ricetta finale.
var deckRecipe = []struct {
	ID    string
	Count int
}{
	{"frost", 6},
	{"ice_chain", 4},
	{"shatter", 4},
	{"blood_pact", 4},
	{"blink", 4},
	{"shield", 5},
	{"royal_shield", 3},
	{"forced_march", 5},
	{"conscription", 5},
}
