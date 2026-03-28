FROM golang:1.24-bookworm AS builder

RUN apt-get update && apt-get install -y gcc-aarch64-linux-gnu gcc libc6-dev && rm -rf /var/lib/apt/lists/*

WORKDIR /src
COPY go.mod go.sum ./
RUN go mod download

COPY . .
RUN CGO_ENABLED=1 go build -tags "fts5" -o /whatsapp-bridge .

FROM debian:bookworm-slim

RUN apt-get update && apt-get install -y ca-certificates && rm -rf /var/lib/apt/lists/*

COPY --from=builder /whatsapp-bridge /usr/local/bin/whatsapp-bridge

ENV DATA_DIR=/data
ENV BIND_ADDR=0.0.0.0:3847

EXPOSE 3847

CMD ["whatsapp-bridge"]
