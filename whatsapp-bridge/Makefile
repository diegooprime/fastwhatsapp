.PHONY: build run clean install uninstall restart test

BINARY=whatsapp-bridge
PLIST_LABEL=com.whatsapp-raycast
PLIST_PATH=$(HOME)/Library/LaunchAgents/$(PLIST_LABEL).plist

build:
	CGO_ENABLED=1 go build -o $(BINARY) .

run: build
	./$(BINARY)

clean:
	rm -f $(BINARY)

install: build
	cp com.whatsapp-raycast.plist $(PLIST_PATH)
	launchctl load $(PLIST_PATH)

uninstall:
	-launchctl unload $(PLIST_PATH)
	rm -f $(PLIST_PATH)

restart:
	-launchctl unload $(PLIST_PATH)
	launchctl load $(PLIST_PATH)

test:
	CGO_ENABLED=1 go test -v -cover ./...

test-coverage:
	CGO_ENABLED=1 go test -coverprofile=coverage.out ./...
	go tool cover -html=coverage.out -o coverage.html
