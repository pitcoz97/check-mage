# Server CheckMage: build del binario Go, poi un'immagine piccola con Stockfish.
# Usata da deploy/docker-compose.yml (guida: docs/DEPLOY.md).

FROM golang:1.25-bookworm AS build
WORKDIR /src
COPY go.mod go.sum ./
RUN go mod download
COPY . .
RUN CGO_ENABLED=0 go build -trimpath -ldflags="-s -w" -o /out/chess-server .

FROM debian:bookworm-slim
# Stockfish valida le mosse (engine/stockfish.go lo avvia come "stockfish"): Debian lo installa in /usr/games.
RUN apt-get update \
    && apt-get install -y --no-install-recommends stockfish ca-certificates tzdata \
    && rm -rf /var/lib/apt/lists/*
ENV PATH="/usr/games:${PATH}"
RUN useradd --system --create-home --uid 10001 app
USER app
WORKDIR /app
COPY --from=build /out/chess-server /app/chess-server
EXPOSE 8080
ENTRYPOINT ["/app/chess-server"]
