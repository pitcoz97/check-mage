package middleware

import (
	"bytes"
	"log"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestQueryFreeLogger(t *testing.T) {
	var buf bytes.Buffer
	handler := NewQueryFreeLogger(log.New(&buf, "", 0))(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Query().Get("ticket") != "segreto" {
			t.Error("l'handler riceve la query intatta")
		}
		w.WriteHeader(http.StatusNoContent)
	}))
	handler.ServeHTTP(httptest.NewRecorder(), httptest.NewRequest("GET", "/ws?ticket=segreto&token=jwt", nil))

	line := buf.String()
	if !strings.Contains(line, "/ws") || !strings.Contains(line, "204") {
		t.Errorf("log senza percorso o status: %q", line)
	}
	if strings.Contains(line, "segreto") || strings.Contains(line, "jwt") || strings.Contains(line, "?") {
		t.Errorf("la query non deve finire nel log: %q", line)
	}
}
