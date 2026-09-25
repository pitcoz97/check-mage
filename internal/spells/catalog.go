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

// preMove: solo in main1, perché la magia modifica la mossa di questo turno.
var preMove = []phase.Phase{phase.PhaseMain1}

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

	{ID: "eternal_winter", Name: "Inverno eterno", ManaCost: 7, Phases: mainPhases, Tags: []string{"gelo"}, Rarity: Legendary,
		Effects: []Effect{{Kind: EffectFreezeAll, Params: map[string]interface{}{
			"side": "enemy", "pieces": []PieceKind{Pawn}, "duration": 1}}}},

	// ────────────────────── NECROMANZIA ──────────────────────

	{ID: "blood_pact", Name: "Patto di sangue", ManaCost: 0, Phases: mainPhases, Tags: []string{"necro"}, Rarity: Common,
		Targets: []TargetSpec{{Type: TargetOwnPiece, Pieces: []PieceKind{Pawn}}},
		Effects: []Effect{
			{Kind: EffectDestroyPiece},
			{Kind: EffectGainMana, Params: map[string]interface{}{"amount": 2, "can_exceed_cap": false}},
		},
		Limits: map[string]int{LimitPerTurn: 1}},

	{ID: "recall", Name: "Richiamo", ManaCost: 3, Phases: mainPhases, Tags: []string{"necro", "falange"}, Rarity: Common,
		Targets: []TargetSpec{{Type: TargetSquare, EmptySquare: true, OwnRanks: []int{2}}},
		Effects: []Effect{{Kind: EffectRevivePiece, Params: map[string]interface{}{"pieces": []PieceKind{Pawn}, "no_check": true}}}},

	{ID: "resurrection", Name: "Resurrezione", ManaCost: 8, Phases: mainPhases, Tags: []string{"necro"}, Rarity: Legendary,
		Targets: []TargetSpec{{Type: TargetSquare, EmptySquare: true, OwnRanks: []int{1}}},
		Effects: []Effect{{Kind: EffectRevivePiece, Params: map[string]interface{}{"pieces": []PieceKind{Knight, Bishop, Rook}, "no_check": true}}}},

	// ───────────────────────── ARCANO ─────────────────────────

	{ID: "blink", Name: "Blink", ManaCost: 4, Phases: mainPhases, Tags: []string{"arcano"}, Rarity: Common,
		Targets: []TargetSpec{{Type: TargetOwnPiece, Pieces: minor}, {Type: TargetSquare, EmptySquare: true, MaxDistance: 2}},
		Effects: []Effect{{Kind: EffectMovePiece, Params: map[string]interface{}{"no_check": true}}}},

	{ID: "swap", Name: "Scambio", ManaCost: 3, Phases: mainPhases, Tags: []string{"arcano"}, Rarity: Common,
		Targets: []TargetSpec{{Type: TargetOwnPiece}, {Type: TargetOwnPiece}},
		Effects: []Effect{{Kind: EffectSwapPieces, Params: map[string]interface{}{"no_check": true}}}},

	{ID: "metamorphosis", Name: "Metamorfosi", ManaCost: 5, Phases: mainPhases, Tags: []string{"arcano"}, Rarity: Common,
		Targets: []TargetSpec{{Type: TargetOwnPiece, Pieces: minor}},
		Effects: []Effect{{Kind: EffectTransformPiece, Params: map[string]interface{}{
			"map": map[string]interface{}{"knight": "bishop", "bishop": "knight"}, "no_check": true}}}},

	// ───────────────────────── SACRO ─────────────────────────

	{ID: "shield", Name: "Scudo", ManaCost: 2, Phases: mainPhases, Tags: []string{"sacro"}, Rarity: Common,
		Targets: []TargetSpec{{Type: TargetOwnPiece, Pieces: []PieceKind{Pawn, Knight, Bishop, Rook}}},
		Effects: []Effect{{Kind: EffectShieldPiece, Params: map[string]interface{}{"duration": 1}}}},

	{ID: "royal_shield", Name: "Scudo reale", ManaCost: 4, Phases: mainPhases, Tags: []string{"sacro"}, Rarity: Common,
		Targets: []TargetSpec{{Type: TargetOwnPiece, Pieces: []PieceKind{Queen}}},
		Effects: []Effect{{Kind: EffectShieldPiece, Params: map[string]interface{}{"duration": 1}}}},

	{ID: "royal_guard", Name: "Guardia reale", ManaCost: 3, Phases: mainPhases, Tags: []string{"sacro"}, Rarity: Common,
		Effects: []Effect{{Kind: EffectShieldArea, Params: map[string]interface{}{
			"around": "own_king", "radius": 1, "duration": 1}}}},

	{ID: "divine_castling", Name: "Arrocco divino", ManaCost: 4, Phases: preMove, Tags: []string{"sacro"}, Rarity: Common,
		Effects: []Effect{{Kind: EffectRestoreCastling}}},

	// ──────────────────────── FALANGE ────────────────────────

	{ID: "forced_march", Name: "Marcia forzata", ManaCost: 1, Phases: mainPhases, Tags: []string{"falange"}, Rarity: Common,
		Targets: []TargetSpec{{Type: TargetOwnPiece, Pieces: []PieceKind{Pawn}}},
		Effects: []Effect{{Kind: EffectMovePiece, Params: map[string]interface{}{
			"relative": "forward", "squares": 1, "no_capture": true, "no_promotion": true, "no_check": true}}}},

	{ID: "conscription", Name: "Leva militare", ManaCost: 4, Phases: mainPhases, Tags: []string{"falange"}, Rarity: Common,
		Targets: []TargetSpec{{Type: TargetSquare, EmptySquare: true, OwnRanks: []int{2}}},
		Effects: []Effect{{Kind: EffectSummonPawn, Params: map[string]interface{}{"max_pawns": 8}}}},

	{ID: "phalanx", Name: "Falange", ManaCost: 3, Phases: mainPhases, Tags: []string{"falange", "sacro"}, Rarity: Common,
		Effects: []Effect{{Kind: EffectShieldArea, Params: map[string]interface{}{
			"filter": "own_pawns_side_by_side", "duration": 1}}}},

	{ID: "early_promotion", Name: "Promozione anticipata", ManaCost: 6, Phases: mainPhases, Tags: []string{"falange"}, Rarity: Legendary,
		Targets: []TargetSpec{{Type: TargetOwnPiece, Pieces: []PieceKind{Pawn}, MinRank: 6}},
		Effects: []Effect{{Kind: EffectPromotePiece, Params: map[string]interface{}{
			"choices": []PieceKind{Knight, Bishop, Rook, Queen}, "no_check": true}}}},
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
// copie della rarità (2 per le comuni, 1 per le leggendarie): con 15 comuni e 3
// leggendarie arrivano al massimo 33 carte. Le leggendarie sono già a 1 copia; il
// limite delle comuni si impone alla ricetta finale.
var deckRecipe = []struct {
	ID    string
	Count int
}{
	{"frost", 3},
	{"ice_chain", 2},
	{"shatter", 3},
	{"eternal_winter", 1},
	{"blood_pact", 3},
	{"recall", 3},
	{"resurrection", 1},
	{"blink", 2},
	{"swap", 2},
	{"metamorphosis", 2},
	{"shield", 3},
	{"royal_shield", 2},
	{"royal_guard", 2},
	{"divine_castling", 2},
	{"forced_march", 3},
	{"conscription", 3},
	{"phalanx", 2},
	{"early_promotion", 1},
}
