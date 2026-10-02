package middleware

import (
	"log"
	"net/http"
	"os"

	chimw "github.com/go-chi/chi/v5/middleware"
)

// Log delle richieste senza query string (P8): un token (?token=) o un ticket
// (?ticket=) passati nell'URL non finiscono mai nei log. Per il resto è il
// logger di chi (metodo, percorso, status, durata).

// queryFreeFormatter toglie la query dalla richiesta prima di registrarla.
type queryFreeFormatter struct {
	base chimw.LogFormatter
}

func (f queryFreeFormatter) NewLogEntry(r *http.Request) chimw.LogEntry {
	clean := r.Clone(r.Context())
	clean.URL.RawQuery = ""
	clean.RequestURI = clean.URL.Path
	return f.base.NewLogEntry(clean)
}

// NewQueryFreeLogger crea il logger delle richieste che scrive su logger.
func NewQueryFreeLogger(logger *log.Logger) func(http.Handler) http.Handler {
	return chimw.RequestLogger(queryFreeFormatter{base: &chimw.DefaultLogFormatter{Logger: logger, NoColor: false}})
}

// RequestLogger è il logger delle richieste del server, sull'errore standard
// come quello di chi.
var RequestLogger = NewQueryFreeLogger(log.New(os.Stderr, "", log.LstdFlags))
